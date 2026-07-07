// PokerTimerPLUS+ multi-tournament-4up Phase 1 — 手元 PC 側 4区画操作盤（状態の真実源）
//
// 設計原則（Phase 1 brief D / E / G）:
//   - エンジン4個はこの window に常駐（インスタンス間の共有可変状態ゼロ = 区画独立性）
//   - 区画割当は保存済みトーナメントの読み取り専用 snapshot 化。
//     store への書込（tournaments:setTimerState / setRuntime / setActive）は一切しない
//     （既存の active 1 枠永続化・5秒 rebase と構造的に衝突させない = 致命保護⑤非接触の根拠）
//   - edge イベント（割当 / start / pause / level / reset / フィラー変更）時のみ multi:publish で
//     grid へ push。間は grid が endAtMs seed で自走（ポーリングなし）
//   - 既存 timer.js / state.js / blinds.js / audio.js は import しない

import { createClockEngine, computePaneNow, formatPreStartClock, ENGINE_STATUS } from './multi-engine.mjs';

const PANE_COUNT = 4;
const STATE_LABEL = Object.freeze({
  idle: '停止中', prestart: 'カウントダウン中', running: '進行中', paused: '一時停止中', finished: '終了', break: 'ブレイク中'
});
const FILLER_KINDS = new Set(['blank', 'logo', 'image', 'text']);

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(totalSec / 3600);
  return h > 0
    ? `${pad(h)}:${pad(Math.floor((totalSec % 3600) / 60))}:${pad(totalSec % 60)}`
    : `${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}`;
}

const grid = document.getElementById('js-mc-grid');
const exitBtn = document.getElementById('js-mc-exit');
const gridFrontBtn = document.getElementById('js-mc-grid-front');
let tournaments = []; // tournaments:list の読み取り専用コピー
const panes = [];     // { root, els, tournamentId, filler, snapshot, engine }

// Phase 2: キーボード操作（mirror 保険）の UI 状態。真実源はこの window（grid は表示専用）
let activePane = null;   // 操作対象区画 index（1〜4 キーで選択）
let helpVisible = false; // grid 上のキー割当ヘルプ表示（H でトグル・常時表示しない）
let resetArm = null;     // R 2 度押し確認 { index, timerId }（mirror 中は confirm ダイアログが grid の裏に隠れるため不採用）

// ===== 割当データ（読み取り専用 snapshot）構築 =====
async function resolveLevels(blindPresetId) {
  const api = window.api;
  if (!blindPresetId || !api?.presets) return [];
  // ユーザープリセット優先 → 同梱プリセット（main.js dual:state-sync-init の補完順と同じ）
  try {
    const user = await api.presets.loadUser(blindPresetId);
    if (user && Array.isArray(user.levels)) return user.levels;
  } catch (_) { /* fallthrough */ }
  try {
    const builtin = await api.presets.loadBuiltin(blindPresetId);
    if (builtin && Array.isArray(builtin.levels)) return builtin.levels;
  } catch (_) { /* fallthrough */ }
  return [];
}

async function buildSnapshot(t) {
  const levels = await resolveLevels(t.blindPresetId);
  // 背景がカスタム画像のときだけ画像を別取得（tournaments:list は image-free 設計のため）
  let backgroundImage = '';
  if (t.displaySettings?.background === 'image') {
    try {
      const images = await window.api.tournaments.getImages(t.id);
      backgroundImage = images?.backgroundImage || '';
    } catch (_) { /* 画像なしで続行（黒背景 fallback） */ }
  }
  return {
    id: t.id,
    title: t.name || 'ポーカートーナメント',
    subtitle: t.subtitle || '',
    currencySymbol: t.currencySymbol || '¥',
    gameType: t.gameType || 'nlh',
    customGameName: t.customGameName || '',
    titleColor: t.titleColor || '#FFFFFF',
    prizeCategory: t.prizeCategory || '',
    buyIn: t.buyIn || { chips: 0 },
    reentry: t.reentry || { chips: 0 },
    addOn: t.addOn || { chips: 0 },
    potAmounts: t.potAmounts || { buyIn: 0, reentry: 0, addOn: 0 },
    guarantee: t.guarantee || 0,
    payouts: Array.isArray(t.payouts) ? t.payouts.map((p) => ({ ...p })) : [],
    payoutRounding: t.payoutRounding,
    payoutMode: t.payoutMode || 'percent',
    specialStack: t.specialStack || { enabled: false },
    runtime: t.runtime || { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 },
    displaySettings: {
      background: t.displaySettings?.background || 'navy',
      timerFont: t.displaySettings?.timerFont || 'jetbrains',
      backgroundOverlay: t.displaySettings?.backgroundOverlay || 'mid'
    },
    backgroundImage,
    levels
  };
}

