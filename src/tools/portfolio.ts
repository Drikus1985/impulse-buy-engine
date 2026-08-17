/** Section 9: select the fastest credible launch portfolio. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LAUNCH_SCORE_THRESHOLD } from "../constants.js";
import { guard, respond, table } from "../format.js";
import { assessLaunchReadiness, latestEconomics } from "../gates.js";
import { loadDb, mutate, nowIso } from "../store.js";
import { PortfolioSelection, responseFormatField } from "../types.js";

/** Normalises a free-text trigger so "saves time in the morning" and "Saves time, mornings" collide. */
function triggerKey(trigger: string): string {
  return trigger
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 3)
    .sort()
    .join("-") || "unspecified";
}

export function registerPortfolioTools(server: McpServer): void {
  server.registerTool(
    "ice_select_portfolio",
    {
      title: "Select the immediate-test, reserve and long-term portfolio",
      description: `Select 3 immediate-test products, 7 reserve products and 10 longer-term opportunities from the ledger, applying every gate, and store the selection.

Selection rules, applied in order:
  1. Any product with compliance verdict EXCLUDE is rejected outright and listed with its reason.
  2. Immediate-test candidates must pass EVERY launch gate: score >= ${LAUNCH_SCORE_THRESHOLD}, evidence gate, supplier gate, compliance gate, and the unit-economics screens.
  3. The three immediate products must have DISTINCT customer triggers, so the test is not three bets on the same demand. If fewer than three distinct triggers qualify, fewer than three are selected and the shortfall is explained rather than padded.
  4. Reserve takes the next highest scorers that are launch-ready or close to it.
  5. Long-term takes the remainder, including watch-list products below the score threshold and anything carrying a PENALISE verdict.

The tool will return fewer than three immediate products when the evidence does not support three. That is the correct behaviour, not a failure.

Args:
  - allow_duplicate_triggers (boolean): Permit immediate-test products sharing a trigger (default false)
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  {
    "immediate_test": [{ "product_id": string, "name": string, "score": number, "trigger": string, "pre_ad_contribution": number|null }],
    "reserve": [...], "long_term": [...],
    "rejected": [{ "product_id": string, "reasons": string[] }],
    "shortfall_notes": string[],
    "generated_at": string
  }

Examples:
  - Use when: you have finished scoring the product database and need the launch portfolio.
  - Use when: the user asks which three products to test first.`,
      inputSchema: {
        allow_duplicate_triggers: z.boolean().default(false).describe("Permit immediate-test products that share a customer trigger"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ allow_duplicate_triggers, response_format }) =>
      guard(() => {
        const result = mutate((db) => {
          const notes: string[] = [];
          const rejected: { product_id: string; reasons: string[] }[] = [];

          const ranked = [...db.products].sort((a, b) => b.score - a.score);
          const candidates = ranked.filter((product) => {
            const compliance = db.compliance.find((item) => item.product_id === product.id);
            if (compliance && compliance.verdict === "EXCLUDE") {
              rejected.push({ product_id: product.id, reasons: compliance.reasons });
              return false;
            }
            if (product.status === "rejected") {
              rejected.push({ product_id: product.id, reasons: ["Marked status='rejected' in the ledger."] });
              return false;
            }
            return true;
          });

          const readiness = new Map(candidates.map((product) => [product.id, assessLaunchReadiness(db, product)]));
          const ready = candidates.filter((product) => readiness.get(product.id)?.ready);

          const immediate: string[] = [];
          const usedTriggers = new Set<string>();
          for (const product of ready) {
            if (immediate.length >= 3) break;
            const key = triggerKey(product.trigger ?? "");
            if (!allow_duplicate_triggers && usedTriggers.has(key)) {
              notes.push(
                `${product.name} (${product.id}) was skipped for the immediate three because its trigger overlaps an already-selected product ("${product.trigger}"). It sits in reserve.`,
              );
              continue;
            }
            usedTriggers.add(key);
            immediate.push(product.id);
          }

          if (immediate.length < 3) {
            notes.push(
              `Only ${immediate.length} product(s) clear every launch gate with a distinct trigger. The shortfall is real: ${
                ready.length === 0
                  ? "no product currently passes all gates."
                  : `${ready.length} product(s) pass all gates in total.`
              } Fix the blocking gates rather than launching an unready product.`,
            );
          }

          const remaining = candidates.filter((product) => !immediate.includes(product.id));
          const reserve = remaining
            .filter((product) => {
              const check = readiness.get(product.id);
              return product.score >= LAUNCH_SCORE_THRESHOLD || (check ? check.blocking_reasons.length <= 2 : false);
            })
            .slice(0, 7)
            .map((product) => product.id);

          const longTerm = remaining
            .filter((product) => !reserve.includes(product.id))
            .slice(0, 10)
            .map((product) => product.id);

          for (const product of db.products) {
            if (immediate.includes(product.id)) product.status = "immediate_test";
            else if (reserve.includes(product.id)) product.status = "reserve";
            else if (longTerm.includes(product.id)) product.status = "long_term";
            else if (rejected.some((item) => item.product_id === product.id)) product.status = "rejected";
            else if (product.score < LAUNCH_SCORE_THRESHOLD) product.status = "watchlist";
          }

          const selection: PortfolioSelection = {
            immediate_test: immediate,
            reserve,
            long_term: longTerm,
            rejected,
            diversity_report: immediate.map((id) => ({
              product_id: id,
              trigger: db.products.find((product) => product.id === id)?.trigger ?? "",
            })),
            generated_at: nowIso(),
            notes,
          };
          db.portfolio = selection;

          const describe = (ids: string[]) =>
            ids.map((id) => {
              const product = db.products.find((item) => item.id === id);
              const economics = latestEconomics(db, id);
              return {
                product_id: id,
                name: product?.name ?? "(unknown)",
                score: product?.score ?? 0,
                trigger: product?.trigger ?? "",
                category_id: product?.category_id ?? "",
                pre_ad_contribution: economics ? economics.pre_ad_contribution : null,
                currency: economics ? economics.inputs.currency : (product?.currency ?? ""),
                blocking_reasons: readiness.get(id)?.blocking_reasons ?? [],
              };
            });

          return {
            immediate_test: describe(immediate),
            reserve: describe(reserve),
            long_term: describe(longTerm),
            rejected,
            shortfall_notes: notes,
            generated_at: selection.generated_at,
          };
        });

        return respond(response_format, result, () =>
          [
            "# Launch portfolio",
            "",
            `## Immediate test (${result.immediate_test.length}/3)`,
            result.immediate_test.length
              ? table(
                  ["Product", "Score", "Category", "Trigger", "Pre-ad contribution"],
                  result.immediate_test.map((item) => [
                    `${item.name} (${item.product_id})`,
                    item.score,
                    item.category_id,
                    item.trigger,
                    item.pre_ad_contribution === null ? "n/a" : `${item.currency} ${item.pre_ad_contribution}`,
                  ]),
                )
              : "- Nothing qualifies yet.",
            "",
            `## Reserve (${result.reserve.length})`,
            result.reserve.length
              ? table(
                  ["Product", "Score", "Blocking"],
                  result.reserve.map((item) => [`${item.name} (${item.product_id})`, item.score, item.blocking_reasons.join("; ") || "none"]),
                )
              : "- None.",
            "",
            `## Longer-term (${result.long_term.length})`,
            result.long_term.length
              ? table(["Product", "Score", "Blocking"], result.long_term.map((item) => [`${item.name} (${item.product_id})`, item.score, item.blocking_reasons.join("; ") || "none"]))
              : "- None.",
            "",
            `## Rejected (${result.rejected.length})`,
            result.rejected.length
              ? table(["Product", "Reasons"], result.rejected.map((item) => [item.product_id, item.reasons.join(" ")]))
              : "- None.",
            "",
            result.shortfall_notes.length ? "## Notes\n" + result.shortfall_notes.map((note) => `- ${note}`).join("\n") : "",
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_launch_readiness",
    {
      title: "Check launch readiness across products",
      description: `Run every launch gate over one product or all products and return exactly what is blocking each.

Checks applied per product: score threshold (${LAUNCH_SCORE_THRESHOLD}), evidence gate, supplier gate, compliance gate, unit-economics screens.

Args:
  - product_id (string, optional): Check one product. Omit to check all.
  - only_blocked (boolean): Return only products with at least one failing gate (default false)
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  { "total": number, "ready_count": number, "items": [{ "product_id": string, "product_name": string, "score": number, "ready": boolean, "checks": [{ "name": string, "pass": boolean, "detail": string }], "blocking_reasons": string[] }] }

Examples:
  - Use when: the user asks what still needs doing before the first test.
  - Use when: you want the shortest path to getting one product launch-ready.`,
      inputSchema: {
        product_id: z.string().optional().describe("Check a single product; omit for all"),
        only_blocked: z.boolean().default(false).describe("Only return products with a failing gate"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ product_id, only_blocked, response_format }) =>
      guard(() => {
        const db = loadDb();
        const products = product_id ? db.products.filter((product) => product.id === product_id) : db.products;
        if (product_id && products.length === 0) throw new Error(`No product with id '${product_id}'.`);
        const items = products
          .map((product) => assessLaunchReadiness(db, product))
          .filter((item) => (only_blocked ? !item.ready : true))
          .sort((a, b) => b.score - a.score);

        const structured = { total: items.length, ready_count: items.filter((item) => item.ready).length, items };
        return respond(response_format, structured, () =>
          items.length
            ? [
                `# Launch readiness (${structured.ready_count}/${items.length} ready)`,
                "",
                ...items.map((item) =>
                  [
                    `## ${item.product_name} (\`${item.product_id}\`) — ${item.ready ? "READY" : "NOT READY"}`,
                    table(["Check", "Result", "Detail"], item.checks.map((check) => [check.name, check.pass ? "PASS" : "FAIL", check.detail])),
                    "",
                  ].join("\n"),
                ),
              ].join("\n")
            : "No products to assess.",
        );
      }),
  );
}
