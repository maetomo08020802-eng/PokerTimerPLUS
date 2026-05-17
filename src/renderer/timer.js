// タイマー本体
// timer-logic.md の規約:
//   - setInterval を使わず requestAnimationFrame + performance.now() で計算
//   - 終了予定時刻 (targetTime) を保持し、毎フレーム差分で残り秒数を算出
//   - 一時停止時は remainingMs を保存、再開時に targetTime を再計算
//   - DOM操作は本モジュールに含めない（イベント発火のみ）

import { States, getState, setState } from './state.js';
import { getLevel, getLevelCount, isBreakLevel } from './blinds.js';

// イベントハンドラ
// v2.1.6: PRE_START の hall 同期用に onPreStartStart / onPreStartCancel / onPreStartAdjust を追加。
//   timer.js は IPC API を直接持たないため、各 PRE_START 経路の edge を handler で notify し、
//   renderer.js 側で broadcast 呼出に橋渡しする（既存 handler パターン踏襲）。
const handlers = {
  onTick: () => {},
  onLevelChange: () => {},
  onLevelEnd: () => {},
  onPreStartTick: () => {},
  onPreStartEnd: () => {},
  onPreStartStart: () => {},   // v2.1.6: PRE_START 起動時 → payload {totalMs, remainingMs, startAtMs}
  onPreStartCancel: () => {},  // v2.1.6: cancelPreStart / reset 経由 → no payload
  onPreStartAdjust: () => {},  // v2.1.6: ±1 分操作で残り時間調整 → payload {remainingMs}
  onPreStartPause: () => {},   // v2.1.15 ① 根治: PRE_START 中の pause → payload {remainingMs}
  onPreStartResume: () => {},  // v2.1.15 ① 根治: PRE_START 中の resume → payload {remainingMs}
  onTournamentComplete: () => {}  // v2.1.18 ②: 最終レベル完走時 → no payload（renderer 側でオーバーレイ表示）
};

// 内部タイマー状態（DOM・state.js とは別、低レベル管理）
let targetTime = 0;        // 終了予定時刻 (ms, performance.now基準)
let pausedRemainingMs = 0; // 一時停止中に保持する残り時間
let rafId = null;          // requestAnimationFrame の戻り値
let isPreStart = false;    // PRE_START 中（PAUSED に遷移しても true を維持し、resume の分岐に使う）
let preStartTotalMs = 0;   // プレスタート選択値（renderer のフォーマット決定にも使われる）

// v2.2.2 hotfix Phase 2 第 1 段階: 観測ログ仕込み（rAF chain breakage + OS suspend 捕捉）
//   timer.js は renderer 側 ES module。window.api.log.write は preload 経由で
//   ipcRenderer.send('rolling-log:write', ...) を発火。優先ログラベルは main.js 側
//   PRIORITY_LOG_LABELS に登録済（priority-events.log への確実記録）。
//   v247 T10 制約（reset() 関数本体は window.api?.log?.write?. を呼ばない）遵守 →
//   reset() / cancelPreStart() 内ではログ発火せず、renderer.js 呼出側で caller log を発火。
//   Phase 3 真因確定後に削除予定（仮 hotfix 用観測機構）。
function _hotfixLog(label, data) {
  try {
    if (typeof window !== 'undefined' && window.api && window.api.log && typeof window.api.log.write === 'function') {
      window.api.log.write(label, data || null);
    }
  } catch (_) { /* never throw from logging */ }
}
// throttle 用 closure 変数群（5 秒間隔、PRE_START 開始 / 終了境界 2 秒は throttle 解除）
let _hotfixPrestartTickLastLogAt = 0;
let _hotfixPrestartLastRafAt = 0;
let _hotfixTickLastLogAt = 0;
let _hotfixTickLastRafAt = 0;
let _hotfixTickAfterPreStartFrameCount = 0;