// ===== grid への publish（edge イベント駆動） =====
function publishPane(index) {
  const pane = panes[index];
  const payload = {
    kind: 'pane',
    value: {
      index,
      pane: {
        assigned: !!pane.snapshot,
        filler: pane.filler,
        snapshot: pane.snapshot,
        engine: pane.engine ? pane.engine.getRecord() : null
      }
    }
  };
  try { window.api?.multi?.publish?.(payload); } catch (_) { /* grid transition 中は無視 */ }
}

// ===== 区画操作（ボタン UI とキーボードで共用 = 真実源はこの window の engine/state） =====
// 開始タイミング select の値 → カウントダウン分数（'0'=今すぐ / 'custom'=カスタム入力 1〜180 分）
function resolveStartMinutes(pane) {
  const mode = pane.els.startMode.value;
  if (mode === 'custom') {
    const n = Number(pane.els.startCustomMin.value);
    return (Number.isFinite(n) && n >= 1) ? Math.min(180, Math.floor(n)) : 0;
  }
  const n = Number(mode);
  return Number.isFinite(n) ? n : 0;
}

// 即時スタート（Phase 1 と同じ・idle の現在レベルから）
function opStartImmediate(index) {
  const pane = panes[index];
  if (!pane || !pane.engine) return;
  pane.engine.start(Date.now());
  publishPane(index);
  refreshPaneStatus(pane);
}

// 開始タイミング設定に従ってスタート（0 分 = 即時 / それ以外 = スタートまでカウントダウン開始）
function opStartTimed(index) {
  const pane = panes[index];
  if (!pane || !pane.engine) return;
  const minutes = resolveStartMinutes(pane);
  pane.engine.startPreStart(minutes * 60 * 1000, Date.now());
  publishPane(index);
  refreshPaneStatus(pane);
}

// 一時停止 / 再開（PRE_START カウントダウン中も一時停止可 = 単一モード忠実）
function opTogglePause(index) {
  const pane = panes[index];
  if (!pane || !pane.engine) return;
  const now = Date.now();
  const st = pane.engine.computeNow(now).status;
  if (st === ENGINE_STATUS.RUNNING || st === ENGINE_STATUS.PRESTART) pane.engine.pause(now);
  else if (st === ENGINE_STATUS.PAUSED) pane.engine.resume(now);
  publishPane(index);
  refreshPaneStatus(pane);
}

function opLevel(index, delta) {
  const pane = panes[index];
  if (!pane || !pane.engine) return;
  pane.engine.advanceLevel(delta, Date.now());
  publishPane(index);
  refreshPaneStatus(pane);
}

// 確認なしの即リセット（確認は呼び出し側: ボタン=confirm / キーボード=R 2 度押し）
function opResetConfirmed(index) {
  const pane = panes[index];
  if (!pane || !pane.engine) return;
  pane.engine.reset();
  publishPane(index);
  refreshPaneStatus(pane);
}

