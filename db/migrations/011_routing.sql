ALTER TABLE locations ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE locations ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE locations ADD COLUMN sector text NOT NULL DEFAULT 'Secteur fictif';
ALTER TABLE locations ADD COLUMN latitude double precision CHECK(latitude BETWEEN -90 AND 90);
ALTER TABLE locations ADD COLUMN longitude double precision CHECK(longitude BETWEEN -180 AND 180);
ALTER TABLE locations ADD COLUMN validated_at timestamptz;
ALTER TABLE routes ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE routes ADD COLUMN distance_m integer CHECK(distance_m>=0);
ALTER TABLE routes ADD COLUMN calculated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE routing_usage(tenant_id uuid REFERENCES tenants(id),day date NOT NULL DEFAULT current_date,calls integer NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,day));
ALTER TABLE routing_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY routing_usage_scope ON routing_usage USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON routing_usage TO taxilink_app;
CREATE FUNCTION location_visible(lid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM locations l WHERE l.id=lid AND (l.tenant_id IS NULL OR
 (l.tenant_id::text=current_setting('app.tenant_id',true) AND actor_has_role(ARRAY['admin','dispatcher'])) OR
 EXISTS(SELECT 1 FROM courses c LEFT JOIN assignments a ON a.course_id=c.id LEFT JOIN drivers d ON d.id=a.driver_id WHERE c.tenant_id::text=current_setting('app.tenant_id',true) AND (c.origin=lid OR c.destination=lid) AND c.status NOT IN ('cancelled') AND (actor_has_role(ARRAY['admin','dispatcher']) OR (actor_has_role(ARRAY['driver']) AND d.user_id::text=current_setting('app.user_id',true))))));
 $$;
CREATE FUNCTION routing_location_allowed(lid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT location_visible(lid) OR EXISTS(SELECT 1 FROM offers o JOIN courses c ON c.id=o.course_id WHERE (c.origin=lid OR c.destination=lid) AND o.status IN ('published','reserved') AND o.expires_at>now() AND (o.reserved_until IS NULL OR o.reserved_until>now()) AND offer_audience(o.id));
 $$;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_read ON locations FOR SELECT USING(location_visible(id));
CREATE POLICY locations_write ON locations FOR INSERT WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true) AND actor_has_role(ARRAY['admin','dispatcher']));
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY routes_read ON routes FOR SELECT USING(tenant_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY routes_write ON routes FOR INSERT WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true) AND routing_location_allowed(origin) AND routing_location_allowed(destination));
CREATE POLICY routes_update ON routes FOR UPDATE USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
GRANT INSERT ON locations TO taxilink_app;
GRANT INSERT,UPDATE ON routes TO taxilink_app;
CREATE FUNCTION get_route_minutes(a text,b text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT minutes FROM routes WHERE origin=a AND destination=b AND expires_at>now() AND routing_location_allowed(a) AND routing_location_allowed(b);
 $$;
CREATE FUNCTION routing_coordinates(ids text[]) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'latitude',latitude,'longitude',longitude,'validated_at',validated_at)),'[]') FROM locations WHERE id=ANY(ids) AND routing_location_allowed(id);
 $$;
CREATE FUNCTION check_location_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ DECLARE ids text[];lid text;BEGIN
 IF current_user<>'taxilink_app' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='courses' THEN ids:=ARRAY[NEW.origin,NEW.destination];ELSIF TG_TABLE_NAME='vehicles' THEN ids:=ARRAY[NEW.start_location];ELSE ids:=ARRAY[NEW.start_location,NEW.end_location]; END IF;
 FOREACH lid IN ARRAY ids LOOP
  IF NOT EXISTS(SELECT 1 FROM locations WHERE id=lid AND (tenant_id IS NULL OR tenant_id=NEW.tenant_id)) THEN RAISE EXCEPTION 'LOCATION_DENIED' USING ERRCODE='P0001';END IF;
 END LOOP;RETURN NEW;END $$;
CREATE TRIGGER course_locations BEFORE INSERT OR UPDATE OF origin,destination ON courses FOR EACH ROW EXECUTE FUNCTION check_location_scope();
CREATE TRIGGER driver_locations BEFORE INSERT OR UPDATE OF start_location,end_location ON drivers FOR EACH ROW EXECUTE FUNCTION check_location_scope();
CREATE TRIGGER shift_locations BEFORE INSERT OR UPDATE OF start_location,end_location ON driver_shifts FOR EACH ROW EXECUTE FUNCTION check_location_scope();
CREATE TRIGGER vehicle_locations BEFORE INSERT OR UPDATE OF start_location ON vehicles FOR EACH ROW EXECUTE FUNCTION check_location_scope();
REVOKE ALL ON FUNCTION location_visible(text),routing_location_allowed(text),get_route_minutes(text,text),routing_coordinates(text[]),check_location_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION location_visible(text),routing_location_allowed(text),get_route_minutes(text,text),routing_coordinates(text[]),check_location_scope() TO taxilink_app;
CREATE OR REPLACE FUNCTION list_network_offers() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(x ORDER BY x.pickup_at),'[]') FROM (
 SELECT o.id,(SELECT t.group_id FROM offer_targets t WHERE t.offer_id=o.id AND current_group_member(t.group_id) ORDER BY t.group_id LIMIT 1) AS group_id,CASE WHEN l.tenant_id IS NULL THEN l.label ELSE l.sector END AS origin_label,CASE WHEN r.tenant_id IS NULL THEN r.label ELSE r.sector END AS destination_label,c.pickup_at,c.appointment_at,c.passengers,c.accessible,
 CASE WHEN o.status IN ('published','reserved') AND (o.expires_at<=now() OR (o.status='reserved' AND o.reserved_until<=now())) THEN 'expired' ELSE o.status END AS status,
 o.expires_at,o.reserved_until,o.version,o.owner_tenant_id::text=current_setting('app.tenant_id') AS own,o.claimant_tenant_id::text=current_setting('app.tenant_id') AS claimed_by_me
 FROM offers o JOIN courses c ON c.id=o.course_id JOIN locations l ON l.id=c.origin JOIN locations r ON r.id=c.destination
 WHERE actor_has_role(ARRAY['admin','dispatcher','driver']) AND (offer_audience(o.id) OR o.owner_tenant_id::text=current_setting('app.tenant_id')) AND (o.status IN ('published','reserved') OR o.owner_tenant_id::text=current_setting('app.tenant_id') OR o.claimant_tenant_id::text=current_setting('app.tenant_id')) LIMIT 500) x $$;
