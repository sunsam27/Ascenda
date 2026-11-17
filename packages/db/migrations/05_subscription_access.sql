-- Additive capabilities and finite organisation overrides. No customer plan, expiry or access is changed here.
BEGIN;
CREATE OR REPLACE FUNCTION valid_product_features(flags JSONB) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
 SELECT jsonb_typeof(flags)='object' AND NOT EXISTS(SELECT 1 FROM jsonb_each(flags) f WHERE f.key NOT IN ('people','timeLeave','documents','payroll','payments','analytics') OR jsonb_typeof(f.value)<>'boolean')
$$;
CREATE TABLE IF NOT EXISTS plan_feature_policies (
 "planId" TEXT PRIMARY KEY REFERENCES plans(id),
 "enabledFeatures" JSONB NOT NULL CHECK(valid_product_features("enabledFeatures")),
 "trialDays" INTEGER NOT NULL DEFAULT 0 CHECK("trialDays" BETWEEN 0 AND 365),
 "trialFeatures" JSONB NOT NULL DEFAULT '{}' CHECK(valid_product_features("trialFeatures")),
 "defaultDemoDays" INTEGER NOT NULL DEFAULT 14 CHECK("defaultDemoDays" BETWEEN 1 AND 365),
 "updatedBy" TEXT NOT NULL REFERENCES users(id),"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organisation_access_controls (
 "organisationId" TEXT PRIMARY KEY REFERENCES organisations(id),
 "manualState" TEXT NOT NULL DEFAULT 'AUTO' CHECK("manualState" IN ('AUTO','ACTIVE','SUSPENDED')),
 "manualUntil" TIMESTAMPTZ,
 "demoFeatures" JSONB NOT NULL DEFAULT '{}' CHECK(valid_product_features("demoFeatures")),
 "demoExpiresAt" TIMESTAMPTZ,"trialStartedAt" TIMESTAMPTZ,
 "updatedBy" TEXT NOT NULL REFERENCES users(id),"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK("manualState"<>'ACTIVE' OR "manualUntil" IS NOT NULL),
 CHECK("demoFeatures"='{}'::jsonb OR "demoExpiresAt" IS NOT NULL)
);
ALTER TABLE plan_feature_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_policy_read ON plan_feature_policies;
CREATE POLICY feature_policy_read ON plan_feature_policies FOR SELECT TO ascenda_app USING(true);
DROP POLICY IF EXISTS feature_policy_write ON plan_feature_policies;
CREATE POLICY feature_policy_write ON plan_feature_policies FOR ALL TO ascenda_app USING(platform_plan_actor_is_admin()) WITH CHECK(platform_plan_actor_is_admin() AND "updatedBy"=current_user_id());
GRANT SELECT,INSERT,UPDATE ON plan_feature_policies TO ascenda_app;
REVOKE DELETE,TRUNCATE ON plan_feature_policies FROM ascenda_app;
ALTER TABLE organisation_access_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_access_controls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS access_control_read ON organisation_access_controls;
CREATE POLICY access_control_read ON organisation_access_controls FOR SELECT TO ascenda_app USING("organisationId"=current_org_id());
DROP POLICY IF EXISTS access_control_write ON organisation_access_controls;
CREATE POLICY access_control_write ON organisation_access_controls FOR ALL TO ascenda_app
 USING("organisationId"=current_org_id() AND platform_plan_actor_is_admin())
 WITH CHECK("organisationId"=current_org_id() AND platform_plan_actor_is_admin() AND "updatedBy"=current_user_id());
GRANT SELECT,INSERT,UPDATE ON organisation_access_controls TO ascenda_app;
REVOKE DELETE,TRUNCATE ON organisation_access_controls FROM ascenda_app;

-- Idempotent markers for reminders and lifecycle transitions. No employee, salary or contact data.
CREATE TABLE IF NOT EXISTS subscription_lifecycle_events (
 "id" TEXT PRIMARY KEY,
 "organisationId" TEXT NOT NULL REFERENCES organisations(id),
 "periodEnd" TIMESTAMPTZ NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('REMINDER_14','REMINDER_7','REMINDER_1','PAST_DUE','GRACE_EXPIRED','RESTORED')),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE ("organisationId","periodEnd","kind")
);
ALTER TABLE subscription_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_lifecycle_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subscription_lifecycle_events;
CREATE POLICY tenant_isolation ON subscription_lifecycle_events FOR ALL TO ascenda_app
 USING ("organisationId"=current_org_id()) WITH CHECK ("organisationId"=current_org_id());
REVOKE ALL ON subscription_lifecycle_events FROM ascenda_app;
GRANT SELECT,INSERT ON subscription_lifecycle_events TO ascenda_app;

