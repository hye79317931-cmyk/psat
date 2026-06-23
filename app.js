'use strict';

const DB_NAME = 'psat-random-note-db';
const DB_VERSION = 1;
const STORES = { problems: 'problems', history: 'history' };
const SLOW_MS = 180000;
const WRONG_CLEAR_STREAK = 2;

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
  drawToggle: $('drawToggle'),
  penBtn: $('penBtn'),
  eraserBtn: $('eraserBtn'),
  penSize: $('penSize'),
  clearInkBtn: $('clearInkBtn'),
  zoomOutBtn: $('zoomOutBtn'),
  zoomInBtn: $('zoomInBtn'),
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
  wipeBtn: $('wipeBtn')
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
  drawEnabled: false,
  drawTool: 'pen',
  drawing: false,
  currentStroke: null,
  zoom: 1,
  db: null,
  deferredInstallPrompt: null
};

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
  return tx(storeName, 'readwrite', (store) => store.put(value));
}

async function remove(storeName, id) {
  return tx(storeName, 'readwrite', (store) => store.delete(id));
}

async function clearStore(storeName) {
  return tx(storeName, 'readwrite', (store) => store.clear());
}

function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
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
  state.drawEnabled = false;
  state.drawTool = 'pen';
  state.zoom = 1;
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
  setDrawEnabled(false);
  setDrawTool('pen');
  setZoom(1);
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
  const text = state.current.explanation && state.current.explanation.trim()
    ? state.current.explanation.trim()
    : '등록된 해설이 없습니다.';
  els.explanationBox.textContent = text;
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
  state.drawEnabled = enabled;
  els.inkCanvas.classList.toggle('drawing-enabled', enabled);
  els.drawToggle.textContent = enabled ? '필기모드 ON' : '필기모드 OFF';
  els.drawToggle.classList.toggle('active-tool', enabled);
}

function setDrawTool(tool) {
  state.drawTool = tool;
  els.penBtn.classList.toggle('active-tool', tool === 'pen');
  els.eraserBtn.classList.toggle('active-tool', tool === 'eraser');
}

