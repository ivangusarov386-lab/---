const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../integration/Code.gs'), 'utf8');
const headers = [
  'id', 'studentId', 'studentName', 'className', 'exitDate', 'exitTime',
  'exitAt', 'timeZone', 'createdAt', 'version', 'type', 'qrPayload'
];
const example = {
  version: 1, type: 'school-exit-pass',
  id: 'd4f0378c-8f03-46f5-8e8c-68d74e61db3a',
  studentId: 1, studentName: 'Александров Артём', className: '9А',
  exitAt: '2026-11-27T14:30:00+03:00', timeZone: 'Europe/Moscow',
  createdAt: '2026-11-26T18:00:00.000Z'
};

function fixture(options = {}) {
  let held = false;
  let releases = 0;
  let opens = 0;
  let failFlush = options.failFlush;
  const rows = [options.headers || [...headers]];
  function sheet(values) {
    return {
      getDataRange: () => ({ getValues: () => values }),
      getLastRow: () => values.length,
      getSheetId: () => 123,
      getRange(row, column) {
        return {
          setValues(records) {
            assert(held, 'A write must hold the script lock');
            values[row - 1] = records[0];
          },
          getValues: () => [values[row - 1]],
          setNumberFormat() {}
        };
      }
    };
  }
  const book = {
    getSpreadsheetTimeZone: () => 'UTC',
    setSpreadsheetTimeZone: zone => assert.equal(zone, 'Europe/Moscow'),
    getSheetByName(name) {
      if (name === 'Ученики') return sheet([
        ['studentId', 'studentName', 'className'],
        [1, example.studentName, '9А'],
        [2, 'Васильева София', '9А']
      ]);
      if (name === 'Пропуска') return sheet(rows);
      return null;
    }
  };
  const context = vm.createContext({
    SpreadsheetApp: {
      openById: () => { opens++; return book; },
      flush: () => {
        if (failFlush) { failFlush = false; throw new Error('Simulated interrupted confirmation'); }
      }
    },
    Utilities: {
      formatDate: (date, zone, format) => {
        assert.equal(zone, 'Europe/Moscow');
        const value = new Date(date.getTime() + 3 * 3600000).toISOString();
        return format === 'yyyy-MM-dd' ? value.slice(0, 10) : format === 'HH:mm' ? value.slice(11, 16) : value.slice(0, 19) + '+03:00';
      }
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (options.busy) return false;
          assert.equal(held, false);
          held = true;
          return true;
        },
        releaseLock: () => { held = false; releases++; }
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ setMimeType: () => text })
    }
  });
  vm.runInContext(source, context);
  return {
    rows,
    get releases() { return releases; },
    get opens() { return opens; },
    request(body) {
      return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }));
    }
  };
}
function create(api, pass = example) {
  return api.request({ action: 'createPass', pass });
}

test('unknown actions and invalid requests are rejected without opening the spreadsheet', () => {
  const api = fixture();
  for (const request of [null, {}, {action: 'deletePass'}]) {
    assert.equal(api.request(request).ok, false);
  }
  assert.equal(api.opens, 0);
  assert.equal(api.rows.length, 1);
});

