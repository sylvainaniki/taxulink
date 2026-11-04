ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
GRANT UPDATE(email_verified_at) ON users TO taxilink_identity;
CREATE TABLE account_links (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK(purpose IN ('reset','verify')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE(user_id,purpose)
);
CREATE TABLE account_mail (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL REFERENCES account_links(token_hash) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE INDEX account_mail_pending ON account_mail(next_attempt) WHERE sent_at IS NULL;
REVOKE ALL ON account_links,account_mail FROM PUBLIC,taxilink_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON account_links,account_mail TO taxilink_identity;
CREATE OR REPLACE FUNCTION authenticate_request(session_hash text,chosen_tenant uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE s sessions;account_email text;verified boolean;member_role text;BEGIN
 SELECT * INTO s FROM sessions WHERE token_hash=session_hash AND expires_at>now() FOR SHARE;
 IF s.user_id IS NULL THEN RETURN NULL;END IF;
 SELECT role INTO member_role FROM memberships WHERE user_id=s.user_id AND tenant_id=chosen_tenant AND active FOR SHARE;
 SELECT email,email_verified_at IS NOT NULL INTO account_email,verified FROM users WHERE id=s.user_id;
 RETURN jsonb_build_object('user_id',s.user_id,'csrf',s.csrf,'email',account_email,'role',member_role,'email_verified',verified);
 END $$;
