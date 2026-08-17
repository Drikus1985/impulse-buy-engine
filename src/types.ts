/**
 * Domain types and shared Zod primitives for the impulse-commerce research ledger.
 *
 * IMPORTANT DESIGN NOTE
 * ---------------------
 * This server holds no live market data of its own and never fetches anything.
 * The calling agent performs research with its own tools and writes findings here.
 * The server's job is to (a) persist those findings, (b) apply the scoring rubrics,
 * unit-economics formulas and gates deterministically, and (c) refuse to let
 * unverified claims be presented as verified.
 */

import { z } from "zod";
import { ALL_EXCLUSION_FLAGS, DEFAULT_CURRENCY, DUE_DILIGENCE_ITEMS, MARKET_CRITERIA } from "./constants.js";

export const ResponseFormat = z.enum(["markdown", "json"]);
export type ResponseFormatT = z.infer<typeof ResponseFormat>;

export const Confidence = z.enum(["Certain", "Likely", "Guessing"]);
export type ConfidenceT = z.infer<typeof Confidence>;

export const Verification = z.enum(["verified", "estimated", "unavailable"]);
export const TrendStatus = z.enum(["rising", "stable", "seasonal", "declining", "unproven"]);
export const Intensity = z.enum(["low", "moderate", "high"]);
export const RiskLevel = z.enum(["low", "moderate", "high"]);
export const MarketRole = z.enum(["home", "candidate", "beachhead", "secondary", "postponed"]);
export const SupplierType = z.enum([
  "manufacturer",
  "trader",
  "wholesaler",
  "sourcing_marketplace",
  "local_distributor",
  "importer",
]);
export const SupplierVerification = z.enum(["unverified", "partially_verified", "verified"]);
export const ExclusionFlagEnum = z.enum(ALL_EXCLUSION_FLAGS);
export const DueDiligenceItemEnum = z.enum(DUE_DILIGENCE_ITEMS);
export const MarketCriterionEnum = z.enum(MARKET_CRITERIA);

/** A 0-10 factor rating. 0 = worst, 10 = best. */
export const Rating = z.number().min(0).max(10);

export const currencyField = z
  .string()
  .length(3)
  .default(DEFAULT_CURRENCY)
  .describe(`ISO currency code for all monetary values on this record (default '${DEFAULT_CURRENCY}'). No FX conversion is performed.`);

export const responseFormatField = ResponseFormat.default("markdown").describe(
  "Output format: 'markdown' for human-readable or 'json' for machine-readable.",
);

// ---------------------------------------------------------------------------
// Stored records
// ---------------------------------------------------------------------------

export interface Market {
  id: string;
  name: string;
  country_code: string;
  role: z.infer<typeof MarketRole>;
  currency: string;
  criteria: Partial<Record<(typeof MARKET_CRITERIA)[number], number>>;
  score: number;
  score_basis: string;
  confidence: ConfidenceT;
  notes?: string;
  sourcing_recommendation?: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  market_ids: string[];
  primary_need: string;
  target_customers: string[];
  geographies: string[];
  trend_direction: z.infer<typeof TrendStatus>;
  seasonality: string;
  typical_price_min: number | null;
  typical_price_max: number | null;
  currency: string;
  competitive_intensity: z.infer<typeof Intensity>;
  content_potential: string;
  repeat_or_bundle_potential: string;
  principal_risks: string[];
  factors: Record<string, number>;
  score: number;
  confidence: ConfidenceT;
  notes?: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  category_id: string;
  buyer: string;
  trigger: string;
  purchase_moment: string;
  problem_solved: string;
  five_second_hook: string;
  geographies: string[];
  trend_status: z.infer<typeof TrendStatus>;
  saturation: z.infer<typeof Intensity>;
  differentiation: string;
  selling_price_min: number | null;
  selling_price_max: number | null;
  product_cost_min: number | null;
  product_cost_max: number | null;
  currency: string;
  shipping_profile: string;
  return_risk: z.infer<typeof RiskLevel>;
  supplier_path: string;
  compliance_notes: string;
  content_angle: string;
  expansion_potential: string;
  factors: Record<string, number>;
  score: number;
  confidence: ConfidenceT;
  status: "researching" | "watchlist" | "shortlisted" | "immediate_test" | "reserve" | "long_term" | "rejected";
  notes?: string;
  updated_at: string;
}

