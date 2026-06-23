'use strict';

const DB_NAME = 'psat-random-note-db';
const DB_VERSION = 1;
const STORES = { problems: 'problems', history: 'history' };
const SLOW_MS = 180000;
const WRONG_CLEAR_STREAK = 2;
const SYNC_CONFIG_KEY = 'psat-github-sync-v1';
const SYNC_TOMBSTONES_KEY = 'psat-github-sync-tombstones-v1';
const SYNC_DEBOUNCE_MS = 2500;
const SYNC_INTERVAL_MS = 30000;

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  tabs: $$('.tab'),
  views: $$('.view'),
  installBtn: $('installBtn'),
  toast: $('toast'),

  modeSelect: $('modeSelect'),
  subjectFilter: $('subjectFilter'),
  sessionCount: $('sessionCount'),
  sessionMinutes: $('sessionMinutes'),
  startBtn: $('startBtn'),
  continueBtn: $('continueBtn'),
  emptySolve: $('emptySolve'),
  solvePanel: $('solvePanel'),
  problemTitle: $('problemTitle'),
  problemMeta: $('problemMeta'),
  questionTimer: $('questionTimer'),
  sessionTimer: $('sessionTimer'),
  imageScroller: $('imageScroller'),
  imageWrap: $('imageWrap'),
  problemImage: $('problemImage'),
  inkCanvas: $('inkCanvas'),
  penBtn: $('penBtn'),
  eraserBtn: $('eraserBtn'),
  penSize: $('penSize'),
  penSizeLabel: $('penSizeLabel'),
  eraserSize: $('eraserSize'),
  eraserSizeLabel: $('eraserSizeLabel'),
  clearInkBtn: $('clearInkBtn'),
  exitSolveBtn: $('exitSolveBtn'),
  zoomOutBtn: $('zoomOutBtn'),
  zoomInBtn: $('zoomInBtn'),
  fitZoomBtn: $('fitZoomBtn'),
  zoomLabel: $('zoomLabel'),
  choices: $$('.choice'),
  checkBtn: $('checkBtn'),
  showExpBtn: $('showExpBtn'),
  flagBtn: $('flagBtn'),
  nextBtn: $('nextBtn'),
  resultBox: $('resultBox'),
  explanationBox: $('explanationBox'),

  formTitle: $('formTitle'),
  problemForm: $('problemForm'),
  editingId: $('editingId'),
  subjectInput: $('subjectInput'),
  categoryInput: $('categoryInput'),
  answerInput: $('answerInput'),
  difficultyInput: $('difficultyInput'),
  imageInput: $('imageInput'),
  previewImage: $('previewImage'),
  problemPasteZone: $('problemPasteZone'),
  pasteProblemBtn: $('pasteProblemBtn'),
  clearProblemImageBtn: $('clearProblemImageBtn'),
  explanationImageInput: $('explanationImageInput'),
  previewExplanationImage: $('previewExplanationImage'),
  explanationPasteZone: $('explanationPasteZone'),
  pasteExplanationBtn: $('pasteExplanationBtn'),
  clearExplanationImageBtn: $('clearExplanationImageBtn'),
  explanationInput: $('explanationInput'),
  tagsInput: $('tagsInput'),
  resetFormBtn: $('resetFormBtn'),

  solveWrongBtn: $('solveWrongBtn'),
  clearSolvedWrongBtn: $('clearSolvedWrongBtn'),
  wrongList: $('wrongList'),
  searchInput: $('searchInput'),
  listSubjectFilter: $('listSubjectFilter'),
  problemList: $('problemList'),
  statsCards: $('statsCards'),
  exportBtn: $('exportBtn'),
  importInput: $('importInput'),
  wipeBtn: $('wipeBtn'),

  syncStatus: $('syncStatus'),
  syncOwnerInput: $('syncOwnerInput'),
  syncRepoInput: $('syncRepoInput'),
  syncBranchInput: $('syncBranchInput'),
  syncPathInput: $('syncPathInput'),
  syncTokenInput: $('syncTokenInput'),
  saveSyncBtn: $('saveSyncBtn'),
  manualSyncBtn: $('manualSyncBtn'),
  pullSyncBtn: $('pullSyncBtn'),
  disableSyncBtn: $('disableSyncBtn')
};

const state = {
  problems: [],
  current: null,
  selectedAnswer: null,
  checked: false,
  queue: [],
  queueIndex: 0,
  session: null,
  questionStart: 0,
  timerId: null,
  drawTool: 'pen',
  drawing: false,
  activeDrawPointerId: null,
  currentStroke: null,
  touchPointers: new Map(),
  gesture: null,
  zoom: 1,
  db: null,
  deferredInstallPrompt: null,
  activePasteTarget: 'problem',
  formProblemImageData: '',
  formExplanationImageData: '',
  autoFitOnImageLoad: false,
  solveFullscreenActive: false,
  syncConfig: null,
  syncTimer: null,
  syncDebounceTimer: null,
  syncRunning: false,
  syncApplying: false,
  tombstones: {},
  deviceId: localStorage.getItem('psat-device-id') || ''
};

if (!state.deviceId) {
  state.deviceId = uidSafe();
  localStorage.setItem('psat-device-id', state.deviceId);
}

function uidSafe() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openDb() {
  if (state.db) return Promise.resolve(state.db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      state.db = request.result;
      resolve(state.db);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.problems)) {
        db.createObjectStore(STORES.problems, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.history)) {
        db.createObjectStore(STORES.history, { keyPath: 'id' });
      }
    };
  });
}

async function tx(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    result = action(store);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const db = await openDb();
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  return requestToPromise(store.getAll());
}

async function put(storeName, value) {
  const result = await tx(storeName, 'readwrite', (store) => store.put(value));
  scheduleSyncForLocalChange(storeName);
  return result;
}

async function remove(storeName, id) {
  if (storeName === STORES.problems) recordTombstone(id);
  const result = await tx(storeName, 'readwrite', (store) => store.delete(id));
  scheduleSyncForLocalChange(storeName);
  return result;
}

async function clearStore(storeName) {
  if (storeName === STORES.problems) {
    try {
      const existing = await getAll(STORES.problems);
      existing.forEach((p) => recordTombstone(p.id));
    } catch (err) {
      console.warn('tombstone record failed', err);
    }
  }
  const result = await tx(storeName, 'readwrite', (store) => store.clear());
  scheduleSyncForLocalChange(storeName);
  return result;
}

