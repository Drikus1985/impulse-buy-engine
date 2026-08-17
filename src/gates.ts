/**
 * The gates that stop a plausible-looking product from reaching a launch card:
 * evidence independence, supplier depth, safety/IP exclusions, and overall
 * launch readiness.
 */

import { EVIDENCE_GATES, HARD_EXCLUSION_FLAGS, LAUNCH_SCORE_THRESHOLD, SOFT_EXCLUSION_FLAGS, SUPPLIER_GATES } from "./constants.js";
import { ComplianceResult, Database, Evidence, Product, Supplier } from "./types.js";

// ---------------------------------------------------------------------------
// Evidence gate
// ---------------------------------------------------------------------------

export interface EvidenceGateResult {
  subject_type: "category" | "product" | "market";
  subject_id: string;
  total_signals: number;
  independent_domains: string[];
  independent_signal_count: number;
  non_supplier_signal_count: number;
  verified_signal_count: number;
  required_independent_signals: number;
  required_non_supplier_signals: number;
  pass: boolean;
  reasons: string[];
}

/** Independence is measured by distinct source domain: three links to one site is one signal. */
export function checkEvidenceGate(
  evidence: Evidence[],
  subjectType: "category" | "product" | "market",
  subjectId: string,
): EvidenceGateResult {
  const relevant = evidence.filter((item) => item.subject_type === subjectType && item.subject_id === subjectId);
  const domains = [...new Set(relevant.map((item) => item.source_domain.toLowerCase()))];
  const nonSupplierDomains = [
    ...new Set(relevant.filter((item) => !item.is_supplier_source).map((item) => item.source_domain.toLowerCase())),
  ];
  const verified = relevant.filter((item) => item.verification === "verified").length;

  const requiredIndependent =
    subjectType === "category"
      ? EVIDENCE_GATES.category_min_independent_signals
      : EVIDENCE_GATES.product_min_independent_signals;
  const requiredNonSupplier = subjectType === "product" ? EVIDENCE_GATES.product_min_non_supplier_signals : 0;

  const reasons: string[] = [];
  if (domains.length < requiredIndependent) {
    reasons.push(
      `Only ${domains.length} independent source domain(s) recorded; ${requiredIndependent} required. Add evidence from a different domain with ice_add_evidence.`,
    );
  }
  if (nonSupplierDomains.length < requiredNonSupplier) {
    reasons.push(
      `No independent non-supplier signal recorded; ${requiredNonSupplier} required. Supplier order counts and listing pages do not count.`,
    );
  }
  if (relevant.length === 0) {
    reasons.push("No evidence recorded at all for this subject.");
  }

  return {
    subject_type: subjectType,
    subject_id: subjectId,
    total_signals: relevant.length,
    independent_domains: domains,
    independent_signal_count: domains.length,
    non_supplier_signal_count: nonSupplierDomains.length,
    verified_signal_count: verified,
    required_independent_signals: requiredIndependent,
    required_non_supplier_signals: requiredNonSupplier,
    pass: reasons.length === 0,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Supplier gate
// ---------------------------------------------------------------------------

export interface SupplierGateResult {
  product_id: string;
  supplier_count: number;
  types_present: string[];
  has_manufacturer: boolean;
  has_wholesaler_or_marketplace: boolean;
  has_local_or_regional: boolean;
  backup_available: boolean;
  verified_count: number;
  unverified_claiming_certifications: string[];
  pass: boolean;
  meets_preferred_depth: boolean;
  reasons: string[];
}

export function checkSupplierGate(suppliers: Supplier[], productId: string): SupplierGateResult {
  const relevant = suppliers.filter((supplier) => supplier.product_id === productId);
  const types = [...new Set(relevant.map((supplier) => supplier.type))];
  const hasManufacturer = types.includes("manufacturer");
  const hasWholesale = types.includes("wholesaler") || types.includes("sourcing_marketplace") || types.includes("trader");
  const hasLocal = types.includes("local_distributor") || types.includes("importer");
  const backup = relevant.some((supplier) => supplier.is_backup) || relevant.length >= 2;
  const verified = relevant.filter((supplier) => supplier.verification_status === "verified").length;
  const unverifiedWithCerts = relevant
    .filter((supplier) => supplier.certifications_claimed.length > 0 && supplier.verification_status !== "verified")
    .map((supplier) => supplier.name);

  const reasons: string[] = [];
  if (relevant.length < SUPPLIER_GATES.min_supply_options_hard_floor) {
    reasons.push(
      `Only ${relevant.length} supply option(s) recorded; at least ${SUPPLIER_GATES.min_supply_options_hard_floor} are needed before launch, and ${SUPPLIER_GATES.min_supply_options} is the target.`,
    );
  }
  if (!backup) {
    reasons.push("No backup supplier recorded. A single-source impulse product stops selling the day that supplier fails.");
  }

  return {
    product_id: productId,
    supplier_count: relevant.length,
    types_present: types,
    has_manufacturer: hasManufacturer,
    has_wholesaler_or_marketplace: hasWholesale,
    has_local_or_regional: hasLocal,
    backup_available: backup,
    verified_count: verified,
    unverified_claiming_certifications: unverifiedWithCerts,
    pass: reasons.length === 0,
    meets_preferred_depth: relevant.length >= SUPPLIER_GATES.min_supply_options,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Compliance / exclusion gate
// ---------------------------------------------------------------------------

export function assessCompliance(
  productId: string,
  flags: string[],
  mitigations: { flag: string; evidence: string }[],
  notes: string,
): ComplianceResult {
  const hardSet = new Set<string>(HARD_EXCLUSION_FLAGS);
  const softSet = new Set<string>(SOFT_EXCLUSION_FLAGS);
  const mitigated = new Set(
    mitigations.filter((mitigation) => mitigation.evidence.trim().length > 0).map((mitigation) => mitigation.flag),
  );

  const hardActive = flags.filter((flag) => hardSet.has(flag) && !mitigated.has(flag));
  const hardMitigated = flags.filter((flag) => hardSet.has(flag) && mitigated.has(flag));
  const softActive = flags.filter((flag) => softSet.has(flag));

  const reasons: string[] = [];
  let verdict: ComplianceResult["verdict"] = "PASS";

  if (hardActive.length > 0) {
    verdict = "EXCLUDE";
    reasons.push(
      `Hard exclusion flag(s) active: ${hardActive.join(", ")}. These cannot be recommended as a quick start. Record verified mitigation evidence to clear a flag, or drop the product.`,
    );
  } else if (softActive.length > 0 || hardMitigated.length > 0) {
    verdict = "PENALISE";
    if (softActive.length) {
      reasons.push(`Soft risk flag(s) present: ${softActive.join(", ")}. Allowed, but they must be priced into the plan and disclosed.`);
    }
    if (hardMitigated.length) {
      reasons.push(
        `Hard flag(s) cleared by recorded mitigation: ${hardMitigated.join(", ")}. Treat as a longer-term opportunity until the mitigation is independently confirmed.`,
      );
    }
  } else {
    reasons.push("No exclusion flags recorded. This is only as good as the screening actually performed.");
  }

  return {
    product_id: productId,
    verdict,
    hard_flags_active: hardActive,
    hard_flags_mitigated: hardMitigated,
    soft_flags_active: softActive,
    mitigations,
    notes,
    launch_eligible: verdict !== "EXCLUDE",
    reasons,
    assessed_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Launch readiness
// ---------------------------------------------------------------------------

export interface LaunchReadiness {
  product_id: string;
  product_name: string;
  score: number;
  ready: boolean;
  checks: { name: string; pass: boolean; detail: string }[];
  blocking_reasons: string[];
}

export function assessLaunchReadiness(db: Database, product: Product): LaunchReadiness {
  const checks: LaunchReadiness["checks"] = [];

  const scoreOk = product.score >= LAUNCH_SCORE_THRESHOLD;
  checks.push({
    name: "product_score",
    pass: scoreOk,
    detail: `${product.score}/100 (threshold ${LAUNCH_SCORE_THRESHOLD}; below it the product is watch-list only)`,
  });

  const evidence = checkEvidenceGate(db.evidence, "product", product.id);
  checks.push({
    name: "evidence_gate",
    pass: evidence.pass,
    detail: evidence.pass
      ? `${evidence.independent_signal_count} independent domains, ${evidence.non_supplier_signal_count} non-supplier`
      : evidence.reasons.join(" "),
  });

  const suppliers = checkSupplierGate(db.suppliers, product.id);
  checks.push({
    name: "supplier_gate",
    pass: suppliers.pass,
    detail: suppliers.pass ? `${suppliers.supplier_count} supply options, backup available` : suppliers.reasons.join(" "),
  });

  const compliance = db.compliance.find((item) => item.product_id === product.id);
  checks.push({
    name: "compliance_gate",
    pass: compliance ? compliance.launch_eligible : false,
    detail: compliance
      ? `verdict ${compliance.verdict}`
      : "No compliance screen recorded. Run ice_screen_compliance before treating this as launchable.",
  });

  const economics = latestEconomics(db, product.id);
  checks.push({
    name: "unit_economics",
    pass: economics ? economics.screens_passed : false,
    detail: economics
      ? economics.screens_passed
        ? `pre-ad contribution ${economics.pre_ad_contribution} ${economics.inputs.currency}, margin ${(economics.pre_ad_contribution_margin * 100).toFixed(1)}%`
        : `failed screens: ${economics.screens.filter((screen) => !screen.pass).map((screen) => screen.name).join(", ")}`
      : "No unit economics computed. Run ice_calc_unit_economics.",
  });

  const blocking = checks.filter((check) => !check.pass).map((check) => `${check.name}: ${check.detail}`);
  return {
    product_id: product.id,
    product_name: product.name,
    score: product.score,
    ready: blocking.length === 0,
    checks,
    blocking_reasons: blocking,
  };
}

export function latestEconomics(db: Database, productId: string) {
  const matches = db.economics.filter((item) => item.product_id === productId);
  return matches.length ? matches[matches.length - 1] : undefined;
}
