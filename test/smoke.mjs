#!/usr/bin/env node
/**
 * End-to-end smoke test over a real stdio MCP session.
 *
 * Verifies: tool registration, the full research flow, hand-checked unit-economics
 * arithmetic, and that each gate actually blocks what it claims to block.
 *
 * Run: node test/smoke.mjs
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const DATA_DIR = "/tmp/ice-smoke-test";
rmSync(DATA_DIR, { recursive: true, force: true });

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function near(actual, expected, tolerance = 0.02) {
  return Math.abs(actual - expected) <= tolerance;
}

const transport = new StdioClientTransport({
  command: "node",
  args: [join(root, "dist/index.js")],
  env: { ...process.env, ICE_DATA_DIR: DATA_DIR },
});
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.map((block) => block.text).join("\n") ?? "";
  return { result, text, structured: result.structuredContent, isError: result.isError === true };
}

console.log("\n== Tool registration ==");
const { tools } = await client.listTools();
check(`registered ${tools.length} tools`, tools.length >= 18, `got ${tools.length}`);
check("every tool has a description", tools.every((tool) => (tool.description ?? "").length > 50));
check("every tool has annotations", tools.every((tool) => tool.annotations && "readOnlyHint" in tool.annotations));
check("every tool name is ice_-prefixed snake_case", tools.every((tool) => /^ice_[a-z0-9_]+$/.test(tool.name)));

console.log("\n== Rubrics ==");
const rubrics = await call("ice_get_rubrics", { response_format: "json" });
const categoryWeightSum = Object.values(rubrics.structured.category_weights).reduce((a, b) => a + b, 0);
const productWeightSum = Object.values(rubrics.structured.product_weights).reduce((a, b) => a + b, 0);
check("category weights sum to 100", categoryWeightSum === 100, `got ${categoryWeightSum}`);
check("product weights sum to 100", productWeightSum === 100, `got ${productWeightSum}`);

console.log("\n== Market ==");
const market = await call("ice_upsert_market", {
  name: "South Africa",
  country_code: "ZA",
  role: "beachhead",
  confidence: "Likely",
  ecommerce_and_social_commerce_demand: 7,
  consumer_purchasing_power: 5,
  payment_method_availability: 8,
  customer_acquisition_conditions: 7,
  marketplace_accessibility: 8,
  delivery_speed_and_cost: 6,
  low_customs_and_import_friction: 4,
  low_returns_complexity: 6,
  low_regulatory_burden: 6,
  low_localisation_requirement: 9,
  low_competitive_intensity: 6,
  short_path_to_first_revenue: 8,
});
// (7+5+8+7+8+6+4+6+6+9+6+8)/120 * 100 = 80/120*100 = 66.7
check("market score computed correctly", near(market.structured.score, 66.7, 0.15), `got ${market.structured.score}`);
check("market id slugified", market.structured.market.id === "south-africa", market.structured.market.id);

console.log("\n== Category ==");
const category = await call("ice_upsert_category", {
  name: "Desk cable management",
  primary_need: "Reduce visual clutter at a home desk",
  trend_direction: "rising",
  competitive_intensity: "moderate",
  current_trend_momentum: 8,
  impulse_purchase_suitability: 9,
  demonstrability_in_short_form: 10,
  unit_economics_potential: 7,
  shipping_and_fulfilment_simplicity: 9,
  automation_suitability: 8,
  differentiation_opportunity: 6,
  low_regulatory_and_liability_risk: 9,
});
// 0.8*15 + 0.9*15 + 1.0*10 + 0.7*20 + 0.9*10 + 0.8*10 + 0.6*10 + 0.9*10 = 12+13.5+10+14+9+8+6+9 = 81.5
check("category score computed correctly", near(category.structured.score, 81.5), `got ${category.structured.score}`);
check("category evidence gate fails with no evidence", category.structured.evidence_gate.pass === false);
const categoryId = category.structured.category.id;

console.log("\n== Product ==");
const product = await call("ice_upsert_product", {
  name: "magnetic under-desk cable tray",
  category_id: categoryId,
  buyer: "Remote workers with a home desk",
  trigger: "visual clutter irritation",
  purchase_moment: "After a video call where the desk looked messy",
  problem_solved: "Cables hang visibly under the desk",
  five_second_hook: "Clip it once, cables gone",
  trend_status: "rising",
  saturation: "moderate",
  demand_evidence: 8,
  impulse_trigger_strength: 9,
  visual_demonstration_potential: 10,
  unit_economics: 6,
  customer_acquisition_potential: 8,
  shipping_simplicity: 9,
  low_return_risk: 8,
  supply_reliability: 7,
  differentiation_opportunity: 6,
  low_legal_safety_ip_risk: 9,
});
// 0.8*15+0.9*12+1.0*8+0.6*18+0.8*10+0.9*10+0.8*7+0.7*7+0.6*8+0.9*5
// = 12+10.8+8+10.8+8+9+5.6+4.9+4.8+4.5 = 78.4
check("product score computed correctly", near(product.structured.score, 78.4), `got ${product.structured.score}`);
check("product is above launch threshold", product.structured.is_launch_candidate === true);
check("product is NOT launch ready without gates", product.structured.readiness.ready === false);
const productId = product.structured.product.id;

const badCategory = await call("ice_upsert_product", { name: "orphan", category_id: "does-not-exist" });
check("product with unknown category is rejected", badCategory.isError === true);
check("category error message names the fix", /Create one with ice_upsert_category|No category with id/.test(badCategory.text));

console.log("\n== Evidence gate ==");
await call("ice_add_evidence", {
  subject_type: "product",
  subject_id: productId,
  source_name: "Supplier listing",
  url: "https://www.aliexpress.com/item/123.html",
  region: "Global",
  period_covered: "12 months to 2026-08-17",
  signal_type: "supplier order count",
  summary: "Listing claims 4000 orders",
  is_supplier_source: true,
  verification: "estimated",
});
const secondSupplierSignal = await call("ice_add_evidence", {
  subject_type: "product",
  subject_id: productId,
  source_name: "Same supplier, different listing",
  url: "https://aliexpress.com/item/456.html",
  region: "Global",
  period_covered: "12 months to 2026-08-17",
  signal_type: "supplier order count",
  summary: "Second listing on the same domain",
  is_supplier_source: true,
  verification: "estimated",
});
check(
  "two links to the same domain count as one independent signal",
  secondSupplierSignal.structured.gate.independent_signal_count === 1,
  `got ${secondSupplierSignal.structured.gate.independent_signal_count}`,
);
check("gate still fails on supplier-only evidence", secondSupplierSignal.structured.gate.pass === false);

const nonSupplier = await call("ice_add_evidence", {
  subject_type: "product",
  subject_id: productId,
  source_name: "Google Trends",
  url: "https://trends.google.com/trends/explore?q=cable%20tray&geo=ZA",
  region: "ZA",
  period_covered: "90 days to 2026-08-17",
  signal_type: "search interest",
  summary: "Rising 90-day search interest in ZA",
  is_supplier_source: false,
  verification: "verified",
});
check("gate passes with 2 domains incl. a non-supplier one", nonSupplier.structured.gate.pass === true);

const badUrl = await call("ice_add_evidence", {
  subject_type: "product",
  subject_id: productId,
  source_name: "no link",
  url: "not-a-url",
  region: "ZA",
  period_covered: "n/a",
  signal_type: "hearsay",
  summary: "no source",
  is_supplier_source: false,
});
check("invalid URL is rejected with guidance", badUrl.isError === true && /valid absolute URL/.test(badUrl.text));

console.log("\n== Supplier gate ==");
const fakeVerified = await call("ice_upsert_supplier", {
  product_id: productId,
  name: "Shenzhen Example Co",
  url: "https://example-supplier.com/p/1",
  country: "CN",
  type: "manufacturer",
  verification_status: "verified",
  certifications_claimed: ["RoHS"],
});
check(
  "claiming 'verified' without evidence is refused",
  fakeVerified.isError === true && /requires at least one entry in verification_evidence/.test(fakeVerified.text),
);

const supplier1 = await call("ice_upsert_supplier", {
  product_id: productId,
  name: "Shenzhen Example Co",
  url: "https://example-supplier.com/p/1",
  country: "CN",
  type: "manufacturer",
  unit_price_min: 42,
  unit_price_max: 48,
  moq: 200,
  certifications_claimed: ["RoHS"],
  verification_status: "unverified",
});
check("supplier gate fails with one supplier", supplier1.structured.supplier_gate.pass === false);
check(
  "unverified certification claim is warned about",
  supplier1.structured.warnings.some((warning) => /CLAIMED/.test(warning)),
);

await call("ice_upsert_supplier", {
  product_id: productId,
  name: "Local Distributor SA",
  url: "https://example.co.za/cable-tray",
  country: "ZA",
  type: "local_distributor",
  unit_price_min: 70,
  moq: 50,
  is_backup: true,
  verification_status: "partially_verified",
  verification_evidence: ["CIPC registration checked 2026-08-17"],
});
const supplierGate = await call("ice_check_supplier_gate", { product_id: productId, response_format: "json" });
check("supplier gate passes with two options and a backup", supplierGate.structured.gate.pass === true);
check("preferred depth of 3 not yet met", supplierGate.structured.gate.meets_preferred_depth === false);
check(
  "unverified certification claims surfaced in gate",
  supplierGate.structured.gate.unverified_claiming_certifications.length === 1,
);

console.log("\n== Compliance gate ==");
const excluded = await call("ice_screen_compliance", {
  product_id: productId,
  flags: ["uncertified_electrical"],
  notes: "Contains no electronics; flag applied only to test the gate.",
  response_format: "json",
});
check("hard flag produces EXCLUDE", excluded.structured.verdict === "EXCLUDE");
check("EXCLUDE blocks launch eligibility", excluded.structured.launch_eligible === false);

const mitigated = await call("ice_screen_compliance", {
  product_id: productId,
  flags: ["uncertified_electrical"],
  mitigations: [{ flag: "uncertified_electrical", evidence: "Product is passive plastic; no electrical parts. Confirmed from sample 2026-08-17." }],
  notes: "Mitigation recorded.",
  response_format: "json",
});
check("mitigated hard flag downgrades to PENALISE", mitigated.structured.verdict === "PENALISE");
check("PENALISE remains launch eligible", mitigated.structured.launch_eligible === true);

const clean = await call("ice_screen_compliance", { product_id: productId, flags: [], notes: "No flags apply.", response_format: "json" });
check("no flags produces PASS", clean.structured.verdict === "PASS");

console.log("\n== Unit economics (hand-checked) ==");
const econ = await call("ice_calc_unit_economics", {
  product_id: productId,
  label: "base case",
  selling_price: 349,
  price_includes_vat: true,
  vat_rate: 0.15,
  vat_recoverable: true,
  product_cost: 45,
  freight_per_unit: 18,
  duty_rate: 0.15,
  packaging_per_unit: 8,
  receiving_per_unit: 2,
  payment_fee_pct: 0.029,
  payment_fee_fixed: 2,
  fulfilment_per_unit: 65,
  refund_rate: 0.05,
  return_shipping_cost: 55,
  salvage_rate: 0.3,
  defect_rate: 0.02,
  delivery_failure_rate: 0.02,
  support_allowance_per_unit: 5,
  required_profit_per_order: 40,
  response_format: "json",
});
const e = econ.structured;
check("net selling price = 349 / 1.15 = 303.48", near(e.net_selling_price, 303.48), `got ${e.net_selling_price}`);
check("landed cost = 63 + 9.45 + 8 + 2 = 82.45", near(e.landed_cost, 82.45), `got ${e.landed_cost}`);
check("payment fees = 0.029*349 + 2 = 12.12", near(e.payment_fees, 12.12), `got ${e.payment_fees}`);
check("expected refund cost = 16.69", near(e.expected_refund_cost, 16.69), `got ${e.expected_refund_cost}`);
check("expected defect cost = 2.95", near(e.expected_defect_cost, 2.95), `got ${e.expected_defect_cost}`);
check("pre-ad contribution = 112.60", near(e.pre_ad_contribution, 112.6, 0.05), `got ${e.pre_ad_contribution}`);
check("max break-even CAC equals pre-ad contribution", near(e.max_breakeven_cac, e.pre_ad_contribution));
check("target CAC = 112.60 - 40 = 72.60", near(e.target_cac, 72.6, 0.05), `got ${e.target_cac}`);
check("break-even ROAS = 303.48 / 112.60 = 2.70", near(e.breakeven_roas, 2.7, 0.02), `got ${e.breakeven_roas}`);
check("landed ratio 27.2% passes the 30% screen", e.screens.find((s) => s.name.startsWith("landed")).pass === true);
check("pre-ad margin 37.1% FAILS the 45% screen", e.screens.find((s) => s.name.startsWith("pre_ad")).pass === false);
check("screens_passed is false overall", e.screens_passed === false);
check("formula trace is included", Array.isArray(e.formula_trace) && e.formula_trace.length >= 6);

const negative = await call("ice_calc_unit_economics", {
  product_id: productId,
  label: "loss maker",
  selling_price: 100,
  product_cost: 120,
  response_format: "json",
});
check("negative contribution yields null break-even ROAS", negative.structured.breakeven_roas === null);
check(
  "negative contribution is called out in warnings",
  negative.structured.warnings.some((warning) => /loses money before/.test(warning)),
);

console.log("\n== Scenarios ==");
const scenarios = await call("ice_run_scenarios", { product_id: productId, label: "base case", response_format: "json" });
const base = scenarios.structured.scenarios.find((s) => s.name === "base");
const down = scenarios.structured.scenarios.find((s) => s.name === "downside");
const up = scenarios.structured.scenarios.find((s) => s.name === "upside");
check("base scenario matches the stored calculation", near(base.pre_ad_contribution, 112.6, 0.05));
check("downside contribution is lower than base", down.pre_ad_contribution < base.pre_ad_contribution);
check("upside contribution is higher than base", up.pre_ad_contribution > base.pre_ad_contribution);
check("downside verdict is reported", typeof scenarios.structured.verdict === "string" && scenarios.structured.verdict.length > 10);

console.log("\n== Launch readiness and portfolio ==");
const readiness = await call("ice_launch_readiness", { product_id: productId, response_format: "json" });
check("readiness reports the failing economics screen", readiness.structured.items[0].ready === false);
check(
  "blocking reason names unit economics",
  readiness.structured.items[0].blocking_reasons.some((reason) => /unit_economics/.test(reason)),
);

const cardRefused = await call("ice_export_launch_card", {
  product_id: productId,
  positioning: "x",
  target_customer: "y",
  core_promise: "z",
  offer_structure: "single unit",
  selling_price: 349,
  ad_hooks: ["a", "b", "c"],
  video_concepts: ["a", "b", "c"],
});
check("launch card refused while gates fail", cardRefused.isError === true && /acknowledge_not_ready/.test(cardRefused.text));

const cardDraft = await call("ice_export_launch_card", {
  product_id: productId,
  positioning: "Passive cable tray that clips under any desk",
  target_customer: "Remote workers",
  core_promise: "Cables gone in one clip",
  offer_structure: "Single unit with free delivery over R400",
  selling_price: 349,
  ad_hooks: ["Your desk looks messy on camera", "One clip, cables gone", "No screws, no drilling"],
  video_concepts: ["Before/after desk pan", "Clip-on in 8 seconds", "Video-call reveal"],
  acknowledge_not_ready: true,
});
check("draft launch card is written and marked NOT LAUNCH READY", /DRAFT — NOT LAUNCH READY/.test(cardDraft.structured.markdown));

const portfolio = await call("ice_select_portfolio", { response_format: "json" });
check("portfolio selects nothing for immediate test while gates fail", portfolio.structured.immediate_test.length === 0);
check(
  "portfolio explains the shortfall rather than padding",
  portfolio.structured.shortfall_notes.some((note) => /clear every launch gate/.test(note)),
);

console.log("\n== Report export ==");
const report = await call("ice_export_report", { response_format: "json" });
check("report written to disk", typeof report.structured.file_path === "string" && report.structured.file_path.endsWith(".md"));
check("report flags unresearched sections", Array.isArray(report.structured.missing_sections));
check("report includes the shortlist section", report.structured.sections.includes("shortlist"));
check("report warns about unverified suppliers", /not independently verified/.test(report.structured.markdown));

console.log("\n== Persistence ==");
const stats = await call("ice_ledger_stats", { response_format: "json" });
check("ledger persisted the records", stats.structured.counts.products === 1 && stats.structured.counts.suppliers === 2);
check("evidence persisted", stats.structured.counts.evidence === 3);

console.log("\n== Cascade delete ==");
const deleted = await call("ice_delete_record", { record_type: "product", id: productId, confirm: true });
check("cascade removed dependent records", deleted.structured.cascaded.evidence === 3 && deleted.structured.cascaded.suppliers === 2);
const statsAfter = await call("ice_ledger_stats", { response_format: "json" });
check("ledger is clean after delete", statsAfter.structured.counts.products === 0 && statsAfter.structured.counts.evidence === 0);

await client.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
