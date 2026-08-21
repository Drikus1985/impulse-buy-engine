import type { Product } from '../types';
import { findAnSize } from '../lib/an-reference';
import { Price, StockBadge } from './ProductCard';

interface Props {
  product: Product;
  related: Product[];
  onAdd: (sku: string) => void;
  onOpen: (sku: string) => void;
  onClose: () => void;
}

export function ProductDetail({ product, related, onAdd, onOpen, onClose }: Props) {
  // Where the part number gave us a single AN size, the standard's figures for
  // that size are worth showing — it is the question customers phone to ask.
  const spec = product.sizes.length === 1 ? findAnSize(product.sizes[0]!) : undefined;

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
      >
        <div className="drawer-head">
          <h2>Part detail</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <div className="card-sku">{product.sku}</div>
          <h1 style={{ fontSize: 20, margin: '4px 0 10px' }}>{product.name}</h1>

          <div className="card-spec">
            {product.sizeLabel && <span className="tag tag-size">{product.sizeLabel}</span>}
            {product.angleLabel && <span className="tag tag-angle">{product.angleLabel}</span>}
            <span className="tag">{product.family}</span>
          </div>

          <div style={{ margin: '14px 0' }}>
            <Price product={product} />
            <div style={{ marginTop: 6 }}>
              <StockBadge availability={product.availability} />
            </div>
          </div>

          <button className="btn btn-wide" onClick={() => onAdd(product.sku)}>
            {product.enquireOnly ? 'Add to enquiry' : 'Add to parts list'}
          </button>

          {spec && (
            <>
              <h2>AN{spec.dash} at a glance</h2>
              <dl className="detail-spec">
                <dt>Thread</dt>
                <dd>{spec.thread}</dd>
                <dt>Tube OD</dt>
                <dd>{spec.tubeOd}</dd>
                <dt>Hose bore</dt>
                <dd>
                  {spec.hoseIdImperial} ({spec.hoseIdMetric})
                </dd>
              </dl>
              <p className="note">
                Standard figures for the AN{spec.dash} size, not a measurement of this part. Check the fitting against
                your hose before cutting.
              </p>
            </>
          )}

          {product.sizes.length === 0 && (
            <p className="note">
              No AN size is listed for this part — its part number does not spell one out. Ask the shop if you need the
              thread confirmed.
            </p>
          )}

          {related.length > 0 && (
            <>
              <h2>Same part, other sizes</h2>
              <div style={{ display: 'grid', gap: 6 }}>
                {related.map((r) => (
                  <button
                    key={r.sku}
                    className="cat-card"
                    style={{ borderLeftColor: 'var(--olive)' }}
                    onClick={() => onOpen(r.sku)}
                  >
                    <strong>
                      {r.sizeLabel || r.sku} {r.angleLabel && `· ${r.angleLabel}`}
                    </strong>
                    <span>{r.priceIncVat === null ? 'Price on request' : `R${r.priceIncVat.toFixed(2)} incl. VAT`}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
