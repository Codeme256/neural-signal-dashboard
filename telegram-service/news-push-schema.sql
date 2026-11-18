CREATE TABLE IF NOT EXISTS news_push_key (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news_push_devices (
  endpoint TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_push_devices_owner ON news_push_devices(owner);

CREATE TABLE IF NOT EXISTS news_push_delivery (
  event_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, stage, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_news_push_delivery_sent_at ON news_push_delivery(sent_at);
