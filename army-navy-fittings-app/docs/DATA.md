# Where the catalogue comes from

The shop app never has its own product database. Everything it shows is generated from the price list the shop
already keeps, by `npm run import`.

## The source file

`data/source/anf-pricelist.csv` — a CSV export of the pricing sheet (`ANF_Part_Numbers_KJ_to_ANF`). It is
**gitignored**, because it carries cost data. Export it fresh whenever prices change.

The export has a free-text rule line above the header, which the importer skips by finding the header row
rather than assuming it is the first one.

| Column | Used for | Published? |
| --- | --- | --- |
| `ANF Part Number (FINAL)` | the SKU customers search and quote | yes |
| `Description` | the product name | yes |
| `Family` | shop category, and how to read the part number | yes |
| `On Hand (Sage …)` | converted to a stock band | as a band only |
| `UoM` | `EA` or `M` — hose sells by the metre | yes |
| `Selling Excl R` | price, plus VAT | yes, VAT-inclusive and exclusive |
| `Status` | whether the shop will sell it | as a filter |
| `Cost R (landed/best)` | margin checking, internal report only | **never** |
| `Kage USD 2026` | — | **never** |
| `Kage Code` | — | **never** |
| `Current Sage Code` | — | **never** |
| `Other Supplier Codes` | — | **never** |
| `Bin` | — | **never** |
| `ANF_SKU (internal)` | — | **never** |
| `Change Note` | — | **never** |

The importer reads by allow-list: it names the columns it wants, so a new confidential column added to the
sheet later is ignored by default rather than published by accident.

## What gets held back

The import is a set of gates. A part that fails one is not published, and is named in the report so it can be
fixed at source.

| Gate | Rule | Why |
| --- | --- | --- |
| Status | only `ACTIVE` | `REVIEW` means the shop has not confirmed the line — several are flagged as codes that differ only by spaces from another part, which is exactly how a customer receives the wrong fitting |
| Price conflict | one part number, one price | the sheet gives four part numbers two different prices; publishing the lower one sells below the shop's own list, the higher one overcharges. The importer picks neither |
| Invalid price | must be above zero | a zero or negative price is a data error, not a giveaway |
| Not retail stock | labour and workshop material lines dropped | `AAMWS - LABOUR` is not a part |

`npm run import -- --include-review` publishes `REVIEW` lines too, if the shop decides that stock is worth
listing. It is off by default because the safe direction is to under-list.

Parts with **no** price are still listed, as "Price on request" — hiding stock the shop has is worse than
asking someone to ring for a price.

## What the numbers mean

**VAT.** The price list is VAT-exclusive; the app shows VAT-inclusive prices at 15%, set by `VAT_RATE` in
`scripts/import-catalogue.mjs`. The arithmetic runs in whole cents and basis points, because `price * 1.15` in
floating point rounds 33 of the shop's prices down by a cent — R51.90 grosses up to exactly R59.685, which
must round to R59.69 rather than R59.68.

**Stock.** Published as a band, never a count:

| On hand | Shown as |
| --- | --- |
| 6 or more | In stock |
| 1 – 5 | Low stock |
| 0 | On order |

The sheet's own header says the quantity snapshot is stale, so an exact "7 in stock" would be a promise the
data cannot keep. The app says as much in the cart.

## Categories

The sheet's 46 `Family` values map to 15 shop categories, named to match the sections on anfittings.co.za.
Around 300 rows have no useful family (`Unclassified`, or the brand label `TRS-branded item`); those are
classified from their description by keyword, and anything still unrecognised lands in **Other Parts** rather
than being forced somewhere plausible.

## Reading AN sizes out of part numbers

The part numbers encode what the parts fit, so the size and bend filters come from parsing rather than
re-keying. The scheme, confirmed against the sheet's own descriptions:

| Pattern | Example | Means |
| --- | --- | --- |
| trailing dash size | `ANFAN920-08` | AN8 |
| two dash sizes | `ANFAN920-08-16` | AN8 stepping to AN16 |
| four-digit block on a hose end | `ANFX236-9010` | 90° in AN10 |
| `12` / `15` / `18` in that block | `ANPTFE-1208-L` | 120°, 150°, 180° |
| doubled size with "STR" | `ANFBKRF-0303SS` | straight, AN3 |

**The parser claims nothing when it is not sure**, and a token it does not recognise disqualifies the whole
part number rather than being skipped. On a fittings catalogue a wrong size is worse than no size — it sells
someone a part that will not seal. So:

- `ANBJB-3,8-24` is a 3/8-24 **thread**, not AN24 → no size claimed
- `ANFHC-100-120X12` is a 100×120 mm hose clamp, not AN12 → no size claimed
- `ANFAN816-10-12D` is AN10 to a **NPT** thread → AN10 only, the `12` is not published as an AN size

455 of 1,260 parts end up with a size and 169 with a bend angle. The rest are still findable by search, which
matches on the raw part number and description.

## The confidentiality guard

`assertNoConfidentialData()` runs after every import and throws — failing the build — if:

- a confidential column name appears anywhere in the output;
- a published price equals that part's landed cost, where the price list puts the two apart;
- a supplier code, bin or internal SKU appears in a published record.

The second check has one deliberate exception. `TRS121-FR` is priced at exactly its landed cost in the sheet
itself, so matching there proves a zero margin, not a leak. That line is reported under "sell at or below
landed cost" instead — 13 parts currently are, one at −906%.

## Known limits

- **Descriptions are the shop's.** Some are blank, some repeat the part number, some are shouted. The importer
  tidies capitalisation and prefers the most descriptive of a duplicate's descriptions, but it does not invent
  copy.
- **No product images.** The price list has none. Cards are typographic; adding images means adding an image
  per SKU somewhere the app can reach.
- **One price list, one currency.** Everything is ZAR.
- **The catalogue is a build artifact.** Editing `src/data/catalogue.json` by hand works until the next import
  overwrites it. Fix the sheet instead.
