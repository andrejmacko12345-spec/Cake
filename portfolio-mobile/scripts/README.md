# Shared quarterly financial history

The app bundles `src/data/financial-history.json`, so historical results work on
the first launch even offline. Only public company financial data is stored;
holdings, transactions and user data are never sent to the updater.

## Updating

Run `npm run refresh:financial-history` from `portfolio-mobile` to update the
symbols in `src/data/financial-universe.json`. To update selected symbols, run
`npm run refresh:financial-history -- GOOGL AMD`. The updater retains existing
history, including observations no longer available from the upstream provider.
It rejects empty updates and reports failures instead of replacing data with
empty rows.

The GitHub workflow **Refresh financial history** runs on the first day of each
month at 05:17 UTC for a full backfill, and every six hours at minute 17 for
Yahoo results and pre-report forecast collection (`--earnings-only`). It can
also be started manually. GitHub schedules can be delayed; this is not a
real-time delivery guarantee. It commits only the public
JSON snapshot to `main`. The workflow and initial dataset must be pushed to
`main` before automatic updates work. GitHub Actions needs permission to write
repository contents. Branch protection may require publishing through a PR
instead of the workflow's direct push.

SEC is the primary historical source. Yahoo provides additional reported
quarterly observations and annual period-end anchors for fiscal labels.
An optional repository Actions secret `FMP_API_KEY`
enables FMP backfill; do not put credentials in the JSON dataset. No API key is
required for SEC/Yahoo. Provider access/rate limits still apply.

## App behavior

### Coverage expansion (November 5, 2026)

