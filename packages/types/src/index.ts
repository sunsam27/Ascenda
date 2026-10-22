// ─────────────────────────────────────────────────────────────────────────────
// ASCENDA — Shared Types
// Single source of truth for DTOs and domain types used by both web and api
// ─────────────────────────────────────────────────────────────────────────────

// ── Enums ────────────────────────────────────────────────────────────────────

export enum OrganisationType {
  CHURCH = 'CHURCH',
  SME = 'SME',
  NGO = 'NGO',
  SCHOOL = 'SCHOOL',
  OTHER = 'OTHER',
}

// ── Billing / plans ──────────────────────────────────────────────────────────

export enum BillingPeriod {
  MONTHLY = 'MONTHLY',
  ANNUALLY = 'ANNUALLY',
}

export enum SubscriptionStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum PaymentProvider {
  NONE = 'NONE',
  PAYSTACK = 'PAYSTACK',
  FLUTTERWAVE = 'FLUTTERWAVE',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ABANDONED = 'ABANDONED',
  REVERSED = 'REVERSED',
}

export enum RegistrationStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum WorkerCategory {
  EMPLOYEE = 'EMPLOYEE',
  MINISTER = 'MINISTER',
  VOLUNTEER = 'VOLUNTEER',
  CONTRACTOR = 'CONTRACTOR',
  INTERN = 'INTERN',
}

export enum EmploymentType {
  FULL_TIME = 'FULL_TIME',
  PART_TIME = 'PART_TIME',
  CASUAL = 'CASUAL',
  FIXED_TERM = 'FIXED_TERM',
}

export enum WorkerStatus {
  ACTIVE = 'ACTIVE',
  ON_LEAVE = 'ON_LEAVE',
  SUSPENDED = 'SUSPENDED',
  TERMINATED = 'TERMINATED',
  DRAFT = 'DRAFT',
}

// ── RBAC ─────────────────────────────────────────────────────────────────────

/** Predefined roles — can be extended per org, but these are the base set */
export enum SystemRole {
  OWNER = 'OWNER',
  HR_ADMINISTRATOR = 'HR_ADMINISTRATOR',
  PAYROLL_ADMINISTRATOR = 'PAYROLL_ADMINISTRATOR',
  FINANCE_APPROVER = 'FINANCE_APPROVER',
  MANAGER = 'MANAGER',
  EMPLOYEE_SELF = 'EMPLOYEE_SELF',
  VOLUNTEER_SELF = 'VOLUNTEER_SELF',
  AUDITOR = 'AUDITOR',
  VIEWER = 'VIEWER',
  /** Ascenda platform support — time-limited, audited, read-only by default */
  SUPPORT_READ_ONLY = 'SUPPORT_READ_ONLY',
}

/** Scope of a permission: what data can this role see? */
export enum PermissionScope {
  SELF = 'self',
  TEAM = 'team',
  DEPARTMENT = 'department',
  LOCATION = 'location',
  ORGANISATION = 'organisation',
}

/** Resource:Action permission model */
export interface Permission {
  resource: string;
  action: 'read' | 'create' | 'update' | 'delete' | 'approve' | 'export';
  scope: PermissionScope;
}

// ── Leave ─────────────────────────────────────────────────────────────────────

export enum LeaveStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum LeaveTypeCategory {
  ANNUAL = 'ANNUAL',
  SICK = 'SICK',
  MATERNITY = 'MATERNITY',
  PATERNITY = 'PATERNITY',
  COMPASSIONATE = 'COMPASSIONATE',
  STUDY = 'STUDY',
  UNPAID = 'UNPAID',
  CUSTOM = 'CUSTOM',
}

// ── Attendance ────────────────────────────────────────────────────────────────

export enum AttendanceSource {
  MANUAL = 'MANUAL',
  CLOCK_IN_OUT = 'CLOCK_IN_OUT',
  IMPORT = 'IMPORT',
}

/** PRD ATT-02 attendance statuses. */
export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LATE = 'LATE',
  REMOTE = 'REMOTE',
  ON_LEAVE = 'ON_LEAVE',
  HALF_DAY = 'HALF_DAY',
  OFF_DAY = 'OFF_DAY',
}

// ── Payroll ───────────────────────────────────────────────────────────────────

export enum PayrollRunStatus {
  DRAFT = 'DRAFT',
  IN_REVIEW = 'IN_REVIEW',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  PROCESSED = 'PROCESSED',
  LOCKED = 'LOCKED',
}

/** PAY-11: status of one step in a run's approval chain. */
export enum PayrollRunApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum PayFrequency {
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
}

export enum PayrollItemType {
  BASIC_SALARY = 'BASIC_SALARY',
  ALLOWANCE = 'ALLOWANCE',
  BONUS = 'BONUS',
  DEDUCTION = 'DEDUCTION',
  EMPLOYER_PENSION = 'EMPLOYER_PENSION',
  EMPLOYEE_PENSION = 'EMPLOYEE_PENSION',
  TAX = 'TAX',
  REIMBURSEMENT = 'REIMBURSEMENT',
  STIPEND = 'STIPEND',
}

/** How a recurring pay item's amount is derived (PRD PAY-02 / PAY-03). */
export enum PayItemCalculation {
  FIXED = 'FIXED',
  PERCENTAGE = 'PERCENTAGE',
}

// ── Payments ──────────────────────────────────────────────────────────────────

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

// ── Payslips (PAY-13) ─────────────────────────────────────────────────────────

/** One printable pay line frozen onto a payslip. */
export interface PayslipLine {
  type: PayrollItemType;
  description: string;
  /** Positive for earnings, negative for deductions (integer minor units). */
  amountMinorUnits: number;
}

export interface Payslip extends TenantEntity {
  payrollRunId: string;
  workerId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  grossMinorUnits: number;
  deductionsMinorUnits: number;
  employerCostsMinorUnits: number;
  netMinorUnits: number;
  lines: PayslipLine[];
  availableAt: string;
}

export interface PayslipListQuery extends PaginatedQuery {
  payrollRunId?: string;
  workerId?: string;
}

// ── Year-end statements & remittance schedules (PAY-16) ───────────────────────

/** One rolled-up pay line on a year-end statement (annual totals per type). */
export interface YearEndLine {
  type: PayrollItemType;
  description: string;
  /** Positive for earnings, negative for deductions (integer minor units). */
  amountMinorUnits: number;
}

