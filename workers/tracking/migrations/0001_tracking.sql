CREATE TABLE registrations (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('signal','optout')),
  expires_at TEXT NOT NULL
);
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('signal','optout')),
  occurred_at TEXT NOT NULL,
  category TEXT NOT NULL,
  dedup_key TEXT NOT NULL UNIQUE
);
CREATE INDEX events_occurred_at ON events(occurred_at);
CREATE INDEX events_token_hash ON events(token_hash);
CREATE TABLE nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
