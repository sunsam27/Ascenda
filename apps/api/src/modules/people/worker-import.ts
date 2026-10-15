// ─────────────────────────────────────────────────────────────────────────────
// WORKER CSV IMPORT — pure parsing, mapping and validation logic.
//
// Kept free of Nest/Prisma so it can be unit-tested in isolation. The service
// layer supplies tenant lookups (department/location name → id, existing
// employee numbers) through `ImportContext`.
// ─────────────────────────────────────────────────────────────────────────────
import {
  EmploymentType,
  WorkerCategory,
  WorkerStatus,
} from '@ascenda/types';

/** Canonical fields a row can map to (everything else is ignored). */
export type CanonicalField =
  | 'employeeNumber'
  | 'firstName'
  | 'lastName'
  | 'preferredName'
  | 'email'
  | 'phone'
  | 'category'
  | 'employmentType'
  | 'status'
  | 'jobTitle'
  | 'department'
  | 'location'
  | 'startDate'
  | 'endDate'
  | 'dateOfBirth'
  | 'gender';

/** Accepted header spellings (lower-cased, whitespace-normalised). */
const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  employeeNumber: [
    'employee number',
    'employee id',
    'employee no',
    'emp no',
    'emp id',
    'staff number',
    'staff id',
    'staff no',
    'personnel number',
  ],
  firstName: ['first name', 'firstname', 'given name', 'given names'],
  lastName: ['last name', 'lastname', 'surname', 'family name'],
  preferredName: ['preferred name', 'preferred', 'nickname'],
  email: ['email', 'email address', 'e mail', 'mail'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'tel'],
  category: ['category', 'worker category', 'worker type', 'category of worker'],
  employmentType: [
    'employment type',
    'employment',
    'contract type',
    'engagement type',
  ],
  status: ['status', 'worker status'],
  jobTitle: ['job title', 'jobtitle', 'title', 'role', 'position', 'designation'],
  department: ['department', 'ministry', 'team', 'unit'],
  location: ['location', 'site', 'branch', 'office', 'campus'],
  startDate: [
    'start date',
    'startdate',
    'start',
    'date started',
    'hire date',
    'joined',
    'join date',
  ],
  endDate: ['end date', 'enddate', 'end', 'date ended', 'exit date'],
  dateOfBirth: ['date of birth', 'dob', 'birthday', 'birth date', 'birthdate'],
  gender: ['gender', 'sex'],
};

/** Fields that must be present as headers for an import to make sense. */
export const REQUIRED_HEADERS: CanonicalField[] = [
  'employeeNumber',
  'firstName',
  'lastName',
  'email',
  'jobTitle',
  'startDate',
];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RawWorkerRow {
  /** 1-based spreadsheet row (header is row 1). */
  rowNumber: number;
  values: Partial<Record<CanonicalField, string>>;
}

export interface NormalizedWorker {
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
  departmentName?: string;
  locationName?: string;
  startDate: string;
  endDate?: string;
  dateOfBirth?: string;
  gender?: string;
}

export interface ImportContext {
  /** lower-cased department name → id */
  departmentByName: Map<string, string>;
  /** lower-cased location name → id */
  locationByName: Map<string, string>;
  /** lower-cased employee numbers already in the organisation */
  existingEmployeeNumbers: Set<string>;
  /** lower-cased employee numbers seen earlier in this file (mutated) */
  seenEmployeeNumbers: Set<string>;
}

export interface RowEvaluation {
  errors: string[];
  duplicate: boolean;
  worker: NormalizedWorker | null;
}

// ── CSV parsing ──────────────────────────────────────────────────────────────

/**
 * Parse CSV text into a matrix of cells. Handles quoted fields (with embedded
 * commas/newlines and `""` escapes), CRLF and LF line endings, and a UTF-8 BOM.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      started = true;
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      started = false;
      continue;
    }
    field += ch;
    started = true;
  }
  if (started || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u00a0_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.:]+$/, '')
    .trim();
}

const ALIAS_TO_FIELD: Map<string, CanonicalField> = (() => {
  const map = new Map<string, CanonicalField>();
  (Object.keys(HEADER_ALIASES) as CanonicalField[]).forEach((field) => {
    HEADER_ALIASES[field].forEach((alias) => map.set(alias, field));
  });
  return map;
})();

/** Map a CSV header to a canonical field, or null when unrecognised. */
export function mapHeader(header: string): CanonicalField | null {
  return ALIAS_TO_FIELD.get(normalizeHeader(header)) ?? null;
}

