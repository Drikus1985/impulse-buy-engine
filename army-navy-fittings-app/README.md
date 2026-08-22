# Army Navy Fittings — shop app

An installable storefront for [Army Navy Fittings](https://www.anfittings.co.za), Alberton — AN performance
plumbing, hose ends, adapters and hose. Customers search 1,260 parts by part number or AN size, build a parts
list, and send it to the shop on WhatsApp or by email.

It installs to a phone and works with no signal, which is the point: the people buying these parts are under a
car or in a workshop, not at a desk.

## What it does

- **Search that matches how the trade types.** `ANFAN920-08`, `anfan92008`, `AN8`, `-8`, `90 hose end` — all
  find the right thing. An exact part-number hit sorts first.
- **Filter by AN size and bend angle.** Both are read out of the part numbers during import, so the filters
  exist without anybody re-keying 1,260 rows.
- **Prices include VAT**, computed from the shop's own price list.
- **Stock shown as a band** — on the shelf, low, on order — because the underlying count is a periodic stock
  take, not a live feed. See [docs/DATA.md](docs/DATA.md).
- **A parts list that survives a closed tab**, and goes out as a WhatsApp message, an email or a printed page.
- **An AN size chart** — dash size, thread, tube OD, hose bore — available offline.

## Quick start

Needs Node 22.6 or newer — the tests run TypeScript through Node's own type
stripping, and Vite 7 wants 22.12+.

```bash
npm install
npm run icons          # draws the app icons
npm run import         # builds the catalogue from data/source/anf-pricelist.csv
npm run dev            # http://localhost:5173
```

To ship it:

```bash
npm run build          # -> dist/, a static site
npm run preview        # check the build before uploading
```

`dist/` is plain static files. Pushing to `main` deploys them to GitHub Pages automatically, tests first —
after Pages has been switched on once by hand, which the workflow is not allowed to do for itself.
[docs/DEPLOY.md](docs/DEPLOY.md) covers that step, the live URL, a custom domain, and hosting it elsewhere.

## Updating prices

The catalogue is generated from the shop's price list, not edited by hand.

```bash
# export the pricing sheet as CSV to data/source/anf-pricelist.csv, then
npm run import
```

Commit the regenerated `src/data/catalogue.json` and push to `main` — that publishes it.

The importer prints what it held back and why. **Read that output** — it is the shop's data-quality report:

```
4 part numbers need fixing in the price list:
  ANFAN924-3             price list gives R36.99 and R16.84 for the same part number
  ...
13 parts sell at or below landed cost:
  AMTEC-1207             margin -906.3%
```

Nothing on that list reaches the shop until it is fixed in the sheet, and the app will not pick a price when
the price list gives two.

## Cost prices never ship

The price list carries landed cost, supplier codes, bin locations and internal SKUs next to the selling price.
None of it may reach a browser, so:

- the importer reads by allow-list — it names the seven columns that go out, and everything else is dropped by
  construction rather than by remembering to delete it;
- `assertNoConfidentialData` re-checks the built catalogue against the source and **fails the build** if a cost
  price, supplier code, bin or internal SKU appears in it;
- `data/source/` and the import report are gitignored. Only the sanitised `src/data/catalogue.json` is
  committed.

## Layout

```
scripts/
  import-catalogue.mjs   price list -> public catalogue, with the gates
  lib/classify.mjs       family -> shop category, and AN size/angle parsing
  lib/csv.mjs            dependency-free CSV reader
  make-icons.mjs         draws the PWA icons
src/
  App.tsx                shell, routing, search state
  components/            cards, filters, cart drawer, product detail, info pages
  lib/search.ts          filtering, part-number matching, ranking
  lib/cart.ts            parts list and totals, in whole cents
  lib/shop.ts            shop details and the WhatsApp/email quote
  lib/an-reference.ts    the AN size chart
  data/catalogue.json    generated — do not edit
public/
  sw.js                  offline caching
  manifest.webmanifest   install metadata
```

## Tests

```bash
npm test     # 54 assertions
```

They cover the parts where a mistake costs money or sells the wrong fitting: VAT arithmetic in whole cents,
the price-conflict and status gates, the confidentiality guard (including a simulated leak), AN size parsing
against the part numbers it must *not* misread, cart totals, and the quote text.

The AN size chart is checked against its own definition — every dash number must equal the tube OD in
sixteenths of an inch.

## Two dependencies

React and Vite. The CSV reader, the icon generator and the service worker are written out rather than
installed, because the import pipeline handles cost data and a shorter dependency list is a smaller thing to
trust.
