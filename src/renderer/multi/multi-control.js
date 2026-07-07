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

import { createClockEngine, computePaneNow, ENGINE_STATUS } from './multi-engine.mjs';

const PANE_COUNT = 4;
const STATE_LABEL = Object.freeze({
  idle: '停止中', running: '進行中', paused: '一時停止中', finished: '終了', break: 'ブレイク中'
});

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
let tournaments = []; // tournaments:list の読み取り専用コピー
const panes = [];     // { root, els, tournamentId, filler, snapshot, engine }

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
      </select>
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
      time: q('.js-time'), level: q('.js-level'), state: q('.js-state'),
      start: q('.js-start'), pause: q('.js-pause'), prev: q('.js-prev'), next: q('.js-next'), reset: q('.js-reset')
    },
    tournamentId: null,
    filler: 'blank',
    snapshot: null,
    engine: null
  };

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
    pane.filler = pane.els.filler.value === 'logo' ? 'logo' : 'blank';
    publishPane(index);
  });
  pane.els.start.addEventListener('click', () => {
    if (!pane.engine) return;
    pane.engine.start(Date.now());
    publishPane(index);
  });
  pane.els.pause.addEventListener('click', () => {
    if (!pane.engine) return;
    const now = Date.now();
    const st = pane.engine.computeNow(now).status;
    if (st === ENGINE_STATUS.RUNNING) pane.engine.pause(now);
    else if (st === ENGINE_STATUS.PAUSED) pane.engine.resume(now);
    publishPane(index);
  });
  pane.els.prev.addEventListener('click', () => {
    if (!pane.engine) return;
    pane.engine.advanceLevel(-1, Date.now());
    publishPane(index);
  });
  pane.els.next.addEventListener('click', () => {
    if (!pane.engine) return;
    pane.engine.advanceLevel(1, Date.now());
    publishPane(index);
  });
  pane.els.reset.addEventListener('click', () => {
    if (!pane.engine) return;
    // 誤操作防止の確認（この区画だけがリセットされる = 他区画非影響）
    if (!window.confirm(`区画 ${index + 1} のタイマーをリセットしますか？（他の区画には影響しません）`)) return;
    pane.engine.reset();
    publishPane(index);
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
  const timeText = formatTime(now.remainingMs);
  if (pane.els.time.textContent !== timeText) pane.els.time.textContent = timeText;
  const levelText = isBreak ? 'BREAK' : `Level ${lv ? lv.level : now.levelIndex + 1}`;
  if (pane.els.level.textContent !== levelText) pane.els.level.textContent = levelText;
  const stateText = STATE_LABEL[(now.status === ENGINE_STATUS.RUNNING && isBreak) ? 'break' : now.status] || '';
  if (pane.els.state.textContent !== stateText) pane.els.state.textContent = stateText;
  const isRunning = now.status === ENGINE_STATUS.RUNNING;
  const isPaused = now.status === ENGINE_STATUS.PAUSED;
  pane.els.start.disabled = now.status !== ENGINE_STATUS.IDLE;
  pane.els.pause.disabled = !(isRunning || isPaused);
  pane.els.pause.textContent = isPaused ? '再開' : '一時停止';
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
  // 操作盤ミニ表示の更新（1 秒間隔。grid 側の描画とは独立で、IPC は発生しない）
  setInterval(() => { for (const pane of panes) refreshPaneStatus(pane); }, 1000);
}

init();
