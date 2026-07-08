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

import { createClockEngine, computePaneNow, formatPreStartClock, applyRuntimeOp, ENGINE_STATUS } from './multi-engine.mjs';

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
const kbTargetEl = document.getElementById('js-mc-kb-target');
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
        engine: pane.engine ? pane.engine.getRecord() : null,
        // Phase 2e: リセット=割当値復帰の復帰先もセッション復帰で失わないよう payload に含める
        //（grid は未使用フィールドとして無害・main のセッションファイル経由で復元される）
        assignRuntime: pane.assignRuntime || null
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

// 開始タイミング設定に従ってスタート（0 分 = 即時 / それ以外 = スタートまでカウントダウン開始）。
// Phase 2d: 開始経路はこれ（ボタン / Space / C）に一本化。旧 S キーの即時スタートは
// 単一モードの S=設定との混同・誤操作源のため廃止（brief default C）
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

// Phase 2c: ±30 秒の時間微調整（単一モードの「30秒進める」= −30s /「30秒戻す」= +30s）。
// カウントダウン中は開始までの残りに作用（0 到達で自動 running）。idle/finished はエンジン側 no-op
function opAdjust30(index, deltaMs) {
  const pane = panes[index];
  if (!pane || !pane.engine) return;
  pane.engine.adjustTimeBy(deltaMs, Date.now());
  publishPane(index);
  refreshPaneStatus(pane);
}

// 確認なしの即リセット（確認は呼び出し側: ボタン=confirm / キーボード=R 2 度押し）。
// Phase 2d（brief default D）: タイマーに加え、セッション内 runtime を「割当時点の snapshot 値」へ
// 復帰させる（単一モードの 0 クリアではなく割当値復帰＝マルチ本番での誤爆損害を回避する安全側 default）
function opResetConfirmed(index) {
  const pane = panes[index];
  if (!pane || !pane.engine) return;
  pane.engine.reset();
  if (pane.snapshot && pane.assignRuntime) {
    pane.snapshot = {
      ...pane.snapshot,
      runtime: { ...pane.assignRuntime.runtime },
      specialStack: { ...pane.snapshot.specialStack, appliedCount: pane.assignRuntime.specialApplied }
    };
  }
  publishPane(index);
  refreshPaneStatus(pane);
}

