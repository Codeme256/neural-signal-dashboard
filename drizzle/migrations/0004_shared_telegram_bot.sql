-- Shared TradePulse Telegram bot subscriptions. Apply to production Supabase database.
-- Bot token remains a single Cloudflare Worker secret, NEVER a table value.
CREATE TABLE IF NOT EXISTS public.telegram_subscriptions (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 telegram_chat_id text NOT NULL UNIQUE,
 telegram_user_id text NOT NULL UNIQUE,
 enabled boolean NOT NULL DEFAULT true,
 linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 code_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_link_expiry ON public.telegram_link_codes(expires_at);
ALTER TABLE public.telegram_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_subscriptions, public.telegram_link_codes FROM anon, authenticated;
GRANT ALL ON public.telegram_subscriptions, public.telegram_link_codes TO service_role;
-- Earlier delivery table (0003) is still used for deduplicated per-subscriber alerts.
-- The old per-user telegram_alert_settings table is no longer used; keep it temporarily
-- for reversible migration. Delete only after verifying all users have re-linked.
