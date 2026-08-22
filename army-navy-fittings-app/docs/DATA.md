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

**Family disagreements are reported, not gated.** Where a part number appears on several rows that disagree
about the `Family`, the first non-`Unclassified` one wins — and that single pick drives both the shop category
and whether an AN size is claimed. The part still publishes, because the disagreement is the shop's to settle
and holding back real stock costs more than it saves. But the winner is decided by **row order in the export**,
which is not guaranteed stable: a sort, an inserted line or a different export path could move a part between
categories on the next price run, with no code change and nothing in the diff to explain it. So every run
lists them. 14 part numbers currently disagree — the `ANFAN833-*` and `ANFAN832-*` series, and two of the
`ANFAN924-*` nuts.

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

## Open: four part-number clashes

Four rows in the price list carry a part number that already belongs to a different part, so the importer
holds all of them back (see the price-conflict gate above). They are **not** pricing errors — each pair is two
different physical products sharing one number, which the sheet's own Change Notes say outright on two of
them: `ANF NUMBER CLASH (2 items share ANFBKRF-9034SS) — REVIEW`.

| Sheet row | Number in use | Second item is | Its supplier code | Cost gap |
| --- | --- | --- | --- | --- |
| 930 | `ANFAN924-3` | a TRS bulkhead nut | `TRS-3-BHN` | R13.03 vs R1.94 |
| 932 | `ANFAN924-8` | a TRS bulkhead nut | `TRS-8-BHN` | R15.03 vs R2.78 |
| 1180 | `ANFBKRF-9034SS` | a GB-sourced hose end | `GBBKRF-9034SS` | R167.83 vs R181.50 |
| 1266 | `ANFW0611-A` | Alloy AN Spanner set 02 | `GBW0611-A` | R1 056.76 vs R813.49 |

The numbering rule is strip the supplier prefix and prepend `ANF` — `KJBKRF-9034SS` and `GBBKRF-9034SS` both
reduce to `ANFBKRF-9034SS`, which is exactly how the two collisions arose. Three of the five GB-sourced parts
have no KJ counterpart and so numbered cleanly.

**Every AN part must keep an ANF part number**, so the second item needs a new ANF number rather than
reverting to its supplier code. Proposed, and verified free against all 1,478 existing numbers:

| Sheet row | Proposed |
| --- | --- |
| 930 | `ANFAN924-3B` |
| 932 | `ANFAN924-8B` |
| 1180 | `ANFBKRF-9034SSB` |
| 1266 | `ANFW0611-B` — the Kage row is already `-A` ("Spanner set 01") |

Awaiting a decision on the suffix: a trailing `B`, or something that names the source (`-GB`, `-TRS`). A
trailing `B` is also used in this sheet as a finish marker for black, e.g. `ANPTFESSB-06`, which is the
argument for putting the letter before the dash instead — `ANFAN924B-3`. Both parse identically; the position
only affects how a human reads it.

**The suffix is not what decides whether these keep an AN size.** Rows 930 and 932 carry `Family` = `Nut`,
and `Nut` is not an AN family, so no part-number scheme claims a size for them once they are split off. Today
they inherit an AN family only because they are merged with a `Bulkhead`/`Bulkhead nut` row. Their siblings
show the same pattern: `ANFAN924-4` and `-12` publish AN4 and AN12 because each is merged with a
`Bulkhead nut` row, while `ANFAN924-10` — alone on `Nut` — publishes no size at all.

So there are **three `Family` cells** to fix alongside the part numbers, and they are the lever:

| Sheet row | Part | `Family` now | Should be |
| --- | --- | --- | --- |
| 930 | the TRS `ANFAN924-3` | `Nut` | `Bulkhead nut` |
| 932 | the TRS `ANFAN924-8` | `Nut` | `Bulkhead nut` |
| — | `ANFAN924-10` | `Nut` | `Bulkhead nut` |

Fixing those restores the AN3 / AN8 / AN10 filter chips their siblings already have.

Separately, **row 931** (`ANFAN924-8`, the Kage line) is described as "Bulkhead Nut10", absorbs
`TRS-10-BHN`, and is priced identically to `ANFAN924-10`. It may be an AN10 part carrying the -8 number.
That one needs someone to measure the thread on the shelf, not a data decision.

Once the numbers are settled, `npm run import` should report **0 conflicting prices** and the catalogue should
rise from 1,260 to 1,264 products.

## Known limits

- **Descriptions are the shop's.** Some are blank, some repeat the part number, some are shouted. The importer
  tidies capitalisation and prefers the most descriptive of a duplicate's descriptions, but it does not invent
  copy.
- **No product images.** The price list has none. Cards are typographic; adding images means adding an image
  per SKU somewhere the app can reach.
- **One price list, one currency.** Everything is ZAR.
- **The catalogue is a build artifact.** Editing `src/data/catalogue.json` by hand works until the next import
  overwrites it. Fix the sheet instead.
