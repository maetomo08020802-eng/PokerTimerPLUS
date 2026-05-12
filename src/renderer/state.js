// 状態管理モジュール
// timer-logic.md の規約に従い、状態遷移は本モジュールに集約する。
//
// 状態遷移図:
//   IDLE ──[startPreStart]──> PRE_START ──[残り0/即時]──> RUNNING
//   IDLE ──[start (即時)]──> RUNNING
//   PRE_START ──[pause]──> PAUSED ──[resume]──> PRE_START（内部フラグで判別）
//   PRE_START ──[reset]──> IDLE
//   RUNNING ⇄ PAUSED（既存）
//   RUNNING ──[次レベル]──> RUNNING / BREAK
//   * → IDLE（reset）

export const States = Object.freeze({
  IDLE: 'IDLE',
  PRE_START: 'PRE_START',   // STEP 5: スタートまでのプレ待機（HH:MM:SS カウントダウン）
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  BREAK: 'BREAK'
});

// アプリ全体の状態（モジュール内に閉じ、外部からは getState/setState 経由でアクセス）
const appState = {
  status: States.IDLE,
  currentLevelIndex: 0,
  remainingMs: 0,
  totalMs: 0
};

// 購読者リスト
const subscribers = new Set();

// 現在状態のスナップショットを返す（イミュータブル）
export function getState() {
  return Object.freeze({ ...appState });
}

// 状態更新（部分マージ）→ 全購読者に通知
export function setState(patch) {
  const prev = { ...appState };
  Object.assign(appState, patch);
  if (!isValidStatus(appState.status)) {
    console.warn(`想定外の状態: ${appState.status} → IDLE に戻します`);
    appState.status = States.IDLE;
  }
  notify(prev);
}

// 購読登録（解除関数を返す）
export function subscribe(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function notify(prev) {
  const snapshot = getState();
  for (const listener of subscribers) {
    try {
      listener(snapshot, prev);
    } catch (err) {
      // v2.1.18-meas1 error:caught:state.notify: subscriber 内 throw を rolling-log に記録
      try {
        if (typeof window !== 'undefined' && window.api?.log?.write) {
          window.api.log.write('error:caught:state.notify', { message: err?.message, stack_top: (err?.stack || '').split('\n')[1] });
        }
      } catch (_) {}
      console.warn('状態購読者でエラー発生:', err);
    }
  }
  // v2.1.18-meas1 state:transition: status 変化を edge イベントとして rolling-log に記録
  try {
    if (prev && prev.status !== snapshot.status && typeof window !== 'undefined' && window.api?.log?.write) {
      window.api.log.write('state:transition', { from: prev.status, to: snapshot.status, levelIdx: snapshot.currentLevelIndex });
    }
  } catch (_) {}
}

function isValidStatus(status) {
  return Object.values(States).includes(status);
}