export interface MappedCsv {
  rawRows: RawWorkerRow[];
  headerErrors: string[];
}

/** Turn raw CSV text into canonical rows plus any header-level problems. */
export function mapCsvToRawWorkers(text: string): MappedCsv {
  const matrix = parseCsv(text);
  if (matrix.length === 0) {
    return { rawRows: [], headerErrors: ['The file is empty.'] };
  }

  const headerCells = matrix[0] ?? [];
  const columnField = headerCells.map((cell) => mapHeader(cell));
  const present = new Set(columnField.filter(Boolean) as CanonicalField[]);

  const missing = REQUIRED_HEADERS.filter((field) => !present.has(field));
  const headerErrors = missing.length
    ? [`Missing required column(s): ${missing.join(', ')}.`]
    : [];
  if (!columnField.some(Boolean)) {
    headerErrors.push('No recognised columns found in the header row.');
  }

  const rawRows: RawWorkerRow[] = [];
  for (let r = 1; r < matrix.length; r += 1) {
    const cells = matrix[r] ?? [];
    if (cells.every((cell) => cell.trim() === '')) continue;
    const values: Partial<Record<CanonicalField, string>> = {};
    columnField.forEach((field, index) => {
      if (!field) return;
      values[field] = (cells[index] ?? '').trim();
    });
    rawRows.push({ rowNumber: r + 1, values });
  }

  return { rawRows, headerErrors };
}

// ── Normalisation ────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, WorkerCategory> = {
  employee: WorkerCategory.EMPLOYEE,
  staff: WorkerCategory.EMPLOYEE,
  pastor: WorkerCategory.EMPLOYEE,
  minister: WorkerCategory.MINISTER,
  clergy: WorkerCategory.MINISTER,
  volunteer: WorkerCategory.VOLUNTEER,
  contractor: WorkerCategory.CONTRACTOR,
  consultant: WorkerCategory.CONTRACTOR,
  intern: WorkerCategory.INTERN,
  'internship': WorkerCategory.INTERN,
};

const EMPLOYMENT_MAP: Record<string, EmploymentType> = {
  'full time': EmploymentType.FULL_TIME,
  fulltime: EmploymentType.FULL_TIME,
  'full-time': EmploymentType.FULL_TIME,
  'part time': EmploymentType.PART_TIME,
  parttime: EmploymentType.PART_TIME,
  'part-time': EmploymentType.PART_TIME,
  casual: EmploymentType.CASUAL,
  'fixed term': EmploymentType.FIXED_TERM,
  'fixed-term': EmploymentType.FIXED_TERM,
  contract: EmploymentType.FIXED_TERM,
};

const STATUS_MAP: Record<string, WorkerStatus> = {
  active: WorkerStatus.ACTIVE,
  'on leave': WorkerStatus.ON_LEAVE,
  onleave: WorkerStatus.ON_LEAVE,
  suspended: WorkerStatus.SUSPENDED,
  terminated: WorkerStatus.TERMINATED,
  draft: WorkerStatus.DRAFT,
};

function lookup<T>(map: Record<string, T>, value: string): T | null {
  return map[normalizeHeader(value)] ?? null;
}

export function normalizeCategory(value: string): WorkerCategory | null {
  return lookup(CATEGORY_MAP, value);
}

export function normalizeEmploymentType(value: string): EmploymentType | null {
  return lookup(EMPLOYMENT_MAP, value);
}

export function normalizeStatus(value: string): WorkerStatus | null {
  return lookup(STATUS_MAP, value);
}

export type DateCell =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: string };

