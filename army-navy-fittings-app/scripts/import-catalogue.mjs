#!/usr/bin/env node
/**
 * Builds the public shop catalogue from the internal price list.
 *
 * The source export carries landed cost, supplier codes, bin locations and
 * internal SKUs alongside the selling price. None of that may reach a browser,
 * so this script works by allow-list: it names the fields that go out, and
 * everything else is dropped by construction rather than by remembering to
 * delete it.
 *
 * It also refuses to guess. Where the price list gives one part number two
 * different selling prices, the part is quarantined instead of one price being
 * picked — publishing the cheaper one would sell stock below its own price
 * list, and publishing the dearer one would overcharge.
 *
 *   node scripts/import-catalogue.mjs [--source path] [--include-review]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, toRecords } from './lib/csv.mjs';
import { CATEGORIES, classify, parseAnSizes, formatSizeLabel, formatAngleLabel } from './lib/classify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/** South African VAT. The price list column is VAT-exclusive. */
export const VAT_RATE = 0.15;

/** Columns read from the export. Anything absent here is never loaded. */
const COLUMN = {
  partNumber: 'ANF Part Number (FINAL)',
  description: 'Description',
  family: 'Family',
  onHand: 'On Hand (Sage 21/03/2026)',
  uom: 'UoM',
  sellingExVat: 'Selling Excl R',
  status: 'Status',
};

/**
 * Columns that must never appear in the published catalogue, checked by name
 * after the build so a future column rename cannot quietly leak one.
 */
export const CONFIDENTIAL_COLUMNS = [
  'Cost R (landed/best)',
  'Kage USD 2026',
  'Kage Code',
  'Current Sage Code',
  'Other Supplier Codes',
  'Bin',
  'ANF_SKU (internal)',
  'Change Note',
];

/** Lines that are workshop labour or bulk materials, not shelf stock. */
const NOT_RETAIL_STOCK = /^(AAMWS|LABOUR|LAB)\b|\bLABOUR\b|-LAB$|-Mat$/i;

/** Statuses the shop will sell from. */
const SELLABLE_STATUSES = new Set(['ACTIVE']);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Rounds to cents without the usual binary-floating-point drift. */
export function toCents(rands) {
  return Math.round((rands + Number.EPSILON) * 100);
}

/**
 * Adds VAT in integer arithmetic.
 *
 * The obvious `exVat * 1.15` loses money: R51.90 grosses up to exactly R59.685,
 * but in binary floating point it lands a hair under and rounds down to R59.68.
 * A cent per unit, on every price ending that way, all in the shop's favour to
 * lose. Working in cents and basis points keeps the arithmetic exact.
 */
export function addVat(exVat, rate = VAT_RATE) {
  const basisPoints = Math.round(rate * 10000);
  return Math.round((toCents(exVat) * (10000 + basisPoints)) / 10000) / 100;
}

/**
 * Stock is published as a band, not a number. The price list's own header says
 * the quantity snapshot is stale, so an exact "7 in stock" would be a promise
 * the data cannot keep.
 */
export function availabilityBand(onHand) {
  if (!Number.isFinite(onHand) || onHand <= 0) return 'on-order';
  if (onHand <= 5) return 'low-stock';
  return 'in-stock';
}

