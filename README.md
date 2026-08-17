# impulse-commerce-mcp-server

An MCP server for the **Global Impulse-Commerce Opportunity Engine**: a persistent research ledger with deterministic scoring, unit economics, and gates that stop unverified research from becoming a launch recommendation.

## What this server does and does not do

**It does not fetch anything.** There are no API keys, no scrapers, no trend feeds. Claude researches with its own tools (web search, browsing, connectors) and records findings here.

**What it contributes instead:**

| Problem when an agent researches unaided | What this server does |
| --- | --- |
| A 100-product database does not fit in a context window | Persists everything to disk across sessions |
| The same product scores 71 today and 64 next week | Weighted scores are arithmetic, computed from stored 0-10 ratings |
| Margin claims with no arithmetic behind them | Every economics call returns a full formula trace |
| Three AliExpress links presented as "three demand signals" | Independence is measured by distinct source domain, derived from the URL |
| "Verified supplier" that nobody verified | `verification_status: "verified"` is **rejected** unless verification evidence is recorded |
| Plausible-looking shortlist that quietly skipped safety screening | Unscreened products cannot pass launch readiness |
| Three "diversified" test products that are all the same bet | Portfolio selection requires distinct customer triggers |

If a product cannot pass, the server says so and selects fewer than three immediate-test products rather than padding the list.

## Install

```bash
npm install
npm run build
```

Requires Node 18+.

### Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "impulse-commerce": {
      "command": "node",
      "args": ["/absolute/path/to/impulse-commerce-mcp-server/dist/index.js"],
      "env": {
        "ICE_DATA_DIR": "/absolute/path/to/where/the/ledger/should/live"
      }
    }
  }
}
```

`ICE_DATA_DIR` is optional and defaults to `~/.impulse-commerce-mcp`. The ledger is `database.json`; exported reports and launch cards land in `reports/`. Writes are atomic (temp file + rename), so an interrupted write cannot corrupt the ledger.

Step-by-step instructions for Claude Code and Claude Desktop, including troubleshooting, are in [docs/SETUP.md](docs/SETUP.md).

## The 24 tools

**Orientation**

- `ice_get_rubrics` — every weight, gate and threshold the server enforces. Call this first.
- `ice_ledger_stats` — what prior sessions recorded, and where.
- `ice_delete_record` — destructive; cascades to dependent records.

**Phase A — markets**

- `ice_upsert_market` — 12 equally weighted criteria, all phrased so higher is better.
- `ice_list_markets` — ranked, with the weakest criteria for each.

**Phase B — categories**

- `ice_upsert_category` · `ice_list_categories` · `ice_get_category`

**Phase C — products**

- `ice_upsert_product` · `ice_list_products` · `ice_get_product`

**Evidence**

- `ice_add_evidence` · `ice_check_evidence_gate`

**Phase D — sourcing**

- `ice_upsert_supplier` · `ice_check_supplier_gate` · `ice_update_due_diligence`

**Safety and IP**

- `ice_screen_compliance` · `ice_compliance_register`

**Unit economics**

- `ice_calc_unit_economics` · `ice_run_scenarios`

**Portfolio and output**

- `ice_select_portfolio` · `ice_launch_readiness` · `ice_export_launch_card` · `ice_export_report`

Every tool supports `response_format: "markdown" | "json"`, list tools paginate with `limit`/`offset` and return `has_more`/`next_offset`, and responses truncate at 25,000 characters with an explicit message rather than silently dropping data.

## Scoring

All factors are rated **0-10 by the agent**; the server computes `score = Σ(rating / 10 × weight)`.

**Category (100 points):** trend momentum 15 · impulse suitability 15 · short-form demonstrability 10 · unit-economics potential 20 · fulfilment simplicity 10 · automation suitability 10 · differentiation 10 · low regulatory/liability risk 10

**Product (100 points):** demand evidence 15 · impulse trigger 12 · visual demonstration 8 · unit economics 18 · acquisition potential 10 · shipping simplicity 10 · low return risk 7 · supply reliability 7 · differentiation 8 · low legal/safety/IP risk 5

Unrated factors forfeit their weight, and every response reports how many points were lost that way — an unrated product looks worse than a bad one, which is the correct incentive.

Products below **70** are watch-list ideas, not launch recommendations.

## Unit economics

```
landed cost      = (product cost + freight) × fx_shock + duty + non-recoverable import tax
                   + packaging + inspection + receiving

net price        = selling price excluding recoverable sales tax

