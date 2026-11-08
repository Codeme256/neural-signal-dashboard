# TradePulse index engine — implementation and validation record (2026-11-08)

## Boundaries
Signal generation ONLY. No trading orders, account/broker controls, copy-trading, or MT5 integrations.
Existing Forex strategy registry is unchanged; stock-index paths are classified from Deriv `category === "INDEX"` and routed to `analyzeIndex`.

## Implemented on the feature branch
- Selectable index strategy registry: existing Trend Continuation benchmark (default); MACD histogram scalp; EMA 9/21/55 ribbon pullback; Bollinger 20/2 plus RSI/ADX snap-back; ATR 14 consolidation breakout with configurable threshold and explicitly price-only volume fallback; confirmed sweep + structural shift; and 3-candle fair-value-gap retracement.
- Every setup uses closed OHLC candles. An unavailable, closed, stale, unsupported or insufficient-data market returns NO TRADE/WAIT rather than fabricated levels.
- Mandatory conditions are binary; levels use the existing structural ATR-buffered risk engine with minimum 2R. Score 100 means the implemented checks were satisfied, NOT a success probability.
- MACD/Bollinger/Stochastic contextual indicator values are shown in Technical Breakdown with market timestamp, checks, and data-source annotation. The index scanner offers independent strategy toggles and an ATR threshold.
- Index scans automatically record one browser-local per-account scan audit entry for each market and scan session; duplicates of the same directional candle/setup are folded together. BUY/SELL can be auto-tracked using the existing authenticated `tracked_signals` backend table when that backend table is provisioned. Existing tracked-outcome checker remains on the Analysis page.
- Analysis adds index-only browser scan counts and hypothetical resolved-outcome metrics grouped by strategy, timeframe, symbol and month. **These are based on candle-verified tracked signals, not executed trades.** Assumes full TP1 exit or full SL, without fees/spread/slippage. EXPIRED, OPEN and unresolved signals are excluded from R metrics.

## Explicitly pending; do not mark complete
- Server-side scan-session/WAIT-history persistence across devices. Current audit is **browser-local** and per-user. The existing tracked BUY/SELL table is different.
- Historical backtests for *all* six strategies on actual Deriv stock-index datasets, with realistic spreads/fees, out-of-sample splits, per-symbol/timeframe breakdown and statistically adequate samples.
- In-browser inspection of Technical Breakdown on desktop/mobile and real Deriv live market tests; CI does not replace manual browser checks.
- Market regime attribution storage and filtering, full index/timeframe/date filters in Analysis, separate backtest vs live records, and explicit revalidation of old experimental Pullback and Bollinger Squeeze algorithms. They are not present in the inspected current repository; do not claim they were preserved as running algorithms.
- Strategy parameters and quality gates need forward-validation; experimental strategies are disabled in the default all-strategy scan.

## Previously reported preliminary backtest results (user supplied, NOT independently reproduced)
Approximately one year of hourly Deriv index data across nine indices:
- Trend Continuation: approximately +0.2R/trade.
- Prior Smart Money/FVG/Liquidity Sweep variants: negative average results.
- Filtering the older strategy set: approximately -0.10R to -0.02R/trade average, still negative.
- Older Index Trend Pullback: 7 trades, inadequate sample.
- Older Bollinger Squeeze Breakout: approximately break even.
All exclude spread. These numbers are **not** accepted as live profitability claims.

## Activation gates
1. GitHub unit-test suite and production build green.
2. Verify Cloudflare build deploy command activates an actual version, not just uploads one.
3. Test a live index signal on the public website; verify individual strategies, freshness, expiry, mobile UI and missing-feed behavior.
4. Validate account isolation, cloud `tracked_signals` provisioning, and UI.
5. Do not assert full completion until server scan history and robust backtesting are actually installed/tested.
