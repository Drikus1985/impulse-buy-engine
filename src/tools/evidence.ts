/** Demand-evidence ledger and the independence gate. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { guard, respond, table } from "../format.js";
import { checkEvidenceGate } from "../gates.js";
import { findCategory, findMarket, findProduct, loadDb, mutate, nowIso, uniqueId } from "../store.js";
import { Evidence, Verification, responseFormatField } from "../types.js";

const SubjectType = z.enum(["category", "product", "market"]);

function domainOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    throw new Error(
      `'${url}' is not a valid absolute URL. Record the direct link to the source, e.g. https://trends.google.com/... . If there genuinely is no URL, use a placeholder scheme such as offline://supplier-quote-2026-08-17 and set verification='unavailable'.`,
    );
  }
}

export function registerEvidenceTools(server: McpServer): void {
  server.registerTool(
    "ice_add_evidence",
    {
      title: "Record a demand signal with its source",
      description: `Record one demand signal against a market, category or product, with its direct source link, region, period covered and whether it came from the supplier.

Independence is measured by DISTINCT SOURCE DOMAIN. Three links to the same site count as one signal. The domain is derived from the URL automatically, so you cannot inflate a count by relabelling a source.

Set is_supplier_source=true for supplier order counts, AliExpress/Alibaba listing pages, and any figure the seller controls. A product cannot clear its gate on supplier signals alone.

Set verification='verified' only if you actually confirmed the figure at the source. Use 'estimated' for your own inference and 'unavailable' where the number could not be checked.

Args:
  - subject_type ('category' | 'product' | 'market'): What the signal is about
  - subject_id (string): Id of that market, category or product (must exist)
  - source_name (string): Human name of the source, e.g. "Google Trends"
  - url (string): Direct link to the source. Must be a valid absolute URL.
  - region (string): Country or region the signal represents, e.g. "ZA" or "Global"
  - period_covered (string): Time period the signal covers, e.g. "90 days to 2026-08-17"
  - signal_type (string): What kind of signal, e.g. "search interest", "review velocity", "ad longevity"
  - summary (string): What the signal actually shows, in one or two sentences
  - is_supplier_source (boolean): True if the source is the supplier or a seller-controlled listing
  - verification ('verified' | 'estimated' | 'unavailable'): Verification state (default 'estimated')
  - observed_on (string, optional): ISO date you observed it (default: today)

Returns (JSON):
  { "evidence": {...}, "gate": { "pass": boolean, "independent_signal_count": number, "non_supplier_signal_count": number, "required_independent_signals": number, "reasons": string[] } }

The gate status for the subject is returned on every write so you always know how many more independent signals are needed.

Examples:
  - Use when: you found rising 90-day Google Trends interest for a category in ZA.
  - Use when: you found a long-running Meta ad with repeated creative for a product.
  - Don't use when: the only support is one viral video - record it, but do not treat it as proof; the gate exists for that reason.`,
      inputSchema: {
        subject_type: SubjectType.describe("What the signal is about"),
        subject_id: z.string().min(1).describe("Id of the market, category or product"),
        source_name: z.string().min(1).max(200).describe("Human name of the source"),
        url: z.string().min(1).max(2000).describe("Direct link to the source"),
        region: z.string().min(1).max(100).describe("Country or region the signal represents"),
        period_covered: z.string().min(1).max(200).describe("Time period covered by the signal"),
        signal_type: z.string().min(1).max(200).describe("Kind of signal"),
        summary: z.string().min(1).max(2000).describe("What the signal shows"),
        is_supplier_source: z.boolean().describe("True if the source is the supplier or a seller-controlled listing"),
        verification: Verification.default("estimated").describe("Verification state of this signal"),
        observed_on: z.string().max(40).optional().describe("ISO date observed (default: today)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) =>
      guard(() => {
        const domain = domainOf(params.url);
        const result = mutate((db) => {
          const exists =
            params.subject_type === "product"
              ? findProduct(db, params.subject_id)
              : params.subject_type === "category"
                ? findCategory(db, params.subject_id)
                : findMarket(db, params.subject_id);
          if (!exists) {
            throw new Error(
              `No ${params.subject_type} with id '${params.subject_id}'. Create it first, or check the id with ice_list_${params.subject_type === "category" ? "categories" : params.subject_type + "s"}.`,
            );
          }
          const evidence: Evidence = {
            id: uniqueId(`${params.subject_id}-${domain}`, db.evidence.map((item) => item.id)),
            subject_type: params.subject_type,
            subject_id: params.subject_id,
            source_name: params.source_name,
            source_domain: domain,
            url: params.url,
            region: params.region,
            period_covered: params.period_covered,
            signal_type: params.signal_type,
            is_supplier_source: params.is_supplier_source,
            verification: params.verification,
            summary: params.summary,
            observed_on: params.observed_on ?? new Date().toISOString().slice(0, 10),
            recorded_at: nowIso(),
          };
          db.evidence.push(evidence);
          const gate = checkEvidenceGate(db.evidence, params.subject_type, params.subject_id);
          return { evidence, gate };
        });

        return respond("markdown", result, () =>
          [
            `Recorded evidence \`${result.evidence.id}\` for ${params.subject_type} \`${params.subject_id}\`.`,
            `Source domain: **${domain}** (${params.is_supplier_source ? "supplier-controlled" : "independent of supplier"}, ${params.verification}).`,
            "",
            `**Gate: ${result.gate.pass ? "PASS" : "FAIL"}** — ${result.gate.independent_signal_count}/${result.gate.required_independent_signals} independent domains, ${result.gate.non_supplier_signal_count}/${result.gate.required_non_supplier_signals} non-supplier.`,
            result.gate.reasons.length ? result.gate.reasons.map((reason) => `- ${reason}`).join("\n") : "",
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_check_evidence_gate",
    {
      title: "Check the evidence gate for a subject",
      description: `Check whether a market, category or product has enough independent demand evidence, and list what is recorded.

Gate rules: a category needs 3 independent source domains; a product needs 2, of which at least 1 must not be the supplier. Multiple links to the same domain count once.

Args:
  - subject_type ('category' | 'product' | 'market'): Subject type
  - subject_id (string): Subject id
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  {
    "gate": { "pass": boolean, "total_signals": number, "independent_domains": string[], "independent_signal_count": number, "non_supplier_signal_count": number, "verified_signal_count": number, "required_independent_signals": number, "required_non_supplier_signals": number, "reasons": string[] },
    "evidence": [{ "id": string, "source_name": string, "source_domain": string, "url": string, "region": string, "period_covered": string, "signal_type": string, "is_supplier_source": boolean, "verification": string, "summary": string }]
  }

Examples:
  - Use when: deciding whether a category may enter the top-ten table.
  - Use when: the user asks what the evidence for a product actually is.`,
      inputSchema: {
        subject_type: SubjectType.describe("Subject type"),
        subject_id: z.string().min(1).describe("Subject id"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ subject_type, subject_id, response_format }) =>
      guard(() => {
        const db = loadDb();
        const gate = checkEvidenceGate(db.evidence, subject_type, subject_id);
        const evidence = db.evidence.filter((item) => item.subject_type === subject_type && item.subject_id === subject_id);
        const structured = { gate, evidence };
        return respond(response_format, structured, () =>
          [
            `# Evidence gate for ${subject_type} \`${subject_id}\`: ${gate.pass ? "PASS" : "FAIL"}`,
            "",
            `- Signals recorded: ${gate.total_signals}`,
            `- Independent source domains: ${gate.independent_signal_count} (required ${gate.required_independent_signals})`,
            `- Non-supplier domains: ${gate.non_supplier_signal_count} (required ${gate.required_non_supplier_signals})`,
            `- Signals marked verified: ${gate.verified_signal_count}`,
            "",
            gate.reasons.length ? gate.reasons.map((reason) => `- ${reason}`).join("\n") : "- Gate satisfied.",
            "",
            evidence.length
              ? table(
                  ["Source", "Domain", "Region", "Period", "Signal", "Supplier?", "Verification", "Summary"],
                  evidence.map((item) => [
                    item.source_name,
                    item.source_domain,
                    item.region,
                    item.period_covered,
                    item.signal_type,
                    item.is_supplier_source ? "yes" : "no",
                    item.verification,
                    item.summary,
                  ]),
                )
              : "No evidence recorded.",
          ].join("\n"),
        );
      }),
  );
}
