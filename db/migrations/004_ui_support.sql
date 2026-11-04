ALTER TABLE tenants ADD COLUMN network_code text UNIQUE NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
CREATE FUNCTION invite_network_code(gid uuid,code text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE target uuid;BEGIN SELECT id INTO target FROM tenants WHERE network_code=upper(code);IF target IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001';END IF;RETURN network_invitation(gid,target);END $$;
REVOKE ALL ON FUNCTION invite_network_code(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invite_network_code(uuid,text) TO taxilink_app;
CREATE TABLE operational_alerts(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),course_id uuid NOT NULL,kind text NOT NULL,minutes integer,created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz);
ALTER TABLE operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY alert_scope ON operational_alerts USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON operational_alerts TO taxilink_app;
