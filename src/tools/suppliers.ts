/** Phase D: deep sourcing, supplier depth gate and the due-diligence checklist. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DUE_DILIGENCE_ITEMS } from "../constants.js";
import { guard, respond, table } from "../format.js";
import { checkSupplierGate } from "../gates.js";
import { loadDb, mutate, nowIso, requireProduct, uniqueId } from "../store.js";
import {
  DueDiligenceItemEnum,
  Supplier,
  SupplierType,
  SupplierVerification,
  currencyField,
  responseFormatField,
} from "../types.js";

export function registerSupplierTools(server: McpServer): void {
  server.registerTool(
    "ice_upsert_supplier",
    {
      title: "Record or update a supply option",
      description: `Record a manufacturer, wholesaler, sourcing marketplace or local distributor for a product, with quoted terms and what still needs verification.

VERIFICATION RULE, ENFORCED: verification_status='verified' is rejected unless verification_evidence contains at least one concrete item describing what was actually checked (e.g. "CIPC registration 2019/123456/07 confirmed on cipc.co.za, 2026-08-17"). A supplier's own claims are not verification. Certifications recorded here are 'claimed' until independently confirmed.

Args:
  - id (string, optional): Existing supplier id to update. Omit to create.
  - product_id (string): Product this supplier supplies (must exist)
  - name (string): Supplier or company name
  - url (string): Direct product or company link
  - country (string): Supplier country
  - type ('manufacturer' | 'trader' | 'wholesaler' | 'sourcing_marketplace' | 'local_distributor' | 'importer')
  - unit_price_min / unit_price_max (number, optional): Indicative unit price
  - currency (string): ISO code (default 'ZAR')
  - moq (number, optional): Minimum order quantity
  - sample_available (boolean, optional) / sample_cost (number, optional)
  - private_label_available (boolean, optional): Private-label or custom packaging
  - production_days (number, optional): Production lead time in days
  - incoterms (string[]): Available Incoterms, e.g. ["FOB","DDP"]
  - estimated_delivery_days (number, optional): Door-to-door estimate
  - buyer_protection (string): Buyer protection or payment terms offered
  - payment_terms (string): Payment terms
  - certifications_claimed (string[]): Certifications the supplier CLAIMS
  - verification_status ('unverified' | 'partially_verified' | 'verified'): Default 'unverified'
  - verification_evidence (string[]): What was actually checked, with dates. Required for 'verified'.
  - verification_outstanding (string[]): What still needs checking
  - responsiveness_tested (boolean): Whether you actually contacted them
  - responsiveness_notes (string): Observed response time and quality, only if tested
  - risks (string[]): Principal supplier risks
  - is_backup (boolean): Whether this is a backup rather than primary source

Returns (JSON):
  { "supplier": {...}, "supplier_gate": { "pass": boolean, "supplier_count": number, "types_present": string[], "backup_available": boolean, "meets_preferred_depth": boolean, "reasons": string[] }, "created": boolean, "warnings": string[] }

Examples:
  - Use when: you found a factory on a sourcing marketplace and want its terms on record.
  - Use when: adding a local distributor as a backup so the supplier gate can pass.
  - Don't use when: you want to compare suppliers (use ice_check_supplier_gate or ice_get_product).`,
      inputSchema: {
        id: z.string().min(1).optional().describe("Existing supplier id to update; omit to create"),
        product_id: z.string().min(1).describe("Product id this supplier supplies"),
        name: z.string().min(1).max(200).describe("Supplier or company name"),
        url: z.string().min(1).max(2000).describe("Direct product or company link"),
        country: z.string().min(1).max(100).describe("Supplier country"),
        type: SupplierType.describe("Supplier type"),
        unit_price_min: z.number().min(0).nullable().default(null).describe("Indicative unit price, low end"),
        unit_price_max: z.number().min(0).nullable().default(null).describe("Indicative unit price, high end"),
        currency: currencyField,
        moq: z.number().int().min(0).nullable().default(null).describe("Minimum order quantity"),
        sample_available: z.boolean().nullable().default(null).describe("Whether samples are available"),
        sample_cost: z.number().min(0).nullable().default(null).describe("Sample cost"),
        private_label_available: z.boolean().nullable().default(null).describe("Private-label or custom packaging available"),
        production_days: z.number().int().min(0).nullable().default(null).describe("Production time in days"),
        incoterms: z.array(z.string().max(20)).default([]).describe("Available Incoterms"),
        estimated_delivery_days: z.number().int().min(0).nullable().default(null).describe("Estimated door-to-door delivery days"),
        buyer_protection: z.string().max(600).default("").describe("Buyer protection offered"),
        payment_terms: z.string().max(600).default("").describe("Payment terms"),
        certifications_claimed: z.array(z.string().max(200)).default([]).describe("Certifications the supplier claims"),
        verification_status: SupplierVerification.default("unverified").describe("Verification state"),
        verification_evidence: z
          .array(z.string().max(500))
          .default([])
          .describe("What was actually verified, with source and date. Required for verification_status='verified'."),
        verification_outstanding: z.array(z.string().max(500)).default([]).describe("What still needs verification"),
        responsiveness_tested: z.boolean().default(false).describe("Whether you actually contacted the supplier"),
        responsiveness_notes: z.string().max(1000).default("").describe("Observed responsiveness, only if actually tested"),
        risks: z.array(z.string().max(300)).default([]).describe("Principal supplier risks"),
        is_backup: z.boolean().default(false).describe("Whether this is a backup source"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) =>
      guard(() => {
        const warnings: string[] = [];
        if (params.verification_status === "verified" && params.verification_evidence.length === 0) {
          throw new Error(
            "verification_status='verified' requires at least one entry in verification_evidence describing what was actually checked, with source and date. Use 'unverified' or 'partially_verified' until then.",
          );
        }
        if (params.certifications_claimed.length > 0 && params.verification_status !== "verified") {
          warnings.push(
            `Certifications recorded as CLAIMED only (${params.certifications_claimed.join(", ")}). Do not repeat them as fact in any report.`,
          );
        }
        if (params.responsiveness_notes && !params.responsiveness_tested) {
          warnings.push("Responsiveness notes were supplied but responsiveness_tested is false; the notes are recorded as untested impressions.");
        }

        const result = mutate((db) => {
          requireProduct(db, params.product_id);
          let supplier = params.id ? db.suppliers.find((item) => item.id === params.id) : undefined;
          if (params.id && !supplier) throw new Error(`No supplier with id '${params.id}'. Omit 'id' to create one.`);
          const created = !supplier;
          if (!supplier) {
            supplier = {
              id: uniqueId(`${params.product_id}-${params.name}`, db.suppliers.map((item) => item.id)),
              product_id: params.product_id,
              due_diligence: {},
              updated_at: nowIso(),
            } as unknown as Supplier;
            db.suppliers.push(supplier);
          }
          Object.assign(supplier, {
            product_id: params.product_id,
            name: params.name,
            url: params.url,
            country: params.country,
            type: params.type,
            unit_price_min: params.unit_price_min,
            unit_price_max: params.unit_price_max,
            currency: params.currency,
            moq: params.moq,
            sample_available: params.sample_available,
            sample_cost: params.sample_cost,
            private_label_available: params.private_label_available,
            production_days: params.production_days,
            incoterms: params.incoterms,
            estimated_delivery_days: params.estimated_delivery_days,
            buyer_protection: params.buyer_protection,
            payment_terms: params.payment_terms,
            certifications_claimed: params.certifications_claimed,
            verification_status: params.verification_status,
            verification_evidence: params.verification_evidence,
            verification_outstanding: params.verification_outstanding,
            responsiveness_tested: params.responsiveness_tested,
            responsiveness_notes: params.responsiveness_notes,
            risks: params.risks,
            is_backup: params.is_backup,
            updated_at: nowIso(),
          });
          const gate = checkSupplierGate(db.suppliers, params.product_id);
          return { supplier, gate, created };
        });

        const structured = { supplier: result.supplier, supplier_gate: result.gate, created: result.created, warnings };
        return respond("markdown", structured, () =>
          [
            `${result.created ? "Recorded" : "Updated"} supplier **${result.supplier.name}** (\`${result.supplier.id}\`) for product \`${params.product_id}\`.`,
            `Type ${result.supplier.type}, ${result.supplier.country}, verification: ${result.supplier.verification_status}.`,
            "",
            `**Supplier gate: ${result.gate.pass ? "PASS" : "FAIL"}** — ${result.gate.supplier_count} option(s), types: ${result.gate.types_present.join(", ") || "none"}, backup ${result.gate.backup_available ? "available" : "MISSING"}.`,
            result.gate.reasons.length ? result.gate.reasons.map((reason) => `- ${reason}`).join("\n") : "",
            warnings.length ? "\nWarnings:\n" + warnings.map((warning) => `- ${warning}`).join("\n") : "",
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_check_supplier_gate",
    {
      title: "Check supply depth for a product",
      description: `Check whether a product has enough supply options and a backup, and list every recorded supplier with its terms.

Gate rules: 3 supply options is the target, 2 is the hard floor, and a backup source is required. Suppliers claiming certifications while unverified are listed separately so those claims never leak into a report as fact.

Args:
  - product_id (string): Product id
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  {
    "gate": { "pass": boolean, "supplier_count": number, "types_present": string[], "has_manufacturer": boolean, "has_wholesaler_or_marketplace": boolean, "has_local_or_regional": boolean, "backup_available": boolean, "verified_count": number, "unverified_claiming_certifications": string[], "meets_preferred_depth": boolean, "reasons": string[] },
    "suppliers": [...]
  }

Examples:
  - Use when: deciding whether a product may become an immediate-test candidate.
  - Use when: the user asks what happens if the main supplier fails.`,
      inputSchema: {
        product_id: z.string().min(1).describe("Product id"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ product_id, response_format }) =>
      guard(() => {
        const db = loadDb();
        requireProduct(db, product_id);
        const gate = checkSupplierGate(db.suppliers, product_id);
        const suppliers = db.suppliers.filter((item) => item.product_id === product_id);
        return respond(response_format, { gate, suppliers }, () =>
          [
            `# Supplier gate for \`${product_id}\`: ${gate.pass ? "PASS" : "FAIL"}`,
            "",
            `- Options: ${gate.supplier_count} (target 3, floor 2)${gate.meets_preferred_depth ? "" : " — below the preferred depth of 3"}`,
            `- Types present: ${gate.types_present.join(", ") || "none"}`,
            `- Manufacturer: ${gate.has_manufacturer ? "yes" : "no"}; wholesaler/marketplace: ${gate.has_wholesaler_or_marketplace ? "yes" : "no"}; local/regional: ${gate.has_local_or_regional ? "yes" : "no"}`,
            `- Backup available: ${gate.backup_available ? "yes" : "NO"}`,
            `- Independently verified suppliers: ${gate.verified_count}`,
            gate.unverified_claiming_certifications.length
              ? `- Claiming certifications but UNVERIFIED: ${gate.unverified_claiming_certifications.join(", ")}`
              : "- No unverified certification claims.",
            "",
            gate.reasons.length ? gate.reasons.map((reason) => `- ${reason}`).join("\n") : "Gate satisfied.",
            "",
            suppliers.length
              ? table(
                  ["Supplier", "Type", "Country", "Unit price", "MOQ", "Sample", "Lead time", "Incoterms", "Verification", "Backup"],
                  suppliers.map((supplier) => [
                    `${supplier.name} (${supplier.id})`,
                    supplier.type,
                    supplier.country,
                    supplier.unit_price_min !== null
                      ? `${supplier.currency} ${supplier.unit_price_min}-${supplier.unit_price_max ?? supplier.unit_price_min}`
                      : "not quoted",
                    supplier.moq ?? "n/a",
                    supplier.sample_available === null ? "unknown" : supplier.sample_available ? `yes (${supplier.sample_cost ?? "?"})` : "no",
                    supplier.production_days === null ? "unknown" : `${supplier.production_days}d prod`,
                    supplier.incoterms.join("/") || "n/a",
                    supplier.verification_status,
                    supplier.is_backup ? "yes" : "no",
                  ]),
                )
              : "No suppliers recorded.",
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "ice_update_due_diligence",
    {
      title: "Update the sample-order and due-diligence checklist",
      description: `Mark due-diligence items complete for a supplier and return the outstanding list.

Checklist items: ${DUE_DILIGENCE_ITEMS.join(", ")}.

Args:
  - supplier_id (string): Supplier id
  - completed (string[]): Items now complete
  - reopened (string[], optional): Items to mark incomplete again
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  { "supplier_id": string, "supplier_name": string, "completed": string[], "outstanding": string[], "completion_ratio": number }

Examples:
  - Use when: a sample arrived and was inspected.
  - Use when: producing a pre-order readiness summary for the user.`,
      inputSchema: {
        supplier_id: z.string().min(1).describe("Supplier id"),
        completed: z.array(DueDiligenceItemEnum).default([]).describe("Checklist items now complete"),
        reopened: z.array(DueDiligenceItemEnum).default([]).describe("Checklist items to mark incomplete again"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ supplier_id, completed, reopened, response_format }) =>
      guard(() => {
        const result = mutate((db) => {
          const supplier = db.suppliers.find((item) => item.id === supplier_id);
          if (!supplier) throw new Error(`No supplier with id '${supplier_id}'. Use ice_check_supplier_gate to list supplier ids for a product.`);
          for (const item of completed) supplier.due_diligence[item] = true;
          for (const item of reopened) supplier.due_diligence[item] = false;
          supplier.updated_at = nowIso();
          const done = DUE_DILIGENCE_ITEMS.filter((item) => supplier.due_diligence[item]);
          const outstanding = DUE_DILIGENCE_ITEMS.filter((item) => !supplier.due_diligence[item]);
          return {
            supplier_id,
            supplier_name: supplier.name,
            completed: done,
            outstanding,
            completion_ratio: Math.round((done.length / DUE_DILIGENCE_ITEMS.length) * 100) / 100,
          };
        });

        return respond(response_format, result, () =>
          [
            `# Due diligence: ${result.supplier_name} (\`${result.supplier_id}\`)`,
            "",
            `${result.completed.length}/${DUE_DILIGENCE_ITEMS.length} complete (${(result.completion_ratio * 100).toFixed(0)}%).`,
            "",
            "## Outstanding",
            result.outstanding.length ? result.outstanding.map((item) => `- [ ] ${item}`).join("\n") : "- Nothing outstanding.",
            "",
            "## Complete",
            result.completed.length ? result.completed.map((item) => `- [x] ${item}`).join("\n") : "- Nothing complete yet.",
          ].join("\n"),
        );
      }),
  );
}
