/** Section 5: the safety, IP and exclusion gate. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HARD_EXCLUSION_FLAGS, SOFT_EXCLUSION_FLAGS } from "../constants.js";
import { guard, respond, table } from "../format.js";
import { assessCompliance } from "../gates.js";
import { loadDb, mutate, requireProduct } from "../store.js";
import { ExclusionFlagEnum, responseFormatField } from "../types.js";

export function registerComplianceTools(server: McpServer): void {
  server.registerTool(
    "ice_screen_compliance",
    {
      title: "Screen a product against the exclusion gate",
      description: `Apply the section 5 safety, IP and exclusion gate to a product and store the verdict.

Hard flags (EXCLUDE unless mitigated with recorded evidence): ${HARD_EXCLUSION_FLAGS.join(", ")}.
Soft flags (cap the verdict at PENALISE): ${SOFT_EXCLUSION_FLAGS.join(", ")}.

Verdicts:
  PASS     - no flags recorded. Only as good as the screening you actually did.
  PENALISE - soft flags present, or a hard flag cleared by recorded mitigation. Usable, but as a longer-term opportunity with the risk priced in, not a quick-start recommendation.
  EXCLUDE  - an unmitigated hard flag. The product cannot be recommended for launch.

A mitigation only counts if 'evidence' describes what was actually checked. "Supplier says it is certified" is not a mitigation; "SABS certificate 12345 sighted and verified on sabs.co.za, 2026-08-17" is.

Args:
  - product_id (string): Product id
  - flags (string[]): Applicable exclusion flags (empty array if none apply)
  - mitigations (array of { flag: string, evidence: string }): Verified mitigations clearing specific hard flags
  - notes (string): Free-text reasoning, including what you checked and could not confirm
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  { "verdict": "PASS"|"PENALISE"|"EXCLUDE", "hard_flags_active": string[], "hard_flags_mitigated": string[], "soft_flags_active": string[], "launch_eligible": boolean, "reasons": string[], "assessed_at": string }

Examples:
  - Use when: a product is an electrical device and you need to record that certification is unresolved.
  - Use when: clearing a design-right concern after an actual register search.
  - Don't use when: you have not looked. Recording an empty flag list without screening produces a false PASS.`,
      inputSchema: {
        product_id: z.string().min(1).describe("Product id"),
        flags: z.array(ExclusionFlagEnum).default([]).describe("Applicable exclusion flags"),
        mitigations: z
          .array(
            z.object({
              flag: ExclusionFlagEnum.describe("Flag being mitigated"),
              evidence: z.string().min(1).max(1000).describe("What was actually checked, with source and date"),
            }),
          )
          .default([])
          .describe("Verified mitigations clearing specific hard flags"),
        notes: z.string().max(4000).default("").describe("Screening reasoning, including what could not be confirmed"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ product_id, flags, mitigations, notes, response_format }) =>
      guard(() => {
        const result = mutate((db) => {
          requireProduct(db, product_id);
          const assessment = assessCompliance(product_id, flags, mitigations, notes);
          db.compliance = db.compliance.filter((item) => item.product_id !== product_id);
          db.compliance.push(assessment);
          return assessment;
        });

        return respond(response_format, result as unknown as Record<string, unknown>, () =>
          [
            `# Compliance screen: \`${product_id}\``,
            "",
            `**Verdict: ${result.verdict}** — ${result.launch_eligible ? "may proceed" : "cannot be recommended for launch"}`,
            "",
            result.hard_flags_active.length ? `- Hard flags ACTIVE: ${result.hard_flags_active.join(", ")}` : "- No active hard flags.",
            result.hard_flags_mitigated.length ? `- Hard flags mitigated: ${result.hard_flags_mitigated.join(", ")}` : "",
            result.soft_flags_active.length ? `- Soft flags: ${result.soft_flags_active.join(", ")}` : "- No soft flags.",
            "",
            result.reasons.map((reason) => `- ${reason}`).join("\n"),
            result.mitigations.length
              ? "\n## Recorded mitigations\n" + table(["Flag", "Evidence"], result.mitigations.map((item) => [item.flag, item.evidence]))
              : "",
            notes ? `\n## Notes\n${notes}` : "",
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_compliance_register",
    {
      title: "List the compliance and IP risk register",
      description: `Return the compliance verdict for every screened product, plus the products that have never been screened.

Unscreened products are the point of this tool: a product with no compliance record is not "clean", it is unexamined, and it cannot pass launch readiness.

Args:
  - verdict ('PASS' | 'PENALISE' | 'EXCLUDE', optional): Filter by verdict
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  {
    "screened": [{ "product_id": string, "product_name": string, "verdict": string, "hard_flags_active": string[], "soft_flags_active": string[], "launch_eligible": boolean, "assessed_at": string }],
    "unscreened": [{ "product_id": string, "product_name": string, "score": number }],
    "counts": { "PASS": number, "PENALISE": number, "EXCLUDE": number, "unscreened": number }
  }

Examples:
  - Use when: assembling the risk, compliance and IP register for the final report.
  - Use when: checking nothing excluded has crept into the shortlist.`,
      inputSchema: {
        verdict: z.enum(["PASS", "PENALISE", "EXCLUDE"]).optional().describe("Filter by verdict"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ verdict, response_format }) =>
      guard(() => {
        const db = loadDb();
        const screened = db.compliance
          .filter((item) => (verdict ? item.verdict === verdict : true))
          .map((item) => ({
            product_id: item.product_id,
            product_name: db.products.find((product) => product.id === item.product_id)?.name ?? "(deleted product)",
            verdict: item.verdict,
            hard_flags_active: item.hard_flags_active,
            soft_flags_active: item.soft_flags_active,
            launch_eligible: item.launch_eligible,
            assessed_at: item.assessed_at,
          }));
        const screenedIds = new Set(db.compliance.map((item) => item.product_id));
        const unscreened = db.products
          .filter((product) => !screenedIds.has(product.id))
          .map((product) => ({ product_id: product.id, product_name: product.name, score: product.score }))
          .sort((a, b) => b.score - a.score);

        const counts = {
          PASS: db.compliance.filter((item) => item.verdict === "PASS").length,
          PENALISE: db.compliance.filter((item) => item.verdict === "PENALISE").length,
          EXCLUDE: db.compliance.filter((item) => item.verdict === "EXCLUDE").length,
          unscreened: unscreened.length,
        };

        return respond(response_format, { screened, unscreened, counts }, () =>
          [
            "# Compliance and IP register",
            "",
            `PASS ${counts.PASS} · PENALISE ${counts.PENALISE} · EXCLUDE ${counts.EXCLUDE} · never screened ${counts.unscreened}`,
            "",
            screened.length
              ? table(
                  ["Product", "Verdict", "Hard flags", "Soft flags", "Assessed"],
                  screened.map((item) => [
                    `${item.product_name} (${item.product_id})`,
                    item.verdict,
                    item.hard_flags_active.join(", ") || "-",
                    item.soft_flags_active.join(", ") || "-",
                    item.assessed_at.slice(0, 10),
                  ]),
                )
              : "No products screened yet.",
            "",
            "## Never screened",
            unscreened.length
              ? table(["Product", "Score"], unscreened.map((item) => [`${item.product_name} (${item.product_id})`, item.score]))
              : "- None. Every product has been screened.",
          ].join("\n"),
        );
      }),
  );
}