-- Only billing catalogue/organisation metadata, never HR, salary, bank data or user contact details.
CREATE OR REPLACE FUNCTION subscription_admin_organisations(term TEXT,take_count INTEGER,skip_count INTEGER)
RETURNS TABLE("organisationId" TEXT,"organisationName" TEXT,"planId" TEXT,"planName" TEXT,status TEXT,"currentPeriodEnd" TIMESTAMPTZ,total BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=current_user_id() AND "isPlatformAdmin" AND "isActive") THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501'; END IF;
 IF take_count<1 OR take_count>100 OR skip_count<0 OR length(term)>100 THEN RAISE EXCEPTION 'Invalid pagination'; END IF;
 RETURN QUERY SELECT o.id,o.name,p.id,p.name,s.status::text,s."currentPeriodEnd"::timestamptz,count(*) OVER()
 FROM public.organisations o LEFT JOIN public.subscriptions s ON s."organisationId"=o.id LEFT JOIN public.plans p ON p.id=s."planId"
 WHERE position(lower(term) in lower(o.name))>0 OR term=''
 ORDER BY o.name,o.id LIMIT take_count OFFSET skip_count;
END $$;
REVOKE ALL ON FUNCTION subscription_admin_organisations(TEXT,INTEGER,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscription_admin_organisations(TEXT,INTEGER,INTEGER) TO ascenda_app;

-- Signup-only, once per organisation. No caller-supplied duration or feature flags.
CREATE OR REPLACE FUNCTION initialise_organisation_trial() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE org TEXT:=current_org_id(); actor TEXT:=current_user_id(); p RECORD;
BEGIN
 IF org IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'Organisation and actor required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organisations o JOIN public.memberships m ON m."organisationId"=o.id
   WHERE o.id=org AND o."createdAt">=now()-interval '5 minutes' AND m."userId"=actor AND m.role='OWNER' AND m."isActive") THEN
   RAISE EXCEPTION 'Only new verified workspace provisioning can initialise a trial';
 END IF;
 SELECT f.* INTO p FROM public.subscriptions s JOIN public.plans catalog ON catalog.id=s."planId"
   JOIN public.plan_feature_policies f ON f."planId"=s."planId"
   WHERE s."organisationId"=org AND s.status='ACTIVE' AND (catalog."isFree" OR catalog."priceMinorUnits"=0);
 IF NOT FOUND OR p."trialDays"=0 THEN RETURN; END IF;
 -- FORCE RLS requires a narrowly scoped policy for this definer's insert too.
 INSERT INTO public.organisation_access_controls("organisationId","demoFeatures","demoExpiresAt","trialStartedAt","updatedBy")
 VALUES(org,(SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(p."trialFeatures") WHERE value='true'::jsonb),
   now()+make_interval(days=>p."trialDays"),now(),actor) ON CONFLICT("organisationId") DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION initialise_organisation_trial() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION initialise_organisation_trial() TO ascenda_app;
-- The migration owner may orchestrate only a trial insert matching the current new Owner context.
DO $$ BEGIN
 DROP POLICY IF EXISTS access_trial_provision ON organisation_access_controls;
 EXECUTE format('CREATE POLICY access_trial_provision ON organisation_access_controls FOR INSERT TO %I WITH CHECK ("organisationId"=current_org_id() AND "updatedBy"=current_user_id() AND "manualState"=''AUTO'' AND "manualUntil" IS NULL AND "trialStartedAt" IS NOT NULL)',current_user);
END $$;

-- Automatic expiry of finite grants. No caller-supplied org, duration or feature; context comes from the scheduler.
CREATE OR REPLACE FUNCTION expire_current_organisation_overrides() RETURNS TABLE(reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE org TEXT:=current_org_id();
BEGIN
 IF org IS NULL THEN RAISE EXCEPTION 'Organisation context required' USING ERRCODE='42501'; END IF;
 RETURN QUERY UPDATE public.organisation_access_controls c
   SET "demoFeatures"='{}'::jsonb,"demoExpiresAt"=NULL,"updatedAt"=now()
   WHERE c."organisationId"=org AND c."demoExpiresAt" IS NOT NULL AND c."demoExpiresAt"<=now()
   RETURNING 'DEMO_EXPIRED'::text;
 RETURN QUERY UPDATE public.organisation_access_controls c
   SET "manualState"='AUTO',"manualUntil"=NULL,"updatedAt"=now()
   WHERE c."organisationId"=org AND c."manualState"='ACTIVE' AND c."manualUntil" IS NOT NULL AND c."manualUntil"<=now()
   RETURNING 'MANUAL_ACTIVATION_EXPIRED'::text;
END $$;
REVOKE ALL ON FUNCTION expire_current_organisation_overrides() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_current_organisation_overrides() TO ascenda_app;

-- A server-verified payment, never a browser callback, clears an administrative suspension.
CREATE OR REPLACE FUNCTION restore_current_organisation_access_for_payment() RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE org TEXT:=current_org_id(); changed INTEGER;
BEGIN
 IF org IS NULL THEN RAISE EXCEPTION 'Organisation context required' USING ERRCODE='42501'; END IF;
 UPDATE public.organisation_access_controls c
   SET "manualState"='AUTO',"manualUntil"=NULL,"updatedAt"=now()
   WHERE c."organisationId"=org AND c."manualState"='SUSPENDED';
 GET DIAGNOSTICS changed = ROW_COUNT;
 RETURN changed > 0;
END $$;
REVOKE ALL ON FUNCTION restore_current_organisation_access_for_payment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restore_current_organisation_access_for_payment() TO ascenda_app;
COMMIT;
