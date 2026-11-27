// Deploy this script as a web app for the demo spreadsheet.
const PASS_SPREADSHEET_ID = '1YXDgWlNFhS4ONq7qlo33HgIgG4rYoFKYmotsLh5cxnY';
const PASS_FIELDS = [
  'id', 'studentId', 'studentName', 'className', 'exitDate', 'exitTime',
  'exitAt', 'timeZone', 'createdAt', 'version', 'type', 'qrPayload'
];
const PASS_RETENTION_MS = 30 * 60 * 1000;

const QR_FIELDS = [
  'version', 'type', 'id', 'studentId', 'studentName',
  'className', 'exitAt', 'timeZone', 'createdAt'
];

function doPost(event) {
  try {
    const contents = event && event.postData && event.postData.contents;
    requirePass_(typeof contents === 'string' && contents.length <= 16000, 'Некорректный запрос.');
    let request;
    try {
      request = JSON.parse(contents);
    } catch (error) {
      failPass_('Некорректный JSON.');
    }
    requirePass_(
      request && (request.action === 'students' || request.action === 'createPass' || request.action === 'studentPasses'
        || request.action === 'searchPasses' || request.action === 'consumePass'),
      'Неизвестная операция.'
    );
    const book = SpreadsheetApp.openById(PASS_SPREADSHEET_ID);
    if (request.action === 'students') {
      return passResponse_({ ok: true, students: readStudents_(book) });
    }
    if (request.action === 'searchPasses') {
      return passResponse_({ ok: true, passes: searchPasses_(book, request.query) });
    }
    if (request.action === 'consumePass') {
      return passResponse_(Object.assign({ ok: true }, consumePass_(book, request)));
    }
    if (request.action === 'studentPasses') {
      const result = readStudentPasses_(book, request);
      const response = { ok: true, passes: result.passes };
      if (result.warnings.length) response.warnings = result.warnings;
      return passResponse_(response);
    }
    requirePass_(request.action === 'createPass', 'Неизвестная операция.');
    return passResponse_({ ok: true, pass: savePass_(book, request.pass) });
  } catch (error) {
    return passResponse_({
      ok: false,
      code: error.passCode || 'REQUEST_FAILED',
      error: error.passMessage || 'Ошибка обработчика. Проверьте доступ скрипта к таблице и названия листов.'
    });
  }
}

function readStudents_(book) {
  const data = getSheetData_(book, 'Ученики', ['studentId', 'studentName', 'className']);
  const seen = new Set();
  return data.rows.filter(row => row.some(value => value !== '')).map(row => {
    const studentId = Number(row[data.columns.studentId]);
    const studentName = String(row[data.columns.studentName]).trim();
    const className = String(row[data.columns.className]).trim();
    requirePass_(
      Number.isSafeInteger(studentId) && studentId > 0 && !seen.has(studentId) &&
      studentName.length > 0 && studentName.length <= 200 &&
      className.length > 0 && className.length <= 30,
      'Проверьте ID, ФИО и класс на листе Ученики. ID должны быть уникальными положительными числами.'
    );
    seen.add(studentId);
    return { studentId: studentId, studentName: studentName, className: className };
  });
}

// Read-only demo endpoint: select by BOTH stable student ID and exact class.
// Never regenerate the stored QR string or the teacher's original UUID.
function readStudentPasses_(book, request) {
  requirePass_(Number.isSafeInteger(request.studentId) && request.studentId > 0
    && typeof request.className === 'string' && request.className.length > 0
    && request.className.length <= 30, 'Выберите ученика и класс.');
  const student = readStudents_(book).find(row => row.studentId === request.studentId
    && row.className === request.className);
  requirePass_(student, 'Ученик не найден в выбранном классе. Обновите список учеников.');
  const data = getSheetData_(book, 'Пропуска', PASS_FIELDS);
  const passes = [];
  const warnings = [];
  const now = Date.now();
  data.rows.forEach((row, index) => {
    if (Number(row[data.columns.studentId]) !== student.studentId
      || String(row[data.columns.className]).trim() !== student.className) return;
    const rowNumber = index + 2;
    try {
      const qrPayload = row[data.columns.qrPayload];
      const pass = readPassRow_(row, data.columns);
      if (row[data.columns.usedAt] || passExpiration_(pass) <= now) return;
      const record = {};
      QR_FIELDS.forEach(field => { record[field] = pass[field]; });
      record.qrPayload = qrPayload;
      record.exitDate = Utilities.formatDate(new Date(pass.exitAt), 'Europe/Moscow', 'yyyy-MM-dd');
      record.exitTime = Utilities.formatDate(new Date(pass.exitAt), 'Europe/Moscow', 'HH:mm');
      record.rowNumber = rowNumber;
      record.sheetUrl = 'https://docs.google.com/spreadsheets/d/' + PASS_SPREADSHEET_ID
        + '/edit#gid=' + data.sheet.getSheetId() + '&range=A' + rowNumber;
      passes.push(record);
    } catch (error) {
      warnings.push({
        rowNumber: rowNumber,
        message: error.passMessage || 'Не удалось прочитать строку пропуска.'
      });
    }
  });
  return {
    passes: passes.sort((a, b) => new Date(b.exitAt) - new Date(a.exitAt) || a.id.localeCompare(b.id)),
    warnings: warnings
  };
}