// v2.2.2 hotfix Phase 2 第 1.5 段階 §8.B-2: setTimeout フォールバック
//   仮説 F（Windows OS レベルのプロセス suspension）が真因の場合、rAF chain が discard されて
//   preStartTick が止まる可能性がある。これを冪等に救出するため、startPreStart 時に
//   `targetTime + 1000ms` で setTimeout を仕掛け、rAF が先に 00:00 検出すれば cancel する設計。
//   - 通常時: preStartTick が先に 00:00 検出 → preStartTick 経路で startAtLevel(0) → fallback は no-op early return
//   - 異常時: rAF stuck → setTimeout 経由で fallback callback 発動 → 同等の遷移を実行
//   既存 startPreStart / cancelPreStart / pause / resume / preStartTick の本体ロジックは touch ゼロ、
//   並行で setTimeout 仕掛け / 解除を追加するのみ。Phase 3 真因確定後に維持 or 撤去判断。
let preStartFallbackTimerId = null;
function _preStartFallbackCallback() {
  preStartFallbackTimerId = null;
  // 早期 return ガード（既に preStartTick が 00:00 検出して startAtLevel(0) を完了している場合）
  if (!isPreStart) return;
  // pause 中（PAUSED 状態）は targetTime 不定のため no-op、resume で再仕掛け
  if (getState().status === States.PAUSED) return;
  // targetTime 未経過なら no-op（バッファ前、rAF が動いている）
  if (performance.now() < targetTime) return;
  // フォールバック発動（rAF chain breakage の決定的証拠ログ）
  _hotfixLog('prestart:fallback:fired', {
    perfNow: performance.now(),
    targetTime,
    overshootMs: performance.now() - targetTime
  });
  isPreStart = false;
  preStartTotalMs = 0;
  try { handlers.onPreStartEnd(); } catch (_) { /* never throw */ }
  try { handlers.onPreStartCancel(); } catch (_) { /* never throw */ }
  startAtLevel(0);
}

// イベントハンドラ登録
export function setHandlers({ onTick, onLevelChange, onLevelEnd, onPreStartTick, onPreStartEnd, onPreStartStart, onPreStartCancel, onPreStartAdjust, onPreStartPause, onPreStartResume, onTournamentComplete }) {
  if (onTick) handlers.onTick = onTick;
  if (onLevelChange) handlers.onLevelChange = onLevelChange;
  if (onLevelEnd) handlers.onLevelEnd = onLevelEnd;
  if (onPreStartTick) handlers.onPreStartTick = onPreStartTick;
  if (onPreStartEnd) handlers.onPreStartEnd = onPreStartEnd;
  // v2.1.6 新 handler 群（既存 handler との後方互換: undefined なら no-op のまま）
  if (onPreStartStart) handlers.onPreStartStart = onPreStartStart;
  if (onPreStartCancel) handlers.onPreStartCancel = onPreStartCancel;
  if (onPreStartAdjust) handlers.onPreStartAdjust = onPreStartAdjust;
  // v2.1.15 ① 根治: PRE_START 一時停止 / 再開を hall に通知するための新 handler
  if (onPreStartPause) handlers.onPreStartPause = onPreStartPause;
  if (onPreStartResume) handlers.onPreStartResume = onPreStartResume;
  // v2.1.18 ②: 最終レベル完走時のトーナメント終了演出用 handler
  if (onTournamentComplete) handlers.onTournamentComplete = onTournamentComplete;
}

// PRE_START 中かを問い合わせる（renderer の表示判定で使う）
export function isPreStartActive() {
  return isPreStart;
}

export function getPreStartTotalMs() {
  return preStartTotalMs;
}

// 指定インデックスのレベルにジャンプし、即時開始
export function startAtLevel(index) {
  // v2.2.2 hotfix Phase 2 第 1 段階 §A.2: startAtLevel 入口を観測
  _hotfixLog('timer:startAtLevel:enter', { levelIndex: index, status: getState().status, isPreStart, isBreak: (index >= 0 && index < getLevelCount()) ? isBreakLevel(index) : null });
  if (index < 0 || index >= getLevelCount()) {
    console.warn(`無効なレベルインデックス: ${index}`);
    return;
  }
  const level = getLevel(index);
  const totalMs = level.durationMinutes * 60 * 1000;
  targetTime = performance.now() + totalMs;
  pausedRemainingMs = 0;
  setState({
    currentLevelIndex: index,
    remainingMs: totalMs,
    totalMs,
    status: isBreakLevel(index) ? States.BREAK : States.RUNNING
  });
  // v2.2.2 hotfix: RUNNING / BREAK setState 後の状態を観測
  _hotfixLog('timer:startAtLevel:setState-running', { status: getState().status, remainingMs: totalMs, totalMs });
  handlers.onLevelChange(index);
  // v2.2.2 hotfix: startLoop 呼出直前を観測（rafId が null か確認）
  _hotfixLog('timer:startAtLevel:before-startLoop', { status: getState().status, rafId });
  startLoop();
}

