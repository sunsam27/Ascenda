-- Additive Documents release. Apply with the migration/admin connection BEFORE
-- deploying the new API. Run 00_rls_setup.sql on fresh installs after this file.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PERFORMANCE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'TRAINING';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'POLICY_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'POLICY_ACKNOWLEDGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT_PUBLISHED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'POLICY_AVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'POLICY_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT_AVAILABLE';

BEGIN;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "expiresAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "expiryRemindedAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "policyPublishedAt" timestamp(3);

CREATE TABLE IF NOT EXISTS policy_recipients (
  id text PRIMARY KEY, "organisationId" text NOT NULL REFERENCES organisations(id),
  "documentId" text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES users(id),
  "acknowledgedAt" timestamp(3), "remindedAt" timestamp(3), "notifiedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "policy_recipients_documentId_userId_key" ON policy_recipients("documentId", "userId");
CREATE INDEX IF NOT EXISTS "policy_recipients_organisationId_userId_idx" ON policy_recipients("organisationId", "userId");

CREATE TABLE IF NOT EXISTS announcements (
  id text PRIMARY KEY, "organisationId" text NOT NULL REFERENCES organisations(id),
  title text NOT NULL, body text NOT NULL, audience jsonb NOT NULL, "createdBy" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "announcements_organisationId_createdAt_idx" ON announcements("organisationId", "createdAt");

CREATE TABLE IF NOT EXISTS announcement_recipients (
  id text PRIMARY KEY, "organisationId" text NOT NULL REFERENCES organisations(id),
  "announcementId" text NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES users(id), "notifiedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "announcement_recipients_announcementId_userId_key" ON announcement_recipients("announcementId", "userId");
CREATE INDEX IF NOT EXISTS "announcement_recipients_organisationId_userId_idx" ON announcement_recipients("organisationId", "userId");

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['policy_recipients','announcements','announcement_recipients'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO ascenda_app USING ("organisationId" = current_org_id()) WITH CHECK ("organisationId" = current_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ascenda_app', t);
  END LOOP;
END $$;
COMMIT;
