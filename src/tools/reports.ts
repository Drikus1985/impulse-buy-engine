/** Launch cards and the consolidated report export. */

import { writeFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LAUNCH_SCORE_THRESHOLD } from "../constants.js";
import { guard, respond, table } from "../format.js";
import { assessLaunchReadiness, checkEvidenceGate, checkSupplierGate, latestEconomics } from "../gates.js";
import { loadDb, requireProduct, resolveReportPath } from "../store.js";
import { responseFormatField } from "../types.js";

export function registerReportTools(server: McpServer): void {
  server.registerTool(
    "ice_export_launch_card",
    {
      title: "Build a launch card for a product",
      description: `Assemble a launch card by combining the creative and offer decisions you supply with the sourcing, unit-economics and gate data already in the ledger, and write it to a markdown file.

The server supplies what it knows (suppliers, backup supplier, economics, gate status) and refuses to invent what it does not (hooks, video concepts, guarantee, budget). You must supply those.

By default this tool REFUSES to build a card for a product that fails any launch gate, and tells you which. Set acknowledge_not_ready=true to build a draft anyway; the card is then stamped with a warning banner listing every unmet gate.

Args:
  - product_id (string): Product id
  - positioning (string): Product and positioning statement
  - target_customer (string): Target customer
  - core_promise (string): The core promise
  - offer_structure (string): Offer structure
  - selling_price (number): Launch selling price
  - launch_bundle (string): Launch bundle
  - order_bump (string): Order bump
  - upsell (string): Upsell
  - guarantee (string): Guarantee
  - ad_hooks (string[]): Exactly 3 advertising hooks
  - video_concepts (string[]): Exactly 3 short-form video concepts
  - landing_page_structure (string[]): Landing-page sections in order
  - sample_and_qc_plan (string): Sample and quality-control plan
  - initial_test_budget (number): Initial test budget
  - validation_metrics (string[]): Metrics that decide the test
  - stop_conditions / revise_conditions / scale_conditions (string[]): Predefined decision rules
  - acknowledge_not_ready (boolean): Build a draft despite failing gates (default false)
  - filename (string, optional): Output file name (default: launch-card-<product_id>.md)

Returns (JSON):
  { "product_id": string, "file_path": string, "launch_ready": boolean, "blocking_reasons": string[], "markdown": string }

Examples:
  - Use when: a product has cleared every gate and you are ready to brief the test.
  - Don't use when: gates are failing and you have not decided to proceed anyway.`,
      inputSchema: {
        product_id: z.string().min(1).describe("Product id"),
        positioning: z.string().min(1).max(1000).describe("Product and positioning"),
        target_customer: z.string().min(1).max(500).describe("Target customer"),
        core_promise: z.string().min(1).max(500).describe("Core promise"),
        offer_structure: z.string().min(1).max(1000).describe("Offer structure"),
        selling_price: z.number().min(0).describe("Launch selling price"),
        launch_bundle: z.string().max(500).default("").describe("Launch bundle"),
        order_bump: z.string().max(500).default("").describe("Order bump"),
        upsell: z.string().max(500).default("").describe("Upsell"),
        guarantee: z.string().max(500).default("").describe("Guarantee"),
        ad_hooks: z.array(z.string().max(300)).min(3).max(3).describe("Exactly three advertising hooks"),
        video_concepts: z.array(z.string().max(500)).min(3).max(3).describe("Exactly three short-form video concepts"),
        landing_page_structure: z.array(z.string().max(300)).default([]).describe("Landing-page sections in order"),
        sample_and_qc_plan: z.string().max(2000).default("").describe("Sample and quality-control plan"),
        initial_test_budget: z.number().min(0).default(0).describe("Initial test budget"),
        validation_metrics: z.array(z.string().max(300)).default([]).describe("Metrics that decide the test"),
        stop_conditions: z.array(z.string().max(300)).default([]).describe("Predefined stop conditions"),
        revise_conditions: z.array(z.string().max(300)).default([]).describe("Predefined revise conditions"),
        scale_conditions: z.array(z.string().max(300)).default([]).describe("Predefined scale conditions"),
        acknowledge_not_ready: z.boolean().default(false).describe("Build a draft card despite failing gates"),
        filename: z.string().max(120).optional().describe("Output file name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) =>
      guard(() => {
        const db = loadDb();
        const product = requireProduct(db, params.product_id);
        const readiness = assessLaunchReadiness(db, product);
        if (!readiness.ready && !params.acknowledge_not_ready) {
          throw new Error(
            `'${product.name}' fails ${readiness.blocking_reasons.length} launch gate(s) and no launch card was written: ${readiness.blocking_reasons.join(" | ")}. Fix these, or pass acknowledge_not_ready=true to produce a clearly-marked draft.`,
          );
        }

        const suppliers = db.suppliers.filter((item) => item.product_id === product.id);
        const primary = suppliers.find((item) => !item.is_backup) ?? suppliers[0];
        const backup = suppliers.find((item) => item.is_backup && item.id !== primary?.id);
        const economics = latestEconomics(db, product.id);
        const compliance = db.compliance.find((item) => item.product_id === product.id);
        const evidence = db.evidence.filter((item) => item.subject_type === "product" && item.subject_id === product.id);

        const lines = [
          `# Launch card: ${product.name}`,
          "",
          readiness.ready
            ? `_All launch gates passed. Product score ${product.score}/100._`
            : `> **DRAFT — NOT LAUNCH READY.** Unmet gates: ${readiness.blocking_reasons.join(" | ")}`,
          "",
          `**Product id:** \`${product.id}\` · **Category:** ${product.category_id} · **Confidence:** ${product.confidence}`,
          "",
          "## Positioning",
          params.positioning,
          "",
          `**Target customer:** ${params.target_customer}`,
          `**Core promise:** ${params.core_promise}`,
          `**Trigger:** ${product.trigger || "not recorded"}`,
          `**Purchase moment:** ${product.purchase_moment || "not recorded"}`,
          "",
          "## Offer",
          `- **Structure:** ${params.offer_structure}`,
          `- **Selling price:** ${product.currency} ${params.selling_price}`,
          `- **Launch bundle:** ${params.launch_bundle || "none"}`,
          `- **Order bump:** ${params.order_bump || "none"}`,
          `- **Upsell:** ${params.upsell || "none"}`,
          `- **Guarantee:** ${params.guarantee || "none stated"}`,
          "",
          "## Advertising hooks",
          params.ad_hooks.map((hook, index) => `${index + 1}. ${hook}`).join("\n"),
          "",
          "## Short-form video concepts",
          params.video_concepts.map((concept, index) => `${index + 1}. ${concept}`).join("\n"),
          "",
          "## Landing page structure",
          params.landing_page_structure.length
            ? params.landing_page_structure.map((section, index) => `${index + 1}. ${section}`).join("\n")
            : "- Not specified.",
          "",
          "## Supply",
          primary
            ? `**Primary:** ${primary.name} (${primary.type}, ${primary.country}) — ${primary.url}\n- Unit price: ${primary.unit_price_min !== null ? `${primary.currency} ${primary.unit_price_min}-${primary.unit_price_max ?? primary.unit_price_min}` : "not quoted"}\n- MOQ: ${primary.moq ?? "unknown"} · Production: ${primary.production_days ?? "unknown"} days · Delivery: ${primary.estimated_delivery_days ?? "unknown"} days\n- Verification: **${primary.verification_status}**${primary.certifications_claimed.length ? ` · Certifications CLAIMED (unconfirmed): ${primary.certifications_claimed.join(", ")}` : ""}\n- Outstanding checks: ${primary.verification_outstanding.join("; ") || "none recorded"}`
            : "**Primary:** none recorded.",
          backup
            ? `\n**Backup:** ${backup.name} (${backup.type}, ${backup.country}) — ${backup.url}`
            : "\n**Backup:** none recorded. A single-source product stops selling the day that supplier fails.",
          "",
          "## Sample and quality-control plan",
          params.sample_and_qc_plan || "- Not specified.",
          "",
          "## Unit economics",
          economics
            ? table(
                ["Line", `Amount (${economics.inputs.currency})`],
                [
                  ["Net selling price", economics.net_selling_price],
                  ["Landed cost", `-${economics.landed_cost}`],
                  ["Payment fees", `-${economics.payment_fees}`],
                  ["Fulfilment", `-${economics.inputs.fulfilment_per_unit}`],
                  ["Expected refunds/defects/failures", `-${(economics.expected_refund_cost + economics.expected_defect_cost + economics.expected_delivery_failure_cost).toFixed(2)}`],
                  ["Support allowance", `-${economics.inputs.support_allowance_per_unit}`],
                  ["Pre-ad contribution", economics.pre_ad_contribution],
                  ["Max break-even CAC", economics.max_breakeven_cac],
                  ["Target CAC", economics.target_cac],
                  ["Break-even ROAS", economics.breakeven_roas ?? "undefined"],
                ],
              )
            : "- Not calculated. Run ice_calc_unit_economics before spending on traffic.",
          "",
          "## Test plan",
          `- **Initial test budget:** ${product.currency} ${params.initial_test_budget}`,
          `- **Validation metrics:** ${params.validation_metrics.join("; ") || "not specified"}`,
          "",
          "### Stop",
          params.stop_conditions.length ? params.stop_conditions.map((item) => `- ${item}`).join("\n") : "- Not specified.",
          "### Revise",
          params.revise_conditions.length ? params.revise_conditions.map((item) => `- ${item}`).join("\n") : "- Not specified.",
          "### Scale",
          params.scale_conditions.length ? params.scale_conditions.map((item) => `- ${item}`).join("\n") : "- Not specified.",
          "",
          "## Compliance",
          compliance
            ? `Verdict **${compliance.verdict}**. ${compliance.reasons.join(" ")}`
            : "Not screened. Do not launch before running ice_screen_compliance.",
          "",
          "## Evidence on file",
          evidence.length
            ? table(
                ["Source", "URL", "Region", "Period", "Supplier?", "Verification"],
                evidence.map((item) => [item.source_name, item.url, item.region, item.period_covered, item.is_supplier_source ? "yes" : "no", item.verification]),
              )
            : "- None recorded.",
          "",
          `_Generated ${new Date().toISOString()} from the impulse-commerce research ledger. Figures are only as reliable as the inputs recorded; anything marked estimated or unverified has not been confirmed._`,
        ];

        const markdown = lines.join("\n");
        const filePath = resolveReportPath(params.filename ?? `launch-card-${product.id}.md`);
        writeFileSync(filePath, markdown, "utf8");

        return respond(
          "markdown",
          {
            product_id: product.id,
            file_path: filePath,
            launch_ready: readiness.ready,
            blocking_reasons: readiness.blocking_reasons,
            markdown,
          },
          () => `${readiness.ready ? "Launch card" : "DRAFT launch card (gates failing)"} written to \`${filePath}\`.\n\n${markdown}`,
        );
      }),
  );

  server.registerTool(
    "ice_export_report",
    {
      title: "Export the consolidated research report",
      description: `Export everything in the ledger as one markdown report: markets, ranked categories, product tables, the top-20 shortlist, sourcing detail, unit economics, the compliance register and the portfolio selection.

The report contains ONLY what has been recorded. Sections with no data are marked 'NOT RESEARCHED' rather than filled with plausible text, so gaps stay visible. Narrative sections that require judgement (executive verdict, technology stack, roadmap, "what I would do if this were my money") are not generated here - write those yourself from this evidence.

Args:
  - top_n_products (number): How many products in the shortlist table, 1-50 (default 20)
  - include_watchlist (boolean): Include products below the ${LAUNCH_SCORE_THRESHOLD} threshold (default true)
  - filename (string, optional): Output file name (default: impulse-commerce-report.md)
  - response_format ('markdown' | 'json'): Output format (default 'markdown')

Returns (JSON):
  { "file_path": string, "sections": string[], "missing_sections": string[], "counts": { "markets": number, "categories": number, "products": number, "shortlisted": number }, "markdown": string }

Examples:
  - Use when: the research phase is complete and you want a single artefact to hand the user.
  - Use when: you need to see which parts of the brief are still unresearched.`,
      inputSchema: {
        top_n_products: z.number().int().min(1).max(50).default(20).describe("How many products in the shortlist table"),
        include_watchlist: z.boolean().default(true).describe("Include products below the launch score threshold"),
        filename: z.string().max(120).optional().describe("Output file name"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ top_n_products, include_watchlist, filename, response_format }) =>
      guard(() => {
        const db = loadDb();
        const missing: string[] = [];
        const sections: string[] = [];
        const parts: string[] = [`# Impulse-commerce research report`, "", `_Generated ${new Date().toISOString()}._`, ""];

        parts.push("## Data-freshness statement", "");
        const evidenceDates = db.evidence.map((item) => item.observed_on).sort();
        parts.push(
          db.evidence.length
            ? `${db.evidence.length} evidence records, observed between ${evidenceDates[0]} and ${evidenceDates[evidenceDates.length - 1]}. ${db.evidence.filter((item) => item.verification === "verified").length} are marked verified; the rest are estimated or unavailable and must not be presented as fact.`
            : "No evidence recorded. Every claim below is unsupported.",
          "",
        );
        sections.push("data_freshness");

        parts.push("## Markets", "");
        if (db.markets.length) {
          parts.push(
            table(
              ["Market", "Role", "Score", "Confidence", "Sourcing recommendation"],
              [...db.markets]
                .sort((a, b) => b.score - a.score)
                .map((market) => [`${market.name} (${market.country_code})`, market.role, market.score, market.confidence, market.sourcing_recommendation ?? "-"]),
            ),
            "",
          );
          sections.push("markets");
        } else {
          parts.push("_NOT RESEARCHED: no markets assessed._", "");
          missing.push("markets");
        }

        parts.push("## Categories, ranked", "");
        if (db.categories.length) {
          parts.push(
            table(
              ["#", "Category", "Score", "Trend", "Competition", "Ind. signals", "Gate", "Products", "Confidence"],
              [...db.categories]
                .sort((a, b) => b.score - a.score)
                .map((category, index) => {
                  const gate = checkEvidenceGate(db.evidence, "category", category.id);
                  return [
                    index + 1,
                    category.name,
                    category.score,
                    category.trend_direction,
                    category.competitive_intensity,
                    gate.independent_signal_count,
                    gate.pass ? "PASS" : "FAIL",
                    db.products.filter((product) => product.category_id === category.id).length,
                    category.confidence,
                  ];
                }),
            ),
            "",
          );
          sections.push("categories");
        } else {
          parts.push("_NOT RESEARCHED: no categories assessed._", "");
          missing.push("categories");
        }

        parts.push("## Products by category", "");
        if (db.products.length) {
          for (const category of [...db.categories].sort((a, b) => b.score - a.score)) {
            const products = db.products
              .filter((product) => product.category_id === category.id)
              .filter((product) => (include_watchlist ? true : product.score >= LAUNCH_SCORE_THRESHOLD))
              .sort((a, b) => b.score - a.score);
            if (!products.length) continue;
            parts.push(`### ${category.name} (${products.length} products)`, "");
            parts.push(
              table(
                ["Product", "Buyer", "Trigger", "Hook", "Price range", "Trend", "Sat.", "Return risk", "Score", "Confidence"],
                products.map((product) => [
                  product.name,
                  product.buyer,
                  product.trigger,
                  product.five_second_hook,
                  product.selling_price_min !== null ? `${product.currency} ${product.selling_price_min}-${product.selling_price_max ?? product.selling_price_min}` : "not set",
                  product.trend_status,
                  product.saturation,
                  product.return_risk,
                  product.score,
                  product.confidence,
                ]),
              ),
              "",
            );
          }
          sections.push("product_tables");
        } else {
          parts.push("_NOT RESEARCHED: no products recorded._", "");
          missing.push("product_tables");
        }

        const shortlist = [...db.products].sort((a, b) => b.score - a.score).slice(0, top_n_products);
        parts.push(`## Top ${shortlist.length} shortlist`, "");
        if (shortlist.length) {
          parts.push(
            table(
              ["#", "Product", "Category", "Score", "Pre-ad contribution", "Evidence gate", "Supplier gate", "Compliance", "Ready"],
              shortlist.map((product, index) => {
                const economics = latestEconomics(db, product.id);
                const evidenceGate = checkEvidenceGate(db.evidence, "product", product.id);
                const supplierGate = checkSupplierGate(db.suppliers, product.id);
                const compliance = db.compliance.find((item) => item.product_id === product.id);
                const readiness = assessLaunchReadiness(db, product);
                return [
                  index + 1,
                  product.name,
                  product.category_id,
                  product.score,
                  economics ? `${economics.inputs.currency} ${economics.pre_ad_contribution}` : "not calculated",
                  evidenceGate.pass ? "PASS" : "FAIL",
                  supplierGate.pass ? "PASS" : "FAIL",
                  compliance ? compliance.verdict : "NOT SCREENED",
                  readiness.ready ? "yes" : "no",
                ];
              }),
            ),
            "",
          );
          parts.push(
            `Products scoring below ${LAUNCH_SCORE_THRESHOLD} are watch-list ideas, not launch recommendations, regardless of where they appear in this table.`,
            "",
          );
          sections.push("shortlist");
        } else {
          missing.push("shortlist");
        }

        parts.push("## Sourcing", "");
        if (db.suppliers.length) {
          parts.push(
            table(
              ["Product", "Supplier", "Type", "Country", "Unit price", "MOQ", "Lead time", "Verification", "Backup"],
              db.suppliers.map((supplier) => [
                supplier.product_id,
                `[${supplier.name}](${supplier.url})`,
                supplier.type,
                supplier.country,
                supplier.unit_price_min !== null ? `${supplier.currency} ${supplier.unit_price_min}-${supplier.unit_price_max ?? supplier.unit_price_min}` : "not quoted",
                supplier.moq ?? "n/a",
                supplier.estimated_delivery_days !== null ? `${supplier.estimated_delivery_days}d` : "unknown",
                supplier.verification_status,
                supplier.is_backup ? "yes" : "no",
              ]),
            ),
            "",
          );
          const unverified = db.suppliers.filter((supplier) => supplier.verification_status !== "verified");
          if (unverified.length) {
            parts.push(
              `**${unverified.length} of ${db.suppliers.length} suppliers are not independently verified.** Their claimed prices, lead times and certifications are unconfirmed.`,
              "",
            );
          }
          sections.push("sourcing");
        } else {
          parts.push("_NOT RESEARCHED: no suppliers recorded._", "");
          missing.push("sourcing");
        }

        parts.push("## Unit economics", "");
        if (db.economics.length) {
          parts.push(
            table(
              ["Product", "Run", "Net price", "Landed", "Landed %", "Pre-ad contribution", "Margin", "Max CAC", "B/E ROAS", "Screens"],
              db.economics.map((run) => [
                run.product_id,
                run.label,
                `${run.inputs.currency} ${run.net_selling_price}`,
                run.landed_cost,
                `${(run.landed_cost_ratio * 100).toFixed(1)}%`,
                run.pre_ad_contribution,
                `${(run.pre_ad_contribution_margin * 100).toFixed(1)}%`,
                run.max_breakeven_cac,
                run.breakeven_roas ?? "undefined",
                run.screens_passed ? "pass" : "FAIL",
              ]),
            ),
            "",
          );
          sections.push("unit_economics");
        } else {
          parts.push("_NOT RESEARCHED: no unit economics calculated._", "");
          missing.push("unit_economics");
        }

        parts.push("## Risk, compliance and IP register", "");
        if (db.compliance.length || db.products.length) {
          const rows = db.products.map((product) => {
            const compliance = db.compliance.find((item) => item.product_id === product.id);
            return [
              product.name,
              compliance ? compliance.verdict : "NOT SCREENED",
              compliance ? compliance.hard_flags_active.join(", ") || "-" : "-",
              compliance ? compliance.soft_flags_active.join(", ") || "-" : "-",
              product.compliance_notes || "-",
            ];
          });
          parts.push(table(["Product", "Verdict", "Hard flags", "Soft flags", "Notes"], rows), "");
          sections.push("compliance_register");
        } else {
          missing.push("compliance_register");
        }

        parts.push("## Portfolio selection", "");
        if (db.portfolio) {
          const name = (id: string) => db.products.find((product) => product.id === id)?.name ?? id;
          parts.push(
            `**Immediate test:** ${db.portfolio.immediate_test.map(name).join(", ") || "none"}`,
            `**Reserve:** ${db.portfolio.reserve.map(name).join(", ") || "none"}`,
            `**Longer-term:** ${db.portfolio.long_term.map(name).join(", ") || "none"}`,
            `**Rejected:** ${db.portfolio.rejected.map((item) => name(item.product_id)).join(", ") || "none"}`,
            "",
            db.portfolio.notes.length ? db.portfolio.notes.map((note) => `- ${note}`).join("\n") : "",
            "",
          );
          sections.push("portfolio");
        } else {
          parts.push("_NOT RESEARCHED: portfolio not selected. Run ice_select_portfolio._", "");
          missing.push("portfolio");
        }

        parts.push(
          "## Sections this export does not generate",
          "",
          "These require judgement and narrative and are deliberately left to the analyst rather than auto-filled: executive verdict, customer-prospect maps, technology and automation architecture, brand and channel structure, the 14-day first-revenue plan, the 30/60/90-day roadmap, and 'What I would do if this were my money'. Write them from the evidence above.",
          "",
        );

        const markdown = parts.join("\n");
        const filePath = resolveReportPath(filename ?? "impulse-commerce-report.md");
        writeFileSync(filePath, markdown, "utf8");

        const structured = {
          file_path: filePath,
          sections,
          missing_sections: missing,
          counts: {
            markets: db.markets.length,
            categories: db.categories.length,
            products: db.products.length,
            shortlisted: shortlist.length,
          },
          markdown,
        };

        return respond(response_format, structured, () =>
          [
            `Report written to \`${filePath}\`.`,
            "",
            `Sections included: ${sections.join(", ") || "none"}.`,
            missing.length ? `Sections marked NOT RESEARCHED: ${missing.join(", ")}.` : "No sections are missing data.",
            "",
            markdown,
          ].join("\n"),
        );
      }),
  );
}