// 一時停止
export function pause() {
  const { status } = getState();
  // PRE_START / RUNNING / BREAK のいずれからでも PAUSED へ
  if (status !== States.RUNNING && status !== States.BREAK && status !== States.PRE_START) return;
  pausedRemainingMs = Math.max(0, targetTime - performance.now());
  stopLoop();
  setState({ status: States.PAUSED, remainingMs: pausedRemainingMs });
  // v2.1.15 ① 根治: PRE_START 中の pause は hall に「一時停止中」状態を通知（カウントダウン固定表示）。
  //   onPreStartCancel ではなく専用 onPreStartPause を呼ぶ理由: cancel は「PRE_START 終了」、
  //   pause は「PRE_START 一時停止」で意味が異なる。hall 側は isPaused=true を受信して自前 rAF を停止 + remainingMs 固定表示。
  if (isPreStart) {
    // v2.2.2 hotfix Phase 2 第 1.5 段階: PRE_START 中の pause で setTimeout フォールバックを解除
    //   pause 中は targetTime 不定（pausedRemainingMs で保持）、resume 時に再仕掛け
    if (preStartFallbackTimerId !== null) {
      try { clearTimeout(preStartFallbackTimerId); } catch (_) {}
      preStartFallbackTimerId = null;
      _hotfixLog('prestart:fallback:cleared', { ctx: 'pause' });
    }
    try { handlers.onPreStartPause({ remainingMs: pausedRemainingMs }); } catch (_) { /* never throw */ }
  }
}

// 再開
export function resume() {
  if (getState().status !== States.PAUSED) return;
  targetTime = performance.now() + pausedRemainingMs;
  const resumedRemainingMs = pausedRemainingMs;
  pausedRemainingMs = 0;
  if (isPreStart) {
    setState({ status: States.PRE_START });
    startPreStartLoop();
    // v2.2.2 hotfix Phase 2 第 1.5 段階: PRE_START resume で setTimeout フォールバックを再仕掛け
    //   pause 時に解除されているため、新しい targetTime に対して再スケジュール
    const _fallbackDelayMs = Math.max(0, targetTime - performance.now()) + 1000;
    preStartFallbackTimerId = setTimeout(_preStartFallbackCallback, _fallbackDelayMs);
    _hotfixLog('prestart:fallback:scheduled', { delayMs: _fallbackDelayMs, targetTime });
    // v2.1.15 ① 根治: PRE_START 再開時に hall へ「一時停止解除（再開）」通知
    try { handlers.onPreStartResume({ remainingMs: resumedRemainingMs }); } catch (_) { /* never throw */ }
    return;
  }
  const { currentLevelIndex } = getState();
  setState({
    status: isBreakLevel(currentLevelIndex) ? States.BREAK : States.RUNNING
  });
  startLoop();
}

// リセット（IDLE状態でレベル0に戻す）
// v2.1.20-rc10: opts.force === false かつ PRE_START 中なら no-op で false 返却（構造的 PRE_START 保護）
// 後方互換: opts 省略時は force=true デフォルト、既存呼出は無変更で動作
// 返り値: true = reset 実行 / false = PRE_START 中ガードで no-op
export function reset(opts = {}) {
  const { force = true } = opts;
  if (!force && isPreStart) {
    return false;
  }
  stopLoop();
  pausedRemainingMs = 0;
  targetTime = 0;
  // v2.1.6: PRE_START 中の reset 経由 → hall に解除通知（cancelPreStart 経由は重複発火するが冪等）
  const wasPreStart = isPreStart;
  isPreStart = false;
  preStartTotalMs = 0;
  const firstLevel = getLevel(0);
  const totalMs = firstLevel ? firstLevel.durationMinutes * 60 * 1000 : 0;
  setState({
    status: States.IDLE,
    currentLevelIndex: 0,
    remainingMs: totalMs,
    totalMs
  });
  handlers.onLevelChange(0);
  // v2.1.6: hall 側 PRE_START 表示を解除（cancelPreStart からの場合は重複だが冪等で無害）
  if (wasPreStart) {
    try { handlers.onPreStartCancel(); } catch (_) {}
  }
  return true;
}

