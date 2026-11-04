CREATE TABLE conversations(id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('course','direct')),course_id uuid UNIQUE REFERENCES courses(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE conversation_members(conversation_id uuid REFERENCES conversations(id),tenant_id uuid REFERENCES tenants(id),user_id uuid REFERENCES users(id),PRIMARY KEY(conversation_id,tenant_id,user_id));
CREATE TABLE private_messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id),tenant_id uuid REFERENCES tenants(id),user_id uuid REFERENCES users(id),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION conversation_access(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT actor_has_role(ARRAY['admin','dispatcher','driver']) AND EXISTS(SELECT 1 FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id WHERE cm.conversation_id=cid AND cm.tenant_id::text=current_setting('app.tenant_id') AND cm.user_id::text=current_setting('app.user_id') AND (c.kind='direct' OR EXISTS(SELECT 1 FROM courses co LEFT JOIN assignments a ON a.course_id=co.id LEFT JOIN drivers d ON d.id=a.driver_id WHERE (co.id=c.course_id OR co.source_course_id=c.course_id) AND co.tenant_id=cm.tenant_id AND (actor_has_role(ARRAY['admin','dispatcher']) OR d.user_id=cm.user_id)))) $$;
CREATE FUNCTION start_conversation(chat_kind text,course uuid,other_user uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE cid uuid:=gen_random_uuid();t uuid:=current_setting('app.tenant_id')::uuid;u uuid:=current_setting('app.user_id')::uuid;job courses;canonical uuid;
 BEGIN
 IF NOT actor_has_role(ARRAY['admin','dispatcher','driver']) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='P0001';END IF;
 IF chat_kind='direct' THEN
 IF other_user=u OR NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=t AND user_id=other_user AND active AND role IN ('admin','dispatcher','driver')) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001';END IF;
 INSERT INTO conversations(id,kind) VALUES(cid,'direct');INSERT INTO conversation_members VALUES(cid,t,u),(cid,t,other_user);RETURN cid;
 END IF;
 IF chat_kind<>'course' THEN RAISE EXCEPTION 'INVALID_DECISION' USING ERRCODE='P0001';END IF;
 SELECT * INTO job FROM courses WHERE id=course AND tenant_id=t;
 IF job.id IS NULL OR (NOT actor_has_role(ARRAY['admin','dispatcher']) AND NOT EXISTS(SELECT 1 FROM assignments a JOIN drivers d ON d.id=a.driver_id WHERE a.course_id=job.id AND d.user_id=u)) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001';END IF;
 canonical:=COALESCE(job.source_course_id,job.id);SELECT id INTO cid FROM conversations WHERE course_id=canonical;
 IF cid IS NULL THEN cid:=gen_random_uuid();INSERT INTO conversations(id,kind,course_id) VALUES(cid,'course',canonical);END IF;
 INSERT INTO conversation_members SELECT cid,m.tenant_id,m.user_id FROM memberships m WHERE m.active AND m.role IN ('admin','dispatcher') AND EXISTS(SELECT 1 FROM courses co WHERE (co.id=canonical OR co.source_course_id=canonical) AND co.tenant_id=m.tenant_id) ON CONFLICT DO NOTHING;
 INSERT INTO conversation_members SELECT cid,d.tenant_id,d.user_id FROM courses co JOIN assignments a ON a.course_id=co.id JOIN drivers d ON d.id=a.driver_id WHERE (co.id=canonical OR co.source_course_id=canonical) AND d.user_id IS NOT NULL ON CONFLICT DO NOTHING;
 RETURN cid;
 END $$;
CREATE FUNCTION list_conversations() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT COALESCE(jsonb_agg(x),'[]') FROM (SELECT c.id,c.kind,c.created_at,CASE WHEN c.kind='course' THEN 'Conversation de mission' ELSE 'Conversation directe' END AS label FROM conversations c WHERE conversation_access(c.id) ORDER BY c.created_at DESC LIMIT 100) x $$;
CREATE FUNCTION company_people() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT COALESCE(jsonb_agg(x),'[]') FROM (SELECT m.user_id,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id::text=current_setting('app.tenant_id') AND m.active AND m.role IN ('admin','dispatcher','driver') AND actor_has_role(ARRAY['admin','dispatcher','driver'])) x $$;
CREATE FUNCTION read_private_messages(cid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE result jsonb;BEGIN
 IF NOT conversation_access(cid) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001';END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at),'[]') INTO result FROM (SELECT m.id,m.body,m.created_at,t.name AS company,m.user_id::text=current_setting('app.user_id') AS own FROM private_messages m JOIN tenants t ON t.id=m.tenant_id WHERE m.conversation_id=cid ORDER BY m.created_at DESC,m.id DESC LIMIT 200) x;RETURN result;END $$;
CREATE FUNCTION send_private_message(cid uuid,body_text text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE result uuid:=gen_random_uuid();BEGIN
 IF NOT conversation_access(cid) OR length(body_text) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001';END IF;
 INSERT INTO private_messages(id,conversation_id,tenant_id,user_id,body) VALUES(result,cid,current_setting('app.tenant_id')::uuid,current_setting('app.user_id')::uuid,body_text);
 INSERT INTO notifications(id,tenant_id,user_id,kind,object_id) SELECT gen_random_uuid(),cm.tenant_id,cm.user_id,'message.received',cid FROM conversation_members cm JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id WHERE cm.conversation_id=cid AND m.active AND cm.user_id::text<>current_setting('app.user_id');RETURN result;END $$;
REVOKE ALL ON FUNCTION conversation_access(uuid),start_conversation(text,uuid,uuid),list_conversations(),company_people(),read_private_messages(uuid),send_private_message(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_conversation(text,uuid,uuid),list_conversations(),company_people(),read_private_messages(uuid),send_private_message(uuid,text) TO taxilink_app;