/** Parse a date cell into an ISO `YYYY-MM-DD` string. */
export function parseDateCell(raw: string): DateCell {
  const value = raw.trim();
  if (!value) return { kind: 'empty' };

  let year: number;
  let month: number;
  let day: number;
  let match: RegExpMatchArray | null;

  if ((match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if ((match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else {
    return { kind: 'invalid' };
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) {
    return { kind: 'invalid' };
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { kind: 'invalid' };
  }
  const iso = `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return { kind: 'valid', value: iso };
}

// ── Row evaluation ───────────────────────────────────────────────────────────

export function evaluateRow(
  row: RawWorkerRow,
  ctx: ImportContext,
): RowEvaluation {
  const errors: string[] = [];
  const get = (field: CanonicalField): string => row.values[field]?.trim() ?? '';

  const employeeNumber = get('employeeNumber');
  if (!employeeNumber) errors.push('Employee number is required.');
  else if (employeeNumber.length > 40)
    errors.push('Employee number is too long (max 40).');

  const firstName = get('firstName');
  if (!firstName) errors.push('First name is required.');
  else if (firstName.length > 80) errors.push('First name is too long (max 80).');

  const lastName = get('lastName');
  if (!lastName) errors.push('Last name is required.');
  else if (lastName.length > 80) errors.push('Last name is too long (max 80).');

  const email = get('email');
  if (!email) errors.push('Email is required.');
  else if (!EMAIL_RE.test(email)) errors.push('Email is not valid.');
  else if (email.length > 160) errors.push('Email is too long (max 160).');

  const jobTitle = get('jobTitle');
  if (!jobTitle) errors.push('Job title is required.');
  else if (jobTitle.length > 120)
    errors.push('Job title is too long (max 120).');

  const categoryRaw = get('category');
  const category = categoryRaw
    ? normalizeCategory(categoryRaw)
    : WorkerCategory.EMPLOYEE;
  if (categoryRaw && !category)
    errors.push(`Unknown category "${categoryRaw}".`);

  const employmentRaw = get('employmentType');
  const employmentType = employmentRaw
    ? normalizeEmploymentType(employmentRaw)
    : EmploymentType.FULL_TIME;
  if (employmentRaw && !employmentType)
    errors.push(`Unknown employment type "${employmentRaw}".`);

  const statusRaw = get('status');
  const status = statusRaw ? normalizeStatus(statusRaw) : WorkerStatus.ACTIVE;
  if (statusRaw && !status) errors.push(`Unknown status "${statusRaw}".`);

  const startCell = parseDateCell(get('startDate'));
  if (startCell.kind === 'empty') errors.push('Start date is required.');
  else if (startCell.kind === 'invalid')
    errors.push(`Start date "${get('startDate')}" is not a valid date.`);

  const endCell = parseDateCell(get('endDate'));
  if (endCell.kind === 'invalid')
    errors.push(`End date "${get('endDate')}" is not a valid date.`);

  const dobCell = parseDateCell(get('dateOfBirth'));
  if (dobCell.kind === 'invalid')
    errors.push(`Date of birth "${get('dateOfBirth')}" is not a valid date.`);

  const departmentName = get('department');
  let departmentId: string | undefined;
  if (departmentName) {
    departmentId = ctx.departmentByName.get(departmentName.toLowerCase());
    if (!departmentId) errors.push(`Department "${departmentName}" not found.`);
  }

  const locationName = get('location');
  let locationId: string | undefined;
  if (locationName) {
    locationId = ctx.locationByName.get(locationName.toLowerCase());
    if (!locationId) errors.push(`Location "${locationName}" not found.`);
  }

  const preferredName = get('preferredName');
  if (preferredName.length > 80)
    errors.push('Preferred name is too long (max 80).');
  const phone = get('phone');
  if (phone.length > 30) errors.push('Phone is too long (max 30).');
  const gender = get('gender');
  if (gender.length > 30) errors.push('Gender is too long (max 30).');

  let duplicate = false;
  if (employeeNumber) {
    const key = employeeNumber.toLowerCase();
    if (ctx.existingEmployeeNumbers.has(key)) {
      duplicate = true;
      errors.push(`Employee number "${employeeNumber}" already exists.`);
    } else if (ctx.seenEmployeeNumbers.has(key)) {
      duplicate = true;
      errors.push(`Duplicate employee number "${employeeNumber}" in file.`);
    }
    ctx.seenEmployeeNumbers.add(key);
  }

  if (errors.length > 0) {
    return { errors, duplicate, worker: null };
  }

  return {
    errors,
    duplicate,
    worker: {
      employeeNumber,
      firstName,
      lastName,
      preferredName: preferredName || undefined,
      email,
      phone: phone || undefined,
      category: category as WorkerCategory,
      employmentType: employmentType as EmploymentType,
      status: status as WorkerStatus,
      jobTitle,
      departmentId,
      locationId,
      departmentName: departmentName || undefined,
      locationName: locationName || undefined,
      startDate: (startCell as { value: string }).value,
      endDate: endCell.kind === 'valid' ? endCell.value : undefined,
      dateOfBirth: dobCell.kind === 'valid' ? dobCell.value : undefined,
      gender: gender || undefined,
    },
  };
}
