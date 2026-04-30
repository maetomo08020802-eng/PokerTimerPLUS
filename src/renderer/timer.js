// タイマー本体
// timer-logic.md の規約:
//   - setInterval を使わず requestAnimationFrame + performance.now() で計算
//   - 終了予定時刻 (targetTime) を保持し、毎フレーム差分で残り秒数を算出
//   - 一時停止時は remainingMs を保存、再開時に targetTime を再計算
//   - DOM操作は本モジュールに含めない（イベント発火のみ）

import { States, getState, setState } from './state.js';
import { getLevel, getLevelCount, isBreakLevel } from './blinds.js';

// イベントハンドラ
const handlers = {
  onTick: () => {},
  onLevelChange: () => {},
  onLevelEnd: () => {},
  onPreStartTick: () => {},
  onPreStartEnd: () => {}
};

// 内部タイマー状態（DOM・state.js とは別、低レベル管理）
let targetTime = 0;        // 終了予定時刻 (ms, performance.now基準)
let pausedRemainingMs = 0; // 一時停止中に保持する残り時間
let rafId = null;          // requestAnimationFrame の戻り値
let isPreStart = false;    // PRE_START 中（PAUSED に遷移しても true を維持し、resume の分岐に使う）
let preStartTotalMs = 0;   // プレスタート選択値（renderer のフォーマット決定にも使われる）

// イベントハンドラ登録
export function setHandlers({ onTick, onLevelChange, onLevelEnd, onPreStartTick, onPreStartEnd }) {
  if (onTick) handlers.onTick = onTick;
  if (onLevelChange) handlers.onLevelChange = onLevelChange;
  if (onLevelEnd) handlers.onLevelEnd = onLevelEnd;
  if (onPreStartTick) handlers.onPreStartTick = onPreStartTick;
  if (onPreStartEnd) handlers.onPreStartEnd = onPreStartEnd;
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
  handlers.onLevelChange(index);
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
}

// 再開
export function resume() {
  if (getState().status !== States.PAUSED) return;
  targetTime = performance.now() + pausedRemainingMs;
  pausedRemainingMs = 0;
  if (isPreStart) {
    setState({ status: States.PRE_START });
    startPreStartLoop();
    return;
  }
  const { currentLevelIndex } = getState();
  setState({
    status: isBreakLevel(currentLevelIndex) ? States.BREAK : States.RUNNING
  });
  startLoop();
}

// リセット（IDLE状態でレベル0に戻す）
export function reset() {
  stopLoop();
  pausedRemainingMs = 0;
  targetTime = 0;
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
  startPreStartLoop();
}

// プレスタートを中断して IDLE に戻す（resetボタンと等価だが onPreStartEnd は鳴らさない）
export function cancelPreStart() {
  if (!isPreStart) return;
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
}

// rAFループ開始
function startLoop() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

// PRE_START 用 rAF ループ（status が PRE_START 以外になれば自然停止）
function startPreStartLoop() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(preStartTick);
}

function preStartTick() {
  rafId = null;
  if (getState().status !== States.PRE_START) return;
  const remainingMs = targetTime - performance.now();
  if (remainingMs <= 0) {
    isPreStart = false;
    preStartTotalMs = 0;
    handlers.onPreStartEnd();
    // RUNNING へ自動遷移（startAtLevel は内部で setState + startLoop を行う）
    startAtLevel(0);
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

  const remainingMs = targetTime - performance.now();
  if (remainingMs <= 0) {
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
    return;
  }
  startAtLevel(target);
}
