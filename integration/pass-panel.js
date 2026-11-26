const DEFAULT_PASS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyanuYCJH_cSy_9_r0bLJLvzF0BG0jAUrpIlpycOXpDr_mtd64_9tVrTU122JWmQilV6Q/exec';
let passStudents = [];
let passConnection = { endpoint: DEFAULT_PASS_ENDPOINT };
let passConnectionReady = false;
let passConnecting = false;
let passConnectionMessage = '';
let passPupilId = null;
let pendingExitPass = null;
let passSending = false;

function initializePasses() {
  passStudents = P.map(p => ({ studentId: p.id + 1, studentName: p.name, className: '9А' }));
  try {
    passConnection.endpoint = localStorage.getItem('school-pass-endpoint') || DEFAULT_PASS_ENDPOINT;
    sessionStorage.removeItem('school-pass-teacher-key');
    const saved = sessionStorage.getItem('school-pass-pending');
    if (saved) pendingExitPass = JSON.parse(saved);
  } catch (error) {
    // The connection can also be used in memory when browser storage is unavailable.
  }
}

function renderPassList() {
  const notice = passConnectionMessage || (passConnectionReady
    ? 'Таблица подключена. Учеников — ' + passStudents.length + '.'
    : 'Подключение к таблице выполняется при открытии раздела.');
  return card('Подключение пропусков', `
    <p id="pass-connection-status" role="status">${esc(notice)}</p>
    <details>
      <summary>Настройки подключения</summary>
      <form onsubmit="connectPassTable(event)" class="pass-settings">
        <label>Адрес веб-приложения Google Apps Script
          <input name="endpoint" type="url" required value="${esc(passConnection.endpoint)}"
            placeholder="https://script.google.com/macros/s/…/exec">
        </label>
        <button type="submit" ${passConnecting ? 'disabled' : ''}>Подключить таблицу</button>
        <a href="https://github.com/ivangusarov386-lab/---/blob/main/integration/README.md" target="_blank" rel="noopener">Инструкция подключения</a>
      </form>
    </details>
  `) + '<div class="pass-list">' + card('Ученики', table(
    ['Ученик', 'Класс', 'Пропуск'],
    passStudents.map(p => row([
      esc(p.studentName),
      esc(p.className),
      `<button type="button" onclick="openExitPass(${p.studentId})">Выдать пропуск</button>`
    ]))
  )) + '</div>';
}

function validatePassConnection(connection) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(connection.endpoint)) {
    throw new Error('Укажите адрес опубликованного веб-приложения Google Apps Script, заканчивающийся на /exec.');
  }
}

