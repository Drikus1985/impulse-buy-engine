/** Section 7: unit economics and scenario analysis. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ECONOMICS_THRESHOLDS, SCENARIO_DEFAULTS } from "../constants.js";
import { applyScenario, computeEconomics } from "../economics.js";
import { guard, respond, round, table } from "../format.js";
import { latestEconomics } from "../gates.js";
import { loadDb, mutate, nowIso, requireProduct } from "../store.js";
import { EconomicsInputs, currencyField, responseFormatField } from "../types.js";

const economicsInputShape = {
  selling_price: z.number().min(0).describe("Selling price to the customer, as displayed (see price_includes_vat)"),
  price_includes_vat: z.boolean().default(true).describe("True if selling_price is VAT-inclusive"),
  vat_rate: z.number().min(0).max(1).default(0.15).describe("Sales tax / VAT rate as a decimal (South Africa: 0.15)"),
  vat_recoverable: z
    .boolean()
    .default(true)
    .describe("True if the sales tax in the price is remitted and therefore not revenue. Set false only if the business is not VAT-registered."),
  product_cost: z.number().min(0).describe("Ex-works or wholesale unit cost"),
  freight_per_unit: z.number().min(0).default(0).describe("Inbound freight allocated per unit"),
  duty_rate: z.number().min(0).max(2).default(0).describe("Import duty as a decimal applied to (product cost + freight)"),
  duty_per_unit: z.number().min(0).default(0).describe("Fixed duty per unit, if quoted that way"),
  non_recoverable_import_tax_per_unit: z.number().min(0).default(0).describe("Import tax that cannot be reclaimed"),
  packaging_per_unit: z.number().min(0).default(0).describe("Packaging cost per unit"),
  inspection_per_unit: z.number().min(0).default(0).describe("Inspection cost per unit"),
  receiving_per_unit: z.number().min(0).default(0).describe("Receiving / intake handling per unit"),
  payment_fee_pct: z.number().min(0).max(1).default(0).describe("Payment gateway percentage on the GROSS price, e.g. 0.029. Use the real quoted rate."),
  payment_fee_fixed: z.number().min(0).default(0).describe("Fixed payment fee per transaction"),
  fulfilment_per_unit: z.number().min(0).default(0).describe("Pick, pack and outbound delivery per order"),
  refund_rate: z.number().min(0).max(1).default(0).describe("Expected refund/return rate as a decimal"),
  return_shipping_cost: z.number().min(0).default(0).describe("Return leg cost when a refund happens"),
  salvage_rate: z.number().min(0).max(1).default(0).describe("Fraction of landed cost recovered on a returned unit (0 = written off)"),
  defect_rate: z.number().min(0).max(1).default(0).describe("Expected defect/replacement rate as a decimal"),
  delivery_failure_rate: z.number().min(0).max(1).default(0).describe("Expected failed-delivery rate as a decimal"),
  support_allowance_per_unit: z.number().min(0).default(0).describe("Customer-support cost allowance per order"),
  required_profit_per_order: z.number().min(0).default(0).describe("Profit you require per order after acquisition cost"),
  actual_cac: z.number().min(0).nullable().default(null).describe("Measured or planned customer-acquisition cost per order. Null skips the post-ad screen."),
  fx_shock: z.number().min(0.1).max(5).default(1).describe("Multiplier on import-denominated costs (product cost and freight). 1 = no shock."),
  currency: currencyField,
};

const screensSchema = z.array(
  z.object({ name: z.string(), threshold: z.number(), actual: z.number(), pass: z.boolean() }),
);

function toInputs(params: Record<string, unknown>): EconomicsInputs {
  return {
    selling_price: params.selling_price as number,
    price_includes_vat: params.price_includes_vat as boolean,
    vat_rate: params.vat_rate as number,
    vat_recoverable: params.vat_recoverable as boolean,
    product_cost: params.product_cost as number,
    freight_per_unit: params.freight_per_unit as number,
    duty_rate: params.duty_rate as number,
    duty_per_unit: params.duty_per_unit as number,
    non_recoverable_import_tax_per_unit: params.non_recoverable_import_tax_per_unit as number,
    packaging_per_unit: params.packaging_per_unit as number,
    inspection_per_unit: params.inspection_per_unit as number,
    receiving_per_unit: params.receiving_per_unit as number,
    payment_fee_pct: params.payment_fee_pct as number,
    payment_fee_fixed: params.payment_fee_fixed as number,
    fulfilment_per_unit: params.fulfilment_per_unit as number,
    refund_rate: params.refund_rate as number,
    return_shipping_cost: params.return_shipping_cost as number,
    salvage_rate: params.salvage_rate as number,
    defect_rate: params.defect_rate as number,
    delivery_failure_rate: params.delivery_failure_rate as number,
    support_allowance_per_unit: params.support_allowance_per_unit as number,
    required_profit_per_order: params.required_profit_per_order as number,
    actual_cac: (params.actual_cac ?? null) as number | null,
    fx_shock: params.fx_shock as number,
    currency: params.currency as string,
  };
}

/** Flags cost inputs left at zero that almost never are zero in reality. */
function zeroCostWarnings(inputs: EconomicsInputs): string[] {
  const warnings: string[] = [];
  if (inputs.payment_fee_pct === 0 && inputs.payment_fee_fixed === 0) {
    warnings.push("Payment fees are zero. No gateway is free; substitute the real quoted rate before trusting this contribution.");
  }
  if (inputs.fulfilment_per_unit === 0) {
    warnings.push("Fulfilment cost is zero. Unless the customer collects, this understates cost per order.");
  }
  if (inputs.refund_rate === 0) {
    warnings.push("Refund rate is zero. Even low-return products refund some orders; a zero here flatters the contribution.");
  }
  return warnings;
}