The shared universe and offline snapshot now contain 85 tickers (previously 65).
This batch adds MU, MRK, AMAT, RTX, PANW, LRCX, CRWD, AXP, GILD, DELL, GEV,
ANET, C, PEP, VZ, ADI, BLK, APH, DE and UNP. These were the next uncovered
constituents in the descending [S&P 500 index-weight list](https://www.slickcharts.com/sp500),
used as a float-adjusted size priority, not an exact total-market-cap ranking.
The universe still includes non-S&P companies and is not a full constituent list.

All 20 imports succeeded using SEC companyfacts and Yahoo statements/earnings.
Each added ticker has six recent reported quarters and at least four EPS
actual/consensus comparisons. Historical revenue consensus was unavailable
in these automated feeds: revenue beat remains unavailable, not inferred from
current forecasts. Eligible future estimates are archived separately.
Existing companies' observations were retained unchanged.

### Complete-consensus expansion (November 5, 2026)

A further **50 companies** bring the shared universe to **135 tickers**:
PFE, ISRG, TJX, VRTX, LMT, MDT, BMY, SYK, LOW, COF, MCK, NEM, ADP, CME, HCA,
CVS, VLO, GD, MRNA, WM, ELV, CSX, UPS, REGN, ADBE, MNST, FTNT, MCO, CMCSA,
MSI, TT, CDNS, SHW, MDLZ, SNPS, HWM, CEG, ITW, PWR, CL, GM, ROST, NSC, NOC,
SLB, DASH, AJG, TGT, AON and HOOD.

All six displayed reports for each of these 50 companies have paired historical
Revenue beat and EPS beat (**300 reports, 600 comparisons**), tested through
`fetchCompanyEvents` with networking disabled. This does **not** make the older
85 tickers complete: their existing missing comparisons remain unchanged.

`node scripts/expand-earnings-history.cjs --limit=50 TICKER ...` processes explicit
candidate tickers in the supplied size-priority order. It reads the public
MarketBeat historical earnings table and records the source report URL,
table URL, publication date and original actual/estimate pair in
`reported-consensus.json`. SEC statements independently validate period ends
and reported revenue (within 2% to allow published rounding). Actuals and
estimates for a beat always come from the same MarketBeat row, never mixed
with Yahoo's different consensus. These are automated source checks, not a
claim that every underlying provider observation has been manually reviewed.
Reported EPS uses the table's consensus-comparable series; differences from
the table's GAAP EPS are labeled adjusted.

The importer accepts a company only when the exact screen merge has six finite
beats of each kind. Missing history, mismatched revenue/periods, suspicious
EPS split scales and known REIT FFO/EPS ambiguities are rejected, not filled
with zeros or forecasts. It continues to smaller companies when a larger
candidate fails; rejected companies are logged and cause a nonzero exit even
when other valid imports were saved. REIT coverage needs explicit methodology
review before extending the current exclusion list. Original companies are
never overwritten by this expansion command. Future new reports still require
new consensus observations; this snapshot is not a permanent completeness guarantee.

### Full-index audit (November 5, 2026)

`node scripts/expand-earnings-history.cjs --sp500` discovers current constituents
from [Wikipedia's S&P 500 table](https://en.wikipedia.org/wiki/List_of_S%26P_500_companies)
and checks existing histories as well as missing companies. Complete existing
histories are retained. Incomplete existing histories are updated only if all
six displayed reports pass the same checks; old observations remain archived.
Explicitly reviewed non-comparable EPS entries are never overwritten.

The two-pass audit produced **274 total dataset tickers**, including **239 of
503 S&P constituent tickers with complete six-report comparisons**. The other
**264 constituents remain incomplete or absent**, so this is not full-index
coverage. Share classes count separately. The dataset also retains non-index
companies from earlier batches.

Machine-readable `src/data/sp500-earnings-coverage.json` records membership
source, timestamp, completeness and rejection reason for each constituent.
This is a maintenance audit, not a new app screen. The checks reject missing
estimates, questionable EPS split scales, REIT FFO/EPS ambiguities, unmatched
periods and conflicting revenue definitions. A rejection is not a claim that
the company has no earnings reports.

When SEC has not yet published a matching recent period, the alternative pass
can validate against Yahoo's latest reported financial statement, still requiring
revenue agreement within 2%. It cannot pick an older quarter merely because its
value happens to match. New source pairs record `validationSource` (`sec` or
`yahoo`). MarketBeat still supplies both sides of each beat; the independent
statement only validates the reported period and revenue. No current forecast
is used to fill a missing historical consensus. Rounded source revenue retains
its published precision. Date-only report dates use end-of-day UTC.

- The bundled snapshot is immediately available; AsyncStorage retains subsequent
  shared updates and live observations across restarts.
- Stock detail reads local earnings reports without waiting for the shared
  snapshot download, news, dividends or Yahoo fundamentals. Live reports refresh
  independently and replace local results only after success; errors remain
  visible. Metrics and annual estimates also render independently, rather than
  waiting for the slowest request across all three sections.
- Successful historical chart/index requests are reused for 60 seconds;
  key metrics and stock estimates for five minutes. These bounded in-memory
  caches share concurrent identical requests, expire automatically and never
  cache failures. They reset when the app process restarts. A first uncached
  chart or metric still depends on the upstream service.
- The public `raw.githubusercontent.com` snapshot is checked at most once per
  hour after a successful download (or the bundled snapshot's date on a
  fresh install). Failures retain local/bundled history
  and retry no sooner than one minute later.
- Routine screen loads request only the most recent 120 days from Yahoo
  (one or two reported quarters). Older observations come from local history.
- Symbols outside the shared universe get an on-device backfill, then use the
  same monthly policy. Add them to the universe for shared coverage.
  `backfilledAt` tracks the full backfill separately from frequent earnings
  updates, so six-hour collection cannot postpone monthly statement backfills.
- Source identities are retained: SEC, FMP, Yahoo statements and Yahoo earnings
  are not mixed when calculating EPS growth. A refresh never erases a known
  value with a null value.
- The displayed columns are Period, Revenue, Revenue YoY, Revenue beat, EPS,
  EPS beat. EPS YoY is no longer displayed. EPS comes from the same consensus
  series as EPS beat, using the provider's declared GAAP/non-GAAP methodology.
  Statement EPS is not used as a fallback for an adjusted consensus.
- Beat is `actual - estimate`, not a percentage: Revenue beat is in the revenue
  currency (abbreviated M/B), EPS beat is currency per share with two decimals.
  Zero estimates are valid; unavailable estimates produce a dash. Actuals and
  estimates are archived together. Negative values mean a miss.
- Yahoo `earningsHistory` and `earningsChart` archive EPS actuals/estimates.
  Rolling `earningsTrend` forecasts are never treated as historical revenue
  consensus, even when their period is called `0q`.
- The collector separately stores eligible `earningsTrend` revenue forecasts
  under `yahoo-forecast`: exact period end, currency, capture time and expected
  report date. Only the next unreported quarter is accepted (60-120 days after
  the last known actual); the scheduled report must follow its period end by
  at most 120 days. Capture stops at UTC midnight before the scheduled report
  day. Stale `0q`, annual estimates, missing currency and already reported
  quarters are skipped, not retroactively converted into estimates.
- A forecast is paired only with Yahoo earnings revenue in the same currency
  and matching period (14-day tolerance for fiscal/calendar dates), with an
  explicit publication date. Capture must precede both the expected and actual
  report day; publication must be within 14 days of the expected date, and
  capture within 120 days before it. This is a conservative **provisional**
  comparison, not a guarantee of matching adjusted/GAAP revenue definitions
  (particularly for financial companies). It appears with `*` in both screens.
  Missing or ambiguous matches remain unavailable.
- Each workflow run lists provisional beats in its Actions job summary.
  To verify one, check the company's release and a trustworthy consensus
  report, add the matched pair and provenance to `reported-consensus.json`,
  then run the updater. Reviewed entries take priority and remove the `*`.
  The manual check is an operator task, not an automatic verification claim.
- `src/data/reported-consensus.json` supplements verified historical revenue
  and EPS actual/estimate pairs with source URL, provider and publication date.
  Values retain the source's precision. Monthly updates retain these pairs
  and earlier observations; missing historic estimates remain unavailable.
  Reviewed pairs take priority over automated earnings feeds: provider metadata
  can incorrectly label GAAP actuals paired with adjusted consensus. Both GOOG
  and GOOGL use the same Alphabet consensus entries. Revenue surprises use the
  actual and estimate at the precision quoted by the linked report, while the
  main Revenue column retains the more precise financial-statement amount.
- Reviewed six-report coverage includes AMD, SOFI, META, ELF, GOOGL (also GOOG),
  HIMS, NFLX, CELH, NKE and NOW as of November 4, 2026. ELF, HIMS and CELH had
  not yet published their September 2026 results. Nike labels follow its actual
  February/May/August/November period ends, not the fiscal year in news titles.
  Consensus varies by provider; never splice another provider's estimate into
  an archived pair. Figures quoted in rounded M/B units retain that precision,
  so a zero beat can mean in-line at the source's published precision.
- Older NFLX and NOW EPS pairs are adjusted on **both** sides for their 10:1
  and 5:1 splits. A reviewed `epsEstimateComparable: false` suppresses EPS beat
  even if a stale cache contains an estimate. NFLX Q1 2026 is intentionally
  flagged: CNBC says reported EPS includes the WBD termination fee and is not
  comparable to consensus. Reported EPS and revenue beat remain available.
- Consolidated SEC bank revenue (`RevenuesNetOfInterestExpense`) takes priority
  over contract-only revenue, including when a partial concept was filed later.
  This prevents showing only SoFi's service revenue as its total revenue.
  Date-only archived report dates use end-of-day UTC conservatively.
- Display labels always use the UTC calendar quarter/year of the actual
  period-end date, not the company's fiscal quarter. Fiscal metadata remains
  in storage. Future period-end dates, future publication dates and
  empty rows are excluded from historical results. Upcoming earnings dates
  remain in the events timeline. Opening an upcoming earnings event shows a
  separate forecast card (revenue/EPS estimates, currencies and expected YoY)
  above reported history. The stock-detail results table stays historical-only.
  Forecast and reported cards use matching metric labels; forecasts have a
  violet accent. Reported cards are green only when both beats are positive,
  red when either is negative, otherwise neutral (including missing estimates).
  Live forecasts can be displayed on the report day before publication, although
  archival collection stops before that day. Both use the same period checks;
  stale rolling forecasts are not relabeled to manufacture upcoming estimates.
  YoY uses the provider's corresponding year-ago value or reported growth rate,
  never a GAAP/adjusted cross-source EPS comparison.
- YoY requires a comparable prior-year quarter and a nonzero base. Quarterly
  revenue may be derived from annual minus nine-month revenue for the same
  accounting concept. EPS is **not** derived by subtracting annual/YTD EPS.

Coverage is not universal: some Q4 EPS, class-specific EPS, and foreign-company
quarters are not present in the providers' standard tags. Persisting history
prevents future loss but does not invent these missing observations. The
updater prints coverage for the six newest quarters of each symbol.

Run `npm test` for fiscal-label, offline-cache, source-merging and YoY
regressions.

`src/data/reported-releases.json` contains manually verified GAAP figures from
linked public earnings releases when structured feeds lag behind publication.
The updater merges these into SEC statement history without replacing newer
structured observations. Each entry must include its official source URL,
publication time and actual period end; never add guidance or adjusted EPS.
