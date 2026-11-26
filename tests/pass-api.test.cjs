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
      getRange(row, column) {
        return {
          setValues(records) {
            assert(held, 'A write must hold the script lock');
            values[row - 1] = records[0];
          },
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
      formatDate: date => new Date(date.getTime() + 3 * 3600000).toISOString().slice(0, 19) + '+03:00'
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
