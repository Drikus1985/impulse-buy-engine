/**
 * Unit economics engine.
 *
 * Implements the formulas from section 7 of the brief and shows its working,
 * because a margin percentage without arithmetic behind it is worthless.
 *
 * Core identities
 * ---------------
 *   landed cost      = (product cost + freight) x fx_shock
 *                      + duty + non-recoverable import tax
 *                      + packaging + inspection + receiving
 *
 *   net selling price = selling price excluding recoverable sales tax
 *
 *   pre-ad contribution = net selling price
 *                       - landed cost
 *                       - payment fees
 *                       - fulfilment
 *                       - expected refund/return cost
 *                       - expected defect cost
 *                       - expected delivery-failure cost
 *                       - support allowance
 *
 *   max break-even CAC = pre-ad contribution
 *   target CAC         = max break-even CAC - required profit per order
 *   break-even ROAS    = net selling price / max break-even CAC
 *
 * Loss modelling (stated explicitly so nothing is double counted):
 *   Landed cost, payment fees and fulfilment are charged on every order placed.
 *   A refunded order additionally loses the net revenue and the return leg, and
 *   recovers `salvage_rate` of landed cost, so its incremental cost is
 *      refund_rate x (net price - landed x salvage + return shipping).
 *   A defect costs a replacement unit plus its outbound fulfilment:
 *      defect_rate x (landed + fulfilment).
 *   A failed delivery is modelled as a refund with the goods written off unless
 *   salvage applies:
 *      delivery_failure_rate x (net price - landed x salvage + return shipping).
 */

import { ECONOMICS_THRESHOLDS } from "./constants.js";
import { round } from "./format.js";
import { EconomicsInputs, EconomicsResult } from "./types.js";

export interface EconomicsThresholds {
  max_landed_cost_ratio: number;
  min_pre_ad_contribution_margin: number;
  min_post_ad_contribution_margin: number;
}