// IDLE状態からの初回スタート（レベル0から即時開始）
export function start() {
  startAtLevel(0);
}

// プレスタート（IDLE → PRE_START）。minutes <= 0 の場合は即時 startAtLevel(0) と等価
export function startPreStart(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) {
    start();
    return;
  }
  if (getState().status !== States.IDLE) return;   // 重複起動防止
  const totalMs = Math.floor(m * 60 * 1000);
  isPreStart = true;
  preStartTotalMs = totalMs;
  targetTime = performance.now() + totalMs;
  pausedRemainingMs = 0;
  setState({
    status: States.PRE_START,
    currentLevelIndex: 0,
    remainingMs: totalMs,
    totalMs
  });
  // Lv1 情報を事前表示できるよう onLevelChange も発火（renderer 側で BLINDS / NEXT を更新）
  handlers.onLevelChange(0);
  // v2.1.6: hall に PRE_START 起動を通知（renderer 側で broadcast 経由）
  try { handlers.onPreStartStart({ totalMs, remainingMs: totalMs, startAtMs: Date.now() + totalMs }); } catch (_) {}
  startPreStartLoop();
  // v2.2.2 hotfix Phase 2 第 1.5 段階 §8.B-2: setTimeout フォールバック仕掛け
  //   既存 rAF chain が discard されても目標時刻 + 1000ms バッファで強制発動する別ルート確保
  const _fallbackDelayMs = Math.max(0, targetTime - performance.now()) + 1000;
  preStartFallbackTimerId = setTimeout(_preStartFallbackCallback, _fallbackDelayMs);
  _hotfixLog('prestart:fallback:scheduled', { delayMs: _fallbackDelayMs, targetTime });
}

// v2.1.20-rc4: operator が dual-sync から PRE_START 状態を復元するための API。
//   既存 startPreStart(minutes) は新規開始用（onPreStartStart で broadcast）、本 API は中断状態からの復元用。
//   - payload: { remainingMs, totalMs, isPaused }
//   - 重複復元防止: 既に isPreStart === true なら no-op
//   - isPaused === true の場合は PAUSED 状態で復元、rAF は起動しない（resume() で再開）
//   - onPreStartStart ハンドラは呼ばない（受信側のため、broadcast loop を防ぐ）
//   - hall 側 applyHallPreStartState と並列の operator 用パスとして設計
export function restorePreStart(payload) {
  if (!payload || typeof payload !== 'object') return;
  const { remainingMs, totalMs, isPaused } = payload;
  if (typeof totalMs !== 'number' || totalMs <= 0) return;
  if (isPreStart) return;   // 重複復元防止（既に PRE_START 中なら no-op）
  const r = (typeof remainingMs === 'number' && remainingMs >= 0) ? Math.min(remainingMs, totalMs) : totalMs;
  isPreStart = true;
  preStartTotalMs = totalMs;
  if (isPaused) {
    // 一時停止状態で復元（pause() を呼ぶと onPreStartPause で broadcast loop になるため直接 setState）
    pausedRemainingMs = r;
    targetTime = 0;
    setState({
      status: States.PAUSED,
      currentLevelIndex: 0,
      remainingMs: r,
      totalMs
    });
  } else {
    // 通常進行状態で復元
    targetTime = performance.now() + r;
    pausedRemainingMs = 0;
    setState({
      status: States.PRE_START,
      currentLevelIndex: 0,
      remainingMs: r,
      totalMs
    });
    startPreStartLoop();
    // v2.2.2 hotfix Phase 2 第 1.5 段階: 復元後の PRE_START にも setTimeout フォールバックを仕掛け
    const _fallbackDelayMs = Math.max(0, targetTime - performance.now()) + 1000;
    preStartFallbackTimerId = setTimeout(_preStartFallbackCallback, _fallbackDelayMs);
    _hotfixLog('prestart:fallback:scheduled', { delayMs: _fallbackDelayMs, targetTime });
  }
  // Lv1 情報を再描画させるため onLevelChange のみ発火（onPreStartStart は broadcast loop の原因になるため呼ばない）
  handlers.onLevelChange(0);
}

