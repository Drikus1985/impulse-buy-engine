/**
 * Shared response formatting: markdown/JSON duality, pagination, truncation, errors.
 */

import { CHARACTER_LIMIT } from "./constants.js";
import { ResponseFormatT } from "./types.js";

export interface ToolResponse {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Builds a successful tool response in the requested format. */
export function respond(
  format: ResponseFormatT,
  structured: Record<string, unknown>,
  markdown: () => string,
  options: { includeStructured?: boolean } = {},
): ToolResponse {
  const includeStructured = options.includeStructured ?? true;
  let text = format === "json" ? JSON.stringify(structured, null, 2) : markdown();
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n... [response truncated at ${CHARACTER_LIMIT} characters. Narrow the request with filters, a lower 'limit', or a higher 'offset'.]`;
  }
  const response: ToolResponse = { content: [{ type: "text", text }] };
  if (includeStructured) response.structuredContent = structured;
  return response;
}

/** Builds an actionable error response. Errors are reported in-result, not as protocol errors. */
export function errorResponse(error: unknown, hint?: string): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${message}${hint ? ` ${hint}` : ""}` }],
  };
}

/** Wraps a handler so thrown errors become clean in-result errors. */
export async function guard(fn: () => Promise<ToolResponse> | ToolResponse): Promise<ToolResponse> {
  try {
    return await fn();
  } catch (error) {
    return errorResponse(error);
  }
}

export interface Page<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}

export function paginate<T>(items: T[], limit: number, offset: number): Page<T> {
  const slice = items.slice(offset, offset + limit);
  const hasMore = items.length > offset + slice.length;
  const page: Page<T> = {
    total: items.length,
    count: slice.length,
    offset,
    items: slice,
    has_more: hasMore,
  };
  if (hasMore) page.next_offset = offset + slice.length;
  return page;
}

export function money(value: number | null | undefined, currency = ""): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const formatted = value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

export function round(value: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** Renders a markdown table. Cells are stringified and pipe-escaped. */
export function table(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (cell: string | number | null | undefined): string =>
    String(cell ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(esc).join(" | ")} |`),
  ];
  return lines.join("\n");
}

export function bullets(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- (none)";
}

export function tick(value: boolean): string {
  return value ? "PASS" : "FAIL";
}
