/** Phase C: product opportunities - record, score, filter, rank. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LAUNCH_SCORE_THRESHOLD, PRODUCT_FACTORS } from "../constants.js";
import { guard, respond, table } from "../format.js";
import { assessLaunchReadiness, checkEvidenceGate, checkSupplierGate, latestEconomics } from "../gates.js";
import { scoreProduct } from "../scoring.js";
import { loadDb, mutate, nowIso, requireCategory, requireProduct, uniqueId } from "../store.js";
import {
  Confidence,
  Intensity,
  Product,
  Rating,
  RiskLevel,
  TrendStatus,
  currencyField,
  responseFormatField,
} from "../types.js";

const factorField = (description: string) => Rating.optional().describe(`${description} (0-10, higher = better)`);

const ProductStatus = z.enum([
  "researching",
  "watchlist",
  "shortlisted",
  "immediate_test",
  "reserve",
  "long_term",
  "rejected",
]);

export function registerProductTools(server: McpServer): void {
  server.registerTool(
    "ice_upsert_product",
    {
      title: "Create or update a product opportunity",
      description: `Record or update a specific product opportunity and compute its weighted 100-point score from the ten Phase C factors.

Factor weights: demand_evidence 15, impulse_trigger_strength 12, visual_demonstration_potential 8, unit_economics 18, customer_acquisition_potential 10, shipping_simplicity 10, low_return_risk 7, supply_reliability 7, differentiation_opportunity 8, low_legal_safety_ip_risk 5.

Rate 0-10 (10 = best). 'low_return_risk' and 'low_legal_safety_ip_risk' are inverted: 10 means almost no risk. Unrated factors forfeit their weight.

Use a clear, NON-BRANDED product name. The response always reports the evidence gate and the launch-readiness checks, so you can see immediately what is still missing.

Args:
  - id (string, optional): Existing product id to update. Omit to create.
  - name (string): Clear, non-branded product name
  - category_id (string): Id of the category this belongs to (must exist)
  - buyer (string): Specific customer segment
  - trigger (string): Emotional, physical or convenience need
  - purchase_moment (string): Situation that prompts the purchase
  - problem_solved (string): Concrete customer problem
  - five_second_hook (string): Short visual or verbal sales proposition
  - geographies (string[]): Countries showing the strongest signals
  - trend_status ('rising' | 'stable' | 'seasonal' | 'declining' | 'unproven')
  - saturation ('low' | 'moderate' | 'high')
  - differentiation (string): Bundle, design, positioning or service opportunity
  - selling_price_min / selling_price_max (number, optional): Realistic market selling-price range
  - product_cost_min / product_cost_max (number, optional): Indicative supplier cost range
  - currency (string): ISO code (default 'ZAR')
  - shipping_profile (string): Size, weight, fragility, restrictions
  - return_risk ('low' | 'moderate' | 'high')
  - supplier_path (string): Manufacturer, wholesaler or local distributor route
  - compliance_notes (string): Safety, certification, tax and IP considerations
  - content_angle (string): Demonstration, transformation or UGC concept
  - expansion_potential (string): Upsell, bundle, repeat purchase or subscription
  - confidence ('Certain' | 'Likely' | 'Guessing')
  - status ('researching' | 'watchlist' | 'shortlisted' | 'immediate_test' | 'reserve' | 'long_term' | 'rejected')
  - notes (string, optional)
  - <10 factors> (number 0-10, optional)

Returns (JSON):
  {
    "product": {...}, "score": number, "breakdown": [...], "missing_factors": string[], "unclaimed_points": number,
    "launch_threshold": number, "is_launch_candidate": boolean,
    "readiness": { "ready": boolean, "checks": [{ "name": string, "pass": boolean, "detail": string }], "blocking_reasons": string[] },
    "created": boolean
  }

Scoring below ${LAUNCH_SCORE_THRESHOLD} marks the product as a watch-list idea, not a launch recommendation.

Examples:
  - Use when: you have researched a product and want it scored and filed under a category.
  - Use when: promoting a product to status='immediate_test' after gates pass.
  - Don't use when: the product cost changed and you want new margins (that is ice_calc_unit_economics).`,
      inputSchema: {
        id: z.string().min(1).optional().describe("Existing product id to update; omit to create"),
        name: z.string().min(1).max(160).describe("Clear, non-branded product name"),
        category_id: z.string().min(1).describe("Category id this product belongs to"),
        buyer: z.string().max(500).default("").describe("Specific customer segment"),
        trigger: z.string().max(500).default("").describe("Emotional, physical or convenience need"),
        purchase_moment: z.string().max(500).default("").describe("Situation that prompts the purchase"),
        problem_solved: z.string().max(500).default("").describe("Concrete customer problem"),
        five_second_hook: z.string().max(300).default("").describe("Short visual or verbal sales proposition"),
        geographies: z.array(z.string().max(100)).default([]).describe("Countries with the strongest signals"),
        trend_status: TrendStatus.default("unproven").describe("Trend status"),
        saturation: Intensity.default("moderate").describe("Market saturation"),
        differentiation: z.string().max(1000).default("").describe("Bundle, design, positioning or service opportunity"),
        selling_price_min: z.number().min(0).nullable().default(null).describe("Realistic selling price, low end"),
        selling_price_max: z.number().min(0).nullable().default(null).describe("Realistic selling price, high end"),
        product_cost_min: z.number().min(0).nullable().default(null).describe("Indicative supplier cost, low end"),
        product_cost_max: z.number().min(0).nullable().default(null).describe("Indicative supplier cost, high end"),
        currency: currencyField,
        shipping_profile: z.string().max(600).default("").describe("Size, weight, fragility and restrictions"),
        return_risk: RiskLevel.default("moderate").describe("Expected return risk"),
        supplier_path: z.string().max(600).default("").describe("Manufacturer, wholesaler or local distributor route"),
        compliance_notes: z.string().max(2000).default("").describe("Safety, certification, tax and IP considerations"),
        content_angle: z.string().max(1000).default("").describe("Demonstration, transformation or UGC concept"),
        expansion_potential: z.string().max(1000).default("").describe("Upsell, bundle, repeat purchase or subscription"),
        confidence: Confidence.default("Guessing").describe("Evidence-based confidence level"),
        status: ProductStatus.default("researching").describe("Pipeline status"),
        notes: z.string().max(4000).optional().describe("Additional findings"),
        demand_evidence: factorField("Strength of demand evidence"),
        impulse_trigger_strength: factorField("Strength of the impulse trigger"),
        visual_demonstration_potential: factorField("Visual demonstration potential"),
        unit_economics: factorField("Unit economics"),
        customer_acquisition_potential: factorField("Customer-acquisition potential"),
        shipping_simplicity: factorField("Shipping simplicity"),
        low_return_risk: factorField("Absence of return risk"),
        supply_reliability: factorField("Supply reliability"),
        differentiation_opportunity: factorField("Differentiation opportunity"),
        low_legal_safety_ip_risk: factorField("Absence of legal, safety and IP risk"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) =>
      guard(() => {
        const factors: Record<string, number> = {};
        for (const factor of PRODUCT_FACTORS) {
          const value = (params as Record<string, unknown>)[factor];
          if (typeof value === "number") factors[factor] = value;
        }

        const result = mutate((db) => {
          requireCategory(db, params.category_id);
          let product = params.id ? db.products.find((item) => item.id === params.id) : undefined;
          if (params.id && !product) {
            throw new Error(`No product with id '${params.id}'. Omit 'id' to create one, or check ice_list_products.`);
          }
          const created = !product;
          if (!product) {
            product = {
              id: uniqueId(params.name, db.products.map((item) => item.id)),
              name: params.name,
              category_id: params.category_id,
              factors: {},
              score: 0,
              updated_at: nowIso(),
            } as unknown as Product;
            db.products.push(product);
          }
          Object.assign(product, {
            name: params.name,
            category_id: params.category_id,
            buyer: params.buyer,
            trigger: params.trigger,
            purchase_moment: params.purchase_moment,
            problem_solved: params.problem_solved,
            five_second_hook: params.five_second_hook,
            geographies: params.geographies,
            trend_status: params.trend_status,
            saturation: params.saturation,
            differentiation: params.differentiation,
            selling_price_min: params.selling_price_min,
            selling_price_max: params.selling_price_max,
            product_cost_min: params.product_cost_min,
            product_cost_max: params.product_cost_max,
            currency: params.currency,
            shipping_profile: params.shipping_profile,
            return_risk: params.return_risk,
            supplier_path: params.supplier_path,
            compliance_notes: params.compliance_notes,
            content_angle: params.content_angle,
            expansion_potential: params.expansion_potential,
            confidence: params.confidence,
            status: params.status,
          });
          if (params.notes !== undefined) product.notes = params.notes;
          product.factors = { ...product.factors, ...factors };
          const scored = scoreProduct(product.factors);
          product.score = scored.score;
          product.updated_at = nowIso();
          const readiness = assessLaunchReadiness(db, product);
          return { product, scored, created, readiness };
        });

        const structured = {
          product: result.product,
          score: result.scored.score,
          breakdown: result.scored.breakdown,
          missing_factors: result.scored.missing_factors,
          unclaimed_points: Math.round(result.scored.unrated_weight * 10) / 10,
          launch_threshold: LAUNCH_SCORE_THRESHOLD,
          is_launch_candidate: result.product.score >= LAUNCH_SCORE_THRESHOLD,
          readiness: result.readiness,
          created: result.created,
        };

        return respond("markdown", structured, () =>
          [
            `# ${result.created ? "Created" : "Updated"} product: ${result.product.name} (\`${result.product.id}\`)`,
            "",
            `**Score: ${result.scored.score}/100** — ${
              structured.is_launch_candidate
                ? "launch candidate"
                : `WATCH-LIST ONLY (below the ${LAUNCH_SCORE_THRESHOLD} launch threshold)`
            }. Category ${result.product.category_id}, confidence ${result.product.confidence}, status ${result.product.status}.`,
            "",
            table(
              ["Factor", "Rating", "Points"],
              result.scored.breakdown.map((row) => [row.factor, `${row.rating}/10`, `${row.points}/${row.max_points}`]),
            ),
            result.scored.missing_factors.length
              ? `\nUnrated factors forfeit ${structured.unclaimed_points} points: ${result.scored.missing_factors.join(", ")}`
              : "\nAll ten factors rated.",
            "",
            `## Launch readiness: ${result.readiness.ready ? "READY" : "NOT READY"}`,
            table(
              ["Check", "Result", "Detail"],
              result.readiness.checks.map((check) => [check.name, check.pass ? "PASS" : "FAIL", check.detail]),
            ),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_list_products",
    {
      title: "List and filter product opportunities",
      description: `List products with filtering, sorting and pagination. This is the working view over the product database.

Args:
  - category_id (string, optional): Filter to one category
  - status (string, optional): 'researching' | 'watchlist' | 'shortlisted' | 'immediate_test' | 'reserve' | 'long_term' | 'rejected'
  - min_score (number, optional): Minimum product score
  - trend_status (string, optional): Filter by trend
  - max_saturation ('low' | 'moderate' | 'high', optional): Exclude products above this saturation
  - launch_ready_only (boolean): Only products passing every launch gate (default false)
  - sort_by ('score' | 'name' | 'updated_at'): Sort key (default 'score', descending)
  - limit (number): Max results, 1-100 (default 25)
  - offset (number): Results to skip (default 0)
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  {
    "total": number, "count": number, "offset": number, "has_more": boolean, "next_offset": number,
    "items": [{ "id": string, "name": string, "category_id": string, "score": number, "status": string, "trend_status": string, "saturation": string, "confidence": string, "evidence_signals": number, "evidence_gate_pass": boolean, "supplier_count": number, "pre_ad_contribution": number|null, "launch_ready": boolean, "blocking_reasons": string[] }]
  }

Examples:
  - Use when: producing the ranked top-20 shortlist.
  - Use when: finding every product in a category that still fails the evidence gate.
  - Use when: checking which products are ready to become launch cards.`,
      inputSchema: {
        category_id: z.string().optional().describe("Filter to one category id"),
        status: ProductStatus.optional().describe("Filter by pipeline status"),
        min_score: z.number().min(0).max(100).optional().describe("Minimum product score"),
        trend_status: TrendStatus.optional().describe("Filter by trend status"),
        max_saturation: Intensity.optional().describe("Exclude products above this saturation level"),
        launch_ready_only: z.boolean().default(false).describe("Only products passing every launch gate"),
        sort_by: z.enum(["score", "name", "updated_at"]).default("score").describe("Sort key"),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum results to return"),
        offset: z.number().int().min(0).default(0).describe("Number of results to skip"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) =>
      guard(() => {
        const db = loadDb();
        const saturationRank: Record<string, number> = { low: 0, moderate: 1, high: 2 };

        const enriched = db.products.map((product) => {
          const evidence = checkEvidenceGate(db.evidence, "product", product.id);
          const suppliers = checkSupplierGate(db.suppliers, product.id);
          const economics = latestEconomics(db, product.id);
          const readiness = assessLaunchReadiness(db, product);
          return {
            id: product.id,
            name: product.name,
            category_id: product.category_id,
            score: product.score,
            status: product.status,
            trend_status: product.trend_status,
            saturation: product.saturation,
            confidence: product.confidence,
            currency: product.currency,
            evidence_signals: evidence.independent_signal_count,
            evidence_gate_pass: evidence.pass,
            supplier_count: suppliers.supplier_count,
            pre_ad_contribution: economics ? economics.pre_ad_contribution : null,
            pre_ad_margin: economics ? economics.pre_ad_contribution_margin : null,
            launch_ready: readiness.ready,
            blocking_reasons: readiness.blocking_reasons,
            updated_at: product.updated_at,
          };
        });

        const filtered = enriched
          .filter((item) => (params.category_id ? item.category_id === params.category_id : true))
          .filter((item) => (params.status ? item.status === params.status : true))
          .filter((item) => (params.min_score === undefined ? true : item.score >= params.min_score))
          .filter((item) => (params.trend_status ? item.trend_status === params.trend_status : true))
          .filter((item) =>
            params.max_saturation
              ? (saturationRank[item.saturation] ?? 3) <= (saturationRank[params.max_saturation] ?? 3)
              : true,
          )
          .filter((item) => (params.launch_ready_only ? item.launch_ready : true))
          .sort((a, b) => {
            if (params.sort_by === "name") return a.name.localeCompare(b.name);
            if (params.sort_by === "updated_at") return b.updated_at.localeCompare(a.updated_at);
            return b.score - a.score;
          });

        const slice = filtered.slice(params.offset, params.offset + params.limit);
        const hasMore = filtered.length > params.offset + slice.length;
        const structured = {
          total: filtered.length,
          count: slice.length,
          offset: params.offset,
          items: slice,
          has_more: hasMore,
          ...(hasMore ? { next_offset: params.offset + slice.length } : {}),
        };

        return respond(params.response_format, structured, () =>
          slice.length
            ? [
                `# Products (${filtered.length} matching, showing ${slice.length})`,
                "",
                table(
                  ["#", "Product", "Category", "Score", "Status", "Trend", "Sat.", "Signals", "Suppliers", "Pre-ad contrib.", "Ready"],
                  slice.map((item, index) => [
                    params.offset + index + 1,
                    `${item.name} (${item.id})`,
                    item.category_id,
                    item.score,
                    item.status,
                    item.trend_status,
                    item.saturation,
                    `${item.evidence_signals}${item.evidence_gate_pass ? "" : "!"}`,
                    item.supplier_count,
                    item.pre_ad_contribution === null ? "not calculated" : `${item.currency} ${item.pre_ad_contribution}`,
                    item.launch_ready ? "yes" : "no",
                  ]),
                ),
                "",
                "`!` on a signal count means the evidence gate fails. Use ice_get_product for the blocking reasons.",
              ].join("\n")
            : "No products match those filters. Relax them, or add products with ice_upsert_product.",
        );
      }),
  );

  server.registerTool(
    "ice_get_product",
    {
      title: "Get one product in full",
      description: `Return a single product with every recorded field, its score breakdown, all evidence with links, all suppliers, the latest unit economics, the compliance verdict and the launch-readiness checks.

This is the tool to call before writing a launch card or telling a user a product is ready.

Args:
  - id (string): Product id
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  {
    "product": {...},
    "score_breakdown": [{ "factor": string, "rating": number, "weight": number, "points": number }],
    "evidence_gate": { "pass": boolean, "independent_signal_count": number, "non_supplier_signal_count": number, "reasons": string[] },
    "evidence": [...], "suppliers": [...], "supplier_gate": {...},
    "economics": {...} | null, "compliance": {...} | null,
    "readiness": { "ready": boolean, "checks": [...], "blocking_reasons": string[] }
  }

Examples:
  - Use when: drafting a launch card and you need the sourcing, economics and compliance detail in one place.
  - Use when: the user asks "why isn't this one launch ready?".`,
      inputSchema: { id: z.string().min(1).describe("Product id"), response_format: responseFormatField },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, response_format }) =>
      guard(() => {
        const db = loadDb();
        const product = requireProduct(db, id);
        const scored = scoreProduct(product.factors);
        const evidenceGate = checkEvidenceGate(db.evidence, "product", id);
        const evidence = db.evidence.filter((item) => item.subject_type === "product" && item.subject_id === id);
        const suppliers = db.suppliers.filter((item) => item.product_id === id);
        const supplierGate = checkSupplierGate(db.suppliers, id);
        const economics = latestEconomics(db, id) ?? null;
        const compliance = db.compliance.find((item) => item.product_id === id) ?? null;
        const readiness = assessLaunchReadiness(db, product);

        const structured = {
          product,
          score_breakdown: scored.breakdown,
          evidence_gate: evidenceGate,
          evidence,
          suppliers,
          supplier_gate: supplierGate,
          economics,
          compliance,
          readiness,
        };

        return respond(response_format, structured, () =>
          [
            `# ${product.name} (\`${product.id}\`)`,
            "",
            `**Score ${product.score}/100** — status ${product.status}, confidence ${product.confidence}, category ${product.category_id}`,
            `**Launch readiness: ${readiness.ready ? "READY" : "NOT READY"}**`,
            "",
            "## Positioning",
            `- **Buyer:** ${product.buyer || "not set"}`,
            `- **Trigger:** ${product.trigger || "not set"}`,
            `- **Purchase moment:** ${product.purchase_moment || "not set"}`,
            `- **Problem solved:** ${product.problem_solved || "not set"}`,
            `- **Five-second hook:** ${product.five_second_hook || "not set"}`,
            `- **Differentiation:** ${product.differentiation || "not set"}`,
            `- **Content angle:** ${product.content_angle || "not set"}`,
            `- **Expansion:** ${product.expansion_potential || "not set"}`,
            `- **Shipping profile:** ${product.shipping_profile || "not set"}`,
            `- **Return risk:** ${product.return_risk}`,
            `- **Compliance notes:** ${product.compliance_notes || "not set"}`,
            "",
            "## Score breakdown",
            table(
              ["Factor", "Rating", "Points"],
              scored.breakdown.map((row) => [row.factor, `${row.rating}/10`, `${row.points}/${row.max_points}`]),
            ),
            "",
            `## Evidence gate: ${evidenceGate.pass ? "PASS" : "FAIL"} (${evidenceGate.independent_signal_count} independent domains, ${evidenceGate.non_supplier_signal_count} non-supplier)`,
            evidence.length
              ? table(
                  ["Source", "URL", "Region", "Period", "Signal", "Supplier?", "Verification"],
                  evidence.map((item) => [
                    item.source_name,
                    item.url,
                    item.region,
                    item.period_covered,
                    item.signal_type,
                    item.is_supplier_source ? "yes" : "no",
                    item.verification,
                  ]),
                )
              : "- No evidence recorded.",
            "",
            `## Suppliers (${suppliers.length}) — gate ${supplierGate.pass ? "PASS" : "FAIL"}`,
            suppliers.length
              ? table(
                  ["Name", "Type", "Country", "Unit price", "MOQ", "Verification", "Backup"],
                  suppliers.map((supplier) => [
                    supplier.name,
                    supplier.type,
                    supplier.country,
                    supplier.unit_price_min !== null
                      ? `${supplier.currency} ${supplier.unit_price_min}-${supplier.unit_price_max ?? supplier.unit_price_min}`
                      : "not quoted",
                    supplier.moq ?? "n/a",
                    supplier.verification_status,
                    supplier.is_backup ? "yes" : "no",
                  ]),
                )
              : "- No suppliers recorded.",
            "",
            "## Unit economics",
            economics
              ? [
                  `Latest run '${economics.label}' (${economics.computed_at})`,
                  `- Net selling price: ${economics.inputs.currency} ${economics.net_selling_price}`,
                  `- Landed cost: ${economics.inputs.currency} ${economics.landed_cost} (${(economics.landed_cost_ratio * 100).toFixed(1)}% of net price)`,
                  `- Pre-ad contribution: ${economics.inputs.currency} ${economics.pre_ad_contribution} (${(economics.pre_ad_contribution_margin * 100).toFixed(1)}%)`,
                  `- Max break-even CAC: ${economics.inputs.currency} ${economics.max_breakeven_cac}; target CAC ${economics.inputs.currency} ${economics.target_cac}`,
                  `- Break-even ROAS: ${economics.breakeven_roas ?? "undefined (contribution <= 0)"}`,
                  `- Screens: ${economics.screens_passed ? "all passed" : economics.screens.filter((s) => !s.pass).map((s) => s.name).join(", ") + " FAILED"}`,
                ].join("\n")
              : "- Not calculated. Run ice_calc_unit_economics.",
            "",
            "## Compliance",
            compliance
              ? `Verdict **${compliance.verdict}** — ${compliance.reasons.join(" ")}`
              : "- Not screened. Run ice_screen_compliance.",
            "",
            "## Blocking reasons",
            readiness.blocking_reasons.length
              ? readiness.blocking_reasons.map((reason) => `- ${reason}`).join("\n")
              : "- None. Every gate passes.",
          ].join("\n"),
        );
      }),
  );
}
