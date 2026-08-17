#!/usr/bin/env node
/**
 * Builds the fixed evaluation ledger used by evaluation.xml.
 *
 * Everything here is SYNTHETIC. The URLs are illustrative and the figures are
 * invented for testing; none of it is market research and none of it should be
 * treated as evidence about any real product or supplier.
 *
 * Run: node test/seed-eval-ledger.mjs
 * Output: test/fixtures/eval-ledger/database.json
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const DATA_DIR = join(here, "fixtures", "eval-ledger");
rmSync(DATA_DIR, { recursive: true, force: true });

const transport = new StdioClientTransport({
  command: "node",
  args: [join(root, "dist/index.js")],
  env: { ...process.env, ICE_DATA_DIR: DATA_DIR },
});
const client = new Client({ name: "seed", version: "1.0.0" });
await client.connect(transport);

async function call(name, args) {
  const result = await client.callTool({ name, arguments: { ...args, ...(args.response_format ? {} : {}) } });
  if (result.isError) throw new Error(`${name} failed: ${result.content?.[0]?.text}`);
  return result.structuredContent;
}

// --- Markets ---------------------------------------------------------------
await call("ice_upsert_market", {
  name: "South Africa", country_code: "ZA", role: "beachhead", confidence: "Likely",
  ecommerce_and_social_commerce_demand: 7, consumer_purchasing_power: 5, payment_method_availability: 8,
  customer_acquisition_conditions: 7, marketplace_accessibility: 8, delivery_speed_and_cost: 6,
  low_customs_and_import_friction: 4, low_returns_complexity: 6, low_regulatory_burden: 6,
  low_localisation_requirement: 9, low_competitive_intensity: 6, short_path_to_first_revenue: 8,
  sourcing_recommendation: "Import in small batches, hold local stock",
});
await call("ice_upsert_market", {
  name: "United Kingdom", country_code: "GB", role: "secondary", confidence: "Guessing",
  ecommerce_and_social_commerce_demand: 9, consumer_purchasing_power: 9, payment_method_availability: 9,
  customer_acquisition_conditions: 4, marketplace_accessibility: 9, delivery_speed_and_cost: 8,
  low_customs_and_import_friction: 6, low_returns_complexity: 4, low_regulatory_burden: 5,
  low_localisation_requirement: 10, low_competitive_intensity: 2, short_path_to_first_revenue: 6,
});
await call("ice_upsert_market", {
  name: "Nigeria", country_code: "NG", role: "postponed", confidence: "Guessing",
  ecommerce_and_social_commerce_demand: 7, consumer_purchasing_power: 3, payment_method_availability: 4,
  customer_acquisition_conditions: 6, marketplace_accessibility: 5, delivery_speed_and_cost: 3,
  low_customs_and_import_friction: 2, low_returns_complexity: 4, low_regulatory_burden: 4,
  low_localisation_requirement: 8, low_competitive_intensity: 7, short_path_to_first_revenue: 4,
});

// --- Categories ------------------------------------------------------------
const desk = (await call("ice_upsert_category", {
  name: "Desk cable management", primary_need: "Remove visible clutter from a home desk",
  trend_direction: "rising", competitive_intensity: "moderate", confidence: "Likely",
  typical_price_min: 199, typical_price_max: 499,
  current_trend_momentum: 8, impulse_purchase_suitability: 9, demonstrability_in_short_form: 10,
  unit_economics_potential: 7, shipping_and_fulfilment_simplicity: 9, automation_suitability: 8,
  differentiation_opportunity: 6, low_regulatory_and_liability_risk: 9,
})).category.id;

const pet = (await call("ice_upsert_category", {
  name: "Pet grooming and hair control", primary_need: "Control shedding without a grooming appointment",
  trend_direction: "stable", competitive_intensity: "high", confidence: "Guessing",
  typical_price_min: 149, typical_price_max: 399,
  current_trend_momentum: 6, impulse_purchase_suitability: 8, demonstrability_in_short_form: 9,
  unit_economics_potential: 5, shipping_and_fulfilment_simplicity: 8, automation_suitability: 7,
  differentiation_opportunity: 4, low_regulatory_and_liability_risk: 8,
})).category.id;

const car = (await call("ice_upsert_category", {
  name: "Car interior comfort", primary_need: "Make a daily commute feel less irritating",
  trend_direction: "rising", competitive_intensity: "high", confidence: "Likely",
  typical_price_min: 179, typical_price_max: 449,
  current_trend_momentum: 7, impulse_purchase_suitability: 8, demonstrability_in_short_form: 8,
  unit_economics_potential: 6, shipping_and_fulfilment_simplicity: 7, automation_suitability: 8,
  differentiation_opportunity: 5, low_regulatory_and_liability_risk: 6,
})).category.id;

const evidence = (subject_type, subject_id, source_name, url, region, period, signal_type, summary, supplier, verification) =>
  call("ice_add_evidence", {
    subject_type, subject_id, source_name, url, region, period_covered: period,
    signal_type, summary, is_supplier_source: supplier, verification,
  });

await evidence("category", desk, "Google Trends", "https://trends.google.com/trends/explore?q=cable+management&geo=ZA", "ZA", "90 days to 2026-08-01", "search interest", "Rising search interest", false, "verified");
await evidence("category", desk, "Reddit r/battlestations", "https://www.reddit.com/r/battlestations/comments/example", "Global", "12 months to 2026-08-01", "community discussion", "Recurring cable-hiding threads", false, "estimated");
await evidence("category", desk, "Amazon Best Sellers", "https://www.amazon.com/best-sellers-cable-management", "US", "30 days to 2026-08-01", "bestseller rank", "Several entries in the top 100", false, "estimated");

await evidence("category", pet, "Google Trends", "https://trends.google.com/trends/explore?q=deshedding+glove&geo=ZA", "ZA", "12 months to 2026-08-01", "search interest", "Flat search interest", false, "verified");
await evidence("category", pet, "Reddit r/dogs", "https://www.reddit.com/r/dogs/comments/example", "Global", "12 months to 2026-08-01", "community discussion", "Frequent shedding complaints", false, "estimated");

await evidence("category", car, "Google Trends", "https://trends.google.com/trends/explore?q=car+ambient+light&geo=ZA", "ZA", "90 days to 2026-08-01", "search interest", "Rising interest", false, "verified");
await evidence("category", car, "TikTok Creative Center", "https://ads.tiktok.com/business/creativecenter/example", "Global", "30 days to 2026-08-01", "hashtag volume", "High view volume on car-interior tags", false, "estimated");
await evidence("category", car, "eBay", "https://www.ebay.com/sch/car-interior-lighting", "GB", "90 days to 2026-08-01", "listing volume", "Large active listing count", false, "estimated");

// --- Products --------------------------------------------------------------
const product = (args) => call("ice_upsert_product", args);

const tray = (await product({
  name: "magnetic under-desk cable tray", category_id: desk, buyer: "Remote workers with a home desk",
  trigger: "visual clutter irritation", purchase_moment: "After a video call where the desk looked messy",
  problem_solved: "Cables hang visibly under the desk", five_second_hook: "Clip it once, cables gone",
  trend_status: "rising", saturation: "moderate", return_risk: "low", confidence: "Likely",
  selling_price_min: 399, selling_price_max: 499, product_cost_min: 50, product_cost_max: 60,
  demand_evidence: 8, impulse_trigger_strength: 9, visual_demonstration_potential: 10, unit_economics: 8,
  customer_acquisition_potential: 8, shipping_simplicity: 9, low_return_risk: 9, supply_reliability: 8,
  differentiation_opportunity: 7, low_legal_safety_ip_risk: 9,
})).product.id;

const sleeve = (await product({
  name: "braided cable sleeve wrap", category_id: desk, buyer: "Home office workers",
  trigger: "visual clutter irritation", purchase_moment: "While tidying a desk",
  problem_solved: "Loose cables tangle", five_second_hook: "Ten cables, one sleeve",
  trend_status: "stable", saturation: "high", return_risk: "low", confidence: "Guessing",
  demand_evidence: 5, impulse_trigger_strength: 7, visual_demonstration_potential: 8, unit_economics: 7,
  customer_acquisition_potential: 6, shipping_simplicity: 10, low_return_risk: 9, supply_reliability: 7,
  differentiation_opportunity: 3, low_legal_safety_ip_risk: 9,
})).product.id;

const glove = (await product({
  name: "silicone pet deshedding glove", category_id: pet, buyer: "Owners of double-coated dogs",
  trigger: "hair on furniture frustration", purchase_moment: "After vacuuming pet hair off a couch",
  problem_solved: "Loose pet hair spreads through the house", five_second_hook: "One stroke, a handful of hair",
  trend_status: "stable", saturation: "high", return_risk: "moderate", confidence: "Likely",
  demand_evidence: 7, impulse_trigger_strength: 8, visual_demonstration_potential: 10, unit_economics: 4,
  customer_acquisition_potential: 7, shipping_simplicity: 9, low_return_risk: 6, supply_reliability: 7,
  differentiation_opportunity: 3, low_legal_safety_ip_risk: 9,
})).product.id;

const roller = (await product({
  name: "reusable pet hair roller", category_id: pet, buyer: "Cat owners in small flats",
  trigger: "hair on clothing embarrassment", purchase_moment: "Before leaving the house in dark clothing",
  problem_solved: "Pet hair on clothes", five_second_hook: "No refills, ever",
  trend_status: "declining", saturation: "high", return_risk: "moderate", confidence: "Guessing",
  demand_evidence: 4, impulse_trigger_strength: 6, visual_demonstration_potential: 7, unit_economics: 4,
  customer_acquisition_potential: 5, shipping_simplicity: 9, low_return_risk: 6, supply_reliability: 6,
  differentiation_opportunity: 3, low_legal_safety_ip_risk: 8,
})).product.id;

const lights = (await product({
  name: "car footwell ambient light strip", category_id: car, buyer: "Younger commuters personalising a car",
  trigger: "identity and self-expression", purchase_moment: "After seeing a lit interior in a short video",
  problem_solved: "Car interior feels plain at night", five_second_hook: "Your cabin, any colour",
  trend_status: "rising", saturation: "high", return_risk: "moderate", confidence: "Likely",
  demand_evidence: 8, impulse_trigger_strength: 9, visual_demonstration_potential: 10, unit_economics: 6,
  customer_acquisition_potential: 8, shipping_simplicity: 7, low_return_risk: 5, supply_reliability: 6,
  differentiation_opportunity: 4, low_legal_safety_ip_risk: 2,
})).product.id;

const mount = (await product({
  name: "magnetic car vent phone mount", category_id: car, buyer: "Commuters who navigate while driving",
  trigger: "safety and reassurance", purchase_moment: "After fumbling with a phone in traffic",
  problem_solved: "No safe place to see navigation", five_second_hook: "Snap it on, eyes stay up",
  trend_status: "stable", saturation: "moderate", return_risk: "low", confidence: "Likely",
  selling_price_min: 249, selling_price_max: 349, product_cost_min: 35, product_cost_max: 45,
  demand_evidence: 8, impulse_trigger_strength: 8, visual_demonstration_potential: 8, unit_economics: 8,
  customer_acquisition_potential: 8, shipping_simplicity: 10, low_return_risk: 9, supply_reliability: 8,
  differentiation_opportunity: 6, low_legal_safety_ip_risk: 9,
})).product.id;

const box = (await product({
  name: "bamboo desk cable box", category_id: desk, buyer: "Home office workers who dislike plastic",
  trigger: "aesthetic upgrade desire", purchase_moment: "While redecorating a workspace",
  problem_solved: "Plug strips look ugly on a desk", five_second_hook: "Hide the mess in something you would display",
  trend_status: "rising", saturation: "moderate", return_risk: "low", confidence: "Likely",
  demand_evidence: 7, impulse_trigger_strength: 8, visual_demonstration_potential: 9, unit_economics: 7,
  customer_acquisition_potential: 7, shipping_simplicity: 6, low_return_risk: 8, supply_reliability: 6,
  differentiation_opportunity: 8, low_legal_safety_ip_risk: 8,
})).product.id;

// Product evidence
await evidence("product", tray, "Google Trends", "https://trends.google.com/trends/explore?q=under+desk+cable+tray&geo=ZA", "ZA", "90 days to 2026-08-01", "search interest", "Steady rise", false, "verified");
await evidence("product", tray, "Supplier listing", "https://www.alibaba.com/product-detail/example-tray.html", "CN", "12 months to 2026-08-01", "supplier order count", "High listed order volume", true, "estimated");
await evidence("product", sleeve, "Supplier listing", "https://www.alibaba.com/product-detail/example-sleeve.html", "CN", "12 months to 2026-08-01", "supplier order count", "High listed order volume", true, "estimated");
await evidence("product", glove, "Amazon reviews", "https://www.amazon.com/dp/exampleglove", "US", "12 months to 2026-08-01", "review velocity", "Consistent review flow", false, "estimated");
await evidence("product", glove, "Reddit r/dogs", "https://www.reddit.com/r/dogs/comments/exampleglove", "Global", "12 months to 2026-08-01", "community discussion", "Mixed but frequent mentions", false, "estimated");
await evidence("product", roller, "Amazon reviews", "https://www.amazon.com/dp/exampleroller", "US", "12 months to 2026-08-01", "review velocity", "Slowing review flow", false, "estimated");
await evidence("product", lights, "TikTok Creative Center", "https://ads.tiktok.com/business/creativecenter/example-lights", "Global", "30 days to 2026-08-01", "hashtag volume", "Very high view volume", false, "estimated");
await evidence("product", lights, "Meta Ad Library", "https://www.facebook.com/ads/library/example-lights", "GB", "90 days to 2026-08-01", "ad longevity", "Long-running ads with repeated creative", false, "estimated");
await evidence("product", mount, "Google Trends", "https://trends.google.com/trends/explore?q=car+vent+phone+mount&geo=ZA", "ZA", "12 months to 2026-08-01", "search interest", "Stable year-round interest", false, "verified");
await evidence("product", mount, "Amazon Movers and Shakers", "https://www.amazon.com/gp/movers-and-shakers/example-mount", "US", "30 days to 2026-08-01", "rank movement", "Repeated appearances", false, "estimated");
await evidence("product", box, "Pinterest Trends", "https://trends.pinterest.com/example-cable-box", "GB", "12 months to 2026-08-01", "visual search interest", "Rising saves", false, "estimated");
await evidence("product", box, "Etsy", "https://www.etsy.com/search?q=bamboo+cable+box", "US", "90 days to 2026-08-01", "listing and favourite counts", "Many active listings", false, "estimated");

// --- Suppliers -------------------------------------------------------------
const supplier = (args) => call("ice_upsert_supplier", args);

await supplier({ product_id: tray, name: "Ningbo Deskline Manufacturing", url: "https://www.alibaba.com/company/example-deskline", country: "CN", type: "manufacturer", unit_price_min: 48, unit_price_max: 55, moq: 200, sample_available: true, sample_cost: 180, production_days: 15, incoterms: ["FOB", "DDP"], estimated_delivery_days: 32, certifications_claimed: ["ISO 9001"], verification_status: "unverified", verification_outstanding: ["Business registration", "Factory audit"] });
await supplier({ product_id: tray, name: "Gauteng Office Supplies", url: "https://example.co.za/office-cable-tray", country: "ZA", type: "local_distributor", unit_price_min: 89, moq: 24, sample_available: true, sample_cost: 95, estimated_delivery_days: 4, is_backup: true, verification_status: "partially_verified", verification_evidence: ["CIPC registration 2018/456789/07 confirmed 2026-08-01"] });
await supplier({ product_id: tray, name: "Shenzhen Cableworks Trading", url: "https://www.globalsources.com/example-cableworks", country: "CN", type: "trader", unit_price_min: 45, unit_price_max: 52, moq: 500, production_days: 12, estimated_delivery_days: 30, verification_status: "unverified" });

await supplier({ product_id: mount, name: "Dongguan MagMount Factory", url: "https://www.alibaba.com/company/example-magmount", country: "CN", type: "manufacturer", unit_price_min: 38, unit_price_max: 44, moq: 300, sample_available: true, sample_cost: 120, production_days: 10, incoterms: ["FOB"], estimated_delivery_days: 28, certifications_claimed: ["RoHS", "CE"], verification_status: "unverified", verification_outstanding: ["CE certificate authenticity"] });
await supplier({ product_id: mount, name: "Cape Auto Accessories", url: "https://example.co.za/vent-mount", country: "ZA", type: "local_distributor", unit_price_min: 72, moq: 50, estimated_delivery_days: 5, is_backup: true, verification_status: "partially_verified", verification_evidence: ["Company registration checked 2026-08-01"] });

await supplier({ product_id: glove, name: "Yiwu PetCare Wholesale", url: "https://www.alibaba.com/company/example-petcare", country: "CN", type: "wholesaler", unit_price_min: 22, unit_price_max: 28, moq: 500, estimated_delivery_days: 30, verification_status: "unverified" });

await supplier({ product_id: box, name: "Fujian Bamboo Crafts", url: "https://www.alibaba.com/company/example-bamboo", country: "CN", type: "manufacturer", unit_price_min: 95, unit_price_max: 115, moq: 300, production_days: 25, estimated_delivery_days: 45, verification_status: "unverified" });

await supplier({ product_id: lights, name: "Shenzhen Autoglow Electronics", url: "https://www.alibaba.com/company/example-autoglow", country: "CN", type: "manufacturer", unit_price_min: 65, unit_price_max: 80, moq: 200, estimated_delivery_days: 30, certifications_claimed: ["CE"], verification_status: "unverified" });
await supplier({ product_id: lights, name: "JHB Car Audio Imports", url: "https://example.co.za/ambient-lighting", country: "ZA", type: "importer", unit_price_min: 140, moq: 20, estimated_delivery_days: 3, is_backup: true, verification_status: "unverified" });

// --- Compliance ------------------------------------------------------------
await call("ice_screen_compliance", { product_id: tray, flags: [], notes: "Passive plastic and magnet assembly. No electrical, no ingestible, no IP overlap found on a design-register search." });
await call("ice_screen_compliance", { product_id: mount, flags: [], notes: "Passive magnet mount. Design register searched, no conflict found." });
await call("ice_screen_compliance", { product_id: glove, flags: ["sizing_or_fit_return_risk"], notes: "One-size glove; fit complaints likely." });
await call("ice_screen_compliance", { product_id: lights, flags: ["uncertified_electrical", "battery_liquid_or_aerosol_shipping"], notes: "12V wired product with no verified certification. Cannot be a quick-start recommendation." });
await call("ice_screen_compliance", { product_id: box, flags: ["additional_certification_required"], notes: "Houses a plug strip; may attract electrical-adjacent scrutiny." });
await call("ice_screen_compliance", { product_id: sleeve, flags: [], notes: "Passive textile sleeve." });
await call("ice_screen_compliance", { product_id: roller, flags: [], notes: "Passive plastic roller." });

// --- Unit economics --------------------------------------------------------
const econ = (args) => call("ice_calc_unit_economics", args);

await econ({ product_id: tray, label: "base case", selling_price: 449, product_cost: 55, freight_per_unit: 12, packaging_per_unit: 6, receiving_per_unit: 2, payment_fee_pct: 0.029, payment_fee_fixed: 2, fulfilment_per_unit: 60, refund_rate: 0.03, return_shipping_cost: 50, salvage_rate: 0.3, defect_rate: 0.01, delivery_failure_rate: 0.01, support_allowance_per_unit: 4, required_profit_per_order: 50 });
await econ({ product_id: mount, label: "base case", selling_price: 299, product_cost: 42, freight_per_unit: 9, packaging_per_unit: 5, receiving_per_unit: 2, payment_fee_pct: 0.029, payment_fee_fixed: 2, fulfilment_per_unit: 55, refund_rate: 0.04, return_shipping_cost: 45, salvage_rate: 0.3, defect_rate: 0.02, delivery_failure_rate: 0.01, support_allowance_per_unit: 4, required_profit_per_order: 40 });
await econ({ product_id: glove, label: "base case", selling_price: 199, product_cost: 26, freight_per_unit: 8, duty_rate: 0.2, packaging_per_unit: 5, receiving_per_unit: 2, payment_fee_pct: 0.029, payment_fee_fixed: 2, fulfilment_per_unit: 60, refund_rate: 0.08, return_shipping_cost: 45, salvage_rate: 0.2, defect_rate: 0.03, delivery_failure_rate: 0.02, support_allowance_per_unit: 6, required_profit_per_order: 30 });
await econ({ product_id: box, label: "base case", selling_price: 549, product_cost: 105, freight_per_unit: 45, duty_rate: 0.15, packaging_per_unit: 12, receiving_per_unit: 4, payment_fee_pct: 0.029, payment_fee_fixed: 2, fulfilment_per_unit: 85, refund_rate: 0.05, return_shipping_cost: 90, salvage_rate: 0.3, defect_rate: 0.03, delivery_failure_rate: 0.01, support_allowance_per_unit: 6, required_profit_per_order: 60 });
await econ({ product_id: sleeve, label: "base case", selling_price: 149, product_cost: 18, freight_per_unit: 5, packaging_per_unit: 4, receiving_per_unit: 1, payment_fee_pct: 0.029, payment_fee_fixed: 2, fulfilment_per_unit: 55, refund_rate: 0.03, return_shipping_cost: 40, salvage_rate: 0.2, defect_rate: 0.01, delivery_failure_rate: 0.01, support_allowance_per_unit: 4, required_profit_per_order: 20 });
await econ({ product_id: lights, label: "base case", selling_price: 349, product_cost: 72, freight_per_unit: 15, duty_rate: 0.15, packaging_per_unit: 6, receiving_per_unit: 2, payment_fee_pct: 0.029, payment_fee_fixed: 2, fulfilment_per_unit: 60, refund_rate: 0.09, return_shipping_cost: 55, salvage_rate: 0.2, defect_rate: 0.05, delivery_failure_rate: 0.02, support_allowance_per_unit: 8, required_profit_per_order: 40 });

await call("ice_select_portfolio", {});

console.error(`Seeded evaluation ledger at ${DATA_DIR}`);
await client.close();