function setZoom(value) {
  state.zoom = Math.min(2.5, Math.max(1, Number(value)));
  els.imageWrap.style.width = `${state.zoom * 100}%`;
  els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  window.requestAnimationFrame(syncCanvasSize);
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
  ctx.lineWidth = stroke.size || 4;
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

function pointerToPoint(event) {
  const rect = els.inkCanvas.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  const pressure = event.pressure && event.pressure > 0 ? event.pressure : 0.5;
  return { x, y, pressure };
}

function startInk(event) {
  if (!state.current || !state.drawEnabled) return;
  event.preventDefault();
  els.inkCanvas.setPointerCapture(event.pointerId);
  state.drawing = true;
  state.currentStroke = {
    tool: state.drawTool,
    color: '#111111',
    size: Number(els.penSize.value || 4),
    points: [pointerToPoint(event)],
    createdAt: Date.now()
  };
}

function moveInk(event) {
  if (!state.drawing || !state.currentStroke) return;
  event.preventDefault();
  state.currentStroke.points.push(pointerToPoint(event));
  redrawInk();
  const ctx = getCanvasContext();
  drawStroke(ctx, state.currentStroke, els.inkCanvas.clientWidth, els.inkCanvas.clientHeight);
}

async function endInk(event) {
  if (!state.drawing || !state.currentStroke) return;
  event.preventDefault();
  state.drawing = false;
  state.current.annotations = state.current.annotations || [];
  state.current.annotations.push(state.currentStroke);
  state.currentStroke = null;
  redrawInk();
  await saveInkToCurrentProblem(true);
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
    const hay = [p.subject, p.category, p.difficulty, p.explanation, ...(p.tags || [])].join(' ').toLowerCase();
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
  div.innerHTML = `
    <img src="${p.imageData}" alt="문제 썸네일">
    <div>
      <h3>${p.subject || '미분류'} · ${p.category || '분류없음'} · 정답 ${choiceLabel(p.answer)}</h3>
      <p>난이도 ${p.difficulty || '중'} · 풀이 ${p.attempts || 0}회 · 정답률 ${accuracy(p)}% · 평균 ${formatLongTime(averageTime(p))}</p>
      <p>${streak}${p.flagged ? ' · 다시보기 지정' : ''}</p>
      <p>${(p.tags || []).map((t) => `#${t}`).join(' ')}</p>
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
  const data = [
    ['전체 문제', `${total}개`],
    ['총 풀이', `${attempts}회`],
    ['전체 정답률', `${attempts ? Math.round(correct / attempts * 100) : 0}%`],
    ['활성 오답', `${wrongActive}개`],
    ['안 푼 문제', `${unseen}개`],
    ['오래 걸린 문제', `${slow}개`],
    ['평균 풀이시간', formatLongTime(avg)],
    ['다시보기', `${flagged}개`]
  ];
  els.statsCards.innerHTML = data.map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function resetForm() {
  els.problemForm.reset();
  els.editingId.value = '';
  els.subjectInput.value = '언어논리';
  els.difficultyInput.value = '중';
  els.formTitle.textContent = '문제 등록';
  els.previewImage.classList.add('hidden');
  els.previewImage.src = '';
  els.imageInput.required = false;
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
  els.previewImage.src = p.imageData;
  els.previewImage.classList.remove('hidden');
  els.imageInput.value = '';
  els.imageInput.required = false;
  switchView('addView');
}

async function fileToDataUrl(file) {
  const rawDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return compressImage(rawDataUrl);
}

async function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 2200;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.round(img.naturalWidth * scale);
      const height = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function saveProblemFromForm(event) {
  event.preventDefault();
  const editingId = els.editingId.value;
  const existing = editingId ? state.problems.find((p) => p.id === editingId) : null;
  const file = els.imageInput.files[0];
  if (!existing && !file) {
    showToast('문제 이미지를 올려줘');
    return;
  }
  let imageData = existing?.imageData || '';
  if (file) imageData = await fileToDataUrl(file);
  const now = Date.now();
  const problem = {
    id: existing?.id || uid(),
    subject: els.subjectInput.value.trim() || '미분류',
    category: els.categoryInput.value.trim(),
    answer: Number(els.answerInput.value),
    difficulty: els.difficultyInput.value,
    imageData,
    explanation: els.explanationInput.value.trim(),
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

async function previewSelectedImage() {
  const file = els.imageInput.files[0];
  if (!file) return;
  const data = await fileToDataUrl(file);
  els.previewImage.src = data;
  els.previewImage.classList.remove('hidden');
}

async function exportData() {
  const problems = await getAll(STORES.problems);
  const history = await getAll(STORES.history);
  const payload = {
    app: 'PSAT 랜덤 오답노트',
    version: 1,
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

async function wipeAll() {
  if (!confirm('전체 문제, 오답, 필기, 풀이 기록을 모두 삭제할까?')) return;
  if (!confirm('정말 삭제할까? 백업이 없으면 복구할 수 없어.')) return;
  await clearStore(STORES.problems);
  await clearStore(STORES.history);
  state.current = null;
  state.queue = [];
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

  els.drawToggle.addEventListener('click', () => setDrawEnabled(!state.drawEnabled));
  els.penBtn.addEventListener('click', () => setDrawTool('pen'));
  els.eraserBtn.addEventListener('click', () => setDrawTool('eraser'));
  els.clearInkBtn.addEventListener('click', clearInk);
  els.zoomOutBtn.addEventListener('click', () => setZoom(state.zoom - 0.25));
  els.zoomInBtn.addEventListener('click', () => setZoom(state.zoom + 0.25));
  els.problemImage.addEventListener('load', () => window.requestAnimationFrame(syncCanvasSize));
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
  els.imageInput.addEventListener('change', previewSelectedImage);
  els.searchInput.addEventListener('input', renderProblemList);
  els.listSubjectFilter.addEventListener('change', renderProblemList);
  els.exportBtn.addEventListener('click', exportData);
  els.importInput.addEventListener('change', importData);
  els.wipeBtn.addEventListener('click', wipeAll);

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
  await openDb();
  await refresh();
  await registerServiceWorker();
}

init().catch((err) => {
  console.error(err);
  showToast('앱 초기화 중 오류가 났어');
});
