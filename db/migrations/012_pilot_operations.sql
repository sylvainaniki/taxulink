CREATE TABLE company_settings(tenant_id uuid PRIMARY KEY REFERENCES tenants(id),freeze_minutes integer NOT NULL DEFAULT 60 CHECK(freeze_minutes BETWEEN 0 AND 240),ads_rules_enabled boolean NOT NULL DEFAULT false,regulatory_rules_confirmed boolean NOT NULL DEFAULT false,message_retention_days integer NOT NULL DEFAULT 90 CHECK(message_retention_days BETWEEN 7 AND 365),version integer NOT NULL DEFAULT 1);
CREATE TABLE resource_absences(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),driver_id uuid,vehicle_id uuid,start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,reason text NOT NULL CHECK(reason IN ('leave','illness','maintenance','other')),active boolean NOT NULL DEFAULT true,created_by uuid NOT NULL REFERENCES users(id),FOREIGN KEY(tenant_id,driver_id) REFERENCES drivers(tenant_id,id),FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id),CHECK((driver_id IS NULL)<>(vehicle_id IS NULL)),CHECK(end_at>start_at));
CREATE TABLE transfer_requests(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),course_id uuid NOT NULL,requested_by uuid NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(reason IN ('delay','breakdown','illness','other')),course_version integer NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,decided_by uuid REFERENCES users(id),FOREIGN KEY(tenant_id,course_id) REFERENCES courses(tenant_id,id));
CREATE UNIQUE INDEX one_pending_transfer ON transfer_requests(course_id) WHERE status='pending';
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['company_settings','resource_absences','transfer_requests'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY scope ON %I USING(tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK(tenant_id::text=current_setting(''app.tenant_id'',true))',t);
END LOOP;END $$;
GRANT SELECT,INSERT,UPDATE ON company_settings,resource_absences,transfer_requests TO taxilink_app;
ALTER TABLE vehicles ADD COLUMN ads_code text NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN authorized_sectors jsonb NOT NULL DEFAULT '[]';
ALTER TABLE courses ADD COLUMN priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 3);
ALTER TABLE courses ADD COLUMN pickup_latest timestamptz;
ALTER TABLE courses ADD COLUMN operational_notes text NOT NULL DEFAULT '' CHECK(length(operational_notes)<=500);
ALTER TABLE courses ADD COLUMN request_origin text NOT NULL DEFAULT 'other' CHECK(request_origin IN ('phone','web','facility','other'));
ALTER TABLE courses DROP CONSTRAINT courses_status_check;
ALTER TABLE courses ADD CONSTRAINT courses_status_check CHECK(status IN ('draft','unassigned','assigned','confirmed','approaching','onboard','completed','cancelled','failed','no_show'));
CREATE FUNCTION inherit_mission_metadata() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NEW.source_course_id IS NOT NULL THEN SELECT priority,pickup_latest,operational_notes,request_origin INTO NEW.priority,NEW.pickup_latest,NEW.operational_notes,NEW.request_origin FROM courses WHERE id=NEW.source_course_id;END IF;RETURN NEW;END $$;
CREATE TRIGGER mission_metadata BEFORE INSERT ON courses FOR EACH ROW EXECUTE FUNCTION inherit_mission_metadata();
REVOKE ALL ON FUNCTION inherit_mission_metadata() FROM PUBLIC;
CREATE FUNCTION notify_own_company(k text,obj uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT actor_has_role(ARRAY['admin','dispatcher','driver']) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 PERFORM notify_company(current_setting('app.tenant_id')::uuid,k,obj);END $$;
REVOKE ALL ON FUNCTION notify_own_company(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify_own_company(text,uuid) TO taxilink_app;
