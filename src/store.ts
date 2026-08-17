/**
 * Persistent JSON store for the research ledger.
 *
 * Everything the agent records survives across sessions, which is the point:
 * a 100+ product research database cannot live in a context window.
 *
 * Location: $ICE_DATA_DIR (default ~/.impulse-commerce-mcp), file `database.json`.
 * Writes are atomic (temp file + rename) so a crash mid-write cannot corrupt the ledger.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Database, emptyDatabase } from "./types.js";

export const DATA_DIR = process.env.ICE_DATA_DIR
  ? resolve(process.env.ICE_DATA_DIR)
  : join(homedir(), ".impulse-commerce-mcp");

export const DB_PATH = join(DATA_DIR, "database.json");
export const REPORT_DIR = join(DATA_DIR, "reports");

let cache: Database | null = null;

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadDb(): Database {
  if (cache) return cache;
  ensureDir(DATA_DIR);
  if (!existsSync(DB_PATH)) {
    cache = emptyDatabase();
    saveDb(cache);
    return cache;
  }
  try {
    const raw = readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    cache = { ...emptyDatabase(), ...parsed };
    return cache;
  } catch (error) {
    throw new Error(
      `Could not read the research ledger at ${DB_PATH}: ${error instanceof Error ? error.message : String(error)}. ` +
        `Fix or move that file, or set ICE_DATA_DIR to a different directory, then retry.`,
    );
  }
}

export function saveDb(db: Database): void {
  ensureDir(DATA_DIR);
  db.updated_at = new Date().toISOString();
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  renameSync(tmp, DB_PATH);
  cache = db;
}

export function mutate<T>(fn: (db: Database) => T): T {
  const db = loadDb();
  const result = fn(db);
  saveDb(db);
  return result;
}

/** Resets the in-memory cache. Used by tests. */
export function resetCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "item";
}

/** Produces a human-readable id that does not collide with anything in `existing`. */
export function uniqueId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const slug = slugify(base);
  if (!taken.has(slug)) return slug;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${slug}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function findProduct(db: Database, id: string): Database["products"][number] | undefined {
  return db.products.find((p) => p.id === id);
}

export function findCategory(db: Database, id: string): Database["categories"][number] | undefined {
  return db.categories.find((c) => c.id === id);
}

export function findMarket(db: Database, id: string): Database["markets"][number] | undefined {
  return db.markets.find((m) => m.id === id);
}

export function requireProduct(db: Database, id: string): Database["products"][number] {
  const product = findProduct(db, id);
  if (!product) {
    const known = db.products.map((p) => p.id).slice(0, 20);
    throw new Error(
      `No product with id '${id}'. ${
        known.length
          ? `Known product ids include: ${known.join(", ")}. Use ice_list_products to see all.`
          : `The ledger has no products yet. Create one with ice_upsert_product first.`
      }`,
    );
  }
  return product;
}

export function requireCategory(db: Database, id: string): Database["categories"][number] {
  const category = findCategory(db, id);
  if (!category) {
    const known = db.categories.map((c) => c.id).slice(0, 20);
    throw new Error(
      `No category with id '${id}'. ${
        known.length
          ? `Known category ids: ${known.join(", ")}.`
          : `The ledger has no categories yet. Create one with ice_upsert_category first.`
      }`,
    );
  }
  return category;
}

/** Guards report paths so a caller cannot write outside the data directory. */
export function resolveReportPath(filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  if (isAbsolute(filename) || filename.includes("..")) {
    throw new Error("Report filename must be a plain file name, not a path.");
  }
  ensureDir(REPORT_DIR);
  const target = join(REPORT_DIR, safe);
  if (dirname(target) !== REPORT_DIR) {
    throw new Error("Report filename resolved outside the reports directory.");
  }
  return target;
}
