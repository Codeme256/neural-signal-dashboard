# TradePulse Index Signal Notifications — deployment review

This is a **new independent Cloudflare Worker**, not a replacement for the existing `apex-signal-tank` website Worker or `tradepulse-telegram-service`. It generates signal alerts only. No MT5 account integration or trading.

## What is currently implemented
- Uses the same TypeScript `analyzeIndex()` module as the website. Default strategy is the H1 benchmark **Trend Continuation** assessed on M15 candles with H1 context. This is a research configuration, NOT proven profitability.
- An independent Cron Trigger runs 4 times per hour (1, 16, 31, 46 minutes UTC), scanning up to 12 open stock index markets from Deriv public data.
- Additive D1 `index_alerts` table stores deduplicated signals.
- Trusted server-only HTTPS request sends new qualifying alerts to the existing Telegram Worker's `POST /publish` endpoint. User Telegram subscriptions remain managed by the existing Worker.
- A read-only `GET /alerts` endpoint serves market-only alerts to the website notification bell via `VITE_INDEX_ALERTS_URL`.
- Index strength is a heuristic quality score, NOT a win-rate estimate. Execution friction remains modelled as an assumed ATR fraction, not true bid/ask spread.

## Review and deployment prerequisites
1. Run `npm test`, `npx tsc --noEmit`, `npm run build`, and `node --test telegram-service/worker.test.mjs`; verify GitHub checks.
2. Back up your existing **tradepulse-telegram** D1 database. Apply `index-alert-service/schema.sql` against that same D1 only after approval. This creates a new table without modifying existing Telegram tables.
3. Test scheduled Worker under Cloudflare `wrangler dev` with the supplied `index-alert-service/wrangler.jsonc`. **Do not deploy over the website Worker or Telegram Worker.**
4. For the new Worker, configure environment bindings: `TRADEPULSE_DB` D1 binding (specified in Wrangler), `TELEGRAM_PUBLISH_URL` text variable set to the existing Telegram Worker URL ending in `/publish`, `CORS_ORIGIN` text variable set to `https://apex-signal-tank.davidmwesigwa71.workers.dev`, and `TRADEPULSE_PUBLISH_SECRET` a Cloudflare Worker **secret** matching the existing Telegram publisher's server secret. Never expose the publisher secret in browser code, commits or screenshots.
5. Verify existing Telegram Worker is actually deployed and its `/health` returns ready=true. If it isn't, keep publisher disabled and don't claim Telegram alerts function.
6. Configure website `VITE_INDEX_ALERTS_URL` as the new scanner Worker's HTTPS origin; rebuild the website after review. This variable is a public URL, not an access token.
7. Verify scan logs, D1 rows, duplicates, timestamp freshness, website browser read state, Telegram delivery, and stale-market suppression. No legitimate signal should be fabricated for testing.
8. Confirm preserved Forex scans, old Telegram webhook and subscribers, existing D1 records and current UI.

## Known limitations
- Deployment and live WebSocket-to-Deriv compatibility are not verified in this pull request.
- Site has separate browser-based scanning; the server feed improves cross-device delivery but has no private per-user read state.
- Telegram publication currently occurs when a new signal row is stored; if publishing fails the row remains PENDING, but automatic retry logic must be validated before production.
- The Deriv public market-data WebSocket does not require the user's public Deriv App ID or a private API token.
- No strategy has a verified positive out-of-sample expectancy after costs.
- A scheduled signal scan is not a prediction of a future candle. It can notify before manual scan, after a completed candle passes rules.

**Review-only:** Do not merge or deploy without the user's final approval.
