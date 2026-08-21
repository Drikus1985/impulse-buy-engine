import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFilters, buildIndex, rankResults, tokenAsSize, availableFacets, EMPTY_FILTERS } from '../src/lib/search.ts';
import { addLine, calculateTotals, removeLine, setQuantity } from '../src/lib/cart.ts';
import { buildQuoteText, formatRand, whatsAppLink, SHOP } from '../src/lib/shop.ts';
import { AN_SIZES, findAnSize } from '../src/lib/an-reference.ts';

/** A small stand-in catalogue with the shapes the real one contains. */
const PRODUCTS = [
  mk({ sku: 'ANFAN920-08', name: 'AN Male to O-Ring Port', category: 'adapters', sizes: [8], sizeLabel: 'AN8', priceExVat: 84.99, priceIncVat: 97.74, availability: 'low-stock' }),
  mk({ sku: 'ANFAN920-08-16', name: 'AN Male to O-Ring Port', category: 'adapters', sizes: [8, 16], sizeLabel: 'AN8 → AN16', priceExVat: 197.33, priceIncVat: 226.93 }),
  mk({ sku: 'ANFX236-9010', name: 'AN10 Rubber 9010', category: 'hose-ends', sizes: [10], sizeLabel: 'AN10', angle: 90, angleLabel: '90°', priceExVat: 120, priceIncVat: 138 }),
  mk({ sku: 'ANPTFE-1208-L', name: 'Teflon Hose Ends 1208', category: 'hose-ends', sizes: [8], sizeLabel: 'AN8', angle: 120, angleLabel: '120°', priceExVat: 150, priceIncVat: 172.5, availability: 'on-order' }),
  mk({ sku: 'ANWN-01', name: 'Neck Cap VW', category: 'caps-plugs', priceExVat: null, priceIncVat: null, enquireOnly: true }),
  mk({ sku: 'ANPTFESS-08', name: 'PTFE SS Braided Hose', category: 'hose', sizes: [8], sizeLabel: 'AN8', uom: 'M', priceExVat: 200, priceIncVat: 230 }),
];

function mk(overrides) {
  return {
    sku: 'X', name: 'X', category: 'other', family: 'Adapter',
    sizes: [], sizeLabel: '', angle: null, angleLabel: '',
    uom: 'EA', priceExVat: 10, priceIncVat: 11.5,
    availability: 'in-stock', enquireOnly: false,
    ...overrides,
  };
}

const INDEX = buildIndex(PRODUCTS);
const bySku = new Map(PRODUCTS.map((p) => [p.sku, p]));

const search = (query, extra = {}) =>
  rankResults(applyFilters(PRODUCTS, INDEX, { ...EMPTY_FILTERS, query, ...extra }), query);

/* ------------------------------------------------------------- search */

test('finds a part by its exact part number, and puts it first', () => {
  const results = search('ANFAN920-08');
  assert.equal(results['0'].sku, 'ANFAN920-08');
  assert.ok(results.length >= 2, 'the reducer variant also matches');
});

test('finds a part number typed without its dashes', () => {
  assert.equal(search('anfan92008')['0'].sku, 'ANFAN920-08');
});

test('reads a size out of the search box in the forms people type', () => {
  assert.equal(tokenAsSize('an8'), 8);
  assert.equal(tokenAsSize('AN10'), 10);
  assert.equal(tokenAsSize('-6'), 6);
  assert.equal(tokenAsSize('dash12'), 12);
  assert.equal(tokenAsSize('hose'), null);

  const results = search('an8');
  assert.ok(results.every((p) => p.sizes.includes(8)));
  assert.ok(results.some((p) => p.sku === 'ANFAN920-08-16'), 'an AN8-to-AN16 reducer is an AN8 part');
});

test('every word in the query has to match', () => {
  const both = search('teflon an8');
  assert.deepEqual(both.map((p) => p.sku), ['ANPTFE-1208-L']);
  assert.equal(search('teflon an20').length, 0);
});

test('filters by category, size, bend and availability together', () => {
  assert.equal(applyFilters(PRODUCTS, INDEX, { ...EMPTY_FILTERS, category: 'hose-ends' }).length, 2);
  assert.equal(applyFilters(PRODUCTS, INDEX, { ...EMPTY_FILTERS, angles: [90] }).length, 1);
  assert.equal(applyFilters(PRODUCTS, INDEX, { ...EMPTY_FILTERS, sizes: [8] }).length, 4);

  const onShelf = applyFilters(PRODUCTS, INDEX, { ...EMPTY_FILTERS, inStockOnly: true });
  assert.ok(!onShelf.some((p) => p.availability === 'on-order'));
});

test('an unpriced part is excluded by a price ceiling rather than treated as free', () => {
  const capped = applyFilters(PRODUCTS, INDEX, { ...EMPTY_FILTERS, maxPrice: 500 });
  assert.ok(!capped.some((p) => p.sku === 'ANWN-01'));
});

test('with no query, stock on the shelf comes first', () => {
  const browsing = rankResults(PRODUCTS, '');
  assert.equal(browsing['0'].availability, 'in-stock');
  assert.equal(browsing[browsing.length - 1].availability, 'on-order');
});

test('facets list only the sizes and bends actually present', () => {
  const facets = availableFacets(PRODUCTS);
  assert.deepEqual(facets.sizes, [8, 10, 16]);
  assert.deepEqual(facets.angles, [90, 120]);
});