// プレスタートを中断して IDLE に戻す（resetボタンと等価だが onPreStartEnd は鳴らさない）
export function cancelPreStart() {
  if (!isPreStart) return;
  // v2.2.2 hotfix Phase 2 第 1.5 段階: setTimeout フォールバックを解除
  if (preStartFallbackTimerId !== null) {
    try { clearTimeout(preStartFallbackTimerId); } catch (_) {}
    preStartFallbackTimerId = null;
    _hotfixLog('prestart:fallback:cleared', { ctx: 'cancel' });
  }
  // v2.1.6: hall 側に PRE_START キャンセルを通知（reset() 内で isPreStart=false にされる前に発火）
  try { handlers.onPreStartCancel(); } catch (_) {}
  reset();
}

// 残り時間を deltaMs だけ調整する（負: 時間進める / 正: 時間戻す）
// timer-logic.md「残り時間の手動調整」準拠:
//   - 進めて 0 以下になった場合: 次レベルへ繰り越す（超過分を引き継ぐ）。全レベル超過でトーナメント終了
//   - 戻してレベル初期時間を超える場合: 前レベルへ繰り越す（超過分を引き継ぐ）。最初のレベルでクランプ
//   - RUNNING / BREAK / PAUSED いずれの状態でも動作
//   - レベル繰越時は onLevelChange を発火（後続STEPの音響発火に必要）
export function advanceTimeBy(deltaMs) {
  const state = getState();
  const { status } = state;
  // PRE_START（または PRE_START から PAUSED）からも受け付ける
  if (status === States.PRE_START || (status === States.PAUSED && isPreStart)) {
    advancePreStartBy(deltaMs);
    return;
  }
  if (status !== States.RUNNING && status !== States.BREAK && status !== States.PAUSED) return;

  const isPaused = status === States.PAUSED;

  let levelIndex = state.currentLevelIndex;
  let levelMs = state.totalMs;
  const currentRemaining = isPaused
    ? pausedRemainingMs
    : Math.max(0, targetTime - performance.now());

  let newRemaining = currentRemaining + deltaMs;

  // ケース A: 進める方向（newRemaining ≤ 0）→ 次レベルへ繰り越す
  while (newRemaining <= 0) {
    if (levelIndex + 1 >= getLevelCount()) {
      // 全レベル超過: トーナメント終了状態
      stopLoop();
      pausedRemainingMs = 0;
      targetTime = 0;
      setState({
        status: States.IDLE,
        currentLevelIndex: getLevelCount() - 1,
        remainingMs: 0
      });
      return;
    }
    levelIndex += 1;
    const next = getLevel(levelIndex);
    levelMs = next.durationMinutes * 60 * 1000;
    newRemaining += levelMs;
  }

  // ケース B: 戻す方向（newRemaining > levelMs）→ 前レベルへ繰り越す
  while (newRemaining > levelMs) {
    if (levelIndex === 0) {
      newRemaining = levelMs;
      break;
    }
    const overflow = newRemaining - levelMs;
    levelIndex -= 1;
    const prev = getLevel(levelIndex);
    levelMs = prev.durationMinutes * 60 * 1000;
    newRemaining = overflow;
  }

  // 状態適用
  const levelChanged = levelIndex !== state.currentLevelIndex;
  if (isPaused) {
    pausedRemainingMs = newRemaining;
    setState({
      status: States.PAUSED,
      currentLevelIndex: levelIndex,
      remainingMs: newRemaining,
      totalMs: levelMs
    });
  } else {
    targetTime = performance.now() + newRemaining;
    pausedRemainingMs = 0;
    setState({
      status: isBreakLevel(levelIndex) ? States.BREAK : States.RUNNING,
      currentLevelIndex: levelIndex,
      remainingMs: newRemaining,
      totalMs: levelMs
    });
    if (levelChanged) {
      stopLoop();
      startLoop();
    }
  }
  if (levelChanged) {
    handlers.onLevelChange(levelIndex);
  }
}

