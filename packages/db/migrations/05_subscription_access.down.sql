BEGIN;
SET LOCAL row_security=off;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM organisation_access_controls) OR EXISTS(SELECT 1 FROM plan_feature_policies) THEN
  RAISE EXCEPTION 'Refusing to delete configured subscription policies/history; use a forward fix';
 END IF;
END $$;
DROP FUNCTION restore_current_organisation_access_for_payment();
DROP FUNCTION expire_current_organisation_overrides();
DROP FUNCTION initialise_organisation_trial();
DROP FUNCTION subscription_admin_organisations(TEXT,INTEGER,INTEGER);
DROP TABLE subscription_lifecycle_events;
DROP TABLE organisation_access_controls;
DROP TABLE plan_feature_policies;
DROP FUNCTION valid_product_features(JSONB);
COMMIT;
