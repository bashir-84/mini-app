CREATE TABLE bot_chats (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  chat_id TEXT NOT NULL
);
CREATE TABLE teacher_link_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL
);
CREATE TABLE message_outbox (
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  recipient TEXT NOT NULL CHECK(recipient IN ('student','teacher')),
  chat_id TEXT,
  text TEXT NOT NULL,
  sent_at TEXT,
  retry_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (round_id,user_id,recipient)
);
CREATE TABLE bot_config (
  id INTEGER PRIMARY KEY CHECK(id=1),
  webhook_secret TEXT NOT NULL
);