export function computeEconomics(
  inputs: EconomicsInputs,
  thresholds: EconomicsThresholds = ECONOMICS_THRESHOLDS,
): EconomicsResult {
  const warnings: string[] = [];
  const trace: string[] = [];

  const importCosts = (inputs.product_cost + inputs.freight_per_unit) * inputs.fx_shock;
  const duty = inputs.duty_per_unit + inputs.duty_rate * importCosts;
  const landed =
    importCosts +
    duty +
    inputs.non_recoverable_import_tax_per_unit +
    inputs.packaging_per_unit +
    inputs.inspection_per_unit +
    inputs.receiving_per_unit;

  trace.push(
    `import costs = (product ${inputs.product_cost} + freight ${inputs.freight_per_unit}) x fx ${inputs.fx_shock} = ${round(importCosts)}`,
  );
  trace.push(
    `duty = fixed ${inputs.duty_per_unit} + ${inputs.duty_rate} x ${round(importCosts)} = ${round(duty)}`,
  );
  trace.push(
    `landed = ${round(importCosts)} + duty ${round(duty)} + import tax ${inputs.non_recoverable_import_tax_per_unit} + packaging ${inputs.packaging_per_unit} + inspection ${inputs.inspection_per_unit} + receiving ${inputs.receiving_per_unit} = ${round(landed)}`,
  );

  const netPrice =
    inputs.price_includes_vat && inputs.vat_recoverable
      ? inputs.selling_price / (1 + inputs.vat_rate)
      : inputs.selling_price;
  trace.push(
    inputs.price_includes_vat && inputs.vat_recoverable
      ? `net price = ${inputs.selling_price} / (1 + ${inputs.vat_rate}) = ${round(netPrice)}`
      : `net price = ${round(netPrice)} (no recoverable sales tax removed)`,
  );
  if (!inputs.vat_recoverable && inputs.price_includes_vat) {
    warnings.push(
      "vat_recoverable=false: the full selling price is treated as revenue. Only correct if the business is not VAT-registered and charges no VAT.",
    );
  }

  const paymentFees = inputs.payment_fee_pct * inputs.selling_price + inputs.payment_fee_fixed;
  trace.push(
    `payment fees = ${inputs.payment_fee_pct} x gross ${inputs.selling_price} + ${inputs.payment_fee_fixed} = ${round(paymentFees)}`,
  );

  const refundCost = inputs.refund_rate * (netPrice - landed * inputs.salvage_rate + inputs.return_shipping_cost);
  const defectCost = inputs.defect_rate * (landed + inputs.fulfilment_per_unit);
  const deliveryFailureCost =
    inputs.delivery_failure_rate * (netPrice - landed * inputs.salvage_rate + inputs.return_shipping_cost);

  trace.push(
    `expected refund cost = ${inputs.refund_rate} x (${round(netPrice)} - ${round(landed)} x ${inputs.salvage_rate} + ${inputs.return_shipping_cost}) = ${round(refundCost)}`,
  );
  trace.push(
    `expected defect cost = ${inputs.defect_rate} x (${round(landed)} + ${inputs.fulfilment_per_unit}) = ${round(defectCost)}`,
  );
  trace.push(
    `expected delivery-failure cost = ${inputs.delivery_failure_rate} x (${round(netPrice)} - ${round(landed)} x ${inputs.salvage_rate} + ${inputs.return_shipping_cost}) = ${round(deliveryFailureCost)}`,
  );

  const preAd =
    netPrice -
    landed -
    paymentFees -
    inputs.fulfilment_per_unit -
    refundCost -
    defectCost -
    deliveryFailureCost -
    inputs.support_allowance_per_unit;

  trace.push(
    `pre-ad contribution = ${round(netPrice)} - ${round(landed)} - ${round(paymentFees)} - ${inputs.fulfilment_per_unit} - ${round(refundCost)} - ${round(defectCost)} - ${round(deliveryFailureCost)} - ${inputs.support_allowance_per_unit} = ${round(preAd)}`,
  );

  const preAdMargin = netPrice > 0 ? preAd / netPrice : 0;
  const landedRatio = netPrice > 0 ? landed / netPrice : Infinity;
  const maxBreakevenCac = preAd;
  const targetCac = preAd - inputs.required_profit_per_order;
  const breakevenRoas = maxBreakevenCac > 0 ? netPrice / maxBreakevenCac : null;

  if (maxBreakevenCac <= 0) {
    warnings.push(
      "Pre-ad contribution is zero or negative: this product loses money before a single cent of advertising. Break-even ROAS is undefined. Re-price, re-source, or drop it.",
    );
  }
  if (targetCac <= 0 && maxBreakevenCac > 0) {
    warnings.push(
      `Target CAC is ${round(targetCac)}: the required profit per order (${inputs.required_profit_per_order}) consumes the entire contribution. Any paid acquisition at all makes this unprofitable.`,
    );
  }

  const postAd = inputs.actual_cac === null ? null : preAd - inputs.actual_cac;
  const postAdMargin = postAd === null || netPrice <= 0 ? null : postAd / netPrice;

  if (breakevenRoas !== null) {
    trace.push(`break-even ROAS = ${round(netPrice)} / ${round(maxBreakevenCac)} = ${round(breakevenRoas)}`);
  }
  if (postAd !== null) {
    trace.push(`post-ad contribution = ${round(preAd)} - CAC ${inputs.actual_cac} = ${round(postAd)}`);
  }

  const screens: EconomicsResult["screens"] = [
    {
      name: "landed_cost_ratio_at_or_below_threshold",
      threshold: thresholds.max_landed_cost_ratio,
      actual: round(landedRatio, 4),
      pass: landedRatio <= thresholds.max_landed_cost_ratio,
    },
    {
      name: "pre_ad_contribution_margin_at_or_above_threshold",
      threshold: thresholds.min_pre_ad_contribution_margin,
      actual: round(preAdMargin, 4),
      pass: preAdMargin >= thresholds.min_pre_ad_contribution_margin,
    },
  ];
  if (postAdMargin !== null) {
    screens.push({
      name: "post_ad_contribution_margin_at_or_above_threshold",
      threshold: thresholds.min_post_ad_contribution_margin,
      actual: round(postAdMargin, 4),
      pass: postAdMargin >= thresholds.min_post_ad_contribution_margin,
    });
  } else {
    warnings.push(
      "No actual_cac supplied, so the post-ad contribution screen was not run. Supply a measured or planned CAC to test it.",
    );
  }

  return {
    inputs,
    net_selling_price: round(netPrice),
    landed_cost: round(landed),
    landed_cost_breakdown: {
      product_cost: round(inputs.product_cost * inputs.fx_shock),
      freight: round(inputs.freight_per_unit * inputs.fx_shock),
      duty: round(duty),
      non_recoverable_import_tax: round(inputs.non_recoverable_import_tax_per_unit),
      packaging: round(inputs.packaging_per_unit),
      inspection: round(inputs.inspection_per_unit),
      receiving: round(inputs.receiving_per_unit),
    },
    payment_fees: round(paymentFees),
    expected_refund_cost: round(refundCost),
    expected_defect_cost: round(defectCost),
    expected_delivery_failure_cost: round(deliveryFailureCost),
    pre_ad_contribution: round(preAd),
    pre_ad_contribution_margin: round(preAdMargin, 4),
    landed_cost_ratio: Number.isFinite(landedRatio) ? round(landedRatio, 4) : -1,
    max_breakeven_cac: round(maxBreakevenCac),
    target_cac: round(targetCac),
    breakeven_roas: breakevenRoas === null ? null : round(breakevenRoas, 2),
    post_ad_contribution: postAd === null ? null : round(postAd),
    post_ad_contribution_margin: postAdMargin === null ? null : round(postAdMargin, 4),
    screens,
    screens_passed: screens.every((screen) => screen.pass),
    warnings,
    formula_trace: trace,
  };
}

export interface ScenarioMultipliers {
  selling_price?: number;
  product_cost?: number;
  freight?: number;
  cac?: number;
  refund_rate?: number;
  defect_rate?: number;
  delivery_failure_rate?: number;
  fx?: number;
  conversion_rate?: number;
}

/**
 * Applies scenario multipliers to a base input set.
 * A conversion-rate multiplier moves CAC inversely: halving conversion doubles CAC.
 */
export function applyScenario(base: EconomicsInputs, m: ScenarioMultipliers): EconomicsInputs {
  const conversion = m.conversion_rate ?? 1;
  const cacMultiplier = (m.cac ?? 1) / (conversion === 0 ? 0.0001 : conversion);
  return {
    ...base,
    selling_price: base.selling_price * (m.selling_price ?? 1),
    product_cost: base.product_cost * (m.product_cost ?? 1),
    freight_per_unit: base.freight_per_unit * (m.freight ?? 1),
    refund_rate: Math.min(1, base.refund_rate * (m.refund_rate ?? 1)),
    defect_rate: Math.min(1, base.defect_rate * (m.defect_rate ?? 1)),
    delivery_failure_rate: Math.min(1, base.delivery_failure_rate * (m.delivery_failure_rate ?? 1)),
    fx_shock: base.fx_shock * (m.fx ?? 1),
    actual_cac: base.actual_cac === null ? null : base.actual_cac * cacMultiplier,
  };
}
