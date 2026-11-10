# Independent TradePulse Telegram Service

This is a **separate Cloudflare Worker**, not an embedded part of the TradePulse website. The public site's large **Automatic Signal Alerts** / **Connect Telegram** panel and old Telegram API route are removed from the dashboard code. Existing market scanners (BTCUSD, Volatility, Forex, stock indices, metals), website login, charts and manual scans remain unchanged.

## Architecture and limitations

- Bot connections happen **entirely in Telegram**: users open your bot and send `/start`, `/status`, or `/stop`. They do not need a TradePulse account, bot API token, or channel ID.
- Your existing Cloudflare D1 `tradepulse-telegram` database holds private subscribers and alert-deduplication records. Its three existing tables remain usable.
- The bot can post a test to the owner's Telegram channel, provided the bot is an administrator with permission to post.
- A protected `POST /publish` endpoint can send validated signal payloads to subscribed users and the channel. **It is deliberately NOT callable from a public browser without an administrative secret.**
- **No automatic market scanner or publisher is currently attached to this separate Worker.** Telegram subscription and test-message delivery can work independently; actual BUY/SELL alerts won't be automatic until a server-side, independently verified scanner is connected and deployed. The service never executes trades.
- Existing Telegram webhook points to the old website Worker until explicitly changed with Telegram `setWebhook`. Never change it before the new Worker is deployed and correctly configured.

## Recommended Cloudflare deployment (source already in GitHub)

This directory is fully separate: `telegram-service/worker.mjs` is the entire service and `telegram-service/wrangler.jsonc` has its own worker name and D1 binding.

**Option A — Cloudflare editor**
1. Cloudflare dashboard → Workers & Pages → **Create Worker** → name `tradepulse-telegram-service`.
2. Deploy the empty initial Worker, then click **Edit code**. Replace only this **new separate Worker's** initial starter code with the complete contents of `telegram-service/worker.mjs`. **Do not edit the existing apex-signal-tank Worker code.**
3. In the NEW Worker's Settings → Bindings → D1 database → select existing `tradepulse-telegram`, variable name `TRADEPULSE_DB`.
4. In the NEW Worker's Variables and Secrets, configure:
   - `TRADEPULSE_TELEGRAM_BOT_TOKEN` — your existing BotFather bot token, choose **Secret**.
   - `TELEGRAM_WEBHOOK_SECRET` — independently random webhook secret, choose **Secret**. Can use your current value if it is secure and has not been exposed.
   - `TRADEPULSE_PUBLISH_SECRET` — a fresh independent 32+ character secret for a future trusted server-side signal publisher, choose **Secret**.
   - `TRADEPULSE_TELEGRAM_CHANNEL_ID` — existing channel ID (optional; **Text**). Bot needs channel posting permission.
5. Save and deploy the separate Worker. Check GET `https://tradepulse-telegram-service.<YOUR-CLOUDFLARE-SUBDOMAIN>.workers.dev/health`. `ready:true` means the bot/D1/webhook secret are available, **not** that automatic scanning is active.
6. Register the NEW webhook URL `https://tradepulse-telegram-service.<YOUR-CLOUDFLARE-SUBDOMAIN>.workers.dev/telegram/webhook` using Telegram's `setWebhook` API and the exact `TELEGRAM_WEBHOOK_SECRET`. Use private Terminal entry; never paste tokens into public URLs, GitHub or screenshots.
7. Open the bot in Telegram → send `/start` → receive confirmation → `/status` for active subscription → `/stop` to unsubscribe.
8. To send one owner test message to the channel, a trusted private shell can POST to `/admin/test` with `Authorization: Bearer <TRADEPULSE_PUBLISH_SECRET>`. Never put the publisher secret in frontend code.

**Option B — Wrangler deployment (on a trusted computer)**
From a local clone of this repository:

```bash
cd telegram-service
npx wrangler login
npx wrangler secret put TRADEPULSE_TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TRADEPULSE_PUBLISH_SECRET
npx wrangler deploy
```

Set `TRADEPULSE_TELEGRAM_CHANNEL_ID` as a regular variable on the new Worker (if channel posting is required). The D1 binding is specified in `telegram-service/wrangler.jsonc`; do NOT re-create the database.

### Webhook cutover safety

