-- Boolean-only global capacity check: no cross-company identity is exposed.
CREATE FUNCTION pilot_has_capacity(target_user uuid, max_users integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
SELECT EXISTS(SELECT 1 FROM memberships WHERE user_id=target_user AND active)
 OR (SELECT count(DISTINCT user_id) FROM memberships WHERE active)<max_users
$$;
REVOKE ALL ON FUNCTION pilot_has_capacity(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pilot_has_capacity(uuid,integer) TO taxilink_app,taxilink_identity;
