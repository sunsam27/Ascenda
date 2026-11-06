# Documents, policies and announcements

Implements PRD DOC-01/02/03 (P0). DOC-05 e-signatures and statutory retention
automation are separate P1 work; reading acknowledgement is **not** a signature.

## Access and privacy

- Owner: manage all documents. HR: manage documents except uploaded payslips.
- Employee/volunteer: their own linked documents plus policies assigned to them.
- Managers/payroll/finance/viewers: SELF access only; no organisation-wide file
  access is added by the policy workflow.
- General auditors/support readers cannot access ID, payslip or performance
  categories through this document store. The separate payroll payslip flow is
  unchanged. More granular medical/special-category files are not supported and
  must not be uploaded as unrestricted generic files.
- Organisation-wide policy/announcement publication is Owner/HR only. Audience
  filters are validated against the current tenant; recipients are a snapshot
  of active members at publication (filtered targets require active workers).
- Newly invited members are not automatically added to existing snapshots.
- Unlinked files remain admin-only unless explicitly published as policies.

## Files and deletion

Uploads are base64 JSON, decoded size <=8 MB. Supported content: PDF, PNG, JPEG,
UTF-8 plain text. MIME and optional filename extensions must match detected
content. Images are decoded/re-encoded to strip EXIF/GPS/XMP metadata and limited
to 40 million pixels. Office/ZIP/executable/HTML uploads are rejected; export
Office documents to PDF first. No in-browser inline rendering is used.

Original bytes are scanned via ClamAV's INSTREAM protocol before parsing or
storage. Production fails closed if scanning is unconfigured, fails or times
out. Development skips scanning only when no scanner is configured and
`DOCUMENT_SCAN_REQUIRED` is not true. That is not a production security guarantee.

Deletion is audited and first marks a document inaccessible. Blob deletion and
metadata cleanup are retried by the scheduler if storage fails. Published
policies and receipts linked to claims cannot be deleted. Policies are immutable
after publication: upload a new file/version to collect fresh acknowledgements.

## Endpoints (under configured API prefix)

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/documents` | Scoped list / upload |
| GET/PATCH/DELETE | `/documents/:id` | Metadata / name+expiry update / deletion |
| GET | `/documents/:id/download` | Permission-check + audited download; S3 redirects to a five-minute signed URL |
| POST | `/documents/:id/publish` | Publish unlinked policy with optional departmentId/locationId/category filters |
| POST | `/documents/:id/acknowledge` | Acknowledge as the authenticated assigned reader |
| GET | `/documents/:id/acknowledgements` | Admin report with names and acknowledgement times |
| GET/POST | `/documents/announcements` | Recipient-scoped list / publish targeted announcement |

Documents UI includes filename search, category filter, names, expiry dates,
searchable paginated worker selection, policy reports and an Announcements tab.

## Deployment

1. Back up the database and preserve any existing `.storage` directory.
2. Apply the additive schema + RLS migration with the admin connection:
   ```powershell
   # From packages/db (uses the existing migration helper)
   node --env-file=.env scripts/apply-sql.cjs migrations/02_document_workflows.sql
   pnpm exec prisma generate
   ```
   Do not replace this with a destructive reset. Restart API processes to release
   the Prisma engine DLL if generation reports EPERM on Windows.
3. Build shared types, then API/web. Existing file rows are retained; new
   expiry/publication/deletion fields start null.
4. Development can use `STORAGE_DRIVER=local`, optionally `STORAGE_LOCAL_DIR`.
5. Production **must** use `STORAGE_DRIVER=s3`, `STORAGE_BUCKET`, `STORAGE_REGION`
   and optional `STORAGE_ENDPOINT` / `STORAGE_FORCE_PATH_STYLE` for compatible
   services. Use IAM credentials or `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` from
   a secret manager. The adapter requests AES256 server-side encryption.
6. Block public access at bucket level; grant least-privilege object read/write/
   delete to the service. Require HTTPS and encrypted backups. Test an unsigned
   object URL is denied and a signed URL expires. Signed URLs are bearer access
   for up to five minutes; never log/share them or store them in metadata.
7. Configure `DOCUMENT_SCAN_HOST` and optionally `DOCUMENT_SCAN_PORT` (3310).
   Run maintained ClamAV/clamd privately with INSTREAM enabled and a stream size
   limit above 8 MB. Keep signatures current. The ClamAV TCP protocol is not
   encrypted: use a trusted local/private link or secured tunnel, never expose it
   publicly. `DOCUMENT_SCAN_REQUIRED=true` also enforces scanning in development.
8. Configure existing SMTP settings and `WEB_APP_URL` for email links. Existing
   notification delivery is used: in-app persistence plus best-effort email;
   successful SMTP handoff is not a delivery guarantee.
9. Enable `SCHEDULER_ENABLED=true`. At minute 7 of each hour, tenant-scoped
   maintenance retries notifications/cleanup and checks expiry/reminders. Expiry
   notifications are sent once when expired or within 30 days; changing expiry
   resets the marker. Unacknowledged policies are reminded after seven days and
   at weekly intervals thereafter. Each pass is bounded to 100 items per queue.

### Existing local files

S3 keys are prefixed `s3:`; old unprefixed keys still read from the configured
local root. Do not delete that root during deployment. Before horizontal scaling,
scan and migrate existing local files to the private bucket, updating each
tenant's metadata only after verifying the uploaded bytes. Back up and verify a
restore before removing old files. This migration is an operator task, not an
automatic action that could overwrite user documents.

## Delivery guarantees

Publication stores recipient rows in the same transaction. A failed in-app
notification write leaves delivery pending for scheduler retry. Delivery is
at-least-once: a crash between notification insertion and marking the recipient
can duplicate a notification. Email failure is logged by the existing mailer
and does not roll back a published policy/announcement. Run one active scheduler
instance for this release; multi-node exactly-once dispatch is not claimed.

## Verification

```powershell
pnpm --filter @ascenda/types build
pnpm --filter @ascenda/api exec jest --runInBand
pnpm --filter @ascenda/api type-check
pnpm --filter @ascenda/web type-check
node --env-file=packages/db/.env apps/api/test/e2e/documents-rls.cjs
```

The HTTP suite covers real routing/validation/RBAC and file safety with database,
identity and storage doubles. The PostgreSQL test uses actual ascenda_app
credentials and rollback-only synthetic rows to verify own-tenant access,
cross-tenant read/update denial and missing-context denial on all four tables.

Staging acceptance: Owner and HR upload/download a PDF and image; check metadata
stripping; reject an EICAR sample with a real scanner; confirm employee isolation;
publish a policy to a controlled audience and acknowledge it as a recipient;
verify the report and weekly reminder; publish a targeted announcement and check
in-app/email; test expiry and storage cleanup failures. Use an isolated tenant
and controlled mail recipients. Do not broadcast test announcements to real staff.