pre-ad contrib.  = net price − landed − payment fees − fulfilment
                   − expected refund cost − expected defect cost
                   − expected delivery-failure cost − support allowance

max break-even CAC = pre-ad contribution
target CAC         = max break-even CAC − required profit per order
break-even ROAS    = net price ÷ max break-even CAC
```

Loss modelling is stated explicitly so nothing is double counted:

```
expected refund cost  = refund_rate × (net price − landed × salvage_rate + return shipping)
expected defect cost  = defect_rate × (landed + fulfilment)
expected delivery-failure cost = delivery_failure_rate × (net price − landed × salvage_rate + return shipping)
```

Screens (overridable per call): landed ≤ 30% of net price · pre-ad margin ≥ 45% · post-ad margin ≥ 15%.

**Cost inputs default to zero deliberately.** Zeros that are implausible in reality — payment fees, fulfilment, refund rate — are flagged in `warnings` rather than silently flattering the contribution.

`ice_run_scenarios` re-runs the stored base case under downside and upside multipliers (price, product cost, freight, CAC, refund, defect, delivery failure, FX, conversion rate). A conversion-rate multiplier moves CAC inversely. The number that matters is `survives_downside`.

## The gates

| Gate | Rule |
| --- | --- |
| Evidence — category | ≥ 3 independent source domains |
| Evidence — product | ≥ 2 independent domains, ≥ 1 not supplier-controlled |
| Supplier | 3 supply options target, 2 hard floor, backup required |
| Compliance | 9 hard flags → EXCLUDE unless cleared by recorded mitigation evidence; 8 soft flags → PENALISE |
| Economics | landed ratio, pre-ad margin, and post-ad margin when a CAC is supplied |
| Launch readiness | score ≥ 70 **and** all four gates above |

Independence is derived from the URL hostname, so relabelling three links to one site does not create three signals.

## Typical flow

```
ice_get_rubrics → ice_ledger_stats
  → ice_upsert_market ×N            → ice_list_markets
  → ice_upsert_category ×N          → ice_add_evidence ×3+ per category
  → ice_upsert_product ×N           → ice_add_evidence ×2+ per product
  → ice_upsert_supplier ×2-3        → ice_check_supplier_gate
  → ice_screen_compliance           → ice_calc_unit_economics → ice_run_scenarios
  → ice_launch_readiness            → ice_select_portfolio
  → ice_export_launch_card ×3       → ice_export_report
```

## Report export

`ice_export_report` writes only what has been recorded. Sections with no data are marked **NOT RESEARCHED** rather than filled with plausible text. Narrative sections that require judgement — executive verdict, customer-prospect maps, technology architecture, brand structure, the 14-day plan, the 30/60/90-day roadmap, and "What I would do if this were my money" — are deliberately **not** generated. A server that auto-wrote those would be manufacturing conviction it does not have.

## Tests and evaluations

```bash
npm test          # 63-assertion end-to-end smoke test over a real stdio session
npm run seed:eval # builds the synthetic fixture ledger used by test/evaluation.xml
```

The smoke test covers tool registration and annotations, hand-checked unit-economics arithmetic (net price, landed cost, refund/defect modelling, break-even CAC and ROAS), and negative tests proving each gate blocks what it claims to — same-domain evidence not counting twice, unverifiable "verified" suppliers rejected, hard compliance flags excluding, launch cards refused while gates fail, and portfolio selection returning fewer than three products rather than padding.

`test/evaluation.xml` holds ten read-only questions against the seeded fixture, each requiring several tool calls to answer. Every answer in it was produced by actually calling the tools, not predicted. **The fixture data is synthetic** — invented figures and illustrative URLs that exist only to exercise the tools, and nothing in it is market research.

## Known limitations

- **Ratings are still judgement.** The server makes scoring *consistent*, not *correct*. Garbage ratings produce a precise, reproducible, wrong number.
- **No currency conversion.** Values are stored in whatever currency is recorded; `fx_shock` is a stress multiplier on import-denominated costs, not an FX rate.
- **Single-user, single-process.** The JSON ledger has no locking; two servers writing the same `ICE_DATA_DIR` concurrently can lose a write.
- **`outputSchema` is declared only on `ice_calc_unit_economics`.** Other tools return `structuredContent` without a declared schema; shapes for heterogeneous records were not worth the runtime validation risk.
- **Compliance screening is a checklist, not legal advice.** A `PASS` verdict means no flags were recorded, which is only as good as the screening actually performed.