/**
 * A frozen annual statement for one worker. Totals equal the sum of the
 * worker's payslips inside the tax-year window. Immutable once generated.
 */
export interface YearEndStatement extends TenantEntity {
  workerId: string;
  /** Tax-year label, e.g. "2026" or "2026/2027". */
  taxYearLabel: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  grossMinorUnits: number;
  deductionsMinorUnits: number;
  employerCostsMinorUnits: number;
  netMinorUnits: number;
  lines: YearEndLine[];
  /** Number of payslips the statement aggregates. */
  payslipCount: number;
  /** LOC-03: false if any contributing pack was not professionally validated. */
  validatedByProfessional: boolean;
}

/** One statutory rule's annual totals for the remittance schedule. */
export interface RemittanceLine {
  code: string;
  label: string;
  itemType: StatutoryItemType;
  side: StatutoryRuleSide;
  /** Summed across workers, as a positive magnitude (integer minor units). */
  amountMinorUnits: number;
}

/**
 * An annual statutory remittance schedule: what the org owes each statutory
 * scheme for the tax year, split by employee vs employer share. A reporting
 * artefact only — Ascenda never moves funds (PRD boundary).
 */
export interface RemittanceSchedule {
  taxYearLabel: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  employeeTotalMinorUnits: number;
  employerTotalMinorUnits: number;
  lines: RemittanceLine[];
  /** LOC-03: false if any contributing pack was not professionally validated. */
  validatedByProfessional: boolean;
}

export interface YearEndListQuery extends PaginatedQuery {
  workerId?: string;
  taxYearLabel?: string;
}

export interface GenerateYearEndDto {
  /** The tax year to generate statements for (the year the window starts in). */
  year: number;
}

export interface RemittanceQuery {
  year: number;
}

export interface YearEndListMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Reimbursements (PAY-14) ───────────────────────────────────────────────────

export enum ExpenseClaimStatus {
  SUBMITTED = 'SUBMITTED',
  MANAGER_APPROVED = 'MANAGER_APPROVED',
  MANAGER_REJECTED = 'MANAGER_REJECTED',
  FINANCE_APPROVED = 'FINANCE_APPROVED',
  FINANCE_REJECTED = 'FINANCE_REJECTED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export enum ExpenseClaimApprovalRole {
  MANAGER = 'MANAGER',
  FINANCE_APPROVER = 'FINANCE_APPROVER',
}

export interface ExpenseClaim extends TenantEntity {
  workerId: string;
  type: string;
  description: string;
  /** Positive integer minor units. */
  amountMinorUnits: number;
  currency: string;
  receiptUrl?: string;
  status: ExpenseClaimStatus;
  managerDecidedById?: string;
  managerDecidedAt?: string;
  managerComment?: string;
  financeDecidedById?: string;
  financeDecidedAt?: string;
  financeComment?: string;
  paidPayrollRunId?: string;
  paidAt?: string;
  createdBy: string;
}

export interface CreateExpenseClaimDto {
  workerId: string;
  type: string;
  description: string;
  /** Positive integer minor units. */
  amountMinorUnits: number;
  receiptUrl?: string | null;
}

export interface DecideExpenseClaimDto {
  decision: 'APPROVE' | 'REJECT';
  comment?: string | null;
}

export interface ExpenseClaimListQuery extends PaginatedQuery {
  workerId?: string;
  status?: ExpenseClaimStatus;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ESCALATED = 'ESCALATED',
  DELEGATED = 'DELEGATED',
}

// ── Documents ─────────────────────────────────────────────────────────────────

