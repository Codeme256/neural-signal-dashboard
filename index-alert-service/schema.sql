-- Additive migration for the existing TradePulse D1 database.
-- Does not alter telegram_subscriptions or telegram_alert_delivery.
CREATE TABLE IF NOT EXISTS index_alerts (
 id TEXT PRIMARY KEY,
 symbol TEXT NOT NULL,
 deriv_symbol TEXT NOT NULL,
 strategy TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('BUY', 'SELL')),
 timeframe TEXT NOT NULL CHECK(timeframe IN ('M15', 'H1')),
 candle_time INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER,
 entry REAL NOT NULL,
 stop_loss REAL NOT NULL,
 tp1 REAL NOT NULL,
 tp2 REAL NOT NULL,
 rr REAL NOT NULL,
 quality_score INTEGER NOT NULL CHECK(quality_score BETWEEN 0 AND 100),
 data_source TEXT NOT NULL DEFAULT 'Deriv',
 notification_status TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE INDEX IF NOT EXISTS idx_index_alerts_recent ON index_alerts(created_at DESC);
