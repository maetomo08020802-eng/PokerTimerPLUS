/**
 * STEP 10 フェーズC.2.7-B — PAUSED 状態の挙動破綻 4 件修正の回帰防止テスト
 *
 * 修正項目:
 *   Fix 1: PAUSED で「適用」が silent reset される問題
 *          → showBlindsApplyModal が showApplyOnly オプション受け、PAUSED 時は 3 択化
 *   Fix 2: PAUSED で「保存」だけだと構造が反映されないことを UI hint で明示
 *          → handlePresetSave 後の hint に「適用ボタンで反映」明示
 *   Fix 3: 複合操作で state machine 破綻
 *          → _savePresetCore 後に setDirty(false) と blindPresetCache.delete が確実に呼ばれる
 *   Fix 4: PAUSED で「保存して適用」のモーダルが出ない
 *          → openApplyModeDialog が showApplyOnly オプション受け、PAUSED 時は 3 択化 + apply-only 処理
 *
 * 実行: node tests/paused-flow.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 関数本体抽出（auditテストと同様）
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
// T1（Fix 1+4 HTML）: 両ダイアログに apply-only ボタンが追加されている
// ============================================================
test('T1: index.html の両モーダルに「適用のみ」ボタンが追加されている', () => {
  // js-apply-mode-dialog 内に js-apply-only ボタン
  const dialog1 = HTML.match(/<dialog[^>]*id=["']js-apply-mode-dialog["'][\s\S]+?<\/dialog>/);
  assert.ok(dialog1, 'js-apply-mode-dialog が見つからない');
  assert.match(dialog1[0], /id=["']js-apply-only["']/, 'js-apply-only ボタンが modal にない');
  assert.match(dialog1[0], /\bhidden\b/, 'js-apply-only に初期 hidden 属性がない');

  // js-blinds-apply-mode-dialog 内に js-blinds-apply-only ボタン
  const dialog2 = HTML.match(/<dialog[^>]*id=["']js-blinds-apply-mode-dialog["'][\s\S]+?<\/dialog>/);
  assert.ok(dialog2, 'js-blinds-apply-mode-dialog が見つからない');
  assert.match(dialog2[0], /id=["']js-blinds-apply-only["']/, 'js-blinds-apply-only ボタンが modal にない');
  assert.match(dialog2[0], /\bhidden\b/, 'js-blinds-apply-only に初期 hidden 属性がない');
});

// ============================================================
// T2（Fix 1）: showBlindsApplyModal が showApplyOnly オプションを受け取り、apply-only resolve できる
// ============================================================
test('T2: showBlindsApplyModal が showApplyOnly オプションで apply-only を解決する', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'showBlindsApplyModal'));
  // 関数シグネチャに showApplyOnly が含まれる
  assert.match(
    RENDERER,
    /function\s+showBlindsApplyModal\s*\(\s*\{\s*showApplyOnly[^}]*\}\s*=\s*\{\}\s*\)/,
    'showBlindsApplyModal が showApplyOnly オプションを受け取っていない'
  );
  // resolve('apply-only') が存在
  assert.match(body, /resolve\(['"]apply-only['"]\)/, "resolve('apply-only') が呼ばれていない");
  // hidden 切替ロジック
  assert.match(body, /blindsApplyOnly[^=]*hidden\s*=\s*!showApplyOnly/, 'apply-only ボタンの hidden 制御が showApplyOnly と連動していない');
});

// ============================================================
// T3（Fix 1）: handlePresetApply が PAUSED 時に showApplyOnly=true で modal を呼ぶ
// ============================================================
test('T3: handlePresetApply が PAUSED 時 showApplyOnly=true で modal を呼ぶ', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handlePresetApply'));
  // showBlindsApplyModal の呼び出しに showApplyOnly が含まれる
  assert.match(
    body,
    /showBlindsApplyModal\(\s*\{\s*showApplyOnly[^)]*\}\s*\)/,
    'showBlindsApplyModal が showApplyOnly 付きで呼ばれていない'
  );
  // States.PAUSED と connect されている
  assert.match(body, /States\.PAUSED/, 'States.PAUSED 判定がない');
  // mode === 'apply-only' の処理
  assert.match(body, /mode\s*===\s*['"]apply-only['"]/, "mode === 'apply-only' の分岐がない");
  // apply-only 分岐で setStructure を呼ぶ
  const applyOnlyBranch = body.split(/mode\s*===\s*['"]apply-only['"]/)[1] || '';
  assert.match(applyOnlyBranch, /setStructure\(/, 'apply-only 分岐で setStructure が呼ばれていない');
  // apply-only 分岐で resetBlindProgressOnly や handleReset は**呼ばない**
  const beforeNextBranch = applyOnlyBranch.split(/}\s*else\b/)[0] || applyOnlyBranch;
  assert.doesNotMatch(beforeNextBranch, /resetBlindProgressOnly\(/, 'apply-only 分岐で resetBlindProgressOnly を呼ばないこと');
  assert.doesNotMatch(beforeNextBranch, /\bhandleReset\(/, 'apply-only 分岐で handleReset を呼ばないこと');
});

// ============================================================
// T4（Fix 4）: openApplyModeDialog が showApplyOnly を受け取り、apply-only ボタンを連動
// ============================================================
test('T4: openApplyModeDialog が showApplyOnly オプションで apply-only ボタンを連動', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'openApplyModeDialog'));
  // 関数シグネチャに showApplyOnly オプション
  assert.match(
    RENDERER,
    /function\s+openApplyModeDialog\s*\([^)]*showApplyOnly/,
    'openApplyModeDialog が showApplyOnly オプションを受け取っていない'
  );
  // applyOnly ボタンの hidden 制御
  assert.match(body, /applyOnly[^=]*hidden\s*=\s*!showApplyOnly/, 'apply-only ボタンの hidden 制御が showApplyOnly と連動していない');
  // 'apply-only' を doApplyTournament に渡す
  assert.match(body, /doApplyTournament\([^,]+,\s*['"]apply-only['"]\)/, "doApplyTournament が 'apply-only' で呼ばれていない");
});

// ============================================================
// T5（Fix 4）: handleTournamentSaveApply が PAUSED 時 showApplyOnly=true で openApplyModeDialog を呼ぶ
// ============================================================
test('T5: handleTournamentSaveApply が PAUSED 時 showApplyOnly: status === States.PAUSED を渡す', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handleTournamentSaveApply'));
  assert.match(
    body,
    /openApplyModeDialog\([\s\S]*showApplyOnly[\s\S]*States\.PAUSED/,
    'openApplyModeDialog が showApplyOnly: status === States.PAUSED 付きで呼ばれていない'
  );
});

// ============================================================
// T6（Fix 4）: doApplyTournament の apply-only 分岐が PAUSED でメッセージを出し分ける
// ============================================================
test('T6: doApplyTournament の apply-only 分岐が PAUSED 用メッセージを持つ', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'doApplyTournament'));
  assert.match(body, /mode\s*===\s*['"]apply-only['"]/, "apply-only 分岐がない");
  // PAUSED 時のメッセージ確認
  assert.match(body, /一時停止状態を維持/, 'PAUSED 用メッセージが含まれていない');
});

// ============================================================
// T7（Fix 2）: handlePresetSave 後の hint がタイマー進行中なら「適用」誘導を含む
// ============================================================
test('T7: handlePresetSave の保存成功 hint がタイマー進行中で「適用」誘導を含む', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handlePresetSave'));
  // status !== States.IDLE 判定
  assert.match(body, /States\.IDLE/, 'IDLE 判定がない');
  // 「適用」ボタン誘導テキスト
  assert.match(body, /「適用」ボタン/, '「適用」ボタンへの誘導テキストがない');
});

// ============================================================
// T8（Fix 3）: _savePresetCore 後に setDirty(false) と blindPresetCache.delete が呼ばれる
// ============================================================
test('T8: _savePresetCore が成功時に setDirty(false) と blindPresetCache.delete を呼ぶ', () => {
  const body = stripComments(extractFunctionBody(RENDERER, '_savePresetCore'));
  assert.match(body, /setDirty\(false\)/, 'setDirty(false) が呼ばれていない');
  assert.match(body, /blindPresetCache\.delete\(/, 'blindPresetCache.delete が呼ばれていない');
});

// ============================================================
// T9（Fix 3 / 致命バグ8-8 維持）: handlePresetApply の reset 分岐は引き続き resetBlindProgressOnly を使う
// ============================================================
test('T9: handlePresetApply の reset 分岐は resetBlindProgressOnly を維持（C.2.7-A 修正の保護）', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handlePresetApply'));
  assert.match(body, /resetBlindProgressOnly\(/, 'reset 分岐で resetBlindProgressOnly が消えている');
  assert.doesNotMatch(body, /\bhandleReset\(/, 'reset 分岐で handleReset が誤って呼ばれている（C.2.7-A 致命バグ 8-8 リグレッション）');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