function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => els.toast.classList.add('hidden'), 2400);
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60).toString().padStart(2, '0');
  const sec = (total % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

function formatLongTime(ms) {
  if (!ms) return '0초';
  const total = Math.round(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min <= 0) return `${sec}초`;
  return `${min}분 ${sec}초`;
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function tagsToArray(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function choiceLabel(value) {
  return ['①', '②', '③', '④', '⑤'][Number(value) - 1] || value;
}

function averageTime(problem) {
  return problem.attempts ? Math.round((problem.totalTimeMs || 0) / problem.attempts) : 0;
}

function accuracy(problem) {
  return problem.attempts ? Math.round(((problem.correct || 0) / problem.attempts) * 100) : 0;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getSubjectSet() {
  return [...new Set(state.problems.map((p) => p.subject || '미분류'))].sort((a, b) => a.localeCompare(b, 'ko'));
}

function fillSubjectSelect(select, keepValue = true) {
  const current = keepValue ? select.value : '';
  select.innerHTML = '<option value="">전체</option>';
  for (const subject of getSubjectSet()) {
    const opt = document.createElement('option');
    opt.value = subject;
    opt.textContent = subject;
    select.appendChild(opt);
  }
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

async function refresh() {
  state.problems = await getAll(STORES.problems);
  state.problems.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  fillSubjectSelect(els.subjectFilter);
  fillSubjectSelect(els.listSubjectFilter);
  renderEmptyState();
  renderProblemList();
  renderWrongList();
  renderStats();
}

function renderEmptyState() {
  const has = state.problems.length > 0;
  els.emptySolve.classList.toggle('hidden', has);
}

function switchView(viewId) {
  els.views.forEach((v) => v.classList.toggle('active', v.id === viewId));
  els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.view === viewId));
  if (viewId === 'listView') renderProblemList();
  if (viewId === 'wrongView') renderWrongList();
  if (viewId === 'statsView') renderStats();
}

function filterProblems(mode, subject) {
  return state.problems.filter((p) => {
    if (subject && (p.subject || '미분류') !== subject) return false;
    if (mode === 'wrong') return !!p.wrongActive;
    if (mode === 'slow') return averageTime(p) >= SLOW_MS || (p.lastTimeMs || 0) >= SLOW_MS;
    if (mode === 'unseen') return !p.attempts;
    if (mode === 'flagged') return !!p.flagged;
    return true;
  });
}

function startSession(problems, options = {}) {
  if (!problems.length) {
    showToast('해당 조건의 문제가 없어');
    return;
  }
  const count = Number(options.count || 0);
  state.queue = shuffle(problems).slice(0, count > 0 ? count : problems.length);
  state.queueIndex = 0;
  const minutes = Number(options.minutes || 0);
  state.session = {
    startedAt: Date.now(),
    endAt: minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0,
    total: state.queue.length,
    answered: 0,
    correct: 0,
    elapsedOnFinish: 0
  };
  loadCurrentProblem(state.queue[0]);
  switchView('solveView');
}

function startDirectProblem(problem) {
  state.queue = [problem];
  state.queueIndex = 0;
  state.session = {
    startedAt: Date.now(),
    endAt: 0,
    total: 1,
    answered: 0,
    correct: 0,
    elapsedOnFinish: 0
  };
  loadCurrentProblem(problem);
  switchView('solveView');
}

function loadCurrentProblem(problem) {
  saveInkToCurrentProblem(false);
  state.current = problem;
  state.selectedAnswer = null;
  state.checked = false;
  state.questionStart = Date.now();
  resetGestureState();
  state.drawTool = 'pen';
  state.zoom = 1;
  state.autoFitOnImageLoad = true;
  localStorage.setItem('psat-last-problem-id', problem.id);

  els.solvePanel.classList.remove('hidden');
  els.resultBox.classList.add('hidden');
  els.explanationBox.classList.add('hidden');
  els.resultBox.className = 'result hidden';
  els.explanationBox.textContent = '';
  els.problemTitle.textContent = `문제 ${state.queueIndex + 1}/${state.queue.length}`;
  const avg = averageTime(problem) ? `평균 ${formatLongTime(averageTime(problem))}` : '기록 없음';
  const tags = (problem.tags || []).length ? ` · #${problem.tags.join(' #')}` : '';
  els.problemMeta.textContent = `${problem.subject || '미분류'} · ${problem.category || '분류없음'} · 난이도 ${problem.difficulty || '중'} · 정답률 ${accuracy(problem)}% · ${avg}${tags}`;
  els.problemImage.src = problem.imageData;
  els.flagBtn.textContent = problem.flagged ? '다시보기 해제' : '다시보기 지정';
  setDrawTool('pen');
  setZoom(1);
  enterSolveFullscreen();
  clearChoiceState();
  updateTimers();
  startTimer();
}

function startTimer() {
  clearInterval(state.timerId);
  state.timerId = setInterval(updateTimers, 300);
}

function updateTimers() {
  if (!state.current || !state.questionStart) return;
  els.questionTimer.textContent = formatTime(Date.now() - state.questionStart);
  const hasSessionTimer = state.session && state.session.endAt;
  els.sessionTimer.classList.toggle('hidden', !hasSessionTimer);
  if (hasSessionTimer) {
    const remain = state.session.endAt - Date.now();
    els.sessionTimer.textContent = `세션 ${formatTime(remain)}`;
    if (remain <= 0 && !state.checked) finishSession(true);
  }
}

function clearChoiceState() {
  els.choices.forEach((btn) => {
    btn.classList.remove('selected', 'correct', 'wrong');
    btn.disabled = false;
  });
}

function markChoiceButtons(correctAnswer, selectedAnswer) {
  els.choices.forEach((btn) => {
    btn.disabled = true;
    const value = Number(btn.dataset.answer);
    if (value === Number(correctAnswer)) btn.classList.add('correct');
    if (value === Number(selectedAnswer) && value !== Number(correctAnswer)) btn.classList.add('wrong');
  });
}

async function checkAnswer() {
  if (!state.current) return;
  if (state.checked) {
    showToast('이미 채점한 문제야');
    return;
  }
  if (!state.selectedAnswer) {
    showToast('정답 번호를 먼저 선택해줘');
    return;
  }
  await saveInkToCurrentProblem(true);
  const p = state.current;
  const elapsed = Date.now() - state.questionStart;
  const isCorrect = Number(state.selectedAnswer) === Number(p.answer);

  p.attempts = (p.attempts || 0) + 1;
  p.totalTimeMs = (p.totalTimeMs || 0) + elapsed;
  p.lastTimeMs = elapsed;
  p.lastAnsweredAt = Date.now();
  p.lastResult = isCorrect ? 'correct' : 'wrong';

  if (isCorrect) {
    p.correct = (p.correct || 0) + 1;
    if (p.wrongActive) {
      p.correctStreak = (p.correctStreak || 0) + 1;
      if (p.correctStreak >= WRONG_CLEAR_STREAK) p.wrongActive = false;
    }
  } else {
    p.wrong = (p.wrong || 0) + 1;
    p.wrongActive = true;
    p.correctStreak = 0;
  }

  await put(STORES.problems, p);
  await put(STORES.history, {
    id: uid(),
    problemId: p.id,
    selectedAnswer: Number(state.selectedAnswer),
    correctAnswer: Number(p.answer),
    isCorrect,
    elapsedMs: elapsed,
    createdAt: Date.now()
  });

  state.checked = true;
  if (state.session) {
    state.session.answered += 1;
    if (isCorrect) state.session.correct += 1;
  }

  markChoiceButtons(p.answer, state.selectedAnswer);
  els.resultBox.className = `result ${isCorrect ? 'ok' : 'no'}`;
  const clearText = isCorrect && !p.wrongActive && (p.correctStreak || 0) >= WRONG_CLEAR_STREAK
    ? '<br>오답노트에서 자동 해제됨.'
    : '';
  els.resultBox.innerHTML = `${isCorrect ? '정답입니다.' : '오답입니다.'}<br>선택: ${choiceLabel(state.selectedAnswer)} / 정답: ${choiceLabel(p.answer)}<br>풀이시간: ${formatLongTime(elapsed)}${clearText}`;
  els.resultBox.classList.remove('hidden');
  showExplanation();
  await refresh();
}

function showExplanation() {
  if (!state.current) return;
  const hasText = state.current.explanation && state.current.explanation.trim();
  const hasImage = state.current.explanationImageData;
  els.explanationBox.innerHTML = '';
  if (!hasText && !hasImage) {
    els.explanationBox.textContent = '등록된 해설이 없습니다.';
  } else {
    if (hasImage) {
      const img = document.createElement('img');
      img.src = state.current.explanationImageData;
      img.alt = '해설 이미지';
      img.className = 'explanation-image';
      els.explanationBox.appendChild(img);
    }
    if (hasText) {
      const text = document.createElement('div');
      text.className = 'explanation-text';
      text.textContent = state.current.explanation.trim();
      els.explanationBox.appendChild(text);
    }
  }
  els.explanationBox.classList.remove('hidden');
}

async function nextProblem() {
  if (!state.current) return;
  await saveInkToCurrentProblem(true);
  if (state.queueIndex + 1 >= state.queue.length) {
    finishSession(false);
    return;
  }
  state.queueIndex += 1;
  const next = state.problems.find((p) => p.id === state.queue[state.queueIndex].id) || state.queue[state.queueIndex];
  loadCurrentProblem(next);
}

function finishSession(timeout) {
  if (!state.session) return;
  const elapsed = Date.now() - state.session.startedAt;
  state.session.elapsedOnFinish = elapsed;
  clearInterval(state.timerId);
  state.timerId = null;
  state.current = null;
  exitSolveFullscreen();
  els.solvePanel.classList.add('hidden');
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `
    <h2>${timeout ? '시간 종료' : '세션 완료'}</h2>
    <p>풀이: ${state.session.answered}/${state.session.total}</p>
    <p>정답: ${state.session.correct}개</p>
    <p>정답률: ${state.session.answered ? Math.round(state.session.correct / state.session.answered * 100) : 0}%</p>
    <p>걸린 시간: ${formatLongTime(elapsed)}</p>
  `;
  els.solveView.appendChild(card);
  setTimeout(() => card.remove(), 9000);
  state.session = null;
  showToast(timeout ? '제한시간이 끝났어' : '세션 완료');
}

function setDrawEnabled(enabled) {
  // v4: 필기모드 토글 제거. 스타일러스/마우스는 항상 필기, 손가락은 이동/확대입니다.
  els.inkCanvas.classList.add('drawing-enabled');
}

function updateSizeLabels() {
  if (els.penSizeLabel) els.penSizeLabel.textContent = String(Number(els.penSize.value || 4));
  if (els.eraserSizeLabel) els.eraserSizeLabel.textContent = String(Number(els.eraserSize.value || 26));
}

function setDrawTool(tool) {
  state.drawTool = tool;
  els.penBtn.classList.toggle('active-tool', tool === 'pen');
  els.eraserBtn.classList.toggle('active-tool', tool === 'eraser');
  updateSizeLabels();
}

function setZoom(value) {
  state.zoom = Math.min(5, Math.max(0.2, Number(value))); // v5: 한 화면 맞춤을 위해 20%까지 축소
  els.imageWrap.style.width = `${state.zoom * 100}%`;
  els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  window.requestAnimationFrame(syncCanvasSize);
}

function setZoomAround(value, clientX, clientY, fixedContentX = null, fixedContentY = null) {
  const scroller = els.imageScroller;
  const rect = scroller.getBoundingClientRect();
  const viewX = Math.min(rect.width, Math.max(0, clientX - rect.left));
  const viewY = Math.min(rect.height, Math.max(0, clientY - rect.top));
  const oldZoom = state.zoom || 1;
  const contentX = fixedContentX ?? ((scroller.scrollLeft + viewX) / oldZoom);
  const contentY = fixedContentY ?? ((scroller.scrollTop + viewY) / oldZoom);
  setZoom(value);
  scroller.scrollLeft = Math.max(0, contentX * state.zoom - viewX);
  scroller.scrollTop = Math.max(0, contentY * state.zoom - viewY);
}

function zoomFromCenter(delta) {
  const rect = els.imageScroller.getBoundingClientRect();
  setZoomAround(state.zoom + delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
}


function fitZoomToScreen() {
  if (!state.current || !els.problemImage.naturalWidth || !els.problemImage.naturalHeight) return;
  const scroller = els.imageScroller;
  if (!scroller.clientWidth || !scroller.clientHeight) return;
  const baseWidth = scroller.clientWidth;
  const baseHeight = baseWidth * (els.problemImage.naturalHeight / els.problemImage.naturalWidth);
  const fitByHeight = (scroller.clientHeight - 12) / Math.max(1, baseHeight);
  const fit = Math.min(1, Math.max(0.2, fitByHeight));
  setZoom(fit);
  scroller.scrollLeft = 0;
  scroller.scrollTop = 0;
}

async function enterSolveFullscreen() {
  if (!els.solvePanel) return;
  document.body.classList.add('solve-active');
  els.solvePanel.classList.add('fullscreen-solve');
  state.solveFullscreenActive = true;
  window.requestAnimationFrame(() => {
    syncCanvasSize();
    if (state.autoFitOnImageLoad) fitZoomToScreen();
  });
  try {
    if (els.solvePanel.requestFullscreen && !document.fullscreenElement) {
      await els.solvePanel.requestFullscreen();
    }
  } catch (err) {
    // 모바일 브라우저가 전체화면 API를 막아도 CSS 전체화면은 유지합니다.
  }
}

async function exitSolveFullscreen() {
  document.body.classList.remove('solve-active');
  els.solvePanel?.classList.remove('fullscreen-solve');
  state.solveFullscreenActive = false;
  window.requestAnimationFrame(syncCanvasSize);
  try {
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  } catch (err) {}
}

function getCanvasContext() {
  const ctx = els.inkCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function syncCanvasSize() {
  if (!state.current || !els.problemImage.complete) return;
  const width = els.imageWrap.clientWidth;
  const height = els.problemImage.clientHeight;
  if (!width || !height) return;
  const dpr = window.devicePixelRatio || 1;
  const nextWidth = Math.round(width * dpr);
  const nextHeight = Math.round(height * dpr);
  if (els.inkCanvas.width !== nextWidth || els.inkCanvas.height !== nextHeight) {
    els.inkCanvas.width = nextWidth;
    els.inkCanvas.height = nextHeight;
    els.inkCanvas.style.width = `${width}px`;
    els.inkCanvas.style.height = `${height}px`;
  }
  redrawInk();
}

function redrawInk() {
  const canvas = els.inkCanvas;
  const ctx = getCanvasContext();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  const strokes = state.current?.annotations || [];
  for (const stroke of strokes) drawStroke(ctx, stroke, width, height);
}

function drawStroke(ctx, stroke, width, height) {
  const points = stroke.points || [];
  if (!points.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const baseSize = Number(stroke.size || 4);
  const strokeZoom = Number(stroke.zoom || 1);
  ctx.lineWidth = Math.max(1, baseSize * ((state.zoom || 1) / strokeZoom));
  ctx.strokeStyle = stroke.color || '#111111';
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.beginPath();
  const first = points[0];
  ctx.moveTo(first.x * width, first.y * height);
  if (points.length === 1) {
    ctx.lineTo(first.x * width + 0.1, first.y * height + 0.1);
  } else {
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      ctx.lineTo(p.x * width, p.y * height);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function clientToPoint(clientX, clientY) {
  const rect = els.inkCanvas.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  return { x, y };
}

function pointerToPoint(event) {
  const point = clientToPoint(event.clientX, event.clientY);
  const pressure = event.pressure && event.pressure > 0 ? event.pressure : 0.5;
  return { ...point, pressure };
}

function resetGestureState() {
  if (state.drawing && state.currentStroke) {
    state.currentStroke = null;
  }
  state.drawing = false;
  state.activeDrawPointerId = null;
  state.touchPointers = new Map();
  state.gesture = null;
  els.imageScroller?.classList.remove('panning');
}

function canDrawWithPointer(event) {
  if (!state.current) return false;
  if (event.pointerType === 'touch') return false;
  if (event.pointerType === 'mouse' && event.button !== 0 && event.buttons !== 1) return false;
  return event.pointerType === 'pen' || event.pointerType === 'mouse' || event.pointerType === '' || !event.pointerType;
}

function currentStrokeSize() {
  if (state.drawTool === 'eraser') return Number(els.eraserSize.value || 26);
  return Number(els.penSize.value || 4);
}

function startInk(event) {
  if (event.pointerType === 'touch') {
    startTouchGesture(event);
    return;
  }
  if (!canDrawWithPointer(event)) return;
  event.preventDefault();
  els.inkCanvas.setPointerCapture?.(event.pointerId);
  state.drawing = true;
  state.activeDrawPointerId = event.pointerId;
  state.currentStroke = {
    tool: state.drawTool,
    color: '#111111',
    size: currentStrokeSize(),
    zoom: state.zoom || 1,
    points: [pointerToPoint(event)],
    createdAt: Date.now()
  };
}

function moveInk(event) {
  if (event.pointerType === 'touch') {
    moveTouchGesture(event);
    return;
  }
  if (!state.drawing || !state.currentStroke || event.pointerId !== state.activeDrawPointerId) return;
  event.preventDefault();
  state.currentStroke.points.push(pointerToPoint(event));
  redrawInk();
  const ctx = getCanvasContext();
  drawStroke(ctx, state.currentStroke, els.inkCanvas.clientWidth, els.inkCanvas.clientHeight);
}

async function endInk(event) {
  if (event.pointerType === 'touch') {
    endTouchGesture(event);
    return;
  }
  if (!state.drawing || !state.currentStroke || event.pointerId !== state.activeDrawPointerId) return;
  event.preventDefault();
  state.drawing = false;
  state.activeDrawPointerId = null;
  try { els.inkCanvas.releasePointerCapture?.(event.pointerId); } catch (err) {}
  state.current.annotations = state.current.annotations || [];
  state.current.annotations.push(state.currentStroke);
  state.currentStroke = null;
  redrawInk();
  await saveInkToCurrentProblem(true);
}

function touchList() {
  return Array.from(state.touchPointers.values());
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

function centerOf(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function beginPanGesture(point) {
  state.gesture = {
    type: 'pan',
    pointerId: point.id,
    startX: point.x,
    startY: point.y,
    scrollLeft: els.imageScroller.scrollLeft,
    scrollTop: els.imageScroller.scrollTop
  };
  els.imageScroller.classList.add('panning');
}

function beginPinchGesture(points) {
  if (points.length < 2) return;
  const [a, b] = points;
  const c = centerOf(a, b);
  const rect = els.imageScroller.getBoundingClientRect();
  state.gesture = {
    type: 'pinch',
    startDistance: distance(a, b),
    startZoom: state.zoom || 1,
    contentX: (els.imageScroller.scrollLeft + (c.x - rect.left)) / (state.zoom || 1),
    contentY: (els.imageScroller.scrollTop + (c.y - rect.top)) / (state.zoom || 1)
  };
  els.imageScroller.classList.add('panning');
}

function startTouchGesture(event) {
  if (!state.current) return;
  event.preventDefault();
  els.inkCanvas.setPointerCapture?.(event.pointerId);
  state.touchPointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
  const points = touchList();
  if (points.length >= 2) beginPinchGesture(points);
  else beginPanGesture(points[0]);
}

function moveTouchGesture(event) {
  if (!state.touchPointers.has(event.pointerId)) return;
  event.preventDefault();
  state.touchPointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
  const points = touchList();
  if (points.length >= 2) {
    if (!state.gesture || state.gesture.type !== 'pinch') beginPinchGesture(points);
    const [a, b] = points;
    const c = centerOf(a, b);
    const ratio = distance(a, b) / Math.max(1, state.gesture.startDistance || distance(a, b));
    setZoomAround(state.gesture.startZoom * ratio, c.x, c.y, state.gesture.contentX, state.gesture.contentY);
    return;
  }
  if (points.length === 1) {
    const point = points[0];
    if (!state.gesture || state.gesture.type !== 'pan' || state.gesture.pointerId !== point.id) beginPanGesture(point);
    const dx = point.x - state.gesture.startX;
    const dy = point.y - state.gesture.startY;
    els.imageScroller.scrollLeft = state.gesture.scrollLeft - dx;
    els.imageScroller.scrollTop = state.gesture.scrollTop - dy;
  }
}

function endTouchGesture(event) {
  if (!state.touchPointers.has(event.pointerId)) return;
  event.preventDefault();
  state.touchPointers.delete(event.pointerId);
  try { els.inkCanvas.releasePointerCapture?.(event.pointerId); } catch (err) {}
  const points = touchList();
  if (points.length >= 2) beginPinchGesture(points);
  else if (points.length === 1) beginPanGesture(points[0]);
  else {
    state.gesture = null;
    els.imageScroller.classList.remove('panning');
  }
}

async function saveInkToCurrentProblem(writeDb) {
  if (!state.current) return;
  const idx = state.problems.findIndex((p) => p.id === state.current.id);
  if (idx >= 0) state.problems[idx] = state.current;
  if (writeDb) await put(STORES.problems, state.current);
}

async function clearInk() {
  if (!state.current) return;
  if (!confirm('현재 문제의 필기를 전부 지울까?')) return;
  state.current.annotations = [];
  redrawInk();
  await saveInkToCurrentProblem(true);
  showToast('필기를 지웠어');
}

async function toggleFlag() {
  if (!state.current) return;
  state.current.flagged = !state.current.flagged;
  await put(STORES.problems, state.current);
  els.flagBtn.textContent = state.current.flagged ? '다시보기 해제' : '다시보기 지정';
  showToast(state.current.flagged ? '다시보기로 지정했어' : '다시보기를 해제했어');
  await refresh();
}

function renderProblemList() {
  const query = els.searchInput.value.trim().toLowerCase();
  const subject = els.listSubjectFilter.value;
  const list = state.problems.filter((p) => {
    if (subject && (p.subject || '미분류') !== subject) return false;
    if (!query) return true;
    const imageKeyword = p.explanationImageData ? '해설이미지 스크린샷' : '';
    const hay = [p.subject, p.category, p.difficulty, p.explanation, imageKeyword, ...(p.tags || [])].join(' ').toLowerCase();
    return hay.includes(query);
  });
  els.problemList.innerHTML = '';
  if (!list.length) {
    els.problemList.innerHTML = '<p class="hint">표시할 문제가 없어.</p>';
    return;
  }
  for (const p of list) {
    els.problemList.appendChild(problemItem(p, false));
  }
}

function renderWrongList() {
  const list = state.problems.filter((p) => p.wrongActive);
  els.wrongList.innerHTML = '';
  if (!list.length) {
    els.wrongList.innerHTML = '<p class="hint">현재 오답노트가 비어 있어.</p>';
    return;
  }
  list.sort((a, b) => (b.lastAnsweredAt || 0) - (a.lastAnsweredAt || 0));
  for (const p of list) {
    els.wrongList.appendChild(problemItem(p, true));
  }
}

function problemItem(p, wrongOnly) {
  const div = document.createElement('article');
  div.className = 'item';
  const streak = p.wrongActive ? `오답해제까지 ${Math.max(0, WRONG_CLEAR_STREAK - (p.correctStreak || 0))}회 정답 필요` : '오답 아님';
  const tags = (p.tags || []).map((t) => `#${escapeHtml(t)}`).join(' ');
  const hasExpImage = p.explanationImageData ? ' · 해설이미지 있음' : '';
  div.innerHTML = `
    <img src="${p.imageData}" alt="문제 썸네일">
    <div>
      <h3>${escapeHtml(p.subject || '미분류')} · ${escapeHtml(p.category || '분류없음')} · 정답 ${choiceLabel(p.answer)}</h3>
      <p>난이도 ${escapeHtml(p.difficulty || '중')} · 풀이 ${p.attempts || 0}회 · 정답률 ${accuracy(p)}% · 평균 ${formatLongTime(averageTime(p))}</p>
      <p>${escapeHtml(streak)}${p.flagged ? ' · 다시보기 지정' : ''}${hasExpImage}</p>
      <p>${tags}</p>
      <div class="item-actions">
        <button data-action="solve" data-id="${p.id}" type="button">풀기</button>
        <button data-action="edit" data-id="${p.id}" class="secondary" type="button">수정</button>
        <button data-action="flag" data-id="${p.id}" class="secondary" type="button">${p.flagged ? '다시보기 해제' : '다시보기'}</button>
        ${wrongOnly ? `<button data-action="unwrong" data-id="${p.id}" class="secondary" type="button">오답 해제</button>` : ''}
        <button data-action="delete" data-id="${p.id}" class="danger-lite" type="button">삭제</button>
      </div>
    </div>
  `;
  div.addEventListener('click', handleItemClick);
  return div;
}

async function handleItemClick(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const p = state.problems.find((item) => item.id === id);
  if (!p) return;
  const action = btn.dataset.action;
  if (action === 'solve') startDirectProblem(p);
  if (action === 'edit') editProblem(p);
  if (action === 'flag') {
    p.flagged = !p.flagged;
    await put(STORES.problems, p);
    await refresh();
    showToast(p.flagged ? '다시보기로 지정했어' : '다시보기를 해제했어');
  }
  if (action === 'unwrong') {
    p.wrongActive = false;
    p.correctStreak = 0;
    await put(STORES.problems, p);
    await refresh();
    showToast('오답에서 해제했어');
  }
  if (action === 'delete') {
    if (!confirm('이 문제를 삭제할까? 복구하려면 백업 파일이 필요해.')) return;
    await remove(STORES.problems, id);
    await refresh();
    showToast('삭제했어');
  }
}

function renderStats() {
  const total = state.problems.length;
  const attempts = state.problems.reduce((sum, p) => sum + (p.attempts || 0), 0);
  const correct = state.problems.reduce((sum, p) => sum + (p.correct || 0), 0);
  const wrongActive = state.problems.filter((p) => p.wrongActive).length;
  const unseen = state.problems.filter((p) => !p.attempts).length;
  const slow = state.problems.filter((p) => averageTime(p) >= SLOW_MS || (p.lastTimeMs || 0) >= SLOW_MS).length;
  const avg = attempts ? state.problems.reduce((sum, p) => sum + (p.totalTimeMs || 0), 0) / attempts : 0;
  const flagged = state.problems.filter((p) => p.flagged).length;
  const expImages = state.problems.filter((p) => p.explanationImageData).length;
  const data = [
    ['전체 문제', `${total}개`],
    ['총 풀이', `${attempts}회`],
    ['전체 정답률', `${attempts ? Math.round(correct / attempts * 100) : 0}%`],
    ['활성 오답', `${wrongActive}개`],
    ['안 푼 문제', `${unseen}개`],
    ['오래 걸린 문제', `${slow}개`],
    ['평균 풀이시간', formatLongTime(avg)],
    ['해설 이미지', `${expImages}개`],
    ['다시보기', `${flagged}개`]
  ];
  els.statsCards.innerHTML = data.map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function setPasteTarget(target) {
  state.activePasteTarget = target;
  els.problemPasteZone.classList.toggle('active-paste', target === 'problem');
  els.explanationPasteZone.classList.toggle('active-paste', target === 'explanation');
}

function setFormImage(target, dataUrl) {
  if (target === 'problem') {
    state.formProblemImageData = dataUrl;
    els.previewImage.src = dataUrl;
    els.previewImage.classList.remove('hidden');
  } else {
    state.formExplanationImageData = dataUrl;
    els.previewExplanationImage.src = dataUrl;
    els.previewExplanationImage.classList.remove('hidden');
  }
}

function clearFormImage(target) {
  if (target === 'problem') {
    state.formProblemImageData = '';
    els.imageInput.value = '';
    els.previewImage.src = '';
    els.previewImage.classList.add('hidden');
  } else {
    state.formExplanationImageData = '';
    els.explanationImageInput.value = '';
    els.previewExplanationImage.src = '';
    els.previewExplanationImage.classList.add('hidden');
  }
}

function resetForm() {
  els.problemForm.reset();
  els.editingId.value = '';
  els.subjectInput.value = '언어논리';
  els.difficultyInput.value = '중';
  els.formTitle.textContent = '문제 등록';
  clearFormImage('problem');
  clearFormImage('explanation');
  els.imageInput.required = false;
  setPasteTarget('problem');
}

function editProblem(p) {
  els.formTitle.textContent = '문제 수정';
  els.editingId.value = p.id;
  els.subjectInput.value = p.subject || '언어논리';
  els.categoryInput.value = p.category || '';
  els.answerInput.value = String(p.answer || 1);
  els.difficultyInput.value = p.difficulty || '중';
  els.explanationInput.value = p.explanation || '';
  els.tagsInput.value = (p.tags || []).join(', ');
  els.imageInput.value = '';
  els.explanationImageInput.value = '';
  setFormImage('problem', p.imageData || '');
  if (p.explanationImageData) setFormImage('explanation', p.explanationImageData);
  else clearFormImage('explanation');
  els.imageInput.required = false;
  setPasteTarget('problem');
  switchView('addView');
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fileToDataUrl(file) {
  return blobToDataUrl(file);
}

async function imageFileInputChanged(target, input) {
  const file = input.files[0];
  if (!file) return;
  const data = await fileToDataUrl(file);
  setFormImage(target, data);
  setPasteTarget(target);
  showToast(target === 'problem' ? '문제 이미지를 넣었어' : '해설 이미지를 넣었어');
}

async function pasteImageFromClipboardEvent(event, explicitTarget = '') {
  const items = event.clipboardData?.items ? Array.from(event.clipboardData.items) : [];
  const item = items.find((entry) => entry.type && entry.type.startsWith('image/'));
  if (!item) return false;
  event.preventDefault();
  const target = explicitTarget || event.target.closest?.('[data-paste-target]')?.dataset?.pasteTarget || state.activePasteTarget || 'problem';
  const file = item.getAsFile();
  if (!file) return false;
  const data = await fileToDataUrl(file);
  setFormImage(target, data);
  setPasteTarget(target);
  showToast(target === 'problem' ? '문제 스샷을 붙여넣었어' : '해설 스샷을 붙여넣었어');
  return true;
}

async function pasteImageWithClipboardApi(target) {
  setPasteTarget(target);
  if (!navigator.clipboard || !navigator.clipboard.read) {
    showToast('이 브라우저는 버튼 붙여넣기를 지원하지 않아. 영역 클릭 후 Ctrl+V를 눌러줘.');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const data = await blobToDataUrl(blob);
      setFormImage(target, data);
      showToast(target === 'problem' ? '문제 스샷을 붙여넣었어' : '해설 스샷을 붙여넣었어');
      return;
    }
    showToast('클립보드에 이미지가 없어');
  } catch (err) {
    showToast('붙여넣기 권한이 막혔어. 영역 클릭 후 Ctrl+V를 눌러줘.');
  }
}

async function saveProblemFromForm(event) {
  event.preventDefault();
  const editingId = els.editingId.value;
  const existing = editingId ? state.problems.find((p) => p.id === editingId) : null;

  let imageData = state.formProblemImageData || existing?.imageData || '';
  if (!imageData && els.imageInput.files[0]) imageData = await fileToDataUrl(els.imageInput.files[0]);

  let explanationImageData = state.formExplanationImageData || existing?.explanationImageData || '';
  if (!explanationImageData && els.explanationImageInput.files[0]) {
    explanationImageData = await fileToDataUrl(els.explanationImageInput.files[0]);
  }

  if (!existing && !imageData) {
    showToast('문제 이미지를 올려줘');
    return;
  }
  if (!imageData) {
    showToast('문제 이미지를 올려줘');
    return;
  }

  const now = Date.now();
  const problem = {
    id: existing?.id || uid(),
    subject: els.subjectInput.value.trim() || '미분류',
    category: els.categoryInput.value.trim(),
    answer: Number(els.answerInput.value),
    difficulty: els.difficultyInput.value,
    imageData,
    explanation: els.explanationInput.value.trim(),
    explanationImageData,
    tags: tagsToArray(els.tagsInput.value),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    attempts: existing?.attempts || 0,
    correct: existing?.correct || 0,
    wrong: existing?.wrong || 0,
    totalTimeMs: existing?.totalTimeMs || 0,
    lastTimeMs: existing?.lastTimeMs || 0,
    lastAnsweredAt: existing?.lastAnsweredAt || 0,
    lastResult: existing?.lastResult || '',
    wrongActive: existing?.wrongActive || false,
    correctStreak: existing?.correctStreak || 0,
    flagged: existing?.flagged || false,
    annotations: existing?.annotations || []
  };
  await put(STORES.problems, problem);
  await refresh();
  resetForm();
  showToast(editingId ? '수정했어' : '저장했어');
  switchView('solveView');
}

async function exportData() {
  const problems = await getAll(STORES.problems);
  const history = await getAll(STORES.history);
  const payload = {
    app: 'PSAT 랜덤 오답노트',
    version: 2,
    exportedAt: new Date().toISOString(),
    problems,
    history
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `psat-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm('백업 파일을 불러오면 같은 ID의 문제는 덮어씁니다. 진행할까?')) return;
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    showToast('JSON 파일을 읽지 못했어');
    return;
  }
  if (!Array.isArray(payload.problems)) {
    showToast('올바른 백업 파일이 아니야');
    return;
  }
  for (const p of payload.problems) await put(STORES.problems, p);
  if (Array.isArray(payload.history)) {
    for (const h of payload.history) await put(STORES.history, h);
  }
  event.target.value = '';
  await refresh();
  showToast('복원 완료');
}


function guessGitHubDefaults() {
  const host = location.hostname || '';
  const pathRepo = (location.pathname || '').split('/').filter(Boolean)[0] || 'psat-data';
  const owner = host.endsWith('.github.io') ? host.replace('.github.io', '') : '';
  return { owner, repo: pathRepo === 'psat' ? 'psat-data' : pathRepo, branch: 'main', path: 'psat-sync-data.json' };
}

function loadTombstones() {
  try {
    const data = JSON.parse(localStorage.getItem(SYNC_TOMBSTONES_KEY) || '{}');
    state.tombstones = data && typeof data === 'object' ? data : {};
  } catch (err) {
    state.tombstones = {};
  }
}

function saveTombstones() {
  localStorage.setItem(SYNC_TOMBSTONES_KEY, JSON.stringify(state.tombstones || {}));
}

function recordTombstone(id, at = Date.now()) {
  if (!id || state.syncApplying) return;
  state.tombstones = state.tombstones || {};
  state.tombstones[id] = Math.max(Number(state.tombstones[id] || 0), Number(at || Date.now()));
  saveTombstones();
}

function getSyncConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || 'null');
    if (cfg && typeof cfg === 'object') return cfg;
  } catch (err) {}
  return null;
}

function saveSyncConfig(cfg) {
  state.syncConfig = cfg;
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
}

function clearSyncConfig() {
  state.syncConfig = null;
  localStorage.removeItem(SYNC_CONFIG_KEY);
}

function renderSyncSettings() {
  const defaults = guessGitHubDefaults();
  const cfg = state.syncConfig || getSyncConfig() || defaults;
  if (!els.syncOwnerInput) return;
  els.syncOwnerInput.value = cfg.owner || defaults.owner || '';
  els.syncRepoInput.value = cfg.repo || defaults.repo || '';
  els.syncBranchInput.value = cfg.branch || 'main';
  els.syncPathInput.value = cfg.path || 'psat-sync-data.json';
  if (cfg.token && !els.syncTokenInput.value) els.syncTokenInput.value = cfg.token;
  updateSyncStatus();
}

function updateSyncStatus(text = '') {
  if (!els.syncStatus) return;
  const cfg = state.syncConfig || getSyncConfig();
  const enabled = !!(cfg && cfg.enabled);
  const last = cfg?.lastSyncAt ? ` · 마지막 ${new Date(cfg.lastSyncAt).toLocaleString()}` : '';
  const base = enabled ? '자동 동기화 켜짐' : '동기화 꺼짐';
  els.syncStatus.textContent = text || `${base}${last}`;
  els.syncStatus.classList.toggle('sync-on', enabled);
}

function readSyncForm() {
  return {
    enabled: true,
    owner: els.syncOwnerInput.value.trim(),
    repo: els.syncRepoInput.value.trim(),
    branch: els.syncBranchInput.value.trim() || 'main',
    path: els.syncPathInput.value.trim() || 'psat-sync-data.json',
    token: els.syncTokenInput.value.trim(),
    lastSyncAt: state.syncConfig?.lastSyncAt || 0
  };
}

function validateSyncConfig(cfg) {
  if (!cfg.owner || !cfg.repo || !cfg.branch || !cfg.path || !cfg.token) {
    showToast('동기화 설정을 모두 입력해줘');
    return false;
  }
  return true;
}

function startAutoSync() {
  stopAutoSync();
  const cfg = state.syncConfig || getSyncConfig();
  if (!cfg?.enabled) return;
  state.syncTimer = setInterval(() => syncNow(false), SYNC_INTERVAL_MS);
}

function stopAutoSync() {
  if (state.syncTimer) clearInterval(state.syncTimer);
  state.syncTimer = null;
}

function scheduleSyncForLocalChange(storeName) {
  // v4: 자동 동기화 기능 제거. 데이터는 기기별 저장 + JSON 백업/복원 방식으로 유지합니다.
  return;
}

function dataTimestamp(payload) {
  let max = 0;
  for (const p of payload.problems || []) {
    max = Math.max(max, Number(p.updatedAt || p.createdAt || 0));
  }
  for (const h of payload.history || []) {
    max = Math.max(max, Number(h.createdAt || 0));
  }
  for (const value of Object.values(payload.tombstones || {})) {
    max = Math.max(max, Number(value || 0));
  }
  return max;
}

async function buildSyncPayload() {
  const problems = await getAll(STORES.problems);
  const history = await getAll(STORES.history);
  loadTombstones();
  const payload = {
    app: 'PSAT 랜덤 오답노트',
    version: 3,
    contentUpdatedAt: 0,
    syncedAt: new Date().toISOString(),
    deviceId: state.deviceId,
    problems,
    history,
    tombstones: state.tombstones || {}
  };
  payload.contentUpdatedAt = dataTimestamp(payload);
  return payload;
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUtf8(base64) {
  const clean = String(base64 || '').replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function githubContentsUrl(cfg) {
  const path = String(cfg.path || '').split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
}

async function fetchRemotePayload(cfg) {
  const url = `${githubContentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (res.status === 404) return { sha: '', payload: null };
  if (!res.ok) throw new Error(`GitHub 가져오기 실패: ${res.status}`);
  const data = await res.json();
  const text = base64ToUtf8(data.content || '');
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error('동기화 파일 JSON을 읽지 못했어');
  }
  return { sha: data.sha || '', payload };
}

async function putRemotePayload(cfg, payload, sha = '') {
  const body = {
    message: `PSAT sync ${new Date().toISOString()}`,
    content: utf8ToBase64(JSON.stringify(payload)),
    branch: cfg.branch
  };
  if (sha) body.sha = sha;
  const res = await fetch(githubContentsUrl(cfg), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub 저장 실패: ${res.status} ${detail.slice(0, 120)}`);
  }
  return res.json();
}

async function applyRemotePayload(remotePayload) {
  if (!remotePayload) return false;
  let changed = false;
  state.syncApplying = true;
  try {
    loadTombstones();
    const remoteTombstones = remotePayload.tombstones || {};
    for (const [id, at] of Object.entries(remoteTombstones)) {
      state.tombstones[id] = Math.max(Number(state.tombstones[id] || 0), Number(at || 0));
    }
    saveTombstones();

    const localProblems = await getAll(STORES.problems);
    const localById = new Map(localProblems.map((p) => [p.id, p]));

    for (const local of localProblems) {
      const deletedAt = Number(state.tombstones[local.id] || 0);
      const updatedAt = Number(local.updatedAt || local.createdAt || 0);
      if (deletedAt && deletedAt >= updatedAt) {
        await tx(STORES.problems, 'readwrite', (store) => store.delete(local.id));
        changed = true;
      }
    }

    for (const remote of remotePayload.problems || []) {
      if (!remote?.id) continue;
      const deletedAt = Number(state.tombstones[remote.id] || 0);
      const remoteUpdated = Number(remote.updatedAt || remote.createdAt || 0);
      if (deletedAt && deletedAt >= remoteUpdated) continue;
      const local = localById.get(remote.id);
      const localUpdated = Number(local?.updatedAt || local?.createdAt || 0);
      if (!local || remoteUpdated > localUpdated) {
        await tx(STORES.problems, 'readwrite', (store) => store.put(remote));
        changed = true;
      }
    }

    const localHistory = await getAll(STORES.history);
    const localHistoryIds = new Set(localHistory.map((h) => h.id));
    for (const remoteHistory of remotePayload.history || []) {
      if (!remoteHistory?.id || localHistoryIds.has(remoteHistory.id)) continue;
      await tx(STORES.history, 'readwrite', (store) => store.put(remoteHistory));
      changed = true;
    }
  } finally {
    state.syncApplying = false;
  }
  if (changed) await refresh();
  return changed;
}

async function syncNow(manual = false) {
  const cfg = state.syncConfig || getSyncConfig();
  if (!cfg?.enabled) {
    if (manual) showToast('동기화가 꺼져 있어');
    return;
  }
  if (state.syncRunning) return;
  if (!navigator.onLine) {
    updateSyncStatus('오프라인이라 동기화 대기 중');
    return;
  }
  state.syncRunning = true;
  updateSyncStatus('동기화 중...');
  try {
    const remote = await fetchRemotePayload(cfg);
    const remoteContentAt = Number(remote.payload?.contentUpdatedAt || dataTimestamp(remote.payload || {}) || 0);
    await applyRemotePayload(remote.payload);
    const localPayload = await buildSyncPayload();
    if (!remote.payload || Number(localPayload.contentUpdatedAt || 0) > remoteContentAt) {
      try {
        await putRemotePayload(cfg, localPayload, remote.sha);
      } catch (err) {
        if (String(err.message || '').includes('409')) {
          const retry = await fetchRemotePayload(cfg);
          await applyRemotePayload(retry.payload);
          const retryPayload = await buildSyncPayload();
          await putRemotePayload(cfg, retryPayload, retry.sha);
        } else {
          throw err;
        }
      }
    }
    cfg.lastSyncAt = Date.now();
    saveSyncConfig(cfg);
    renderSyncSettings();
    updateSyncStatus('동기화 완료 · ' + new Date(cfg.lastSyncAt).toLocaleString());
    if (manual) showToast('동기화 완료');
  } catch (err) {
    console.error(err);
    updateSyncStatus('동기화 오류: ' + (err.message || err));
    if (manual) showToast('동기화 실패. 설정/토큰을 확인해줘.');
  } finally {
    state.syncRunning = false;
  }
}

async function pullOnlySync() {
  const cfg = state.syncConfig || getSyncConfig();
  if (!cfg?.enabled) {
    showToast('동기화 설정을 먼저 저장해줘');
    return;
  }
  if (state.syncRunning) return;
  state.syncRunning = true;
  updateSyncStatus('가져오는 중...');
  try {
    const remote = await fetchRemotePayload(cfg);
    await applyRemotePayload(remote.payload);
    cfg.lastSyncAt = Date.now();
    saveSyncConfig(cfg);
    renderSyncSettings();
    showToast('가져오기 완료');
  } catch (err) {
    console.error(err);
    showToast('가져오기 실패. 설정/토큰을 확인해줘.');
    updateSyncStatus('가져오기 오류: ' + (err.message || err));
  } finally {
    state.syncRunning = false;
  }
}

async function enableSyncFromForm() {
  const cfg = readSyncForm();
  if (!validateSyncConfig(cfg)) return;
  saveSyncConfig(cfg);
  renderSyncSettings();
  startAutoSync();
  await syncNow(true);
}

function disableSync() {
  stopAutoSync();
  clearTimeout(state.syncDebounceTimer);
  clearSyncConfig();
  if (els.syncTokenInput) els.syncTokenInput.value = '';
  renderSyncSettings();
  showToast('동기화를 껐어');
}

async function wipeAll() {
  if (!confirm('전체 문제, 오답, 필기, 풀이 기록을 모두 삭제할까?')) return;
  if (!confirm('정말 삭제할까? 백업이 없으면 복구할 수 없어.')) return;
  await clearStore(STORES.problems);
  await clearStore(STORES.history);
  state.current = null;
  state.queue = [];
  exitSolveFullscreen();
  els.solvePanel.classList.add('hidden');
  await refresh();
  showToast('전체 삭제 완료');
}

function bindEvents() {
  els.tabs.forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));
  els.startBtn.addEventListener('click', () => {
    const problems = filterProblems(els.modeSelect.value, els.subjectFilter.value);
    startSession(problems, {
      count: Number(els.sessionCount.value || 0),
      minutes: Number(els.sessionMinutes.value || 0)
    });
  });
  els.continueBtn.addEventListener('click', () => {
    const id = localStorage.getItem('psat-last-problem-id');
    const p = state.problems.find((item) => item.id === id);
    if (!p) {
      showToast('이어 풀 문제가 없어');
      return;
    }
    startDirectProblem(p);
  });
  els.solveWrongBtn.addEventListener('click', () => startSession(filterProblems('wrong', ''), { count: 0, minutes: 0 }));
  els.clearSolvedWrongBtn.addEventListener('click', async () => {
    for (const p of state.problems) {
      if (p.wrongActive && (p.correctStreak || 0) >= WRONG_CLEAR_STREAK) {
        p.wrongActive = false;
        await put(STORES.problems, p);
      }
    }
    await refresh();
    showToast('반영했어');
  });

  els.choices.forEach((btn) => btn.addEventListener('click', () => {
    if (state.checked) return;
    state.selectedAnswer = Number(btn.dataset.answer);
    els.choices.forEach((b) => b.classList.toggle('selected', b === btn));
  }));
  els.checkBtn.addEventListener('click', checkAnswer);
  els.showExpBtn.addEventListener('click', showExplanation);
  els.flagBtn.addEventListener('click', toggleFlag);
  els.nextBtn.addEventListener('click', nextProblem);

  els.penBtn.addEventListener('click', () => setDrawTool('pen'));
  els.eraserBtn.addEventListener('click', () => setDrawTool('eraser'));
  els.clearInkBtn.addEventListener('click', clearInk);
  if (els.exitSolveBtn) els.exitSolveBtn.addEventListener('click', async () => {
    await saveInkToCurrentProblem(true);
    await exitSolveFullscreen();
  });
  els.penSize.addEventListener('input', updateSizeLabels);
  els.eraserSize.addEventListener('input', updateSizeLabels);
  els.zoomOutBtn.addEventListener('click', () => zoomFromCenter(-0.25));
  els.zoomInBtn.addEventListener('click', () => zoomFromCenter(0.25));
  if (els.fitZoomBtn) els.fitZoomBtn.addEventListener('click', fitZoomToScreen);
  els.problemImage.addEventListener('load', () => window.requestAnimationFrame(() => {
    syncCanvasSize();
    if (state.autoFitOnImageLoad) {
      fitZoomToScreen();
      state.autoFitOnImageLoad = false;
    }
  }));
  window.addEventListener('resize', () => window.requestAnimationFrame(syncCanvasSize));
  els.inkCanvas.addEventListener('pointerdown', startInk);
  els.inkCanvas.addEventListener('pointermove', moveInk);
  els.inkCanvas.addEventListener('pointerup', endInk);
  els.inkCanvas.addEventListener('pointercancel', endInk);
  els.inkCanvas.addEventListener('pointerleave', (event) => {
    if (state.drawing) endInk(event);
  });

  els.problemForm.addEventListener('submit', saveProblemFromForm);
  els.resetFormBtn.addEventListener('click', resetForm);
  els.imageInput.addEventListener('change', () => imageFileInputChanged('problem', els.imageInput));
  els.explanationImageInput.addEventListener('change', () => imageFileInputChanged('explanation', els.explanationImageInput));
  els.problemPasteZone.addEventListener('click', () => setPasteTarget('problem'));
  els.problemPasteZone.addEventListener('focus', () => setPasteTarget('problem'));
  els.explanationPasteZone.addEventListener('click', () => setPasteTarget('explanation'));
  els.explanationPasteZone.addEventListener('focus', () => setPasteTarget('explanation'));
  els.problemPasteZone.addEventListener('paste', (event) => pasteImageFromClipboardEvent(event, 'problem'));
  els.explanationPasteZone.addEventListener('paste', (event) => pasteImageFromClipboardEvent(event, 'explanation'));
  els.pasteProblemBtn.addEventListener('click', () => pasteImageWithClipboardApi('problem'));
  els.pasteExplanationBtn.addEventListener('click', () => pasteImageWithClipboardApi('explanation'));
  els.clearProblemImageBtn.addEventListener('click', () => clearFormImage('problem'));
  els.clearExplanationImageBtn.addEventListener('click', () => clearFormImage('explanation'));
  document.addEventListener('paste', async (event) => {
    if (event.defaultPrevented) return;
    if (!document.getElementById('addView').classList.contains('active')) return;
    await pasteImageFromClipboardEvent(event);
  });

  els.searchInput.addEventListener('input', renderProblemList);
  els.listSubjectFilter.addEventListener('change', renderProblemList);
  els.exportBtn.addEventListener('click', exportData);
  els.importInput.addEventListener('change', importData);
  els.wipeBtn.addEventListener('click', wipeAll);
  if (els.saveSyncBtn) els.saveSyncBtn.addEventListener('click', enableSyncFromForm);
  if (els.manualSyncBtn) els.manualSyncBtn.addEventListener('click', () => syncNow(true));
  if (els.pullSyncBtn) els.pullSyncBtn.addEventListener('click', pullOnlySync);
  if (els.disableSyncBtn) els.disableSyncBtn.addEventListener('click', disableSync);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    els.installBtn.classList.remove('hidden');
  });
  els.installBtn.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    els.installBtn.classList.add('hidden');
  });
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  }
}

async function init() {
  bindEvents();
  resetForm();
  updateSizeLabels();
  setDrawEnabled(true);
  localStorage.removeItem(SYNC_CONFIG_KEY);
  await openDb();
  await refresh();
  await registerServiceWorker();
}

init().catch((err) => {
  console.error(err);
  showToast('앱 초기화 중 오류가 났어');
});