// ===== 操作盤 UI =====
function buildPaneUI(index) {
  const root = document.createElement('section');
  root.className = 'mc-pane';
  root.dataset.assigned = 'false';
  root.innerHTML = `
    <div class="mc-pane__head">
      <span class="mc-pane__badge">区画 ${index + 1}</span>
      <select class="mc-pane__select js-select"><option value="">（空き区画）</option></select>
    </div>
    <div class="mc-pane__filler-row">
      <span>空き区画の表示:</span>
      <select class="js-filler">
        <option value="blank">無地（黒）</option>
        <option value="logo">ロゴ</option>
        <option value="image">任意画像</option>
        <option value="text">テキスト</option>
      </select>
      <button type="button" class="mc-btn mc-btn--small js-filler-image" hidden>画像を選択…</button>
      <input type="text" class="mc-pane__filler-text js-filler-text" maxlength="200" placeholder="表示するテキスト" hidden>
    </div>
    <div class="mc-pane__filler-path js-filler-path" hidden></div>
    <div class="mc-pane__prestart-row">
      <span>開始タイミング:</span>
      <select class="js-start-mode">
        <option value="0">今すぐ</option>
        <option value="5">5分後</option>
        <option value="15">15分後</option>
        <option value="30">30分後</option>
        <option value="60">60分後</option>
        <option value="custom">カスタム</option>
      </select>
      <span class="js-start-custom-wrap" hidden>
        <input type="number" class="mc-pane__custom-min js-start-custom-min" min="1" max="180" step="1" value="10"> 分後
      </span>
    </div>
    <div class="mc-pane__status">
      <span class="js-time">--:--</span>
      <span class="mc-pane__status-level js-level"></span>
      <span class="mc-pane__status-state js-state"></span>
    </div>
    <div class="mc-pane__buttons">
      <button type="button" class="mc-btn mc-btn--start js-start">スタート</button>
      <button type="button" class="mc-btn js-pause">一時停止</button>
      <button type="button" class="mc-btn js-prev">◀ レベル</button>
      <button type="button" class="mc-btn js-next">レベル ▶</button>
      <button type="button" class="mc-btn mc-btn--danger js-reset">リセット</button>
    </div>`;
  grid.appendChild(root);
  const q = (sel) => root.querySelector(sel);
  const pane = {
    root,
    els: {
      select: q('.js-select'), filler: q('.js-filler'),
      fillerImageBtn: q('.js-filler-image'), fillerText: q('.js-filler-text'), fillerPath: q('.js-filler-path'),
      startMode: q('.js-start-mode'), startCustomWrap: q('.js-start-custom-wrap'), startCustomMin: q('.js-start-custom-min'),
      time: q('.js-time'), level: q('.js-level'), state: q('.js-state'),
      start: q('.js-start'), pause: q('.js-pause'), prev: q('.js-prev'), next: q('.js-next'), reset: q('.js-reset')
    },
    tournamentId: null,
    filler: { kind: 'blank', imagePath: '', text: '' }, // Phase 2: セッション内 transient のみ（electron-store 非永続化）
    snapshot: null,
    engine: null,
    fillerTextTimerId: null
  };

  // フィラー種別に応じたサブ入力の表示切替（画像選択ボタン / テキスト入力 / 選択済みファイル名）
  function refreshFillerControls() {
    const kind = pane.filler.kind;
    pane.els.fillerImageBtn.hidden = kind !== 'image';
    pane.els.fillerText.hidden = kind !== 'text';
    const showPath = kind === 'image' && !!pane.filler.imagePath;
    pane.els.fillerPath.hidden = !showPath;
    if (showPath) {
      const base = String(pane.filler.imagePath).split(/[\\/]/).pop();
      pane.els.fillerPath.textContent = `選択中: ${base}`;
    }
  }

  pane.els.select.addEventListener('change', async () => {
    const id = pane.els.select.value;
    if (!id) {
      pane.tournamentId = null; pane.snapshot = null; pane.engine = null;
      root.dataset.assigned = 'false';
      publishPane(index);
      return;
    }
    const t = tournaments.find((x) => x.id === id);
    if (!t) return;
    pane.tournamentId = id;
    pane.snapshot = await buildSnapshot(t);
    pane.engine = createClockEngine(pane.snapshot.levels);
    root.dataset.assigned = 'true';
    publishPane(index);
    refreshPaneStatus(pane);
  });
  pane.els.filler.addEventListener('change', () => {
    const v = pane.els.filler.value;
    pane.filler = { ...pane.filler, kind: FILLER_KINDS.has(v) ? v : 'blank' };
    refreshFillerControls();
    publishPane(index);
  });
  pane.els.fillerImageBtn.addEventListener('click', async () => {
    // main 側のファイル選択ダイアログ（完全ローカル・パスは session 内 state にのみ保持）
    let result = null;
    try { result = await window.api?.multi?.pickFillerImage?.(); } catch (_) { /* キャンセル同等 */ }
    if (!result || typeof result.path !== 'string' || !result.path) return;
    pane.filler = { ...pane.filler, imagePath: result.path };
    refreshFillerControls();
    publishPane(index);
  });
  pane.els.fillerText.addEventListener('input', () => {
    // 打鍵ごとの IPC を避ける軽い debounce（300ms）。値は transient のみ
    if (pane.fillerTextTimerId) clearTimeout(pane.fillerTextTimerId);
    pane.fillerTextTimerId = setTimeout(() => {
      pane.fillerTextTimerId = null;
      pane.filler = { ...pane.filler, text: pane.els.fillerText.value };
      publishPane(index);
    }, 300);
  });
  pane.els.startMode.addEventListener('change', () => {
    pane.els.startCustomWrap.hidden = pane.els.startMode.value !== 'custom';
  });
  pane.els.start.addEventListener('click', () => opStartTimed(index));
  pane.els.pause.addEventListener('click', () => opTogglePause(index));
  pane.els.prev.addEventListener('click', () => opLevel(index, -1));
  pane.els.next.addEventListener('click', () => opLevel(index, 1));
  pane.els.reset.addEventListener('click', () => {
    if (!pane.engine) return;
    // 誤操作防止の確認（この区画だけがリセットされる = 他区画非影響）。
    // カウントダウン中は文言をカウントダウン中止に切替（単一モードの cancelPreStart 相当）
    const isPreStart = !!pane.engine.computeNow(Date.now()).preStart;
    const msg = isPreStart
      ? `区画 ${index + 1} のカウントダウンを中止してリセットしますか？（他の区画には影響しません）`
      : `区画 ${index + 1} のタイマーをリセットしますか？（他の区画には影響しません）`;
    if (!window.confirm(msg)) return;
    opResetConfirmed(index);
  });

  return pane;
}