// Phase 2d: runtime 操作（単一モード操作パリティ・transient）。
// applyRuntimeOp（純粋計算）で新 snapshot を作り、publishPane の既存経路で grid が
// PLAYERS / AVG STACK / PRIZE POOL / 特別配布行を再計算する（store には一切書かない）
function runtimeOp(index, op) {
  const pane = panes[index];
  if (!pane || !pane.snapshot) return;
  const next = applyRuntimeOp(pane.snapshot, op);
  if (!next) return; // クランプ・ガードで変更なし（単一モードの無音ガードと同じ）
  pane.snapshot = next;
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
      <button type="button" class="mc-btn js-back30">30秒戻す</button>
      <button type="button" class="mc-btn js-fwd30">30秒進める</button>
      <button type="button" class="mc-btn mc-btn--danger js-reset">リセット</button>
    </div>
    <div class="mc-pane__rt-status js-rt-status"></div>
    <div class="mc-pane__runtime-row">
      <button type="button" class="mc-btn mc-btn--small js-rt-entry-add">エントリー＋</button>
      <button type="button" class="mc-btn mc-btn--small js-rt-entry-cancel">取消</button>
      <button type="button" class="mc-btn mc-btn--small js-rt-eliminate">脱落</button>
      <button type="button" class="mc-btn mc-btn--small js-rt-revive">復活</button>
      <button type="button" class="mc-btn mc-btn--small js-rt-re-plus">RE＋</button>
      <button type="button" class="mc-btn mc-btn--small js-rt-re-minus">RE−</button>
      <button type="button" class="mc-btn mc-btn--small js-rt-ad-plus">AD＋</button>
      <button type="button" class="mc-btn mc-btn--small js-rt-ad-minus">AD−</button>
      <button type="button" class="mc-btn mc-btn--small js-rt-sp-plus" hidden>特＋</button>
      <button type="button" class="mc-btn mc-btn--small js-rt-sp-minus" hidden>特−</button>
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
      start: q('.js-start'), pause: q('.js-pause'), prev: q('.js-prev'), next: q('.js-next'),
      back30: q('.js-back30'), fwd30: q('.js-fwd30'), reset: q('.js-reset'),
      rtStatus: q('.js-rt-status'),
      rtSpPlus: q('.js-rt-sp-plus'), rtSpMinus: q('.js-rt-sp-minus')
    },
    tournamentId: null,
    filler: { kind: 'blank', imagePath: '', text: '' }, // Phase 2: セッション内 transient のみ（electron-store 非永続化）
    snapshot: null,
    engine: null,
    assignRuntime: null, // Phase 2d: 割当時点の runtime 複製（リセット時の復帰先・transient）
    fillerTextTimerId: null
  };

  // Phase 2d: runtime 操作ボタン（キーボードと同じ runtimeOp 経由 = 真実源は control の state）
  const RT_BUTTONS = [
    ['.js-rt-entry-add', 'addEntry'], ['.js-rt-entry-cancel', 'cancelEntry'],
    ['.js-rt-eliminate', 'eliminate'], ['.js-rt-revive', 'revive'],
    ['.js-rt-re-plus', 'reentryPlus'], ['.js-rt-re-minus', 'reentryMinus'],
    ['.js-rt-ad-plus', 'addOnPlus'], ['.js-rt-ad-minus', 'addOnMinus'],
    ['.js-rt-sp-plus', 'specialPlus'], ['.js-rt-sp-minus', 'specialMinus']
  ];
  for (const [sel, op] of RT_BUTTONS) {
    q(sel).addEventListener('click', () => runtimeOp(index, op));
  }

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
      pane.tournamentId = null; pane.snapshot = null; pane.engine = null; pane.assignRuntime = null;
      root.dataset.assigned = 'false';
      publishPane(index);
      refreshKbTarget(); // 選択中区画の割当解除に操作対象表示を追従
      return;
    }
    const t = tournaments.find((x) => x.id === id);
    if (!t) return;
    pane.tournamentId = id;
    pane.snapshot = await buildSnapshot(t);
    pane.engine = createClockEngine(pane.snapshot.levels);
    // Phase 2d: 割当時点の runtime を複製保持（リセット時の復帰先）+ 特殊スタックボタンの表示切替
    pane.assignRuntime = {
      runtime: { ...pane.snapshot.runtime },
      specialApplied: Number(pane.snapshot.specialStack?.appliedCount) || 0
    };
    const spEnabled = !!pane.snapshot.specialStack?.enabled;
    pane.els.rtSpPlus.hidden = !spEnabled;
    pane.els.rtSpMinus.hidden = !spEnabled;
    root.dataset.assigned = 'true';
    publishPane(index);
    refreshPaneStatus(pane);
    refreshKbTarget(); // 選択中区画の割当変更にトーナメント名表示を追従
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
  pane.els.back30.addEventListener('click', () => opAdjust30(index, 30 * 1000));
  pane.els.fwd30.addEventListener('click', () => opAdjust30(index, -30 * 1000));
  pane.refreshFillerControls = refreshFillerControls; // Phase 2e: セッション復帰時の UI 同期用に公開

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
  // Phase 2c: ±30 秒は進行中系のみ有効（idle / finished はエンジン no-op = 単一モード忠実）
  const adjustable = isRunning || isPaused || isPreStartRunning;
  pane.els.back30.disabled = !adjustable;
  pane.els.fwd30.disabled = !adjustable;
  // Phase 2d: runtime 現在値（操作の効きが手元で見える・変化時のみ書込）
  const rt = pane.snapshot.runtime || {};
  const ss = pane.snapshot.specialStack || {};
  let rtText = `PLAYERS ${rt.playersRemaining || 0}/${rt.playersInitial || 0} ・ RE ${rt.reentryCount || 0} ・ AD ${rt.addOnCount || 0}`;
  if (ss.enabled) rtText += ` ・ 特 ${Number(ss.appliedCount) || 0}`;
  if (pane.els.rtStatus.textContent !== rtText) pane.els.rtStatus.textContent = rtText;
}

