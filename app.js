'use strict';

const DB_NAME = 'psat-random-note-db';
const DB_VERSION = 1;
const STORES = { problems: 'problems', history: 'history' };
const SLOW_MS = 180000;
const WRONG_CLEAR_STREAK = 2;
const SYNC_CONFIG_KEY = 'psat-sync-config';
const SYNC_TOMBSTONES_KEY = 'psat-sync-tombstones';
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const SUBJECT_GROUPS = ['언어', '자료', '상황'];
const PAUSED_SESSION_KEY = 'psat-paused-session-v15';

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  tabs: $$('.tab'),
  views: $$('.view'),
  installBtn: $('installBtn'),
  toast: $('toast'),

  modeSelect: $('modeSelect'),
  subjectFilter: $('subjectFilter'),
  yearFilter: $('yearFilter'),
  quickStartBtns: $$('.quick-start'),
  sessionCount: $('sessionCount'),
  sessionMinutes: $('sessionMinutes'),
  startBtn: $('startBtn'),
  continueBtn: $('continueBtn'),
  emptySolve: $('emptySolve'),
  solvePanel: $('solvePanel'),
  sessionSummary: $('sessionSummary'),
  problemTitle: $('problemTitle'),
  problemMeta: $('problemMeta'),
  questionTimer: $('questionTimer'),
  sessionTimer: $('sessionTimer'),
  leftQuestionTimer: $('leftQuestionTimer'),
  leftSessionTimer: $('leftSessionTimer'),
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
  yearInput: $('yearInput'),
  answerInput: $('answerInput'),
  difficultyInput: $('difficultyInput'),
  imageInput: $('imageInput'),
  previewImage: $('previewImage'),
  problemPasteZone: $('problemPasteZone'),
  pasteProblemBtn: $('pasteProblemBtn'),
  clearProblemImageBtn: $('clearProblemImageBtn'),
  explanationImageInput: $('explanationImageInput'),
  previewExplanationImage: $('previewExplanationImage'),
  detectAnswerBtn: $('detectAnswerBtn'),
  answerDetectStatus: $('answerDetectStatus'),
  explanationPasteZone: $('explanationPasteZone'),
  pasteExplanationBtn: $('pasteExplanationBtn'),
  clearExplanationImageBtn: $('clearExplanationImageBtn'),
  imageQualityInput: $('imageQualityInput'),
  explanationInput: $('explanationInput'),
  tagsInput: $('tagsInput'),
  resetFormBtn: $('resetFormBtn'),

  solveWrongBtn: $('solveWrongBtn'),
  clearSolvedWrongBtn: $('clearSolvedWrongBtn'),
  wrongList: $('wrongList'),
  searchInput: $('searchInput'),
  listSubjectFilter: $('listSubjectFilter'),
  listYearFilter: $('listYearFilter'),
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
  lastSession: null,
  autoNextTimer: null,
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
  formExplanationOcrData: '',
  formExplanationOcrCandidates: [],
  lastOcrText: '',
  autoFitOnImageLoad: false,
  solveFullscreenActive: false,
  saveBusy: false,
  answerDetectRunning: false,
  answerDetectTimer: null,
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
  // v8: 동기화 기능을 제거했기 때문에 tombstone 기록 없이 즉시 삭제합니다.
  const result = await tx(storeName, 'readwrite', (store) => store.delete(id));
  return result;
}

