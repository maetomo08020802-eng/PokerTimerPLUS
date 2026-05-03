/**
 * v2.0.4-rc13 — トーナメント複製 readonly 防御 + BREAK 中の 10 秒前/5 秒カウント音追加 の静的解析テスト
 *
 * 対象修正:
 *   Fix 1: `_handleTournamentDuplicateImpl` に `ensureEditorEditableState()` 2 重呼出追加
 *          （rc13 事前調査で、既存テストカバレッジ外の `_handleTournamentDuplicateImpl` のみ
 *           パリティ違反だったことが判明。`_handleTournamentNewImpl` / `handlePresetDuplicate` /
 *           `handlePresetNew` には既に 2 重呼出があった。）
 *   Fix 2: BREAK 中の早期 return 構造内に `playSound('warning-10sec')` (remainingSec===10) +
 *          `playSound('countdown-tick')` (remainingSec 1〜5) を追加。要望 3 は現状の break-end.mp3 維持。
 *
 * 致命バグ保護 5 件 cross-check + rc10/rc12 確定 Fix 維持 + version 同期確認も担保。
 *
 * 実行: node tests/v204-rc13-tournament-duplicate-and-break-sounds.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionBody(source, signaturePattern) {
  const m = source.match(signaturePattern);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(m.index, i);
}

// ============================================================
// Fix 1: _handleTournamentDuplicateImpl の readonly 防御追加
// ============================================================

test('Fix 1: _handleTournamentDuplicateImpl 関数本体に ensureEditorEditableState() が 2 回以上呼ばれる', () => {
  const body = extractFunctionBody(RENDERER, /async\s+function\s+_handleTournamentDuplicateImpl\s*\(\s*\)\s*\{/);
  assert.ok(body, '_handleTournamentDuplicateImpl が見つからない');
  const calls = body.match(/ensureEditorEditableState\s*\(\s*\)/g) || [];
  assert.ok(calls.length >= 2,
    `_handleTournamentDuplicateImpl 内の ensureEditorEditableState() 呼出が ${calls.length} 回（期待 >= 2、rc13 Fix 1 不在）`);
});

test('Fix 1: _handleTournamentDuplicateImpl の 1 回目の呼出は同期（RAF 外）', () => {
  const body = extractFunctionBody(RENDERER, /async\s+function\s+_handleTournamentDuplicateImpl\s*\(\s*\)\s*\{/);
  assert.ok(body);
  // 1 回目の ensureEditorEditableState 呼出位置が requestAnimationFrame の前にあるか
  const firstCallIdx = body.search(/ensureEditorEditableState\s*\(\s*\)/);
  const rafIdx = body.search(/requestAnimationFrame/);
  assert.ok(firstCallIdx >= 0, '1 回目の ensureEditorEditableState 呼出が見つからない');
  assert.ok(rafIdx >= 0, 'requestAnimationFrame が見つからない');
  assert.ok(firstCallIdx < rafIdx,
    `1 回目の ensureEditorEditableState (idx=${firstCallIdx}) が RAF (idx=${rafIdx}) より後（同期呼出位置が誤り）`);
});

test('Fix 1: _handleTournamentDuplicateImpl の 2 回目の呼出は RAF 内（focus + select 直後）', () => {
  const body = extractFunctionBody(RENDERER, /async\s+function\s+_handleTournamentDuplicateImpl\s*\(\s*\)\s*\{/);
  assert.ok(body);
  // RAF コールバック内に focus + select + ensureEditorEditableState を含む
  const m = body.match(/requestAnimationFrame\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(m, 'RAF コールバックが見つからない');
  assert.match(m[0], /\.focus\s*\(\s*\)/, 'RAF 内に .focus() がない');
  assert.match(m[0], /\.select\s*\(\s*\)/, 'RAF 内に .select() がない');
  assert.match(m[0], /ensureEditorEditableState\s*\(\s*\)/,
    'RAF 内に ensureEditorEditableState() 呼出がない（rc13 Fix 1 #2 不在）');
});

test('Fix 1: _handleTournamentDuplicateImpl の ensureEditorEditableState 呼出は try-catch で防御', () => {
  const body = extractFunctionBody(RENDERER, /async\s+function\s+_handleTournamentDuplicateImpl\s*\(\s*\)\s*\{/);
  assert.ok(body);
  // try { ensureEditorEditableState(); } catch パターンが 2 回以上
  const protectedCalls = body.match(/try\s*\{\s*ensureEditorEditableState\s*\(\s*\)\s*;?\s*\}\s*catch/g) || [];
  assert.ok(protectedCalls.length >= 2,
    `try-catch で囲まれた ensureEditorEditableState 呼出が ${protectedCalls.length} 回（期待 >= 2）`);
});

test('Fix 1 パリティ: _handleTournamentNewImpl の既存 2 重呼出が引き続き存在（rc13 で破壊されていない）', () => {
  const body = extractFunctionBody(RENDERER, /async\s+function\s+_handleTournamentNewImpl\s*\(\s*\)\s*\{/);
  assert.ok(body, '_handleTournamentNewImpl が見つからない');
  const calls = body.match(/ensureEditorEditableState\s*\(\s*\)/g) || [];
  assert.ok(calls.length >= 2,
    `_handleTournamentNewImpl 内の ensureEditorEditableState() 呼出が ${calls.length} 回（期待 >= 2、回帰）`);
});

test('Fix 1 パリティ: handlePresetDuplicate の既存 2 重呼出が引き続き存在（rc13 で破壊されていない）', () => {
  // handlePresetDuplicate のクリックハンドラ全体（el.presetDuplicate?.addEventListener 〜 終端）を抽出
  const start = RENDERER.indexOf("el.presetDuplicate?.addEventListener('click'");
  assert.ok(start >= 0, 'el.presetDuplicate のクリックハンドラが見つからない');
  // 開始から 5000 文字以内の範囲で ensureEditorEditableState 呼出を数える
  const slice = RENDERER.slice(start, start + 5000);
  const calls = slice.match(/ensureEditorEditableState\s*\(\s*\)/g) || [];
  assert.ok(calls.length >= 2,
    `handlePresetDuplicate ハンドラ内の ensureEditorEditableState() 呼出が ${calls.length} 回（期待 >= 2、回帰）`);
});

test('Fix 1 関数本体無変更: ensureEditorEditableState 関数本体に builtin ガードが維持', () => {
  // 関数定義本体を抽出
  const fnBody = extractFunctionBody(RENDERER, /function\s+ensureEditorEditableState\s*\(\s*\)\s*\{/);
  assert.ok(fnBody, 'ensureEditorEditableState 関数定義が見つからない');
  // builtin === true で early return（rc13 で関数本体に手を入れていないこと）
  assert.match(fnBody, /builtin\s*===?\s*true/,
    'ensureEditorEditableState の builtin === true ガードが消失（致命バグ保護 C.1.2-bugfix 破壊）');
});

// ============================================================
// Fix 2: BREAK 中の 10 秒前 + 5 秒カウント音追加
// ============================================================

test('Fix 2: BREAK 早期 return 構造内に playSound("warning-10sec") が含まれる', () => {
  // if (status === States.BREAK) { ... } ブロック本体を抽出
  const m = RENDERER.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(m, 'BREAK 早期 return 構造が見つからない');
  assert.match(m[0], /playSound\(\s*['"]warning-10sec['"]\s*\)/,
    'BREAK 早期 return 内に playSound("warning-10sec") がない（rc13 Fix 2 要望 1 不在）');
});

test('Fix 2: warning-10sec 呼出が remainingSec === 10 条件で発火', () => {
  const m = RENDERER.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(m);
  assert.match(m[0], /if\s*\(\s*remainingSec\s*===?\s*10\s*\)\s*playSound\(\s*['"]warning-10sec['"]\s*\)/,
    'warning-10sec の呼出条件が remainingSec === 10 になっていない');
});

test('Fix 2: BREAK 早期 return 構造内に playSound("countdown-tick") が含まれる', () => {
  const m = RENDERER.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(m);
  assert.match(m[0], /playSound\(\s*['"]countdown-tick['"]\s*\)/,
    'BREAK 早期 return 内に playSound("countdown-tick") がない（rc13 Fix 2 要望 2 不在）');
});

test('Fix 2: countdown-tick 呼出が remainingSec 1〜5 条件で発火', () => {
  const m = RENDERER.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(m);
  // remainingSec >= 1 && remainingSec <= 5 の条件
  assert.match(m[0],
    /if\s*\(\s*remainingSec\s*>=\s*1\s*&&\s*remainingSec\s*<=\s*5\s*\)\s*playSound\(\s*['"]countdown-tick['"]\s*\)/,
    'countdown-tick の呼出条件が remainingSec 1〜5 範囲になっていない');
});

test('Fix 2 + rc15 タスク 1 統合: BREAK 早期 return 構造から break-end 瞬間判定が削除（onLevelEnd へ移動）', () => {
  // rc13 では BREAK ブロック内に `if (remainingSec === 0) playSound('break-end')` が存在したが、
  // rc15 タスク 1 で onTick の瞬間判定 race を構造的に解消するため、break-end は onLevelEnd に移動。
  // BREAK ブロック内には break-end 呼出が**存在しない**ことを確認（rc15 で削除）。
  const m = RENDERER.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(m);
  assert.doesNotMatch(m[0], /playSound\(\s*['"]break-end['"]/,
    'BREAK ブロック内に playSound("break-end") が残存（rc15 タスク 1 で onLevelEnd に移動済のはず）');
});

test('Fix 2 既存挙動維持: RUNNING 中の 10 秒前 / 5 秒カウント / 1 分前警告が破壊されていない', () => {
  // RUNNING 中（BREAK 早期 return の後）の音再生コードを抽出するため、
  //   handleAudioOnTick 関数本体を抽出（function declaration を想定）
  const body = extractFunctionBody(RENDERER, /function\s+handleAudioOnTick\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'handleAudioOnTick 関数が見つからない');
  // RUNNING 中の 1 分前 / 10 秒前 / 5 秒カウント
  assert.match(body, /remainingSec\s*===?\s*60[\s\S]*?playSound\(\s*['"]warning-1min['"]\s*\)/,
    'RUNNING 中の 1 分前警告 (remainingSec===60) が消失');
  // RUNNING 中の 10 秒前は BREAK の後に来る → BREAK ブロック以外の場所で warning-10sec が呼ばれる
  const breakBlockMatch = body.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(breakBlockMatch);
  const afterBreak = body.slice(breakBlockMatch.index + breakBlockMatch[0].length);
  assert.match(afterBreak, /playSound\(\s*['"]warning-10sec['"]\s*\)/,
    'RUNNING 中の 10 秒前警告が消失（BREAK ブロック後の呼出）');
  assert.match(afterBreak, /playSound\(\s*['"]countdown-tick['"]\s*\)/,
    'RUNNING 中の 5 秒カウントが消失（BREAK ブロック後の呼出）');
});

test('Fix 2 致命バグ保護 C.1.7: 追加した playSound 呼出は引き続き playSound() 経由（直接 audio.play は使わない）', () => {
  // BREAK ブロック内に audio.play( のような直接呼出がないこと
  const m = RENDERER.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(m);
  assert.doesNotMatch(m[0], /audio\.play\s*\(/,
    'BREAK ブロック内に直接 audio.play() 呼出が混入（C.1.7 経路から外れる）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc13 で影響なしを担保）
// ============================================================

test('致命バグ保護 C.2.7-A: resetBlindProgressOnly が renderer.js に引き続き存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly が消失（C.2.7-A 破壊）');
});

test('致命バグ保護 C.2.7-D: tournaments:setDisplaySettings の timerState destructure 除外維持', () => {
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'tournaments:setDisplaySettings ハンドラが見つからない');
  assert.doesNotMatch(m[0], /const\s*\{[^}]*\btimerState\b[^}]*\}\s*=/,
    'setDisplaySettings で timerState destructure が混入（C.2.7-D 致命バグ再発）');
});

test('致命バグ保護 C.1-A2 + C.1.2-bugfix: ensureEditorEditableState 関数定義が維持', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState が消失（致命バグ保護 C.1-A2 破壊）');
});

test('致命バグ保護 C.1.7: AudioContext suspend resume 経路が維持', () => {
  const audioJsPath = path.join(ROOT, 'src', 'renderer', 'audio.js');
  if (fs.existsSync(audioJsPath)) {
    const audio = fs.readFileSync(audioJsPath, 'utf8');
    assert.match(audio, /audioContext\.state\s*===?\s*['"]suspended['"]/,
      'audio.js から audioContext.state suspended 検出が消失（C.1.7 破壊）');
  } else {
    assert.match(RENDERER, /audioContext\.state\s*===?\s*['"]suspended['"]/,
      'renderer.js から audioContext.state suspended 検出が消失（C.1.7 破壊）');
  }
});

test('致命バグ保護 C.1.8: tournaments:setRuntime IPC が維持', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime ハンドラが消失（C.1.8 致命バグ破壊）');
});

// ============================================================
// rc10 / rc12 確定 Fix の維持確認
// ============================================================

test('rc10 維持: _dualStateCache に specialStack キー存在', () => {
  const m = MAIN.match(/const\s+_dualStateCache\s*=\s*\{[\s\S]*?\};/);
  assert.ok(m);
  assert.match(m[0], /specialStack\s*:\s*null/, 'specialStack キー消失（rc10 Fix 1-A 破壊）');
});

test('rc10 維持: app.requestSingleInstanceLock 維持', () => {
  assert.match(MAIN, /app\.requestSingleInstanceLock\s*\(\s*\)/,
    'requestSingleInstanceLock 消失（rc10 Fix 3 破壊）');
});

// rc21 第 2 弾追従: onRoleChanged ハンドラに計測ラベル（インライン object literal 含む）追加に伴い、
//   非貪欲な `\}\s*\)` 早期マッチ問題を解消するため balanced brace 抽出 (extractFunctionBody) に切替。
test('rc12 維持: onRoleChanged 内で setAttribute("data-role") が window.appRole 代入より前', () => {
  const handler = extractFunctionBody(RENDERER, /onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{/);
  assert.ok(handler, 'onRoleChanged ハンドラ抽出失敗');
  const setAttrIdx = handler.search(/setAttribute\(\s*['"]data-role['"]/);
  const assignIdx  = handler.search(/window\.appRole\s*=\s*newRole/);
  assert.ok(setAttrIdx >= 0, 'setAttribute("data-role") が見つからない');
  assert.ok(assignIdx  >= 0, 'window.appRole = newRole が見つからない');
  assert.ok(setAttrIdx < assignIdx,
    'rc12 真因根治の順序が逆転（setAttribute → window.appRole の順を維持必須）');
});

test('rc12 維持: window.appRole = newRole が try-catch で防御', () => {
  assert.match(RENDERER, /try\s*\{\s*window\.appRole\s*=\s*newRole\s*;?\s*\}\s*catch/,
    'window.appRole 代入の try-catch 防御が消失（rc12 真因根治破壊）');
});

// ============================================================
// operator-solo モード（v1.3.0 互換）影響なし確認
// ============================================================

test('operator-solo 互換: createOperatorWindow が引き続き role 引数を受け取る', () => {
  assert.match(MAIN, /function\s+createOperatorWindow\s*\(/,
    'createOperatorWindow が消失（v1.3.0 互換破壊）');
});

test('operator-solo 互換: rc8 の [data-role="operator-solo"] 防御保険 CSS が維持', () => {
  const stylePath = path.join(ROOT, 'src', 'renderer', 'style.css');
  const STYLE = fs.readFileSync(stylePath, 'utf8');
  assert.match(STYLE, /\[data-role="operator-solo"\]\s*\.clock\s*\{[^}]*display:\s*grid\s*!important/,
    'rc9 防御保険 CSS が消失（operator-solo .clock { display: grid !important }）');
});

// ============================================================
// version 同期確認（rc13）
// ============================================================

test('version: package.json は 2.0.4', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.4',
    `package.json version が ${pkg.version}（期待 2.0.4）`);
});

test('version: scripts.test に v204-rc13-tournament-duplicate-and-break-sounds.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc13-tournament-duplicate-and-break-sounds\.test\.js/,
    'package.json scripts.test に v204-rc13-tournament-duplicate-and-break-sounds.test.js がない');
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
