/**
 * STEP 10 フェーズC.1.2-bugfix — 新規トーナメント作成 → ひな形コピー編集の readonly 残存対策
 *
 * 修正:
 *   1. ensureEditorEditableState を conditional 化: meta.builtin === true 時は no-op
 *      → 呼出側は meta 状態を気にせず多くのタイミングで安全に呼べる
 *   2. handleTournamentNew 末尾に ensureEditorEditableState 呼出追加
 *   3. ensureBlindsEditorLoaded の else 分岐（タブ再表示時）に ensureEditorEditableState 呼出追加
 *
 * 既存の C.1-A2 4 重防御（render内 + update内 + sync ensure + RAF ensure）は維持。
 *
 * 実行: node tests/new-tournament-edit.test.js
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
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// ============================================================
// T1: ensureEditorEditableState が meta.builtin === true で early return（no-op）
// ============================================================
test('T1: ensureEditorEditableState が meta.builtin===true で early return', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'ensureEditorEditableState'));
  // builtin guard が含まれる
  assert.match(
    body,
    /blindsEditor\.meta\s*&&\s*blindsEditor\.meta\.builtin\s*===\s*true/,
    'meta.builtin === true ガードが含まれていない'
  );
  // return 文が含まれる
  assert.match(body, /return/, 'early return がない');
});

// ============================================================
// T2: ensureEditorEditableState が user preset 時は readonly クリアする
// ============================================================
test('T2: ensureEditorEditableState が presetName の readOnly/disabled をクリア', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'ensureEditorEditableState'));
  assert.match(body, /presetName\.readOnly\s*=\s*false/, 'readOnly=false クリアがない');
  assert.match(body, /presetName\.disabled\s*=\s*false/, 'disabled=false クリアがない');
  assert.match(body, /setBlindsTableReadonly\(false\)/, 'setBlindsTableReadonly(false) 呼出がない');
});

// ============================================================
// T3: _handleTournamentNewImpl 末尾で ensureEditorEditableState 呼出
// ============================================================
test('T3: _handleTournamentNewImpl 末尾で ensureEditorEditableState 呼出', () => {
  const body = stripComments(extractFunctionBody(RENDERER, '_handleTournamentNewImpl'));
  assert.match(body, /ensureEditorEditableState\s*\(/, '_handleTournamentNewImpl 内で ensureEditorEditableState が呼ばれていない');
});

// ============================================================
// T4: ensureBlindsEditorLoaded の else 分岐で ensureEditorEditableState 呼出
// ============================================================
test('T4: ensureBlindsEditorLoaded の else 分岐で ensureEditorEditableState 呼出', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'ensureBlindsEditorLoaded'));
  // else 分岐内に ensureEditorEditableState 呼出がある
  assert.match(body, /else\s+if[\s\S]+?ensureEditorEditableState\s*\(/, 'else 分岐内で ensureEditorEditableState が呼ばれていない');
});

// ============================================================
// T5（C.1-A2 維持）: handlePresetDuplicate で 2 回以上 ensureEditorEditableState
// ============================================================
test('T5: handlePresetDuplicate で ensureEditorEditableState 2 回以上呼出（4 重防御）', () => {
  const start = RENDERER.indexOf("el.presetDuplicate?.addEventListener('click'");
  assert.ok(start >= 0, 'presetDuplicate ハンドラが見つからない');
  const slice = RENDERER.slice(start, start + 2000);
  const matches = slice.match(/ensureEditorEditableState\s*\(/g) || [];
  assert.ok(matches.length >= 2, `複製ハンドラ内 ensureEditorEditableState 呼出が ${matches.length} 件しかない`);
});

// ============================================================
// T6（C.1-A2 維持）: handlePresetNew で 2 回以上 ensureEditorEditableState
// ============================================================
test('T6: handlePresetNew で ensureEditorEditableState 2 回以上呼出', () => {
  const start = RENDERER.indexOf("el.presetNew?.addEventListener('click'");
  assert.ok(start >= 0, 'presetNew ハンドラが見つからない');
  const slice = RENDERER.slice(start, start + 2000);
  const matches = slice.match(/ensureEditorEditableState\s*\(/g) || [];
  assert.ok(matches.length >= 2, `新規ハンドラ内 ensureEditorEditableState 呼出が ${matches.length} 件しかない`);
});

// ============================================================
// T7: builtin 保護維持 — setBlindsTableReadonly(true) は引き続き readonly 付与
// ============================================================
test('T7: setBlindsTableReadonly(true) は引き続き disabled + readonly 付与（builtin 保護）', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'setBlindsTableReadonly'));
  const trueBranch = body.match(/if\s*\(\s*readonly\s*\)\s*\{[\s\S]+?return;\s*\}/);
  assert.ok(trueBranch, 'readonly=true 分岐が見つからない');
  assert.match(trueBranch[0], /node\.disabled\s*=\s*true/, 'disabled=true がない');
  assert.match(trueBranch[0], /setAttribute\(['"]readonly['"]/, 'readonly attr 付与がない');
});

// ============================================================
// T8（致命バグ修正の維持）: handlePresetApply の reset 分岐は resetBlindProgressOnly
// ============================================================
test('T8: handlePresetApply の reset 分岐で resetBlindProgressOnly 維持（C.2.7-A 致命バグ修正の保護）', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handlePresetApply'));
  assert.match(body, /resetBlindProgressOnly\(/, 'resetBlindProgressOnly が消えている');
  assert.doesNotMatch(body, /\bhandleReset\(/, 'handleReset が誤って呼ばれている');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
