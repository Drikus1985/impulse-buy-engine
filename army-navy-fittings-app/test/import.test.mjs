import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, toRecords } from '../scripts/lib/csv.mjs';
import { classify, parseAnSizes, formatSizeLabel, formatAngleLabel } from '../scripts/lib/classify.mjs';
import {
  addVat,
  availabilityBand,
  assertNoConfidentialData,
  buildCatalogue,
  parseMoney,
  stripLegacyCode,
  tidyName,
  toCents,
  VAT_RATE,
} from '../scripts/import-catalogue.mjs';

const HEADER =
  'ANF Part Number (FINAL),Current Sage Code,Kage Code,Other Supplier Codes,Description,Family,' +
  'On Hand (Sage 21/03/2026),UoM,Cost R (landed/best),Selling Excl R,Bin,Kage USD 2026,ANF_SKU (internal),Status,Change Note';

/** Builds a price-list CSV with the same shape as the real export. */
function csv(...rows) {
  return ['RULE: a free-text note above the header,,,,,,,,,,,,,,', HEADER, ...rows].join('\n');
}

/* ------------------------------------------------------------------ csv */

test('finds the header below the rule line the export puts on top', () => {
  const { records, headerIndex } = toRecords(
    parseCsv(csv('ANF-1,,,,Widget,Adapter,4,EA,10,20,,,ANF-01,ACTIVE,')),
    'ANF Part Number (FINAL)',
  );
  assert.equal(headerIndex, 1);
  assert.equal(records.length, 1);
  assert.equal(records['0']['Description'], 'Widget');
});

test('keeps commas and quotes inside quoted cells', () => {
  const rows = parseCsv('a,b\n"one, two","he said ""hi"""');
  assert.deepEqual(rows[1], ['one, two', 'he said "hi"']);
});

test('strips the byte-order mark Google Sheets exports', () => {
  const rows = parseCsv('﻿ANF Part Number (FINAL),x\n1,2');
  assert.equal(rows['0']['0'], 'ANF Part Number (FINAL)');
});

test('reads South African decimal commas in money columns', () => {
  assert.equal(parseMoney('1234,50'), 1234.5);
  assert.equal(parseMoney('R 89.31'), 89.31);
  assert.ok(Number.isNaN(parseMoney('')));
});

/* -------------------------------------------------------------- pricing */

test('adds VAT at the South African rate and rounds to cents', () => {
  assert.equal(VAT_RATE, 0.15);
  assert.equal(addVat(100), 115);
  assert.equal(addVat(51.9), 59.69); // 59.685 rounds up
  assert.equal(addVat(23.28), 26.77);
});

test('rounds to cents without floating-point drift', () => {
  assert.equal(toCents(59.685), 5969);
  assert.equal(toCents(0.1 + 0.2), 30);
});

test('publishes stock as a band, never an exact count', () => {
  assert.equal(availabilityBand(42), 'in-stock');
  assert.equal(availabilityBand(6), 'in-stock');
  assert.equal(availabilityBand(5), 'low-stock');
  assert.equal(availabilityBand(1), 'low-stock');
  assert.equal(availabilityBand(0), 'on-order');
  assert.equal(availabilityBand(NaN), 'on-order');
});

/* ------------------------------------------------------- classification */

test('routes a family to its shop category', () => {
  assert.equal(classify({ family: 'Hose End (push-on)', description: '' }).category, 'hose-ends');
  assert.equal(classify({ family: 'Lubricant/Fluid', description: '' }).category, 'oils-fluids');
});

test('falls back to the description for unclassified rows', () => {
  const result = classify({ family: 'Unclassified', description: 'Line Separators' });
  assert.equal(result.category, 'clamps-accessories');
  assert.equal(result.method, 'description');
});

test('sends a genuinely unknown row to Other rather than guessing', () => {
  assert.equal(classify({ family: 'Unclassified', description: 'Insulator Engine' }).category, 'other');
});

