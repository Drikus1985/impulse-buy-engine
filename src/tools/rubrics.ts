/** Rubric disclosure and ledger overview tools. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CATEGORY_WEIGHTS,
  DUE_DILIGENCE_ITEMS,
  ECONOMICS_THRESHOLDS,
  EVIDENCE_GATES,
  HARD_EXCLUSION_FLAGS,
  LAUNCH_SCORE_THRESHOLD,
  MARKET_CRITERIA,
  PRODUCT_WEIGHTS,
  SOFT_EXCLUSION_FLAGS,
  SUPPLIER_GATES,
} from "../constants.js";
import { bullets, guard, respond, table } from "../format.js";
import { DB_PATH, loadDb, mutate } from "../store.js";
import { responseFormatField } from "../types.js";

export function registerRubricTools(server: McpServer): void {
  server.registerTool(
    "ice_get_rubrics",
    {
      title: "Get scoring rubrics, gates and thresholds",
      description: `Return every rubric, weight, gate and screening threshold this server enforces, so scores and verdicts are never guessed.

Call this FIRST in a new research session. It tells you exactly which factor keys ice_upsert_category and ice_upsert_product expect, how each is weighted, and what the evidence, supplier, compliance and economics gates require.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns (JSON):
  {
    "category_weights": { "<factor>": number },       // 8 factors, weights sum to 100
    "product_weights": { "<factor>": number },        // 10 factors, weights sum to 100
    "market_criteria": string[],                      // 12 equally weighted criteria
    "launch_score_threshold": number,                 // below this a product is watch-list only
    "economics_thresholds": { "max_landed_cost_ratio": number, "min_pre_ad_contribution_margin": number, "min_post_ad_contribution_margin": number },
    "evidence_gates": { "category_min_independent_signals": number, "product_min_independent_signals": number, "product_min_non_supplier_signals": number },
    "supplier_gates": { "min_supply_options": number, "min_supply_options_hard_floor": number },
    "hard_exclusion_flags": string[],                 // block a launch recommendation outright
    "soft_exclusion_flags": string[],                 // cap the verdict at PENALISE
    "due_diligence_items": string[]
  }

All factor ratings are on a 0-10 scale where 10 is best. Score = sum(rating / 10 x weight).

Examples:
  - Use when: starting research and you need the exact factor keys to rate.
  - Use when: you want to explain to a user why a product scored 63.5.
  - Don't use when: you want a specific product's score (use ice_get_product).`,
      inputSchema: { response_format: responseFormatField },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ response_format }) =>
      guard(() => {
        const structured = {
          category_weights: CATEGORY_WEIGHTS,
          product_weights: PRODUCT_WEIGHTS,
          market_criteria: MARKET_CRITERIA,
          launch_score_threshold: LAUNCH_SCORE_THRESHOLD,
          economics_thresholds: ECONOMICS_THRESHOLDS,
          evidence_gates: EVIDENCE_GATES,
          supplier_gates: SUPPLIER_GATES,
          hard_exclusion_flags: HARD_EXCLUSION_FLAGS,
          soft_exclusion_flags: SOFT_EXCLUSION_FLAGS,
          due_diligence_items: DUE_DILIGENCE_ITEMS,
          rating_scale: "Every factor is rated 0-10 where 10 is best. Score = sum(rating / 10 x weight).",
        };
        return respond(response_format, structured, () =>
          [
            "# Scoring rubrics and gates",
            "",
            "All factors are rated 0-10 (10 = best). Score = sum(rating / 10 x weight).",
            "",
            "## Category score (100 points)",
            table(["Factor", "Weight"], Object.entries(CATEGORY_WEIGHTS)),
            "",
            "## Product score (100 points)",
            table(["Factor", "Weight"], Object.entries(PRODUCT_WEIGHTS)),
            "",
            `Products scoring below **${LAUNCH_SCORE_THRESHOLD}** are watch-list ideas, not launch recommendations.`,
            "",
            "## Market criteria (12, equally weighted, higher = more favourable)",
            bullets([...MARKET_CRITERIA]),
            "",
            "## Economics screening thresholds",
            table(
              ["Screen", "Threshold"],
              [
                ["Landed cost / net price", `<= ${ECONOMICS_THRESHOLDS.max_landed_cost_ratio}`],
                ["Pre-ad contribution margin", `>= ${ECONOMICS_THRESHOLDS.min_pre_ad_contribution_margin}`],
                ["Post-ad contribution margin", `>= ${ECONOMICS_THRESHOLDS.min_post_ad_contribution_margin}`],
              ],
            ),
            "",
            "## Evidence gates (independence = distinct source domain)",
            bullets([
              `Category: >= ${EVIDENCE_GATES.category_min_independent_signals} independent signals`,
              `Product: >= ${EVIDENCE_GATES.product_min_independent_signals} independent signals`,
              `Product: >= ${EVIDENCE_GATES.product_min_non_supplier_signals} non-supplier signal`,
            ]),
            "",
            "## Supplier gate",
            bullets([
              `Target ${SUPPLIER_GATES.min_supply_options} supply options, hard floor ${SUPPLIER_GATES.min_supply_options_hard_floor}`,
              "A backup supplier is required",
            ]),
            "",
            "## Hard exclusion flags (block launch recommendations)",
            bullets([...HARD_EXCLUSION_FLAGS]),
            "",
            "## Soft risk flags (cap verdict at PENALISE)",
            bullets([...SOFT_EXCLUSION_FLAGS]),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_ledger_stats",
    {
      title: "Summarise the research ledger",
      description: `Report what the persistent research ledger currently holds and where it is stored.

Use this to orient yourself at the start of a session before adding anything, and to check whether prior research already covers a market, category or product.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns (JSON):
  {
    "database_path": string,
    "created_at": string,          // ISO timestamp
    "updated_at": string,
    "counts": { "markets": number, "categories": number, "products": number, "evidence": number, "suppliers": number, "economics_runs": number, "compliance_screens": number },
    "products_by_status": { "<status>": number },
    "categories": [{ "id": string, "name": string, "score": number, "product_count": number }],
    "has_portfolio": boolean
  }

Examples:
  - Use when: resuming research in a new session and you need to know what exists.
  - Use when: the user asks "how far are we through the 100-product database?".`,
      inputSchema: { response_format: responseFormatField },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ response_format }) =>
      guard(() => {
        const db = loadDb();
        const byStatus: Record<string, number> = {};
        for (const product of db.products) byStatus[product.status] = (byStatus[product.status] ?? 0) + 1;
        const categories = db.categories.map((category) => ({
          id: category.id,
          name: category.name,
          score: category.score,
          product_count: db.products.filter((product) => product.category_id === category.id).length,
        }));
        const structured = {
          database_path: DB_PATH,
          created_at: db.created_at,
          updated_at: db.updated_at,
          counts: {
            markets: db.markets.length,
            categories: db.categories.length,
            products: db.products.length,
            evidence: db.evidence.length,
            suppliers: db.suppliers.length,
            economics_runs: db.economics.length,
            compliance_screens: db.compliance.length,
          },
          products_by_status: byStatus,
          categories,
          has_portfolio: db.portfolio !== null,
        };
        return respond(response_format, structured, () =>
          [
            "# Research ledger",
            "",
            `Stored at \`${DB_PATH}\` (last updated ${db.updated_at}).`,
            "",
            table(
              ["Record type", "Count"],
              Object.entries(structured.counts).map(([key, value]) => [key, value]),
            ),
            "",
            "## Products by status",
            Object.keys(byStatus).length ? table(["Status", "Count"], Object.entries(byStatus)) : "- (no products yet)",
            "",
            "## Categories",
            categories.length
              ? table(
                  ["ID", "Name", "Score", "Products"],
                  categories.map((category) => [category.id, category.name, category.score, category.product_count]),
                )
              : "- (no categories yet)",
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_delete_record",
    {
      title: "Delete a record from the ledger",
      description: `Permanently delete one record from the research ledger. This cannot be undone.

Deleting a category or product also deletes the records that hang off it (a product's evidence, suppliers, economics runs and compliance screens; a category's products and their dependents), because orphaned children silently corrupt later gate checks.

Args:
  - record_type ('market' | 'category' | 'product' | 'evidence' | 'supplier'): What to delete
  - id (string): The record id
  - confirm (boolean): Must be true. Guards against accidental deletion.

Returns (JSON):
  { "deleted": { "type": string, "id": string }, "cascaded": { "products": number, "evidence": number, "suppliers": number, "economics": number, "compliance": number } }

Examples:
  - Use when: a product was entered twice and one copy must go.
  - Don't use when: you merely want to stop recommending a product - set status='rejected' with ice_upsert_product instead, which preserves the research trail.`,
      inputSchema: {
        record_type: z.enum(["market", "category", "product", "evidence", "supplier"]).describe("Type of record to delete"),
        id: z.string().min(1).describe("Record id"),
        confirm: z.literal(true).describe("Must be true to proceed"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ record_type, id }) =>
      guard(() => {
        const cascaded = { products: 0, evidence: 0, suppliers: 0, economics: 0, compliance: 0 };
        const result = mutate((db) => {
          const removeProduct = (productId: string): void => {
            cascaded.evidence += db.evidence.filter((item) => item.subject_type === "product" && item.subject_id === productId).length;
            db.evidence = db.evidence.filter((item) => !(item.subject_type === "product" && item.subject_id === productId));
            cascaded.suppliers += db.suppliers.filter((item) => item.product_id === productId).length;
            db.suppliers = db.suppliers.filter((item) => item.product_id !== productId);
            cascaded.economics += db.economics.filter((item) => item.product_id === productId).length;
            db.economics = db.economics.filter((item) => item.product_id !== productId);
            cascaded.compliance += db.compliance.filter((item) => item.product_id === productId).length;
            db.compliance = db.compliance.filter((item) => item.product_id !== productId);
          };

          switch (record_type) {
            case "market": {
              if (!db.markets.some((market) => market.id === id)) throw new Error(`No market with id '${id}'.`);
              db.markets = db.markets.filter((market) => market.id !== id);
              break;
            }
            case "category": {
              if (!db.categories.some((category) => category.id === id)) throw new Error(`No category with id '${id}'.`);
              const children = db.products.filter((product) => product.category_id === id);
              for (const child of children) removeProduct(child.id);
              cascaded.products += children.length;
              db.products = db.products.filter((product) => product.category_id !== id);
              db.evidence = db.evidence.filter((item) => !(item.subject_type === "category" && item.subject_id === id));
              db.categories = db.categories.filter((category) => category.id !== id);
              break;
            }
            case "product": {
              if (!db.products.some((product) => product.id === id)) throw new Error(`No product with id '${id}'.`);
              removeProduct(id);
              db.products = db.products.filter((product) => product.id !== id);
              break;
            }
            case "evidence": {
              if (!db.evidence.some((item) => item.id === id)) throw new Error(`No evidence with id '${id}'.`);
              db.evidence = db.evidence.filter((item) => item.id !== id);
              break;
            }
            case "supplier": {
              if (!db.suppliers.some((item) => item.id === id)) throw new Error(`No supplier with id '${id}'.`);
              db.suppliers = db.suppliers.filter((item) => item.id !== id);
              break;
            }
          }
          db.portfolio = null;
          return { deleted: { type: record_type, id }, cascaded };
        });
        return respond("markdown", result, () =>
          `Deleted ${record_type} \`${id}\`. Cascaded deletions: ${JSON.stringify(cascaded)}. The saved portfolio selection was cleared because the underlying data changed.`,
        );
      }),
  );
}