// STEP 6.21.3: 「30秒進める」: 残り時間を 30 秒減らす（時間が進む）
// 旧 advance1Minute（60秒単位）から 30秒単位に変更
export function advance30Seconds() {
  advanceTimeBy(-30 * 1000);
}

// STEP 6.21.3: 「30秒戻す」: 残り時間を 30 秒増やす（時間が戻る）
export function rewind30Seconds() {
  advanceTimeBy(30 * 1000);
}

// PRE_START 中の ±1 分（PAUSED 中も対応）
function advancePreStartBy(deltaMs) {
  const { status } = getState();
  const paused = status === States.PAUSED;
  const cur = paused ? pausedRemainingMs : Math.max(0, targetTime - performance.now());
  const newRem = Math.max(0, cur + deltaMs);

  // 0 になったら PRE_START を終えて即時 RUNNING へ
  if (newRem <= 0 && !paused) {
    isPreStart = false;
    preStartTotalMs = 0;
    stopLoop();
    handlers.onPreStartEnd();
    // v2.1.6: PRE_START → RUNNING 自動遷移時は hall 側 PRE_START 表示を解除（onPreStartEnd の延長線）
    try { handlers.onPreStartCancel(); } catch (_) {}
    startAtLevel(0);
    return;
  }

  if (paused) {
    pausedRemainingMs = newRem;
    setState({ remainingMs: newRem });
  } else {
    targetTime = performance.now() + newRem;
    setState({ remainingMs: newRem });
  }
  // v2.1.6: ±1 分操作後の残り時間を hall に通知（edge イベント、間引きなし）
  try { handlers.onPreStartAdjust({ remainingMs: newRem }); } catch (_) {}
}

// rAFループ開始
function startLoop() {
  // v2.2.2 hotfix Phase 2 第 1 段階 §A.2: startLoop 入口 + rafId 設定を観測
  _hotfixLog('timer:startLoop:enter', { rafId, status: getState().status });
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
  _hotfixLog('timer:startLoop:rafId-set', { rafId, perfNow: performance.now() });
}

// PRE_START 用 rAF ループ（status が PRE_START 以外になれば自然停止）
function startPreStartLoop() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(preStartTick);
}

function preStartTick() {
  rafId = null;
  if (getState().status !== States.PRE_START) return;
  const _hotfixPerfNow = performance.now();
  const remainingMs = targetTime - _hotfixPerfNow;
  // v2.2.2 hotfix §A.3: rAF gap 計測（前回 callback からの経過時間、100ms 超過 = OS suspend 復帰の決定的証拠）
  if (_hotfixPrestartLastRafAt > 0) {
    const _gapMs = _hotfixPerfNow - _hotfixPrestartLastRafAt;
    if (_gapMs >= 100) {
      _hotfixLog('prestart:tick:raf-gap', { gapMs: _gapMs, perfNow: _hotfixPerfNow, targetTime, remainingMs });
    }
  }
  _hotfixPrestartLastRafAt = _hotfixPerfNow;
  // v2.2.2 hotfix §A.1: prestart:tick ラベル発火（5s throttle、開始/終了境界 2s は throttle 解除）
  const _hotfixThrottleElapsed = _hotfixPerfNow - _hotfixPrestartTickLastLogAt;
  const _hotfixForceUnthrottled = (remainingMs <= 2000) ||
    (preStartTotalMs > 0 && remainingMs >= preStartTotalMs - 2000);
  if (_hotfixThrottleElapsed >= 5000 || _hotfixForceUnthrottled) {
    _hotfixPrestartTickLastLogAt = _hotfixPerfNow;
    _hotfixLog('prestart:tick', { remainingMs, perfNow: _hotfixPerfNow, targetTime, status: getState().status });
  }
  if (remainingMs <= 0) {
    // v2.2.2 hotfix §A.1: 00:00 遷移の各段を確実に観測（throttle 対象外、必ず発火）
    _hotfixLog('prestart:tick:zero-detected', { remainingMs, perfNow: _hotfixPerfNow, targetTime, overshootMs: -remainingMs });
    // v2.2.2 hotfix Phase 2 第 1.5 段階: rAF が先に 0:00 検出 → setTimeout フォールバックを解除
    //   通常時はこの経路で fallback が解除される（fallback callback は no-op early return で安全）
    if (preStartFallbackTimerId !== null) {
      try { clearTimeout(preStartFallbackTimerId); } catch (_) {}
      preStartFallbackTimerId = null;
      _hotfixLog('prestart:fallback:cleared', { ctx: 'tick-zero' });
    }
    isPreStart = false;
    preStartTotalMs = 0;
    _hotfixLog('prestart:tick:after-isPreStart-false', { status: getState().status });
    handlers.onPreStartEnd();
    _hotfixLog('prestart:tick:after-onPreStartEnd', { status: getState().status });
    // v2.1.6: PRE_START → RUNNING 自動遷移時に hall 側 PRE_START 表示を解除
    try { handlers.onPreStartCancel(); } catch (_) {}
    _hotfixLog('prestart:tick:after-onPreStartCancel', { status: getState().status });
    // RUNNING へ自動遷移（startAtLevel は内部で setState + startLoop を行う）
    _hotfixLog('prestart:tick:before-startAtLevel', { status: getState().status });
    startAtLevel(0);
    _hotfixLog('prestart:tick:after-startAtLevel', { status: getState().status, rafId, remainingMs: getState().remainingMs });
    // 遷移後最初の 10 frame は throttle 解除（rAF chain 動作確認の決定的証拠）
    _hotfixTickAfterPreStartFrameCount = 10;
    _hotfixTickLastRafAt = 0;  // tick 側 rAF gap 計測リセット
    return;
  }
  setState({ remainingMs });
  handlers.onPreStartTick(remainingMs);
  rafId = requestAnimationFrame(preStartTick);
}

