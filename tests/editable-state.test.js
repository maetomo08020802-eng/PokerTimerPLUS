/**
 * STEP 10 フェーズC.1-A2 — 「複製して編集」後の readonly 残存バグ修正の回帰防止テスト
 *
 * 修正:
 *   1. ensureEditorEditableState ヘルパ新設 — readOnly/disabled/is-readonly/data-builtin を一括リセット
 *   2. handlePresetDuplicate / handlePresetNew で ensureEditorEditableState を呼び出し
 *      （render→update→ensure の 3 段階で確実に編集可能化、RAF 内でも再保証）
 *   3. setBlindsTableReadonly に readonly 属性の明示クリア追加（防御的、CSS [readonly] との整合）
 *
 * 実行: node tests/editable-state.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

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
// T1: ensureEditorEditableState ヘルパが定義されている
// ============================================================
test('T1: ensureEditorEditableState ヘルパ関数が定義されている', () => {
  assert.match(
    RENDERER,
    /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState が renderer.js に定義されていない'
  );
});

// ============================================================
// T2: ensureEditorEditableState が presetName と setBlindsTableReadonly(false) を一括処理
// ============================================================
test('T2: ensureEditorEditableState が presetName + table readonly を一括リセット', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'ensureEditorEditableState'));
  assert.match(body, /presetName\.readOnly\s*=\s*false/, 'presetName.readOnly=false 設定が含まれていない');
  assert.match(body, /presetName\.disabled\s*=\s*false/, 'presetName.disabled=false 設定が含まれていない');
  assert.match(body, /presetName\.classList\.remove\(['"]is-readonly['"]/, 'is-readonly クラス削除が含まれていない');
  assert.match(body, /setBlindsTableReadonly\(false\)/, 'setBlindsTableReadonly(false) 呼出が含まれていない');
});

// ============================================================
// T3: handlePresetDuplicate のクリックハンドラ内で ensureEditorEditableState 呼出
// ============================================================
test('T3: 「複製して編集」ハンドラで ensureEditorEditableState を呼ぶ（RAF 内でも再保証）', () => {
  // presetDuplicate?.addEventListener('click', async () => { ... }) の本体を抽出
  const start = RENDERER.indexOf("el.presetDuplicate?.addEventListener('click'");
  assert.ok(start >= 0, 'presetDuplicate のクリックハンドラが見つからない');
  // 直後 2000 文字内で 2 回以上 ensureEditorEditableState が呼ばれていること（updatePresetActions 直後 + RAF 内）
  const slice = RENDERER.slice(start, start + 2000);
  const matches = slice.match(/ensureEditorEditableState\s*\(/g) || [];
  assert.ok(matches.length >= 2, `ensureEditorEditableState が複製ハンドラ内で 2 回以上呼ばれていない（${matches.length} 回検出）`);
});

// ============================================================
// T4: handlePresetNew のクリックハンドラ内で ensureEditorEditableState 呼出
// ============================================================
test('T4: 「新規作成」ハンドラで ensureEditorEditableState を呼ぶ（RAF 内でも再保証）', () => {
  const start = RENDERER.indexOf("el.presetNew?.addEventListener('click'");
  assert.ok(start >= 0, 'presetNew のクリックハンドラが見つからない');
  const slice = RENDERER.slice(start, start + 2000);
  const matches = slice.match(/ensureEditorEditableState\s*\(/g) || [];
  assert.ok(matches.length >= 2, `ensureEditorEditableState が新規ハンドラ内で 2 回以上呼ばれていない（${matches.length} 回検出）`);
});

// ============================================================
// T5: setBlindsTableReadonly(false) で readonly 属性も明示クリア
// ============================================================
test('T5: setBlindsTableReadonly が readonly=false 経路で readonly 属性を明示クリア', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'setBlindsTableReadonly'));
  // readonly=false 分岐内で removeAttribute('readonly') が呼ばれている
  assert.match(body, /removeAttribute\(['"]readonly['"]\)/, "removeAttribute('readonly') が含まれていない（防御的クリア）");
});

// ============================================================
// T6: 既存挙動維持 — builtin 選択時は引き続き全 disabled
// ============================================================
test('T6: setBlindsTableReadonly(true) 経路で disabled + aria-disabled + readonly を一括付与', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'setBlindsTableReadonly'));
  // readonly=true 分岐の確認
  const trueBranch = body.match(/if\s*\(\s*readonly\s*\)\s*\{[\s\S]+?return;\s*\}/);
  assert.ok(trueBranch, 'readonly=true 分岐が見つからない');
  assert.match(trueBranch[0], /node\.disabled\s*=\s*true/, 'disabled=true 設定が消えている');
  assert.match(trueBranch[0], /aria-disabled/, 'aria-disabled 付与が消えている');
});

// ============================================================
// T7: 既存挙動維持 — handlePresetApply の reset 分岐は resetBlindProgressOnly を維持
// ============================================================
test('T7: handlePresetApply は引き続き resetBlindProgressOnly を呼ぶ（C.2.7-A 致命バグ修正の保護）', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handlePresetApply'));
  assert.match(body, /resetBlindProgressOnly\(/, 'resetBlindProgressOnly が消えている');
  assert.doesNotMatch(body, /\bhandleReset\(/, 'handleReset が誤って呼ばれている（C.2.7-A 致命バグ 8-8 リグレッション）');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
