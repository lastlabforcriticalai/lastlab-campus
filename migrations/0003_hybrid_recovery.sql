-- Etapa 3: recuperación autónoma. Aditiva; conserva usuarios, sesiones y progreso.
CREATE TABLE IF NOT EXISTS account_emails (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  verified_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_action_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  claim_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user
  ON email_action_tokens(user_id, purpose, expires_at);
CREATE TABLE IF NOT EXISTS account_backup_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  claim_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_backup_user
  ON account_backup_codes(user_id,used_at);