async function requestPassApi(connection, action, pass) {
  validatePassConnection(connection);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(connection.endpoint, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action, pass }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Обработчик недоступен. Проверьте публикацию Google Apps Script.');
    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error('Обработчик вернул неверный ответ. Проверьте адрес /exec и доступ веб-приложения.');
    }
    if (!result || result.ok !== true) {
      if (result?.error === 'Проверьте ключ учителя.') {
        throw new Error('Обновите развертывание Google Apps Script по инструкции подключения.');
      }
      throw new Error(typeof result?.error === 'string' ? result.error : 'Таблица не подтвердила операцию.');
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) {
      throw new Error('Ответ таблицы не получен. Проверьте соединение и повторите отправку. ID пропуска сохранён для повтора.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function connectPassTable(event) {
  if (event) event.preventDefault();
  if (passConnecting) return;
  const form = event?.target;
  const connection = {
    endpoint: form ? form.elements.endpoint.value.trim() : passConnection.endpoint
  };
  passConnecting = true;
  passConnectionMessage = 'Подключаем таблицу…';
  const button = document.querySelector('.pass-settings button');
  if (button) button.disabled = true;
  if (page === 'passes') $('pass-connection-status').textContent = passConnectionMessage;
  try {
    const result = await requestPassApi(connection, 'students');
    if (!Array.isArray(result.students) || !result.students.every(p =>
      Number.isSafeInteger(p.studentId) && p.studentId > 0 &&
      typeof p.studentName === 'string' && typeof p.className === 'string'
    ) || new Set(result.students.map(p => p.studentId)).size !== result.students.length) {
      throw new Error('Проверьте список учеников в таблице.');
    }
    passConnection = connection;
    passStudents = result.students;
    passConnectionReady = true;
    try {
      localStorage.setItem('school-pass-endpoint', connection.endpoint);
    } catch (error) {
      // An unavailable storage does not prevent sending during this page visit.
    }
    passConnectionMessage = '';
  } catch (error) {
    passConnectionMessage = error.message;
  } finally {
    passConnecting = false;
    if (page === 'passes') render();
  }
}

function openExitPass(studentId) {
  if (!passConnectionReady) {
    $('pass-connection-status').textContent = passConnecting ? 'Дождитесь подключения к таблице.' : 'Проверьте подключение к таблице в настройках.';
    document.querySelector('.pass-settings input').focus();
    return;
  }
  const pupil = passStudents.find(p => p.studentId === studentId);
  if (!pupil) return;
  passPupilId = studentId;
  const now = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const parts = Object.fromEntries(now.map(part => [part.type, part.value]));
  const form = $('exit-pass-form');
  const retry = pendingExitPass && pendingExitPass.studentId === studentId;
  form.elements.exitDate.value = retry ? pendingExitPass.exitAt.slice(0, 10) : `${parts.year}-${parts.month}-${parts.day}`;
  form.elements.exitTime.value = retry ? pendingExitPass.exitAt.slice(11, 16) : `${parts.hour}:${parts.minute}`;
  form.hidden = false;
  $('exit-pass-title').textContent = 'Выдать пропуск';
  $('exit-pass-student').textContent = pupil.studentName + ' · ' + pupil.className;
  $('exit-pass-result').hidden = true;
  $('exit-pass-qr').replaceChildren();
  $('exit-pass-departure').textContent = '';
  $('exit-pass-error').hidden = true;
  $('exit-pass-progress').textContent = '';
  $('exit-pass-dialog').showModal();
}

async function createExitPass(event) {
  event.preventDefault();
  const form = event.target;
  if (passSending || !form.reportValidity()) return;
  const pupil = passStudents.find(p => p.studentId === passPupilId);
  if (!pupil || !passConnectionReady) return;
  const exitAt = `${form.elements.exitDate.value}T${form.elements.exitTime.value}:00+03:00`;
  const reuse = pendingExitPass && pendingExitPass.studentId === pupil.studentId &&
    pendingExitPass.studentName === pupil.studentName && pendingExitPass.className === pupil.className &&
    pendingExitPass.exitAt === exitAt;
  const payload = reuse ? pendingExitPass : {
    version: 1,
    type: 'school-exit-pass',
    id: crypto.randomUUID(),
    studentId: pupil.studentId,
    studentName: pupil.studentName,
    className: pupil.className,
    exitAt,
    timeZone: 'Europe/Moscow',
    createdAt: new Date().toISOString()
  };
  pendingExitPass = payload;
  try {
    sessionStorage.setItem('school-pass-pending', JSON.stringify(payload));
  } catch (error) {
    // The in-memory payload still makes retries within this page idempotent.
  }
  passSending = true;
  form.querySelector('fieldset').disabled = true;
  $('exit-pass-error').hidden = true;
  $('exit-pass-progress').textContent = 'Сохраняем пропуск в таблице…';
  try {
    // Prepare the image before saving so a missing QR library does not issue an unseen pass.
    const image = createPassQr(payload);
    const result = await requestPassApi(passConnection, 'createPass', payload);
    const confirmed = result.pass;
    if (!confirmed || Object.keys(payload).some(field => confirmed[field] !== payload[field])) {
      throw new Error('Данные подтверждения отличаются от отправленного пропуска. Повторите отправку с тем же ID.');
    }
    $('exit-pass-qr').innerHTML = image;
    $('exit-pass-departure').textContent = 'Выход ' + payload.exitAt.slice(0, 10).split('-').reverse().join('.') +
      ' в ' + payload.exitAt.slice(11, 16) + ' (Москва)';
    $('exit-pass-title').textContent = 'Пропуск сохранён в таблице';
    form.hidden = true;
    $('exit-pass-progress').textContent = '';
    $('exit-pass-result').hidden = false;
    pendingExitPass = null;
    try {
      sessionStorage.removeItem('school-pass-pending');
    } catch (error) {
      // A repeated payload is also deduplicated by the server.
    }
    $('exit-pass-result').querySelector('button').focus();
  } catch (error) {
    $('exit-pass-error').textContent = error.message;
    $('exit-pass-error').hidden = false;
    $('exit-pass-progress').textContent = '';
  } finally {
    passSending = false;
    form.querySelector('fieldset').disabled = false;
  }
}

function createPassQr(payload) {
  if (typeof qrcode !== 'function') throw new Error('Не удалось загрузить QR-код. Обновите страницу и повторите отправку.');
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, 'M');
  qr.addData(JSON.stringify(payload));
  qr.make();
  return qr.createSvgTag({
    cellSize: 4, margin: 16, scalable: true,
    alt: 'QR-код пропуска', title: 'Пропуск на выход'
  });
}
