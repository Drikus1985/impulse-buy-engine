#!/usr/bin/env node
/**
 * impulse-commerce-mcp-server
 *
 * A persistent research ledger and deterministic decision engine for the
 * Global Impulse-Commerce Opportunity Engine brief.
 *
 * WHAT THIS SERVER IS NOT: it does not fetch trend data, supplier listings or
 * prices, and it has no API keys. The calling agent researches with its own
 * tools and records findings here. The server's contribution is that scores,
 * unit economics and gate verdicts are computed the same way every time, and
 * that unverified claims cannot be recorded as verified.
 *
 * Transport: stdio. Logging goes to stderr only - stdout is the protocol channel.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { DB_PATH } from "./store.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerComplianceTools } from "./tools/compliance.js";
import { registerEconomicsTools } from "./tools/economics.js";
import { registerEvidenceTools } from "./tools/evidence.js";
import { registerMarketTools } from "./tools/markets.js";
import { registerPortfolioTools } from "./tools/portfolio.js";
import { registerProductTools } from "./tools/products.js";
import { registerReportTools } from "./tools/reports.js";
import { registerRubricTools } from "./tools/rubrics.js";
import { registerSupplierTools } from "./tools/suppliers.js";

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    instructions: [
      "This server is a persistent research ledger and scoring engine for impulse-commerce product research.",
      "It never fetches data. Do your own research with your own tools, then record findings here.",
      "Call ice_get_rubrics first to learn the exact factor keys and gate rules, and ice_ledger_stats to see what prior sessions recorded.",
      "Typical flow: assess markets -> score categories -> record products -> add evidence -> add suppliers -> screen compliance -> calculate unit economics -> run scenarios -> select portfolio -> export launch cards and the report.",
      "The gates are deliberate. If a product will not pass, report the blocker rather than working around it.",
    ].join(" "),
  },
);

registerRubricTools(server);
registerMarketTools(server);
registerCategoryTools(server);
registerProductTools(server);
registerEvidenceTools(server);
registerSupplierTools(server);
registerComplianceTools(server);
registerEconomicsTools(server);
registerPortfolioTools(server);
registerReportTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio. Ledger: ${DB_PATH}`);
}

main().catch((error: unknown) => {
  console.error("Fatal server error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
