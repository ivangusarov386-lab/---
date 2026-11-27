'use strict';

const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyanuYCJH_cSy_9_r0bLJLvzF0BG0jAUrpIlpycOXpDr_mtd64_9tVrTU122JWmQilV6Q/exec';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_FIELDS = ['version', 'type', 'id', 'studentId', 'studentName', 'className', 'exitAt', 'timeZone', 'createdAt'];
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
let endpoint = DEFAULT_ENDPOINT;
let pending = null;
let busy = false;
let selectedPass = null;
let searchController = null;
let searchGeneration = 0;
let searchTimer = null;
let cameraGeneration = 0;
let cameraStarting = false;
let cameraActive = false;
let stream = null;
let frameTimer = null;

try {
  endpoint = localStorage.getItem('school-pass-endpoint') || DEFAULT_ENDPOINT;
  const saved = JSON.parse(sessionStorage.getItem('qr-reader-pending'));
  if (saved && UUID.test(saved.operationId) && UUID.test(saved.passId)) pending = saved;
} catch (error) {
  // The current page can work when browser storage is unavailable.
}
$('endpoint').value = endpoint;

function displayTime(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(value));
}

function showResult(state, title, body) {
  $('result').hidden = false;
  $('result').dataset.state = state;
  $('result-title').textContent = title;
  $('result-body').innerHTML = body;
  $('result-title').focus();
  $('retry-consume').hidden = true;
  $('next-scan').hidden = busy;
  updateButtons();
}

function updateButtons() {
  $('start-camera').disabled = busy || cameraStarting || cameraActive;
  $('start-camera').hidden = cameraStarting || cameraActive || !$('result').hidden;
  $('stop-camera').hidden = !cameraStarting && !cameraActive;
  $('confirm-manual').disabled = busy;
  document.querySelectorAll('.person').forEach(button => { button.disabled = busy; });
  $('retry-consume').disabled = busy;
}

async function requestApi(body, signal) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) {
    throw new Error('Проверьте адрес Google Apps Script в подключении.');
  }
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body), signal
    });
  } catch (error) {
    const failure = new Error('Ответ сервиса не получен. Проверьте соединение и повторите отправку.');
    failure.retryable = true;
    throw failure;
  }
  if (!response.ok) {
    const failure = new Error('Сервис недоступен. Проверьте соединение и публикацию Google Apps Script.');
    failure.retryable = true;
    throw failure;
  }
  let result;
  try { result = await response.json(); } catch (error) {
    const failure = new Error('Сервис вернул некорректный ответ. Повторите отправку.');
    failure.retryable = true;
    throw failure;
  }
  if (result?.ok !== true) {
    const failure = new Error(result?.error === 'Неизвестная операция.'
      ? 'Обновите Google Apps Script до версии с поддержкой QR_reader.'
      : (typeof result?.error === 'string' ? result.error : 'Сервис не подтвердил операцию.'));
    failure.retryable = !['PASS_USED', 'PASS_EXPIRED', 'PASS_NOT_FOUND', 'PASS_MISMATCH'].includes(result?.code);
    throw failure;
  }
  return result;
}

