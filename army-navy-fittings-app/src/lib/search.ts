import type { Product } from '../types';

/**
 * Catalogue search.
 *
 * Tuned for how this trade actually searches: people type a part number
 * fragment ("an920-08"), a size ("AN8", "-8", "dash 8"), or a couple of words
 * ("90 hose end"). All three have to work from one box, so each token is
 * matched independently and a product must satisfy every token.
 */

export interface Filters {
  query: string;
  category: string | null;
  sizes: number[];
  angles: number[];
  inStockOnly: boolean;
  maxPrice: number | null;
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  category: null,
  sizes: [],
  angles: [],
  inStockOnly: false,
  maxPrice: null,
};

/** Lower-cased haystack per product, built once. */
export type SearchIndex = Map<string, string>;

export function buildIndex(products: Product[]): SearchIndex {
  const index: SearchIndex = new Map();
  for (const p of products) {
    index.set(
      p.sku,
      [p.sku, p.name, p.family, p.sizeLabel, p.angleLabel, p.sizes.map((s) => `an${s} -${s} dash${s}`).join(' ')]
        .join(' ')
        .toLowerCase(),
    );
  }
  return index;
}

/**
 * Pulls an AN size out of a search token, so "an8", "-8" and "dash8" all reach
 * the same products. Returns null when the token is not a size.
 */
export function tokenAsSize(token: string): number | null {
  const match = /^(?:an|dash|-)\s*(\d{1,2})$/i.exec(token);
  if (!match) return null;
  return Number(match[1]);
}

function matchesToken(product: Product, haystack: string, token: string): boolean {
  const size = tokenAsSize(token);
  if (size !== null && product.sizes.includes(size)) return true;
  // Part numbers are written with and without their dashes; compare both ways
  // so "an92008" finds "ANFAN920-08".
  if (token.length > 3 && product.sku.toLowerCase().replace(/-/g, '').includes(token.replace(/-/g, ''))) {
    return true;
  }
  return haystack.includes(token);
}

export function applyFilters(products: Product[], index: SearchIndex, filters: Filters): Product[] {
  const tokens = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return products.filter((p) => {
    if (filters.category && p.category !== filters.category) return false;
    if (filters.sizes.length > 0 && !filters.sizes.some((s) => p.sizes.includes(s))) return false;
    if (filters.angles.length > 0 && (p.angle === null || !filters.angles.includes(p.angle))) return false;
    if (filters.inStockOnly && p.availability === 'on-order') return false;
    if (filters.maxPrice !== null && (p.priceIncVat === null || p.priceIncVat > filters.maxPrice)) return false;

    if (tokens.length === 0) return true;
    const haystack = index.get(p.sku) ?? '';
    return tokens.every((t) => matchesToken(p, haystack, t));
  });
}

const STOCK_ORDER: Record<Product['availability'], number> = {
  'in-stock': 0,
  'low-stock': 1,
  'on-order': 2,
};

/**
 * Ranks results so an exact part-number hit comes first, then prefix matches,
 * then everything else alphabetically. Without this, typing a full part number
 * buries the exact part among its own variants.
 *
 * With no query — browsing a category — what is on the shelf comes first, so
 * the first screen is stock someone can collect today rather than whatever
 * happens to sort early by name.
 */
export function rankResults(results: Product[], query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return [...results].sort(
      (a, b) => STOCK_ORDER[a.availability] - STOCK_ORDER[b.availability] || a.name.localeCompare(b.name),
    );
  }
  const bare = q.replace(/[-\s]/g, '');

  const score = (p: Product): number => {
    const sku = p.sku.toLowerCase();
    if (sku === q || sku.replace(/-/g, '') === bare) return 0;
    if (sku.startsWith(q) || sku.replace(/-/g, '').startsWith(bare)) return 1;
    if (p.name.toLowerCase().startsWith(q)) return 2;
    if (sku.includes(q)) return 3;
    return 4;
  };

  return [...results].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

/** The size and angle facets present in a set of products, for the filter UI. */
export function availableFacets(products: Product[]): { sizes: number[]; angles: number[] } {
  const sizes = new Set<number>();
  const angles = new Set<number>();
  for (const p of products) {
    p.sizes.forEach((s) => sizes.add(s));
    if (p.angle !== null) angles.add(p.angle);
  }
  return {
    sizes: [...sizes].sort((a, b) => a - b),
    angles: [...angles].sort((a, b) => a - b),
  };
}
