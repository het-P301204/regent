-- API tokens expire, and expired sessions are cheap to purge.
ALTER TABLE api_tokens ADD COLUMN expires_at timestamptz;
UPDATE api_tokens SET expires_at = created_at + interval '90 days' WHERE expires_at IS NULL;
ALTER TABLE api_tokens ALTER COLUMN expires_at SET NOT NULL;
CREATE INDEX api_tokens_user ON api_tokens(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);