/* ------------------------------------------------------------ AN sizing */

test('reads a single dash size', () => {
  assert.deepEqual(parseAnSizes('ANFAN920-08', 'AN male to O-ring port (ORB)').sizes, [8]);
  assert.deepEqual(parseAnSizes('ANFAN833-10', 'Bulkhead fitting').sizes, [10]);
});

test('reads both ends of a reducer', () => {
  assert.deepEqual(parseAnSizes('ANFAN920-08-16', 'AN male to O-ring port (ORB)').sizes, [8, 16]);
});

test('reads the bend angle out of a hose-end part number', () => {
  const ninety = parseAnSizes('ANFX236-9010', 'Hose End (braided, cutter style)');
  assert.deepEqual(ninety.sizes, [10]);
  assert.equal(ninety.angle, 90);

  const oneTwenty = parseAnSizes('ANPTFE-1208-L', 'Hose End (PTFE hose)');
  assert.deepEqual(oneTwenty.sizes, [8]);
  assert.equal(oneTwenty.angle, 120);

  const oneEighty = parseAnSizes('TRSTEF-1804', 'Hose End (PTFE hose, TRS brand)');
  assert.equal(oneEighty.angle, 180);
  assert.deepEqual(oneEighty.sizes, [4]);
});

test('treats a doubled size on a hose end as straight only when the description says so', () => {
  const straight = parseAnSizes('ANFBKRF-0303SS', 'Hose End', 'SS Hose End STR0303');
  assert.deepEqual(straight.sizes, [3]);
  assert.equal(straight.angle, 0);

  // Same part number, no "STR" anywhere: claim nothing rather than assume.
  assert.deepEqual(parseAnSizes('ANFBKRF-0303SS', 'Hose End', 'SS Hose End').sizes, []);
});

test('ignores stainless and length suffixes', () => {
  assert.deepEqual(parseAnSizes('ANCUT-06-L', 'Hose End').sizes, [6]);
  assert.deepEqual(parseAnSizes('ANFAN832-4SS', 'Bulkhead fitting').sizes, [4]);
});

test('does not read a thread specification as an AN size', () => {
  // 3/8-24 is a thread, not AN24.
  assert.deepEqual(parseAnSizes('ANBJB-3,8-24', 'Banjo bolt').sizes, []);
  // 100x120mm hose clamp, not AN12.
  assert.deepEqual(parseAnSizes('ANFHC-100-120X12', 'Clamp').sizes, []);
  // A dimension, not a size.
  assert.deepEqual(parseAnSizes('ANFANBJS776-10-22.5', 'Banjo fitting').sizes, []);
});

test('takes only the AN end of an adapter whose other end is NPT, BSP or metric', () => {
  // -10 is AN10; -12D is a 1/2" NPT thread and must not become "AN12".
  assert.deepEqual(parseAnSizes('ANFAN816-10-12D', 'AN to NPT adapter').sizes, [10]);
  assert.deepEqual(parseAnSizes('ANFAN816-6-1/8X28BSPP', 'BSP adapter').sizes, [6]);
});

test('rejects dash numbers that are not AN sizes', () => {
  assert.deepEqual(parseAnSizes('ANFALUBEND-22', 'Adapter').sizes, []); // 22mm elbow
  assert.deepEqual(parseAnSizes('ANFALUBEND-25', 'Adapter').sizes, []);
});

test('claims nothing for families where dash numbers mean something else', () => {
  assert.deepEqual(parseAnSizes('ANF617-7204-ST', 'Weld bung').sizes, []);
  assert.deepEqual(parseAnSizes('AMTEC-1132', 'Lubricant/Fluid').sizes, []);
});

test('formats size and angle labels', () => {
  assert.equal(formatSizeLabel([8]), 'AN8');
  assert.equal(formatSizeLabel([8, 16]), 'AN8 → AN16');
  assert.equal(formatSizeLabel([]), '');
  assert.equal(formatAngleLabel(0), 'Straight');
  assert.equal(formatAngleLabel(90), '90°');
  assert.equal(formatAngleLabel(null), '');
});

