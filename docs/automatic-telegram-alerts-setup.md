# TradePulse automatic signal alerts — deployment and security

## What is implemented
- An opt-in foreground scanner checks up to 8 open Deriv instruments every 5 minutes (M15 timeframe), cycling through the available market list. It reuses the existing Forex, stock-index, BTCUSD and volatility signal engines, never executes trades, and refuses incomplete or stale signals.
- For newly confirmed BUY/SELL signals with minimum 1:2 displayed R:R and strength >=70, the dashboard shows a Sonner popup and, if granted, a browser Notification. Per-user/candle/strategy keys are cached to avoid repeat popups.
- The logged-in user may configure a Telegram bot token and channel/chat ID in the Notifications panel. Server endpoints verify the Supabase access token, encrypt the bot token using AES-256-GCM, keep the ciphertext in an RLS-protected service-only database, and send messages through Telegram with per-user deduplication and rate limiting.
- The bot token is **never included in client JavaScript, browser storage, the database in plaintext or GitHub**.

## Required production setup (before Telegram works)
1. Apply `drizzle/migrations/0003_telegram_alerts.sql` to the same managed Supabase/Lovable Cloud database used by the site.
2. Set Cloudflare Workers **server secrets**, not VITE_ environment variables:
   - `SUPABASE_URL` — actual production auth/project API URL
   - `SUPABASE_SERVICE_ROLE_KEY` — service role/secret key, server-only (not the publishable key)
   - `TELEGRAM_CONFIG_KEY` — cryptographically random 32-byte AES key encoded as Base64. Generate via a secure random byte generator; store only in Cloudflare Secrets.
3. Deploy the main Worker; verify that `GET /api/signal-alerts/telegram` returns **401** without a signed-in bearer token (not HTML).
4. Add the Telegram bot as an administrator of the intended channel with permission to post. Configure the token and ID in TradePulse's **⚙ Notifications** panel, then press **Send Test**.
5. Enable **Start Auto Monitor** on the dashboard and enable optional OS/browser notifications.

**Do not share bot tokens in ChatGPT.** Tokens must never be added to GitHub files, VITE_ variables or client-side localStorage. If compromised, regenerate via BotFather.

## Important limitations
- The auto-monitor runs **only while the TradePulse dashboard is open, visible and online**. Closing the tab or browser halts checks and Telegram dispatch. Browser notifications are not mobile push subscriptions or service-worker push.
- There is **no Cloudflare Cron Trigger or always-on server scanner** yet. To provide 24/7 Telegram delivery, implement and deploy a separate scheduled server-side monitor that independently fetches real market data, verifies alerts and sends only from the server.
- The monitor scans **8 markets per 5-minute cycle**, not every symbol simultaneously; for many listed Deriv symbols it may take several cycles to scan the full list.
- Scans are signal-generation only. A strong signal score is NOT a win probability, and a scan alert is NOT an independently executed or verified trade result.
- Cloudflare secrets and the managed DB migration must be activated manually in the corresponding administrative accounts. GitHub merge does not apply database migrations or provision secrets.
- The Telegram delivery endpoint currently relays authenticated browser-generated signals to the owner's configured chat (with validation and rate limit), not independently recomputed server-certified signals. Do not use it as a trusted third-party signals publisher.

## Testing release gates
- GitHub unit tests, production build, and strict TypeScript typecheck green.
- Verify authenticated GET/PUT/POST/DELETE Telegram settings and test-message response on production with a real bot/channel.
- Verify no unauthenticated access, that encrypted ciphertext does not equal the bot token, and that one completed-candle signal generates only one alert.
- Verify browser notifications in a real mobile/desktop browser, permissions, stale feed, offline feed and market closure.
- Verify Cloudflare production is running the merged commit.
