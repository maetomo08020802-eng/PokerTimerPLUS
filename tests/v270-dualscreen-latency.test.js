/**
 * v2.6.3 回帰テスト — ② 2画面（operator→hall）時差改善・案A（遷移時のみ即時送信）
 *
 *   背景: operator で状態遷移（一時停止/再開・レベル切替・即時開始）してから hall に反映されるまで
 *         最大約 500ms の時差があった。原因は遷移送信が `schedulePersistTimerState`（500ms debounce）に
 *         縛られていたこと。案A = 状態遷移時のみ debounce をバイパスして `persistTimerStateNow()` で
 *         即時送信し、連続値変化（PAUSED remainingMs / IDLE remainingMs・totalMs）と PRE_START 絡みは
 *         従来 500ms debounce を維持する。hall は consumer のまま（アーキ不変）。
 *
 *   検証観点:
 *     振る舞い（実ソース抽出 → new Function + モック。再実装ではなく出荷コードを実行）:
 *       T1  persistTimerStateNow: hall role → setTimerState 不呼出・cancelPending 不呼出（早期 return）
 *       T2  persistTimerStateNow: operator → cancelPending 呼出 + capture 後 setTimerState を 1 回・即時
 *       T3  persistTimerStateNow: id 不在でも cancelPending は呼ぶが setTimerState は呼ばない
 *       T4  persistTimerStateNow 本体に setTimeout が無い（= 即時送信・debounce ではない）
 *     振る舞い（subscribe 遷移ルーティングブロックを実ソース抽出 → new Function）:
 *       T5  IDLE→RUNNING（status 遷移・非PRE_START）→ persistTimerStateNow（即時）
 *       T6  レベル切替（currentLevelIndex 変化・非PRE_START）→ persistTimerStateNow（即時）
 *       T7  ★提案1 必須: PRE_START→RUNNING（0着地・prev=PRE_START）→ schedulePersistTimerState（従来 debounce）
 *       T8  ★提案1 必須: IDLE→PRE_START（state=PRE_START 入場）→ schedulePersistTimerState
 *       T9  ★提案1 必須: PRE_START 中の一時停止（isPreStartActive()=true）→ schedulePersistTimerState
 *       T10 PAUSED の remainingMs 値変化（status/level 不変）→ schedulePersistTimerState（値変化は従来 debounce）
 *     静的（subscribe ルーティング・非破壊）:
 *       T11 isTransition / involvesPreStart 定義と `isTransition && !involvesPreStart → persistTimerStateNow`
 *       T12 involvesPreStart が PRE_START / isPreStartActive を参照（0着地ガード防御1）
 *       T13 schedulePersistTimerState は 500ms debounce 据置（無改変）
 *       T14 captureCurrentTimerState の PRE_START→idle 化（防御2）健在
 *       T15 applyOperatorPreStartState の discard-stale-restore ガード（v2.4.1）健在
 *       T16 periodic 5秒 / PRE_START 即時送信経路（publishPreStartIfOperator）に未介入
 *     致命バグ保護 5 件 cross-check:
 *       T17 resetBlindProgressOnly / ensureEditorEditableState / schedulePersistRuntime / AudioContext resume /
 *           setRuntime IPC / setDisplaySettings timerState destructure 除外
 *     version:
 *       T18 package.json.version 一致 + scripts.test に v270 登録
 *
 *   実行: node tests/v270-dualscreen-latency.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const MAIN_JS   = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const AUDIO     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 列 0 でない balanced-brace 抽出（関数本体の inner only を返す。signatureRe は末尾が `{`）。
function extractInnerBody(source, signatureRe) {
  const m = source.match(signatureRe);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1;  // 末尾 `{` の位置
  let depth = 1, i = openIdx + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(openIdx + 1, i - 1);
}

const States = { IDLE: 0, RUNNING: 1, BREAK: 2, PAUSED: 3, PRE_START: 4 };

// ============================================================
// 振る舞い: persistTimerStateNow（実ソース抽出 → new Function）
// ============================================================
function makePersistNowRunner() {
  const body = extractInnerBody(RENDERER, /function\s+persistTimerStateNow\s*\(\s*\)\s*\{/);
  assert.ok(body, 'persistTimerStateNow 本体の抽出に失敗');
  const fn = new Function('window', 'tournamentState', 'cancelPendingTimerStatePersist', 'captureCurrentTimerState', body);
  return (ctx) => fn(ctx.window, ctx.tournamentState, ctx.cancelPendingTimerStatePersist, ctx.captureCurrentTimerState);
}

function makePersistNowCtx({ role, id, hasApi = true }) {
  const calls = { cancel: 0, capture: 0, setTimerState: [], warn: 0 };
  const ts = { status: 'paused', currentLevel: 2, elapsedSecondsInLevel: 30, startedAt: null, pausedAt: 123 };
  const api = hasApi ? { tournaments: { setTimerState: (i, t) => { calls.setTimerState.push({ id: i, ts: t }); return Promise.resolve(); } } } : {};
  return {
    calls,
    window: { appRole: role, api },
    tournamentState: { id },
    cancelPendingTimerStatePersist: () => { calls.cancel++; },
    captureCurrentTimerState: () => { calls.capture++; return ts; },
    _expectedTs: ts,
  };
}

test('T1: persistTimerStateNow — hall role は早期 return（setTimerState/cancelPending とも不呼出）', () => {
  const run = makePersistNowRunner();
  const ctx = makePersistNowCtx({ role: 'hall', id: 'tour-1' });
  run(ctx);
  assert.equal(ctx.calls.setTimerState.length, 0, 'hall で setTimerState が呼ばれた（逆書込禁止違反）');
  assert.equal(ctx.calls.cancel, 0, 'hall で cancelPendingTimerStatePersist が呼ばれた（early return より後の処理に到達）');
  assert.equal(ctx.calls.capture, 0, 'hall で captureCurrentTimerState が呼ばれた');
});

test('T2: persistTimerStateNow — operator は cancelPending → capture → setTimerState(id, ts) を 1 回・即時', () => {
  const run = makePersistNowRunner();
  const ctx = makePersistNowCtx({ role: 'operator', id: 'tour-1' });
  run(ctx);
  assert.equal(ctx.calls.cancel, 1, 'cancelPendingTimerStatePersist が呼ばれていない（二重送信防止が機能しない）');
  assert.equal(ctx.calls.capture, 1, 'captureCurrentTimerState が呼ばれていない');
  assert.equal(ctx.calls.setTimerState.length, 1, 'setTimerState が 1 回呼ばれていない（即時送信不発火）');
  assert.equal(ctx.calls.setTimerState[0].id, 'tour-1', 'setTimerState に正しい id が渡っていない');
  assert.deepEqual(ctx.calls.setTimerState[0].ts, ctx._expectedTs, 'setTimerState に capture 済 timerState が渡っていない');
});

test('T2b: persistTimerStateNow — operator-solo でも送信する（hall 以外は producer）', () => {
  const run = makePersistNowRunner();
  const ctx = makePersistNowCtx({ role: 'operator-solo', id: 'tour-9' });
  run(ctx);
  assert.equal(ctx.calls.setTimerState.length, 1, 'operator-solo で即時送信されていない');
});

test('T3: persistTimerStateNow — id 不在なら cancelPending は呼ぶが setTimerState は呼ばない', () => {
  const run = makePersistNowRunner();
  const ctx = makePersistNowCtx({ role: 'operator', id: '' });
  run(ctx);
  assert.equal(ctx.calls.cancel, 1, 'id 不在でも cancelPending は冒頭で呼ばれるべき（pending を残さない）');
  assert.equal(ctx.calls.setTimerState.length, 0, 'id 不在なのに setTimerState が呼ばれた');
});

test('T3b: persistTimerStateNow — setTimerState API 不在ガードで no-op（cancelPending のみ）', () => {
  const run = makePersistNowRunner();
  const ctx = makePersistNowCtx({ role: 'operator', id: 'tour-1', hasApi: false });
  run(ctx);
  assert.equal(ctx.calls.setTimerState.length, 0, 'API 不在なのに setTimerState 経路に進んだ');
});

test('T4: persistTimerStateNow 本体に setTimeout が無い（debounce ではなく即時送信）', () => {
  const body = extractInnerBody(RENDERER, /function\s+persistTimerStateNow\s*\(\s*\)\s*\{/);
  assert.ok(body, 'persistTimerStateNow 本体の抽出に失敗');
  assert.doesNotMatch(body, /setTimeout/, 'persistTimerStateNow に setTimeout が混入（即時送信ではない）');
  assert.match(body, /cancelPendingTimerStatePersist\s*\(\s*\)/, 'cancelPendingTimerStatePersist 呼出が無い（二重送信防止欠如）');
  assert.match(body, /window\.appRole\s*===\s*['"]hall['"]/, 'hall early-return ガードが無い（逆書込防止欠如）');
});

// ============================================================
// 振る舞い: subscribe 遷移ルーティングブロック（実ソース抽出 → new Function）
//   [v270-route-end] マーカーまでを抽出し、persistTimerStateNow / schedulePersistTimerState を
//   モックして「どちらに落ちるか」を出荷コードそのもので観測する。
// ============================================================
function extractRouteBlock() {
  const startIdx = RENDERER.indexOf('const isTransition =');
  assert.ok(startIdx >= 0, 'subscribe ルーティングブロック先頭（const isTransition）が見つからない');
  const endIdx = RENDERER.indexOf('// [v270-route-end]', startIdx);
  assert.ok(endIdx > startIdx, '[v270-route-end] マーカーが見つからない（抽出範囲不定）');
  return RENDERER.slice(startIdx, endIdx);
}

function makeRouteRunner() {
  const block = extractRouteBlock();
  const fn = new Function(
    'state', 'prev', 'States', 'isPreStartActive', 'persistTimerStateNow', 'schedulePersistTimerState',
    block
  );
  return ({ state, prev, isPreStartActive }) => {
    let route = null;
    fn(
      state, prev, States,
      isPreStartActive || (() => false),
      () => { route = 'now'; },
      () => { route = 'schedule'; }
    );
    return route;
  };
}

test('T5: 遷移ルーティング — IDLE→RUNNING（status 遷移・非PRE_START）は persistTimerStateNow（即時）', () => {
  const route = makeRouteRunner()({
    state: { status: States.RUNNING, currentLevelIndex: 0, remainingMs: 600000, totalMs: 600000 },
    prev:  { status: States.IDLE,    currentLevelIndex: 0, remainingMs: 600000, totalMs: 600000 },
  });
  assert.equal(route, 'now', 'IDLE→RUNNING 遷移が即時送信されない（時差が残る）');
});

test('T6: 遷移ルーティング — レベル切替（currentLevelIndex 変化・非PRE_START）は persistTimerStateNow（即時）', () => {
  const route = makeRouteRunner()({
    state: { status: States.RUNNING, currentLevelIndex: 2, remainingMs: 900000, totalMs: 900000 },
    prev:  { status: States.RUNNING, currentLevelIndex: 1, remainingMs: 0,      totalMs: 600000 },
  });
  assert.equal(route, 'now', 'レベル切替が即時送信されない');
});

test('T6b: 遷移ルーティング — RUNNING→PAUSED（Space 一時停止・非PRE_START）は persistTimerStateNow（即時）', () => {
  const route = makeRouteRunner()({
    state: { status: States.PAUSED,  currentLevelIndex: 1, remainingMs: 300000, totalMs: 600000 },
    prev:  { status: States.RUNNING, currentLevelIndex: 1, remainingMs: 300000, totalMs: 600000 },
  });
  assert.equal(route, 'now', 'RUNNING→PAUSED 遷移が即時送信されない（体感差が最も出る経路）');
});

test('T7: ★提案1 — PRE_START→RUNNING（0着地・prev=PRE_START）は schedulePersistTimerState（従来 debounce）', () => {
  const route = makeRouteRunner()({
    state: { status: States.RUNNING,   currentLevelIndex: 0, remainingMs: 600000, totalMs: 600000 },
    prev:  { status: States.PRE_START, currentLevelIndex: 0, remainingMs: 0,      totalMs: 300000 },
    isPreStartActive: () => false,  // 0着地直後は既に非活性
  });
  assert.equal(route, 'schedule', '0着地（PRE_START→RUNNING）が即時送信に乗った（v2.4.1 0着地ガードの敏感経路に介入＝退行）');
});

test('T8: ★提案1 — IDLE→PRE_START（state=PRE_START 入場）は schedulePersistTimerState', () => {
  const route = makeRouteRunner()({
    state: { status: States.PRE_START, currentLevelIndex: 0, remainingMs: 300000, totalMs: 300000 },
    prev:  { status: States.IDLE,      currentLevelIndex: 0, remainingMs: 600000, totalMs: 600000 },
    isPreStartActive: () => true,
  });
  assert.equal(route, 'schedule', 'PRE_START 入場が即時送信に乗った（PRE_START 絡みは従来 debounce 維持のはず）');
});

test('T9: ★提案1 — PRE_START 中の一時停止（isPreStartActive()=true）は schedulePersistTimerState', () => {
  // state/prev の status リテラルは PRE_START でなくても、isPreStartActive() が true なら involvesPreStart で除外。
  const route = makeRouteRunner()({
    state: { status: States.PAUSED,  currentLevelIndex: 0, remainingMs: 200000, totalMs: 300000 },
    prev:  { status: States.RUNNING, currentLevelIndex: 0, remainingMs: 200000, totalMs: 300000 },
    isPreStartActive: () => true,
  });
  assert.equal(route, 'schedule', 'PRE_START 中の遷移が即時送信に乗った（isPreStartActive ガードが効いていない）');
});

test('T10: 値変化 — PAUSED の remainingMs 単独変化（status/level 不変）は schedulePersistTimerState（従来 debounce）', () => {
  const route = makeRouteRunner()({
    state: { status: States.PAUSED, currentLevelIndex: 1, remainingMs: 270000, totalMs: 600000 },
    prev:  { status: States.PAUSED, currentLevelIndex: 1, remainingMs: 300000, totalMs: 600000 },
  });
  assert.equal(route, 'schedule', 'PAUSED 中の time-shift（値変化）が即時送信に乗った（値変化は従来 debounce 維持のはず）');
});

test('T10b: 値変化 — IDLE の totalMs 変化（構造変更・status/level 不変）は schedulePersistTimerState', () => {
  const route = makeRouteRunner()({
    state: { status: States.IDLE, currentLevelIndex: 0, remainingMs: 1200000, totalMs: 1200000 },
    prev:  { status: States.IDLE, currentLevelIndex: 0, remainingMs: 600000,  totalMs: 600000 },
  });
  assert.equal(route, 'schedule', 'IDLE の duration 変化（値変化）が即時送信に乗った');
});

// ============================================================
// 静的: subscribe ルーティング構造・非破壊
// ============================================================
test('T11: subscribe ルーティングに isTransition / involvesPreStart と即時送信分岐が存在', () => {
  const block = extractRouteBlock();
  assert.match(block, /const\s+isTransition\s*=\s*\(\s*state\.status\s*!==\s*prev\.status\s*\)\s*\|\|\s*\(\s*state\.currentLevelIndex\s*!==\s*prev\.currentLevelIndex\s*\)/,
    'isTransition の定義（status 変化 || level 変化）が見つからない');
  assert.match(block, /if\s*\(\s*isTransition\s*&&\s*!\s*involvesPreStart\s*\)\s*\{[\s\S]*?persistTimerStateNow\s*\(\s*\)/,
    '`isTransition && !involvesPreStart` 分岐で persistTimerStateNow を呼んでいない');
  assert.match(block, /else\s*\{[\s\S]*?schedulePersistTimerState\s*\(\s*\)/,
    'else 分岐で schedulePersistTimerState（従来 debounce）に落ちていない');
});

test('T12: involvesPreStart が PRE_START / isPreStartActive を参照（0着地ガード防御1）', () => {
  const block = extractRouteBlock();
  assert.match(block, /involvesPreStart\s*=\s*\(\s*state\.status\s*===\s*States\.PRE_START\s*\)\s*\|\|\s*\(\s*prev\.status\s*===\s*States\.PRE_START\s*\)/,
    'involvesPreStart が state/prev の PRE_START を参照していない（0着地・入場を除外できない）');
  assert.match(block, /typeof\s+isPreStartActive\s*===\s*['"]function['"]\s*&&\s*isPreStartActive\s*\(\s*\)/,
    'involvesPreStart が isPreStartActive() を参照していない（PRE_START 中操作を除外できない）');
});

test('T13: schedulePersistTimerState は 500ms debounce のまま据置（無改変）', () => {
  const body = extractInnerBody(RENDERER, /function\s+schedulePersistTimerState\s*\(\s*\)\s*\{/);
  assert.ok(body, 'schedulePersistTimerState 本体の抽出に失敗');
  assert.match(body, /setTimeout\s*\([\s\S]*?,\s*500\s*\)/, 'schedulePersistTimerState の 500ms debounce が消えた（値変化即時化＝IPC flood リスク）');
  assert.match(body, /window\.appRole\s*===\s*['"]hall['"]/, 'schedulePersistTimerState の hall ガードが消えた');
});

test('T14: captureCurrentTimerState の PRE_START→idle 化（防御2）が健在', () => {
  assert.match(RENDERER, /isPreStartLikely[\s\S]{0,200}?return\s*\{\s*status:\s*['"]idle['"]/,
    'captureCurrentTimerState の PRE_START→idle 化（v2.1.18 二重防御）が消えた');
});

test('T15: applyOperatorPreStartState の discard-stale-restore ガード（v2.4.1）が健在', () => {
  assert.match(RENDERER, /operator:applyPreStartState:discard-stale-restore/,
    'PRE_START 0着地ガード（v2.4.1 discard-stale-restore）が消えた');
});

test('T16: periodic 5秒再同期 / PRE_START 即時送信経路に未介入', () => {
  assert.match(RENDERER, /publishPreStartIfOperator/, 'PRE_START 即時送信経路 publishPreStartIfOperator が消えた');
  // 5 秒粒度の保険再同期（periodicPersistAllRunning）は dual-screen 重さ対策で維持＝頻度を増やしていない確認。
  //   呼出は _wrappedSetInterval(..., periodicPersistAllRunning, 5000) なので 5000 ピンで検証。
  assert.match(RENDERER, /periodicPersistAllRunning\s*,\s*5000\s*\)/, 'periodic 5秒再同期（periodicPersistAllRunning, 5000）が消えた／頻度が変わった疑い');
});

// ============================================================
// 致命バグ保護 5 件 cross-check
// ============================================================
test('T17a: resetBlindProgressOnly / ensureEditorEditableState / schedulePersistRuntime が健在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, '致命バグ保護: resetBlindProgressOnly 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, '致命バグ保護: ensureEditorEditableState 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, '致命バグ保護: schedulePersistRuntime（runtime 永続化）消失');
});

test('T17b: AudioContext resume / setRuntime IPC / setDisplaySettings timerState destructure 除外が健在', () => {
  assert.match(AUDIO, /audioContext\.state\s*===\s*['"]suspended['"]/, '致命バグ保護: AudioContext suspended 検出消失');
  assert.match(AUDIO, /audioContext\.resume\s*\(/, '致命バグ保護: audioContext.resume() 消失');
  assert.match(MAIN_JS, /ipcMain\.handle\s*\(\s*['"]tournaments:setRuntime['"]/, '致命バグ保護: setRuntime IPC 消失');
  const m = MAIN_JS.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'setDisplaySettings ハンドラが見つからない');
  assert.doesNotMatch(m[0], /\{\s*[^}]*\btimerState\b[^}]*\}\s*=/, '致命バグ保護: setDisplaySettings に timerState destructure 混入');
});

test('T17c: dual-sync.js / timer.js / main.js の timerState 送受信経路は本変更で無改変（renderer.js のみ）', () => {
  // setTimerState IPC ハンドラの _isSwitchingMode ガードが健在（即時送信も従来どおり弾く）
  assert.match(MAIN_JS, /_isSwitchingMode/, 'main.js の _isSwitchingMode ガードが消えた（HDMI 切替中 stale 送信ガード）');
  assert.match(MAIN_JS, /['"]timer:state:send['"]/, 'main.js の timer:state:send ラベル（計測経路）が消えた');
});

// ============================================================
// version
// ============================================================
test('T18: package.json.version 一致 + scripts.test に v270 登録', () => {
  // 配信時 version bump 同期確認（v252 等と同じく現行リリース版にピン）
  assert.equal(PKG.version, '2.7.0', `package.json.version が ${PKG.version}（このテストの想定リリース版と不一致＝bump 漏れ）`);
  assert.match(PKG.scripts.test, /v270-dualscreen-latency\.test\.js/, 'scripts.test に v270-dualscreen-latency.test.js が未登録');
});

console.log(`\nv270 dualscreen-latency: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
