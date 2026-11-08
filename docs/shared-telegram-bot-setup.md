# TradePulse Telegram: one shared bot for all users

TradePulse uses ONE owner-managed Telegram bot. Individual TradePulse users do not supply bot tokens or chat/channel IDs.

## Architecture
- Owner configures one `TRADEPULSE_TELEGRAM_BOT_TOKEN` as a **Cloudflare Worker secret** (not in GitHub, JavaScript, localStorage, VITE_ variables or public database rows).
- Each signed-in user selects **Connect Telegram**. Server generates a random, one-time 48-hex-character code and stores its SHA-256 hash for at most 10 minutes.
- The user opens `https://t.me/<shared_bot_username>?start=<code>` and presses Start in a **private** bot chat.
- Telegram delivers `/start <code>` to a webhook protected by `X-Telegram-Bot-Api-Secret-Token`. Only then does the server record Telegram's actual user ID and private chat ID for that signed-in TradePulse account.
- A Telegram identity already linked to another TradePulse user cannot be claimed by a different account. The connected user can test and disconnect their own subscription.
- Alerts are delivered only to the account owner's verified private chat. Client-generated signals are **not independently market-validated on the server**. No trade execution.

## Production activation
1. Apply `drizzle/migrations/0003_telegram_alerts.sql` (delivery table) AND `drizzle/migrations/0004_shared_telegram_bot.sql` (shared subscriptions and connection codes) to your production Supabase/Lovable Cloud database. The obsolete `telegram_alert_settings` table from migration 0003 is not used by this design.
2. Configure these **private Cloudflare Worker secrets** on the Worker that actually serves your site:
   - `TRADEPULSE_TELEGRAM_BOT_TOKEN` — one bot token from @BotFather. Never send it to another user or commit it to GitHub.
   - `TELEGRAM_WEBHOOK_SECRET` — a long random string of allowed characters [A-Za-z0-9_-], used to authenticate Telegram webhook requests.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — backend Supabase credentials (service role is server-only).
3. Deploy the Worker and register its public HTTPS webhook with Telegram once using the bot's `setWebhook` API, URL:
   `https://apex-signal-tank.davidmwesigwa71.workers.dev/api/signal-alerts/telegram/webhook`
   and parameter `secret_token` set to exactly `TELEGRAM_WEBHOOK_SECRET`. Perform registration only in a protected admin shell or trusted server; do not paste secrets into chat or a public browser address.
4. Check that an unauthenticated `GET /api/signal-alerts/telegram` returns 401; webhook POST without Telegram's secret header returns 401. Test authenticated account linking, direct bot chat, test message and disconnect.
5. Each user logs into TradePulse and clicks **Notifications → Connect Telegram → Start → Check Connection**. They never see or enter the shared bot token.
6. Users enable **Start Auto Monitor** to generate their own alerts. A bot message will arrive only if an actionable new signal is found, the app is open and visible, Telegram is linked and the backend is correctly configured.

## Limitations and security
- An auto-monitor operates in the user's visible dashboard, checking up to 8 instruments every 5 minutes (M15). Closing or hiding the browser stops the monitor. There is **no always-on background scanner**; 24/7 delivery would require an explicitly deployed scheduled server monitor.
- A shared Telegram bot does NOT mean sending all users one another's private signals; delivery is per signed-in user. To broadcast universal signals from one central server scanner, create a distinct server-side verified publisher and opt-in channel logic.
- The Telegram Bot API token must stay only in server-side Cloudflare secrets. Webhook secret must not be visible to clients. Never forward private deep-link codes (expire after 10 minutes).
- The current `/send` route accepts authenticated user-supplied analysis with formatting/risk checks and rate limits, **not** independently recomputed signals, so do not treat it as a trusted public signal publication API.
- Existing per-user encrypted Telegram token configurations are intentionally not reused. Users must link their Telegram accounts afresh. Obsolete token data can be removed after review.
- Production migration, secret provisioning, webhook registration, and browser/mobile tests require actual platform access; merging GitHub code alone is not deployment proof.