export enum DocumentType {
  CONTRACT = 'CONTRACT',
  ID_DOCUMENT = 'ID_DOCUMENT',
  PAYSLIP = 'PAYSLIP',
  OFFER_LETTER = 'OFFER_LETTER',
  POLICY = 'POLICY',
  CERTIFICATION = 'CERTIFICATION',
  OTHER = 'OTHER',
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export enum AuditAction {
  LOGIN = 'LOGIN',
  LOGIN_FAILED = 'LOGIN_FAILED',
  LOGOUT = 'LOGOUT',
  MFA_CHANGED = 'MFA_CHANGED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  ROLE_CHANGED = 'ROLE_CHANGED',
  PERMISSION_CHANGED = 'PERMISSION_CHANGED',
  ORGANISATION_UPDATED = 'ORGANISATION_UPDATED',
  WORKER_CREATED = 'WORKER_CREATED',
  WORKER_UPDATED = 'WORKER_UPDATED',
  WORKER_DELETED = 'WORKER_DELETED',
  COMPENSATION_CHANGED = 'COMPENSATION_CHANGED',
  BANK_DETAILS_CHANGED = 'BANK_DETAILS_CHANGED',
  LEAVE_TYPE_CHANGED = 'LEAVE_TYPE_CHANGED',
  LEAVE_REQUEST_CREATED = 'LEAVE_REQUEST_CREATED',
  LEAVE_REQUEST_APPROVED = 'LEAVE_REQUEST_APPROVED',
  LEAVE_REQUEST_REJECTED = 'LEAVE_REQUEST_REJECTED',
  LEAVE_REQUEST_CANCELLED = 'LEAVE_REQUEST_CANCELLED',
  LEAVE_REQUEST_ESCALATED = 'LEAVE_REQUEST_ESCALATED',
  LEAVE_BALANCE_ADJUSTED = 'LEAVE_BALANCE_ADJUSTED',
  ATTENDANCE_RECORDED = 'ATTENDANCE_RECORDED',
  HOLIDAY_CALENDAR_CHANGED = 'HOLIDAY_CALENDAR_CHANGED',
  PAYROLL_RUN_CREATED = 'PAYROLL_RUN_CREATED',
  PAYROLL_RUN_SUBMITTED = 'PAYROLL_RUN_SUBMITTED',
  PAYROLL_RUN_APPROVED = 'PAYROLL_RUN_APPROVED',
  PAYROLL_RUN_REJECTED = 'PAYROLL_RUN_REJECTED',
  PAYROLL_RUN_PROCESSED = 'PAYROLL_RUN_PROCESSED',
  PAYROLL_RUN_LOCKED = 'PAYROLL_RUN_LOCKED',
  PAYROLL_RUN_REVERSED = 'PAYROLL_RUN_REVERSED',
  PAYROLL_ITEM_OVERRIDDEN = 'PAYROLL_ITEM_OVERRIDDEN',
  PAY_CALENDAR_CHANGED = 'PAY_CALENDAR_CHANGED',
  RECURRING_PAY_ITEM_CHANGED = 'RECURRING_PAY_ITEM_CHANGED',
  PAYROLL_CONFIG_CHANGED = 'PAYROLL_CONFIG_CHANGED',
  PAYMENT_APPROVED = 'PAYMENT_APPROVED',
  PAYMENT_STATUS_CHANGED = 'PAYMENT_STATUS_CHANGED',
  PAYSLIP_GENERATED = 'PAYSLIP_GENERATED',
  PAYSLIP_ACCESSED = 'PAYSLIP_ACCESSED',
  PAYMENTS_EXPORTED = 'PAYMENTS_EXPORTED',
  STATUTORY_RULE_PACK_CHANGED = 'STATUTORY_RULE_PACK_CHANGED',
  EXPENSE_CLAIM_CREATED = 'EXPENSE_CLAIM_CREATED',
  EXPENSE_CLAIM_STATUS_CHANGED = 'EXPENSE_CLAIM_STATUS_CHANGED',
  EXPORT_CREATED = 'EXPORT_CREATED',
  RESTRICTED_FIELD_ACCESSED = 'RESTRICTED_FIELD_ACCESSED',
  SUPPORT_ACCESS = 'SUPPORT_ACCESS',
  DOCUMENT_UPLOADED = 'DOCUMENT_UPLOADED',
  DOCUMENT_ACCESSED = 'DOCUMENT_ACCESSED',
  ACCESS_REQUEST_APPROVED = 'ACCESS_REQUEST_APPROVED',
  ACCESS_REQUEST_REJECTED = 'ACCESS_REQUEST_REJECTED',
  INVITATION_SENT = 'INVITATION_SENT',
  PASSWORD_SET = 'PASSWORD_SET',
  REGISTRATION_STARTED = 'REGISTRATION_STARTED',
  REGISTRATION_VERIFIED = 'REGISTRATION_VERIFIED',
  WORKSPACE_CREATED = 'WORKSPACE_CREATED',
  SUBSCRIPTION_ACTIVATED = 'SUBSCRIPTION_ACTIVATED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  PLAN_CREATED = 'PLAN_CREATED',
  PLAN_UPDATED = 'PLAN_UPDATED',
  PLAN_ARCHIVED = 'PLAN_ARCHIVED',
}

// ── Core Domain Interfaces ────────────────────────────────────────────────────

export interface BaseEntity {
  id: string; // UUID
  createdAt: string; // ISO 8601 UTC
  updatedAt: string;
}

export interface TenantEntity extends BaseEntity {
  organisationId: string;
}

export interface Organisation extends BaseEntity {
  name: string;
  slug: string;
  type: OrganisationType;
  country: string; // ISO 3166-1 alpha-2
  currency: string; // ISO 4217
  timezone: string; // IANA
  /** Terminology overrides: e.g. "Department" → "Ministry", "Employee" → "Pastor" */
  terminology: Record<string, string>;
  logoUrl?: string;
  isActive: boolean;
  /** Work-schedule defaults (PRD ATT-02). workDays = ISO weekdays Mon=1..Sun=7. */
  workDays?: number[];
  workDayStart?: string; // "HH:mm"
  workDayEnd?: string; // "HH:mm"
  lateGraceMinutes?: number;
}

/** Fields an owner may change on their own organisation (Phase 1 setup flow). */
export interface UpdateOrganisationDto {
  name?: string;
  type?: OrganisationType;
  country?: string; // ISO 3166-1 alpha-2
  currency?: string; // ISO 4217
  timezone?: string; // IANA
  terminology?: Record<string, string>;
  logoUrl?: string | null;
  workDays?: number[];
  workDayStart?: string; // "HH:mm"
  workDayEnd?: string; // "HH:mm"
  lateGraceMinutes?: number;
}

export interface User extends BaseEntity {
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  isMfaEnabled: boolean;
  memberships: Membership[];
}

export interface Membership extends TenantEntity {
  userId: string;
  role: SystemRole;
  isActive: boolean;
}

export interface Worker extends TenantEntity {
  userId?: string; // linked if they have a login
  employeeNumber: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  email: string;
  phone?: string;
  category: WorkerCategory;
  employmentType: EmploymentType;
  status: WorkerStatus;
  jobTitle: string;
  departmentId?: string;
  locationId?: string;
  managerId?: string;
  startDate: string;
  endDate?: string;
  createdBy: string;
}

/** Directory list/detail row — worker plus resolved department/location names. */
export interface WorkerSummary extends TenantEntity {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  email: string;
  phone?: string;
  category: WorkerCategory;
  employmentType: EmploymentType;
  status: WorkerStatus;
  jobTitle: string;
  departmentId?: string;
  departmentName?: string;
  locationId?: string;
  locationName?: string;
  managerId?: string;
  startDate: string;
  endDate?: string;
  dateOfBirth?: string;
  gender?: string;
  /** True once the worker has been linked to a workspace login (PPL invite). */
  hasLogin: boolean;
  /** The linked platform user id, when the worker has a workspace login. */
  userId?: string;
  /**
   * Workspace-invitation state: NONE (never invited), PENDING (invited but has
   * not set a password yet), or ACCEPTED (has an active login).
   */
  inviteStatus: WorkerInviteStatus;
}

/** Workspace-invitation lifecycle for a worker. */
export enum WorkerInviteStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
}

/** Result of sending a workspace login invitation to a worker. */
export interface WorkerInviteResult {
  workerId: string;
  userId: string;
  email: string;
  /** False when SMTP is unconfigured and the invite was logged instead. */
  emailSent: boolean;
}

/**
 * A worker's bank account (self-service or org-managed). The account number is
 * stored encrypted at rest and only ever surfaced masked.
 */
export interface BankAccount extends TenantEntity {
  workerId: string;
  bankName: string;
  bankCode: string;
  /** Display-only masked account number, e.g. "****1234". */
  accountNumberMasked: string;
  accountName: string;
  isVerified: boolean;
  isPrimary: boolean;
  createdBy: string;
}

/** A detected Nigerian bank (code + display name). */
export interface DetectedBank {
  bankCode: string;
  bankName: string;
}

