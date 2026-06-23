/**
 * v2.6.1（prestart-display-fixes）回帰テスト
 *
 *   ① PRE_START 中の NEXT BREAK IN 誤表示の根治
 *     真因: PRE_START 中は state.remainingMs が「開始までのカウントダウン残り」であり、
 *           renderNextBreak → computeNextBreakMs(remainingMs, idx) の基準（line `let total = remainingMs`）
 *           にカウントダウン残りが混入 → 「カウントダウン残り + 後続 duration」という誤値を表示。
 *           0 着地（startAtLevel(0) が Lv0 満了 duration を投入）で正値へジャンプして見えていた。
 *     修正: renderNextBreak 本体で status===PRE_START 時のみ基準を Lv0 満了 duration に差し替える。
 *
 *   ② 参加人数ダイアログの初期表示を毎回 3 に（前回値/10 を引きずらない・1〜500 clamp 維持）。
 *
 *   検証方式: 実ソースから関数本体を抽出 → new Function で評価し依存をモック注入。
 *             ＝ 再実装ではなく「出荷される実コード」をそのまま実行する単体相当テスト（v252 と同パターン）。
 *
 *   実行: node tests/v268-prestart-display-fixes.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 関数本体をブレース深度カウントで抽出（c16 と同パターン）。対象 3 関数は文字列/コメント内に
// 波括弧を含まないため安全。
function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = source.match(re);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start + 1, i); }
  }
  return null;
}

const States = { IDLE: 0, RUNNING: 1, BREAK: 2, PAUSED: 3, PRE_START: 4 };

// computeNextBreakMs を実ソースから抽出して実行可能化（依存: getStructure）
function makeComputeNextBreakMs() {
  const body = extractFunctionBody(RENDERER, 'computeNextBreakMs');
  assert.ok(body, 'computeNextBreakMs 本体抽出失敗');
  const fn = new Function('remainingMs', 'currentIndex', 'getStructure', body);
  return (remainingMs, currentIndex, getStructure) => fn(remainingMs, currentIndex, getStructure);
}

// renderNextBreak を実ソースから抽出して実行可能化（依存はすべて注入）
function makeRenderNextBreak() {
  const body = extractFunctionBody(RENDERER, 'renderNextBreak');
  assert.ok(body, 'renderNextBreak 本体抽出失敗');
  const fn = new Function(
    'remainingMs', 'currentIndex',
    'getState', 'States', 'getLevel', 'computeNextBreakMs', 'el', 'formatHMS', 'computeTotalGameTimeMs',
    body
  );
  return (remainingMs, currentIndex, ctx) => {
    fn(remainingMs, currentIndex, ctx.getState, States, ctx.getLevel, ctx.computeNextBreakMs,
       ctx.el, ctx.formatHMS, ctx.computeTotalGameTimeMs);
  };
}

function makeEl() {
  return { nextBreakLabel: { textContent: '' }, nextBreak: { textContent: '' } };
}

// ============================================================
// ① 核 — PRE_START 中は基準が Lv0 満了 duration（remainingMs 非依存）
// ============================================================
test('T1: PRE_START 中、computeNextBreakMs に渡る基準が Lv0 満了 duration（カウントダウン残りでない）', () => {
  const run = makeRenderNextBreak();
  let captured = null;
  const ctx = {
    getState: () => ({ status: States.PRE_START }),
    getLevel: (i) => (i === 0 ? { durationMinutes: 20 } : null),
    computeNextBreakMs: (base) => { captured = base; return 999; }, // 非 null で NEXT BREAK 分岐
    el: makeEl(),
    formatHMS: (ms) => String(ms),
    computeTotalGameTimeMs: () => 0
  };
  run(180000, 0, ctx);   // remainingMs=3 分（カウントダウン残り）
  assert.equal(captured, 20 * 60 * 1000,
    `PRE_START 中の基準が Lv0 満了 duration でない（実際: ${captured} / 期待: 1200000）`);
  assert.notEqual(captured, 180000, 'カウントダウン残り 180000 がそのまま基準に混入している（未修正の症状）');
});

// ============================================================
// ① 非破壊 — RUNNING 中は remainingMs をそのまま基準に渡す（差し替えは PRE_START 限定）
//   review 追加指示 1
// ============================================================
test('T2: RUNNING 中は remainingMs をそのまま基準に渡す（基準差し替えが起きない＝非破壊）', () => {
  const run = makeRenderNextBreak();
  let captured = null;
  const ctx = {
    getState: () => ({ status: States.RUNNING }),
    getLevel: () => { throw new Error('RUNNING 中に getLevel を呼んではならない（PRE_START 限定のはず）'); },
    computeNextBreakMs: (base) => { captured = base; return 999; },
    el: makeEl(),
    formatHMS: (ms) => String(ms),
    computeTotalGameTimeMs: () => 0
  };
  run(540000, 0, ctx);
  assert.equal(captured, 540000, `RUNNING 中の基準が remainingMs でない（差し替えが PRE_START 外に漏れている）`);
});

// ============================================================
// ① 連続性 — PRE_START 表示値 == 実スタート直後（RUNNING・remainingMs=Lv0 dur）の表示値
//   実 computeNextBreakMs を renderNextBreak に結線して検証
// ============================================================
test('T3: PRE_START の NEXT BREAK 表示値が実スタート直後の値と一致（0 着地ジャンプ撲滅）', () => {
  const run = makeRenderNextBreak();
  const computeNextBreakMs = makeComputeNextBreakMs();
  // Lv0(20分) / Lv1(20分) / break(index2)
  const structure = { levels: [
    { durationMinutes: 20, isBreak: false },
    { durationMinutes: 20, isBreak: false },
    { durationMinutes: 0,  isBreak: true  }
  ] };
  const getStructure = () => structure;
  const getLevel = (i) => structure.levels[i] || null;
  const formatHMS = (ms) => String(ms);

  // PRE_START 中（remainingMs=3 分のカウントダウン残り）
  const elPre = makeEl();
  run(180000, 0, {
    getState: () => ({ status: States.PRE_START }),
    getLevel,
    computeNextBreakMs: (base, idx) => computeNextBreakMs(base, idx, getStructure),
    el: elPre, formatHMS, computeTotalGameTimeMs: () => 0
  });

  // 実スタート直後（RUNNING・remainingMs=Lv0 満了 duration=20 分）
  const elRun = makeEl();
  run(20 * 60 * 1000, 0, {
    getState: () => ({ status: States.RUNNING }),
    getLevel,
    computeNextBreakMs: (base, idx) => computeNextBreakMs(base, idx, getStructure),
    el: elRun, formatHMS, computeTotalGameTimeMs: () => 0
  });

  assert.equal(elPre.nextBreak.textContent, elRun.nextBreak.textContent,
    `PRE_START 表示値(${elPre.nextBreak.textContent}) と実スタート直後(${elRun.nextBreak.textContent}) が不一致（連続していない）`);
  assert.equal(elPre.nextBreakLabel.textContent, 'NEXT BREAK IN', 'PRE_START 中のラベルが NEXT BREAK IN でない');
  // 期待値の絶対チェック: Lv0(20) + Lv1(20) = 40 分
  assert.equal(elPre.nextBreak.textContent, String(40 * 60 * 1000), 'PRE_START 表示値が 40 分でない');
});

// ============================================================
// ① 残ブレイク無し構成のラベル整合 — PRE_START 中は TOTAL GAME TIME / 値 0
// ============================================================
test('T4: 残ブレイク無し構成、PRE_START 中は TOTAL GAME TIME ラベル + 値 0（整合）', () => {
  const run = makeRenderNextBreak();
  const computeNextBreakMs = makeComputeNextBreakMs();
  const structure = { levels: [
    { durationMinutes: 20, isBreak: false },
    { durationMinutes: 20, isBreak: false }
  ] };
  const getStructure = () => structure;
  const el = makeEl();
  run(180000, 0, {
    getState: () => ({ status: States.PRE_START }),
    getLevel: (i) => structure.levels[i] || null,
    computeNextBreakMs: (base, idx) => computeNextBreakMs(base, idx, getStructure),
    el, formatHMS: (ms) => String(ms),
    computeTotalGameTimeMs: () => 0   // 実関数も IDLE/PRE_START で 0
  });
  assert.equal(el.nextBreakLabel.textContent, 'TOTAL GAME TIME', '残ブレイク無しで TOTAL GAME TIME に切替わらない');
  assert.equal(el.nextBreak.textContent, String(0), 'PRE_START 中の TOTAL GAME TIME が 0 でない');
});

// ============================================================
// ① null ガード — getLevel が null（structure 未ロード等）でも例外を投げず remainingMs にフォールバック
//   review 追加指示 2
// ============================================================
test('T5: PRE_START でも getLevel が null なら remainingMs フォールバック（例外を投げない）', () => {
  const run = makeRenderNextBreak();
  let captured = null;
  assert.doesNotThrow(() => {
    run(180000, 0, {
      getState: () => ({ status: States.PRE_START }),
      getLevel: () => null,
      computeNextBreakMs: (base) => { captured = base; return 999; },
      el: makeEl(), formatHMS: (ms) => String(ms), computeTotalGameTimeMs: () => 0
    });
  }, 'getLevel===null で例外を投げた（null ガード不足）');
  assert.equal(captured, 180000, 'getLevel===null 時に remainingMs フォールバックされていない');
});

// ============================================================
// ① 静的 — renderNextBreak に PRE_START 基準差し替えロジックが存在
// ============================================================
test('T6: renderNextBreak に status===PRE_START の基準差し替えロジックが存在', () => {
  const body = extractFunctionBody(RENDERER, 'renderNextBreak');
  assert.ok(body, 'renderNextBreak 本体抽出失敗');
  assert.match(body, /getState\s*\(\s*\)\s*\.status\s*===\s*States\.PRE_START/, 'PRE_START 判定がない');
  assert.match(body, /getLevel\s*\(\s*currentIndex\s*\)/, 'getLevel(currentIndex) 参照がない');
  assert.match(body, /durationMinutes\s*\*\s*60\s*\*\s*1000/, 'Lv0 満了 duration 算出がない');
});

// ============================================================
// ② openPreStartDialog の初期値が毎回 3（前回値/10 を引きずらない）
// ============================================================
test('T7: openPreStartDialog が参加人数を毎回 3 に設定し、前回値/10 参照を持たない', () => {
  const body = extractFunctionBody(RENDERER, 'openPreStartDialog');
  assert.ok(body, 'openPreStartDialog 本体抽出失敗');
  assert.match(body, /el\.prestartPlayers\.value\s*=\s*['"]3['"]/, "value = '3' 固定代入がない");
  assert.doesNotMatch(body, /prev\s*>\s*0/, '前回値参照（prev > 0）が残っている');
  assert.doesNotMatch(body, /['"]10['"]/, "初期値 '10' リテラルが残っている");
});

// ============================================================
// ② index.html の参加人数 input が value="3"
// ============================================================
test('T8: index.html の js-prestart-players input が value="3"', () => {
  assert.match(HTML, /<input[^>]*id=["']js-prestart-players["'][^>]*value=["']3["']/,
    'js-prestart-players input が value="3" でない');
  assert.doesNotMatch(HTML, /<input[^>]*id=["']js-prestart-players["'][^>]*value=["']10["']/,
    'js-prestart-players input に value="10" が残っている');
});

// ============================================================
// ② readPreStartPlayers の 1〜500 clamp が維持
// ============================================================
test('T9: readPreStartPlayers の 1〜500 clamp が無変更で維持', () => {
  const body = extractFunctionBody(RENDERER, 'readPreStartPlayers');
  assert.ok(body, 'readPreStartPlayers 本体抽出失敗');
  assert.match(body, /Math\.max\s*\(\s*1\s*,\s*Math\.min\s*\(\s*500/, '1〜500 clamp が見当たらない');
});

// ============================================================
// 致命バグ保護 5 件マーカー健在（本修正は表示/ダイアログ初期値のみで非接触）
// ============================================================
test('T10: 致命バグ保護 5 件のマーカーが renderer に健在（非接触の確認）', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, '致命バグ保護: resetBlindProgressOnly 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, '致命バグ保護: ensureEditorEditableState 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, '致命バグ保護: schedulePersistRuntime（runtime 永続化）消失');
  // ② は runtime 永続化経路に非接触: initTournamentRuntime は無変更で健在
  assert.match(RENDERER, /function\s+initTournamentRuntime\s*\(/, 'initTournamentRuntime 消失（②が runtime 経路を壊した疑い）');
});

console.log(`\nv268 prestart-display-fixes: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
