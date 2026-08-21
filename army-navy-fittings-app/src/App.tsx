import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import catalogueData from './data/catalogue.json';
import type { Catalogue, CartLine, Product } from './types';
import { EMPTY_FILTERS, applyFilters, availableFacets, buildIndex, rankResults, type Filters } from './lib/search';
import { addLine, loadCart, removeLine, saveCart, setQuantity } from './lib/cart';
import { SHOP } from './lib/shop';
import { ProductCard } from './components/ProductCard';
import { FilterPanel } from './components/FilterPanel';
import { CartDrawer } from './components/CartDrawer';
import { ProductDetail } from './components/ProductDetail';
import { ContactPage, ReferencePage } from './components/InfoPages';

const catalogue = catalogueData as Catalogue;

/** Rendered a page at a time: 1,200-odd cards at once janks a cheap phone. */
const PAGE_SIZE = 48;

type View = 'shop' | 'reference' | 'contact';

/** Reads the view out of the hash so the back button and shared links work. */
function viewFromHash(): View {
  const hash = window.location.hash.replace('#/', '');
  return hash === 'reference' || hash === 'contact' ? hash : 'shop';
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [lines, setLines] = useState<CartLine[]>(loadCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [openSku, setOpenSku] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const bySku = useMemo(() => new Map(catalogue.products.map((p) => [p.sku, p])), []);
  const index = useMemo(() => buildIndex(catalogue.products), []);

  const results = useMemo(() => {
    const filtered = applyFilters(catalogue.products, index, filters);
    return rankResults(filtered, filters.query);
  }, [filters, index]);

  // Facets follow the category so the size list is the sizes actually on offer
  // in what you are looking at, not every size in the catalogue.
  const facets = useMemo(() => {
    const scope = filters.category
      ? catalogue.products.filter((p) => p.category === filters.category)
      : catalogue.products;
    return availableFacets(scope);
  }, [filters.category]);

  useEffect(() => setVisible(PAGE_SIZE), [filters]);
  useEffect(() => saveCart(lines), [lines]);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCartOpen(false);
        setOpenSku(null);
      }
      // `/` jumps to search, the way every parts lookup people already use does.
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goto = useCallback((next: View) => {
    window.location.hash = next === 'shop' ? '#/' : `#/${next}`;
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);

  const handleAdd = useCallback((sku: string) => {
    setLines((current) => addLine(current, sku));
    setOpenSku(null);
    setCartOpen(true);
  }, []);

  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const openProduct = openSku ? bySku.get(openSku) : undefined;

  const related: Product[] = useMemo(() => {
    if (!openProduct) return [];
    return catalogue.products
      .filter((p) => p.sku !== openProduct.sku && p.family === openProduct.family && p.name === openProduct.name)
      .slice(0, 8);
  }, [openProduct]);

  return (
    <>
      <header className="header">
        <div className="header-bar">
          <button className="brand" onClick={() => goto('shop')}>
            <span className="brand-mark" aria-hidden="true">
              AN
            </span>
            <span className="brand-text">
              <strong>{SHOP.name}</strong>
              <span>Alberton · Performance plumbing</span>
            </span>
          </button>

          <div className="search-wrap">
            <input
              ref={searchRef}
              className="search"
              type="search"
              placeholder="Part number, AN8, 90 hose end…"
              value={filters.query}
              onChange={(e) => {
                setFilters((f) => ({ ...f, query: e.target.value }));
                if (view !== 'shop') goto('shop');
              }}
              aria-label="Search the catalogue"
            />
            {filters.query && (
              <button
                className="search-clear"
                onClick={() => setFilters((f) => ({ ...f, query: '' }))}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <button className="cart-button" onClick={() => setCartOpen(true)}>
            List
            {itemCount > 0 && <span className="cart-count">{itemCount}</span>}
          </button>
        </div>

        <nav className="nav" aria-label="Sections">
          <button aria-current={view === 'shop' && filters.category === null} onClick={() => { setFilters((f) => ({ ...f, category: null })); goto('shop'); }}>
            All parts
          </button>
          {catalogue.categories.map((c) => (
            <button
              key={c.id}
              aria-current={view === 'shop' && filters.category === c.id}
              onClick={() => {
                setFilters((f) => ({ ...f, category: c.id, sizes: [], angles: [] }));
                goto('shop');
              }}
            >
              {c.name}
            </button>
          ))}
          <button aria-current={view === 'reference'} onClick={() => goto('reference')}>
            AN sizes
          </button>
          <button aria-current={view === 'contact'} onClick={() => goto('contact')}>
            Shop
          </button>
        </nav>
      </header>

      {view === 'reference' && <ReferencePage />}
      {view === 'contact' && <ContactPage />}

      {view === 'shop' && (
        <main className="page">
          {installPrompt && (
            <div className="install-bar">
              <span>Keep the catalogue and the AN size chart on your phone — works with no signal.</span>
              <button
                className="btn"
                onClick={async () => {
                  const prompt = installPrompt as Event & { prompt?: () => Promise<void> };
                  await prompt.prompt?.();
                  setInstallPrompt(null);
                }}
              >
                Install
              </button>
            </div>
          )}

          <div className="layout">
            <FilterPanel
              categories={catalogue.categories}
              facets={facets}
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters({ ...EMPTY_FILTERS, query: filters.query })}
            />

            <section>
              <div className="results-head">
                <div>
                  <h1>
                    {filters.category
                      ? catalogue.categories.find((c) => c.id === filters.category)?.name ?? 'Parts'
                      : 'All parts'}
                  </h1>
                  <span className="results-count">
                    {results.length} {results.length === 1 ? 'part' : 'parts'}
                    {filters.query && ` matching “${filters.query}”`}
                  </span>
                </div>
              </div>

              {results.length === 0 ? (
                <div className="empty">
                  <p>
                    Nothing matches that. Try the part number without its dashes, or just the size — <strong>AN6</strong>.
                  </p>
                  <button className="btn btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear search and filters
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid">
                    {results.slice(0, visible).map((p) => (
                      <ProductCard key={p.sku} product={p} onOpen={setOpenSku} onAdd={handleAdd} />
                    ))}
                  </div>
                  {visible < results.length && (
                    <div className="more">
                      <button className="btn btn-ghost" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                        Show more ({results.length - visible} left)
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </main>
      )}

      <footer className="footer">
        <div className="footer-inner">
          <div>
            <strong>{SHOP.name}</strong>
            <br />
            {SHOP.address}
            <br />
            {SHOP.hours}
          </div>
          <div>
            <a href={`tel:+${SHOP.phoneDigits}`}>{SHOP.phone}</a>
            <br />
            <a href={`mailto:${SHOP.email}`}>{SHOP.email}</a>
            <br />
            <a href={SHOP.website} target="_blank" rel="noreferrer">
              anfittings.co.za
            </a>
          </div>
          <div>
            Prices include VAT at {Math.round(catalogue.vatRate * 100)}%.
            <br />
            Price list of {catalogue.generatedAt}.
            <br />
            Stock counted {catalogue.stockSnapshot}.
          </div>
        </div>
      </footer>

      {openProduct && (
        <ProductDetail
          product={openProduct}
          related={related}
          onAdd={handleAdd}
          onOpen={setOpenSku}
          onClose={() => setOpenSku(null)}
        />
      )}

      {cartOpen && (
        <CartDrawer
          lines={lines}
          bySku={bySku}
          vatRate={catalogue.vatRate}
          onSetQuantity={(sku, qty) => setLines((current) => setQuantity(current, sku, qty))}
          onRemove={(sku) => setLines((current) => removeLine(current, sku))}
          onClose={() => setCartOpen(false)}
        />
      )}
    </>
  );
}