/** Create/update payload for a worker bank account (employee or org). */
export interface CreateBankAccountDto {
  accountNumber: string;
  accountName: string;
  /** Optional — the server auto-detects from the account number when omitted. */
  bankName?: string;
  bankCode?: string;
  isPrimary?: boolean;
}

export interface UpdateBankAccountDto {
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  bankCode?: string;
  isPrimary?: boolean;
  /** Org-only: mark the account verified after manual review. */
  isVerified?: boolean;
}

/**
 * The signed-in employee's self-service profile: the worker record the
 * organisation entered (read-only to the employee).
 */
export interface SelfWorkerProfile {
  worker: WorkerSummary;
}


export interface WorkerListQuery extends PaginatedQuery {
  status?: WorkerStatus;
  category?: WorkerCategory;
  departmentId?: string;
  locationId?: string;
}

/**
 * One line of a worker's pay structure (PRD PAY-01). Amounts are integer
 * minor units. The server is authoritative: the record's gross is the sum of
 * its components.
 */
export interface PayComponent {
  /** Stable machine code, e.g. `BASE`, `HOUSING`, `TRANSPORT`, `OTHER`. */
  code: string;
  label: string;
  amountMinorUnits: number;
}

/** Create an effective-dated compensation record. Amount is integer minor units. */
export interface CreateCompensationDto {
  /**
   * Pay-structure components (PRD PAY-01). When provided the server computes
   * `grossAmountMinorUnits` as their sum and rejects a disagreeing gross.
   * When omitted, a single `BASE` component is synthesised.
   */
  components?: PayComponent[];
  /** Integer minor currency units (e.g. kobo for NGN) */
  grossAmountMinorUnits?: number;
  /** ISO 4217 code; defaults to the organisation currency server-side. */
  currency?: string;
  payFrequency: PayFrequency;
  validFrom: string;
  /** Open-ended when omitted. */
  validTo?: string | null;
  notes?: string | null;
}

export type UpdateCompensationDto = Partial<CreateCompensationDto>;

/** Per-row outcome after validating an imported CSV row. */
export type WorkerImportRowStatus = 'valid' | 'duplicate' | 'error';

export interface WorkerImportPreviewRow {
  /** 1-based spreadsheet row (header is row 1). */
  rowNumber: number;
  status: WorkerImportRowStatus;
  errors: string[];
  employeeNumber?: string;
  name?: string;
  email?: string;
  category?: string;
  jobTitle?: string;
  department?: string;
  location?: string;
  startDate?: string;
}

export interface WorkerImportPreview {
  summary: {
    total: number;
    valid: number;
    duplicate: number;
    error: number;
  };
  rows: WorkerImportPreviewRow[];
}

export interface WorkerImportResult {
  created: number;
  skipped: number;
  total: number;
}

/** Integer minor units only — no floats, ever */
export interface CompensationRecord extends TenantEntity {
  workerId: string;
  /** Amount in minor currency units (e.g., kobo for NGN) */
  grossAmountMinorUnits: number;
  /**
   * Pay-structure components (PRD PAY-01); their sum is the gross. Legacy rows
   * may have none — a read synthesises a single BASE component.
   */
  components?: PayComponent[];
  currency: string;
  payFrequency: PayFrequency;
  validFrom: string;
  validTo?: string;
  notes?: string;
  createdBy: string;
}

/** Bank account number stored encrypted; show masked last 4 only */
export interface BankAccount extends TenantEntity {
  workerId: string;
  bankName: string;
  bankCode: string;
  /** Masked display value e.g. "****1234" */
  accountNumberMasked: string;
  accountName: string;
  isVerified: boolean;
  isPrimary: boolean;
}

export interface Department extends TenantEntity {
  name: string;
  parentId?: string;
  managerId?: string;
}

export interface Location extends TenantEntity {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  isActive: boolean;
  /** Per-location work-schedule overrides (ATT-02). Empty/null = inherit org. */
  workDays?: number[];
  workDayStart?: string;
  workDayEnd?: string;
  lateGraceMinutes?: number;
}

/** How a leave type's entitlement is earned over the leave year (LVE-05). */
export enum LeaveAccrualMethod {
  NONE = 'NONE',
  ANNUAL_UPFRONT = 'ANNUAL_UPFRONT',
  MONTHLY = 'MONTHLY',
  PRO_RATA = 'PRO_RATA',
}

export interface LeaveType extends TenantEntity {
  name: string;
  category: LeaveTypeCategory;
  /** Days per year */
  defaultBalance: number;
  isPaid: boolean;
  requiresApproval: boolean;
  isActive: boolean;
  /** Accrual policy (LVE-05). */
  accrualMethod: LeaveAccrualMethod;
  carryOverEnabled: boolean;
  /** Cap on days carried into the next year (null = uncapped). */
  carryOverMaxDays?: number;
  /** Months into the new year before carried days expire (null = never). */
  carryOverExpiryMonths?: number;
}

export interface LeaveRequest extends TenantEntity {
  workerId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  /** First / last day may be a half day (LVE-03) */
  startHalfDay: boolean;
  endHalfDay: boolean;
  /** Working days only — excludes weekends and public holidays */
  days: number;
  status: LeaveStatus;
  /** Free-text reason — restricted field, permission-gated */
  reason?: string;
  submittedAt?: string;
  decidedAt?: string;
  decidedById?: string;
  approvalWorkflowId?: string;
  createdBy: string;
}

export interface LeaveBalance extends TenantEntity {
  workerId: string;
  leaveTypeId: string;
  /** Days in fixed-point (0.5 increments) */
  balance: number;
  accrued: number;
  used: number;
  year: number;
}

export interface CreateLeaveTypeDto {
  name: string;
  category: LeaveTypeCategory;
  /** Days per year */
  defaultBalance: number;
  isPaid: boolean;
  requiresApproval?: boolean;
  isActive?: boolean;
  /** Accrual policy (LVE-05). */
  accrualMethod?: LeaveAccrualMethod;
  carryOverEnabled?: boolean;
  carryOverMaxDays?: number | null;
  carryOverExpiryMonths?: number | null;
}

export type UpdateLeaveTypeDto = Partial<CreateLeaveTypeDto>;

/** One accrued day window when leave may not be taken (LVE-05). */
export interface BlackoutPeriod extends TenantEntity {
  name: string;
  locationId?: string;
  leaveTypeId?: string;
  startDate: string;
  endDate: string;
  isRecurring: boolean;
  reason?: string;
}