async function searchPasses() {
  const generation = ++searchGeneration;
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  const timeout = setTimeout(() => controller.abort(), 30000);
  $('search-status').textContent = 'Проверяем действующие пропуска…';
  $('search-results').replaceChildren();
  try {
    const result = await requestApi({ action: 'searchPasses', query: $('name-query').value.trim() }, controller.signal);
    if (generation !== searchGeneration) return;
    if (!Array.isArray(result.passes)) throw new Error('Сервис вернул неверный список пропусков.');
    const passes = result.passes.filter(pass => pass && UUID.test(pass.id) &&
      typeof pass.studentName === 'string' && typeof pass.className === 'string' &&
      Number.isFinite(Date.parse(pass.exitAt)));
    $('connection-status').textContent = 'Таблица подключена';
    $('connection-status').dataset.state = 'ready';
    $('search-status').textContent = 'Найдено пропусков — ' + passes.length;
    if (!passes.length) {
      $('search-results').innerHTML = '<p class="empty">Действующих пропусков не найдено.</p>';
    }
    for (const pass of passes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'person';
      button.disabled = busy;
      button.innerHTML = '<span><strong>' + escapeHTML(pass.studentName) +
        '</strong><small>' + escapeHTML(pass.className) + ' класс · ' +
        escapeHTML(displayTime(pass.exitAt).split(',')[0]) +
        '</small></span><span class="exit-time">' +
        escapeHTML(new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(new Date(pass.exitAt))) +
        '<small>выход · МСК</small></span>';
      button.onclick = () => {
        if (busy) return;
        stopCamera();
        selectedPass = pass;
        $('manual-details').innerHTML = personDetails(pass);
        $('manual-dialog').showModal();
      };
      $('search-results').append(button);
    }
  } catch (error) {
    if (generation !== searchGeneration) return;
    $('connection-status').textContent = 'Нет подключения';
    $('connection-status').dataset.state = 'error';
    $('search-status').textContent = error.message;
  } finally {
    clearTimeout(timeout);
  }
}

function personDetails(pass) {
  return '<p class="result-name">' + escapeHTML(pass.studentName) +
    '</p><p class="result-detail">' + escapeHTML(pass.className) + ' класс</p>' +
    '<p class="result-detail">Выход ' + escapeHTML(displayTime(pass.exitAt)) + ' · Москва</p>';
}

function savePending(value) {
  pending = value;
  try {
    if (value) sessionStorage.setItem('qr-reader-pending', JSON.stringify(value));
    else sessionStorage.removeItem('qr-reader-pending');
  } catch (error) {
    // Retain the same operation ID in memory for a retry.
  }
}

async function consumePass(input) {
  if (busy) return;
  stopCamera();
  $('manual-dialog').close();
  const operationId = pending?.passId === input.passId ? pending.operationId : crypto.randomUUID();
  const request = { ...input, operationId };
  savePending(request);
  busy = true;
  updateButtons();
  showResult('pending', 'Проверяем и погашаем пропуск…',
    '<p>Дождитесь подтверждения от таблицы.</p>');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const result = await requestApi({ action: 'consumePass', ...request }, controller.signal);
    if (result.pass?.id !== request.passId || result.consumption?.operationId !== operationId ||
        !Number.isFinite(Date.parse(result.consumption?.usedAt)) ||
        typeof result.pass?.studentName !== 'string' ||
        typeof result.pass?.className !== 'string' ||
        !Number.isFinite(Date.parse(result.pass?.exitAt))) {
      const error = new Error('Подтверждение погашения не совпало с запросом. Повторите отправку.');
      error.retryable = true;
      throw error;
    }
    if (request.qrPayload) {
      const scanned = JSON.parse(request.qrPayload);
      if (!QR_FIELDS.every(field => result.pass[field] === scanned[field])) {
        const error = new Error('Ответ содержит данные другого пропуска. Повторите отправку.');
        error.retryable = true;
        throw error;
      }
    }
    savePending(null);
    showResult('success', 'Выход разрешён · пропуск погашен',
      personDetails(result.pass) + '<p>Погашен ' + escapeHTML(displayTime(result.consumption.usedAt)) + ' · Москва</p>');
    searchPasses();
  } catch (error) {
    showResult('error', 'Выход не подтверждён', '<p>' + escapeHTML(error.message) + '</p>');
    if (error.retryable) $('retry-consume').hidden = false;
    else savePending(null);
  } finally {
    clearTimeout(timeout);
    busy = false;
    $('next-scan').hidden = false;
    updateButtons();
  }
}

function acceptQr(text) {
  let pass;
  try {
    pass = JSON.parse(text);
    if (pass?.version !== 1 || pass.type !== 'school-exit-pass' || !UUID.test(pass.id) ||
        !Number.isSafeInteger(pass.studentId) || pass.studentId <= 0 ||
        typeof pass.studentName !== 'string' || typeof pass.className !== 'string' ||
        pass.timeZone !== 'Europe/Moscow' || !Number.isFinite(Date.parse(pass.exitAt)) ||
        !Number.isFinite(Date.parse(pass.createdAt))) throw new Error();
  } catch (error) {
    stopCamera();
    showResult('error', 'QR-код не распознан', '<p>Нужен QR-код школьного пропуска.</p>');
    return;
  }
  consumePass({ passId: pass.id, qrPayload: text });
}