test('roster returns stable numeric IDs and exact names', () => {
  const api = fixture();
  const result = api.request({ action: 'students' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.students[0], {
    studentId: 1, studentName: example.studentName, className: '9А'
  });
});

test('pass is stored with the QR payload and native date/time values', () => {
  const api = fixture();
  assert.deepEqual(create(api), { ok: true, pass: example });
  assert.equal(api.rows.length, 2);
  const stored = Object.fromEntries(headers.map((header, index) => [header, api.rows[1][index]]));
  assert.deepEqual(JSON.parse(stored.qrPayload), example);
  assert.equal(stored.exitTime, 870 / 1440);
  assert.equal(stored.exitDate.toISOString(), '2026-11-26T21:00:00.000Z');
  assert.equal(api.releases, 1);
});

test('retries return the stored pass and conflicting reuse of ID is rejected', () => {
  const api = fixture();
  create(api);
  assert.deepEqual(create(api), { ok: true, pass: example });
  assert.equal(create(api, { ...example, exitAt: '2026-11-27T15:00:00+03:00' }).ok, false);
  assert.equal(api.rows.length, 2);
  assert.equal(api.releases, 3);
});

test('an interrupted confirmation after writing can be retried without a duplicate', () => {
  const api = fixture({ failFlush: true });
  assert.equal(create(api).ok, false);
  assert.deepEqual(create(api), { ok: true, pass: example });
  assert.equal(api.rows.length, 2);
  assert.equal(api.releases, 2);
});

test('invalid identity, dates and timestamps are rejected without writes', () => {
  const api = fixture();
  for (const change of [
    { studentId: 999 }, { studentId: '1' }, { studentName: 'Other student' },
    { className: '9Ц' }, { exitAt: '2026-02-30T14:30:00+03:00' },
    { exitAt: '2026-11-27T25:30:00+03:00' }, { timeZone: 'UTC' },
    { createdAt: '2026-02-30T18:00:00.000Z' }, { id: '=formula()' }
  ]) assert.equal(create(api, { ...example, ...change }).ok, false);
  assert.equal(api.rows.length, 1);
});

test('a busy lock and missing required columns prevent writes', () => {
  const busy = fixture({ busy: true });
  assert.equal(create(busy).ok, false);
  assert.equal(busy.rows.length, 1);
  const missing = fixture({ headers: headers.filter(field => field !== 'qrPayload') });
  assert.equal(create(missing).ok, false);
  assert.equal(missing.rows.length, 1);
  assert.equal(missing.releases, 1);
});

test('reordered columns are mapped by name', () => {
  const reversed = [...headers].reverse();
  const api = fixture({ headers: reversed });
  assert.equal(create(api).ok, true);
  assert.equal(api.rows[1][reversed.indexOf('studentId')], 1);
  assert.deepEqual(JSON.parse(api.rows[1][reversed.indexOf('qrPayload')]), example);
});

function readPasses(api, studentId = 1, className = '9А') {
  return api.request({ action: 'studentPasses', studentId, className });
}
test('studentPasses is read-only and initially empty', () => {
  const api = fixture();
  assert.deepEqual(readPasses(api), { ok: true, passes: [] });
  assert.equal(api.rows.length, 1);
  assert.equal(api.releases, 0);
});
test('a new teacher pass appears with the exact stored UTF-8 payload and original ID', () => {
  const api = fixture();
  assert.equal(readPasses(api).passes.length, 0);
  create(api);
  // Preserve whitespace and Cyrillic byte-for-byte; never reserialize a QR.
  const payload = JSON.stringify(example, null, 2);
  api.rows[1][headers.indexOf('qrPayload')] = payload;
  assert.deepEqual(readPasses(api), { ok: true, passes: [{ ...example, qrPayload: payload,
    exitDate: '2026-11-27', exitTime: '14:30', rowNumber: 2,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/1YXDgWlNFhS4ONq7qlo33HgIgG4rYoFKYmotsLh5cxnY/edit#gid=123&range=A2' }] });
  assert.equal(api.rows.length, 2);
  assert.equal(api.releases, 1);
});
test('ID AND class are required, never disclose another student pass', () => {
  const api = fixture();
  create(api);
  create(api, { ...example, id: '8eeb7b42-0ef3-4ee5-bcbd-167ab1b144f3', studentId: 2, studentName: 'Васильева София' });
  assert.equal(readPasses(api).passes.length, 1);
  assert.equal(readPasses(api).passes[0].studentId, 1);
  assert.equal(readPasses(api, 2).passes[0].studentId, 2);
  for (const [id, name] of [[1, '9Ц'], ['1', '9А'], [999, '9А'], [1, '']]) {
    const result = readPasses(api, id, name);
    assert.equal(result.ok, false);
    assert.equal(result.passes, undefined);
  }
});
test('foreign and empty rows are ignored before parsing their payload', () => {
  const api = fixture();
  create(api);
  const foreign = [...api.rows[1]];
  foreign[headers.indexOf('studentId')] = 999;
  foreign[headers.indexOf('qrPayload')] = 'invalid';
  api.rows.push(foreign, Array(headers.length).fill(''));
  assert.equal(readPasses(api).passes.length, 1);
});
test('a substituted QR identity or ID is excluded with a row warning', () => {
  for (const change of [{ studentId: 2 }, { className: '9Ц' }, { id: 'another-id' }]) {
    const api = fixture(); create(api);
    api.rows[1][headers.indexOf('qrPayload')] = JSON.stringify({ ...example, ...change });
    const result = readPasses(api);
    assert.equal(result.ok, true);
    assert.deepEqual(result.passes, []);
    assert.equal(result.warnings[0].rowNumber, 2);
  }
});
test('reading reordered columns preserves IDs and orders latest exit first', () => {
  const api = fixture({ headers: [...headers].reverse() });
  create(api);
  const next = { ...example, id: '8eeb7b42-0ef3-4ee5-bcbd-167ab1b144f3', exitAt: '2026-11-28T09:15:00+03:00' };
  create(api, next);
  const result = readPasses(api);
  assert.equal(result.ok, true);
  assert.deepEqual(result.passes.map(pass => pass.id), [next.id, example.id]);
  assert.equal(result.passes[0].exitTime, '09:15');
});

test('malformed QR data for the selected student produces a row warning', () => {
  const api = fixture();
  create(api);
  api.rows[1][headers.indexOf('qrPayload')] = '{bad';
  const result = readPasses(api);
  assert.equal(result.ok, true);
  assert.deepEqual(result.passes, []);
  assert.match(result.warnings[0].message, /Повреждён/);
  assert.equal(result.warnings[0].rowNumber, 2);
});


test('a cleared old row does not hide a newly issued pass for the same pupil', () => {
  const api = fixture();
  create(api);
  // Reproduce a partial old example row left in the imported spreadsheet.
  for (let column = 4; column < headers.length; column++) api.rows[1][column] = '';
  const fresh = {
    ...example, id: '8eeb7b42-0ef3-4ee5-bcbd-167ab1b144f3',
    exitAt: '2026-11-27T23:54:00+03:00'
  };
  assert.equal(create(api, fresh).ok, true);
  const result = readPasses(api);
  assert.equal(result.ok, true);
  assert.equal(result.passes.length, 1);
  assert.equal(result.passes[0].id, fresh.id);
  assert.equal(result.passes[0].rowNumber, 3);
  assert.equal(result.passes[0].exitTime, '23:54');
  assert.equal(result.warnings[0].rowNumber, 2);
});