// ===== Phase 2: キーボード操作フォールバック（mirror = 複製運用の保険） =====
// 方式: この window（multi-control）の document keydown で受ける。
//   - grid は focusable:false のため、mirror で grid を前面に重ねても focus はこの window に残り
//     キーが届く（globalShortcut 不使用 = OS 全域・既存単一モードのショートカット地層に非接触）
//   - 操作はボタンと同じ op* 関数を呼ぶ（真実源 = この window の engine/state を経由して grid へ反映）
// Phase 2b: 操作盤側の「キーボード操作対象」表示（ヘッダの対象名 + 該当区画カードのハイライト）。
// grid のバッジと同じ内部 state（activePane / snapshot.title）から描くだけ＝新 IPC 不要・選択同期
function refreshKbTarget() {
  let text;
  if (activePane === null) {
    text = 'キーボード操作対象: 未選択（1〜4 キーで選択）';
  } else {
    const pane = panes[activePane];
    const title = (pane && pane.snapshot) ? (pane.snapshot.title || 'ポーカートーナメント') : '';
    text = `キーボード操作対象: 区画 ${activePane + 1}〔${title || '未割当'}〕`;
  }
  if (kbTargetEl && kbTargetEl.textContent !== text) kbTargetEl.textContent = text;
  panes.forEach((pane, i) => {
    const on = i === activePane;
    if ((pane.root.dataset.kbActive === 'true') !== on) pane.root.dataset.kbActive = on ? 'true' : 'false';
  });
}

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
  refreshKbTarget(); // 選択変化はすべて publishUi 経由 → 操作盤側の対象表示も同時に同期
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