export interface CreateBlackoutPeriodDto {
  name: string;
  startDate: string;
  endDate: string;
  locationId?: string;
  leaveTypeId?: string;
  isRecurring?: boolean;
  reason?: string;
}

export type UpdateBlackoutPeriodDto = Partial<CreateBlackoutPeriodDto>;

/** Run the accrual batch for a leave year (LVE-05). */
export interface RunLeaveAccrualDto {
  year: number;
  /** Limit the run to one worker; omit to run for all active workers. */
  workerId?: string;
}

export interface LeaveAccrualRunResult {
  year: number;
  /** Number of balance rows created or updated. */
  updated: number;
}

export interface AttendanceRecord extends TenantEntity {
  workerId: string;
  date: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  clockIn?: string;
  clockOut?: string;
  hoursWorked?: number;
  notes?: string;
}

/** Attendance row enriched for list/detail views (ATT-01/ATT-02). */
export interface AttendanceSummary extends TenantEntity {
  workerId: string;
  workerName: string;
  date: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  clockIn?: string;
  clockOut?: string;
  hoursWorked?: number;
  /** Minutes past the scheduled start (present only when the day is LATE). */
  lateMinutes?: number;
  notes?: string;
}

/** Effective work schedule (ATT-02): org defaults with per-location overrides. */
export interface EffectiveWorkSchedule {
  workDays: number[];
  workDayStart: string;
  workDayEnd: string;
  lateGraceMinutes: number;
  scope: 'ORGANISATION' | 'LOCATION';
  locationId?: string;
  locationName?: string;
}

/** Public-holiday calendar entry (LVE-03) */
export interface Holiday extends TenantEntity {
  /** null = applies to the whole organisation */
  locationId?: string;
  locationName?: string;
  name: string;
  date: string;
  /** Repeats annually on the same month/day */
  isRecurring: boolean;
}

export interface CreateHolidayDto {
  name: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  locationId?: string | null;
  isRecurring?: boolean;
}

export type UpdateHolidayDto = Partial<CreateHolidayDto>;

// ── Leave requests, approvals & balances (LVE-01 / LVE-02 / LVE-04) ──────────

export interface CreateLeaveRequestDto {
  /** Defaults to the caller's own worker record. */
  workerId?: string;
  leaveTypeId: string;
  /** ISO date (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
  /** Restricted field — permission-gated. */
  reason?: string;
  /** Submit for approval immediately (default true). */
  submit?: boolean;
  /** Force an HR/admin approval step in addition to the manager (LVE-02). */
  requireHrApproval?: boolean;
  /** Minutes before the active approval step auto-escalates (LVE-04). */
  escalateAfterMinutes?: number;
  /** Allow dates that fall in a blackout (requires org-wide leave:approve). */
  overrideBlackout?: boolean;
}

export interface DecideLeaveRequestDto {
  approve: boolean;
  note?: string;
}

export interface LeaveRequestApprovalStep {
  id: string;
  stepOrder: number;
  approverId: string;
  approverName?: string;
  status: ApprovalStatus;
  actedAt?: string;
  note?: string;
  delegatedToId?: string;
  escalatedToId?: string;
  escalateAfterMinutes?: number;
  dueAt?: string;
  escalatedAt?: string;
}

export interface LeaveRequestSummary extends TenantEntity {
  workerId: string;
  workerName?: string;
  leaveTypeId: string;
  leaveTypeName?: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  /** Working days only — excludes weekends and public holidays. */
  days: number;
  status: LeaveStatus;
  reason?: string;
  submittedAt?: string;
  decidedAt?: string;
  decidedById?: string;
  approvalWorkflowId?: string;
  createdBy: string;
  /** The ordered approval steps, when a workflow exists. */
  steps?: LeaveRequestApprovalStep[];
  /** Step order currently awaiting a decision (undefined when closed). */
  currentStepOrder?: number;
}

/** A single leave span as shown on the team calendar (LVE-05). */
export interface LeaveCalendarEntry {
  requestId: string;
  workerId: string;
  workerName?: string;
  leaveTypeId: string;
  leaveTypeName?: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  /** Working days only — excludes weekends and public holidays. */
  days: number;
  status: LeaveStatus;
}

/** One day bucket on the team calendar. */
export interface LeaveCalendarDay {
  date: string;
  /** Working day per the organisation schedule (weekends/holidays excluded). */
  isWorkingDay: boolean;
  /** Head-count of leave entries covering this day. */
  onLeaveCount: number;
  /** Ids of the entries covering this day. */
  requestIds: string[];
}

export interface LeaveCalendarView {
  from: string;
  to: string;
  entries: LeaveCalendarEntry[];
  days: LeaveCalendarDay[];
}

export interface LeaveBalanceSummary extends TenantEntity {
  workerId: string;
  workerName?: string;
  leaveTypeId: string;
  leaveTypeName?: string;
  year: number;
  accrued: number;
  used: number;
  balance: number;
}

export interface AdjustLeaveBalanceDto {
  workerId: string;
  leaveTypeId: string;
  /** Defaults to the current leave year. */
  year?: number;
  /** New entitlement (days). Omit to leave unchanged. */
  accrued?: number;
  /** Absolute balance override (days). Omit to leave unchanged. */
  balance?: number;
  note?: string;
}

export interface PayCalendar extends TenantEntity {
  name: string;
  frequency: PayFrequency;
  dayOfMonth?: number;
  dayOfWeek?: number;
  /** Cut-off day-of-month in the pay month (PRD PAY-04). */
  cutOffDayOfMonth?: number;
  isActive: boolean;
  createdBy: string;
}

/** One generated pay period for a calendar (PRD PAY-04). */
export interface PayCalendarPeriod {
  /** Inclusive ISO date. */
  periodStart: string;
  /** Inclusive ISO date. */
  periodEnd: string;
  /** ISO date the period is paid on. */
  payDate: string;
  /** True when the cut-off for this period has not yet passed. */
  beforeCutOff: boolean;
}

export interface CreatePayCalendarDto {
  name: string;
  frequency: PayFrequency;
  /** 1–31; required for MONTHLY/QUARTERLY. */
  dayOfMonth?: number;
  /** 1–7 (Mon=1); required for WEEKLY/BIWEEKLY. */
  dayOfWeek?: number;
  /** 1–31; changes after this day wait for the next period. */
  cutOffDayOfMonth?: number;
  isActive?: boolean;
}

