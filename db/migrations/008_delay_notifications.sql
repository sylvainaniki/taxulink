REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE FUNCTION bridge_mission_delay(cid uuid,minutes_value integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE job courses;BEGIN
 SELECT * INTO job FROM courses WHERE id=cid AND tenant_id::text=current_setting('app.tenant_id');
 IF job.id IS NULL OR minutes_value NOT BETWEEN 1 AND 240 OR NOT(actor_has_role(ARRAY['admin','dispatcher']) OR EXISTS(SELECT 1 FROM assignments a JOIN drivers d ON d.id=a.driver_id WHERE a.course_id=cid AND d.user_id::text=current_setting('app.user_id') AND actor_has_role(ARRAY['driver']))) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 IF job.source_course_id IS NOT NULL THEN INSERT INTO operational_alerts(id,tenant_id,course_id,kind,minutes) VALUES(gen_random_uuid(),job.source_tenant_id,job.source_course_id,'delay',minutes_value);PERFORM notify_company(job.source_tenant_id,'course.delay',job.source_course_id);PERFORM collaboration_audit(job.source_tenant_id,'course.delay_reported',job.source_course_id);END IF;END $$;
REVOKE ALL ON FUNCTION bridge_mission_delay(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bridge_mission_delay(uuid,integer) TO taxilink_app;
