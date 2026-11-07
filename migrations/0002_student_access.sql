-- Esquema aditivo: NO modifica usuarios, sesiones ni progreso existentes.
CREATE TABLE IF NOT EXISTS course_invites (
  token_hash TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_by TEXT,
  redeemed_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_course_invites_status
  ON course_invites(expires_at, redeemed_at, revoked_at);

CREATE TABLE IF NOT EXISTS password_recovery_codes (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  claim_id TEXT,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_recovery_user
  ON password_recovery_codes(user_id, expires_at);