export function registerEconomicsTools(server: McpServer): void {
  server.registerTool(
    "ice_calc_unit_economics",
    {
      title: "Calculate and store unit economics for a product",
      description: `Compute landed cost, pre-ad contribution, maximum break-even CAC, target CAC and break-even ROAS for a product, run the screening thresholds, and store the result against the product.

Formulas (the response includes the full arithmetic trace):
  landed cost = (product cost + freight) x fx_shock + duty + non-recoverable import tax + packaging + inspection + receiving
  net selling price = selling price excluding recoverable sales tax
  pre-ad contribution = net price - landed - payment fees - fulfilment - expected refund cost - expected defect cost - expected delivery-failure cost - support allowance
  max break-even CAC = pre-ad contribution
  target CAC = max break-even CAC - required profit per order
  break-even ROAS = net price / max break-even CAC

Loss modelling, stated so nothing is double counted:
  expected refund cost = refund_rate x (net price - landed x salvage_rate + return shipping)
  expected defect cost = defect_rate x (landed + fulfilment)
  expected delivery-failure cost = delivery_failure_rate x (net price - landed x salvage_rate + return shipping)

Screens (defaults, overridable): landed cost <= ${ECONOMICS_THRESHOLDS.max_landed_cost_ratio} of net price; pre-ad contribution margin >= ${ECONOMICS_THRESHOLDS.min_pre_ad_contribution_margin}; post-ad contribution margin >= ${ECONOMICS_THRESHOLDS.min_post_ad_contribution_margin} (only when actual_cac is supplied).

Cost inputs default to zero so you must supply them deliberately. Any zero that is implausible (payment fees, fulfilment, refunds) is flagged in 'warnings'.

Args:
  - product_id (string): Product this calculation belongs to
  - label (string): Name for this run, e.g. "base case, 200 units airfreight"
  - selling_price, product_cost (number, required); every other cost input defaults to 0 - see the input schema
  - actual_cac (number | null): Supply to run the post-ad screen
  - fx_shock (number): Multiplier on import costs (default 1)
  - override_max_landed_cost_ratio / override_min_pre_ad_margin / override_min_post_ad_margin (number, optional): Replace a screening threshold where evidence justifies it
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON): net_selling_price, landed_cost, landed_cost_breakdown, payment_fees, expected_refund_cost, expected_defect_cost, expected_delivery_failure_cost, pre_ad_contribution, pre_ad_contribution_margin, landed_cost_ratio, max_breakeven_cac, target_cac, breakeven_roas (null if contribution <= 0), post_ad_contribution, post_ad_contribution_margin, screens, screens_passed, warnings, formula_trace.

Examples:
  - Use when: a supplier quote arrives and you need to know the maximum you can pay for a customer.
  - Use when: the user asks whether a R249 product can carry a R90 CAC.
  - Don't use when: you want price/cost sensitivity (use ice_run_scenarios).`,
      inputSchema: {
        product_id: z.string().min(1).describe("Product id this calculation belongs to"),
        label: z.string().min(1).max(200).default("base case").describe("Label for this calculation run"),
        ...economicsInputShape,
        override_max_landed_cost_ratio: z.number().min(0).max(1).optional().describe("Override the landed-cost screening threshold"),
        override_min_pre_ad_margin: z.number().min(0).max(1).optional().describe("Override the pre-ad contribution-margin threshold"),
        override_min_post_ad_margin: z.number().min(0).max(1).optional().describe("Override the post-ad contribution-margin threshold"),
        response_format: responseFormatField,
      },
      outputSchema: {
        product_id: z.string(),
        label: z.string(),
        currency: z.string(),
        net_selling_price: z.number(),
        landed_cost: z.number(),
        landed_cost_breakdown: z.record(z.string(), z.number()),
        landed_cost_ratio: z.number(),
        payment_fees: z.number(),
        expected_refund_cost: z.number(),
        expected_defect_cost: z.number(),
        expected_delivery_failure_cost: z.number(),
        pre_ad_contribution: z.number(),
        pre_ad_contribution_margin: z.number(),
        max_breakeven_cac: z.number(),
        target_cac: z.number(),
        breakeven_roas: z.number().nullable(),
        post_ad_contribution: z.number().nullable(),
        post_ad_contribution_margin: z.number().nullable(),
        screens: screensSchema,
        screens_passed: z.boolean(),
        warnings: z.array(z.string()),
        formula_trace: z.array(z.string()),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) =>
      guard(() => {
        const inputs = toInputs(params as unknown as Record<string, unknown>);
        const thresholds = {
          max_landed_cost_ratio: params.override_max_landed_cost_ratio ?? ECONOMICS_THRESHOLDS.max_landed_cost_ratio,
          min_pre_ad_contribution_margin: params.override_min_pre_ad_margin ?? ECONOMICS_THRESHOLDS.min_pre_ad_contribution_margin,
          min_post_ad_contribution_margin: params.override_min_post_ad_margin ?? ECONOMICS_THRESHOLDS.min_post_ad_contribution_margin,
        };
        const result = computeEconomics(inputs, thresholds);
        result.warnings.unshift(...zeroCostWarnings(inputs));

        mutate((db) => {
          requireProduct(db, params.product_id);
          db.economics = db.economics.filter(
            (item) => !(item.product_id === params.product_id && item.label === params.label),
          );
          db.economics.push({ ...result, product_id: params.product_id, label: params.label, computed_at: nowIso() });
        });

        const structured = {
          product_id: params.product_id,
          label: params.label,
          currency: inputs.currency,
          net_selling_price: result.net_selling_price,
          landed_cost: result.landed_cost,
          landed_cost_breakdown: result.landed_cost_breakdown,
          landed_cost_ratio: result.landed_cost_ratio,
          payment_fees: result.payment_fees,
          expected_refund_cost: result.expected_refund_cost,
          expected_defect_cost: result.expected_defect_cost,
          expected_delivery_failure_cost: result.expected_delivery_failure_cost,
          pre_ad_contribution: result.pre_ad_contribution,
          pre_ad_contribution_margin: result.pre_ad_contribution_margin,
          max_breakeven_cac: result.max_breakeven_cac,
          target_cac: result.target_cac,
          breakeven_roas: result.breakeven_roas,
          post_ad_contribution: result.post_ad_contribution,
          post_ad_contribution_margin: result.post_ad_contribution_margin,
          screens: result.screens,
          screens_passed: result.screens_passed,
          warnings: result.warnings,
          formula_trace: result.formula_trace,
        };

        return respond(params.response_format, structured, () =>
          [
            `# Unit economics: \`${params.product_id}\` — ${params.label}`,
            "",
            table(
              ["Line", `Amount (${inputs.currency})`],
              [
                ["Net selling price", result.net_selling_price],
                ["Landed cost", `-${result.landed_cost}`],
                ["Payment fees", `-${result.payment_fees}`],
                ["Fulfilment", `-${inputs.fulfilment_per_unit}`],
                ["Expected refund cost", `-${result.expected_refund_cost}`],
                ["Expected defect cost", `-${result.expected_defect_cost}`],
                ["Expected delivery-failure cost", `-${result.expected_delivery_failure_cost}`],
                ["Support allowance", `-${inputs.support_allowance_per_unit}`],
                ["**Pre-ad contribution**", `**${result.pre_ad_contribution}**`],
              ],
            ),
            "",
            `- Pre-ad contribution margin: **${(result.pre_ad_contribution_margin * 100).toFixed(1)}%**`,
            `- Landed cost ratio: **${(result.landed_cost_ratio * 100).toFixed(1)}%** of net price`,
            `- Max break-even CAC: **${inputs.currency} ${result.max_breakeven_cac}**`,
            `- Target CAC (after ${inputs.currency} ${inputs.required_profit_per_order} required profit): **${inputs.currency} ${result.target_cac}**`,
            `- Break-even ROAS: **${result.breakeven_roas ?? "undefined — contribution is not positive"}**`,
            result.post_ad_contribution !== null
              ? `- Post-ad contribution at CAC ${inputs.currency} ${inputs.actual_cac}: **${inputs.currency} ${result.post_ad_contribution}** (${((result.post_ad_contribution_margin ?? 0) * 100).toFixed(1)}%)`
              : "- Post-ad contribution: not calculated (no actual_cac supplied)",
            "",
            "## Screens",
            table(
              ["Screen", "Threshold", "Actual", "Result"],
              result.screens.map((screen) => [screen.name, screen.threshold, screen.actual, screen.pass ? "PASS" : "FAIL"]),
            ),
            "",
            "## Landed cost breakdown",
            table(
              ["Component", `Amount (${inputs.currency})`],
              Object.entries(result.landed_cost_breakdown),
            ),
            "",
            result.warnings.length ? "## Warnings\n" + result.warnings.map((warning) => `- ${warning}`).join("\n") : "",
            "",
            "## Arithmetic trace",
            result.formula_trace.map((line) => `- ${line}`).join("\n"),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_run_scenarios",
    {
      title: "Run base, downside and upside scenarios",
      description: `Run sensitivity scenarios over a stored unit-economics calculation and report where the product stops being viable.

Uses the stored calculation as the base case. Downside and upside multipliers default to a deliberately unkind/kind set and can be overridden per variable:
  downside: ${JSON.stringify(SCENARIO_DEFAULTS.downside)}
  upside:   ${JSON.stringify(SCENARIO_DEFAULTS.upside)}

A conversion_rate multiplier moves CAC inversely (halving conversion doubles CAC).

Args:
  - product_id (string): Product id
  - label (string, optional): Which stored calculation to use as the base (default: the most recent)
  - downside_* / upside_* (number, optional): Override any multiplier - selling_price, product_cost, freight, cac, refund_rate, defect_rate, delivery_failure_rate, fx, conversion_rate
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  {
    "product_id": string, "base_label": string, "currency": string,
    "scenarios": [{ "name": "base"|"downside"|"upside", "multipliers": {...}, "net_selling_price": number, "landed_cost": number, "pre_ad_contribution": number, "pre_ad_contribution_margin": number, "max_breakeven_cac": number, "breakeven_roas": number|null, "post_ad_contribution": number|null, "screens_passed": boolean }],
    "survives_downside": boolean,
    "verdict": string
  }

'survives_downside' is the number that matters: a product that only works in the base case is not a business.

Examples:
  - Use when: deciding whether to commit inventory capital to a product.
  - Use when: the user asks what a 12% rand move does to margin.`,
      inputSchema: {
        product_id: z.string().min(1).describe("Product id"),
        label: z.string().optional().describe("Stored calculation label to use as the base case"),
        downside_selling_price: z.number().min(0).optional().describe("Downside multiplier on selling price"),
        downside_product_cost: z.number().min(0).optional().describe("Downside multiplier on product cost"),
        downside_freight: z.number().min(0).optional().describe("Downside multiplier on freight"),
        downside_cac: z.number().min(0).optional().describe("Downside multiplier on CAC"),
        downside_refund_rate: z.number().min(0).optional().describe("Downside multiplier on refund rate"),
        downside_defect_rate: z.number().min(0).optional().describe("Downside multiplier on defect rate"),
        downside_delivery_failure_rate: z.number().min(0).optional().describe("Downside multiplier on delivery-failure rate"),
        downside_fx: z.number().min(0).optional().describe("Downside multiplier on import costs (currency movement)"),
        downside_conversion_rate: z.number().min(0).optional().describe("Downside multiplier on conversion rate (moves CAC inversely)"),
        upside_selling_price: z.number().min(0).optional().describe("Upside multiplier on selling price"),
        upside_product_cost: z.number().min(0).optional().describe("Upside multiplier on product cost"),
        upside_freight: z.number().min(0).optional().describe("Upside multiplier on freight"),
        upside_cac: z.number().min(0).optional().describe("Upside multiplier on CAC"),
        upside_refund_rate: z.number().min(0).optional().describe("Upside multiplier on refund rate"),
        upside_defect_rate: z.number().min(0).optional().describe("Upside multiplier on defect rate"),
        upside_delivery_failure_rate: z.number().min(0).optional().describe("Upside multiplier on delivery-failure rate"),
        upside_fx: z.number().min(0).optional().describe("Upside multiplier on import costs"),
        upside_conversion_rate: z.number().min(0).optional().describe("Upside multiplier on conversion rate"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) =>
      guard(() => {
        const db = loadDb();
        requireProduct(db, params.product_id);
        const base = params.label
          ? db.economics.find((item) => item.product_id === params.product_id && item.label === params.label)
          : latestEconomics(db, params.product_id);
        if (!base) {
          const labels = db.economics.filter((item) => item.product_id === params.product_id).map((item) => item.label);
          throw new Error(
            `No stored unit economics for product '${params.product_id}'${params.label ? ` with label '${params.label}'` : ""}. ${
              labels.length ? `Available labels: ${labels.join(", ")}.` : "Run ice_calc_unit_economics first."
            }`,
          );
        }

        const pick = (prefix: "downside" | "upside") => {
          const defaults = SCENARIO_DEFAULTS[prefix] as Record<string, number>;
          const keys = [
            "selling_price",
            "product_cost",
            "freight",
            "cac",
            "refund_rate",
            "defect_rate",
            "delivery_failure_rate",
            "fx",
            "conversion_rate",
          ];
          const out: Record<string, number> = {};
          for (const key of keys) {
            const override = (params as Record<string, unknown>)[`${prefix}_${key}`];
            const value = typeof override === "number" ? override : defaults[key];
            if (typeof value === "number") out[key] = value;
          }
          return out;
        };

        const scenarioDefs = [
          { name: "base" as const, multipliers: {} as Record<string, number> },
          { name: "downside" as const, multipliers: pick("downside") },
          { name: "upside" as const, multipliers: pick("upside") },
        ];

        const scenarios = scenarioDefs.map((definition) => {
          const inputs = definition.name === "base" ? base.inputs : applyScenario(base.inputs, definition.multipliers);
          const computed = computeEconomics(inputs);
          return {
            name: definition.name,
            multipliers: definition.multipliers,
            selling_price: round(inputs.selling_price),
            net_selling_price: computed.net_selling_price,
            landed_cost: computed.landed_cost,
            landed_cost_ratio: computed.landed_cost_ratio,
            pre_ad_contribution: computed.pre_ad_contribution,
            pre_ad_contribution_margin: computed.pre_ad_contribution_margin,
            max_breakeven_cac: computed.max_breakeven_cac,
            breakeven_roas: computed.breakeven_roas,
            post_ad_contribution: computed.post_ad_contribution,
            screens_passed: computed.screens_passed,
          };
        });

        const downside = scenarios.find((scenario) => scenario.name === "downside");
        const survives = downside ? downside.pre_ad_contribution > 0 : false;
        const survivesPostAd = downside ? (downside.post_ad_contribution ?? 1) > 0 : false;
        const verdict = !survives
          ? "FAILS the downside case before advertising. Do not commit inventory capital on these assumptions."
          : base.inputs.actual_cac !== null && !survivesPostAd
            ? "Survives the downside before advertising but not after it. Only viable if CAC is genuinely controlled."
            : "Survives the downside case. Still test with real traffic before scaling.";

        const structured = {
          product_id: params.product_id,
          base_label: base.label,
          currency: base.inputs.currency,
          scenarios,
          survives_downside: survives,
          survives_downside_post_ad: survivesPostAd,
          verdict,
        };

        return respond(params.response_format, structured, () =>
          [
            `# Scenarios: \`${params.product_id}\` (base run "${base.label}")`,
            "",
            table(
              ["Scenario", "Price", "Landed", "Pre-ad contrib.", "Margin", "Max CAC", "B/E ROAS", "Post-ad contrib.", "Screens"],
              scenarios.map((scenario) => [
                scenario.name,
                scenario.selling_price,
                scenario.landed_cost,
                scenario.pre_ad_contribution,
                `${(scenario.pre_ad_contribution_margin * 100).toFixed(1)}%`,
                scenario.max_breakeven_cac,
                scenario.breakeven_roas ?? "n/a",
                scenario.post_ad_contribution ?? "n/a",
                scenario.screens_passed ? "pass" : "fail",
              ]),
            ),
            "",
            `**Verdict: ${verdict}**`,
            "",
            "Downside multipliers applied: " + JSON.stringify(scenarios[1]?.multipliers ?? {}),
            "Upside multipliers applied: " + JSON.stringify(scenarios[2]?.multipliers ?? {}),
          ].join("\n"),
        );
      }),
  );
}