export interface Evidence {
  id: string;
  subject_type: "category" | "product" | "market";
  subject_id: string;
  source_name: string;
  source_domain: string;
  url: string;
  region: string;
  period_covered: string;
  signal_type: string;
  is_supplier_source: boolean;
  verification: z.infer<typeof Verification>;
  summary: string;
  observed_on: string;
  recorded_at: string;
}

export interface Supplier {
  id: string;
  product_id: string;
  name: string;
  url: string;
  country: string;
  type: z.infer<typeof SupplierType>;
  unit_price_min: number | null;
  unit_price_max: number | null;
  currency: string;
  moq: number | null;
  sample_available: boolean | null;
  sample_cost: number | null;
  private_label_available: boolean | null;
  production_days: number | null;
  incoterms: string[];
  estimated_delivery_days: number | null;
  buyer_protection: string;
  payment_terms: string;
  certifications_claimed: string[];
  verification_status: z.infer<typeof SupplierVerification>;
  verification_evidence: string[];
  verification_outstanding: string[];
  responsiveness_tested: boolean;
  responsiveness_notes: string;
  risks: string[];
  is_backup: boolean;
  due_diligence: Partial<Record<(typeof DUE_DILIGENCE_ITEMS)[number], boolean>>;
  updated_at: string;
}

export interface EconomicsInputs {
  selling_price: number;
  price_includes_vat: boolean;
  vat_rate: number;
  vat_recoverable: boolean;
  product_cost: number;
  freight_per_unit: number;
  duty_rate: number;
  duty_per_unit: number;
  non_recoverable_import_tax_per_unit: number;
  packaging_per_unit: number;
  inspection_per_unit: number;
  receiving_per_unit: number;
  payment_fee_pct: number;
  payment_fee_fixed: number;
  fulfilment_per_unit: number;
  refund_rate: number;
  return_shipping_cost: number;
  salvage_rate: number;
  defect_rate: number;
  delivery_failure_rate: number;
  support_allowance_per_unit: number;
  required_profit_per_order: number;
  actual_cac: number | null;
  fx_shock: number;
  currency: string;
}

export interface EconomicsResult {
  inputs: EconomicsInputs;
  net_selling_price: number;
  landed_cost: number;
  landed_cost_breakdown: Record<string, number>;
  payment_fees: number;
  expected_refund_cost: number;
  expected_defect_cost: number;
  expected_delivery_failure_cost: number;
  pre_ad_contribution: number;
  pre_ad_contribution_margin: number;
  landed_cost_ratio: number;
  max_breakeven_cac: number;
  target_cac: number;
  breakeven_roas: number | null;
  post_ad_contribution: number | null;
  post_ad_contribution_margin: number | null;
  screens: { name: string; threshold: number; actual: number; pass: boolean }[];
  screens_passed: boolean;
  warnings: string[];
  formula_trace: string[];
}

export interface StoredEconomics extends EconomicsResult {
  product_id: string;
  label: string;
  computed_at: string;
}

export interface ComplianceResult {
  product_id: string;
  verdict: "PASS" | "PENALISE" | "EXCLUDE";
  hard_flags_active: string[];
  hard_flags_mitigated: string[];
  soft_flags_active: string[];
  mitigations: { flag: string; evidence: string }[];
  notes: string;
  launch_eligible: boolean;
  reasons: string[];
  assessed_at: string;
}

export interface PortfolioSelection {
  immediate_test: string[];
  reserve: string[];
  long_term: string[];
  rejected: { product_id: string; reasons: string[] }[];
  diversity_report: { product_id: string; trigger: string }[];
  generated_at: string;
  notes: string[];
}

export interface Database {
  schema_version: number;
  created_at: string;
  updated_at: string;
  markets: Market[];
  categories: Category[];
  products: Product[];
  evidence: Evidence[];
  suppliers: Supplier[];
  economics: StoredEconomics[];
  compliance: ComplianceResult[];
  portfolio: PortfolioSelection | null;
}

export function emptyDatabase(): Database {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    created_at: now,
    updated_at: now,
    markets: [],
    categories: [],
    products: [],
    evidence: [],
    suppliers: [],
    economics: [],
    compliance: [],
    portfolio: null,
  };
}
