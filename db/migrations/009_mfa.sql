ALTER TABLE users ADD COLUMN mfa_secret text;
ALTER TABLE users ADD COLUMN mfa_pending text;
ALTER TABLE users ADD COLUMN mfa_pending_until timestamptz;
ALTER TABLE users ADD COLUMN mfa_last_counter bigint;
ALTER TABLE users ADD COLUMN recovery_hashes jsonb NOT NULL DEFAULT '[]';
GRANT UPDATE(mfa_secret,mfa_pending,mfa_pending_until,mfa_last_counter,recovery_hashes) ON users TO taxilink_identity;