export type UpdatePayCalendarDto = Partial<CreatePayCalendarDto>;

export interface PayrollRun extends TenantEntity {
  payCalendarId: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollRunStatus;
  preparedById: string;
  approvedById?: string;
  approvedAt?: string;
  lockedAt?: string;
  /** PAY-07: set when the run was submitted for approval. */
  submittedById?: string;
  submittedAt?: string;
  /** PAY-10: set when blocking warnings were acknowledged before approval. */
  validationAcknowledgedAt?: string;
  validationAcknowledgedById?: string;
  /** PAY-06: set on the ORIGINAL when a reversal run replaces it. */
  reversalOfRunId?: string;
  reversedAt?: string;
  /** Total gross in minor units */
  totalGrossMinorUnits: number;
  /** Total net in minor units */
  totalNetMinorUnits: number;
  /** Total deductions (absolute) in minor units */
  totalDeductionsMinorUnits: number;
  currency: string;
  notes?: string;
}

export interface PayrollItem extends TenantEntity {
  payrollRunId: string;
  workerId: string;
  /** Denormalised for display only; absent on persisted rows. */
  workerName?: string;
  type: PayrollItemType;
  description: string;
  /** Amount in minor units — positive for earnings, negative for deductions */
  amountMinorUnits: number;
  currency: string;
  /** PAY-09: mandatory reason when the line was manually overridden. */
  overrideReason?: string;
}

/** PAY-11: one snapshotted approval step on a run. */
export interface PayrollRunApproval {
  id: string;
  payrollRunId: string;
  stepNumber: number;
  role: SystemRole;
  status: PayrollRunApprovalStatus;
  actorId?: string;
  comment?: string;
}

/** PAY-10/11: configurable per-org payroll settings. Absent = defaults. */
export interface PayrollConfig {
  organisationId: string;
  /** Ordered approver roles. Default ["OWNER"]. */
  approvalChain: SystemRole[];
  /** Warn when gross rises more than this % vs the previous run (default 30). */
  salaryChangeWarnPct: number;
  /** Warn when deductions exceed this share of gross in bps (default 5000 = 50%). */
  deductionRatioWarnBps: number;
  /** Blocking error when a run worker has no bank account on file (default true). */
  requireBankDetails: boolean;
  /** PAY-16: month the tax/leave year starts (1 = January; default 1). */
  taxYearStartMonth: number;
}

export interface UpdatePayrollConfigDto {
  approvalChain?: SystemRole[];
  salaryChangeWarnPct?: number;
  deductionRatioWarnBps?: number;
  requireBankDetails?: boolean;
  taxYearStartMonth?: number;
}

export interface CreatePayrollRunDto {
  payCalendarId: string;
  /** ISO date; must fall on a period boundary of the calendar. */
  periodStart: string;
  /** ISO date; must fall on a period boundary of the calendar. */
  periodEnd: string;
  notes?: string;
}

export interface UpdatePayrollItemDto {
  /** Signed integer minor units. */
  amountMinorUnits: number;
  /** Mandatory explanation — stored on the item and audit-logged. */
  overrideReason: string;
}

/**
 * PAY-09: a one-off line a reviewer adds to a worker mid-run (e.g. a manual
 * deduction or a spot bonus). Only allowed while the run is DRAFT/IN_REVIEW;
 * the reason is mandatory and audit-logged.
 */
export interface CreatePayrollItemDto {
  workerId: string;
  type: PayrollItemType;
  description: string;
  /** Signed integer minor units — negative for a deduction. */
  amountMinorUnits: number;
  /** Mandatory explanation — stored on the item and audit-logged. */
  overrideReason: string;
}

export interface ApprovePayrollRunDto {
  comment?: string;
}

export interface RejectPayrollRunDto {
  comment: string;
}

export interface ReversePayrollRunDto {
  /** Why the run is being reversed — required, audit-logged. */
  reason: string;
}

export type UpdatePaymentStatusDto =
  | { status: PaymentStatus.PROCESSING }
  | { status: PaymentStatus.COMPLETED }
  | { status: PaymentStatus.FAILED; reason: string }
  | { status: PaymentStatus.REVERSED; reason: string };

/** PAY-10: validation issue codes. Errors block submit; warnings need ack. */
export type RunValidationCode =
  | 'MISSING_SALARY'
  | 'MISSING_BANK_DETAILS'
  | 'DUPLICATE_RUN'
  | 'DUPLICATE_WORKER'
  | 'NO_ITEMS'
  | 'SALARY_INCREASE'
  | 'HIGH_DEDUCTIONS'
  | 'NEGATIVE_NET';

export interface RunValidationIssue {
  code: RunValidationCode;
  /** Present for worker-scoped issues; absent for run-scoped ones. */
  workerId?: string;
  message: string;
  /** Extra context (thresholds, actual values) in minor units or pct. */
  detail?: Record<string, number | string>;
}

/** PAY-08/10: result of running validations against a prepared run. */
export interface RunValidationResult {
  errors: RunValidationIssue[];
  warnings: RunValidationIssue[];
  /** Workers left out of the run (status not payroll-eligible) — flagged. */
  excluded: Array<{ workerId: string; status: string }>;
  thresholds: Pick<
    PayrollConfig,
    'salaryChangeWarnPct' | 'deductionRatioWarnBps' | 'requireBankDetails'
  >;
  acknowledgedAt?: string;
  acknowledgedById?: string;
}

/** Types accepted on a recurring pay item (PRD PAY-02 / PAY-03). */
export const RECURRING_PAY_ITEM_TYPES = [
  PayrollItemType.DEDUCTION,
  PayrollItemType.TAX,
  PayrollItemType.EMPLOYEE_PENSION,
  PayrollItemType.EMPLOYER_PENSION,
] as const;

export type RecurringPayItemType = (typeof RECURRING_PAY_ITEM_TYPES)[number];

/** Per-worker recurring deduction or employer cost (PRD PAY-02 / PAY-03). */
export interface RecurringPayItem extends TenantEntity {
  workerId: string;
  type: RecurringPayItemType;
  name: string;
  calculation: PayItemCalculation;
  /** FIXED: positive integer minor units. */
  amountMinorUnits?: number;
  /** PERCENTAGE: basis points of period gross (500 = 5%). */
  rateBps?: number;
  validFrom: string;
  validTo?: string;
  isActive: boolean;
  notes?: string;
  createdBy: string;
}