test('drops a legacy stock code the description opens with', () => {
  assert.equal(stripLegacyCode('ANHC20-32 Hose Clamp 12mm 20x32', ['ANHC20-32']), 'Hose Clamp 12mm 20x32');
  // A leading AN size is not a code — it is the most useful word in the name.
  assert.equal(stripLegacyCode('AN10 Flare Filter Insert', ['ANIFF-10']), 'AN10 Flare Filter Insert');
  // Never strip the description down to nothing.
  assert.equal(stripLegacyCode('ANHC20-32 x', ['ANHC20-32']), 'ANHC20-32 x');
  assert.equal(stripLegacyCode('Hose Clamp', ['']), 'Hose Clamp');
});

test('tidies shouted descriptions without breaking initialisms', () => {
  assert.equal(tidyName('SSBARB ADAPTOR'), 'Ssbarb Adaptor');
  assert.equal(tidyName('TUBE TO FEMALE AN ADAPTOR'), 'Tube To Female AN Adaptor');
  assert.equal(tidyName('Billet Fuel Filters'), 'Billet Fuel Filters');
});

/* ----------------------------------------------------------- the gates */

test('quarantines a part number the price list prices two different ways', () => {
  const { catalogue, report } = buildCatalogue(
    csv(
      'ANFAN924-3,,,,Stainless Bulkhead Nut,Bulkhead,28,EA,10,36.99,,,ANF-01,ACTIVE,',
      'ANFAN924-3,,,,Bulk Head Nuts,Nut,19,EA,10,16.84,,,ANF-02,ACTIVE,',
    ),
  );
  assert.equal(catalogue.products.length, 0, 'a conflicted part must not be published');
  assert.equal(report.skipped.priceConflict, 1);
  assert.equal(report.quarantined['0'].reason, 'conflicting-prices');
  assert.match(report.quarantined['0'].detail, /R36\.99 and R16\.84/);
});

test('merges duplicate rows that agree on price', () => {
  const { catalogue } = buildCatalogue(
    csv(
      'ANFAN833-10,,,,Bulk Head Adaptors,Adapter,15,EA,10,294.58,,,ANF-01,ACTIVE,',
      'ANFAN833-10,,,,Flare Bulkhead 9010,Bulkhead fitting,22,EA,10,294.58,,,ANF-02,ACTIVE,',
    ),
  );
  assert.equal(catalogue.products.length, 1);
  const product = catalogue.products['0'];
  assert.equal(product.priceExVat, 294.58);
  assert.equal(product.name, 'Flare Bulkhead 9010', 'keeps the description that says the most');
  assert.equal(product.availability, 'in-stock');
});

test('refuses a zero or negative selling price', () => {
  const { catalogue, report } = buildCatalogue(csv('ANF-BAD,,,,Widget,Adapter,4,EA,10,-0.01,,,ANF-01,ACTIVE,'));
  assert.equal(catalogue.products.length, 0);
  assert.equal(report.skipped.invalidPrice, 1);
});

test('holds back anything not marked ACTIVE unless asked for it', () => {
  const rows = csv(
    'ANF-A,,,,Active part,Adapter,4,EA,10,20,,,ANF-01,ACTIVE,',
    'ANF-R,,,,Under review,Adapter,4,EA,10,20,,,ANF-02,REVIEW,',
    'ANF-I,,,,Retired,Adapter,4,EA,10,20,,,ANF-03,INACTIVE-SAGE,',
  );
  const strict = buildCatalogue(rows);
  assert.deepEqual(strict.catalogue.products.map((p) => p.sku), ['ANF-A']);
  assert.equal(strict.report.skipped.statusNotSellable, 2);

  const relaxed = buildCatalogue(rows, { includeReview: true });
  assert.deepEqual(relaxed.catalogue.products.map((p) => p.sku).sort(), ['ANF-A', 'ANF-R']);
});

