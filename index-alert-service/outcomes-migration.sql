-- Additive migration for scheduled background INDEX alert follow-up.
-- Run against the existing tradepulse-telegram D1 database before updating the Worker.
-- No change to existing index_alerts, Telegram subscriber or delivery tables.
CREATE TABLE IF NOT EXISTS index_alert_outcomes (
 alert_id TEXT PRIMARY KEY,
 symbol TEXT NOT NULL,
 strategy TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('BUY','SELL')),
 timeframe TEXT NOT NULL CHECK(timeframe IN ('M15')),
 signal_time INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('OPEN','WON','LOST','EXPIRED')),
 target TEXT CHECK(target IN ('TP1','TP2') OR target IS NULL),
 closed_at INTEGER,
 checked_at INTEGER NOT NULL,
 FOREIGN KEY (alert_id) REFERENCES index_alerts(id)
);
CREATE INDEX IF NOT EXISTS idx_index_outcome_signal ON index_alert_outcomes(signal_time DESC);
CREATE INDEX IF NOT EXISTS idx_index_outcome_unfinished ON index_alert_outcomes(closed_at,signal_time);
