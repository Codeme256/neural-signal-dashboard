-- Additive storage for index pullback watch plans.
-- Separate from issued index_alerts so unfilled plans cannot inflate historical win/loss stats.
CREATE TABLE IF NOT EXISTS index_pullback_plans (
 id TEXT PRIMARY KEY,
 symbol TEXT NOT NULL,deriv_symbol TEXT NOT NULL,strategy TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('BUY','SELL')),
 candle_time INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 entry REAL NOT NULL,stop_loss REAL NOT NULL,tp1 REAL NOT NULL,tp2 REAL NOT NULL,
 rr REAL NOT NULL,quality_score INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','CONFIRMED','INVALIDATED','EXPIRED')),
 reason TEXT,
 checked_at INTEGER,
 FOREIGN KEY(id) REFERENCES index_alerts(id)
);
CREATE INDEX IF NOT EXISTS idx_index_pullback_pending ON index_pullback_plans(status,created_at);