test('leaves workshop labour lines out of the shop', () => {
  const { catalogue, report } = buildCatalogue(
    csv(
      'AAMWS-LAB,,,,AAMWS - LABOUR,Unclassified,0,EA,,500,,,ANF-01,ACTIVE,',
      'ANF-A,,,,Real part,Adapter,4,EA,10,20,,,ANF-02,ACTIVE,',
    ),
  );
  assert.deepEqual(catalogue.products.map((p) => p.sku), ['ANF-A']);
  assert.equal(report.skipped.notRetailStock, 1);
});

test('lists a part with no price as price-on-request rather than dropping it', () => {
  const { catalogue } = buildCatalogue(csv('ANF-NP,,,,Neck Cap VW,Cap,4,EA,10,,,,ANF-01,ACTIVE,'));
  const product = catalogue.products['0'];
  assert.equal(product.enquireOnly, true);
  assert.equal(product.priceExVat, null);
  assert.equal(product.priceIncVat, null);
});

test('records parts that sell at or below landed cost', () => {
  // A real line in the price list: the fuel rail sells for exactly what it
  // costs. The shop's own selling price still publishes — it is their price —
  // but the zero margin is reported so somebody can look at it.
  const { catalogue, report } = buildCatalogue(csv('TRS121-FR,,,,Fuel Rail,Adapter,5,EA,175.75,175.75,,,ANF-01,ACTIVE,'));
  assert.equal(report.belowCost.length, 1);
  assert.equal(report.belowCost['0'].sku, 'TRS121-FR');
  assert.equal(report.belowCost['0'].marginPct, 0);
  assert.equal(catalogue.products['0'].priceExVat, 175.75);
  assert.ok(!('cost' in catalogue.products['0']), 'no cost field ever reaches the catalogue');
});

test('the below-cost report carries enough to act on, worst first', () => {
  const { catalogue, report } = buildCatalogue(
    csv(
      // 20 on the shelf, R7.21 given away on each
      'ANFHC-100-121,,,,Hose Clamp,Clamp,20,EA,22.00,14.79,,,ANF-01,ACTIVE,',
      // a far worse margin, but only one in stock
      'AMTEC-1207,,,,Semi Synthetic 10W40,Lubricant/Fluid,1,EA,1137.40,113.03,,,ANF-02,ACTIVE,',
      // healthy margin — must not appear at all
      'ANF-OK,,,,Fine part,Adapter,5,EA,10,50,,,ANF-03,ACTIVE,',
    ),
  );

  assert.equal(report.belowCost.length, 2, 'only the loss-making parts are reported');
  assert.deepEqual(report.belowCost.map((b) => b.sku), ['AMTEC-1207', 'ANFHC-100-121'], 'worst margin first');

  const clamp = report.belowCost.find((b) => b.sku === 'ANFHC-100-121');
  assert.equal(clamp.sellExVat, 14.79);
  assert.equal(clamp.cost, 22);
  assert.equal(clamp.lossPerUnit, 7.21);
  assert.equal(clamp.onHand, 20);
  assert.equal(clamp.exposure, 144.2, '20 on the shelf x R7.21');
  assert.equal(clamp.name, 'Hose Clamp');

  // R1024.37 on the oil + R144.20 on the clamps
  assert.equal(report.belowCostExposure, 1168.57);
  assert.equal(catalogue.products.length, 3, 'nothing is held back — these are the shop\'s own prices');
});

test('a part with nothing on the shelf is reported but adds no exposure', () => {
  const { report } = buildCatalogue(csv('ANF-X,,,,Widget,Adapter,0,EA,100,90,,,ANF-01,ACTIVE,'));
  assert.equal(report.belowCost.length, 1);
  assert.equal(report.belowCost['0'].lossPerUnit, 10);
  assert.equal(report.belowCost['0'].exposure, 0);
  assert.equal(report.belowCostExposure, 0);
});