async function clearStore(storeName) {
  // v8: 동기화 기능을 제거했기 때문에 tombstone 기록 없이 즉시 초기화합니다.
  const result = await tx(storeName, 'readwrite', (store) => store.clear());
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

const FORM_PREF_KEY = 'psat-form-preferences-v12';

function readFormPreferences() {
  try {
    return JSON.parse(localStorage.getItem(FORM_PREF_KEY) || '{}') || {};
  } catch (err) {
    return {};
  }
}

function saveFormPreferences() {
  const prefs = {
    subject: els.subjectInput?.value || '언어',
    year: normalizedYear(els.yearInput?.value),
    imageQuality: els.imageQualityInput?.value || 'sharp'
  };
  localStorage.setItem(FORM_PREF_KEY, JSON.stringify(prefs));
}

function applyFormPreferences() {
  const prefs = readFormPreferences();
  if (els.subjectInput) {
    const subject = SUBJECT_GROUPS.includes(canonicalSubject(prefs.subject)) ? canonicalSubject(prefs.subject) : '언어';
    els.subjectInput.value = subject;
  }
  if (els.yearInput) els.yearInput.value = normalizedYear(prefs.year);
  if (els.imageQualityInput) {
    const quality = ['sharp', 'bulk', 'original'].includes(prefs.imageQuality) ? prefs.imageQuality : 'sharp';
    els.imageQualityInput.value = quality;
  }
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

function canonicalSubject(value) {
  const raw = String(value || '').trim();
  if (!raw) return '미분류';
  if (raw.includes('언어')) return '언어';
  if (raw.includes('자료')) return '자료';
  if (raw.includes('상황')) return '상황';
  return raw;
}

function subjectMatches(problem, filter) {
  if (!filter) return true;
  return canonicalSubject(problem.subject) === filter || String(problem.subject || '').includes(filter);
}

function normalizedYear(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/\d{4}/);
  return match ? match[0] : text;
}

function getYearSet() {
  return [...new Set(state.problems.map((p) => normalizedYear(p.year)).filter(Boolean))]
    .sort((a, b) => Number(b) - Number(a));
}

function fillYearSelect(select, keepValue = true) {
  if (!select) return;
  const current = keepValue ? select.value : '';
  select.innerHTML = '<option value="">전체</option>';
  for (const year of getYearSet()) {
    const opt = document.createElement('option');
    opt.value = year;
    opt.textContent = `${year}년`;
    select.appendChild(opt);
  }
  if (current && [...select.options].some((o) => o.value === current)) select.value = current;
}

function getSubjectSet() {
  const found = new Set(state.problems.map((p) => canonicalSubject(p.subject || '미분류')));
  const ordered = SUBJECT_GROUPS.filter((subject) => found.has(subject) || ['언어', '자료', '상황'].includes(subject));
  const extra = [...found].filter((subject) => !SUBJECT_GROUPS.includes(subject)).sort((a, b) => a.localeCompare(b, 'ko'));
  return [...ordered, ...extra];
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
  if (current && [...select.options].some((o) => o.value === current)) select.value = current;
}

async function refresh() {
  state.problems = await getAll(STORES.problems);
  state.problems.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  fillSubjectSelect(els.subjectFilter);
  fillSubjectSelect(els.listSubjectFilter);
  fillYearSelect(els.yearFilter);
  fillYearSelect(els.listYearFilter);
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

function filterProblems(mode, subject, year = '') {
  const targetYear = normalizedYear(year);
  return state.problems.filter((p) => {
    if (subject && !subjectMatches(p, subject)) return false;
    if (targetYear && normalizedYear(p.year) !== targetYear) return false;
    if (mode === 'wrong') return !!p.wrongActive;
    if (mode === 'slow') return averageTime(p) >= SLOW_MS || (p.lastTimeMs || 0) >= SLOW_MS;
    if (mode === 'unseen') return !p.attempts;
    if (mode === 'flagged') return !!p.flagged;
    return true;
  });
}

function readPausedSession() {
  try {
    return JSON.parse(localStorage.getItem(PAUSED_SESSION_KEY) || 'null');
  } catch (err) {
    return null;
  }
}

function clearPausedSession() {
  localStorage.removeItem(PAUSED_SESSION_KEY);
  updateContinueButton();
}

function updateContinueButton() {
  if (!els.continueBtn) return;
  const paused = readPausedSession();
  els.continueBtn.textContent = paused ? '중단한 세트 이어풀기' : '마지막 문제 계속';
}

function buildPausedSessionSnapshot() {
  if (!state.session || !state.current) return null;
  const now = Date.now();
  return {
    savedAt: now,
    queueIds: state.queue.map((p) => p.id),
    queueIndex: state.queueIndex,
    currentId: state.current.id,
    questionElapsed: Math.max(0, now - state.questionStart),
    sessionElapsed: Math.max(0, now - state.session.startedAt),
    remainingMs: state.session.endAt ? Math.max(0, state.session.endAt - now) : 0,
    session: {
      label: state.session.label || '중단한 풀이',
      total: state.session.total || state.queue.length,
      answered: state.session.answered || 0,
      correct: state.session.correct || 0,
      problemIds: [...(state.session.problemIds || state.queue.map((p) => p.id))],
      answeredIds: [...(state.session.answeredIds || [])],
      wrongIds: [...(state.session.wrongIds || [])]
    }
  };
}

async function pauseCurrentSession() {
  if (!state.current) {
    stopTimer();
    await exitSolveFullscreen();
    return;
  }
  stopTimer();
  await saveInkToCurrentProblem(true);
  const snapshot = buildPausedSessionSnapshot();
  if (snapshot) localStorage.setItem(PAUSED_SESSION_KEY, JSON.stringify(snapshot));
  state.questionStart = 0;
  state.current = null;
  state.session = null;
  els.solvePanel.classList.add('hidden');
  await exitSolveFullscreen();
  updateContinueButton();
  showToast('문제풀이를 중단했어. 푼 부분은 저장됐어.');
}

function resumePausedSession() {
  const paused = readPausedSession();
  if (!paused) return false;
  const queue = (paused.queueIds || []).map((id) => state.problems.find((p) => p.id === id)).filter(Boolean);
  if (!queue.length) {
    clearPausedSession();
    showToast('이어 풀 문제가 없어');
    return true;
  }
  clearTimeout(state.autoNextTimer);
  state.autoNextTimer = null;
  state.queue = queue;
  state.queueIndex = Math.min(Math.max(Number(paused.queueIndex || 0), 0), queue.length - 1);
  const savedSession = paused.session || {};
  const now = Date.now();
  state.session = {
    label: savedSession.label || '중단한 풀이',
    startedAt: now - Math.max(0, Number(paused.sessionElapsed || 0)),
    endAt: paused.remainingMs ? now + Math.max(0, Number(paused.remainingMs || 0)) : 0,
    total: savedSession.total || queue.length,
    answered: savedSession.answered || 0,
    correct: savedSession.correct || 0,
    elapsedOnFinish: 0,
    problemIds: savedSession.problemIds?.length ? [...savedSession.problemIds] : queue.map((p) => p.id),
    answeredIds: [...(savedSession.answeredIds || [])],
    wrongIds: [...(savedSession.wrongIds || [])]
  };
  const current = state.problems.find((p) => p.id === paused.currentId) || queue[state.queueIndex];
  loadCurrentProblem(current);
  state.questionStart = Date.now() - Math.max(0, Number(paused.questionElapsed || 0));
  updateTimers();
  switchView('solveView');
  showToast('중단한 부분부터 이어풀기');
  return true;
}

function startSession(problems, options = {}) {
  clearPausedSession();
  if (!problems.length) {
    showToast('해당 조건의 문제가 없어');
    return;
  }
  clearTimeout(state.autoNextTimer);
  state.autoNextTimer = null;
  if (els.sessionSummary) els.sessionSummary.classList.add('hidden');
  const count = Number(options.count || 0);
  const source = options.preserveOrder ? [...problems] : shuffle(problems);
  state.queue = source.slice(0, count > 0 ? Math.min(count, source.length) : source.length);
  state.queueIndex = 0;
  const minutes = Number(options.minutes || 0);
  state.session = {
    label: options.label || '랜덤 풀이',
    startedAt: Date.now(),
    endAt: minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0,
    total: state.queue.length,
    answered: 0,
    correct: 0,
    elapsedOnFinish: 0,
    problemIds: state.queue.map((p) => p.id),
    answeredIds: [],
    wrongIds: []
  };
  loadCurrentProblem(state.queue[0]);
  switchView('solveView');
}

function startDirectProblem(problem) {
  clearPausedSession();
  clearTimeout(state.autoNextTimer);
  state.autoNextTimer = null;
  if (els.sessionSummary) els.sessionSummary.classList.add('hidden');
  state.queue = [problem];
  state.queueIndex = 0;
  state.session = {
    label: '단일 문제',
    startedAt: Date.now(),
    endAt: 0,
    total: 1,
    answered: 0,
    correct: 0,
    elapsedOnFinish: 0,
    problemIds: [problem.id],
    answeredIds: [],
    wrongIds: []
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
  const yearText = normalizedYear(problem.year) ? ` · ${normalizedYear(problem.year)}년` : '';
  els.problemMeta.textContent = `${canonicalSubject(problem.subject)}${yearText} · 정답률 ${accuracy(problem)}% · ${avg}`;
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

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
  clearTimeout(state.autoNextTimer);
  state.autoNextTimer = null;
}

function updateTimers() {
  if (!state.current || !state.questionStart) {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    return;
  }
  const questionText = formatTime(Date.now() - state.questionStart);
  if (els.questionTimer) els.questionTimer.textContent = questionText;
  if (els.leftQuestionTimer) els.leftQuestionTimer.textContent = questionText;

  const hasSessionTimer = state.session && state.session.endAt;
  if (els.sessionTimer) els.sessionTimer.classList.toggle('hidden', !hasSessionTimer);
  if (els.leftSessionTimer) els.leftSessionTimer.classList.toggle('hidden', !hasSessionTimer);
  if (hasSessionTimer) {
    const remain = state.session.endAt - Date.now();
    const sessionText = `세션 ${formatTime(remain)}`;
    if (els.sessionTimer) els.sessionTimer.textContent = sessionText;
    if (els.leftSessionTimer) els.leftSessionTimer.textContent = sessionText;
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

async function checkAnswer(options = {}) {
  if (!state.current) return;
  if (state.checked) {
    if (options.autoAdvance) return;
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
    if (!state.session.answeredIds.includes(p.id)) state.session.answeredIds.push(p.id);
    if (isCorrect) state.session.correct += 1;
    if (!isCorrect && !state.session.wrongIds.includes(p.id)) state.session.wrongIds.push(p.id);
  }

  markChoiceButtons(p.answer, state.selectedAnswer);
  els.resultBox.className = `result ${isCorrect ? 'ok' : 'no'}`;
  const clearText = isCorrect && !p.wrongActive && (p.correctStreak || 0) >= WRONG_CLEAR_STREAK
    ? '<br>오답노트에서 자동 해제됨.'
    : '';
  els.resultBox.innerHTML = `${isCorrect ? '정답입니다.' : '오답입니다.'}<br>선택: ${choiceLabel(state.selectedAnswer)} / 정답: ${choiceLabel(p.answer)}<br>풀이시간: ${formatLongTime(elapsed)}${clearText}`;
  els.resultBox.classList.remove('hidden');
  if (options.autoAdvance) {
    els.explanationBox.classList.add('hidden');
  } else {
    showExplanation();
  }
  await refresh();
  if (options.autoAdvance) {
    clearTimeout(state.autoNextTimer);
    const isLast = !state.session || state.queueIndex + 1 >= state.queue.length;
    state.autoNextTimer = setTimeout(() => nextProblem(), isLast ? 450 : 650);
  }
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
  clearTimeout(state.autoNextTimer);
  state.autoNextTimer = null;
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
  const session = state.session;
  const elapsed = Date.now() - session.startedAt;
  session.elapsedOnFinish = elapsed;
  stopTimer();
  state.current = null;
  exitSolveFullscreen();
  els.solvePanel.classList.add('hidden');
  state.lastSession = {
    label: session.label || '랜덤 풀이',
    timeout: !!timeout,
    total: session.total,
    answered: session.answered,
    correct: session.correct,
    elapsed,
    problemIds: [...(session.problemIds || [])],
    wrongIds: [...(session.wrongIds || [])]
  };
  state.session = null;
  clearPausedSession();
  renderSessionSummary();
  showToast(timeout ? '제한시간이 끝났어' : '세션 완료');
}

function renderSessionSummary(showWrongList = false) {
  if (!els.sessionSummary || !state.lastSession) return;
  const s = state.lastSession;
  const wrongCount = s.wrongIds.length;
  const rate = s.answered ? Math.round(s.correct / s.answered * 100) : 0;
  const wrongListHtml = showWrongList
    ? `<div class="summary-wrong-list">${renderSummaryWrongItems(s.wrongIds)}</div>`
    : '';
  els.sessionSummary.innerHTML = `
    <h2>${s.timeout ? '시간 종료' : '세트 완료'} · ${escapeHtml(s.label || '')}</h2>
    <div class="summary-stats">
      <div><span>풀이</span><strong>${s.answered}/${s.total}</strong></div>
      <div><span>정답</span><strong>${s.correct}</strong></div>
      <div><span>오답</span><strong>${wrongCount}</strong></div>
      <div><span>정답률</span><strong>${rate}%</strong></div>
      <div><span>시간</span><strong>${formatLongTime(s.elapsed)}</strong></div>
    </div>
    <div class="summary-actions">
      <button data-summary-action="wrong-review" ${wrongCount ? '' : 'disabled'} type="button">틀린문제 다시풀기</button>
      <button data-summary-action="wrong-list" ${wrongCount ? '' : 'disabled'} class="secondary" type="button">틀린문제 보기</button>
      <button data-summary-action="all-review" class="secondary" type="button">전체 다시풀기</button>
      <button data-summary-action="new-random" class="secondary" type="button">새 랜덤</button>
    </div>
    ${wrongListHtml}
  `;
  els.sessionSummary.classList.remove('hidden');
}

function renderSummaryWrongItems(ids) {
  const items = ids.map((id) => state.problems.find((p) => p.id === id)).filter(Boolean);
  if (!items.length) return '<p class="hint">틀린 문제가 없어.</p>';
  return items.map((p, idx) => `
    <article class="summary-wrong-item">
      <img src="${p.imageData}" alt="틀린 문제 ${idx + 1}">
      <div>
        <strong>${idx + 1}. ${escapeHtml(canonicalSubject(p.subject))}${normalizedYear(p.year) ? ` · ${escapeHtml(normalizedYear(p.year))}년` : ''}</strong>
        <span>정답 ${choiceLabel(p.answer)} · 최근 풀이 ${formatLongTime(p.lastTimeMs || 0)}</span>
        <button data-action="solve" data-id="${p.id}" type="button">이 문제 풀기</button>
      </div>
    </article>
  `).join('');
}

function startReviewByIds(ids, label) {
  const list = ids.map((id) => state.problems.find((p) => p.id === id)).filter(Boolean);
  if (!list.length) {
    showToast('다시 풀 문제가 없어');
    return;
  }
  startSession(list, { preserveOrder: true, label });
}

function handleSessionSummaryClick(event) {
  const actionBtn = event.target.closest('[data-summary-action]');
  if (actionBtn) {
    const action = actionBtn.dataset.summaryAction;
    if (action === 'wrong-review') startReviewByIds(state.lastSession?.wrongIds || [], '틀린문제 다시풀기');
    if (action === 'wrong-list') renderSessionSummary(true);
    if (action === 'all-review') startReviewByIds(state.lastSession?.problemIds || [], '전체 다시풀기');
    if (action === 'new-random') {
      els.sessionSummary.classList.add('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }
  const solveBtn = event.target.closest('button[data-action="solve"]');
  if (solveBtn) {
    const p = state.problems.find((item) => item.id === solveBtn.dataset.id);
    if (p) startDirectProblem(p);
  }
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
  state.zoom = Math.min(5, Math.max(0.05, Number(value))); // v6: 한 화면 맞춤을 위해 5%까지 축소
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
  const fit = Math.min(1, Math.max(0.05, fitByHeight));
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
  const year = els.listYearFilter?.value || '';
  const list = state.problems.filter((p) => {
    if (subject && !subjectMatches(p, subject)) return false;
    if (year && normalizedYear(p.year) !== year) return false;
    if (!query) return true;
    const imageKeyword = p.explanationImageData ? '해설이미지 스크린샷' : '';
    const hay = [canonicalSubject(p.subject), p.subject, p.year, p.explanation, imageKeyword].join(' ').toLowerCase();
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
  const hasExpImage = p.explanationImageData ? ' · 해설이미지 있음' : '';
  div.innerHTML = `
    <img src="${p.imageData}" alt="문제 썸네일">
    <div>
      <h3>${escapeHtml(canonicalSubject(p.subject))}${normalizedYear(p.year) ? ` · ${escapeHtml(normalizedYear(p.year))}년` : ''} · 정답 ${choiceLabel(p.answer)}</h3>
      <p>풀이 ${p.attempts || 0}회 · 정답률 ${accuracy(p)}% · 평균 ${formatLongTime(averageTime(p))}</p>
      <p>${escapeHtml(streak)}${p.flagged ? ' · 다시보기 지정' : ''}${hasExpImage}</p>
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

async function deleteProblemById(id) {
  const target = state.problems.find((item) => item.id === id);
  if (!target) {
    showToast('이미 삭제된 문제야');
    return;
  }
  try {
    await remove(STORES.problems, id);

    // 이 문제의 풀이 기록도 같이 삭제해서 통계/백업에 남지 않게 처리합니다.
    const histories = await getAll(STORES.history);
    for (const h of histories) {
      if (h.problemId === id) await remove(STORES.history, h.id);
    }

    if (state.current && state.current.id === id) {
      await saveInkToCurrentProblem(false).catch(() => {});
      state.current = null;
      state.selectedAnswer = null;
      state.checked = false;
      els.solvePanel.classList.add('hidden');
      exitSolveFullscreen();
    }
    state.queue = state.queue.filter((item) => item.id !== id);
    localStorage.removeItem('psat-last-problem-id');

    await refresh();
    showToast('문제를 삭제했어');
  } catch (err) {
    console.error(err);
    showToast('삭제 중 오류가 났어. 앱을 새로고침한 뒤 다시 시도해줘.');
  }
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
    await deleteProblemById(id);
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

function setAnswerDetectStatus(message) {
  if (els.answerDetectStatus) els.answerDetectStatus.textContent = message || '';
}

function normalizeAnswerText(text) {
  return String(text || '')
    .replace(/[①❶➀⓵]/g, '1')
    .replace(/[②❷➁⓶]/g, '2')
    .replace(/[③❸➂⓷]/g, '3')
    .replace(/[④❹➃⓸]/g, '4')
    .replace(/[⑤❺➄⓹]/g, '5')
    .replace(/[⑴㈠]/g, '1')
    .replace(/[⑵㈡]/g, '2')
    .replace(/[⑶㈢]/g, '3')
    .replace(/[⑷㈣]/g, '4')
    .replace(/[⑸㈤]/g, '5')
    .replace(/［|\[/g, '[')
    .replace(/］|\]/g, ']')
    .replace(/[：﹕]/g, ':')
    .replace(/[|]/g, '1')
    .replace(/[ＯOo〇○◯]/g, '0')
    .replace(/[×✕✖]/g, 'X');
}

function extractAnswerNumberFromText(rawText) {
  const text = normalizeAnswerText(rawText);
  // 예: "정답률 93.38%"는 절대 정답 단서로 쓰면 안 됨. 먼저 제거합니다.
  const noRate = text.replace(/정\s*답\s*[률율][^\n\r]*/g, ' ');
  const compact = noRate.replace(/\s+/g, ' ');
  const lines = noRate.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  const strictPatterns = [
    /(?:정\s*답)(?!\s*[률율])\s*[:：\-]?\s*([1-5])\s*(?:번|[.)\]】〉>]|$)?/i,
    /(?:해\s*답|해답|답안)\s*[:：\-]?\s*([1-5])\s*(?:번|[.)\]】〉>]|$)?/i,
    /(?:correct\s*answer|answer|ans)\s*[:：\-]?\s*([1-5])/i,
    /([1-5])\s*번\s*(?:이|가)?\s*(?:정\s*답|답)/i
  ];
  for (const pattern of strictPatterns) {
    const match = compact.match(pattern) || noRate.match(pattern);
    if (match && match[1]) return Number(match[1]);
  }

  // OCR이 줄바꿈을 살린 경우: "정답"이 들어간 줄과 그 다음 줄만 검색합니다.
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/정\s*답\s*[률율]/.test(line)) continue;
    if (!/(정\s*답|해\s*답|해답|답안|answer|ans)/i.test(line)) continue;
    const windowText = [line, lines[i + 1] || ''].join(' ');
    const m = windowText.match(/(?:정\s*답|해\s*답|해답|답안|answer|ans)?\s*[:：\-]?\s*([1-5])\s*(?:번|[.)\]】〉>]|$)?/i);
    if (m) return Number(m[1]);
  }

  // 해설지 형식: ①(X) ②(X) ③(X) ④(O) ⑤(X) 처럼 정답 선지에 O가 붙는 경우.
  const markedCorrect = compact.match(/(?:^|\s)([1-5])\s*[\(\[\{]?\s*(?:0|ㅇ)\s*[\)\]\}]?/i);
  if (markedCorrect && markedCorrect[1]) return Number(markedCorrect[1]);

  return 0;
}

async function detectAnswerFromExplanationImage(manual = false) {
  const candidates = (state.formExplanationOcrCandidates && state.formExplanationOcrCandidates.length)
    ? state.formExplanationOcrCandidates
    : [state.formExplanationOcrData || state.formExplanationImageData].filter(Boolean);
  if (!candidates.length) {
    if (manual) showToast('해설 이미지를 먼저 넣어줘');
    setAnswerDetectStatus('해설 이미지가 아직 없어.');
    return;
  }
  if (state.answerDetectRunning) return;
  if (!window.Tesseract || !window.Tesseract.recognize) {
    const msg = 'OCR 로딩 전이야. 인터넷 연결 후 잠시 뒤 다시 눌러줘.';
    setAnswerDetectStatus(msg);
    if (manual) showToast(msg);
    return;
  }
  state.answerDetectRunning = true;
  setAnswerDetectStatus('정답 인식 중... 조금 걸릴 수 있어.');
  try {
    let foundAnswer = 0;
    let collectedText = '';
    for (let i = 0; i < candidates.length; i += 1) {
      const label = i === 0 ? '오른쪽 위 정답칸' : (i === 1 ? '상단 영역' : '전체 해설');
      const result = await window.Tesseract.recognize(candidates[i], 'kor+eng', {
        logger: (m) => {
          if (!m || m.status !== 'recognizing text') return;
          const pct = Math.round((m.progress || 0) * 100);
          setAnswerDetectStatus(`${label} 인식 중... ${pct}%`);
        }
      });
      const text = result?.data?.text || '';
      collectedText += `\n--- ${label} ---\n${text}`;
      foundAnswer = extractAnswerNumberFromText(text);
      if (foundAnswer >= 1 && foundAnswer <= 5) break;
    }
    state.lastOcrText = collectedText;
    if (foundAnswer >= 1 && foundAnswer <= 5) {
      els.answerInput.value = String(foundAnswer);
      setAnswerDetectStatus(`정답 ${choiceLabel(foundAnswer)} 자동 입력됨`);
      showToast(`정답 ${choiceLabel(foundAnswer)} 자동 입력됨`);
    } else {
      setAnswerDetectStatus('정답 자동인식 실패. 정답 칸이 너무 작으면 직접 선택해줘.');
      if (manual) showToast('정답을 못 찾았어. 직접 선택해줘.');
    }
  } catch (err) {
    console.warn('Answer OCR failed', err);
    setAnswerDetectStatus('정답 인식 실패. 직접 선택해줘.');
    if (manual) showToast('정답 인식 실패. 직접 선택해줘.');
  } finally {
    state.answerDetectRunning = false;
  }
}

function scheduleAnswerDetection() {
  clearTimeout(state.answerDetectTimer);
  state.answerDetectTimer = setTimeout(() => detectAnswerFromExplanationImage(false), 400);
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
    state.formExplanationOcrData = '';
    state.formExplanationOcrCandidates = [];
    state.lastOcrText = '';
    els.explanationImageInput.value = '';
    els.previewExplanationImage.src = '';
    els.previewExplanationImage.classList.add('hidden');
  }
}

function resetForm() {
  const keepSubject = els.subjectInput?.value || readFormPreferences().subject || '언어';
  const keepYear = els.yearInput?.value || readFormPreferences().year || '';
  const keepQuality = els.imageQualityInput?.value || readFormPreferences().imageQuality || 'sharp';
  els.problemForm.reset();
  els.editingId.value = '';
  els.subjectInput.value = SUBJECT_GROUPS.includes(canonicalSubject(keepSubject)) ? canonicalSubject(keepSubject) : '언어';
  if (els.yearInput) els.yearInput.value = normalizedYear(keepYear);
  if (els.imageQualityInput) els.imageQualityInput.value = ['sharp', 'bulk', 'original'].includes(keepQuality) ? keepQuality : 'sharp';
  if (els.categoryInput) els.categoryInput.value = '';
  if (els.difficultyInput) els.difficultyInput.value = '중';
  if (els.tagsInput) els.tagsInput.value = '';
  saveFormPreferences();
  els.formTitle.textContent = '문제 등록';
  clearFormImage('problem');
  clearFormImage('explanation');
  setAnswerDetectStatus('해설 스샷을 붙이면 정답 인식을 시도합니다.');
  els.imageInput.required = false;
  setPasteTarget('problem');
}

function editProblem(p) {
  els.formTitle.textContent = '문제 수정';
  els.editingId.value = p.id;
  els.subjectInput.value = SUBJECT_GROUPS.includes(canonicalSubject(p.subject)) ? canonicalSubject(p.subject) : '언어';
  if (els.yearInput) els.yearInput.value = normalizedYear(p.year);
  if (els.categoryInput) els.categoryInput.value = p.category || '';
  els.answerInput.value = String(p.answer || 1);
  if (els.difficultyInput) els.difficultyInput.value = p.difficulty || '중';
  els.explanationInput.value = p.explanation || '';
  if (els.tagsInput) els.tagsInput.value = (p.tags || []).join(', ');
  saveFormPreferences();
  els.imageInput.value = '';
  els.explanationImageInput.value = '';
  setFormImage('problem', p.imageData || '');
  if (p.explanationImageData) {
    state.formExplanationOcrData = p.explanationImageData;
    state.formExplanationOcrCandidates = [p.explanationImageData];
    setFormImage('explanation', p.explanationImageData);
  }
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

function dataUrlBytes(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  const payload = comma >= 0 ? String(dataUrl).slice(comma + 1) : String(dataUrl || '');
  return Math.floor(payload.length * 3 / 4);
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function compressionPreset() {
  const mode = els.imageQualityInput?.value || 'sharp';
  if (mode === 'original') return { mode, label: '원본', maxWidth: Infinity, quality: 1, mime: '' };
  if (mode === 'bulk') return { mode, label: '3000문제용', maxWidth: 1700, quality: 0.86, mime: 'image/webp' };
  return { mode: 'sharp', label: '선명압축', maxWidth: 2200, quality: 0.94, mime: 'image/webp' };
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽지 못했어'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

async function imageBlobToDataUrl(blob) {
  const preset = compressionPreset();
  if (preset.mode === 'original') return blobToDataUrl(blob);

  try {
    const img = await blobToImage(blob);
    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;
    if (!originalWidth || !originalHeight) return blobToDataUrl(blob);

    const scale = Math.min(1, preset.maxWidth / originalWidth);
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let out = await canvasToBlob(canvas, preset.mime, preset.quality);
    // 일부 브라우저에서 WebP 변환이 실패하면 JPEG로 저장합니다.
    if (!out) out = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    if (!out) return blobToDataUrl(blob);
    return blobToDataUrl(out);
  } catch (err) {
    console.warn('Image optimization failed, storing original', err);
    return blobToDataUrl(blob);
  }
}


async function imageBlobToOcrDataUrl(blob, crop = null) {
  try {
    const img = await blobToImage(blob);
    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;
    if (!originalWidth || !originalHeight) return blobToDataUrl(blob);

    const cropX = crop ? Math.max(0, Math.round(originalWidth * crop.x)) : 0;
    const cropY = crop ? Math.max(0, Math.round(originalHeight * crop.y)) : 0;
    const cropW = crop ? Math.min(originalWidth - cropX, Math.round(originalWidth * crop.w)) : originalWidth;
    const cropH = crop ? Math.min(originalHeight - cropY, Math.round(originalHeight * crop.h)) : originalHeight;
    if (cropW <= 0 || cropH <= 0) return blobToDataUrl(blob);

    // 정답 자동인식은 전체 해설보다 "오른쪽 위 정답칸"을 먼저 크게 확대해서 읽습니다.
    const targetWidth = crop ? 2200 : Math.min(3400, Math.max(2400, cropW));
    const scale = targetWidth / cropW;
    const width = Math.max(1, Math.round(cropW * scale));
    const height = Math.max(1, Math.round(cropH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const boosted = gray < 190 ? Math.max(0, gray * 0.40) : Math.min(255, 248 + (gray - 190) * 0.35);
      d[i] = boosted;
      d[i + 1] = boosted;
      d[i + 2] = boosted;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    const out = await canvasToBlob(canvas, 'image/png', 1);
    return out ? blobToDataUrl(out) : blobToDataUrl(blob);
  } catch (err) {
    console.warn('OCR image preprocessing failed', err);
    return blobToDataUrl(blob);
  }
}

async function imageBlobToAnswerOcrCandidates(blob) {
  // 1순위: 오른쪽 위 정답칸. 사용자가 보낸 해설처럼 "정답 ④"가 이 위치에 있는 경우가 많음.
  // 2순위: 상단 전체. 3순위: 전체 해설. 정답률·선지 내용 오인식을 줄이기 위한 순서입니다.
  const crops = [
    { x: 0.52, y: 0.00, w: 0.48, h: 0.25 },
    { x: 0.00, y: 0.00, w: 1.00, h: 0.32 },
    null
  ];
  const out = [];
  for (const crop of crops) out.push(await imageBlobToOcrDataUrl(blob, crop));
  return out;
}

async function fileToDataUrl(file) {
  return imageBlobToDataUrl(file);
}

function sizeToastPrefix(dataUrl) {
  return `저장크기 ${formatBytes(dataUrlBytes(dataUrl))}`;
}

async function imageFileInputChanged(target, input) {
  const file = input.files[0];
  if (!file) return;
  showToast('이미지 처리 중...');
  const data = await fileToDataUrl(file);
  if (target === 'explanation') {
    state.formExplanationOcrCandidates = await imageBlobToAnswerOcrCandidates(file);
    state.formExplanationOcrData = state.formExplanationOcrCandidates[0] || '';
  }
  setFormImage(target, data);
  setPasteTarget(target);
  if (target === 'explanation') scheduleAnswerDetection();
  showToast(`${target === 'problem' ? '문제 이미지' : '해설 이미지'}를 넣었어 · ${sizeToastPrefix(data)}`);
}

async function pasteImageFromClipboardEvent(event, explicitTarget = '') {
  const items = event.clipboardData?.items ? Array.from(event.clipboardData.items) : [];
  const item = items.find((entry) => entry.type && entry.type.startsWith('image/'));
  if (!item) return false;
  event.preventDefault();
  const target = explicitTarget || event.target.closest?.('[data-paste-target]')?.dataset?.pasteTarget || state.activePasteTarget || 'problem';
  const file = item.getAsFile();
  if (!file) return false;
  showToast('스크린샷 처리 중...');
  const data = await fileToDataUrl(file);
  if (target === 'explanation') {
    state.formExplanationOcrCandidates = await imageBlobToAnswerOcrCandidates(file);
    state.formExplanationOcrData = state.formExplanationOcrCandidates[0] || '';
  }
  setFormImage(target, data);
  setPasteTarget(target);
  if (target === 'explanation') scheduleAnswerDetection();
  showToast(`${target === 'problem' ? '문제 스샷' : '해설 스샷'}을 붙여넣었어 · ${sizeToastPrefix(data)}`);
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
      showToast('스크린샷 처리 중...');
      const data = await imageBlobToDataUrl(blob);
      if (target === 'explanation') {
        state.formExplanationOcrCandidates = await imageBlobToAnswerOcrCandidates(blob);
        state.formExplanationOcrData = state.formExplanationOcrCandidates[0] || '';
      }
      setFormImage(target, data);
      if (target === 'explanation') scheduleAnswerDetection();
      showToast(`${target === 'problem' ? '문제 스샷' : '해설 스샷'}을 붙여넣었어 · ${sizeToastPrefix(data)}`);
      return;
    }
    showToast('클립보드에 이미지가 없어');
  } catch (err) {
    showToast('붙여넣기 권한이 막혔어. 영역 클릭 후 Ctrl+V를 눌러줘.');
  }
}

function storageErrorMessage(err) {
  const name = String(err?.name || '');
  const msg = String(err?.message || err || '');
  if (name.includes('Quota') || msg.includes('quota') || msg.includes('Quota')) {
    return '저장공간이 부족해. 이미지 저장 방식을 3000문제용 압축으로 바꾸거나 기존 문제를 백업 후 정리해줘.';
  }
  return '저장 중 오류가 났어. 새로고침 후 다시 시도해줘.';
}

async function saveProblemFromForm(event) {
  event.preventDefault();
  if (state.saveBusy) return;
  state.saveBusy = true;
  const submitBtn = event.submitter || els.problemForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
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

    saveFormPreferences();
    const now = Date.now();
    const problem = {
      id: existing?.id || uid(),
      subject: canonicalSubject(els.subjectInput.value),
      year: normalizedYear(els.yearInput?.value),
      category: els.categoryInput?.value?.trim() || '',
      answer: Number(els.answerInput.value),
      difficulty: els.difficultyInput?.value || '중',
      imageData,
      explanation: els.explanationInput.value.trim(),
      explanationImageData,
      tags: tagsToArray(els.tagsInput?.value || ''),
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
    showToast(`${editingId ? '수정했어' : '저장했어'} · 현재 ${state.problems.length}문제`);
    switchView('addView');
  } catch (err) {
    console.error(err);
    showToast(storageErrorMessage(err));
  } finally {
    state.saveBusy = false;
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function exportData() {
  const problems = await getAll(STORES.problems);
  const history = await getAll(STORES.history);
  const payload = {
    app: 'PSAT 랜덤 오답노트',
    version: 15,
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
  localStorage.removeItem('psat-sync-config');
  localStorage.removeItem('psat-sync-tombstones');
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
    const problems = filterProblems(els.modeSelect.value, els.subjectFilter.value, els.yearFilter?.value || '');
    const label = `${els.subjectFilter.value || '전체'}${els.yearFilter?.value ? ' · ' + els.yearFilter.value + '년' : ''} 랜덤`;
    startSession(problems, {
      count: Number(els.sessionCount.value || 0),
      minutes: Number(els.sessionMinutes.value || 0),
      label
    });
  });
  els.quickStartBtns.forEach((btn) => btn.addEventListener('click', () => {
    const subject = btn.dataset.subject || '언어';
    const count = Number(btn.dataset.count || 10);
    const problems = filterProblems('all', subject, els.yearFilter?.value || '');
    startSession(problems, { count, minutes: 0, label: `${subject} 랜덤 ${count}문제` });
  }));

  if (els.yearFilter) els.yearFilter.addEventListener('change', () => {});

  els.continueBtn.addEventListener('click', () => {
    if (resumePausedSession()) return;
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

  els.choices.forEach((btn) => btn.addEventListener('click', async () => {
    if (state.checked) return;
    state.selectedAnswer = Number(btn.dataset.answer);
    els.choices.forEach((b) => b.classList.toggle('selected', b === btn));
    await checkAnswer({ autoAdvance: true });
  }));
  els.checkBtn.addEventListener('click', () => checkAnswer({ autoAdvance: false }));
  els.showExpBtn.addEventListener('click', showExplanation);
  els.flagBtn.addEventListener('click', toggleFlag);
  els.nextBtn.addEventListener('click', nextProblem);

  els.penBtn.addEventListener('click', () => setDrawTool('pen'));
  els.eraserBtn.addEventListener('click', () => setDrawTool('eraser'));
  els.clearInkBtn.addEventListener('click', clearInk);
  if (els.exitSolveBtn) els.exitSolveBtn.addEventListener('click', pauseCurrentSession);
  els.penSize.addEventListener('input', updateSizeLabels);
  els.eraserSize.addEventListener('input', updateSizeLabels);
  els.zoomOutBtn.addEventListener('click', () => zoomFromCenter(state.zoom <= 0.35 ? -0.05 : -0.20));
  els.zoomInBtn.addEventListener('click', () => zoomFromCenter(state.zoom < 0.35 ? 0.05 : 0.20));
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
  if (els.subjectInput) els.subjectInput.addEventListener('change', saveFormPreferences);
  if (els.yearInput) els.yearInput.addEventListener('input', saveFormPreferences);
  if (els.imageQualityInput) els.imageQualityInput.addEventListener('change', saveFormPreferences);
  if (els.detectAnswerBtn) els.detectAnswerBtn.addEventListener('click', () => detectAnswerFromExplanationImage(true));
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
  if (els.listYearFilter) els.listYearFilter.addEventListener('change', renderProblemList);
  if (els.sessionSummary) els.sessionSummary.addEventListener('click', handleSessionSummaryClick);
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
  applyFormPreferences();
  resetForm();
  updateSizeLabels();
  setDrawEnabled(true);
  localStorage.removeItem('psat-sync-config');
  localStorage.removeItem('psat-sync-tombstones');
  await openDb();
  await refresh();
  updateContinueButton();
  await registerServiceWorker();
}

init().catch((err) => {
  console.error(err);
  showToast('앱 초기화 중 오류가 났어');
});
