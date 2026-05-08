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

// 受信した差分を state.js に反映 + 登録済 handler に転送する（同期的、即時 apply）。
//   既存 state.js の appState は { status, currentLevelIndex, remainingMs, totalMs } の 4 フィールドを
//   想定しているが、Object.assign で拡張フィールドも追加可能（既存購読者は影響なし）。
//   v2.0.1 #A1: 加えて _diffHandler に diff を渡し、hall 側 renderer で
//   applyMarquee / applyBackground / applyLogo / applyVenueName / applyTournament 等を
//   発火する経路を確立。
//   v2.1.7: 本関数（同期 apply の本体）は touch せず保持し、buffer 機構（_bufferDiff /
//           _flushDiffBuffer）を前段に追加する設計。flush 時に本関数を呼び出す。
function _applyDiffToState(diff) {
  if (!diff || typeof diff !== 'object' || typeof diff.kind !== 'string') return;
  const { kind, value } = diff;
  if (value === undefined) return;
  // v2.0.4-rc17: 常時 3 ラベル rolling ログ #2（hall 受信 ts、timerState のみ）
  if (kind === 'timerState') {
    try { window.api?.log?.write?.('timer:state:recv:hall', { status: value?.status, level: value?.currentLevel, elapsed: value?.elapsedSecondsInLevel, role: window.appRole }); } catch (_) { /* never throw from logging */ }
  }
  // v2.0.4-rc18 第 1 弾 タスク 4: 常時 2 ラベル追加（runtime / blindPreset 受信 ts）
  if (kind === 'tournamentRuntime') {
    try { window.api?.log?.write?.('runtime:state:recv:hall', { playersInitial: value?.playersInitial, playersRemaining: value?.playersRemaining, reentryCount: value?.reentryCount, addOnCount: value?.addOnCount, role: window.appRole }); } catch (_) { /* never throw from logging */ }
  }
  if (kind === 'tournamentBasics') {
    try { window.api?.log?.write?.('blindPreset:state:recv:hall', { presetId: value?.blindPresetId, presetName: value?.name, structureLength: value?.structure?.levels?.length || 0, role: window.appRole }); } catch (_) { /* never throw from logging */ }
  }
  // 1. state.js への記録（後方互換、debug 用）
  setState({ [`dual_${kind}`]: value });
  // 2. hall 側 renderer の動的反映（registerDualDiffHandler で登録済の場合のみ）
  if (_diffHandler) {
    try { _diffHandler(diff); }
    catch (err) { console.warn('[dual-sync] diff handler error:', err); }
  }
}

// =============================================================================
// v2.1.7: hall 側 atomic update 機構（B 系構造的根治）
// =============================================================================
// 真因: main 側で複数 broadcast kind を逐次送信時の IPC 順序保証欠如 + hall 側 receiver の
//       atomic update 不在により、トーナメント切替・PAUSED 中変更・連打操作で hall 側が
//       中間状態を一瞬表示する race condition が発生していた（B1 / B2 / B4 / B7 ⑤⑥②）。
//
// 修正方針（方針 C）: hall 側で受信した diff を microbuffer に溜めて setTimeout(0) で
//                     一括 apply。同一 kind は最後の値で dedup（古い中間値を捨てる）、
//                     異なる kind は受信順保持（cross-kind ordering 保証）。
//
// hall 専用: subscribeStateSync の登録は initDualSyncForHall 内（appRole === 'hall' ガード後）
//           のみで実施 → operator / operator-solo は本機構を一切通らない（即時 apply 経路は維持）。
//
// preStartState（v2.1.6 で追加した kind）も同じ buffer 経路を通る → 1 秒間引きとは別の hall 側
// 集約機構として両立（rAF 1 秒間引きは送信側、buffer は受信側、責務分離）。
const DIFF_BUFFER_MAX = 100;
const _diffBuffer = [];
let _flushTimer = null;
let _isFlushing = false;