export function parseMoney(raw) {
  if (raw == null) return NaN;
  const cleaned = String(raw).replace(/[R\s,]/g, (m) => (m === ',' ? '.' : ''));
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

/** Prefers the description that actually describes something. */
function bestName(candidates, partNumber) {
  const usable = candidates
    .map((c) => c.trim())
    .filter((c) => c !== '' && c.toUpperCase() !== partNumber.toUpperCase());
  if (usable.length === 0) return partNumber;
  // Longest wins: "Flare Bulkhead 9010" over "Bulk Head Adaptors".
  return usable.sort((a, b) => b.length - a.length)[0];
}

/**
 * Drops a legacy stock code that a description happens to open with —
 * "ANHC20-32 Hose Clamp 12mm 20x32" is a hose clamp, and the code in front of
 * it is the shop's old accounting reference, not something a customer needs.
 *
 * Matched against that row's own codes rather than by pattern, so genuinely
 * useful leading tokens survive: "AN10 Flare Filter Insert" keeps its size.
 */
export function stripLegacyCode(description, codes) {
  for (const code of codes) {
    const trimmed = (code ?? '').trim();
    if (trimmed.length < 3) continue;
    if (description.toLowerCase().startsWith(`${trimmed.toLowerCase()} `)) {
      const remainder = description.slice(trimmed.length).trim();
      if (remainder.length > 2) return remainder;
    }
  }
  return description;
}

/** Title-cases the shoutier descriptions without touching AN/SS/NPT/PTFE. */
export function tidyName(name) {
  if (!/[a-z]/.test(name)) {
    return name
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase())
      .replace(/\b(An|Ss|Npt|Bsp|Ptfe|Orb|Nbr|Efi|Psi|Pvc|Vw|Unc|Unf|Id|Od)\b/g, (m) => m.toUpperCase());
  }
  return name;
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

/**
 * @param {string} csvText
 * @param {{ includeReview?: boolean }} [options]
 */
export function buildCatalogue(csvText, options = {}) {
  const { includeReview = false } = options;
  const { records } = toRecords(parseCsv(csvText), COLUMN.partNumber);

  const report = {
    sourceRows: records.length,
    skipped: {
      noPartNumber: 0,
      notRetailStock: 0,
      statusNotSellable: 0,
      priceConflict: 0,
      invalidPrice: 0,
    },
    /** @type {{ sku: string, reason: string, detail: string }[]} */
    quarantined: [],
    /** @type {Record<string, number>} */
    classifiedBy: { family: 0, description: 0, fallback: 0 },
    withoutPrice: 0,
    withAnSizes: 0,
    withAngle: 0,
    /**
     * Parts whose selling price does not cover their landed cost. Derived from
     * cost data, so this stays in the internal report and never ships.
     * @type {{ sku: string, marginPct: number }[]}
     */
    belowCost: [],
  };

  // Group by part number: the export has the same part on several rows when it
  // was merged from more than one supplier code.
  /** @type {Map<string, Record<string, string>[]>} */
  const grouped = new Map();

  for (const record of records) {
    const partNumber = record[COLUMN.partNumber];
    if (!partNumber) {
      report.skipped.noPartNumber++;
      continue;
    }
    if (NOT_RETAIL_STOCK.test(partNumber)) {
      report.skipped.notRetailStock++;
      continue;
    }
    const status = record[COLUMN.status] || 'ACTIVE';
    const sellable = SELLABLE_STATUSES.has(status) || (includeReview && status === 'REVIEW');
    if (!sellable) {
      report.skipped.statusNotSellable++;
      continue;
    }
    const key = partNumber.toUpperCase();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }

  const products = [];

  for (const [, rows] of grouped) {
    const partNumber = rows[0][COLUMN.partNumber];

    // --- price ----------------------------------------------------------
    const prices = rows
      .map((r) => parseMoney(r[COLUMN.sellingExVat]))
      .filter((n) => Number.isFinite(n));
    const distinct = [...new Set(prices.map(toCents))];

    let priceExVat = null;
    if (distinct.length > 1) {
      // Two prices for one part number. Do not choose.
      report.skipped.priceConflict++;
      report.quarantined.push({
        sku: partNumber,
        reason: 'conflicting-prices',
        detail: `price list gives ${distinct.map((c) => `R${(c / 100).toFixed(2)}`).join(' and ')} for the same part number`,
      });
      continue;
    }
    if (distinct.length === 1) {
      const cents = distinct[0];
      if (cents <= 0) {
        report.skipped.invalidPrice++;
        report.quarantined.push({
          sku: partNumber,
          reason: 'invalid-price',
          detail: `selling price is R${(cents / 100).toFixed(2)}`,
        });
        continue;
      }
      priceExVat = cents / 100;
    } else {
      report.withoutPrice++;
    }

    // --- everything else ------------------------------------------------
    const family = rows.find((r) => r[COLUMN.family] && r[COLUMN.family] !== 'Unclassified')?.[COLUMN.family]
      ?? rows[0][COLUMN.family]
      ?? '';
    const legacyCodes = rows.flatMap((r) => [r['Current Sage Code'], r['Kage Code']]);
    const description = stripLegacyCode(
      bestName(rows.map((r) => r[COLUMN.description] ?? ''), partNumber),
      legacyCodes,
    );
    const { category, method } = classify({ family, description });
    report.classifiedBy[method]++;

    const onHand = Math.max(
      ...rows.map((r) => {
        const n = Number(r[COLUMN.onHand]);
        return Number.isFinite(n) ? n : 0;
      }),
    );

    const { sizes, angle } = parseAnSizes(partNumber, family, description);
    if (sizes.length > 0) report.withAnSizes++;
    if (angle !== null) report.withAngle++;

    if (priceExVat != null) {
      const costs = rows.map((r) => parseMoney(r['Cost R (landed/best)'])).filter((n) => Number.isFinite(n) && n > 0);
      const cost = costs.length > 0 ? Math.max(...costs) : null;
      if (cost != null && priceExVat <= cost) {
        report.belowCost.push({
          sku: partNumber,
          marginPct: Math.round(((priceExVat - cost) / priceExVat) * 1000) / 10,
        });
      }
    }

    products.push({
      sku: partNumber,
      name: tidyName(description),
      category,
      family: family || 'Unclassified',
      sizes,
      sizeLabel: formatSizeLabel(sizes),
      angle,
      angleLabel: formatAngleLabel(angle),
      uom: rows[0][COLUMN.uom] === 'M' ? 'M' : 'EA',
      priceExVat,
      priceIncVat: priceExVat == null ? null : addVat(priceExVat),
      availability: availabilityBand(onHand),
      enquireOnly: priceExVat == null,
    });
  }

  products.sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));

  const counts = new Map();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);

  const categories = CATEGORIES.filter((c) => counts.get(c.id) > 0).map((c) => ({
    ...c,
    count: counts.get(c.id),
  }));

  const catalogue = {
    generatedAt: new Date().toISOString().slice(0, 10),
    currency: 'ZAR',
    vatRate: VAT_RATE,
    pricesIncludeVat: true,
    stockSnapshot: '2026-03-21',
    categories,
    products,
  };

  return { catalogue, report };
}