function savePass_(book, input) {
  requirePass_(input && input.version === 1 && input.type === 'school-exit-pass', 'Неверный формат пропуска.');
  requirePass_(
    typeof input.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id),
    'Некорректный ID пропуска.'
  );
  requirePass_(
    typeof input.exitAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+03:00$/.test(input.exitAt) &&
    input.timeZone === 'Europe/Moscow',
    'Проверьте дату и время выхода.'
  );
  const exit = new Date(input.exitAt);
  requirePass_(
    Number.isFinite(exit.getTime()) &&
    Utilities.formatDate(exit, 'Europe/Moscow', "yyyy-MM-dd'T'HH:mm:ssXXX") === input.exitAt,
    'Некорректная дата выхода.'
  );
  requirePass_(
    typeof input.createdAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.createdAt) &&
    Number.isFinite(new Date(input.createdAt).getTime()) &&
    new Date(input.createdAt).toISOString() === input.createdAt,
    'Некорректная дата создания.'
  );
  const lock = LockService.getScriptLock();
  requirePass_(lock.tryLock(10000), 'Таблица занята. Повторите отправку.');
  try {
    requirePass_(passExpiration_(input) > Date.now(), 'Срок действия пропуска истёк. Выберите другое время выхода.');
    const student = readStudents_(book).find(row => row.studentId === input.studentId);
    requirePass_(student, 'Ученик с таким ID отсутствует в таблице.');
    requirePass_(
      student.studentName === input.studentName && student.className === input.className,
      'Данные ученика изменились. Обновите подключение к таблице.'
    );
    const pass = {};
    QR_FIELDS.forEach(field => { pass[field] = input[field]; });
    const data = getSheetData_(book, 'Пропуска', PASS_FIELDS);
    const existing = data.rows.find(row => row[data.columns.id] === pass.id);
    if (existing) {
      requirePass_(!existing[data.columns.usedAt], 'Пропуск уже использован. Создайте новый пропуск.', 'PASS_USED');
      let stored;
      try {
        stored = JSON.parse(existing[data.columns.qrPayload]);
      } catch (error) {
        failPass_('В таблице повреждены данные этого пропуска.');
      }
      requirePass_(
        stored && QR_FIELDS.every(field => stored[field] === pass[field]),
        'Этот ID уже используется для другого пропуска.'
      );
      return stored;
    }
    if (book.getSpreadsheetTimeZone() !== 'Europe/Moscow') {
      book.setSpreadsheetTimeZone('Europe/Moscow');
    }
    const record = Object.assign({}, pass, {
      exitDate: new Date(pass.exitAt.slice(0, 10) + 'T00:00:00+03:00'),
      exitTime: (Number(pass.exitAt.slice(11, 13)) * 60 + Number(pass.exitAt.slice(14, 16))) / 1440,
      qrPayload: JSON.stringify(pass)
    });
    const nextRow = data.sheet.getLastRow() + 1;
    data.sheet.getRange(nextRow, 1, 1, data.headers.length).setValues([
      data.headers.map(field => Object.prototype.hasOwnProperty.call(record, field) ? record[field] : '')
    ]);
    data.sheet.getRange(nextRow, data.columns.exitDate + 1).setNumberFormat('dd.MM.yyyy');
    data.sheet.getRange(nextRow, data.columns.exitTime + 1).setNumberFormat('HH:mm');
    SpreadsheetApp.flush();
    const written = data.sheet.getRange(nextRow, 1, 1, data.headers.length).getValues()[0];
    requirePass_(
      written && written[data.columns.id] === pass.id &&
      Number(written[data.columns.studentId]) === pass.studentId &&
      written[data.columns.studentName] === pass.studentName &&
      written[data.columns.className] === pass.className &&
      written[data.columns.qrPayload] === record.qrPayload,
      'Не удалось подтвердить запись строки. Повторите отправку с тем же ID.'
    );
    return pass;
  } finally {
    lock.releaseLock();
  }
}


