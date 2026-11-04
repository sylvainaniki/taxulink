CREATE TABLE collaboration_lock (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO collaboration_lock VALUES(1);
ALTER TABLE courses ADD COLUMN source_course_id uuid REFERENCES courses(id);
ALTER TABLE courses ADD COLUMN source_tenant_id uuid REFERENCES tenants(id);
ALTER TABLE courses ADD COLUMN recurrence_key text;
CREATE UNIQUE INDEX course_recurrence_unique ON courses(tenant_id,recurrence_key) WHERE recurrence_key IS NOT NULL;
CREATE TABLE group_invitations(id uuid PRIMARY KEY,group_id uuid REFERENCES partner_groups(id),target_tenant_id uuid REFERENCES tenants(id),expires_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),UNIQUE(group_id,target_tenant_id));
CREATE TABLE offers(id uuid PRIMARY KEY,owner_tenant_id uuid NOT NULL REFERENCES tenants(id),course_id uuid NOT NULL REFERENCES courses(id),group_id uuid NOT NULL REFERENCES partner_groups(id),status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','reserved','accepted','withdrawn','expired','rejected')),expires_at timestamptz NOT NULL,version integer NOT NULL DEFAULT 1,claimant_tenant_id uuid REFERENCES tenants(id),claimant_user_id uuid REFERENCES users(id),driver_id uuid,vehicle_id uuid,reserved_until timestamptz,execution_course_id uuid REFERENCES courses(id),source_version integer NOT NULL);
CREATE TABLE offer_targets(offer_id uuid REFERENCES offers(id),group_id uuid REFERENCES partner_groups(id),PRIMARY KEY(offer_id,group_id));
CREATE UNIQUE INDEX one_open_offer_per_course ON offers(course_id) WHERE status IN ('published','reserved');
CREATE TABLE resource_holds(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),offer_id uuid UNIQUE NOT NULL REFERENCES offers(id),driver_id uuid NOT NULL,vehicle_id uuid NOT NULL,origin text NOT NULL REFERENCES locations(id),destination text NOT NULL REFERENCES locations(id),start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,FOREIGN KEY(tenant_id,driver_id) REFERENCES drivers(tenant_id,id),FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id));
CREATE TABLE notifications(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid REFERENCES users(id),kind text NOT NULL,object_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz);
CREATE TABLE messages(id uuid PRIMARY KEY,group_id uuid NOT NULL REFERENCES partner_groups(id),tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL REFERENCES users(id),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE planning_proposals(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,snapshot text NOT NULL,proposal jsonb NOT NULL,status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','applied')));
CREATE TABLE contacts(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),name text NOT NULL,kind text NOT NULL CHECK(kind IN ('customer','facility','partner')),phone text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1);
CREATE TABLE recurrences(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),template jsonb NOT NULL,start_date date NOT NULL,end_date date NOT NULL,weekdays jsonb NOT NULL,exceptions jsonb NOT NULL DEFAULT '[]',active boolean NOT NULL DEFAULT true);
CREATE TABLE driver_shifts(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),driver_id uuid NOT NULL,shift_start timestamptz NOT NULL,shift_end timestamptz NOT NULL,start_location text NOT NULL REFERENCES locations(id),end_location text NOT NULL REFERENCES locations(id),breaks jsonb NOT NULL DEFAULT '[]',FOREIGN KEY(tenant_id,driver_id) REFERENCES drivers(tenant_id,id),CHECK(shift_end>shift_start));
GRANT SELECT,INSERT,UPDATE ON contacts,recurrences,driver_shifts,planning_proposals,notifications TO taxilink_app;
GRANT SELECT ON resource_holds TO taxilink_app;
GRANT SELECT,UPDATE ON memberships TO taxilink_app;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_scope ON memberships USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['contacts','recurrences','driver_shifts','planning_proposals','notifications','resource_holds'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK(tenant_id::text=current_setting(''app.tenant_id'',true))',t);
 END LOOP;
END $$;
CREATE FUNCTION actor_has_role(required_roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id::text=current_setting('app.tenant_id',true) AND user_id::text=current_setting('app.user_id',true) AND active AND role=ANY(required_roles)) $$;
CREATE FUNCTION current_group_member(g uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id=g AND tenant_id::text=current_setting('app.tenant_id',true)) AND actor_has_role(ARRAY['admin','dispatcher','driver']) $$;
CREATE FUNCTION offer_audience(oid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM offer_targets t WHERE t.offer_id=oid AND current_group_member(t.group_id)) $$;
CREATE FUNCTION collaboration_audit(t uuid,a text,obj uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ INSERT INTO audit_events VALUES(gen_random_uuid(),t,current_setting('app.user_id')::uuid,a,obj,now()) $$;
CREATE FUNCTION notify_company(t uuid,k text,obj uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ INSERT INTO notifications(id,tenant_id,user_id,kind,object_id) SELECT gen_random_uuid(),t,user_id,k,obj FROM memberships WHERE tenant_id=t AND active AND role IN ('admin','dispatcher') $$;
CREATE FUNCTION list_network_offers() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(x ORDER BY x.pickup_at),'[]') FROM (
 SELECT o.id,(SELECT t.group_id FROM offer_targets t WHERE t.offer_id=o.id AND current_group_member(t.group_id) ORDER BY t.group_id LIMIT 1) AS group_id,l.label AS origin_label,r.label AS destination_label,c.pickup_at,c.appointment_at,c.passengers,c.accessible,
 CASE WHEN o.status IN ('published','reserved') AND (o.expires_at<=now() OR (o.status='reserved' AND o.reserved_until<=now())) THEN 'expired' ELSE o.status END AS status,
 o.expires_at,o.reserved_until,o.version,o.owner_tenant_id::text=current_setting('app.tenant_id') AS own,o.claimant_tenant_id::text=current_setting('app.tenant_id') AS claimed_by_me
 FROM offers o JOIN courses c ON c.id=o.course_id JOIN locations l ON l.id=c.origin JOIN locations r ON r.id=c.destination
 WHERE actor_has_role(ARRAY['admin','dispatcher','driver']) AND (offer_audience(o.id) OR o.owner_tenant_id::text=current_setting('app.tenant_id')) AND (o.status IN ('published','reserved') OR o.owner_tenant_id::text=current_setting('app.tenant_id') OR o.claimant_tenant_id::text=current_setting('app.tenant_id')) LIMIT 500) x $$;
CREATE FUNCTION publish_offer(cid uuid,gid uuid,until_at timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE c courses; oid uuid:=gen_random_uuid();
 BEGIN
 IF NOT actor_has_role(ARRAY['admin','dispatcher']) OR NOT current_group_member(gid) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001'; END IF;
 SELECT * INTO c FROM courses WHERE id=cid AND tenant_id::text=current_setting('app.tenant_id') FOR UPDATE;
 IF c.id IS NULL OR c.source_course_id IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF c.status<>'unassigned' OR until_at<=now() OR until_at>now()+interval '7 days' THEN RAISE EXCEPTION 'OFFER_NOT_PUBLISHABLE' USING ERRCODE='P0001'; END IF;
 UPDATE offers SET status='expired',version=version+1 WHERE course_id=cid AND status IN ('published','reserved') AND (expires_at<=now() OR reserved_until<=now());
 INSERT INTO offers(id,owner_tenant_id,course_id,group_id,expires_at,source_version) VALUES(oid,c.tenant_id,c.id,gid,until_at,c.version);
 INSERT INTO offer_targets VALUES(oid,gid);PERFORM collaboration_audit(c.tenant_id,'offer.published',oid);RETURN oid;
 END $$;
CREATE FUNCTION offer_claim_context(oid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE o offers; c courses;
 BEGIN
 SELECT * INTO o FROM offers WHERE id=oid FOR UPDATE;
 IF o.id IS NULL OR NOT offer_audience(o.id) OR o.owner_tenant_id::text=current_setting('app.tenant_id') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF o.status<>'published' OR o.expires_at<=now() THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 SELECT * INTO c FROM courses WHERE id=o.course_id;
 IF c.status<>'unassigned' OR c.version<>o.source_version THEN RAISE EXCEPTION 'PLAN_STALE' USING ERRCODE='P0001'; END IF;
 RETURN jsonb_build_object('origin',c.origin,'destination',c.destination,'pickup_at',c.pickup_at,'appointment_at',c.appointment_at,'arrival_buffer',c.arrival_buffer,'passengers',c.passengers,'accessible',c.accessible);
 END $$;
CREATE FUNCTION reserve_offer(oid uuid,did uuid,vid uuid,start_time timestamptz,end_time timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE o offers; c courses; tid uuid:=current_setting('app.tenant_id')::uuid; until_at timestamptz;
 BEGIN
 PERFORM offer_claim_context(oid);
 SELECT * INTO o FROM offers WHERE id=oid FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM drivers WHERE id=did AND tenant_id=tid AND active AND (actor_has_role(ARRAY['admin','dispatcher']) OR user_id::text=current_setting('app.user_id'))) OR NOT EXISTS(SELECT 1 FROM vehicles WHERE id=vid AND tenant_id=tid AND active) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001'; END IF;
 SELECT * INTO c FROM courses WHERE id=o.course_id;until_at:=LEAST(o.expires_at,now()+interval '10 minutes');
 UPDATE offers SET status='reserved',claimant_tenant_id=tid,claimant_user_id=current_setting('app.user_id')::uuid,driver_id=did,vehicle_id=vid,reserved_until=until_at,version=version+1 WHERE id=oid;
 INSERT INTO resource_holds VALUES(gen_random_uuid(),tid,oid,did,vid,c.origin,c.destination,start_time,end_time,until_at);
 PERFORM collaboration_audit(o.owner_tenant_id,'offer.reserved',oid);PERFORM collaboration_audit(tid,'offer.reserved',oid);PERFORM notify_company(o.owner_tenant_id,'offer.reserved',oid);
 RETURN jsonb_build_object('id',oid,'status','reserved','reserved_until',until_at);
 END $$;
CREATE FUNCTION decide_offer(oid uuid,decision text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE o offers; c courses; h resource_holds; execution_id uuid:=gen_random_uuid();
 BEGIN
 SELECT * INTO o FROM offers WHERE id=oid AND owner_tenant_id::text=current_setting('app.tenant_id') FOR UPDATE;
 IF o.id IS NULL OR NOT actor_has_role(ARRAY['admin','dispatcher']) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF decision='withdraw' AND o.status IN ('published','reserved') THEN
 UPDATE offers SET status='withdrawn',version=version+1 WHERE id=oid;DELETE FROM resource_holds WHERE offer_id=oid;PERFORM collaboration_audit(o.owner_tenant_id,'offer.withdrawn',oid);IF o.claimant_tenant_id IS NOT NULL THEN PERFORM collaboration_audit(o.claimant_tenant_id,'offer.withdrawn',oid);PERFORM notify_company(o.claimant_tenant_id,'offer.withdrawn',oid);END IF;RETURN jsonb_build_object('id',oid,'status','withdrawn');END IF;
 IF o.status<>'reserved' OR o.expires_at<=now() OR o.reserved_until<=now() THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF decision='reject' THEN PERFORM collaboration_audit(o.owner_tenant_id,'offer.rejected',oid);PERFORM collaboration_audit(o.claimant_tenant_id,'offer.rejected',oid);UPDATE offers SET status='rejected',version=version+1 WHERE id=oid;DELETE FROM resource_holds WHERE offer_id=oid;PERFORM notify_company(o.claimant_tenant_id,'offer.rejected',oid);RETURN jsonb_build_object('id',oid,'status','rejected');END IF;
 IF decision<>'approve' THEN RAISE EXCEPTION 'INVALID_DECISION' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM offer_targets targets JOIN group_members gm ON gm.group_id=targets.group_id WHERE targets.offer_id=o.id AND gm.tenant_id=o.claimant_tenant_id) OR NOT EXISTS(SELECT 1 FROM memberships WHERE user_id=o.claimant_user_id AND tenant_id=o.claimant_tenant_id AND active) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 SELECT * INTO c FROM courses WHERE id=o.course_id FOR UPDATE;SELECT * INTO h FROM resource_holds WHERE offer_id=oid;
 IF c.status<>'unassigned' OR c.version<>o.source_version OR h.id IS NULL OR h.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM routes WHERE origin=c.origin AND destination=c.destination AND expires_at>now()) THEN RAISE EXCEPTION 'PLAN_STALE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM drivers d WHERE d.id=o.driver_id AND d.tenant_id=o.claimant_tenant_id AND d.active AND (d.user_id IS NULL OR EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=d.tenant_id AND m.user_id=d.user_id AND m.active AND m.role IN ('admin','dispatcher','driver')))) OR NOT EXISTS(SELECT 1 FROM vehicles v WHERE v.id=o.vehicle_id AND v.tenant_id=o.claimant_tenant_id AND v.active AND v.seats>=c.passengers AND (NOT c.accessible OR v.accessible)) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 INSERT INTO courses(id,tenant_id,reference,origin,destination,pickup_at,appointment_at,arrival_buffer,passengers,accessible,status,source_course_id,source_tenant_id,passenger_name,passenger_phone) VALUES(execution_id,o.claimant_tenant_id,c.reference,c.origin,c.destination,c.pickup_at,c.appointment_at,c.arrival_buffer,c.passengers,c.accessible,'assigned',c.id,c.tenant_id,c.passenger_name,c.passenger_phone);
 INSERT INTO assignments VALUES(gen_random_uuid(),o.claimant_tenant_id,execution_id,o.driver_id,o.vehicle_id,h.start_at,h.end_at);
 UPDATE courses SET status='assigned',version=version+1 WHERE id=c.id;
 UPDATE offers SET status='accepted',execution_course_id=execution_id,version=version+1 WHERE id=oid;DELETE FROM resource_holds WHERE offer_id=oid;
 INSERT INTO notifications(id,tenant_id,user_id,kind,object_id) SELECT gen_random_uuid(),o.claimant_tenant_id,user_id,'course.assigned',execution_id FROM drivers WHERE id=o.driver_id AND user_id IS NOT NULL;
 PERFORM collaboration_audit(o.owner_tenant_id,'offer.accepted',oid);PERFORM collaboration_audit(o.claimant_tenant_id,'offer.accepted',oid);PERFORM notify_company(o.claimant_tenant_id,'offer.accepted',oid);
 RETURN jsonb_build_object('id',oid,'status','accepted');
 END $$;
CREATE FUNCTION add_offer_target(oid uuid,gid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT actor_has_role(ARRAY['admin','dispatcher']) OR NOT current_group_member(gid) OR NOT EXISTS(SELECT 1 FROM offers WHERE id=oid AND owner_tenant_id::text=current_setting('app.tenant_id') AND status='published') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 INSERT INTO offer_targets VALUES(oid,gid) ON CONFLICT DO NOTHING;END $$;
CREATE FUNCTION course_has_live_offer(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM offers WHERE course_id=cid AND owner_tenant_id::text=current_setting('app.tenant_id') AND status IN ('published','reserved') AND expires_at>now() AND (status='published' OR reserved_until>now())) $$;
CREATE FUNCTION sync_execution_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN IF NEW.source_course_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN UPDATE courses SET status=NEW.status,version=version+1 WHERE id=NEW.source_course_id;PERFORM collaboration_audit(NEW.source_tenant_id,'course.'||NEW.status,NEW.source_course_id);END IF;RETURN NEW;END $$;
CREATE TRIGGER execution_status AFTER UPDATE OF status ON courses FOR EACH ROW EXECUTE FUNCTION sync_execution_status();
CREATE FUNCTION network_invitation(gid uuid,target uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE result uuid:=gen_random_uuid();BEGIN
 IF NOT actor_has_role(ARRAY['admin']) OR NOT EXISTS(SELECT 1 FROM partner_groups WHERE id=gid AND owner_tenant_id::text=current_setting('app.tenant_id')) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 INSERT INTO group_invitations(id,group_id,target_tenant_id,expires_at) VALUES(result,gid,target,now()+interval '48 hours') ON CONFLICT(group_id,target_tenant_id) DO UPDATE SET id=EXCLUDED.id,expires_at=EXCLUDED.expires_at,status='pending';PERFORM notify_company(target,'group.invited',result);RETURN result;END $$;
CREATE FUNCTION list_network_invitations() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT COALESCE(jsonb_agg(x),'[]') FROM (SELECT i.id,i.group_id,g.name,i.status,i.expires_at FROM group_invitations i JOIN partner_groups g ON g.id=i.group_id WHERE i.target_tenant_id::text=current_setting('app.tenant_id') AND actor_has_role(ARRAY['admin'])) x $$;
CREATE FUNCTION accept_network_invitation(iid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE i group_invitations;BEGIN
 SELECT * INTO i FROM group_invitations WHERE id=iid AND target_tenant_id::text=current_setting('app.tenant_id') FOR UPDATE;
 IF i.id IS NULL OR NOT actor_has_role(ARRAY['admin']) OR i.status<>'pending' OR i.expires_at<=now() THEN RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE='P0001';END IF;
 INSERT INTO group_members VALUES(i.group_id,i.target_tenant_id) ON CONFLICT DO NOTHING;UPDATE group_invitations SET status='accepted' WHERE id=i.id;PERFORM collaboration_audit(i.target_tenant_id,'group.joined',i.group_id);END $$;
CREATE FUNCTION list_network_members(gid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT COALESCE(jsonb_agg(x),'[]') FROM (SELECT m.tenant_id,t.name FROM group_members m JOIN tenants t ON t.id=m.tenant_id WHERE m.group_id=gid AND current_group_member(gid)) x $$;
CREATE FUNCTION remove_network_member(gid uuid,tid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT actor_has_role(ARRAY['admin']) OR NOT EXISTS(SELECT 1 FROM partner_groups WHERE id=gid AND owner_tenant_id::text=current_setting('app.tenant_id') AND owner_tenant_id<>tid) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 DELETE FROM group_members WHERE group_id=gid AND tenant_id=tid;PERFORM collaboration_audit(current_setting('app.tenant_id')::uuid,'group.member_removed',gid);END $$;
CREATE FUNCTION network_messages(gid uuid,after_time timestamptz) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE result jsonb;BEGIN
 IF NOT current_group_member(gid) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001';END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at),'[]') INTO result FROM (SELECT m.id,m.group_id,m.body,m.created_at,t.name AS company,m.user_id::text=current_setting('app.user_id') AS own FROM messages m JOIN tenants t ON t.id=m.tenant_id WHERE m.group_id=gid AND m.created_at>after_time ORDER BY m.created_at DESC,m.id DESC LIMIT 200) x;RETURN result;END $$;
CREATE FUNCTION send_network_message(gid uuid,body_text text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE result uuid:=gen_random_uuid();BEGIN
 IF NOT current_group_member(gid) OR length(body_text) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 INSERT INTO messages(id,group_id,tenant_id,user_id,body) VALUES(result,gid,current_setting('app.tenant_id')::uuid,current_setting('app.user_id')::uuid,body_text);RETURN result;END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_offer_target(uuid,uuid),actor_has_role(text[]),current_group_member(uuid),list_network_offers(),publish_offer(uuid,uuid,timestamptz),offer_claim_context(uuid),reserve_offer(uuid,uuid,uuid,timestamptz,timestamptz),decide_offer(uuid,text),course_has_live_offer(uuid),network_invitation(uuid,uuid),list_network_invitations(),accept_network_invitation(uuid),list_network_members(uuid),remove_network_member(uuid,uuid),network_messages(uuid,timestamptz),send_network_message(uuid,text) TO taxilink_app;
CREATE TABLE assignment_history(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),course_id uuid NOT NULL,details jsonb NOT NULL,changed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY history_scope ON assignment_history USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT ON assignment_history TO taxilink_app;
GRANT DELETE ON assignments TO taxilink_app;
CREATE FUNCTION company_members() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT COALESCE(jsonb_agg(x),'[]') FROM (SELECT m.user_id,u.email,m.role,m.active FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id::text=current_setting('app.tenant_id') AND actor_has_role(ARRAY['admin'])) x $$;
CREATE FUNCTION shared_source(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM offers WHERE course_id=cid AND status='accepted' AND owner_tenant_id::text=current_setting('app.tenant_id')) $$;
CREATE FUNCTION cancel_shared_course(cid uuid,expected_version integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE c courses;o offers;BEGIN
 SELECT * INTO c FROM courses WHERE id=cid AND tenant_id::text=current_setting('app.tenant_id') FOR UPDATE;
 IF c.id IS NULL OR NOT actor_has_role(ARRAY['admin','dispatcher']) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF c.version<>expected_version THEN RAISE EXCEPTION 'PLAN_STALE' USING ERRCODE='P0001';END IF;
 IF c.status NOT IN ('assigned','approaching') THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='P0001';END IF;
 SELECT * INTO o FROM offers WHERE course_id=cid AND status='accepted';
 UPDATE courses SET status='cancelled',version=version+1 WHERE id=o.execution_course_id;
 PERFORM collaboration_audit(c.tenant_id,'shared_course.cancelled',cid);PERFORM collaboration_audit(o.claimant_tenant_id,'shared_course.cancelled',o.execution_course_id);PERFORM notify_company(o.claimant_tenant_id,'course.cancelled',o.execution_course_id);END $$;
REVOKE ALL ON FUNCTION company_members(),shared_source(uuid),cancel_shared_course(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_members(),shared_source(uuid),cancel_shared_course(uuid,integer) TO taxilink_app;
