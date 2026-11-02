#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const REQUIRED_COLUMNS = [
  'employee_number',
  'currency',
  'gross_minor_units',
  'deductions_minor_units',
  'net_minor_units',
  'employer_costs_minor_units',
];

const AMOUNT_COLUMNS = [
  'gross_minor_units',
  'deductions_minor_units',
  'net_minor_units',
  'employer_costs_minor_units',
];

const MAX_PRINTED_DIFFS = 200;

function readTextFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le', 2);
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer);
    for (let i = 2; i + 1 < swapped.length; i += 2) {
      const first = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = first;
    }
    return swapped.toString('utf16le', 2);
  }
  return buffer.toString('utf8');
}

function parseCsv(text, source) {
  const input = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field !== '') {
        throw new Error(`${source}:${line}: unexpected quote inside an unquoted field`);
      }
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.length > 1 || row[0] !== '') {
        rows.push({ line: rowStartLine, fields: row });
      }
      row = [];
      field = '';
      line += 1;
      rowStartLine = line;
      continue;
    }
    field += char;
  }

  if (inQuotes) {
    throw new Error(`${source}:${line}: unterminated quoted field`);
  }

  row.push(field);
  if (row.length > 1 || row[0] !== '') {
    rows.push({ line: rowStartLine, fields: row });
  }
  return rows;
}

function makeError(source, line, code, message) {
  return { source, line, code, message };
}

