-- Additive platform audit + tenant email outbox. Reviewed migration/admin connection only.
-- No existing price, subscription, payment, membership or user is modified.
BEGIN;

CREATE TABLE IF NOT EXISTS platform_plan_events (
  id TEXT PRIMARY KEY,
  "actorId" TEXT NOT NULL REFERENCES users(id),
  "planId" TEXT NOT NULL REFERENCES plans(id),
  action TEXT NOT NULL CHECK (action IN ('PLAN_CREATED','PLAN_UPDATED','PLAN_ARCHIVED')),
  details JSONB NOT NULL,
  "notificationPayload" JSONB,
  "audienceOrganisationIds" TEXT[] NOT NULL DEFAULT '{}',
  "fanoutCursor" INTEGER NOT NULL DEFAULT 0,
  "fanoutSkipped" INTEGER NOT NULL DEFAULT 0,
  "fanoutCompletedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("fanoutCursor" BETWEEN 0 AND cardinality("audienceOrganisationIds")),
  CHECK ("fanoutSkipped" BETWEEN 0 AND "fanoutCursor")
);
CREATE INDEX IF NOT EXISTS platform_plan_events_pending_idx ON platform_plan_events ("fanoutCompletedAt","createdAt");

CREATE TABLE IF NOT EXISTS plan_price_emails (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES platform_plan_events(id),
  "organisationId" TEXT NOT NULL REFERENCES organisations(id),
  "recipientUserId" TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','SKIPPED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "claimedAt" TIMESTAMPTZ,
  "claimToken" TEXT,
  "lastErrorCode" TEXT,
  "sentAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("eventId","organisationId","recipientUserId"),
  FOREIGN KEY ("organisationId","recipientUserId") REFERENCES memberships("organisationId","userId")
);
CREATE INDEX IF NOT EXISTS plan_price_emails_due_idx ON plan_price_emails ("organisationId",status,"nextAttemptAt");

CREATE OR REPLACE FUNCTION platform_plan_actor_is_admin() RETURNS BOOLEAN
LANGUAGE SQL STABLE SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id=nullif(current_setting('app.current_user_id',true),'')
    AND "isPlatformAdmin"=true AND "isActive"=true)
$$;
REVOKE ALL ON FUNCTION platform_plan_actor_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_plan_actor_is_admin() TO ascenda_app;

-- Narrow, audited platform operation: snapshot affected org IDs only, never tenant data.
CREATE OR REPLACE FUNCTION plan_price_notice_audience(target_plan TEXT)
RETURNS TABLE ("organisationId" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=nullif(current_setting('app.current_user_id',true),'')
      AND "isPlatformAdmin"=true AND "isActive"=true) THEN
    RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT s."organisationId" FROM public.subscriptions s
    JOIN public.organisations o ON o.id=s."organisationId"
    WHERE s."planId"=target_plan AND s.status IN ('ACTIVE','PAST_DUE') AND o."isActive"=true
    ORDER BY s."organisationId";
END $$;
REVOKE ALL ON FUNCTION plan_price_notice_audience(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plan_price_notice_audience(TEXT) TO ascenda_app;

ALTER TABLE platform_plan_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_plan_admin_read ON platform_plan_events;
CREATE POLICY platform_plan_admin_read ON platform_plan_events FOR SELECT TO ascenda_app
  USING (platform_plan_actor_is_admin());
DROP POLICY IF EXISTS platform_plan_admin_insert ON platform_plan_events;
CREATE POLICY platform_plan_admin_insert ON platform_plan_events FOR INSERT TO ascenda_app
  WITH CHECK (platform_plan_actor_is_admin() AND "actorId"=nullif(current_setting('app.current_user_id',true),''));
REVOKE ALL ON platform_plan_events FROM ascenda_app;
GRANT SELECT,INSERT ON platform_plan_events TO ascenda_app;

ALTER TABLE plan_price_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_price_emails FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON plan_price_emails;
CREATE POLICY tenant_isolation ON plan_price_emails FOR ALL TO ascenda_app
  USING ("organisationId"=current_org_id()) WITH CHECK ("organisationId"=current_org_id());
REVOKE ALL ON plan_price_emails FROM ascenda_app;
GRANT SELECT,INSERT,UPDATE ON plan_price_emails TO ascenda_app;

CREATE OR REPLACE FUNCTION protect_platform_plan_event() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Platform catalogue audit is immutable'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."actorId" IS DISTINCT FROM OLD."actorId"
    OR NEW."planId" IS DISTINCT FROM OLD."planId" OR NEW.action IS DISTINCT FROM OLD.action
    OR NEW.details IS DISTINCT FROM OLD.details OR NEW."notificationPayload" IS DISTINCT FROM OLD."notificationPayload"
    OR NEW."audienceOrganisationIds" IS DISTINCT FROM OLD."audienceOrganisationIds" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."fanoutCursor" < OLD."fanoutCursor" OR NEW."fanoutSkipped" < OLD."fanoutSkipped" THEN
    RAISE EXCEPTION 'Platform catalogue audit payload is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS platform_plan_event_immutable ON platform_plan_events;
CREATE TRIGGER platform_plan_event_immutable BEFORE UPDATE OR DELETE ON platform_plan_events
  FOR EACH ROW EXECUTE FUNCTION protect_platform_plan_event();

CREATE OR REPLACE FUNCTION validate_plan_email_intent() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_plan_events e WHERE e.id=NEW."eventId"
      AND NEW."organisationId"=ANY(e."audienceOrganisationIds") AND NEW.payload=e."notificationPayload") THEN
    RAISE EXCEPTION 'Email must match its snapshotted plan change and organisation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS plan_email_intent_valid ON plan_price_emails;
CREATE TRIGGER plan_email_intent_valid BEFORE INSERT ON plan_price_emails
  FOR EACH ROW EXECUTE FUNCTION validate_plan_email_intent();

CREATE OR REPLACE FUNCTION protect_plan_email_intent() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Plan price email history cannot be deleted'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."organisationId" IS DISTINCT FROM OLD."organisationId" OR NEW."recipientUserId" IS DISTINCT FROM OLD."recipientUserId"
    OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Plan price email intent is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS plan_email_intent_immutable ON plan_price_emails;
CREATE TRIGGER plan_email_intent_immutable BEFORE UPDATE OR DELETE ON plan_price_emails
  FOR EACH ROW EXECUTE FUNCTION protect_plan_email_intent();
COMMIT;