// 操作盤のミニ状態表示（1 秒間隔で十分。表示文字列が変わった時のみ書込）
function refreshPaneStatus(pane) {
  if (!pane.engine || !pane.snapshot) return;
  const now = pane.engine.computeNow(Date.now());
  const levels = pane.snapshot.levels || [];
  const lv = levels[now.levelIndex];
  const isBreak = !!(lv && lv.isBreak);
  const isPreStart = !!now.preStart;
  const timeText = isPreStart ? formatPreStartClock(now.remainingMs).text : formatTime(now.remainingMs);
  if (pane.els.time.textContent !== timeText) pane.els.time.textContent = timeText;
  const levelText = isPreStart ? 'スタートまで' : (isBreak ? 'BREAK' : `Level ${lv ? lv.level : now.levelIndex + 1}`);
  if (pane.els.level.textContent !== levelText) pane.els.level.textContent = levelText;
  const stateKey = (now.status === ENGINE_STATUS.RUNNING && isBreak) ? 'break' : now.status;
  const stateText = STATE_LABEL[stateKey] || '';
  if (pane.els.state.textContent !== stateText) pane.els.state.textContent = stateText;
  const isRunning = now.status === ENGINE_STATUS.RUNNING;
  const isPaused = now.status === ENGINE_STATUS.PAUSED;
  const isPreStartRunning = now.status === ENGINE_STATUS.PRESTART;
  pane.els.start.disabled = now.status !== ENGINE_STATUS.IDLE; // PRE_START 中はスタート disable（単一モード忠実）
  pane.els.pause.disabled = !(isRunning || isPaused || isPreStartRunning);
  pane.els.pause.textContent = isPaused ? '再開' : '一時停止';
}

// ===== Phase 2: キーボード操作フォールバック（mirror = 複製運用の保険） =====
// 方式: この window（multi-control）の document keydown で受ける。
//   - grid は focusable:false のため、mirror で grid を前面に重ねても focus はこの window に残り
//     キーが届く（globalShortcut 不使用 = OS 全域・既存単一モードのショートカット地層に非接触）
//   - 操作はボタンと同じ op* 関数を呼ぶ（真実源 = この window の engine/state を経由して grid へ反映）
function publishUi() {
  const payload = {
    kind: 'ui',
    value: {
      activePane,
      helpVisible,
      resetArm: resetArm ? { index: resetArm.index } : null
    }
  };
  try { window.api?.multi?.publish?.(payload); } catch (_) { /* grid transition 中は無視 */ }
}

