/** Phase A: launch-market comparison and selection. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MARKET_CRITERIA } from "../constants.js";
import { bullets, guard, respond, table } from "../format.js";
import { scoreMarket } from "../scoring.js";
import { loadDb, mutate, nowIso, uniqueId } from "../store.js";
import { Confidence, MarketRole, Market, Rating, currencyField, responseFormatField } from "../types.js";

const criterionField = (description: string) => Rating.optional().describe(`${description} (0-10, higher = more favourable)`);

export function registerMarketTools(server: McpServer): void {
  server.registerTool(
    "ice_upsert_market",
    {
      title: "Create or update a launch-market assessment",
      description: `Record or update a candidate launch market and compute its weighted score from the 12 Phase A criteria.

All 12 criteria are phrased so that HIGHER IS ALWAYS BETTER. Rate 0-10. Note the inversions: 'low_customs_and_import_friction' = 10 means almost no friction; 'low_competitive_intensity' = 10 means a wide-open market. Unrated criteria simply forfeit their share of the score, and the response tells you how many points are unclaimed.

Args:
  - id (string, optional): Existing market id to update. Omit to create; the id is slugified from the name.
  - name (string): Market name, e.g. "South Africa"
  - country_code (string): ISO 3166-1 alpha-2, e.g. "ZA"
  - role ('home' | 'candidate' | 'beachhead' | 'secondary' | 'postponed'): Role in the plan (default 'candidate')
  - currency (string): ISO currency code (default 'ZAR')
  - confidence ('Certain' | 'Likely' | 'Guessing'): Evidence confidence for this assessment (default 'Guessing')
  - notes (string, optional): Free-text findings, including payment/marketplace/fulfilment availability actually verified
  - sourcing_recommendation (string, optional): Whether local sourcing, importing or cross-border fulfilment fits this market
  - <12 criteria> (number 0-10, optional): ecommerce_and_social_commerce_demand, consumer_purchasing_power, payment_method_availability, customer_acquisition_conditions, marketplace_accessibility, delivery_speed_and_cost, low_customs_and_import_friction, low_returns_complexity, low_regulatory_burden, low_localisation_requirement, low_competitive_intensity, short_path_to_first_revenue

Returns (JSON):
  {
    "market": { "id": string, "name": string, "country_code": string, "role": string, "score": number, "confidence": string, ... },
    "score": number,                 // 0-100
    "breakdown": [{ "factor": string, "rating": number, "weight": number, "points": number }],
    "missing_factors": string[],
    "unclaimed_points": number,      // score you forfeited by not rating those factors
    "created": boolean
  }

Examples:
  - Use when: comparing South Africa against four expansion markets before choosing a beachhead.
  - Use when: upgrading a market from 'candidate' to 'beachhead' after the comparison.
  - Don't use when: recording demand evidence (use ice_add_evidence with subject_type='market').`,
      inputSchema: {
        id: z.string().min(1).optional().describe("Existing market id to update; omit to create a new one"),
        name: z.string().min(1).max(120).describe("Market name"),
        country_code: z.string().length(2).describe("ISO 3166-1 alpha-2 country code"),
        role: MarketRole.default("candidate").describe("Role of this market in the plan"),
        currency: currencyField,
        confidence: Confidence.default("Guessing").describe("Evidence confidence for this assessment"),
        notes: z.string().max(4000).optional().describe("Findings, including verified payment/marketplace/fulfilment availability"),
        sourcing_recommendation: z
          .string()
          .max(1000)
          .optional()
          .describe("Whether local sourcing, importing or cross-border fulfilment fits this market"),
        ecommerce_and_social_commerce_demand: criterionField("Ecommerce and social-commerce demand"),
        consumer_purchasing_power: criterionField("Consumer purchasing power"),
        payment_method_availability: criterionField("Payment-method availability"),
        customer_acquisition_conditions: criterionField("Customer-acquisition conditions"),
        marketplace_accessibility: criterionField("Marketplace accessibility"),
        delivery_speed_and_cost: criterionField("Delivery speed and cost"),
        low_customs_and_import_friction: criterionField("Absence of customs and import friction"),
        low_returns_complexity: criterionField("Absence of returns complexity"),
        low_regulatory_burden: criterionField("Absence of regulatory burden"),
        low_localisation_requirement: criterionField("Absence of language and localisation requirements"),
        low_competitive_intensity: criterionField("Absence of competitive intensity"),
        short_path_to_first_revenue: criterionField("Shortness of the expected path to first revenue"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) =>
      guard(() => {
        const criteria: Record<string, number> = {};
        for (const criterion of MARKET_CRITERIA) {
          const value = (params as Record<string, unknown>)[criterion];
          if (typeof value === "number") criteria[criterion] = value;
        }
        const scored = scoreMarket(criteria);

        const result = mutate((db) => {
          let market = params.id ? db.markets.find((item) => item.id === params.id) : undefined;
          if (params.id && !market) {
            throw new Error(`No market with id '${params.id}'. Omit 'id' to create a new market, or check ice_list_markets.`);
          }
          const created = !market;
          if (!market) {
            market = {
              id: uniqueId(params.name, db.markets.map((item) => item.id)),
              name: params.name,
              country_code: params.country_code.toUpperCase(),
              role: params.role,
              currency: params.currency,
              criteria: {},
              score: 0,
              score_basis: "12 equally weighted criteria, each rated 0-10",
              confidence: params.confidence,
              updated_at: nowIso(),
            } as Market;
            db.markets.push(market);
          }
          market.name = params.name;
          market.country_code = params.country_code.toUpperCase();
          market.role = params.role;
          market.currency = params.currency;
          market.confidence = params.confidence;
          if (params.notes !== undefined) market.notes = params.notes;
          if (params.sourcing_recommendation !== undefined) market.sourcing_recommendation = params.sourcing_recommendation;
          market.criteria = { ...market.criteria, ...criteria };
          const rescored = scoreMarket(market.criteria as Record<string, number>);
          market.score = rescored.score;
          market.updated_at = nowIso();
          return { market, rescored, created };
        });

        const structured = {
          market: result.market,
          score: result.rescored.score,
          breakdown: result.rescored.breakdown,
          missing_factors: result.rescored.missing_factors,
          unclaimed_points: Math.round(result.rescored.unrated_weight * 10) / 10,
          created: result.created,
        };
        return respond("markdown", structured, () =>
          [
            `# ${result.created ? "Created" : "Updated"} market: ${result.market.name} (\`${result.market.id}\`)`,
            "",
            `**Score: ${result.rescored.score}/100** — role: ${result.market.role}, confidence: ${result.market.confidence}`,
            result.rescored.missing_factors.length
              ? `\nUnrated criteria forfeit ${structured.unclaimed_points} points: ${result.rescored.missing_factors.join(", ")}`
              : "\nAll 12 criteria rated.",
            "",
            table(
              ["Criterion", "Rating", "Points"],
              result.rescored.breakdown.map((row) => [row.factor, `${row.rating}/10`, `${row.points}/${row.max_points}`]),
            ),
          ].join("\n"),
        );
      }),
    );

  server.registerTool(
    "ice_list_markets",
    {
      title: "List assessed markets, ranked by score",
      description: `List every market in the ledger, highest score first, with the criteria that dragged each one down.

Args:
  - role ('home' | 'candidate' | 'beachhead' | 'secondary' | 'postponed', optional): Filter by role
  - limit (number): Max results, 1-100 (default 20)
  - offset (number): Results to skip (default 0)
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  {
    "total": number, "count": number, "offset": number, "has_more": boolean, "next_offset": number,
    "items": [{ "id": string, "name": string, "country_code": string, "role": string, "score": number, "confidence": string, "weakest_criteria": [{ "factor": string, "rating": number }], "unrated_criteria": string[] }]
  }

Examples:
  - Use when: choosing a beachhead after scoring five candidate markets.
  - Use when: showing the user why a market was postponed.`,
      inputSchema: {
        role: MarketRole.optional().describe("Filter by role"),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum results to return"),
        offset: z.number().int().min(0).default(0).describe("Number of results to skip"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ role, limit, offset, response_format }) =>
      guard(() => {
        const db = loadDb();
        const filtered = db.markets
          .filter((market) => (role ? market.role === role : true))
          .sort((a, b) => b.score - a.score);
        const slice = filtered.slice(offset, offset + limit);
        const items = slice.map((market) => {
          const rated = Object.entries(market.criteria).filter(([, value]) => typeof value === "number") as [string, number][];
          const weakest = [...rated].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([factor, rating]) => ({ factor, rating }));
          return {
            id: market.id,
            name: market.name,
            country_code: market.country_code,
            role: market.role,
            score: market.score,
            confidence: market.confidence,
            currency: market.currency,
            weakest_criteria: weakest,
            unrated_criteria: scoreMarket(market.criteria as Record<string, number>).missing_factors,
            sourcing_recommendation: market.sourcing_recommendation ?? null,
          };
        });
        const hasMore = filtered.length > offset + slice.length;
        const structured = {
          total: filtered.length,
          count: items.length,
          offset,
          items,
          has_more: hasMore,
          ...(hasMore ? { next_offset: offset + slice.length } : {}),
        };
        return respond(response_format, structured, () =>
          items.length
            ? [
                "# Markets, ranked",
                "",
                table(
                  ["Rank", "Market", "Role", "Score", "Confidence", "Weakest criteria"],
                  items.map((item, index) => [
                    offset + index + 1,
                    `${item.name} (${item.id})`,
                    item.role,
                    item.score,
                    item.confidence,
                    item.weakest_criteria.map((weak) => `${weak.factor} ${weak.rating}/10`).join("; ") || "n/a",
                  ]),
                ),
                "",
                items.some((item) => item.unrated_criteria.length)
                  ? "Unrated criteria (scores below are understated):\n" +
                    bullets(
                      items
                        .filter((item) => item.unrated_criteria.length)
                        .map((item) => `${item.name}: ${item.unrated_criteria.join(", ")}`),
                    )
                  : "All listed markets are fully rated.",
              ].join("\n")
            : "No markets recorded yet. Add one with ice_upsert_market.",
        );
      }),
  );
}
