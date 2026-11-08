# Cloudflare D1 setup for TradePulse Telegram subscriptions

The production database has been created in Cloudflare as **tradepulse-telegram** and these three SQL tables were entered by the site owner:
- telegram_subscriptions
- telegram_link_codes
- telegram_alert_delivery

The Telegram backend uses D1 for subscription records, one-time hashed links, and signal deduplication. Existing TradePulse account authentication still uses its existing Supabase-compatible auth provider; D1 does not replace that login.

## Bind to the existing Cloudflare Worker

1. In **Workers & Pages → apex-signal-tank → Settings → Bindings**, choose **Add binding → D1 database**.
2. **Variable name:** `TRADEPULSE_DB`
3. **D1 database:** select `tradepulse-telegram` (database ID `3d9bb1bf-f57f-4ec1-b60f-f0f5a62204d6`).
4. Save/deploy the binding. Do not create a second database or use Hyperdrive.

## Required server-side settings
- `TRADEPULSE_TELEGRAM_BOT_TOKEN`: the bot token, Cloudflare **Secret**, never plaintext Variable or GitHub.
- `TELEGRAM_WEBHOOK_SECRET`: independent long random Cloudflare **Secret**, same value used by Telegram `setWebhook`.
- `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` **or** `SUPABASE_PUBLISHABLE_KEY` to validate the user's existing TradePulse session. These retain the site's existing account system and do NOT write Telegram data to Supabase.

The Telegram webhook endpoint is:
`https://apex-signal-tank.davidmwesigwa71.workers.dev/api/signal-alerts/telegram/webhook`.

## User connection
Sign into TradePulse → Automatic Signal Alerts → Notifications → Connect Telegram → Start in private bot → Check Connection → Send Test. No one enters a personal bot token or channel ID.

**Limitations:** Only private subscriber delivery is implemented. A Cloudflare channel-ID variable does not yet publish to a channel. The automatic scanner runs in a foreground, visible browser; 24/7 server-side scanning has not been implemented. Authenticated browser-submitted signal alerts are not independently price-verified by this server.

## Verification
The server returns HTTP 401 for unauthenticated `GET /api/signal-alerts/telegram` after proper deployment. If the D1 binding is missing, the server reports the missing `TRADEPULSE_DB`. If the auth server secrets are missing, it reports that configuration is required. Do not assume the GitHub merge has deployed the Cloudflare Worker.
