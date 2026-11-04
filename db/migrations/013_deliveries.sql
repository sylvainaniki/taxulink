CREATE TABLE push_devices(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,token_hash text NOT NULL UNIQUE,encrypted_token text NOT NULL,platform text NOT NULL CHECK(platform IN ('android','ios')),expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notification_preferences(tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL REFERENCES users(id),email_enabled boolean NOT NULL DEFAULT false,PRIMARY KEY(tenant_id,user_id));
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY preference_scope ON notification_preferences USING(tenant_id::text=current_setting('app.tenant_id',true) AND user_id::text=current_setting('app.user_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true) AND user_id::text=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE ON notification_preferences TO taxilink_app;
CREATE TABLE notification_deliveries(id uuid PRIMARY KEY,notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,device_id uuid REFERENCES push_devices(id) ON DELETE CASCADE,channel text NOT NULL CHECK(channel IN ('push','email')),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','receipt','sent','failed')),ticket_id text,attempts integer NOT NULL DEFAULT 0,next_attempt timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX one_device_notification ON notification_deliveries(notification_id,device_id) WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX one_email_notification ON notification_deliveries(notification_id) WHERE channel='email';
REVOKE ALL ON push_devices,notification_deliveries FROM PUBLIC,taxilink_app;
GRANT SELECT,UPDATE,DELETE ON notification_deliveries TO taxilink_identity;
GRANT SELECT,DELETE ON push_devices TO taxilink_identity;
CREATE FUNCTION register_push_device(digest text,encrypted text,p text,session_digest text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE result uuid;BEGIN
 IF NOT actor_has_role(ARRAY['admin','dispatcher','driver']) OR NOT EXISTS(SELECT 1 FROM sessions WHERE token_hash=session_digest AND user_id::text=current_setting('app.user_id') AND expires_at>now()) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 INSERT INTO push_devices(id,tenant_id,user_id,session_hash,token_hash,encrypted_token,platform) VALUES(gen_random_uuid(),current_setting('app.tenant_id')::uuid,current_setting('app.user_id')::uuid,session_digest,digest,encrypted,p)
 ON CONFLICT(token_hash) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,session_hash=EXCLUDED.session_hash,encrypted_token=EXCLUDED.encrypted_token,platform=EXCLUDED.platform,expires_at=now()+interval '7 days' WHERE push_devices.user_id=EXCLUDED.user_id RETURNING id INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;RETURN result;END $$;
CREATE FUNCTION list_push_devices() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'platform',platform,'expires_at',expires_at)),'[]') FROM push_devices WHERE user_id::text=current_setting('app.user_id') AND tenant_id::text=current_setting('app.tenant_id') $$;
CREATE FUNCTION remove_push_device(did uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN DELETE FROM push_devices WHERE id=did AND user_id::text=current_setting('app.user_id') AND tenant_id::text=current_setting('app.tenant_id');END $$;
CREATE FUNCTION queue_notification_delivery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 INSERT INTO notification_deliveries(id,notification_id,device_id,channel) SELECT gen_random_uuid(),NEW.id,d.id,'push' FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash WHERE d.tenant_id=NEW.tenant_id AND d.user_id=NEW.user_id AND d.expires_at>now() AND s.expires_at>now();
 IF EXISTS(SELECT 1 FROM notification_preferences p JOIN users u ON u.id=p.user_id WHERE p.tenant_id=NEW.tenant_id AND p.user_id=NEW.user_id AND p.email_enabled AND u.email_verified_at IS NOT NULL) THEN INSERT INTO notification_deliveries(id,notification_id,channel) VALUES(gen_random_uuid(),NEW.id,'email');END IF;RETURN NEW;END $$;
CREATE TRIGGER notification_delivery AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION queue_notification_delivery();
CREATE FUNCTION delivery_context(jid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE job notification_deliveries;n notifications;device push_devices;address text;BEGIN
 SELECT * INTO job FROM notification_deliveries WHERE id=jid;
 SELECT * INTO n FROM notifications WHERE id=job.notification_id;
 PERFORM 1 FROM memberships WHERE tenant_id=n.tenant_id AND user_id=n.user_id AND active AND role IN ('admin','dispatcher','driver') FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF job.channel='push' THEN
 SELECT * INTO device FROM push_devices WHERE id=job.device_id AND tenant_id=n.tenant_id AND user_id=n.user_id AND expires_at>now() FOR SHARE;
 IF device.id IS NULL THEN RETURN NULL;END IF;
 PERFORM 1 FROM sessions WHERE token_hash=device.session_hash AND user_id=n.user_id AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 ELSE
 SELECT u.email INTO address FROM users u JOIN notification_preferences p ON p.user_id=u.id WHERE u.id=n.user_id AND p.tenant_id=n.tenant_id AND p.email_enabled AND u.email_verified_at IS NOT NULL FOR SHARE OF u,p;
 IF address IS NULL THEN RETURN NULL;END IF;
 END IF;
 RETURN jsonb_build_object('notification_id',n.id,'tenant_id',n.tenant_id,'encrypted_token',device.encrypted_token,'email',address);END $$;
REVOKE ALL ON FUNCTION register_push_device(text,text,text,text),list_push_devices(),remove_push_device(uuid),queue_notification_delivery(),delivery_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_push_device(text,text,text,text),list_push_devices(),remove_push_device(uuid) TO taxilink_app;
GRANT EXECUTE ON FUNCTION delivery_context(uuid) TO taxilink_identity;