function searchPasses_(book, query) {
  requirePass_(typeof query === 'string' && query.length <= 200, 'Укажите ФИО для поиска.');
  const tokens = normalizePassName_(query).split(/\s+/).filter(Boolean);
  const data = getSheetData_(book, 'Пропуска', PASS_FIELDS);
  const now = Date.now();
  const passes = [];
  data.rows.forEach(row => {
    if (row[data.columns.usedAt]) return;
    let pass;
    try {
      pass = readPassRow_(row, data.columns);
    } catch (error) {
      return;
    }
    if (passExpiration_(pass) <= now) return;
    const name = normalizePassName_(pass.studentName);
    if (tokens.every(token => name.includes(token))) {
      const result = {};
      QR_FIELDS.forEach(field => { result[field] = pass[field]; });
      passes.push(result);
    }
  });
  return passes.sort((a, b) => a.studentName.localeCompare(b.studentName, 'ru')
    || new Date(a.exitAt) - new Date(b.exitAt));
}

function normalizePassName_(name) {
  return name.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').trim();
}

function consumePass_(book, request) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  requirePass_(typeof request.operationId === 'string' && uuid.test(request.operationId),
    'Некорректный ID операции.');
  let scanned;
  if (request.qrPayload !== undefined) {
    requirePass_(typeof request.qrPayload === 'string' && request.qrPayload.length <= 10000,
      'Некорректный QR-код.', 'PASS_MISMATCH');
    try {
      scanned = JSON.parse(request.qrPayload);
    } catch (error) {
      failPass_('Этот QR-код не является пропуском.', 'PASS_MISMATCH');
    }
    requirePass_(scanned && scanned.version === 1 && scanned.type === 'school-exit-pass',
      'Этот QR-код не является пропуском.', 'PASS_MISMATCH');
  }
  const passId = scanned ? scanned.id : request.passId;
  requirePass_(typeof passId === 'string' && uuid.test(passId), 'Некорректный ID пропуска.', 'PASS_MISMATCH');
  requirePass_(!scanned || request.passId === undefined || request.passId === passId,
    'Данные QR-кода не совпадают с пропуском.', 'PASS_MISMATCH');
  const lock = LockService.getScriptLock();
  requirePass_(lock.tryLock(10000), 'Проверка занята. Повторите отправку.');
  try {
    let data = getSheetData_(book, 'Пропуска', PASS_FIELDS);
    const index = data.rows.findIndex(row => row[data.columns.id] === passId);
    requirePass_(index >= 0, 'Пропуск не найден или уже удалён.', 'PASS_NOT_FOUND');
    const pass = readPassRow_(data.rows[index], data.columns);
    requirePass_(!scanned || QR_FIELDS.every(field => scanned[field] === pass[field]),
      'Данные QR-кода не совпадают с выданным пропуском.', 'PASS_MISMATCH');
    const current = data.rows[index];
    if (current[data.columns.usedAt]) {
      requirePass_(current[data.columns.useOperationId] === request.operationId,
        'Пропуск уже использован. Повторный выход по нему запрещён.', 'PASS_USED');
      return {
        pass: pass,
        consumption: { operationId: request.operationId, usedAt: current[data.columns.usedAt] }
      };
    }
    requirePass_(passExpiration_(pass) > Date.now(), 'Срок действия пропуска истёк.', 'PASS_EXPIRED');

    const missing = ['usedAt', 'useOperationId'].filter(field => data.columns[field] === undefined);
    if (missing.length) {
      data.sheet.getRange(1, data.headers.length + 1, 1, missing.length).setValues([missing]);
      SpreadsheetApp.flush();
      data = getSheetData_(book, 'Пропуска', PASS_FIELDS);
    }
    const rowNumber = index + 2;
    const range = data.sheet.getRange(rowNumber, 1, 1, data.headers.length);
    const formulas = range.getFormulas()[0];
    const updated = data.rows[index].map((value, column) => formulas[column] || value);
    data.sheet.getRange(rowNumber, data.columns.usedAt + 1).setNumberFormat('@');
    data.sheet.getRange(rowNumber, data.columns.useOperationId + 1).setNumberFormat('@');
    const decisionTime = Date.now();
    requirePass_(passExpiration_(pass) > decisionTime, 'Срок действия пропуска истёк.', 'PASS_EXPIRED');
    const usedAt = new Date(decisionTime).toISOString();
    updated[data.columns.usedAt] = usedAt;
    updated[data.columns.useOperationId] = request.operationId;
    range.setValues([updated]);
    SpreadsheetApp.flush();
    const stored = range.getValues()[0];
    requirePass_(stored[data.columns.id] === passId &&
      stored[data.columns.usedAt] === usedAt &&
      stored[data.columns.useOperationId] === request.operationId,
      'Ответ о погашении не подтверждён. Повторите отправку с тем же ID операции.');
    return { pass: pass, consumption: { operationId: request.operationId, usedAt: usedAt } };
  } finally {
    lock.releaseLock();
  }
}

