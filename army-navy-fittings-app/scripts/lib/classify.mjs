/**
 * Turns the two loose columns in the price list — `Family` and `Description` —
 * into the shop categories a customer actually browses, and derives AN dash
 * sizes from part numbers.
 *
 * The category names mirror the sections on anfittings.co.za so the app and the
 * website stay recognisably the same shop.
 */

/** Shop categories, in the order they appear in the app. */
export const CATEGORIES = [
  { id: 'hose-ends', name: 'Hose Ends' },
  { id: 'adapters', name: 'AN Adapters & Fittings' },
  { id: 'hose', name: 'Hose' },
  { id: 'banjos', name: "Banjo's & Bolts" },
  { id: 'bulkheads', name: 'Bulkheads' },
  { id: 'caps-plugs', name: 'Caps & Plugs' },
  { id: 'weld-bungs', name: 'Weld Bungs' },
  { id: 'clamps-accessories', name: 'Clamps & Hose Accessories' },
  { id: 'fuel-filters', name: 'Fuel Filters & Accessories' },
  { id: 'valves-gauges', name: 'Valves, Gauges & Regulators' },
  { id: 'oils-fluids', name: 'Oils & Fluids' },
  { id: 'exhaust', name: 'Exhaust' },
  { id: 'tools', name: 'Tools' },
  { id: 'shifters', name: 'Shifters' },
  { id: 'other', name: 'Other Parts' },
];

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

/** Exact `Family` value -> category id. Applied first, and trusted. */
const FAMILY_TO_CATEGORY = {
  'Hose End': 'hose-ends',
  'Hose End (braided, cutter style)': 'hose-ends',
  'Hose End (braided, cutter style, TRS brand)': 'hose-ends',
  'Hose End (braided, cutter style, ANF series)': 'hose-ends',
  'Hose End (push-on)': 'hose-ends',
  'Hose End (push-lock, TRS brand)': 'hose-ends',
  'Hose End (PTFE hose)': 'hose-ends',
  'Hose End (PTFE hose, TRS brand)': 'hose-ends',

  Adapter: 'adapters',
  'Metric adapter': 'adapters',
  'AN to metric adapter': 'adapters',
  'AN to NPT adapter': 'adapters',
  'BSP adapter': 'adapters',
  'Barb adapter': 'adapters',
  'AN male to O-ring port (ORB)': 'adapters',
  'O-ring port fitting': 'adapters',
  Reducer: 'adapters',
  Union: 'adapters',
  Tee: 'adapters',
  Elbow: 'adapters',

  Hose: 'hose',
  'PTFE hose SS braided': 'hose',
  'PTFE hose SS braided (per metre)': 'hose',
  'SS braided NBR rubber hose': 'hose',
  'Push-on hose (per metre)': 'hose',

  'Banjo fitting': 'banjos',
  'Banjo bolt': 'banjos',

  Bulkhead: 'bulkheads',
  'Bulkhead fitting': 'bulkheads',
  'Bulkhead nut': 'bulkheads',

  Cap: 'caps-plugs',
  Plug: 'caps-plugs',
  'NPT plug': 'caps-plugs',

  'Weld bung': 'weld-bungs',
  'Weld bung (male)': 'weld-bungs',

  Clamp: 'clamps-accessories',
  Sleeve: 'clamps-accessories',
  Washer: 'clamps-accessories',
  Nut: 'clamps-accessories',

  Filter: 'fuel-filters',
  Valve: 'valves-gauges',
  Gauge: 'valves-gauges',
  'Lubricant/Fluid': 'oils-fluids',
  'SS Exhaust Material': 'exhaust',
};

/**
 * Description keywords for the ~300 rows whose Family is `Unclassified` or the
 * brand label `TRS-branded item`. First match wins, so the list is ordered from
 * most to least specific.
 */