/**
 * Fails loudly if anything confidential made it into the output. Cheap to run,
 * and the one check that matters most — the rest of the app is replaceable, a
 * published cost price is not.
 */
export function assertNoConfidentialData(catalogue, csvText) {
  const serialised = JSON.stringify(catalogue);

  for (const column of CONFIDENTIAL_COLUMNS) {
    if (serialised.includes(column)) {
      throw new Error(`Confidential column "${column}" appears in the published catalogue.`);
    }
  }

  const { records } = toRecords(parseCsv(csvText), COLUMN.partNumber);
  const bySku = new Map(catalogue.products.map((p) => [p.sku.toUpperCase(), p]));

  for (const record of records) {
    const product = bySku.get((record[COLUMN.partNumber] || '').toUpperCase());
    if (!product) continue;

    const cost = parseMoney(record['Cost R (landed/best)']);
    const sourceSelling = parseMoney(record[COLUMN.sellingExVat]);

    // A published price matching the landed cost only proves a leak when the
    // price list itself puts the two apart. One line (a fuel rail) really is
    // priced at cost, and that is a margin problem to report, not a leak.
    const costDiffersFromSelling =
      Number.isFinite(sourceSelling) && toCents(sourceSelling) !== toCents(cost);

    if (Number.isFinite(cost) && cost > 0 && costDiffersFromSelling) {
      if (product.priceExVat != null && toCents(product.priceExVat) === toCents(cost)) {
        throw new Error(`${product.sku}: published price equals the landed cost — cost data has leaked.`);
      }
      if (product.priceIncVat != null && toCents(product.priceIncVat) === toCents(cost)) {
        throw new Error(`${product.sku}: published VAT-inclusive price equals the landed cost.`);
      }
    }

    for (const field of ['Kage Code', 'Other Supplier Codes', 'ANF_SKU (internal)', 'Bin']) {
      const value = (record[field] || '').trim();
      if (value === '') continue;
      const serialisedProduct = JSON.stringify(product);
      if (serialisedProduct.includes(value) && value.toUpperCase() !== product.sku.toUpperCase()) {
        throw new Error(`${product.sku}: internal value "${value}" (${field}) appears in the published record.`);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function main() {
  const args = process.argv.slice(2);
  const sourceArg = args.indexOf('--source');
  const source = sourceArg !== -1
    ? path.resolve(args[sourceArg + 1])
    : path.join(ROOT, 'data', 'source', 'anf-pricelist.csv');
  const includeReview = args.includes('--include-review');

  if (!fs.existsSync(source)) {
    console.error(`\nNo price list at ${source}\n`);
    console.error('Export the pricing sheet as CSV and save it there, then run this again.');
    console.error('See docs/DATA.md for the expected columns.\n');
    process.exit(1);
  }

  const csvText = fs.readFileSync(source, 'utf8');
  const { catalogue, report } = buildCatalogue(csvText, { includeReview });

  assertNoConfidentialData(catalogue, csvText);

  const outFile = path.join(ROOT, 'src', 'data', 'catalogue.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(catalogue, null, 2)}\n`);

  const reportFile = path.join(ROOT, 'data', 'import-report.json');
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const priced = catalogue.products.filter((p) => !p.enquireOnly).length;
  console.log(`\nCatalogue built  ->  ${path.relative(ROOT, outFile)}`);
  console.log(`  ${catalogue.products.length} products across ${catalogue.categories.length} categories`);
  console.log(`  ${priced} priced, ${catalogue.products.length - priced} price-on-request`);
  console.log(`  ${report.withAnSizes} with AN sizes and ${report.withAngle} with bend angles derived from part numbers`);
  console.log('\nHeld back:');
  console.log(`  ${report.skipped.statusNotSellable} not ACTIVE${includeReview ? ' (REVIEW included)' : ' (REVIEW / INACTIVE)'}`);
  console.log(`  ${report.skipped.priceConflict} with conflicting prices for one part number`);
  console.log(`  ${report.skipped.invalidPrice} with an invalid price`);
  console.log(`  ${report.skipped.notRetailStock} labour / workshop lines`);
  if (report.quarantined.length > 0) {
    console.log(`\n${report.quarantined.length} part numbers need fixing in the price list:`);
    for (const q of report.quarantined) console.log(`  ${q.sku.padEnd(22)} ${q.detail}`);
  }
  if (report.belowCost.length > 0) {
    console.log(`\n${report.belowCost.length} parts sell at or below landed cost:`);
    for (const b of report.belowCost) console.log(`  ${b.sku.padEnd(22)} margin ${b.marginPct}%`);
  }
  console.log(`\nFull report -> ${path.relative(ROOT, reportFile)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