test('a rounded 0% that still loses a cent sorts above one that loses nothing', () => {
  const { report } = buildCatalogue(
    csv(
      'AT-COST,,,,At cost,Adapter,5,EA,175.75,175.75,,,ANF-01,ACTIVE,',
      'ONE-CENT,,,,A cent under,Adapter,5,EA,430.00,429.99,,,ANF-02,ACTIVE,',
    ),
  );
  assert.deepEqual(report.belowCost.map((b) => b.sku), ['ONE-CENT', 'AT-COST']);
});

test('the margin report stays out of the published catalogue', () => {
  const source = csv('TRS121-FR,,,,Fuel Rail,Adapter,5,EA,175.75,175.75,,,ANF-01,ACTIVE,');
  const { catalogue } = buildCatalogue(source);
  assert.ok(!JSON.stringify(catalogue).includes('belowCost'));
  assert.ok(!JSON.stringify(catalogue).includes('marginPct'));
});

/* --------------------------------------------------------- the guard */

test('published records carry no cost, supplier code, bin or internal SKU', () => {
  const source = csv(
    'ANFAN920-04,ANORP-04,KJAN920-04,TRS108-04,AN Male to O-Ring Port,AN male to O-ring port (ORB),42,EA,25.27,51.9,B12,1.11,ANF-000659,ACTIVE,absorbs TRS TRS108-04',
  );
  const { catalogue } = buildCatalogue(source);
  assert.doesNotThrow(() => assertNoConfidentialData(catalogue, source));

  const serialised = JSON.stringify(catalogue);
  for (const secret of ['25.27', 'KJAN920-04', 'TRS108-04', 'ANORP-04', 'ANF-000659', 'B12', '1.11', 'absorbs TRS']) {
    assert.ok(!serialised.includes(secret), `"${secret}" must not reach the published catalogue`);
  }
});

test('the guard catches a cost price that leaks into the catalogue', () => {
  const source = csv('ANF-X,,,,Widget,Adapter,4,EA,25.27,51.9,,,ANF-01,ACTIVE,');
  const { catalogue } = buildCatalogue(source);
  // Simulate a regression that publishes cost instead of the selling price.
  catalogue.products['0'].priceExVat = 25.27;
  assert.throws(() => assertNoConfidentialData(catalogue, source), /cost data has leaked/);
});

test('the guard catches a confidential column name in the output', () => {
  const source = csv('ANF-X,,,,Widget,Adapter,4,EA,25.27,51.9,,,ANF-01,ACTIVE,');
  const { catalogue } = buildCatalogue(source);
  catalogue.products['0'].note = 'Cost R (landed/best)';
  assert.throws(() => assertNoConfidentialData(catalogue, source), /Confidential column/);
});

/* ---------------------------------------------------- end-to-end shape */

test('produces a catalogue the app can render', () => {
  const { catalogue } = buildCatalogue(
    csv(
      'ANFAN920-04,,,,AN Male to O-Ring Port,AN male to O-ring port (ORB),42,EA,25.27,51.9,,,ANF-01,ACTIVE,',
      'ANPTFE-1208-L,,,,Teflon Hose Ends 1208,Hose End (PTFE hose),0,M,10,120,,,ANF-02,ACTIVE,',
    ),
  );

  assert.equal(catalogue.currency, 'ZAR');
  assert.equal(catalogue.pricesIncludeVat, true);
  assert.equal(catalogue.vatRate, 0.15);
  assert.ok(catalogue.categories.every((c) => c.count > 0), 'empty categories are dropped');

  const hoseEnd = catalogue.products.find((p) => p.sku === 'ANPTFE-1208-L');
  assert.equal(hoseEnd.uom, 'M');
  assert.equal(hoseEnd.angleLabel, '120°');
  assert.equal(hoseEnd.sizeLabel, 'AN8');
  assert.equal(hoseEnd.priceIncVat, 138);
  assert.equal(hoseEnd.availability, 'on-order');
});
