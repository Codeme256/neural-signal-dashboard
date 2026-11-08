-- TradePulse index scan audit — deploy via the actual project's managed DB migration tool.
-- No trade execution. Distinguish analysis from outcomes and enforce per-user isolation.
CREATE TABLE IF NOT EXISTS public.scan_sessions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  started_at bigint NOT NULL,
  finished_at bigint NOT NULL,
  timeframe text NOT NULL,
  section text NOT NULL DEFAULT 'index',
  analysis_count integer NOT NULL DEFAULT 0,
  data_source text NOT NULL DEFAULT 'Deriv',
  sample_type text NOT NULL DEFAULT 'LIVE_SCAN',
  PRIMARY KEY(user_id,id),
  CONSTRAINT scan_session_count_chk CHECK(analysis_count >= 0),
  CONSTRAINT scan_session_sample_type_chk CHECK(sample_type IN ('LIVE_SCAN','HISTORICAL_BACKTEST'))
);

CREATE TABLE IF NOT EXISTS public.scan_results (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL,
  deriv_symbol text NOT NULL,
  symbol text NOT NULL,
  category text NOT NULL,
  timeframe text NOT NULL,
  strategy text,
  direction text NOT NULL,
  candle_time bigint,
  scanned_at bigint NOT NULL,
  entry double precision,
  stop_loss double precision,
  tp1 double precision,
  tp2 double precision,
  indicator_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  market_regime text,
  data_status text NOT NULL,
  error_reason text,
  opportunity_id text,
  verified_outcome text,
  resolved_at bigint,
  PRIMARY KEY(user_id,scan_id,deriv_symbol,timeframe),
  FOREIGN KEY(user_id,scan_id) REFERENCES public.scan_sessions(user_id,id) ON DELETE CASCADE,
  CONSTRAINT scan_result_action_chk CHECK(direction IN ('BUY','SELL','WAIT','NO TRADE','UNAVAILABLE')),
  CONSTRAINT scan_result_status_chk CHECK(data_status IN ('FRESH','STALE','UNAVAILABLE','CLOSED')),
  CONSTRAINT scan_result_outcome_chk CHECK(verified_outcome IS NULL OR verified_outcome IN ('WON','LOST','EXPIRED')),
  CONSTRAINT scan_result_not_executed_chk CHECK(resolved_at IS NULL OR verified_outcome IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS scan_result_unique_opportunity
  ON public.scan_results(user_id,opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scan_results_user_time
  ON public.scan_results(user_id,scanned_at DESC);
CREATE INDEX IF NOT EXISTS scan_results_strategy
  ON public.scan_results(user_id,strategy,timeframe,deriv_symbol);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.scan_sessions,public.scan_results TO authenticated;
GRANT ALL ON public.scan_sessions,public.scan_results TO service_role;
ALTER TABLE public.scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Scan sessions read own" ON public.scan_sessions FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY "Scan sessions create own" ON public.scan_sessions FOR INSERT TO authenticated WITH CHECK(auth.uid()=user_id);
CREATE POLICY "Scan sessions delete own" ON public.scan_sessions FOR DELETE TO authenticated USING(auth.uid()=user_id);
CREATE POLICY "Scan results read own" ON public.scan_results FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY "Scan results create own" ON public.scan_results FOR INSERT TO authenticated WITH CHECK(auth.uid()=user_id);
-- Outcome status is only updated through a trusted verification process, not arbitrary client writes.