// 受信した diff を buffer に積み、次の macrotask（setTimeout(0)）で一括 apply。
//   - 既に flush タイマー登録済なら追加 push のみ（新タイマー登録なし）
//   - buffer 上限（DIFF_BUFFER_MAX = 100）超過時は古い順から破棄 + 警告ログ
function _bufferDiff(diff) {
  if (!diff || typeof diff !== 'object' || typeof diff.kind !== 'string') return;
  // 上限到達時の暴走防止（古い diff から破棄、警告ログ出力）
  if (_diffBuffer.length >= DIFF_BUFFER_MAX) {
    try {
      console.warn('[dual-sync] _diffBuffer 上限', DIFF_BUFFER_MAX, '到達、古い diff を破棄');
      window.api?.log?.write?.('dual-sync:buffer:overflow', {
        bufferSize: _diffBuffer.length,
        droppedKind: _diffBuffer[0] && _diffBuffer[0].kind || null
      });
    } catch (_) { /* never throw from logging */ }
    _diffBuffer.shift();
  }
  _diffBuffer.push(diff);
  // 既にタイマー登録済なら何もしない（buffer に積むだけ）
  // 再入中（_isFlushing）の場合も「タイマー未登録」状態なので、ここで再登録される
  // → 次のフレームで flush 実行（再帰防止 + 取りこぼしなし）
  if (_flushTimer === null) {
    // v2.1.9: setTimeout(0) は macrotask boundary で 50〜200ms 遅延が発生し、
    //   音と表示のタイミングがズレる症状（前原さん「会場モニターが 0.2 秒遅れる」）
    //   の原因だった。requestAnimationFrame に切替えることで次フレーム（16〜50ms）
    //   で flush され、描画パイプと自然に同期する。atomic update 効果は維持
    //   （rAF boundary 内で複数 diff を集約、dedup + 受信順保持はそのまま）。
    _flushTimer = requestAnimationFrame(() => {
      _flushTimer = null;
      _flushDiffBuffer();
    });
  }
}

// buffer 内の diff を一括 apply（macrotask boundary、atomic update）。
//   同一 kind の diff は最後の値だけ apply（dedup）、異なる kind は受信順保持。
//   個別 apply の例外は try-catch で握り潰し、他の diff の apply は継続する。
function _flushDiffBuffer() {
  _flushTimer = null;
  if (_isFlushing) return;  // 再帰防止（理論上ここには来ないが二重防御）
  _isFlushing = true;
  try {
    // 同一 kind は最後の値で dedup、異なる kind は受信順保持。
    // Map の delete + set パターンで、最終出現位置に再配置（受信順 = 最終位置順）。
    const dedup = new Map();
    for (const d of _diffBuffer) {
      if (!d || typeof d.kind !== 'string') continue;
      if (dedup.has(d.kind)) dedup.delete(d.kind);
      dedup.set(d.kind, d);
    }
    _diffBuffer.length = 0;
    // 個別 apply の例外で他の diff を巻き込まないよう try-catch で個別保護
    for (const d of dedup.values()) {
      try {
        _applyDiffToState(d);
      } catch (err) {
        console.warn('[dual-sync] _applyDiffToState failed for kind=', d && d.kind, err);
      }
    }
  } finally {
    _isFlushing = false;
  }
}

// hall window 破棄時の cleanup（buffer + rAF handle リーク防止）。
//   beforeunload は once: true で 1 回のみ発火、再 register 不要。
//   v2.1.9: setTimeout → requestAnimationFrame 切替に伴い、cancelAnimationFrame に変更。
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    if (_flushTimer !== null) {
      cancelAnimationFrame(_flushTimer);
      _flushTimer = null;
    }
    _diffBuffer.length = 0;
  }, { once: true });
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
    // v2.1.7: 初期同期は即時 apply（startup race なし、initialize() 順序維持のため buffer 不経由）
    for (const kind of Object.keys(initial)) {
      const value = initial[kind];
      if (value === null || value === undefined) continue;
      _applyDiffToState({ kind, value });
    }
  }

  // 2. 以降は main からの差分配信を購読（イベント駆動、ポーリングなし）
  //    v2.1.7: ランタイム broadcast は buffer 経由で atomic update（B1/B2/B4/B7 構造的根治）
  try {
    dual.subscribeStateSync((diff) => _bufferDiff(diff));
  } catch (err) {
    console.warn('[dual-sync] 差分購読の登録に失敗:', err);
  }
}
