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

// v2.1.20-meas1 カテゴリ F: subscribe 通知頻度サマリ。
//   subscribe 経由で登録される listener 名を識別するため、renderer.js 側から事前に名前を付与する
//   `subscribeNamed(name, listener)` をエクスポート。state.js 側は notify ループ内で listener.__measName
//   プロパティを読んで集計（window._subscribeCounter 経由で renderer.js の 30 秒集計と連動）。
export function subscribeNamed(name, listener) {
  // listener に名前を付与してから登録（既存 subscribe と完全互換、名前なしの listener は subscribe() を直接使う）
  try { listener.__measName = String(name || 'unknown'); } catch (_) {}
  return subscribe(listener);
}

function notify(prev) {
  const snapshot = getState();
  // v2.1.18-meas1 perf:state:notify: 全購読者通知ループの所要時間を rolling-log に記録（hall / operator / main 共通）
  const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  for (const listener of subscribers) {
    // v2.1.20-meas1 カテゴリ F: listener 個別の所要時間を集計（window._subscribeCounter は renderer.js 側で定義）
    const _tL = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
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
    try {
      const _msL = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - _tL;
      const lname = (listener.__measName) || 'unnamed';
      if (typeof window !== 'undefined' && window._subscribeCounter) {
        const c = window._subscribeCounter;
        if (!c[lname]) c[lname] = { count: 0, totalMs: 0 };
        c[lname].count += 1;
        c[lname].totalMs += _msL;
      }
    } catch (_) {}
  }
  try {
    // v2.1.20-rc6-meas3: perf:state:notify を高頻度ラベル集約用 _highFreqCounter 経由に置換（renderer.js が共有）
    if (typeof window !== 'undefined') {
      const _ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - _t0;
      if (window._highFreqCounter) {
        if (!window._highFreqCounter['perf:state:notify']) {
          window._highFreqCounter['perf:state:notify'] = { count: 0, totalMs: 0 };
        }
        window._highFreqCounter['perf:state:notify'].count++;
        window._highFreqCounter['perf:state:notify'].totalMs += _ms;
      }
    }
  } catch (_) {}
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
