import {
  evaluateRow,
  mapCsvToRawWorkers,
  mapHeader,
  parseCsv,
  parseDateCell,
  type ImportContext,
  type RawWorkerRow,
} from './worker-import';

function ctx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    departmentByName: new Map([['ministry', 'd1']]),
    locationByName: new Map([['lagos hq', 'l1']]),
    existingEmployeeNumbers: new Set(),
    seenEmployeeNumbers: new Set(),
    ...overrides,
  };
}

function row(
  values: RawWorkerRow['values'],
  rowNumber = 2,
): RawWorkerRow {
  return { rowNumber, values };
}

const goodRow = () =>
  row({
    employeeNumber: 'EMP-100',
    firstName: 'Ada',
    lastName: 'Okafor',
    email: 'ada@example.com',
    jobTitle: 'Associate Pastor',
    startDate: '2026-01-05',
  });

describe('parseCsv', () => {
  it('parses quoted fields, embedded commas and escaped quotes', () => {
    const text = 'a,b,c\n1,"x, y","he said ""hi"""\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'he said "hi"'],
    ]);
  });

  it('handles CRLF, a UTF-8 BOM and trailing newline', () => {
    const text = '\uFEFFa,b\r\n1,2\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('supports newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line1\nline2",x\n')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });
});

describe('mapHeader', () => {
  it('recognises aliases case- and punctuation-insensitively', () => {
    expect(mapHeader('Employee Number')).toBe('employeeNumber');
    expect(mapHeader('  EMP ID  ')).toBe('employeeNumber');
    expect(mapHeader('Ministry')).toBe('department');
    expect(mapHeader('Start Date')).toBe('startDate');
    expect(mapHeader('Nonsense')).toBeNull();
  });

  it('accepts camelCase / no-space spellings for every field', () => {
    expect(mapHeader('employeeNumber')).toBe('employeeNumber');
    expect(mapHeader('EmployeeNumber')).toBe('employeeNumber');
    expect(mapHeader('firstName')).toBe('firstName');
    expect(mapHeader('lastName')).toBe('lastName');
    expect(mapHeader('preferredName')).toBe('preferredName');
    expect(mapHeader('employmentType')).toBe('employmentType');
    expect(mapHeader('jobTitle')).toBe('jobTitle');
    expect(mapHeader('startDate')).toBe('startDate');
    expect(mapHeader('endDate')).toBe('endDate');
    expect(mapHeader('dateOfBirth')).toBe('dateOfBirth');
    expect(mapHeader('phoneNumber')).toBe('phone');
    expect(mapHeader('mobileNumber')).toBe('phone');
  });

  it('maps a full camelCase header row with no header errors', () => {
    const csv = [
      'employeeNumber,firstName,lastName,email,jobTitle,startDate',
      'EMP-1,Ada,Okafor,ada@example.com,Pastor,2026-01-05',
    ].join('\n');
    const { rawRows, headerErrors } = mapCsvToRawWorkers(csv);
    expect(headerErrors).toEqual([]);
    expect(rawRows[0]!.values.employeeNumber).toBe('EMP-1');
  });
});

describe('mapCsvToRawWorkers', () => {
  it('reports missing required columns', () => {
    const { headerErrors } = mapCsvToRawWorkers('First Name,Last Name\nAda,Okafor\n');
    expect(headerErrors.join(' ')).toContain('employeeNumber');
  });

  it('maps rows and skips blank lines, numbering from 2', () => {
    const csv = [
      'Employee Number,First Name,Last Name,Email,Job Title,Start Date',
      'EMP-1,Ada,Okafor,ada@example.com,Pastor,2026-01-05',
      ',,,',
      'EMP-2,Ben,Eze,ben@example.com,Vicar,2026-02-01',
    ].join('\n');

    const { rawRows, headerErrors } = mapCsvToRawWorkers(csv);
    expect(headerErrors).toEqual([]);
    expect(rawRows).toHaveLength(2);
    expect(rawRows[0]!.rowNumber).toBe(2);
    expect(rawRows[1]!.rowNumber).toBe(4);
    expect(rawRows[0]!.values.employeeNumber).toBe('EMP-1');
  });
});

describe('parseDateCell', () => {
  it('accepts ISO and day-first dates', () => {
    expect(parseDateCell('2026-01-05')).toEqual({
      kind: 'valid',
      value: '2026-01-05',
    });
    expect(parseDateCell('5/1/2026')).toEqual({
      kind: 'valid',
      value: '2026-01-05',
    });
  });

  it('flags empty and invalid values', () => {
    expect(parseDateCell('  ')).toEqual({ kind: 'empty' });
    expect(parseDateCell('2026-13-40')).toEqual({ kind: 'invalid' });
    expect(parseDateCell('not a date')).toEqual({ kind: 'invalid' });
  });
});

describe('evaluateRow', () => {
  it('accepts a complete row with sensible defaults', () => {
    const result = evaluateRow(goodRow(), ctx());
    expect(result.errors).toEqual([]);
    expect(result.duplicate).toBe(false);
    expect(result.worker).toMatchObject({
      employeeNumber: 'EMP-100',
      category: 'EMPLOYEE',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      startDate: '2026-01-05',
    });
  });

  it('collects required-field errors', () => {
    const result = evaluateRow(row({ employeeNumber: 'EMP-1' }), ctx());
    expect(result.worker).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'First name is required.',
        'Last name is required.',
        'Email is required.',
        'Job title is required.',
        'Start date is required.',
      ]),
    );
  });

  it('rejects an invalid email', () => {
    const result = evaluateRow(
      row({ ...goodRow().values, email: 'not-an-email' }),
      ctx(),
    );
    expect(result.errors).toContain('Email is not valid.');
  });

  it('resolves department and location by name', () => {
    const result = evaluateRow(
      row({ ...goodRow().values, department: 'Ministry', location: 'Lagos HQ' }),
      ctx(),
    );
    expect(result.worker).toMatchObject({
      departmentId: 'd1',
      locationId: 'l1',
      departmentName: 'Ministry',
      locationName: 'Lagos HQ',
    });
  });

  it('errors on unknown department and location', () => {
    const result = evaluateRow(
      row({ ...goodRow().values, department: 'Nope', location: 'Nowhere' }),
      ctx(),
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Department "Nope" not found.',
        'Location "Nowhere" not found.',
      ]),
    );
  });

  it('flags employee numbers already in the organisation', () => {
    const context = ctx({
      existingEmployeeNumbers: new Set(['emp-100']),
    });
    const result = evaluateRow(goodRow(), context);
    expect(result.duplicate).toBe(true);
    expect(result.worker).toBeNull();
    expect(result.errors).toContain(
      'Employee number "EMP-100" already exists.',
    );
  });

  it('flags duplicate employee numbers within the same file', () => {
    const context = ctx();
    const first = evaluateRow(goodRow(), context);
    const second = evaluateRow(row({ ...goodRow().values }, 3), context);
    expect(first.worker).not.toBeNull();
    expect(second.duplicate).toBe(true);
    expect(second.errors).toContain(
      'Duplicate employee number "EMP-100" in file.',
    );
  });
});
