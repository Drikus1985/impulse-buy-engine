import type { Product } from '../types';
import { formatRand } from '../lib/shop';

const STOCK_LABEL: Record<Product['availability'], { text: string; className: string }> = {
  'in-stock': { text: 'In stock', className: 'stock stock-in' },
  'low-stock': { text: 'Low stock', className: 'stock stock-low' },
  'on-order': { text: 'On order', className: 'stock stock-order' },
};

export function StockBadge({ availability }: { availability: Product['availability'] }) {
  const { text, className } = STOCK_LABEL[availability];
  return (
    <span className={className}>
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}

export function Price({ product }: { product: Product }) {
  if (product.priceIncVat === null) {
    return <span className="price-poa">Price on request</span>;
  }
  return (
    <span className="price">
      {formatRand(product.priceIncVat)}
      {product.uom === 'M' && <span className="price-ex">per metre, incl. VAT</span>}
      {product.uom !== 'M' && <span className="price-ex">incl. VAT</span>}
    </span>
  );
}

interface Props {
  product: Product;
  onOpen: (sku: string) => void;
  onAdd: (sku: string) => void;
}

export function ProductCard({ product, onOpen, onAdd }: Props) {
  return (
    <div className="card">
      <button
        className="brand"
        style={{ display: 'block', width: '100%' }}
        onClick={() => onOpen(product.sku)}
        aria-label={`View ${product.name}, part ${product.sku}`}
      >
        <span className="card-sku">{product.sku}</span>
        <span className="card-name" style={{ display: 'block', marginTop: 2 }}>
          {product.name}
        </span>
      </button>

      <div className="card-spec">
        {product.sizeLabel && <span className="tag tag-size">{product.sizeLabel}</span>}
        {product.angleLabel && <span className="tag tag-angle">{product.angleLabel}</span>}
        {product.uom === 'M' && <span className="tag">Per metre</span>}
      </div>

      <StockBadge availability={product.availability} />

      <div className="card-foot">
        <Price product={product} />
        <button className="btn" onClick={() => onAdd(product.sku)}>
          {product.enquireOnly ? 'Enquire' : 'Add'}
        </button>
      </div>
    </div>
  );
}
