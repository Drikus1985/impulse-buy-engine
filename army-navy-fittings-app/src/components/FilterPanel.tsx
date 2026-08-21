import type { Category } from '../types';
import type { Filters } from '../lib/search';
import { angleLabel } from '../lib/an-reference';

interface Props {
  categories: Category[];
  facets: { sizes: number[]; angles: number[] };
  filters: Filters;
  onChange: (next: Filters) => void;
  onReset: () => void;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterPanel({ categories, facets, filters, onChange, onReset }: Props) {
  const active =
    filters.sizes.length > 0 ||
    filters.angles.length > 0 ||
    filters.inStockOnly ||
    filters.category !== null ||
    filters.maxPrice !== null;

  return (
    <aside className="filters">
      <div className="filter-group">
        <h3>Category</h3>
        <div className="chips">
          {categories.map((c) => (
            <button
              key={c.id}
              className="chip"
              aria-pressed={filters.category === c.id}
              onClick={() => onChange({ ...filters, category: filters.category === c.id ? null : c.id })}
            >
              {c.name} <span style={{ opacity: 0.7 }}>{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      {facets.sizes.length > 0 && (
        <div className="filter-group">
          <h3>AN size</h3>
          <div className="chips">
            {facets.sizes.map((s) => (
              <button
                key={s}
                className="chip"
                aria-pressed={filters.sizes.includes(s)}
                onClick={() => onChange({ ...filters, sizes: toggle(filters.sizes, s) })}
              >
                AN{s}
              </button>
            ))}
          </div>
        </div>
      )}

      {facets.angles.length > 0 && (
        <div className="filter-group">
          <h3>Bend</h3>
          <div className="chips">
            {facets.angles.map((a) => (
              <button
                key={a}
                className="chip"
                aria-pressed={filters.angles.includes(a)}
                onClick={() => onChange({ ...filters, angles: toggle(filters.angles, a) })}
              >
                {angleLabel(a)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="filter-group">
        <h3>Availability</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={filters.inStockOnly}
            onChange={(e) => onChange({ ...filters, inStockOnly: e.target.checked })}
          />
          On the shelf only
        </label>
      </div>

      {active && (
        <div className="filter-group">
          <button className="link-button" onClick={onReset}>
            Clear all filters
          </button>
        </div>
      )}
    </aside>
  );
}