// Run once as the spreadsheet owner to enable cleanup while the sites are closed.
function enablePassCleanup() {
  const lock = LockService.getScriptLock();
  requirePass_(lock.tryLock(10000), 'Таблица занята. Повторите включение очистки.');
  try {
    const installed = ScriptApp.getProjectTriggers().some(trigger =>
      trigger.getHandlerFunction() === 'cleanupExpiredPasses'
    );
    if (!installed) {
      ScriptApp.newTrigger('cleanupExpiredPasses').timeBased().everyMinutes(1).create();
    }
  } finally {
    lock.releaseLock();
  }
  return cleanupExpiredPasses();
}

function cleanupExpiredPasses() {
  const lock = LockService.getScriptLock();
  requirePass_(lock.tryLock(10000), 'Таблица занята. Очистка повторится при следующем запуске.');
  try {
    const book = SpreadsheetApp.openById(PASS_SPREADSHEET_ID);
    const data = getSheetData_(book, 'Пропуска', PASS_FIELDS);
    const now = Date.now();
    const expiredRows = [];
    data.rows.forEach((row, index) => {
      let pass;
      try {
        pass = readPassRow_(row, data.columns);
      } catch (error) {
        // Incomplete rows are reported by studentPasses and require manual correction.
        return;
      }
      if (passExpiration_(pass) <= now) expiredRows.push(index + 2);
    });
    // Delete from the bottom so earlier row numbers remain valid.
    expiredRows.reverse().forEach(rowNumber => data.sheet.deleteRow(rowNumber));
    SpreadsheetApp.flush();
    return { deletedCount: expiredRows.length };
  } finally {
    lock.releaseLock();
  }
}

function passExpiration_(pass) {
  return new Date(pass.exitAt).getTime() + PASS_RETENTION_MS;
}

function readPassRow_(row, columns) {
  const qrPayload = row[columns.qrPayload];
  let pass;
  try {
    pass = JSON.parse(qrPayload);
  } catch (error) {
    failPass_('Повреждён или не заполнен QR-код.');
  }
  requirePass_(typeof qrPayload === 'string' && pass && pass.version === 1
    && pass.type === 'school-exit-pass' && typeof pass.id === 'string'
    && pass.id === row[columns.id] && pass.studentId === Number(row[columns.studentId])
    && pass.className === String(row[columns.className]).trim()
    && typeof pass.studentName === 'string' && pass.studentName === row[columns.studentName]
    && pass.timeZone === 'Europe/Moscow' && typeof pass.exitAt === 'string'
    && Number.isFinite(new Date(pass.exitAt).getTime()),
    'Данные строки не совпадают с QR-кодом.');
  return pass;
}

function getSheetData_(book, name, requiredFields) {
  const sheet = book.getSheetByName(name);
  requirePass_(sheet, 'Не найден лист ' + name + '.');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(value => String(value).trim());
  requirePass_(new Set(headers).size === headers.length, 'Повторяются заголовки на листе ' + name + '.');
  const columns = Object.create(null);
  headers.forEach((field, index) => { columns[field] = index; });
  requiredFields.forEach(field => {
    requirePass_(Object.prototype.hasOwnProperty.call(columns, field), 'Не найден столбец ' + field + ' на листе ' + name + '.');
  });
  return { sheet: sheet, headers: headers, columns: columns, rows: values.slice(1) };
}

function passResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function requirePass_(condition, message, code) {
  if (!condition) failPass_(message, code);
}

function failPass_(message, code) {
  const error = new Error(message);
  error.passMessage = message;
  error.passCode = code;
  throw error;
}