function clearResetArm(republish) {
  if (!resetArm) return;
  clearTimeout(resetArm.timerId);
  resetArm = null;
  if (republish) publishUi();
}

function armReset(index) {
  clearResetArm(false);
  const timerId = setTimeout(() => { resetArm = null; publishUi(); }, 3000);
  resetArm = { index, timerId };
  publishUi();
}

// 入力中保護と同思想のローカルガード: タイピング系フィールドへの入力中はショートカット無効
function isTypingTarget(t) {
  if (!t || typeof t.tagName !== 'string') return false;
  const tag = t.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable === true;
}

function handleKeydown(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (isTypingTarget(e.target)) {
    if (e.key === 'Escape' && typeof e.target.blur === 'function') e.target.blur();
    return;
  }
  const k = e.key;
  // 区画選択（1〜4）: 割当の有無に関わらず選択できる（選択状態は grid にハイライト表示）
  if (k >= '1' && k <= '4') {
    activePane = Number(k) - 1;
    clearResetArm(false);
    publishUi();
    e.preventDefault();
    return;
  }
  if (k === 'h' || k === 'H') {
    helpVisible = !helpVisible;
    publishUi();
    e.preventDefault();
    return;
  }
  if (k === 'g' || k === 'G') {
    try { window.api?.multi?.gridFront?.(); } catch (_) { /* ignore */ }
    e.preventDefault();
    return;
  }
  if (k === 'Escape') {
    try { window.api?.multi?.controlFront?.(); } catch (_) { /* ignore */ }
    return;
  }
  if (activePane === null) return;
  switch (k) {
    case 's': case 'S':
      clearResetArm(true);
      opStartImmediate(activePane);
      e.preventDefault();
      break;
    case 'c': case 'C':
      clearResetArm(true);
      opStartTimed(activePane);
      e.preventDefault();
      break;
    case ' ': case 'p': case 'P':
      clearResetArm(true);
      opTogglePause(activePane);
      e.preventDefault();
      break;
    case 'ArrowLeft':
      clearResetArm(true);
      opLevel(activePane, -1);
      e.preventDefault();
      break;
    case 'ArrowRight':
      clearResetArm(true);
      opLevel(activePane, 1);
      e.preventDefault();
      break;
    case 'r': case 'R':
      // リセットは 2 度押し確認（3 秒以内）。mirror 中の confirm は全画面 grid の裏に隠れるため不採用
      if (resetArm && resetArm.index === activePane) {
        clearResetArm(false);
        opResetConfirmed(activePane);
        publishUi();
      } else {
        armReset(activePane);
      }
      e.preventDefault();
      break;
    default:
      break;
  }
}

async function init() {
  try {
    tournaments = (await window.api.tournaments.list()) || [];
  } catch (_) {
    tournaments = [];
  }
  for (let i = 0; i < PANE_COUNT; i++) {
    const pane = buildPaneUI(i);
    for (const t of tournaments) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name || '(名称未設定)';
      pane.els.select.appendChild(opt);
    }
    panes.push(pane);
    publishPane(i); // 初期状態（空き区画 = 無地）を grid に通知
  }
  exitBtn.addEventListener('click', () => {
    try { window.api?.multi?.exit?.(); } catch (_) { /* main 側で window close される */ }
  });
  // Phase 2: mirror（複製）運用 = grid を前面へ（キー操作はこの window が focus を保持したまま受ける）
  gridFrontBtn?.addEventListener('click', () => {
    try { window.api?.multi?.gridFront?.(); } catch (_) { /* ignore */ }
  });
  document.addEventListener('keydown', handleKeydown);
  // 操作盤ミニ表示の更新（1 秒間隔。grid 側の描画とは独立で、IPC は発生しない）
  setInterval(() => { for (const pane of panes) refreshPaneStatus(pane); }, 1000);
}

init();
