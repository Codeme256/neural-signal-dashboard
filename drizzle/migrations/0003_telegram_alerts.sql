-- Apply to the Supabase/Lovable Cloud project used by the production website.
-- Bot credentials are AES-GCM ciphertext encrypted by the Cloudflare server.
-- No client role has direct table privileges; only the service role uses these tables.
CREATE TABLE IF NOT EXISTS public.telegram_alert_settings (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 encrypted_bot_token text NOT NULL,
 token_iv text NOT NULL,
 chat_id text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.telegram_alert_delivery (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 signal_id text NOT NULL,
 sent_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,signal_id)
);
CREATE INDEX IF NOT EXISTS telegram_delivery_user_sent
 ON public.telegram_alert_delivery(user_id,sent_at DESC);
ALTER TABLE public.telegram_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_alert_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_alert_settings,public.telegram_alert_delivery FROM anon,authenticated;
GRANT ALL ON public.telegram_alert_settings,public.telegram_alert_delivery TO service_role;
-- No authenticated policies: the server verifies the Supabase access token and uses service_role.