export interface CreateRecurringPayItemDto {
  workerId: string;
  type: RecurringPayItemType;
  name: string;
  calculation: PayItemCalculation;
  /** Required when calculation = FIXED; positive integer minor units. */
  amountMinorUnits?: number;
  /** Required when calculation = PERCENTAGE; 1–10000 basis points. */
  rateBps?: number;
  validFrom: string;
  validTo?: string | null;
  isActive?: boolean;
  notes?: string | null;
}

export type UpdateRecurringPayItemDto = Partial<Omit<CreateRecurringPayItemDto, 'workerId'>>;

export interface Payment extends TenantEntity {
  payrollRunId?: string;
  workerId: string;
  /** Amount in minor units */
  amountMinorUnits: number;
  currency: string;
  status: PaymentStatus;
  reference: string;
  description: string;
  processedAt?: string;
}

// ── Payment file export (PAY-12) ──────────────────────────────────────────────

/** Bank-upload formats. Generic CSV is the only built-in format for now. */
export enum PaymentExportFormat {
  CSV = 'CSV',
}

export interface PaymentExportQuery {
  payrollRunId?: string;
  status?: PaymentStatus;
  format?: PaymentExportFormat;
}

// ── Statutory rule packs (LOC-02 / LOC-03) ────────────────────────────────────

/**
 * Rule kinds the (data-driven) engine understands. Values are NEVER invented by
 * the codebase — every number comes from the org-supplied pack.
 */
export type StatutoryRuleKind = 'PERCENT_BANDS' | 'FLAT' | 'PERCENT_CAPPED';

/** Which base a rule applies to. */
export type StatutoryRuleBase = 'GROSS' | 'BASIC_SALARY' | 'TAXABLE' | 'PENSIONABLE';

/** Who bears the cost. */
export type StatutoryRuleSide = 'EMPLOYEE' | 'EMPLOYER';

/** Item types a statutory rule may produce. */
export type StatutoryItemType =
  | 'DEDUCTION'
  | 'TAX'
  | 'EMPLOYEE_PENSION'
  | 'EMPLOYER_PENSION';

export interface StatutoryBand {
  /** Lower bound (inclusive) of the band, in integer minor units. */
  upToMinorUnits: number | null;
  /** Rate in basis points applied to the slice inside this band. */
  rateBps: number;
}

export interface StatutoryRule {
  /** Stable key within the pack, e.g. "PAYE". */
  code: string;
  label: string;
  kind: StatutoryRuleKind;
  base: StatutoryRuleBase;
  side: StatutoryRuleSide;
  /** The payroll item type this rule produces. */
  itemType: StatutoryItemType;
  /** PERCENT_BANDS: ordered bands. */
  bands?: StatutoryBand[];
  /** FLAT: fixed integer minor units. */
  amountMinorUnits?: number;
  /** PERCENT_CAPPED: rate in basis points + optional cap on the computed amount. */
  rateBps?: number;
  capMinorUnits?: number | null;
  /** Optional floor/base for PERCENT_CAPPED, in integer minor units. */
  baseFloorMinorUnits?: number | null;
}

export interface StatutoryRulePack extends TenantEntity {
  country: string;
  version: string;
  rules: StatutoryRule[];
  validFrom: string;
  validTo?: string;
  isActive: boolean;
  /** LOC-03: true once a qualified professional has validated this pack. */
  validated: boolean;
  validatedBy?: string;
  validatedAt?: string;
  createdBy: string;
}

export interface CreateStatutoryRulePackDto {
  country: string;
  version: string;
  rules: StatutoryRule[];
  validFrom: string;
  validTo?: string | null;
  isActive?: boolean;
}

export type UpdateStatutoryRulePackDto = Partial<CreateStatutoryRulePackDto>;

export interface StatutoryRulePackListQuery extends PaginatedQuery {
  country?: string;
  active?: boolean;
}

export interface ApprovalWorkflow extends TenantEntity {
  name: string;
  resourceType: string;
  resourceId: string;
  steps: ApprovalStep[];
  currentStep: number;
  status: ApprovalStatus;
}

export interface ApprovalStep {
  order: number;
  approverId: string;
  status: ApprovalStatus;
  actedAt?: string;
  note?: string;
}

export interface Document extends TenantEntity {
  workerId?: string;
  type: DocumentType;
  name: string;
  /** Signed expiring URL — never expose the raw storage key */
  signedUrl?: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt?: string;
  uploadedBy: string;
}

/** Directory row for the document store — metadata only, never a storage key. */
export interface DocumentSummary extends TenantEntity {
  workerId?: string;
  workerName?: string;
  type: DocumentType;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  /** Authenticated, same-origin endpoint that streams the file. */
  downloadUrl: string;
}

/** Upload a document. `content` is base64 (no `data:` prefix). */
export interface CreateDocumentDto {
  name: string;
  type: DocumentType;
  workerId?: string | null;
  mimeType: string;
  content: string;
}

export interface DocumentListQuery extends PaginatedQuery {
  workerId?: string;
  type?: DocumentType;
}