function stopCamera() {
  cameraGeneration++;
  clearTimeout(frameTimer);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  cameraActive = false;
  cameraStarting = false;
  $('camera').srcObject = null;
  $('camera').hidden = true;
  $('camera-placeholder').hidden = false;
  $('camera-state').textContent = 'Камера выключена';
  updateButtons();
}

async function startCamera() {
  if (busy) return;
  stopCamera();
  const generation = cameraGeneration;
  $('camera-error').hidden = true;
  $('result').hidden = true;
  updateButtons();
  if (!navigator.mediaDevices?.getUserMedia || typeof jsQR !== 'function') {
    $('camera-error').textContent = 'Камера недоступна. Откройте сайт по HTTPS или используйте поиск по ФИО.';
    $('camera-error').hidden = false;
    return;
  }
  cameraStarting = true;
  $('camera-state').textContent = 'Запрашиваем доступ…';
  updateButtons();
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false
    });
    if (generation !== cameraGeneration || busy || document.hidden) {
      acquired.getTracks().forEach(track => track.stop());
      return;
    }
    stream = acquired;
    $('camera').srcObject = stream;
    $('camera').hidden = false;
    $('camera-placeholder').hidden = true;
    let playTimeout;
    try {
      await Promise.race([
        $('camera').play(),
        new Promise((resolve, reject) => {
          playTimeout = setTimeout(() => reject(new Error('Camera start timeout')), 10000);
        })
      ]);
    } finally {
      clearTimeout(playTimeout);
    }
    if (generation !== cameraGeneration) return;
    cameraStarting = false;
    cameraActive = true;
    $('camera-state').textContent = 'Камера включена';
    updateButtons();
    scanFrame(generation);
  } catch (error) {
    if (generation !== cameraGeneration) return;
    stopCamera();
    $('camera-error').textContent = error.name === 'NotAllowedError'
      ? 'Разрешите доступ к камере в настройках браузера или используйте поиск по ФИО.'
      : 'Не удалось включить камеру. Проверьте её подключение и доступ в браузере.';
    $('camera-error').hidden = false;
  }
}

function scanFrame(generation) {
  if (generation !== cameraGeneration || !cameraActive || busy) return;
  const video = $('camera');
  try {
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = $('scan-canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      if (decoded) {
        stopCamera();
        acceptQr(decoded.data);
        return;
      }
    }
    frameTimer = setTimeout(() => scanFrame(generation), 150);
  } catch (error) {
    stopCamera();
    $('camera-error').textContent = 'Не удалось считать изображение с камеры. Попробуйте включить её ещё раз.';
    $('camera-error').hidden = false;
  }
}

$('start-camera').onclick = startCamera;
$('stop-camera').onclick = stopCamera;
$('next-scan').onclick = startCamera;
$('retry-consume').onclick = () => { if (pending) consumePass(pending); };
$('cancel-manual').onclick = () => $('manual-dialog').close();
$('confirm-manual').onclick = () => {
  if (selectedPass) consumePass({ passId: selectedPass.id });
};
$('name-query').oninput = () => {
  clearTimeout(searchTimer);
  searchGeneration++;
  searchController?.abort();
  $('search-results').replaceChildren();
  searchTimer = setTimeout(searchPasses, 300);
};
$('refresh-search').onclick = searchPasses;
$('settings-form').onsubmit = event => {
  event.preventDefault();
  if (busy) return;
  endpoint = $('endpoint').value.trim();
  try { localStorage.setItem('school-pass-endpoint', endpoint); } catch (error) {}
  searchPasses();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
window.addEventListener('pagehide', stopCamera);

if (pending) {
  showResult('pending', 'Есть незавершённая проверка',
    '<p>Повторите отправку, чтобы узнать результат погашения.</p>');
  $('retry-consume').hidden = false;
}
searchPasses();
