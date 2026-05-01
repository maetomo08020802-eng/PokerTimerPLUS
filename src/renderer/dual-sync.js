// PokerTimerPLUS+ v2.0.0 STEP 2: 2 画面間状態同期レイヤ（hall 側専用）
// 役割: main プロセスからの差分配信を受け取り、既存 state.js の setState で適用する。
// 設計原則:
//   - main を単一の真実源とし、hall は purely consumer（hall → main の操作リクエスト送信は禁止）
//   - 通信はイベント駆動、ポーリング禁止（v2-dual-screen.md §1.3）
//   - 既存 state.js / timer.js / blinds.js は無変更、上に薄い同期レイヤを乗せるだけ
//   - operator / operator-solo では呼ばれない（renderer.js 側で role ガード）
//
// 受信する kind の一覧（main.js _dualStateCache と同期）:
//   timerState / structure / displaySettings / marqueeSettings /
//   tournamentRuntime / tournamentBasics / audioSettings / logoUrl / venueName

import { setState } from './state.js';

// v2.0.1 Stabilization #A1: hall 側 renderer がこのハンドラを登録することで、
//   main からの差分配信を実際の DOM 更新（applyMarquee / applyBackground 等）に
//   反映できるようにする。dual-sync.js から renderer.js 内の関数を直接 import すると
//   循環依存になるため、callback 登録方式で疎結合に保つ。
//   登録なしの場合（旧互換 + operator-solo）は state.js への記録のみで実害なし。
let _diffHandler = null;
export function registerDualDiffHandler(handler) {
  _diffHandler = (typeof handler === 'function') ? handler : null;
}

// 受信した差分を state.js に反映 + 登録済 handler に転送する。
//   既存 state.js の appState は { status, currentLevelIndex, remainingMs, totalMs } の 4 フィールドを
//   想定しているが、Object.assign で拡張フィールドも追加可能（既存購読者は影響なし）。
//   v2.0.1 #A1: 加えて _diffHandler に diff を渡し、hall 側 renderer で
//   applyMarquee / applyBackground / applyLogo / applyVenueName / applyTournament 等を
//   発火する経路を確立。
function _applyDiffToState(diff) {
  if (!diff || typeof diff !== 'object' || typeof diff.kind !== 'string') return;
  const { kind, value } = diff;
  if (value === undefined) return;
  // 1. state.js への記録（後方互換、debug 用）
  setState({ [`dual_${kind}`]: value });
  // 2. hall 側 renderer の動的反映（registerDualDiffHandler で登録済の場合のみ）
  if (_diffHandler) {
    try { _diffHandler(diff); }
    catch (err) { console.warn('[dual-sync] diff handler error:', err); }
  }
}

// hall 起動時の初期同期 + 差分購読を立ち上げる。
//   - window.appRole === 'hall' でない場合は no-op（安全側ガード）
//   - window.api.dual が無い場合（preload 未注入 / 単画面モード）も no-op
export async function initDualSyncForHall() {
  if (typeof window === 'undefined') return;
  if (window.appRole !== 'hall') return;
  const dual = window.api && window.api.dual;
  if (!dual || typeof dual.fetchInitialState !== 'function') return;

  // 1. 初期状態を 1 回だけ取得して全 kind を state に反映
  let initial = null;
  try {
    initial = await dual.fetchInitialState();
  } catch (err) {
    console.warn('[dual-sync] 初期状態取得に失敗:', err);
    initial = null;
  }
  if (initial && typeof initial === 'object') {
    for (const kind of Object.keys(initial)) {
      const value = initial[kind];
      if (value === null || value === undefined) continue;
      _applyDiffToState({ kind, value });
    }
  }

  // 2. 以降は main からの差分配信を購読（イベント駆動、ポーリングなし）
  try {
    dual.subscribeStateSync((diff) => _applyDiffToState(diff));
  } catch (err) {
    console.warn('[dual-sync] 差分購読の登録に失敗:', err);
  }
}
