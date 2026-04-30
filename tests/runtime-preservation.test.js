/**
 * STEP 10 フェーズC.2.7-A Fix 1 — 致命バグ 8-8 の回帰防止テスト
 *
 * 「PAUSED 中に『保存して適用』しても tournamentRuntime（プレイヤー数・リエントリー・アドオン）
 *  が消えない」を不変条件として担保する。
 *
 * renderer.js は DOM / window.api 依存のため動作テストは困難。
 * 代わりに「ソース文字列レベルで、適用系の関数が tournamentRuntime をクリアする経路を
 * 取らないこと」を静的に検証する。
 *
 * 実行: node tests/runtime-preservation.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'),
  'utf8'
);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ヘルパ: 関数本体（function FOO( ... ) { ... } の中身）を抽出
function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = source.match(re);
  if (!m) throw new Error(`function ${name} が見つからない`);
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return source.slice(m.index, i);
}

// 行コメント / ブロックコメントを除去（関数呼び出しの実体だけ残す）
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

// ============================================================
// T1: resetBlindProgressOnly が定義されている（責任分離が実装済）
// ============================================================
test('T1: resetBlindProgressOnly が定義されている', () => {
  assert.match(
    RENDERER,
    /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly 関数が renderer.js に定義されていない'
  );
});

// ============================================================
// T2: resetBlindProgressOnly は resetTournamentRuntime を呼ばない
// ============================================================
test('T2: resetBlindProgressOnly は resetTournamentRuntime を呼ばない', () => {
  const body = extractFunctionBody(RENDERER, 'resetBlindProgressOnly');
  assert.doesNotMatch(
    body,
    /resetTournamentRuntime\s*\(/,
    'resetBlindProgressOnly 内で resetTournamentRuntime が呼ばれている（runtime が消える）'
  );
});

// ============================================================
// T3: handleReset は引き続き resetTournamentRuntime を呼ぶ
//     （明示的「タイマーリセット」ボタン経由用、挙動維持）
// ============================================================
test('T3: handleReset は resetTournamentRuntime を呼ぶ（明示リセット用）', () => {
  const body = extractFunctionBody(RENDERER, 'handleReset');
  assert.match(
    body,
    /resetTournamentRuntime\s*\(/,
    'handleReset 内で resetTournamentRuntime が呼ばれていない（明示リセット時に runtime が残る）'
  );
});

// ============================================================
// T4: doApplyTournament（保存して適用）の reset 分岐は
//     resetBlindProgressOnly を使い、handleReset は使わない
// ============================================================
test('T4: doApplyTournament reset 分岐が resetBlindProgressOnly を使う', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'doApplyTournament'));
  assert.match(
    body,
    /resetBlindProgressOnly\s*\(/,
    'doApplyTournament 内で resetBlindProgressOnly が呼ばれていない'
  );
  assert.doesNotMatch(
    body,
    /\bhandleReset\s*\(/,
    'doApplyTournament 内で handleReset が呼ばれている（致命バグ 8-8 の経路）'
  );
});

// ============================================================
// T5: handlePresetApply の reset 分岐は resetBlindProgressOnly を使う
// ============================================================
test('T5: handlePresetApply の reset 経路が resetBlindProgressOnly を使う', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handlePresetApply'));
  assert.match(
    body,
    /resetBlindProgressOnly\s*\(/,
    'handlePresetApply の reset 分岐で resetBlindProgressOnly が呼ばれていない'
  );
  assert.doesNotMatch(
    body,
    /\bhandleReset\s*\(/,
    'handlePresetApply 内で handleReset が呼ばれている（致命バグ 8-8 の経路）'
  );
});

// ============================================================
// T6: 明示的なタイマーリセット経路（resetOk クリック）は handleReset を維持
// ============================================================
test('T6: タイマーリセットダイアログの確定は handleReset を呼ぶ', () => {
  // openResetDialog 内 / resetOk click ハンドラ内のいずれかで handleReset() が残っている
  assert.match(
    RENDERER,
    /el\.resetOk\.addEventListener[\s\S]{0,300}handleReset\s*\(/,
    'タイマーリセット OK ハンドラで handleReset が呼ばれていない'
  );
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
