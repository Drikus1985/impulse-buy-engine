import { useState } from 'react';
import type { CartLine, Product } from '../types';
import { calculateTotals } from '../lib/cart';
import {
  SHOP,
  buildQuoteText,
  formatRand,
  mailtoLink,
  whatsAppLink,
  type QuoteDetails,
} from '../lib/shop';

interface Props {
  lines: CartLine[];
  bySku: Map<string, Product>;
  vatRate: number;
  onSetQuantity: (sku: string, quantity: number) => void;
  onRemove: (sku: string) => void;
  onClose: () => void;
}

const BLANK: QuoteDetails = { name: '', phone: '', email: '', notes: '' };

export function CartDrawer({ lines, bySku, vatRate, onSetQuantity, onRemove, onClose }: Props) {
  const [details, setDetails] = useState<QuoteDetails>(BLANK);
  const totals = calculateTotals(lines, bySku, vatRate);
  const empty = totals.priced.length === 0 && totals.enquiry.length === 0;
  const quoteText = buildQuoteText(totals, details);

  // Priced and quote-only lines render identically apart from the amount, so
  // they are flattened into one list with a nullable total.
  const displayLines: { product: Product; quantity: number; lineTotal: number | null }[] = [
    ...totals.priced,
    ...totals.enquiry.map((l) => ({ ...l, lineTotal: null })),
  ];

  const set = (key: keyof QuoteDetails) => (e: { target: { value: string } }) =>
    setDetails((d) => ({ ...d, [key]: e.target.value }));

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Your parts list"
      >
        <div className="drawer-head">
          <h2>Your parts list</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {empty && <p className="empty">Nothing here yet. Add fittings and they will stay saved on this device.</p>}

          {displayLines.map(({ product, quantity, lineTotal }) => {
            return (
              <div className="cart-line" key={product.sku}>
                <div className="cart-line-main">
                  <div className="card-sku">{product.sku}</div>
                  <div className="cart-line-name">{product.name}</div>
                  <div className="card-spec" style={{ marginTop: 4 }}>
                    {product.sizeLabel && <span className="tag tag-size">{product.sizeLabel}</span>}
                    {product.angleLabel && <span className="tag tag-angle">{product.angleLabel}</span>}
                  </div>
                  <div className="qty">
                    <button onClick={() => onSetQuantity(product.sku, quantity - 1)} aria-label={`Fewer ${product.sku}`}>
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(e) => onSetQuantity(product.sku, Math.max(1, Number(e.target.value) || 1))}
                      aria-label={`Quantity of ${product.sku}${product.uom === 'M' ? ' in metres' : ''}`}
                    />
                    <button onClick={() => onSetQuantity(product.sku, quantity + 1)} aria-label={`More ${product.sku}`}>
                      +
                    </button>
                    {product.uom === 'M' && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>metres</span>}
                    <button className="link-button" style={{ marginLeft: 8 }} onClick={() => onRemove(product.sku)}>
                      Remove
                    </button>
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {lineTotal === null ? (
                    <span className="price-poa">Quote</span>
                  ) : (
                    <strong>{formatRand(lineTotal)}</strong>
                  )}
                </div>
              </div>
            );
          })}

          {!empty && (
            <>
              <div style={{ marginTop: 16 }}>
                <div className="totals">
                  <span>Items</span>
                  <span>{totals.itemCount}</span>
                </div>
                <div className="totals">
                  <span>VAT at {Math.round(vatRate * 100)}% (included)</span>
                  <span>{formatRand(totals.vatPortion)}</span>
                </div>
                <div className="totals totals-grand">
                  <span>Estimated total</span>
                  <span>{formatRand(totals.subtotalIncVat)}</span>
                </div>
              </div>

              <p className="note">
                An estimate, not an invoice. Delivery is quoted per order, and stock is confirmed by the shop before
                anything is charged — the quantities here come from a stock snapshot, not a live count.
                {totals.enquiry.length > 0 && ' Items marked “Quote” have no price on the list yet.'}
              </p>

              <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
                Your details
              </h3>
              <label className="field">
                <span>Name</span>
                <input value={details.name} onChange={set('name')} autoComplete="name" />
              </label>
              <label className="field">
                <span>Phone</span>
                <input value={details.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" />
              </label>
              <label className="field">
                <span>Email</span>
                <input value={details.email} onChange={set('email')} autoComplete="email" inputMode="email" />
              </label>
              <label className="field">
                <span>Notes — vehicle, application, anything they should know</span>
                <textarea value={details.notes} onChange={set('notes')} />
              </label>
            </>
          )}
        </div>

        {!empty && (
          <div className="drawer-foot">
            <a className="btn btn-wa btn-wide" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
               href={whatsAppLink(quoteText)} target="_blank" rel="noreferrer">
              Send on WhatsApp
            </a>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <a className="btn btn-ghost" style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
                 href={mailtoLink(quoteText)}>
                Email {SHOP.email.toLowerCase()}
              </a>
              <button className="btn btn-ghost" onClick={() => window.print()}>
                Print
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
