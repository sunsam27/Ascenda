-- Rollback only for an empty installation. Never discard notification/audit history.
BEGIN;
SET LOCAL row_security=off;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM platform_plan_events) OR EXISTS (SELECT 1 FROM plan_price_emails) THEN
    RAISE EXCEPTION 'Refusing to remove platform audit/email history; use a forward fix';
  END IF;
END $$;
DROP TABLE plan_price_emails;
DROP TABLE platform_plan_events;
DROP FUNCTION protect_plan_email_intent();
DROP FUNCTION validate_plan_email_intent();
DROP FUNCTION protect_platform_plan_event();
DROP FUNCTION plan_price_notice_audience(TEXT);
DROP FUNCTION platform_plan_actor_is_admin();
COMMIT;