// rAFループ停止
function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// 毎フレーム呼ばれる処理
function tick() {
  rafId = null;
  const { status, currentLevelIndex } = getState();
  if (status !== States.RUNNING && status !== States.BREAK) return;

  const _hotfixPerfNow = performance.now();
  const remainingMs = targetTime - _hotfixPerfNow;
  // v2.2.2 hotfix Phase 2 第 1 段階 §A.2 / §A.3: tick:enter + rAF gap 計測
  //   - PRE_START → RUNNING 遷移直後の最初の 10 frame は throttle 解除（rAF chain 動作確認）
  //   - 通常時は 5s throttle
  //   - rAF gap 100ms 超過は OS suspend 復帰の決定的証拠
  if (_hotfixTickLastRafAt > 0) {
    const _gapMs = _hotfixPerfNow - _hotfixTickLastRafAt;
    if (_gapMs >= 100) {
      _hotfixLog('timer:tick:raf-gap', { gapMs: _gapMs, perfNow: _hotfixPerfNow, status, remainingMs });
    }
  }
  _hotfixTickLastRafAt = _hotfixPerfNow;
  const _hotfixThrottleElapsed = _hotfixPerfNow - _hotfixTickLastLogAt;
  if (_hotfixTickAfterPreStartFrameCount > 0 || _hotfixThrottleElapsed >= 5000) {
    _hotfixTickLastLogAt = _hotfixPerfNow;
    _hotfixLog('timer:tick:enter', { remainingMs, perfNow: _hotfixPerfNow, status, postPreStartFrame: _hotfixTickAfterPreStartFrameCount });
    if (_hotfixTickAfterPreStartFrameCount > 0) _hotfixTickAfterPreStartFrameCount--;
  }

  if (remainingMs <= 0) {
    _hotfixLog('timer:tick:zero-detected', { remainingMs, perfNow: _hotfixPerfNow, status });
    handlers.onLevelEnd(currentLevelIndex);
    advanceToNextLevel();
    return;
  }

  setState({ remainingMs });
  handlers.onTick(remainingMs);
  rafId = requestAnimationFrame(tick);
}

// 自動的に次レベルへ進行（レベル終了時の内部処理）
function advanceToNextLevel() {
  const { currentLevelIndex } = getState();
  const target = currentLevelIndex + 1;
  if (target >= getLevelCount()) {
    setState({ status: States.IDLE, remainingMs: 0 });
    // v2.1.18 ②: 最終レベル完走 → renderer 側でオーバーレイ表示用に通知（IDLE 移行直後）
    try { handlers.onTournamentComplete(); } catch (_) { /* never throw */ }
    return;
  }
  startAtLevel(target);
}
