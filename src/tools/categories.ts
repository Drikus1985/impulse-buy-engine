/** Phase B: impulse-commerce category discovery and ranking. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATEGORY_FACTORS } from "../constants.js";
import { guard, respond, table } from "../format.js";
import { checkEvidenceGate } from "../gates.js";
import { scoreCategory } from "../scoring.js";
import { loadDb, mutate, nowIso, requireCategory, uniqueId } from "../store.js";
import { Category, Confidence, Intensity, Rating, TrendStatus, currencyField, responseFormatField } from "../types.js";

const factorField = (description: string) => Rating.optional().describe(`${description} (0-10, higher = better)`);

export function registerCategoryTools(server: McpServer): void {
  server.registerTool(
    "ice_upsert_category",
    {
      title: "Create or update an impulse-commerce category",
      description: `Record or update a candidate category and compute its weighted 100-point score from the eight Phase B factors.

Factor weights: current_trend_momentum 15, impulse_purchase_suitability 15, demonstrability_in_short_form 10, unit_economics_potential 20, shipping_and_fulfilment_simplicity 10, automation_suitability 10, differentiation_opportunity 10, low_regulatory_and_liability_risk 10.

Rate every factor 0-10 (10 = best). Note the inversion on 'low_regulatory_and_liability_risk': 10 means almost no regulatory or liability exposure. Unrated factors forfeit their weight and the response says how many points were lost.

The score is arithmetic, not judgement: identical ratings always produce an identical score.

Args:
  - id (string, optional): Existing category id to update. Omit to create.
  - name (string): Category name, e.g. "desk cable and cord management"
  - primary_need (string): The consumer need or emotion the category serves
  - target_customers (string[]): Customer groups
  - geographies (string[]): Countries or regions showing the strongest demand
  - trend_direction ('rising' | 'stable' | 'seasonal' | 'declining' | 'unproven')
  - seasonality (string): Seasonality pattern, or "none observed"
  - typical_price_min / typical_price_max (number, optional): Typical selling-price range
  - currency (string): ISO currency code (default 'ZAR')
  - competitive_intensity ('low' | 'moderate' | 'high')
  - content_potential (string): Content and advertising potential
  - repeat_or_bundle_potential (string): Repeat-purchase or bundling potential
  - principal_risks (string[]): Principal risks
  - market_ids (string[], optional): Market ids this assessment applies to
  - confidence ('Certain' | 'Likely' | 'Guessing')
  - notes (string, optional)
  - <8 factors> (number 0-10, optional)

Returns (JSON):
  {
    "category": { "id": string, "name": string, "score": number, ... },
    "score": number, "breakdown": [{ "factor": string, "rating": number, "weight": number, "points": number }],
    "missing_factors": string[], "unclaimed_points": number,
    "evidence_gate": { "pass": boolean, "independent_signal_count": number, "reasons": string[] },
    "created": boolean
  }

The evidence gate is reported on every write: a category needs three independent demand signals (three distinct source domains) before it should be shortlisted.

Examples:
  - Use when: you have researched a category and want it scored and stored.
  - Use when: re-rating a category after finding better evidence.
  - Don't use when: recording a specific product (use ice_upsert_product).`,
      inputSchema: {
        id: z.string().min(1).optional().describe("Existing category id to update; omit to create"),
        name: z.string().min(1).max(140).describe("Category name"),
        primary_need: z.string().min(1).max(500).describe("Primary consumer need or emotion"),
        target_customers: z.array(z.string().max(200)).default([]).describe("Target customer groups"),
        geographies: z.array(z.string().max(100)).default([]).describe("Countries or regions with the strongest demand"),
        trend_direction: TrendStatus.default("unproven").describe("Trend direction"),
        seasonality: z.string().max(500).default("not assessed").describe("Seasonality pattern"),
        typical_price_min: z.number().min(0).nullable().default(null).describe("Typical selling price, low end"),
        typical_price_max: z.number().min(0).nullable().default(null).describe("Typical selling price, high end"),
        currency: currencyField,
        competitive_intensity: Intensity.default("moderate").describe("Competitive intensity"),
        content_potential: z.string().max(1000).default("").describe("Content and advertising potential"),
        repeat_or_bundle_potential: z.string().max(1000).default("").describe("Repeat-purchase or bundling potential"),
        principal_risks: z.array(z.string().max(300)).default([]).describe("Principal risks"),
        market_ids: z.array(z.string()).default([]).describe("Market ids this assessment applies to"),
        confidence: Confidence.default("Guessing").describe("Evidence-based confidence level"),
        notes: z.string().max(4000).optional().describe("Additional findings"),
        current_trend_momentum: factorField("Current trend momentum"),
        impulse_purchase_suitability: factorField("Impulse-purchase suitability"),
        demonstrability_in_short_form: factorField("Demonstrability in short-form content"),
        unit_economics_potential: factorField("Unit-economics potential"),
        shipping_and_fulfilment_simplicity: factorField("Shipping and fulfilment simplicity"),
        automation_suitability: factorField("Automation suitability"),
        differentiation_opportunity: factorField("Differentiation opportunity"),
        low_regulatory_and_liability_risk: factorField("Absence of regulatory and liability risk"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) =>
      guard(() => {
        const factors: Record<string, number> = {};
        for (const factor of CATEGORY_FACTORS) {
          const value = (params as Record<string, unknown>)[factor];
          if (typeof value === "number") factors[factor] = value;
        }

        const result = mutate((db) => {
          let category = params.id ? db.categories.find((item) => item.id === params.id) : undefined;
          if (params.id && !category) {
            throw new Error(`No category with id '${params.id}'. Omit 'id' to create one, or check ice_list_categories.`);
          }
          const created = !category;
          if (!category) {
            category = {
              id: uniqueId(params.name, db.categories.map((item) => item.id)),
              name: params.name,
              market_ids: [],
              primary_need: params.primary_need,
              target_customers: [],
              geographies: [],
              trend_direction: params.trend_direction,
              seasonality: params.seasonality,
              typical_price_min: null,
              typical_price_max: null,
              currency: params.currency,
              competitive_intensity: params.competitive_intensity,
              content_potential: "",
              repeat_or_bundle_potential: "",
              principal_risks: [],
              factors: {},
              score: 0,
              confidence: params.confidence,
              updated_at: nowIso(),
            } as Category;
            db.categories.push(category);
          }
          Object.assign(category, {
            name: params.name,
            primary_need: params.primary_need,
            target_customers: params.target_customers,
            geographies: params.geographies,
            trend_direction: params.trend_direction,
            seasonality: params.seasonality,
            typical_price_min: params.typical_price_min,
            typical_price_max: params.typical_price_max,
            currency: params.currency,
            competitive_intensity: params.competitive_intensity,
            content_potential: params.content_potential,
            repeat_or_bundle_potential: params.repeat_or_bundle_potential,
            principal_risks: params.principal_risks,
            market_ids: params.market_ids.length ? params.market_ids : category.market_ids,
            confidence: params.confidence,
          });
          if (params.notes !== undefined) category.notes = params.notes;
          category.factors = { ...category.factors, ...factors };
          const scored = scoreCategory(category.factors);
          category.score = scored.score;
          category.updated_at = nowIso();
          const gate = checkEvidenceGate(db.evidence, "category", category.id);
          return { category, scored, created, gate };
        });

        const structured = {
          category: result.category,
          score: result.scored.score,
          breakdown: result.scored.breakdown,
          missing_factors: result.scored.missing_factors,
          unclaimed_points: Math.round(result.scored.unrated_weight * 10) / 10,
          evidence_gate: {
            pass: result.gate.pass,
            independent_signal_count: result.gate.independent_signal_count,
            required: result.gate.required_independent_signals,
            reasons: result.gate.reasons,
          },
          created: result.created,
        };

        return respond("markdown", structured, () =>
          [
            `# ${result.created ? "Created" : "Updated"} category: ${result.category.name} (\`${result.category.id}\`)`,
            "",
            `**Score: ${result.scored.score}/100** — trend ${result.category.trend_direction}, competition ${result.category.competitive_intensity}, confidence ${result.category.confidence}`,
            "",
            table(
              ["Factor", "Rating", "Points"],
              result.scored.breakdown.map((row) => [row.factor, `${row.rating}/10`, `${row.points}/${row.max_points}`]),
            ),
            "",
            result.scored.missing_factors.length
              ? `Unrated factors forfeit ${structured.unclaimed_points} points: ${result.scored.missing_factors.join(", ")}`
              : "All eight factors rated.",
            "",
            `**Evidence gate: ${result.gate.pass ? "PASS" : "FAIL"}** — ${result.gate.independent_signal_count}/${result.gate.required_independent_signals} independent source domains.`,
            result.gate.reasons.length ? result.gate.reasons.map((reason) => `- ${reason}`).join("\n") : "",
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_list_categories",
    {
      title: "List categories, ranked by score",
      description: `List categories highest score first, with evidence-gate status and product counts. This produces the Phase B ranked table.

Args:
  - min_score (number, optional): Only categories at or above this score
  - trend_direction ('rising' | 'stable' | 'seasonal' | 'declining' | 'unproven', optional): Filter
  - passing_evidence_gate_only (boolean): Only categories with 3+ independent signals (default false)
  - limit (number): Max results, 1-100 (default 20)
  - offset (number): Results to skip (default 0)
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  {
    "total": number, "count": number, "offset": number, "has_more": boolean, "next_offset": number,
    "items": [{ "id": string, "name": string, "score": number, "trend_direction": string, "competitive_intensity": string, "confidence": string, "product_count": number, "evidence_signals": number, "evidence_gate_pass": boolean, "price_range": string, "principal_risks": string[] }]
  }

Examples:
  - Use when: producing the top-ten category table for the final report.
  - Use when: deciding which category to deep-dive into next.`,
      inputSchema: {
        min_score: z.number().min(0).max(100).optional().describe("Minimum category score"),
        trend_direction: TrendStatus.optional().describe("Filter by trend direction"),
        passing_evidence_gate_only: z.boolean().default(false).describe("Only categories that clear the 3-signal evidence gate"),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum results to return"),
        offset: z.number().int().min(0).default(0).describe("Number of results to skip"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ min_score, trend_direction, passing_evidence_gate_only, limit, offset, response_format }) =>
      guard(() => {
        const db = loadDb();
        const enriched = db.categories.map((category) => {
          const gate = checkEvidenceGate(db.evidence, "category", category.id);
          return {
            id: category.id,
            name: category.name,
            score: category.score,
            trend_direction: category.trend_direction,
            competitive_intensity: category.competitive_intensity,
            confidence: category.confidence,
            primary_need: category.primary_need,
            product_count: db.products.filter((product) => product.category_id === category.id).length,
            evidence_signals: gate.independent_signal_count,
            evidence_gate_pass: gate.pass,
            price_range:
              category.typical_price_min !== null && category.typical_price_max !== null
                ? `${category.currency} ${category.typical_price_min}-${category.typical_price_max}`
                : "not set",
            principal_risks: category.principal_risks,
          };
        });

        const filtered = enriched
          .filter((item) => (min_score === undefined ? true : item.score >= min_score))
          .filter((item) => (trend_direction ? item.trend_direction === trend_direction : true))
          .filter((item) => (passing_evidence_gate_only ? item.evidence_gate_pass : true))
          .sort((a, b) => b.score - a.score);

        const slice = filtered.slice(offset, offset + limit);
        const hasMore = filtered.length > offset + slice.length;
        const structured = {
          total: filtered.length,
          count: slice.length,
          offset,
          items: slice,
          has_more: hasMore,
          ...(hasMore ? { next_offset: offset + slice.length } : {}),
        };

        return respond(response_format, structured, () =>
          slice.length
            ? [
                "# Categories, ranked",
                "",
                table(
                  ["#", "Category", "Score", "Trend", "Competition", "Products", "Ind. signals", "Gate", "Confidence"],
                  slice.map((item, index) => [
                    offset + index + 1,
                    `${item.name} (${item.id})`,
                    item.score,
                    item.trend_direction,
                    item.competitive_intensity,
                    item.product_count,
                    item.evidence_signals,
                    item.evidence_gate_pass ? "PASS" : "FAIL",
                    item.confidence,
                  ]),
                ),
              ].join("\n")
            : "No categories match. Add one with ice_upsert_category or relax the filters.",
        );
      }),
  );

  server.registerTool(
    "ice_get_category",
    {
      title: "Get one category in full",
      description: `Return a single category with its full field set, factor breakdown, evidence gate status, evidence list and its products.

Args:
  - id (string): Category id
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  { "category": {...}, "score_breakdown": [...], "evidence_gate": {...}, "evidence": [{ "source_name": string, "url": string, "region": string, "period_covered": string, "is_supplier_source": boolean, "verification": string }], "products": [{ "id": string, "name": string, "score": number, "status": string }] }

Examples:
  - Use when: writing up a category section and you need every recorded field and source link.`,
      inputSchema: {
        id: z.string().min(1).describe("Category id"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, response_format }) =>
      guard(() => {
        const db = loadDb();
        const category = requireCategory(db, id);
        const scored = scoreCategory(category.factors);
        const gate = checkEvidenceGate(db.evidence, "category", id);
        const evidence = db.evidence.filter((item) => item.subject_type === "category" && item.subject_id === id);
        const products = db.products
          .filter((product) => product.category_id === id)
          .map((product) => ({ id: product.id, name: product.name, score: product.score, status: product.status }))
          .sort((a, b) => b.score - a.score);

        const structured = { category, score_breakdown: scored.breakdown, evidence_gate: gate, evidence, products };
        return respond(response_format, structured, () =>
          [
            `# ${category.name} (\`${category.id}\`)`,
            "",
            `**Score ${category.score}/100** — ${category.trend_direction}, competition ${category.competitive_intensity}, confidence ${category.confidence}`,
            "",
            `**Primary need:** ${category.primary_need}`,
            `**Target customers:** ${category.target_customers.join(", ") || "not set"}`,
            `**Geographies:** ${category.geographies.join(", ") || "not set"}`,
            `**Seasonality:** ${category.seasonality}`,
            `**Price range:** ${category.typical_price_min ?? "?"}-${category.typical_price_max ?? "?"} ${category.currency}`,
            `**Content potential:** ${category.content_potential || "not set"}`,
            `**Repeat/bundle potential:** ${category.repeat_or_bundle_potential || "not set"}`,
            `**Principal risks:** ${category.principal_risks.join("; ") || "none recorded"}`,
            "",
            "## Score breakdown",
            table(
              ["Factor", "Rating", "Points"],
              scored.breakdown.map((row) => [row.factor, `${row.rating}/10`, `${row.points}/${row.max_points}`]),
            ),
            "",
            `## Evidence gate: ${gate.pass ? "PASS" : "FAIL"} (${gate.independent_signal_count}/${gate.required_independent_signals} independent domains)`,
            evidence.length
              ? table(
                  ["Source", "URL", "Region", "Period", "Supplier source?", "Verification"],
                  evidence.map((item) => [
                    item.source_name,
                    item.url,
                    item.region,
                    item.period_covered,
                    item.is_supplier_source ? "yes" : "no",
                    item.verification,
                  ]),
                )
              : "- No evidence recorded.",
            "",
            "## Products",
            products.length
              ? table(["Product", "Score", "Status"], products.map((product) => [`${product.name} (${product.id})`, product.score, product.status]))
              : "- No products recorded in this category.",
          ].join("\n"),
        );
      }),
  );
}
