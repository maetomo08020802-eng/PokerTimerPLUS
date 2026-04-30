/**
 * STEP 10 フェーズC.2.7-D — Fix 1 (UI) + Fix 3 (A2 race) の回帰防止テスト
 *
 * 修正項目:
 *   Fix 1: 4 桁以下の数値で justify-content: space-around に切替
 *          5 桁以上は既存 space-between 維持
 *   Fix 3: persistActiveTournamentBlindPresetId が save payload から timerState を除外
 *          getActive→save の間に走る setTimerState による timerState 上書きを防ぐ
 *
 * Fix 2/4/5 は実コードで再現せず（CC_REPORT 参照）、本テストでは扱わない。
 *
 * 実行: node tests/race-fixes.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

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

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

// ============================================================
// T1（Fix 1 CSS）: data-max-digits 1-4 で space-around、5 以上は既存 space-between 維持
// ============================================================
test('T1: 4 桁以下 (data-max-digits=1〜4) で justify-content: space-around', () => {
  // CSS ルールに space-around 追加が含まれる
  assert.match(
    STYLE,
    /\.blinds-content\[data-max-digits=["']1["']\][\s\S]+?\.blinds-content\[data-max-digits=["']4["']\][\s\S]+?\}/,
    '4 桁以下のセレクタブロックが見つからない'
  );
  // 該当ブロック内に space-around
  const block = STYLE.match(/\.blinds-content:not\(\[data-max-digits\]\)[\s\S]+?\.blinds-content\[data-max-digits=["']4["']\][\s\S]*?\{[^}]*\}/);
  assert.ok(block, '4 桁以下 + 属性なしのブロックが見つからない');
  assert.match(block[0], /justify-content\s*:\s*space-around/, 'space-around が指定されていない');
});

// ============================================================
// T2（Fix 1 CSS）: data-max-digits=5 以上では既存 space-between が残っている
// ============================================================
test('T2: 既存の .blinds-content { ... space-between } ルールが維持されている', () => {
  // .blinds-content の基本 rule（属性なし指定）に space-between が残っている
  const baseBlock = STYLE.match(/\.blinds-content\s*\{[^}]*\}/);
  assert.ok(baseBlock, '.blinds-content の基本ルールが見つからない');
  assert.match(baseBlock[0], /justify-content\s*:\s*space-between/, '基本ルールから space-between が消えている');
});

// ============================================================
// T3（Fix 3）: persistActiveTournamentBlindPresetId が timerState を除外する
// ============================================================
test('T3: persistActiveTournamentBlindPresetId が save payload から timerState を除外', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'persistActiveTournamentBlindPresetId'));
  // const { timerState, ...rest } = active; のような destructure で除外
  assert.match(
    body,
    /\{\s*timerState[^}]*\.\.\.[A-Za-z_]+\s*\}\s*=\s*active/,
    'active から timerState を destructure 除外していない'
  );
  // save に渡す updated に timerState が含まれない（rest spread のみ + blindPresetId）
  assert.match(
    body,
    /\{\s*\.\.\.[A-Za-z_]+\s*,\s*blindPresetId\s*:/,
    'rest spread + blindPresetId で updated を構築していない'
  );
  // save 呼び出しが残っている
  assert.match(body, /window\.api\.tournaments\.save\(/, 'save 呼び出しが消えている');
});

// ============================================================
// T4（Fix 3）: 既存の id 一致ガードと API 不在チェックは維持
// ============================================================
test('T4: persistActive の active.id !== tournamentState.id ガードが維持されている', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'persistActiveTournamentBlindPresetId'));
  assert.match(body, /active\.id\s*!==\s*tournamentState\.id/, 'id 不一致時の return ガードが消えている');
  assert.match(body, /window\.api\.tournaments\.getActive\(\)/, 'getActive 呼び出しが消えている');
});

// ============================================================
// T5（Fix 3 関連）: _savePresetCore は引き続き persistActiveTournamentBlindPresetId を呼ぶ
// ============================================================
test('T5: _savePresetCore が persistActiveTournamentBlindPresetId を呼び出す', () => {
  const body = stripComments(extractFunctionBody(RENDERER, '_savePresetCore'));
  assert.match(body, /persistActiveTournamentBlindPresetId\(/, '_savePresetCore からの呼び出しが消えている');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
