import type { CartLine, Product } from '../types';

const STORAGE_KEY = 'anf.cart.v1';

/**
 * The cart survives a closed tab, which matters here: people build a fittings
 * list over a day or two while working out what a build needs. Every access is
 * guarded because private windows and blocked site data make `localStorage`
 * throw rather than return null.
 */
export function loadCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is CartLine =>
        typeof l === 'object' && l !== null &&
        typeof (l as CartLine).sku === 'string' &&
        Number.isFinite((l as CartLine).quantity) &&
        (l as CartLine).quantity > 0,
    );
  } catch {
    return [];
  }
}

export function saveCart(lines: CartLine[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // A cart that cannot persist still works for this session.
  }
}

export function addLine(lines: CartLine[], sku: string, quantity = 1): CartLine[] {
  const existing = lines.find((l) => l.sku === sku);
  if (existing) {
    return lines.map((l) => (l.sku === sku ? { ...l, quantity: l.quantity + quantity } : l));
  }
  return [...lines, { sku, quantity }];
}

export function setQuantity(lines: CartLine[], sku: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.sku !== sku);
  return lines.map((l) => (l.sku === sku ? { ...l, quantity } : l));
}

export function removeLine(lines: CartLine[], sku: string): CartLine[] {
  return lines.filter((l) => l.sku !== sku);
}

export interface CartTotals {
  /** Lines that have a price and can be totalled. */
  priced: { product: Product; quantity: number; lineTotal: number }[];
  /** Lines the shop has to quote by hand. */
  enquiry: { product: Product; quantity: number }[];
  subtotalIncVat: number;
  vatPortion: number;
  itemCount: number;
}

/** Money is added up in whole cents, never in floating-point rands. */
function toCents(rands: number): number {
  return Math.round((rands + Number.EPSILON) * 100);
}

export function calculateTotals(lines: CartLine[], bySku: Map<string, Product>, vatRate: number): CartTotals {
  const priced: CartTotals['priced'] = [];
  const enquiry: CartTotals['enquiry'] = [];
  let subtotalCents = 0;
  let itemCount = 0;

  for (const line of lines) {
    const product = bySku.get(line.sku);
    if (!product) continue; // dropped from the catalogue since it was added
    itemCount += line.quantity;
    if (product.priceIncVat === null) {
      enquiry.push({ product, quantity: line.quantity });
      continue;
    }
    const lineCents = toCents(product.priceIncVat) * line.quantity;
    subtotalCents += lineCents;
    priced.push({ product, quantity: line.quantity, lineTotal: lineCents / 100 });
  }

  // The VAT already inside a gross total: 15/115ths of it.
  const basisPoints = Math.round(vatRate * 10000);
  const vatCents = Math.round((subtotalCents * basisPoints) / (10000 + basisPoints));

  return {
    priced,
    enquiry,
    subtotalIncVat: subtotalCents / 100,
    vatPortion: vatCents / 100,
    itemCount,
  };
}
