// Deploy this script as a web app for the demo spreadsheet.
const PASS_SPREADSHEET_ID = '1YXDgWlNFhS4ONq7qlo33HgIgG4rYoFKYmotsLh5cxnY';
const PASS_FIELDS = [
  'id', 'studentId', 'studentName', 'className', 'exitDate', 'exitTime',
  'exitAt', 'timeZone', 'createdAt', 'version', 'type', 'qrPayload'
];
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
      request && (request.action === 'students' || request.action === 'createPass' || request.action === 'studentPasses'),
      'Неизвестная операция.'
    );
    const book = SpreadsheetApp.openById(PASS_SPREADSHEET_ID);
    if (request.action === 'students') {
      return passResponse_({ ok: true, students: readStudents_(book) });
    }
    if (request.action === 'studentPasses') {
      return passResponse_({ ok: true, passes: readStudentPasses_(book, request) });
    }
    requirePass_(request.action === 'createPass', 'Неизвестная операция.');
    return passResponse_({ ok: true, pass: savePass_(book, request.pass) });
  } catch (error) {
    return passResponse_({
      ok: false,
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
  data.rows.forEach(row => {
    if (Number(row[data.columns.studentId]) !== student.studentId
      || String(row[data.columns.className]).trim() !== student.className) return;
    const qrPayload = row[data.columns.qrPayload];
    let pass;
    try { pass = JSON.parse(qrPayload); } catch (error) {
      failPass_('Повреждён QR-код пропуска выбранного ученика. Обратитесь к учителю.');
    }
    requirePass_(typeof qrPayload === 'string' && pass && pass.version === 1
      && pass.type === 'school-exit-pass' && typeof pass.id === 'string'
      && pass.id === row[data.columns.id] && pass.studentId === student.studentId
      && pass.className === student.className && typeof pass.studentName === 'string'
      && pass.studentName === row[data.columns.studentName]
      && pass.timeZone === 'Europe/Moscow' && typeof pass.exitAt === 'string'
      && Number.isFinite(new Date(pass.exitAt).getTime()),
      'Данные пропуска не совпадают с QR-кодом. Обратитесь к учителю.');
    const record = {};
    QR_FIELDS.forEach(field => { record[field] = pass[field]; });
    record.qrPayload = qrPayload;
    // Derive display values from the same instant as the immutable QR.
    record.exitDate = Utilities.formatDate(new Date(pass.exitAt), 'Europe/Moscow', 'yyyy-MM-dd');
    record.exitTime = Utilities.formatDate(new Date(pass.exitAt), 'Europe/Moscow', 'HH:mm');
    passes.push(record);
  });
  return passes.sort((a, b) => new Date(b.exitAt) - new Date(a.exitAt) || a.id.localeCompare(b.id));
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
    return pass;
  } finally {
    lock.releaseLock();
  }
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

function requirePass_(condition, message) {
  if (!condition) failPass_(message);
}

function failPass_(message) {
  const error = new Error(message);
  error.passMessage = message;
  throw error;
}
