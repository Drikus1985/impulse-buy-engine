import type { CartTotals } from './cart';

/**
 * Shop details, from anfittings.co.za. Kept in one place because they appear in
 * the header, the contact page, the quote text and the app manifest.
 */
export const SHOP = {
  name: 'Army Navy Fittings',
  tagline: 'Performance plumbing — AN fittings, hose and adapters',
  address: '15 Tarry Road, Alrode South, Alberton, South Africa',
  phone: '+27 10 592 1706',
  /** Digits only, for `wa.me` and `tel:` links. */
  phoneDigits: '27105921706',
  email: 'Sales@anfittings.co.za',
  hours: 'Monday to Friday, 08:00 – 16:00',
  website: 'https://www.anfittings.co.za',
} as const;

export function formatRand(amount: number): string {
  return `R${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

export interface QuoteDetails {
  name: string;
  phone: string;
  email: string;
  notes: string;
}

/**
 * Builds the enquiry text that goes to the shop.
 *
 * The order lands as a message rather than a card payment: this shop quotes
 * freight per order and hand-checks stock against a snapshot it already knows
 * is stale, so a total shown here is an estimate until they confirm it. The
 * message says so, rather than letting the customer assume it is a placed
 * order.
 */
export function buildQuoteText(totals: CartTotals, details: QuoteDetails): string {
  const lines: string[] = [];
  lines.push(`Parts enquiry — ${SHOP.name}`);
  lines.push('');

  if (details.name.trim()) lines.push(`Name: ${details.name.trim()}`);
  if (details.phone.trim()) lines.push(`Phone: ${details.phone.trim()}`);
  if (details.email.trim()) lines.push(`Email: ${details.email.trim()}`);
  if (details.name.trim() || details.phone.trim() || details.email.trim()) lines.push('');

  lines.push('Items:');
  for (const line of totals.priced) {
    const unit = line.product.uom === 'M' ? 'm' : 'x';
    lines.push(
      `- ${line.product.sku} — ${line.product.name} (${unit}${line.quantity}) — ${formatRand(line.lineTotal)}`,
    );
  }
  for (const line of totals.enquiry) {
    const unit = line.product.uom === 'M' ? 'm' : 'x';
    lines.push(`- ${line.product.sku} — ${line.product.name} (${unit}${line.quantity}) — price please`);
  }

  lines.push('');
  if (totals.priced.length > 0) {
    lines.push(`Estimated total (incl. VAT): ${formatRand(totals.subtotalIncVat)}`);
    lines.push('Excludes delivery. Please confirm stock and freight.');
  } else {
    lines.push('Please quote on the above, including delivery.');
  }

  if (details.notes.trim()) {
    lines.push('');
    lines.push(`Notes: ${details.notes.trim()}`);
  }

  return lines.join('\n');
}

export function whatsAppLink(text: string): string {
  return `https://wa.me/${SHOP.phoneDigits}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(text: string): string {
  const subject = encodeURIComponent(`Parts enquiry — ${SHOP.name}`);
  return `mailto:${SHOP.email}?subject=${subject}&body=${encodeURIComponent(text)}`;
}