// Phase 2d: キー割当を単一モードに整合（renderer.js dispatchClockShortcut と同じ操作は同じキー）。
//   ←→=±30秒 / ↑↓=エントリー・脱落（Shift で取消・復活）/ Ctrl+R/A/E=リエントリー・アドオン・特殊スタック。
//   Phase 2c の「↑↓=±30秒」誤割当を撤回。レベル送り戻しは Shift+←→ へ移設（単一モードに該当キーなし）。
//   S=即時スタートは廃止（単一モードの S=設定との混同・誤操作源）。開始は Space / C に集約。
function handleKeydown(e) {
  if (e.altKey || e.metaKey) return;
  if (isTypingTarget(e.target)) {
    if (e.key === 'Escape' && typeof e.target.blur === 'function') e.target.blur();
    return;
  }
  // Ctrl 系 = 単一モードと同じ runtime 操作（e.code 判定 = dispatchClockShortcut と同方式・配列非依存。
  //   アプリは Menu.setApplicationMenu(null) のため Ctrl+R のリロード既定は存在しないが preventDefault も掛ける）
  if (e.ctrlKey) {
    if (activePane === null) return;
    if (e.code === 'KeyR') {
      clearResetArm(true);
      runtimeOp(activePane, e.shiftKey ? 'reentryMinus' : 'reentryPlus');
      e.preventDefault();
    } else if (e.code === 'KeyA') {
      clearResetArm(true);
      runtimeOp(activePane, e.shiftKey ? 'addOnMinus' : 'addOnPlus');
      e.preventDefault();
    } else if (e.code === 'KeyE') {
      clearResetArm(true);
      runtimeOp(activePane, e.shiftKey ? 'specialMinus' : 'specialPlus');
      e.preventDefault();
    }
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
    case 'c': case 'C':
      clearResetArm(true);
      opStartTimed(activePane);
      e.preventDefault();
      break;
    case ' ': {
      // Space = 単一モード忠実のトグル（IDLE→開始タイミング設定に従い開始 / 進行中→一時停止 / PAUSED→再開）
      clearResetArm(true);
      const pane = panes[activePane];
      const st = (pane && pane.engine) ? pane.engine.computeNow(Date.now()).status : null;
      if (st === ENGINE_STATUS.IDLE) opStartTimed(activePane);
      else opTogglePause(activePane);
      e.preventDefault();
      break;
    }
    case 'ArrowLeft': // ←=30秒戻す（単一と同一）/ Shift+←=レベル戻し（multi 固有・移設先）
      clearResetArm(true);
      if (e.shiftKey) opLevel(activePane, -1);
      else opAdjust30(activePane, 30 * 1000);
      e.preventDefault();
      break;
    case 'ArrowRight': // →=30秒進める / Shift+→=レベル送り
      clearResetArm(true);
      if (e.shiftKey) opLevel(activePane, 1);
      else opAdjust30(activePane, -30 * 1000);
      e.preventDefault();
      break;
    case 'ArrowUp': // ↑=新規エントリー追加 / Shift+↑=取消（単一と同一）
      clearResetArm(true);
      runtimeOp(activePane, e.shiftKey ? 'cancelEntry' : 'addEntry');
      e.preventDefault();
      break;
    case 'ArrowDown': // ↓=プレイヤー脱落 / Shift+↓=復活（単一と同一）
      clearResetArm(true);
      runtimeOp(activePane, e.shiftKey ? 'revive' : 'eliminate');
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

// Phase 2e: 停電・クラッシュ復帰。main が復元 prime 済なら、初期 state（既存 fetchInitialState
// = multi:state-sync-init の流用・新 IPC なし）から各区画の割当・engine・フィラーを再構築する。
// engine record は main 側で「書出し時点の一時停止」へ変換済（toPowerLossPausedRecord）。
async function restorePanesFromInit() {
  let init = null;
  try { init = await window.api?.multi?.fetchInitialState?.(); } catch (_) { return; }
  const initPanes = Array.isArray(init?.panes) ? init.panes : [];
  initPanes.forEach((p, i) => {
    const pane = panes[i];
    if (!pane || !p || typeof p !== 'object') return;
    // フィラー設定の復元（未割当区画にも適用）+ 入力 UI の同期
    if (p.filler && typeof p.filler === 'object') {
      pane.filler = {
        kind: FILLER_KINDS.has(p.filler.kind) ? p.filler.kind : 'blank',
        imagePath: typeof p.filler.imagePath === 'string' ? p.filler.imagePath : '',
        text: typeof p.filler.text === 'string' ? p.filler.text : ''
      };
      pane.els.filler.value = pane.filler.kind;
      pane.els.fillerText.value = pane.filler.text;
      pane.refreshFillerControls();
    }
    if (!p.assigned || !p.snapshot) return;
    pane.snapshot = p.snapshot;
    pane.tournamentId = p.snapshot.id || null;
    pane.engine = createClockEngine(p.snapshot.levels || [], p.engine || null);
    pane.assignRuntime = (p.assignRuntime && typeof p.assignRuntime === 'object') ? p.assignRuntime : {
      runtime: { ...(p.snapshot.runtime || {}) },
      specialApplied: Number(p.snapshot.specialStack?.appliedCount) || 0
    };
    // 割当プルダウンの復元。元トーナメントが削除済みなら「（復元）」option を追補して選択状態を再現
    if (pane.tournamentId) {
      pane.els.select.value = pane.tournamentId;
      if (pane.els.select.value !== pane.tournamentId) {
        const opt = document.createElement('option');
        opt.value = pane.tournamentId;
        opt.textContent = `${p.snapshot.title || '(名称未設定)'}（復元）`;
        pane.els.select.appendChild(opt);
        pane.els.select.value = pane.tournamentId;
      }
    }
    const spEnabled = !!p.snapshot.specialStack?.enabled;
    pane.els.rtSpPlus.hidden = !spEnabled;
    pane.els.rtSpMinus.hidden = !spEnabled;
    pane.root.dataset.assigned = 'true';
    refreshPaneStatus(pane);
  });
  // キーボード UI 状態（選択区画・ヘルプ表示）の復元 → grid へも再同期
  if (init?.ui && typeof init.ui === 'object') {
    const a = init.ui.activePane;
    activePane = (Number.isInteger(a) && a >= 0 && a < PANE_COUNT) ? a : null;
    helpVisible = !!init.ui.helpVisible;
    publishUi();
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
  }
  // Phase 2e: 復元（あれば）→ その後に現状態を publish（復元なしなら従来どおり空き区画を通知。
  //   Phase 1 の「buildPaneUI 直後に publish」は復元 prime を空 pane で上書きするため、fetch 後に移動）
  await restorePanesFromInit();
  for (let i = 0; i < PANE_COUNT; i++) publishPane(i);
  exitBtn.addEventListener('click', () => {
    try { window.api?.multi?.exit?.(); } catch (_) { /* main 側で window close される */ }
  });
  // Phase 2: mirror（複製）運用 = grid を前面へ（キー操作はこの window が focus を保持したまま受ける）
  gridFrontBtn?.addEventListener('click', () => {
    try { window.api?.multi?.gridFront?.(); } catch (_) { /* ignore */ }
  });
  document.addEventListener('keydown', handleKeydown);
  refreshKbTarget(); // 初期表示「未選択（1〜4 キーで選択）」
  // 操作盤ミニ表示の更新（1 秒間隔。grid 側の描画とは独立で、IPC は発生しない）
  setInterval(() => { for (const pane of panes) refreshPaneStatus(pane); }, 1000);
}

init();