const DESCRIPTION_RULES = [
  [/\bshifter/i, 'shifters'],
  [/\bspanner|\bwrench|\bvice|\bvise|\btool|\bexpander|\btorx|\bcrimp|\bdie\b/i, 'tools'],
  [/\bregulator|\bgauge|\bsensor|\btps\b|\bvalve|\bsolenoid/i, 'valves-gauges'],
  [/\bfilter|\bfuel pump|\bcatch (can|tank)|\bfuel cell|\bswirl (pot|tank)|\bfuel rail|\binjector/i, 'fuel-filters'],
  [/\boil\b|\bgrease|\bcoolant|\bbrake fluid|\blubricant|\bmotul/i, 'oils-fluids'],
  [/\bexhaust|\bmandril|\bmandrel|\bflex\b|\bbend\b|\bmuffler|\bsilencer/i, 'exhaust'],
  [/\bhose end|\bhose-end/i, 'hose-ends'],
  [/\bbulk ?head/i, 'bulkheads'],
  [/\bbanjo/i, 'banjos'],
  [/\bweld bung|\bweld-on|\bweld on/i, 'weld-bungs'],
  [/\bcap\b|\bplug\b/i, 'caps-plugs'],
  [/\bclamp|\bseparator|\bseperator|\bp clamp|\bgrommet|\bbush(es)?\b/i, 'clamps-accessories'],
  [/\bhose\b|\bline\b/i, 'hose'],
  [/\badapt|\bquick connect|\breducer|\bunion\b|\btee\b|\bswivel|\bfitting/i, 'adapters'],
];

/**
 * @param {{ family: string, description: string }} row
 * @returns {{ category: string, method: 'family' | 'description' | 'fallback' }}
 */
export function classify(row) {
  const byFamily = FAMILY_TO_CATEGORY[row.family];
  if (byFamily) return { category: byFamily, method: 'family' };

  const text = `${row.description} ${row.family}`;
  for (const [pattern, category] of DESCRIPTION_RULES) {
    if (pattern.test(text)) return { category, method: 'description' };
  }
  return { category: 'other', method: 'fallback' };
}

export function isKnownCategory(id) {
  return CATEGORY_IDS.has(id);
}

/* ------------------------------------------------------------------ *
 * AN dash sizes
 * ------------------------------------------------------------------ */

/** The dash sizes that exist in the AN standard. */
const VALID_DASH_SIZES = new Set([2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32]);

/**
 * Families where the part number's dash tokens are AN sizes on both sides
 * (`ANFAN920-08-16` is an AN8-to-AN16 reducer).
 */
const AN_ON_BOTH_SIDES = new Set([
  'Hose End',
  'Hose End (braided, cutter style)',
  'Hose End (braided, cutter style, TRS brand)',
  'Hose End (braided, cutter style, ANF series)',
  'Hose End (push-on)',
  'Hose End (push-lock, TRS brand)',
  'Hose End (PTFE hose)',
  'Hose End (PTFE hose, TRS brand)',
  'AN male to O-ring port (ORB)',
  'O-ring port fitting',
  'Reducer',
  'Union',
  'Tee',
  'Bulkhead',
  'Bulkhead fitting',
  'Bulkhead nut',
  'Cap',
  'Plug',
  'Adapter',
]);

/**
 * Families where only the *first* dash token is an AN size — the rest describe
 * the other end of the adapter in NPT, BSP or metric, which are not AN sizes
 * and must not be presented as if they were.
 */
const AN_ON_FIRST_SIDE_ONLY = new Set([
  'AN to NPT adapter',
  'AN to metric adapter',
  'Metric adapter',
  'BSP adapter',
  'Barb adapter',
  'NPT plug',
  'Weld bung',
  'Weld bung (male)',
]);

/** Hose-end families, where a part is one AN size and may have a bend angle. */
const HOSE_END_FAMILIES = new Set([
  'Hose End',
  'Hose End (braided, cutter style)',
  'Hose End (braided, cutter style, TRS brand)',
  'Hose End (braided, cutter style, ANF series)',
  'Hose End (push-on)',
  'Hose End (push-lock, TRS brand)',
  'Hose End (PTFE hose)',
  'Hose End (PTFE hose, TRS brand)',
]);

/**
 * Hose-end part numbers encode the bend as the first half of a four-digit
 * token: `ANFX236-9010` is 90° in AN10, `ANPTFE-1208-L` is 120° in AN8. The
 * price list confirms the scheme in its own descriptions — "ANF Banjo Hose
 * End-04x20deg" for `-2004`, and "ANF SS Hose End STR -03 -03" for `-0303`.
 */
const ANGLE_CODES = { '00': 0, 20: 20, 30: 30, 45: 45, 60: 60, 90: 90, 12: 120, 15: 150, 18: 180 };

