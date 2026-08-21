export type Availability = 'in-stock' | 'low-stock' | 'on-order';

export interface Product {
  /** The ANF part number. Doubles as the catalogue's primary key. */
  sku: string;
  name: string;
  category: string;
  family: string;
  /** AN dash sizes derived from the part number. Empty when not derivable. */
  sizes: number[];
  /** `AN8` or `AN8 → AN16`, empty when `sizes` is empty. */
  sizeLabel: string;
  /** Bend in degrees for hose ends; `0` is straight, `null` when unknown. */
  angle: number | null;
  angleLabel: string;
  uom: 'EA' | 'M';
  priceExVat: number | null;
  priceIncVat: number | null;
  availability: Availability;
  /** No price in the price list — the customer has to ask. */
  enquireOnly: boolean;
}

export interface Category {
  id: string;
  name: string;
  count: number;
}

export interface Catalogue {
  generatedAt: string;
  currency: string;
  vatRate: number;
  pricesIncludeVat: boolean;
  stockSnapshot: string;
  categories: Category[];
  products: Product[];
}

export interface CartLine {
  sku: string;
  quantity: number;
}
