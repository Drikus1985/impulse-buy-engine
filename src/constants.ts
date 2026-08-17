/**
 * Shared constants: scoring rubrics, screening thresholds, exclusion gate definitions.
 *
 * All weights are taken from the Global Impulse-Commerce Opportunity Engine brief.
 * They are exposed through `ice_get_rubrics` so an agent never has to guess them.
 */

export const SERVER_NAME = "impulse-commerce-mcp-server";
export const SERVER_VERSION = "1.0.0";

/** Maximum characters returned in a single tool response before truncation kicks in. */
export const CHARACTER_LIMIT = 25000;

/** Default currency for stored monetary values. No FX conversion is ever performed. */
export const DEFAULT_CURRENCY = "ZAR";

/** Phase A: market comparison criteria. Every criterion is rated 0-10, higher = more favourable. */
export const MARKET_CRITERIA = [
  "ecommerce_and_social_commerce_demand",
  "consumer_purchasing_power",
  "payment_method_availability",
  "customer_acquisition_conditions",
  "marketplace_accessibility",
  "delivery_speed_and_cost",
  "low_customs_and_import_friction",
  "low_returns_complexity",
  "low_regulatory_burden",
  "low_localisation_requirement",
  "low_competitive_intensity",
  "short_path_to_first_revenue",
] as const;
export type MarketCriterion = (typeof MARKET_CRITERIA)[number];

/** Phase B: 100-point category score. Keys are rated 0-10; score = sum(rating/10 * weight). */
export const CATEGORY_WEIGHTS: Record<string, number> = {
  current_trend_momentum: 15,
  impulse_purchase_suitability: 15,
  demonstrability_in_short_form: 10,
  unit_economics_potential: 20,
  shipping_and_fulfilment_simplicity: 10,
  automation_suitability: 10,
  differentiation_opportunity: 10,
  low_regulatory_and_liability_risk: 10,
};
export const CATEGORY_FACTORS = Object.keys(CATEGORY_WEIGHTS) as (keyof typeof CATEGORY_WEIGHTS)[];

/** Phase C: 100-point product score. Keys are rated 0-10; score = sum(rating/10 * weight). */
export const PRODUCT_WEIGHTS: Record<string, number> = {
  demand_evidence: 15,
  impulse_trigger_strength: 12,
  visual_demonstration_potential: 8,
  unit_economics: 18,
  customer_acquisition_potential: 10,
  shipping_simplicity: 10,
  low_return_risk: 7,
  supply_reliability: 7,
  differentiation_opportunity: 8,
  low_legal_safety_ip_risk: 5,
};
export const PRODUCT_FACTORS = Object.keys(PRODUCT_WEIGHTS) as (keyof typeof PRODUCT_WEIGHTS)[];

/** Products at or above this score are launch candidates; below it they are watch-list only. */
export const LAUNCH_SCORE_THRESHOLD = 70;

/** Adjustable screening assumptions from the brief (section 7). */
export const ECONOMICS_THRESHOLDS = {
  max_landed_cost_ratio: 0.3,
  min_pre_ad_contribution_margin: 0.45,
  min_post_ad_contribution_margin: 0.15,
};

/** Evidence gates (section 3). Independence is measured by distinct source domain. */
export const EVIDENCE_GATES = {
  category_min_independent_signals: 3,
  product_min_independent_signals: 2,
  product_min_non_supplier_signals: 1,
};

/** Supplier gate (section 6, Phase D). */
export const SUPPLIER_GATES = {
  min_supply_options: 3,
  min_supply_options_hard_floor: 2,
};

/**
 * Section 5 exclusion gate.
 * HARD flags exclude a product from launch recommendations unless a matching
 * mitigation is recorded as actually verified.
 * SOFT flags do not exclude but cap the compliance verdict at PENALISE.
 */
export const HARD_EXCLUSION_FLAGS = [
  "counterfeit_goods",
  "ip_infringement_risk",
  "unsupported_medical_or_weight_loss_claims",
  "high_risk_supplement_or_ingestible",
  "weapon_or_weaponisable",
  "unsafe_children_or_baby_product",
  "uncertified_electrical",
  "hazardous_chemical_or_dangerous_good",
  "prohibited_on_target_marketplace",
] as const;

export const SOFT_EXCLUSION_FLAGS = [
  "battery_liquid_or_aerosol_shipping",
  "high_breakage_rate",
  "sizing_or_fit_return_risk",
  "product_liability_exposure",
  "cold_chain_requirement",
  "high_fraud_or_chargeback_exposure",
  "supplier_media_without_usage_rights",
  "additional_certification_required",
] as const;

export const ALL_EXCLUSION_FLAGS = [...HARD_EXCLUSION_FLAGS, ...SOFT_EXCLUSION_FLAGS] as const;
export type ExclusionFlag = (typeof ALL_EXCLUSION_FLAGS)[number];

/** Default scenario multipliers used by ice_run_scenarios when the caller supplies none. */
export const SCENARIO_DEFAULTS = {
  downside: {
    selling_price: 0.9,
    product_cost: 1.15,
    freight: 1.25,
    cac: 1.4,
    refund_rate: 1.75,
    defect_rate: 2,
    delivery_failure_rate: 2,
    fx: 1.12,
  },
  upside: {
    selling_price: 1.1,
    product_cost: 0.9,
    freight: 0.85,
    cac: 0.75,
    refund_rate: 0.6,
    defect_rate: 0.5,
    delivery_failure_rate: 0.5,
    fx: 0.95,
  },
};

/** Section 6 (Phase D) sample-order and due-diligence checklist items. */
export const DUE_DILIGENCE_ITEMS = [
  "business_registration_validated",
  "references_and_marketplace_history_checked",
  "product_sample_ordered",
  "product_sample_received_and_inspected",
  "material_and_safety_documentation_obtained",
  "required_laboratory_tests_identified",
  "required_laboratory_tests_completed",
  "packaging_and_barcode_requirements_confirmed",
  "quality_control_inspection_arranged",
  "intellectual_property_checks_completed",
  "pre_shipment_inspection_booked",
  "defect_allowance_agreed",
  "refund_or_replacement_terms_agreed",
  "freight_quotation_obtained",
  "duty_and_tax_confirmed",
  "commercial_invoice_requirements_confirmed",
] as const;
export type DueDiligenceItem = (typeof DUE_DILIGENCE_ITEMS)[number];