function parseMinorUnits(raw) {
  if (!/^[+-]?\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

function parseRows(csvRows, source) {
  const errors = [];
  if (csvRows.length === 0) {
    return { records: [], errors: [makeError(source, null, 'EMPTY_FILE', 'CSV is empty')] };
  }

  const headerRow = csvRows[0];
  const headers = headerRow.fields.map((header) => header.trim().toLowerCase());
  const indexByName = new Map();

  headers.forEach((header, index) => {
    if (header === '') return;
    if (indexByName.has(header)) {
      errors.push(
        makeError(source, headerRow.line, 'DUPLICATE_COLUMN', `column "${header}" appears more than once`),
      );
      return;
    }
    indexByName.set(header, index);
  });

  const missing = REQUIRED_COLUMNS.filter((column) => !indexByName.has(column));
  if (missing.length > 0) {
    errors.push(
      makeError(
        source,
        headerRow.line,
        'MISSING_COLUMNS',
        `missing required column(s): ${missing.join(', ')}`,
      ),
    );
    return { records: [], errors };
  }

  const records = [];
  const seen = new Map();

  for (const row of csvRows.slice(1)) {
    const fields = row.fields;
    if (fields.length !== headers.length) {
      errors.push(
        makeError(
          source,
          row.line,
          'BAD_COLUMN_COUNT',
          `expected ${headers.length} columns, got ${fields.length}`,
        ),
      );
      continue;
    }

    const employeeNumber = fields[indexByName.get('employee_number')].trim();
    const currency = fields[indexByName.get('currency')].trim().toUpperCase();
    const workerName = indexByName.has('worker_name')
      ? fields[indexByName.get('worker_name')].trim()
      : '';

    if (employeeNumber === '') {
      errors.push(
        makeError(source, row.line, 'EMPTY_EMPLOYEE_NUMBER', 'employee_number is required'),
      );
      continue;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push(
        makeError(source, row.line, 'BAD_CURRENCY', `invalid ISO currency "${currency}"`),
      );
      continue;
    }
    if (seen.has(employeeNumber)) {
      errors.push(
        makeError(
          source,
          row.line,
          'DUPLICATE_EMPLOYEE_NUMBER',
          `employee_number "${employeeNumber}" also appears on line ${seen.get(employeeNumber)}`,
        ),
      );
      continue;
    }
    seen.set(employeeNumber, row.line);

    const record = { line: row.line, employeeNumber, currency, workerName };
    let amountsValid = true;

    for (const column of AMOUNT_COLUMNS) {
      const raw = fields[indexByName.get(column)].trim();
      const parsed = parseMinorUnits(raw);
      if (parsed === null) {
        errors.push(
          makeError(
            source,
            row.line,
            'BAD_AMOUNT',
            `${column} must be a safe integer in minor units, got "${raw}"`,
          ),
        );
        amountsValid = false;
      } else {
        record[column] = parsed;
      }
    }
    if (!amountsValid) continue;

    if (record.net_minor_units !== record.gross_minor_units - record.deductions_minor_units) {
      errors.push(
        makeError(
          source,
          row.line,
          'NET_INCONSISTENT',
          `net_minor_units ${record.net_minor_units} != gross_minor_units ${record.gross_minor_units} - deductions_minor_units ${record.deductions_minor_units}`,
        ),
      );
      continue;
    }

    records.push(record);
  }

  return { records, errors };
}

function loadInput(text, source) {
  try {
    return parseRows(parseCsv(text, source), source);
  } catch (error) {
    return {
      records: [],
      errors: [makeError(source, null, 'CSV_PARSE_ERROR', error.message)],
    };
  }
}

function sumTotals(records) {
  const totals = new Map();
  for (const record of records) {
    let bucket = totals.get(record.currency);
    if (!bucket) {
      bucket = {
        gross_minor_units: 0,
        deductions_minor_units: 0,
        net_minor_units: 0,
        employer_costs_minor_units: 0,
      };
      totals.set(record.currency, bucket);
    }
    for (const column of AMOUNT_COLUMNS) {
      bucket[column] += record[column];
    }
  }
  return totals;
}

function buildTotalsComparison(actualRecords, expectedRecords) {
  const actual = sumTotals(actualRecords);
  const expected = sumTotals(expectedRecords);
  const currencies = new Set([...actual.keys(), ...expected.keys()]);
  const comparison = {};

  for (const currency of [...currencies].sort()) {
    comparison[currency] = {};
    for (const column of AMOUNT_COLUMNS) {
      const actualValue = actual.get(currency)?.[column] ?? 0;
      const expectedValue = expected.get(currency)?.[column] ?? 0;
      comparison[currency][column] = {
        actual: actualValue,
        expected: expectedValue,
        delta: actualValue - expectedValue,
      };
    }
  }

  return comparison;
}

function reconcile(actualRecords, expectedRecords) {
  const diffs = [];
  const actualByEmployee = new Map(
    actualRecords.map((record) => [record.employeeNumber, record]),
  );
  const expectedByEmployee = new Map(
    expectedRecords.map((record) => [record.employeeNumber, record]),
  );

  for (const expected of expectedRecords) {
    const actual = actualByEmployee.get(expected.employeeNumber);
    if (!actual) {
      diffs.push({
        type: 'MISSING_IN_ACTUAL',
        employeeNumber: expected.employeeNumber,
        workerName: expected.workerName,
      });
      continue;
    }

    if (actual.currency !== expected.currency) {
      diffs.push({
        type: 'FIELD_MISMATCH',
        employeeNumber: expected.employeeNumber,
        workerName: expected.workerName || actual.workerName,
        field: 'currency',
        actual: actual.currency,
        expected: expected.currency,
      });
    }

    for (const column of AMOUNT_COLUMNS) {
      if (actual[column] !== expected[column]) {
        diffs.push({
          type: 'FIELD_MISMATCH',
          employeeNumber: expected.employeeNumber,
          workerName: expected.workerName || actual.workerName,
          field: column,
          actual: actual[column],
          expected: expected[column],
          delta: actual[column] - expected[column],
        });
      }
    }
  }

  for (const actual of actualRecords) {
    if (!expectedByEmployee.has(actual.employeeNumber)) {
      diffs.push({
        type: 'EXTRA_IN_ACTUAL',
        employeeNumber: actual.employeeNumber,
        workerName: actual.workerName,
      });
    }
  }

  return {
    diffs,
    totals: buildTotalsComparison(actualRecords, expectedRecords),
  };
}

function runReconciliation(actualText, expectedText, names = {}) {
  const actualName = names.actual || 'actual.csv';
  const expectedName = names.expected || 'expected.csv';
  const actual = loadInput(actualText, actualName);
  const expected = loadInput(expectedText, expectedName);
  const errors = [...actual.errors, ...expected.errors];
  const { diffs, totals } =
    errors.length === 0
      ? reconcile(actual.records, expected.records)
      : { diffs: [], totals: {} };

  return {
    ok: errors.length === 0 && diffs.length === 0,
    errors,
    diffs,
    totals,
    counts: {
      actualWorkers: actual.records.length,
      expectedWorkers: expected.records.length,
    },
  };
}

function printUsage() {
  console.log(`Usage:
  node reconcile-payroll.cjs --actual <ascenda.csv> --expected <pilot.csv> [--report <report.json>]
  node reconcile-payroll.cjs --selftest

Required CSV columns (integer minor units, no decimal point):
  employee_number,currency,gross_minor_units,deductions_minor_units,net_minor_units,employer_costs_minor_units

Optional column:
  worker_name

Exit codes: 0 = exact match / self-test passed, 1 = mismatch or invalid input.`);
}

function parseArgs(argv) {
  const options = {
    actual: null,
    expected: null,
    report: null,
    selftest: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--selftest') {
      options.selftest = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    const match = /^--(actual|expected|report)(?:=(.*))?$/.exec(arg);
    if (!match) {
      throw new Error(`unknown argument "${arg}"`);
    }
    const key = match[1];
    let value = match[2];
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--${key} requires a value`);
      }
      i += 1;
    }
    options[key] = value;
  }

  return options;
}

function printReport(result, actualPath, expectedPath) {
  console.log('Payroll parallel-run reconciliation');
  console.log(`Actual:   ${actualPath}`);
  console.log(`Expected: ${expectedPath}`);
  console.log(
    `Workers:  actual=${result.counts.actualWorkers} expected=${result.counts.expectedWorkers}`,
  );
  console.log('Tolerance: 0 minor units');
  console.log('');

  if (result.errors.length > 0) {
    console.log(`Structural errors (${result.errors.length}):`);
    for (const error of result.errors) {
      const location = error.line === null ? error.source : `${error.source}:${error.line}`;
      console.log(`  ${location} [${error.code}] ${error.message}`);
    }
    console.log('');
  }

  if (Object.keys(result.totals).length > 0) {
    console.log('Totals per currency (actual vs expected, minor units):');
    for (const [currency, fields] of Object.entries(result.totals)) {
      for (const column of AMOUNT_COLUMNS) {
        const value = fields[column];
        console.log(
          `  ${currency} ${column}: ${value.actual} vs ${value.expected} (delta ${value.delta})`,
        );
      }
    }
    console.log('');
  }

  if (result.diffs.length > 0) {
    console.log(`Diffs (${result.diffs.length}):`);
    for (const diff of result.diffs.slice(0, MAX_PRINTED_DIFFS)) {
      const name = diff.workerName ? ` (${diff.workerName})` : '';
      if (diff.type === 'FIELD_MISMATCH') {
        const delta = diff.delta === undefined ? '' : ` delta=${diff.delta}`;
        console.log(
          `  ${diff.employeeNumber}${name} ${diff.field}: actual=${diff.actual} expected=${diff.expected}${delta}`,
        );
      } else {
        console.log(`  ${diff.employeeNumber}${name} ${diff.type}`);
      }
    }
    if (result.diffs.length > MAX_PRINTED_DIFFS) {
      console.log(`  ... ${result.diffs.length - MAX_PRINTED_DIFFS} more in the JSON report`);
    }
    console.log('');
  }

  if (result.ok) {
    console.log(
      `PASS: ${result.counts.actualWorkers} workers matched exactly on gross, deductions, net and employer costs.`,
    );
  } else {
    console.log(
      `FAIL: ${result.errors.length} structural error(s), ${result.diffs.length} difference(s).`,
    );
  }
}

function runSelftest() {
  const header =
    'employee_number,currency,gross_minor_units,deductions_minor_units,net_minor_units,employer_costs_minor_units,worker_name\n';
  const base = `${header}E-1,NGN,100000,20000,80000,10000,Ada Alpha\n`;
  const oneMinorExpected = `${header}E-1,NGN,100001,20000,80001,10000,Ada Alpha\n`;
  const secondWorker = `${base}E-2,NGN,50000,10000,40000,5000,Ben Beta\n`;
  const failures = [];
  let checks = 0;

  function check(name, condition, details) {
    checks += 1;
    if (!condition) failures.push(`${name}${details ? `: ${details}` : ''}`);
  }

  let result = runReconciliation(base, base);
  check('exact match passes', result.ok, JSON.stringify(result.diffs));

  result = runReconciliation(base, oneMinorExpected);
  check('one-minor-unit diff fails', !result.ok);
  check('one-minor-unit diff reports gross', result.diffs.some((d) => d.field === 'gross_minor_units'));
  check('one-minor-unit diff reports net', result.diffs.some((d) => d.field === 'net_minor_units'));

  result = runReconciliation(base, secondWorker);
  check('missing worker fails', !result.ok);
  check(
    'missing worker reported',
    result.diffs.some((d) => d.type === 'MISSING_IN_ACTUAL' && d.employeeNumber === 'E-2'),
  );

  result = runReconciliation(secondWorker, base);
  check(
    'extra worker reported',
    result.diffs.some((d) => d.type === 'EXTRA_IN_ACTUAL' && d.employeeNumber === 'E-2'),
  );

  result = runReconciliation(`${header}E-1,NGN,100000,20000,80000,10000,\nE-1,NGN,1,0,1,0,\n`, base);
  check(
    'duplicate employee number rejected',
    result.errors.some((error) => error.code === 'DUPLICATE_EMPLOYEE_NUMBER'),
  );

  result = runReconciliation(`${header}E-1,NGN,1000.00,20000,80000,10000,\n`, base);
  check(
    'decimal amount rejected',
    result.errors.some((error) => error.code === 'BAD_AMOUNT'),
  );

  result = runReconciliation(`${header}E-1,NGN,100000,20000,1,10000,\n`, base);
  check(
    'inconsistent net rejected',
    result.errors.some((error) => error.code === 'NET_INCONSISTENT'),
  );

  result = runReconciliation(`${header}E-1,NAIRA,100000,20000,80000,10000,\n`, base);
  check(
    'invalid currency rejected',
    result.errors.some((error) => error.code === 'BAD_CURRENCY'),
  );

  result = runReconciliation('employee_number,currency,gross_minor_units\nE-1,NGN,1\n', base);
  check(
    'missing columns rejected',
    result.errors.some((error) => error.code === 'MISSING_COLUMNS'),
  );

  const crlf = `\uFEFF${header.replace(/\n/g, '\r\n')}"E,1",NGN,100000,20000,80000,10000,"Doe, Jane"\r\n`;
  result = runReconciliation(crlf, crlf);
  check('quoted fields, BOM and CRLF parse', result.ok, JSON.stringify(result.errors));

  result = runReconciliation(base, base.replace('NGN', 'EUR'));
  check(
    'currency mismatch reported',
    result.diffs.some((d) => d.field === 'currency'),
  );

  if (failures.length > 0) {
    console.error(`selftest FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }

  console.log(`selftest PASSED (${checks} checks)`);
  return 0;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  if (options.selftest) {
    process.exitCode = runSelftest();
    return;
  }

  if (!options.actual || !options.expected) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  let actualText;
  let expectedText;
  try {
    actualText = readTextFile(options.actual);
  } catch (error) {
    console.error(`Cannot read actual CSV "${options.actual}": ${error.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    expectedText = readTextFile(options.expected);
  } catch (error) {
    console.error(`Cannot read expected CSV "${options.expected}": ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const result = runReconciliation(actualText, expectedText, {
    actual: options.actual,
    expected: options.expected,
  });

  printReport(result, options.actual, options.expected);

  if (options.report) {
    const report = {
      generatedAt: new Date().toISOString(),
      actual: options.actual,
      expected: options.expected,
      toleranceMinorUnits: 0,
      ...result,
    };
    try {
      fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Report written to ${options.report}`);
    } catch (error) {
      console.error(`Cannot write report "${options.report}": ${error.message}`);
      process.exitCode = 1;
      return;
    }
  }

  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  readTextFile,
  parseCsv,
  parseRows,
  loadInput,
  reconcile,
  runReconciliation,
  runSelftest,
};