/* --------------------------------------------------------------- cart */

test('adding the same part twice increases its quantity', () => {
  let lines = addLine([], 'ANFAN920-08');
  lines = addLine(lines, 'ANFAN920-08');
  assert.deepEqual(lines, [{ sku: 'ANFAN920-08', quantity: 2 }]);
});

test('setting a quantity to zero removes the line', () => {
  const lines = setQuantity([{ sku: 'A', quantity: 3 }], 'A', 0);
  assert.deepEqual(lines, []);
  assert.deepEqual(removeLine([{ sku: 'A', quantity: 1 }], 'A'), []);
});

test('totals add up in cents, and VAT is the portion already inside them', () => {
  const totals = calculateTotals(
    [{ sku: 'ANFAN920-08', quantity: 3 }, { sku: 'ANFX236-9010', quantity: 1 }],
    bySku,
    0.15,
  );
  // 97.74 x 3 = 293.22, + 138.00 = 431.22
  assert.equal(totals.subtotalIncVat, 431.22);
  assert.equal(totals.itemCount, 4);
  // 431.22 x 15/115 = 56.246... -> 56.25
  assert.equal(totals.vatPortion, 56.25);
  assert.equal(totals.priced.length, 2);
});

test('a repeated cent-fraction price does not drift', () => {
  const drifty = new Map([['D', mk({ sku: 'D', priceIncVat: 0.1 })]]);
  const totals = calculateTotals([{ sku: 'D', quantity: 3 }], drifty, 0.15);
  assert.equal(totals.subtotalIncVat, 0.3);
});

test('an unpriced part goes on the list to be quoted, not totalled', () => {
  const totals = calculateTotals([{ sku: 'ANWN-01', quantity: 2 }], bySku, 0.15);
  assert.equal(totals.priced.length, 0);
  assert.equal(totals.enquiry.length, 1);
  assert.equal(totals.subtotalIncVat, 0);
  assert.equal(totals.itemCount, 2, 'it still counts as something in the list');
});

test('a part that has left the catalogue is skipped rather than crashing the cart', () => {
  const totals = calculateTotals([{ sku: 'GONE-99', quantity: 1 }], bySku, 0.15);
  assert.equal(totals.priced.length, 0);
  assert.equal(totals.itemCount, 0);
});

/* -------------------------------------------------------------- quote */

test('the quote lists every part, its total, and says it is an estimate', () => {
  const totals = calculateTotals(
    [{ sku: 'ANFAN920-08', quantity: 2 }, { sku: 'ANWN-01', quantity: 1 }],
    bySku,
    0.15,
  );
  const text = buildQuoteText(totals, { name: 'Drikus', phone: '082 555 1234', email: '', notes: 'For an LS swap' });

  assert.match(text, /Army Navy Fittings/);
  assert.match(text, /Name: Drikus/);
  assert.match(text, /ANFAN920-08 .* \(x2\) — R195\.48/);
  assert.match(text, /ANWN-01 .* price please/, 'unpriced parts ask for a price');
  assert.match(text, /Estimated total \(incl\. VAT\): R195\.48/);
  assert.match(text, /Excludes delivery/);
  assert.match(text, /Notes: For an LS swap/);
});

test('hose sold by the metre is quoted in metres', () => {
  const totals = calculateTotals([{ sku: 'ANPTFESS-08', quantity: 3 }], bySku, 0.15);
  const text = buildQuoteText(totals, { name: '', phone: '', email: '', notes: '' });
  assert.match(text, /\(m3\)/);
});

test('the WhatsApp link points at the shop and carries the quote', () => {
  const totals = calculateTotals([{ sku: 'ANFAN920-08', quantity: 1 }], bySku, 0.15);
  const link = whatsAppLink(buildQuoteText(totals, { name: '', phone: '', email: '', notes: '' }));
  assert.ok(link.startsWith(`https://wa.me/${SHOP.phoneDigits}?text=`));
  assert.match(decodeURIComponent(link), /ANFAN920-08/);
});

test('rands are formatted for South African reading', () => {
  assert.equal(formatRand(97.74), 'R97.74');
  assert.equal(formatRand(1719.25), 'R1 719.25');
  assert.equal(formatRand(0), 'R0.00');
});

/* ---------------------------------------------------------- reference */

test('the AN size chart holds the standard figures', () => {
  assert.equal(findAnSize(8).thread, '3/4"-16');
  assert.equal(findAnSize(8).tubeOd, '1/2"');
  assert.equal(findAnSize(6).thread, '9/16"-18');
  assert.equal(findAnSize(99), undefined);
});

test('every AN dash number is the tube OD in sixteenths of an inch', () => {
  // -8 is 8/16" = 1/2". This is the definition, so it must hold for the lot.
  // Handles `1/8`, `1 1/4` and a bare `1`.
  const asSixteenths = (imperial) => {
    const inches = imperial.replace('"', '').trim().split(' ').reduce((sum, part) => {
      const [num, den] = part.split('/');
      return sum + (den ? Number(num) / Number(den) : Number(num));
    }, 0);
    return inches * 16;
  };
  for (const size of AN_SIZES) {
    assert.equal(asSixteenths(size.tubeOd), size.dash, `AN${size.dash} tube OD should be ${size.dash}/16"`);
  }
});
