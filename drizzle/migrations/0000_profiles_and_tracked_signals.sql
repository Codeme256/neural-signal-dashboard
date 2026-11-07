CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.tracked_signals (
  user_id uuid NOT NULL,
  id text NOT NULL,
  deriv_symbol text NOT NULL,
  symbol text NOT NULL,
  decimals integer NOT NULL,
  action text NOT NULL,
  timeframe text NOT NULL,
  strategy text,
  score integer NOT NULL,
  entry double precision NOT NULL,
  stop_loss double precision NOT NULL,
  take_profit1 double precision NOT NULL,
  take_profit2 double precision NOT NULL,
  signal_time bigint NOT NULL,
  tracked_at bigint NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  target text,
  closed_at bigint,
  checked_at bigint,
  PRIMARY KEY (user_id, id),
  CONSTRAINT tracked_action_chk CHECK (action IN ('BUY','SELL')),
  CONSTRAINT tracked_status_chk CHECK (status IN ('OPEN','WON','LOST','EXPIRED')),
  CONSTRAINT tracked_target_chk CHECK (target IS NULL OR target IN ('TP1','TP2'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_signals TO authenticated;
GRANT ALL ON public.tracked_signals TO service_role;
ALTER TABLE public.tracked_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own signals" ON public.tracked_signals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users add own signals" ON public.tracked_signals FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own signals" ON public.tracked_signals FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own signals" ON public.tracked_signals FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Avatar owners read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Avatar owners upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Avatar owners update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Avatar owners delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);