The existing Telegram bot can have only one active webhook URL. **Do not call `setWebhook` for the new service until it is fully configured.** A webhook cutover moves all incoming bot commands to the new Worker. The old website's Telegram API will no longer be used after the site's updated deployment.

### Signal format (trusted server publisher, not public users)

`POST /publish` with a private Bearer secret and JSON:
```json
{
 "id":"BTCUSD|M15|2026-11-08T16:45:00Z|btc-trend",
 "symbol":"BTCUSD",
 "strategy":"BTC EMA Trend Continuation",
 "direction":"BUY",
 "timeframe":"M15",
 "entry":76000,
 "stopLoss":75700,
 "tp1":76600,
 "tp2":76900,
 "rr":2,
 "candleTime":1794156300000
}
```
Example values are illustrative, not current prices or trade recommendations. Timestamp must be within 2h; directional stop/target consistency and minimum 1:2 R:R are enforced. The service only checks payload structure, **not** market-price accuracy.

## Security

- Rotate any Telegram bot token or webhook secret accidentally shown in screenshots. Do not move visible plain-text secrets into another Worker without rotating them.
- Do not expose `TRADEPULSE_PUBLISH_SECRET` to a browser. A real market-data scanner must run in a trusted server environment.
- Avoid manually testing with real-looking trade signals; use `/admin/test` for delivery checks.
- There is no direct transmission of user account details from TradePulse. Telegram user subscriptions are separate from website authentication.


## APEX Telegram command center (2026-11-10)

The Telegram Worker can now handle /start, /help, /menu, /status, /signal,
/analyze, /price, /watchlist, /news, /mode, /account, /positions, /close,
/risk, /performance, /history, /dailypl, /drawdown, /pause, /resume,
/autotrading, /alerts, /settings, /report, /confirm, /cancel, /support
(and /stop). Buttons use Telegram inline callback queries.

- /signal and /history use confirmed index signals in the shared D1 index_alerts table.
  They do not manufacture missing signals, and old signals are marked historical.
- /price SYMBOL fetches a fresh public Deriv tick for a limited validated symbol
  set (EURUSD, GBPUSD, USDJPY, GBPJPY, XAUUSD, BTCUSD).
- /analyze SYMBOL fetches completed H1 candles, calculates EMA20/EMA50,
  candle body and previous 20-candle range breakout. This is context,
  **not** an executable signal or a profitable-strategy guarantee.
- /status and /alerts report personal subscription status; /pause and
  /resume only affect private bot notifications, not separate channel broadcasts.
- /news, /account, /positions, /close, /dailypl, /drawdown, /autotrading,
  and unverified performance statistics report accurate limitations.
  No broker account or trade executor is connected to this Worker.

**Important: deploying code alone cannot restore /start replies.**
Telegram sends updates only to its registered webhook. After
the Telegram Worker is deployed with valid bot, D1 and secrets,
register the new webhook and menu commands through the authenticated
\`POST /admin/setup\` endpoint. This endpoint invokes Telegram's
\`setWebhook\` with \`secret_token\` and \`setMyCommands\`. It is intentionally
inaccessible without the private \`TRADEPULSE_PUBLISH_SECRET\`.

A trusted terminal can run this without placing credentials in shell history
or GitHub. **Do not paste the credential or complete output into chat**:

\`\`\`bash
read -s "SECRET?Paste Cloudflare publishing secret (hidden): "
echo
curl -fsS -X POST \
  -H "Authorization: Bearer \${SECRET}" \
  "https://tradepulse-telegram-service.davidmwesigwa71.workers.dev/admin/setup"
unset SECRET
\`\`\`

On zsh, the \`read -s "SECRET?Prompt"\` syntax is supported. For
a shell-independent alternative, \`read -s SECRET\` works where implemented.

The authorized \`POST /admin/webhook-status\` endpoint returns the current
webhook URL and pending update count without revealing the bot token or secret.
After setup, send \`/start\` in the bot's private Telegram chat and check the
\`/telegram/webhook\` requests in Worker Observability.

The deploy workflow \`.github/workflows/deploy-apex-telegram-commands.yml\`
deploys **only** \`tradepulse-telegram-service\` when the Telegram Worker source
is merged into main, reusing \`CLOUDFLARE_API_TOKEN\` from GitHub Secrets.
It does not target the main website or Deriv index scanner. Cloudflare secrets
and the existing D1 binding must remain configured in the Telegram Worker.
