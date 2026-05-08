/**
 * v2.1.7 静的解析 + 動的シミュレーション — hall 側 atomic update 機構（B 系構造的根治）
 *
 *   Fix 1: src/renderer/dual-sync.js に _diffBuffer / _flushTimer / _bufferDiff /
 *          _flushDiffBuffer を新設、subscribeStateSync callback を _bufferDiff に切替
 *   Fix 2: edge case ガード（再入防止 / cleanup / try-catch / 上限暴走防止）
 *
 * 解決する B 系バグ群: B1 PAUSED race / B2 トーナメント切替 / B4 runtime race / B7 ⑤⑥②
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 *
 * 実行: node tests/v219-hall-atomic-update.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 関数本体を balanced-brace で抽出
function extractFnBody(source, signatureRe) {
  const m = source.match(signatureRe);
  if (!m) return null;
  const open = m.index + m[0].length - 1;  // '{' 位置
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

// ============================================================
// 動的シミュレーション環境構築:
//   dual-sync.js は ES module + DOM API（window）を使うため、Node の vm.Context で
//   buffer 関連のブロック（DIFF_BUFFER_MAX 〜 cleanup ブロック）を抜き出して評価する。
//   テストの目的は「buffer / flush / dedup / 上限 / cleanup」の挙動検証であり、
//   _applyDiffToState は spy で置換える（実 apply は不要）。
// ============================================================
function buildBufferSandbox(applySpy) {
  // 抽出範囲: DIFF_BUFFER_MAX 定義 〜 hall 起動時の初期同期コメント直前
  const start = DUAL_SYNC.indexOf('const DIFF_BUFFER_MAX');
  assert.ok(start >= 0, 'DIFF_BUFFER_MAX 定義が見つからない');
  const end = DUAL_SYNC.indexOf('// hall 起動時の初期同期', start);
  assert.ok(end > start, 'cleanup ブロック終端マーカーが見つからない');
  // vm.runInContext のレキシカル const/let は ctx プロパティに公開されないため、
  // 検査用にトップレベル宣言だけ var に変換（関数宣言は元々グローバルプロパティ化される）
  const code = DUAL_SYNC.slice(start, end)
    .replace(/^const (DIFF_BUFFER_MAX|_diffBuffer)\b/gm, 'var $1')
    .replace(/^let (_flushTimer|_isFlushing)\b/gm, 'var $1');

  // sandbox: window モック + console + setTimeout/clearTimeout/requestAnimationFrame/cancelAnimationFrame
  // v2.1.9: dual-sync.js は flush 予約に requestAnimationFrame を使うため stub を提供。
  //   Node 環境には rAF が無いので setTimeout(cb, 0) で代替し、既存の
  //   await new Promise(r => setTimeout(r, 10)) パターンで flush タイミングを再現する。
  const ctx = {
    console: { warn: () => {}, log: () => {} },
    setTimeout, clearTimeout,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    _applyDiffToState: applySpy,
    window: {
      api: { log: { write: () => {} } },
      _listeners: {},
      addEventListener(name, cb, _opts) { this._listeners[name] = cb; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

// ============================================================
// T1: _diffBuffer が空時、新 diff 到着で requestAnimationFrame が登録される
// （v2.1.9: setTimeout(0) → requestAnimationFrame に変更）
// ============================================================
test('T1 (Fix 1): _diffBuffer 空時、_bufferDiff で _flushTimer が登録される', () => {
  const ctx = buildBufferSandbox(() => {});
  // 静的: _flushTimer === null チェック + requestAnimationFrame で flush 予約が存在
  assert.match(DUAL_SYNC, /if\s*\(\s*_flushTimer\s*===\s*null\s*\)\s*\{[\s\S]*?_flushTimer\s*=\s*requestAnimationFrame\(/,
    '_flushTimer === null guard + requestAnimationFrame による flush 予約が存在しない');
  // 動的: 1 回 push して _flushTimer が non-null になる
  assert.equal(ctx._flushTimer, null, '初期状態で _flushTimer が null でない');
  ctx._bufferDiff({ kind: 'timerState', value: { status: 'running' } });
  assert.notEqual(ctx._flushTimer, null, '1 件 push 後に _flushTimer が登録されていない');
  assert.equal(ctx._diffBuffer.length, 1, '_diffBuffer に 1 件 push されていない');
});

// ============================================================
// T2: _flushTimer 登録済時、追加 diff は buffer に積まれるだけで新タイマー登録なし
// ============================================================
test('T2 (Fix 1): _flushTimer 登録済時、追加 diff で新タイマー登録されない', () => {
  const ctx = buildBufferSandbox(() => {});
  ctx._bufferDiff({ kind: 'timerState', value: { status: 'running' } });
  const firstTimer = ctx._flushTimer;
  ctx._bufferDiff({ kind: 'tournamentRuntime', value: { playersInitial: 9 } });
  ctx._bufferDiff({ kind: 'displaySettings', value: { background: 'red' } });
  assert.equal(ctx._flushTimer, firstTimer,
    '追加 push で _flushTimer が再登録されている（同一タイマー継続が期待値）');
  assert.equal(ctx._diffBuffer.length, 3, '_diffBuffer に 3 件積まれていない');
});

// ============================================================
// T3: 異なる kind が 5 件 buffer された後の flush で受信順を保持して apply される
// ============================================================
test('T3 (Fix 1): 異なる kind 5 件、flush 後に受信順で apply', async () => {
  const applied = [];
  const ctx = buildBufferSandbox((diff) => applied.push(diff.kind));
  ctx._bufferDiff({ kind: 'timerState',         value: 1 });
  ctx._bufferDiff({ kind: 'tournamentRuntime',  value: 2 });
  ctx._bufferDiff({ kind: 'displaySettings',    value: 3 });
  ctx._bufferDiff({ kind: 'marqueeSettings',    value: 4 });
  ctx._bufferDiff({ kind: 'logoUrl',            value: 5 });
  // setTimeout(0) macrotask が走るのを待つ
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(applied,
    ['timerState', 'tournamentRuntime', 'displaySettings', 'marqueeSettings', 'logoUrl'],
    'flush 後の apply 順序が受信順と一致しない');
  assert.equal(ctx._diffBuffer.length, 0, 'flush 後に _diffBuffer が空でない');
  assert.equal(ctx._flushTimer, null, 'flush 後に _flushTimer が null でない');
});

// ============================================================
// T4: 同一 kind 3 件 buffer の場合、最後の値だけ apply される（dedup）
// ============================================================
test('T4 (Fix 1): 同一 kind 3 件、最後の値のみ apply（dedup）', async () => {
  const applied = [];
  const ctx = buildBufferSandbox((diff) => applied.push(diff));
  ctx._bufferDiff({ kind: 'tournamentRuntime', value: { playersInitial: 9, _seq: 1 } });
  ctx._bufferDiff({ kind: 'tournamentRuntime', value: { playersInitial: 8, _seq: 2 } });
  ctx._bufferDiff({ kind: 'tournamentRuntime', value: { playersInitial: 7, _seq: 3 } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(applied.length, 1, '同一 kind 3 件で apply 回数が 1 でない（dedup 失敗）');
  assert.equal(applied[0].value._seq, 3, '最後の値（_seq:3）が apply されていない');
});

// ============================================================
// T5: flush 中に例外発生しても、他の diff の apply が継続される
// ============================================================
test('T5 (Fix 2): apply 中の例外は握り潰され、他 diff は継続', async () => {
  const applied = [];
  const ctx = buildBufferSandbox((diff) => {
    if (diff.kind === 'displaySettings') throw new Error('intentional throw');
    applied.push(diff.kind);
  });
  ctx._bufferDiff({ kind: 'timerState',        value: 1 });
  ctx._bufferDiff({ kind: 'displaySettings',   value: 2 });  // throw
  ctx._bufferDiff({ kind: 'logoUrl',           value: 3 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(applied, ['timerState', 'logoUrl'],
    '例外発生 kind 以外の apply が継続していない');
});

// ============================================================
// T6: hall window 破棄時に _flushTimer がクリアされる
// ============================================================
test('T6 (Fix 2): beforeunload で _flushTimer + _diffBuffer がクリアされる', () => {
  const ctx = buildBufferSandbox(() => {});
  ctx._bufferDiff({ kind: 'timerState', value: 1 });
  ctx._bufferDiff({ kind: 'logoUrl',    value: 2 });
  assert.equal(ctx._diffBuffer.length, 2, 'buffer に 2 件積まれていない');
  assert.notEqual(ctx._flushTimer, null, '_flushTimer が登録されていない');
  // beforeunload を発火
  const handler = ctx.window._listeners['beforeunload'];
  assert.ok(typeof handler === 'function', 'beforeunload listener が登録されていない');
  handler();
  assert.equal(ctx._flushTimer, null, 'beforeunload で _flushTimer がクリアされていない');
  assert.equal(ctx._diffBuffer.length, 0, 'beforeunload で _diffBuffer がクリアされていない');

  // 静的検証: cancelAnimationFrame 呼出 + 配列 length=0 リセットが存在
  // v2.1.9: clearTimeout → cancelAnimationFrame に変更
  assert.match(DUAL_SYNC,
    /window\.addEventListener\(\s*['"]beforeunload['"][\s\S]*?cancelAnimationFrame\s*\(\s*_flushTimer\s*\)[\s\S]*?_diffBuffer\.length\s*=\s*0/,
    'beforeunload で cancelAnimationFrame(_flushTimer) + _diffBuffer.length=0 のリセットが見つからない');
});

// ============================================================
// T7: operator 側では buffer 機構を通らない（subscribeStateSync は hall guard 内のみ）
// ============================================================
test('T7 (Fix 1): operator 側では buffer 機構を通らない', () => {
  // initDualSyncForHall 内で hall ガード後に subscribeStateSync が登録される
  const body = extractFnBody(DUAL_SYNC, /export\s+async\s+function\s+initDualSyncForHall\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'initDualSyncForHall 関数本体が抽出できない');
  // hall ガード（appRole !== 'hall' 早期 return）が冒頭にあること
  assert.match(body, /window\.appRole\s*!==\s*['"]hall['"][\s\S]*?return/,
    'initDualSyncForHall に appRole !== "hall" 早期 return ガードがない');
  // subscribeStateSync が body 内（= hall ガード後）にあること、かつ _bufferDiff 経由
  assert.match(body, /dual\.subscribeStateSync\s*\(\s*\(diff\)\s*=>\s*_bufferDiff\(diff\)\s*\)/,
    'subscribeStateSync 登録が _bufferDiff 経由でない、または body 外にある');

  // renderer.js: registerDualDiffHandler の呼出が hall ブロック内のみであること
  // （operator ブロックには registerDualDiffHandler / initDualSyncForHall が無い）
  const operatorBranch = RENDERER.match(/else\s+if\s*\(\s*__appRole\s*===\s*['"]operator['"][\s\S]{0,2000}/);
  assert.ok(operatorBranch, 'operator ブランチが見つからない');
  assert.doesNotMatch(operatorBranch[0], /registerDualDiffHandler\s*\(/,
    'operator ブランチに registerDualDiffHandler が混入');
  assert.doesNotMatch(operatorBranch[0], /initDualSyncForHall\s*\(/,
    'operator ブランチに initDualSyncForHall が混入');
});

// ============================================================
// T8: preStartState diff も buffer 経路を通る（v2.1.6 機構と両立）
// ============================================================
test('T8 (Fix 1): preStartState diff も buffer 経路を通る', async () => {
  const applied = [];
  const ctx = buildBufferSandbox((diff) => applied.push(diff));
  // edge イベント（即時）+ rAF tick（1秒間引き）の両方が buffer を通ることを検証
  ctx._bufferDiff({ kind: 'preStartState', value: { isActive: true,  totalMs: 60000, remainingMs: 60000, _src: 'start' } });
  ctx._bufferDiff({ kind: 'preStartState', value: { isActive: true,  totalMs: 60000, remainingMs: 59000, _src: 'tick1' } });
  ctx._bufferDiff({ kind: 'preStartState', value: { isActive: true,  totalMs: 60000, remainingMs: 58000, _src: 'tick2' } });
  // v2.1.9: rAF stub は setTimeout(cb, 0) なので 10ms 待機で発火する
  await new Promise((resolve) => setTimeout(resolve, 10));
  // 同一 kind dedup により最後の tick2 だけ apply される
  assert.equal(applied.length, 1, 'preStartState 3 件の dedup が機能していない');
  assert.equal(applied[0].value._src, 'tick2', 'preStartState の最後の値が apply されていない');
  // 静的: subscribeStateSync で受け取る diff が buffer に渡されること（kind 制限なし）
  assert.match(DUAL_SYNC,
    /dual\.subscribeStateSync\s*\(\s*\(diff\)\s*=>\s*_bufferDiff\(diff\)\s*\)/,
    'subscribeStateSync callback が _bufferDiff に切替えられていない');
});

// ============================================================
// T9: buffer サイズ上限（100 件）超過時の挙動（警告ログ + 古い順破棄）
// ============================================================
test('T9 (Fix 2): _diffBuffer 上限 100 件超過、古い順破棄 + 警告', async () => {
  const applied = [];
  const ctx = buildBufferSandbox((diff) => applied.push(diff));
  // console.warn を spy
  let warnCount = 0;
  ctx.console.warn = () => { warnCount++; };
  // log.write を spy
  let overflowLogCount = 0;
  ctx.window.api.log.write = (label) => {
    if (label === 'dual-sync:buffer:overflow') overflowLogCount++;
  };

  // 100 件 push（最大値）
  for (let i = 0; i < 100; i++) {
    ctx._bufferDiff({ kind: 'k' + i, value: i });
  }
  assert.equal(ctx._diffBuffer.length, 100, '100 件 push 後の buffer 長が 100 でない');
  assert.equal(warnCount, 0, '上限到達前に warn が発火している');

  // 101 件目 push → 古い順破棄 + warn + log
  ctx._bufferDiff({ kind: 'overflowed', value: 999 });
  assert.equal(ctx._diffBuffer.length, 100, '上限超過後も buffer 長が 100 維持されていない');
  assert.equal(warnCount, 1, '上限超過時に console.warn が発火していない');
  assert.equal(overflowLogCount, 1, '上限超過時に rolling log が発火していない');

  // 静的: DIFF_BUFFER_MAX = 100 + length >= MAX チェック + shift() + console.warn が存在
  assert.match(DUAL_SYNC, /const\s+DIFF_BUFFER_MAX\s*=\s*100/, 'DIFF_BUFFER_MAX = 100 が定義されていない');
  assert.match(DUAL_SYNC, /_diffBuffer\.length\s*>=\s*DIFF_BUFFER_MAX/, '_diffBuffer.length >= DIFF_BUFFER_MAX 判定が見つからない');
  assert.match(DUAL_SYNC, /_diffBuffer\.shift\(\s*\)/, '_diffBuffer.shift() による古い順破棄が見つからない');
  assert.match(DUAL_SYNC, /console\.warn\([^)]*_diffBuffer[^)]*上限/, '上限到達時の console.warn が見つからない');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
