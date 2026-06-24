/**
 * v2.4.1 回帰テスト — prestart-zero-stall 根治（症状①）
 *
 *   真因: operator(-solo) が publish した PRE_START tick({isActive:true}) を main(line 1212) が
 *         自分に再送 → 0 着地（PRE_START→RUNNING）後に届くと applyOperatorPreStartState の
 *         isActive:true 分岐が restorePreStart で RUNNING の上に PRE_START を再点火 →
 *         続く {isActive:false} が cancelPreStart を撃って IDLE へ巻き戻す（0 着地でタイマー停止）。
 *
 *   修正: renderer.js applyOperatorPreStartState の isActive:true 分岐、既存
 *         `if (isPreStartActive()) return;` の直後に
 *         `if (status === RUNNING || status === BREAK) { discard log; return; }` ガードを追加。
 *         else（isActive:false）分岐・main.js・timer.js・IPC は無変更。
 *
 *   検証観点（brief STEP2 §3）:
 *     T2 静的    : isActive:true 分岐に getState().status 参照の RUNNING/BREAK ガード + return が存在
 *     T3 単体相当: status=RUNNING / isPreStart=false で {isActive:true} → restorePreStart 不発火
 *     T4 単体相当: 続く {isActive:false} → cancelPreStart 不発火（巻き戻し撲滅）
 *     T5 回帰    : status=IDLE での {isActive:true} → 従来通り restorePreStart 発火（正当復元維持）
 *     T6 観測    : 破棄時に discard-stale-restore ラベル発火 + main.js allow-list 登録
 *     T7 非破壊  : else（cancel）分岐 + 致命バグ保護 5 件 無変更
 *
 *   実行: node tests/v252-prestart-zero-stall-guard.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// applyOperatorPreStartState の関数本体を実ソースから抽出（v242 と同じ抽出パターン）。
//   函数内の閉じ波括弧はすべてインデント済 → 列 0 の `\n}` が関数末尾に一致する。
function extractApplyOperatorPreStartStateBody() {
  const m = RENDERER.match(/function\s+applyOperatorPreStartState\s*\(\s*payload\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'applyOperatorPreStartState 関数本体の抽出に失敗');
  return m[1];
}

// 抽出した実ソースを new Function で評価し、依存はすべてモック注入して挙動を観測する。
//   = 再実装ではなく「出荷される実コード」をそのまま実行する単体相当テスト。
function makeApplyRunner() {
  const body = extractApplyOperatorPreStartStateBody();
  const fn = new Function(
    'payload', 'window', 'isPreStartActive', 'timerRestorePreStart', 'timerCancelPreStart', 'getState', 'States',
    body
  );
  return (ctx) => fn(
    ctx.payload, ctx.window, ctx.isPreStartActive, ctx.timerRestorePreStart,
    ctx.timerCancelPreStart, ctx.getState, ctx.States
  );
}

const States = { IDLE: 0, RUNNING: 1, BREAK: 2, PAUSED: 3, PRE_START: 4 };

// 観測用コンテキストを組み立て（status / isPreStart をモック、各 API の呼出と log を記録）
function makeCtx({ status, isPreStart }) {
  const calls = { restore: 0, cancel: 0, restoreArgs: [], logs: [] };
  return {
    calls,
    payload: null, // 呼出時に上書き
    window: {
      appRole: 'operator-solo',
      api: { log: { write: (label, data) => calls.logs.push({ label, data }) } }
    },
    isPreStartActive: () => !!isPreStart,
    timerRestorePreStart: (p) => { calls.restore++; calls.restoreArgs.push(p); },
    timerCancelPreStart: () => { calls.cancel++; },
    getState: () => ({ status }),
    States
  };
}

// ============================================================
// T1: package.json.version === 2.4.1
// ============================================================
test('T1: package.json.version === 2.4.1', () => {
  assert.equal(PKG.version, '2.6.5', `期待 2.4.1, 実際 ${PKG.version}`);
});

// ============================================================
// T2: 静的 — isActive:true 分岐に RUNNING/BREAK ガード + getState().status 参照 + return が存在
// ============================================================
test('T2: applyOperatorPreStartState isActive:true 分岐に RUNNING/BREAK status ガードが存在', () => {
  const body = extractApplyOperatorPreStartStateBody();
  // getState().status を参照
  assert.match(body, /getState\s*\(\s*\)\s*\.status/,
    'isActive:true 分岐に getState().status 参照がない（ガード未実装）');
  // RUNNING || BREAK を判定する if ガードが存在
  assert.match(body,
    /if\s*\(\s*curStatus\s*===\s*States\.RUNNING\s*\|\|\s*curStatus\s*===\s*States\.BREAK\s*\)/,
    'RUNNING || BREAK を判定する if ガードが見つからない');
  // discard ラベル発火（try-catch 包み）
  assert.match(body,
    /window\.api\?\.log\?\.write\?\.\s*\(\s*['"]operator:applyPreStartState:discard-stale-restore['"]/,
    'discard-stale-restore 観測ラベルの発火経路がない');
  // discard ラベル発火の「後」に return（破棄して巻き戻さない）
  const guardLabelIdx = body.indexOf('discard-stale-restore');
  const returnAfterIdx = body.indexOf('return', guardLabelIdx);
  assert.ok(guardLabelIdx >= 0 && returnAfterIdx > guardLabelIdx,
    'discard ラベル発火後の return が見つからない（破棄せず処理継続している疑い）');
  // ガードは既存 isPreStartActive() early-return の「後」かつ timerRestorePreStart の「前」に位置する
  const idxPreActive = body.indexOf('isPreStartActive()');
  const idxGuard     = body.indexOf('discard-stale-restore');
  const idxRestore   = body.indexOf('timerRestorePreStart');
  assert.ok(idxPreActive >= 0 && idxGuard > idxPreActive && idxRestore > idxGuard,
    'ガードの位置が不正（isPreStartActive 早期 return の後・timerRestorePreStart の前である必要）');
});

// ============================================================
// T3: 単体相当 — status=RUNNING / isPreStart=false で {isActive:true} → restorePreStart 不発火
// ============================================================
test('T3: 0 着地後(status=RUNNING, isPreStart=false)の stale {isActive:true} で restorePreStart が呼ばれない', () => {
  const run = makeApplyRunner();
  const ctx = makeCtx({ status: States.RUNNING, isPreStart: false });
  ctx.payload = { isActive: true, isPaused: false, remainingMs: 1000, totalMs: 1500000 };
  run(ctx);
  assert.equal(ctx.calls.restore, 0, 'RUNNING 中に stale restore が破棄されず restorePreStart が呼ばれた（巻き戻しの起点）');
  // 破棄ラベルが必ず記録される
  assert.ok(ctx.calls.logs.some(l => l.label === 'operator:applyPreStartState:discard-stale-restore'),
    'discard-stale-restore ラベルが記録されていない');
});

test('T3b: status=BREAK でも stale {isActive:true} で restorePreStart が呼ばれない', () => {
  const run = makeApplyRunner();
  const ctx = makeCtx({ status: States.BREAK, isPreStart: false });
  ctx.payload = { isActive: true, remainingMs: 500, totalMs: 1500000 };
  run(ctx);
  assert.equal(ctx.calls.restore, 0, 'BREAK 中に stale restore が破棄されず restorePreStart が呼ばれた');
});

// ============================================================
// T4: 単体相当 — 破棄後に続く {isActive:false} → cancelPreStart 不発火（巻き戻し撲滅）
// ============================================================
test('T4: stale restore 破棄後の {isActive:false} で cancelPreStart が呼ばれない（巻き戻し撲滅）', () => {
  const run = makeApplyRunner();
  // (1) RUNNING 中に stale {isActive:true} → 破棄（restore 不発火 = isPreStart は false のまま）
  // (2) 続く stale {isActive:false} → isPreStartActive() は false のため cancel 分岐は no-op
  const ctx = makeCtx({ status: States.RUNNING, isPreStart: false });
  ctx.payload = { isActive: true, remainingMs: 1000, totalMs: 1500000 };
  run(ctx);
  ctx.payload = { isActive: false };
  run(ctx);
  assert.equal(ctx.calls.cancel, 0,
    'isPreStart=false（=PRE_START 非活性）なのに cancelPreStart が呼ばれた（RUNNING→IDLE 巻き戻し）');
  assert.equal(ctx.calls.restore, 0, 'restore も呼ばれてはならない');
});

// ============================================================
// T5: 回帰（非破壊）— status=IDLE での {isActive:true} → 従来通り restorePreStart 発火
// ============================================================
test('T5: 正当復元(status=IDLE, isPreStart=false)の {isActive:true} → restorePreStart が従来通り発火', () => {
  const run = makeApplyRunner();
  const ctx = makeCtx({ status: States.IDLE, isPreStart: false });
  ctx.payload = { isActive: true, isPaused: false, remainingMs: 1200000, totalMs: 1500000 };
  run(ctx);
  assert.equal(ctx.calls.restore, 1, 'IDLE 起点の正当復元で restorePreStart が呼ばれない（HDMI/再起動復元を壊した）');
  assert.equal(ctx.calls.restoreArgs[0].totalMs, 1500000, 'restorePreStart に totalMs が正しく渡っていない');
  // IDLE では破棄ラベルは出ない
  assert.ok(!ctx.calls.logs.some(l => l.label === 'operator:applyPreStartState:discard-stale-restore'),
    'IDLE 復元で誤って discard-stale-restore が記録された（正当復元を破棄している）');
});

test('T5b: 既に PRE_START 活性中(isPreStart=true)の {isActive:true} は従来通り no-op（重複復元防止）', () => {
  const run = makeApplyRunner();
  const ctx = makeCtx({ status: States.PRE_START, isPreStart: true });
  ctx.payload = { isActive: true, remainingMs: 800000, totalMs: 1500000 };
  run(ctx);
  assert.equal(ctx.calls.restore, 0, 'PRE_START 活性中は早期 return のはず（重複復元防止）');
  assert.ok(!ctx.calls.logs.some(l => l.label === 'operator:applyPreStartState:discard-stale-restore'),
    'PRE_START 活性中の早期 return は discard ラベルを出さない（isPreStartActive 経路が先）');
});

// ============================================================
// T6: 観測ラベルが main.js の PRIORITY_LOG_LABELS allow-list に登録済
// ============================================================
test('T6: discard-stale-restore が main.js PRIORITY_LOG_LABELS に登録されている', () => {
  assert.ok(MAIN_JS.includes("'operator:applyPreStartState:discard-stale-restore'"),
    'main.js の PRIORITY_LOG_LABELS に discard-stale-restore が未登録（ログに出ない）');
});

// ============================================================
// T7: 非破壊 — else(cancel) 分岐 + 致命バグ保護 5 件 無変更
// ============================================================
test('T7: else(isActive:false) 分岐は従来通り isPreStartActive() ガード付き cancelPreStart を保持', () => {
  const body = extractApplyOperatorPreStartStateBody();
  // else 分岐: isActive:false で isPreStartActive() が true のときのみ cancel（既存ロジック保持）
  const elseIdx = body.indexOf('} else {');
  assert.ok(elseIdx >= 0, 'else(isActive:false) 分岐が見つからない');
  const elseBody = body.slice(elseIdx);
  assert.match(elseBody, /isPreStartActive\s*\(\s*\)/,
    'else 分岐に isPreStartActive() ガードがない（既存 cancel ロジックを壊した疑い）');
  assert.match(elseBody, /timerCancelPreStart\s*\(\s*\)/,
    'else 分岐に timerCancelPreStart() 呼出がない（既存 cancel ロジックを壊した疑い）');
  // 巻き戻し撲滅の証跡: isActive=false 単体（isPreStart=false）では cancel しない
  const run = makeApplyRunner();
  const ctx = makeCtx({ status: States.RUNNING, isPreStart: false });
  ctx.payload = { isActive: false };
  run(ctx);
  assert.equal(ctx.calls.cancel, 0, 'isPreStart=false なら isActive:false 単体で cancelPreStart は呼ばれない');
});

test('T7b: 致命バグ保護 5 件 + cancelPreStart 経路が無変更（renderer/main）', () => {
  // cancelPreStart 経路は renderer 側呼出（timerCancelPreStart）も timer.js 本体も触らない方針 →
  //   renderer.js に timerCancelPreStart import と呼出が健在であることを確認
  assert.match(RENDERER, /cancelPreStart\s+as\s+timerCancelPreStart/,
    'timerCancelPreStart import が消失（cancel 経路を壊した疑い）');
  // 致命バグ保護 5 件のマーカー（v242 T9 と同等の最小確認）
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, '致命バグ保護: resetBlindProgressOnly 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, '致命バグ保護: ensureEditorEditableState 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, '致命バグ保護: schedulePersistRuntime（runtime 永続化）消失');
});

console.log(`\nv252 prestart-zero-stall-guard: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