/**
 * Finish and material suffixes that trail a part number without changing what
 * it fits: stainless, black, long, steel.
 */
const IGNORABLE_SUFFIXES = new Set(['SS', 'L', 'B', 'BK', 'BL', 'BLK', 'ST', 'AL', 'LB', 'RD']);

/** `04` / `4` / `04SS` -> 4, or null when the token is anything else. */
function readDashToken(token) {
  const match = /^(\d{1,2})([A-Z]*)$/i.exec(token);
  if (!match) return null;
  if (match[2] !== '' && !IGNORABLE_SUFFIXES.has(match[2].toUpperCase())) return null;
  const value = Number(match[1]);
  return VALID_DASH_SIZES.has(value) ? value : null;
}

/**
 * Reads AN dash sizes, and a bend angle for hose ends, out of a part number.
 *
 * Deliberately strict: on a fittings catalogue a wrong size is worse than no
 * size, because it sells the customer a part that will not seal. A token that
 * is not cleanly a dash size makes the function claim nothing rather than
 * guess, so `ANBJB-3,8-24` (a 3/8-24 thread) does not become "AN24" and
 * `ANFHC-100-120X12` does not become "AN12".
 *
 * @param {string} partNumber
 * @param {string} family
 * @param {string} [description]
 * @returns {{ sizes: number[], angle: number | null }}
 */
export function parseAnSizes(partNumber, family, description = '') {
  const none = { sizes: [], angle: null };

  const [, ...tokens] = partNumber.split('-');
  if (tokens.length === 0) return none;

  if (HOSE_END_FAMILIES.has(family)) {
    const four = tokens.find((t) => /^\d{4}[A-Z]*$/i.test(t));
    if (four) {
      const suffix = four.slice(4).toUpperCase();
      if (suffix !== '' && !IGNORABLE_SUFFIXES.has(suffix)) return none;
      const head = four.slice(0, 2);
      const tail = Number(four.slice(2, 4));
      if (!VALID_DASH_SIZES.has(tail)) return none;

      if (head in ANGLE_CODES) {
        return { sizes: [tail], angle: ANGLE_CODES[head] };
      }
      // `0303` / `0404`: the same size twice, which the price list writes out
      // as "STR -03 -03" — a straight hose end in that size.
      if (Number(head) === tail && /STR|straight/i.test(description)) {
        return { sizes: [tail], angle: 0 };
      }
      return none;
    }
    // No four-digit token: a plain `-06` hose end, which is straight only when
    // the description says so.
    const single = tokens.map(readDashToken).filter((v) => v !== null);
    const clean = tokens.every((t) => readDashToken(t) !== null || IGNORABLE_SUFFIXES.has(t.toUpperCase()));
    if (clean && single.length === 1) {
      return { sizes: [single[0]], angle: /STR|straight/i.test(description) ? 0 : null };
    }
    return none;
  }

  const bothSides = AN_ON_BOTH_SIDES.has(family);
  const firstOnly = AN_ON_FIRST_SIDE_ONLY.has(family);
  if (!bothSides && !firstOnly) return none;

  if (firstOnly) {
    // Only the first token is an AN size; the rest describe the other end in
    // NPT, BSP or metric and must not be shown as AN sizes.
    const first = readDashToken(tokens[0]);
    return first === null ? none : { sizes: [first], angle: null };
  }

  const sizes = [];
  for (const token of tokens) {
    if (IGNORABLE_SUFFIXES.has(token.toUpperCase())) continue;
    const value = readDashToken(token);
    if (value === null) return none; // anything unexpected: claim nothing
    sizes.push(value);
  }
  if (sizes.length === 0) return none;
  return { sizes: [...new Set(sizes)], angle: null };
}

/** `null` -> ''; `0` -> 'Straight'; `90` -> '90°'. */
export function formatAngleLabel(angle) {
  if (angle === null || angle === undefined) return '';
  return angle === 0 ? 'Straight' : `${angle}°`;
}

/** `[8]` -> `AN8`; `[8, 16]` -> `AN8 → AN16`. */
export function formatSizeLabel(sizes) {
  if (sizes.length === 0) return '';
  return sizes.map((s) => `AN${s}`).join(' → ');
}
