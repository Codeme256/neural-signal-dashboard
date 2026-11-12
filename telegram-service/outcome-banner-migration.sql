-- Applied to the existing tradepulse-telegram D1 database.
-- Separate from news_alert_delivery and telegram_alert_delivery.
-- Exactly one final price-based outcome card per recipient and outcome key.
CREATE TABLE IF NOT EXISTS telegram_outcome_delivery (
 recipient TEXT NOT NULL,
 alert_id TEXT NOT NULL,
 outcome_key TEXT NOT NULL,
 sent_at TEXT NOT NULL,
 PRIMARY KEY(recipient,alert_id,outcome_key)
);