export interface AuditLog extends TenantEntity {
  actorId: string;
  actorEmail: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  /** Sensitive values are masked in here */
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

// ── Notifications ─────────────────────────────────────────────────────────────

/** In-app notification kinds (delivered for leave-workflow events). */
export enum NotificationType {
  LEAVE_REQUEST_SUBMITTED = 'LEAVE_REQUEST_SUBMITTED',
  LEAVE_REQUEST_APPROVED = 'LEAVE_REQUEST_APPROVED',
  LEAVE_REQUEST_REJECTED = 'LEAVE_REQUEST_REJECTED',
  LEAVE_REQUEST_ESCALATED = 'LEAVE_REQUEST_ESCALATED',
  LEAVE_REQUEST_DELEGATED = 'LEAVE_REQUEST_DELEGATED',
  LEAVE_REQUEST_CANCELLED = 'LEAVE_REQUEST_CANCELLED',
  LEAVE_ACCRUAL_RUN = 'LEAVE_ACCRUAL_RUN',
}

/** A per-recipient in-app notification for the signed-in user. */
export interface Notification {
  id: string;
  organisationId: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Relative in-app link to open on click (e.g. /time-leave). */
  link?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Non-null once the recipient has read it. */
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationListQuery extends PaginatedQuery {
  unreadOnly?: boolean;
}

export interface NotificationListResponse {
  data: Notification[];
  /** Total unread for the recipient (independent of the current page). */
  unread: number;
  meta: PaginationMeta;
}

// ── API Response Wrappers ─────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
  timestamp: string;
  path: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginatedQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginDto {
  email: string;
  password: string;
  organisationId?: string;
  mfaCode?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser extends User {
  currentOrganisation: Organisation;
  currentRole: SystemRole;
  permissions: Permission[];
}

// ── Onboarding ────────────────────────────────────────────────────────────────

export interface InvitationDetails {
  email: string;
  organisationName: string;
  expiresAt: string;
}

export interface SetPasswordDto {
  token: string;
  password: string;
}

// ── Plans & billing ───────────────────────────────────────────────────────────

/** Public-facing plan returned by GET /plans and used to render tier cards. */
export interface PlanSummary {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  /** Price per billing period, in minor units (kobo). */
  priceMinorUnits: number;
  currency: string;
  billingPeriod: BillingPeriod;
  minHeadcount?: number | null;
  maxHeadcount?: number | null;
  maxSeats?: number | null;
  features: string[];
  isFree: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface CreatePlanDto {
  code: string;
  name: string;
  description?: string;
  priceMinorUnits: number;
  currency?: string;
  billingPeriod?: BillingPeriod;
  minHeadcount?: number | null;
  maxHeadcount?: number | null;
  maxSeats?: number | null;
  features?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export type UpdatePlanDto = Partial<CreatePlanDto>;

// ── Self-serve signup ─────────────────────────────────────────────────────────

export interface StartRegistrationDto {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  organisationName: string;
  organisationType: OrganisationType;
  teamSize: string;
  country?: string;
  role?: string;
  message?: string;
  /** Plan code selected on the signup form. */
  planCode: string;
}

export interface StartRegistrationResult {
  registrationId: string;
  email: string;
  /** Masked email for display, e.g. s*****@gmail.com */
  emailMasked: string;
  /** True when the selected plan requires payment before activation. */
  requiresPayment: boolean;
  plan: PlanSummary;
  /** Seconds until the verification code expires. */
  expiresIn: number;
}

export interface VerifyRegistrationDto {
  registrationId: string;
  code: string;
}

/**
 * Result of a successful (free) registration. Paid plans return a checkout
 * session instead and only produce a session after payment is confirmed.
 */
export interface VerifyRegistrationResult {
  completed: boolean;
  redirectTo?: string;
  /** Present when a paid plan must be paid for before provisioning. */
  checkout?: CheckoutSession;
  plan?: PlanSummary;
}

export interface CheckoutSession {
  provider: PaymentProvider;
  /** Gateway reference for this charge attempt. */
  reference: string;
  /** URL to redirect the browser to (Paystack/Flutterwave hosted checkout). */
  authorizationUrl: string;
  amountMinorUnits: number;
  currency: string;
}

export interface InitializePaymentDto {
  registrationId: string;
  provider: PaymentProvider;
}

export interface PaymentVerificationDto {
  reference: string;
  provider: PaymentProvider;
}

export interface PaymentResult {
  status: TransactionStatus;
  completed: boolean;
  redirectTo?: string;
  organisationId?: string;
}

/**
 * Authenticated view of the current organisation's billing: its active plan
 * (if any) and the most recent charge attempts.
 */
export interface BillingSummary {
  plan: PlanSummary | null;
  status: SubscriptionStatus | 'NONE';
  provider: PaymentProvider;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  recentTransactions: BillingTransactionSummary[];
}

export interface BillingTransactionSummary {
  reference: string;
  provider: PaymentProvider;
  amountMinorUnits: number;
  currency: string;
  status: TransactionStatus;
  paidAt: string | null;
  createdAt: string;
}

/** Admin view of a workspace signup. */
export interface RegistrationSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  organisationName: string;
  organisationType: OrganisationType;
  teamSize: string;
  planCode: string;
  status: RegistrationStatus;
  organisationId?: string | null;
  createdAt: string;
}

// ── KPI / Analytics ───────────────────────────────────────────────────────────

export interface DashboardKpis {
  totalWorkers: number;
  activeWorkers: number;
  pendingLeaveRequests: number;
  nextPayrollDate: string;
  lastPayrollTotalMinorUnits: number;
  currency: string;
}

/** Compact view of the most recent payroll run for the dashboard KPI card. */
export interface DashboardPayrollRun {
  id: string;
  status: PayrollRunStatus;
  /** Period the run covers, e.g. "October 2026". */
  periodLabel: string;
  totalNetMinorUnits: number;
  currency: string;
  approvedAt: string | null;
}

/** Headline numbers for the dashboard KPI row. All org-scoped. */
export interface DashboardSummary {
  /** Workers with status ACTIVE. */
  totalWorkers: number;
  /** Leave requests awaiting approval (status PENDING). */
  pendingLeaveRequests: number;
  /** Most recent payroll run, or null until the first run exists. */
  lastPayrollRun: DashboardPayrollRun | null;
  /** Workers who joined (startDate) during the current calendar month. */
  newThisMonth: number;
}

/** A leave entry shown in the dashboard insights rail. */
export interface LeaveInsight {
  id: string;
  workerName: string;
  leaveTypeName: string;
  /** ISO 8601 date (date only). */
  startDate: string;
  /** ISO 8601 date (date only). */
  endDate: string;
}

/** An upcoming birthday — only day/month are exposed, never the birth year. */
export interface BirthdayInsight {
  workerId: string;
  workerName: string;
  /** ISO 8601 date of the next occurrence of the birthday. */
  date: string;
}

/** A public holiday in the organisation's country for the current month. */
export interface HolidayInsight {
  name: string;
  /** ISO 8601 date (date only). */
  date: string;
}

/** Everything the dashboard insights rail needs in one payload. */
export interface DashboardInsights {
  /** Approved leave spanning today. */
  onLeaveNow: LeaveInsight[];
  /** Approved leave starting within the next 30 days. */
  upcomingLeave: LeaveInsight[];
  /** Birthdays in the next 60 days. */
  upcomingBirthdays: BirthdayInsight[];
  /** Public holidays in the current calendar month. */
  holidays: HolidayInsight[];
}
