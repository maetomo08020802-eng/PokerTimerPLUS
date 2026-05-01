/**
 * v2.0.1 Stabilization — 静的解析テスト
 *
 * 対象 Fix:
 *   A2  hall 逆書込ガード（schedulePersistTimerState / schedulePersistRuntime / startPeriodicTimerStatePersist）
 *   B1  ランタイム操作 5 ハンドラ hall ガード（cancelNewEntry / revivePlayer / adjustReentry / adjustAddOn / adjustSpecialStack）
 *   B2  tournaments:delete / importPayload で hall への broadcast（tournamentBasics / timerState 等）
 *   B3  schedulePersistRuntime に _tournamentSwitching ガード
 *   B4  logo:setMode / logo:selectFile で _publishDualState('logoUrl', ...) 呼出
 *   B5  リスト操作系 6 ハンドラ hall ガード
 *   B6  テロップタブ / プリセット click ハンドラ hall ガード
 *
 * 実行: node tests/v2-stabilization.test.js
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

// ============================================================
// A2: hall 逆書込ガード — persist 系関数冒頭に hall ガード
// ============================================================
test('A2-1: schedulePersistTimerState の冒頭に hall ガード', () => {
  // 「function schedulePersistTimerState()」の関数本体に hall return がある
  assert.match(RENDERER,
    /function schedulePersistTimerState\s*\(\s*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'schedulePersistTimerState に hall ガードなし');
});

test('A2-2: schedulePersistRuntime の冒頭に hall ガード', () => {
  assert.match(RENDERER,
    /function schedulePersistRuntime\s*\(\s*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'schedulePersistRuntime に hall ガードなし');
});

test('A2-3: startPeriodicTimerStatePersist の冒頭に hall ガード', () => {
  assert.match(RENDERER,
    /function startPeriodicTimerStatePersist\s*\(\s*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'startPeriodicTimerStatePersist に hall ガードなし');
});

// ============================================================
// B1: ランタイム操作 5 ハンドラ hall ガード
// ============================================================
test('B1-1: cancelNewEntry に hall ガードあり', () => {
  assert.match(RENDERER,
    /function cancelNewEntry\s*\(\s*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'cancelNewEntry に hall ガードなし');
});

test('B1-2: revivePlayer に hall ガードあり', () => {
  assert.match(RENDERER,
    /function revivePlayer\s*\(\s*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'revivePlayer に hall ガードなし');
});

test('B1-3: adjustReentry に hall ガードあり', () => {
  assert.match(RENDERER,
    /function adjustReentry\s*\(delta\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'adjustReentry に hall ガードなし');
});

test('B1-4: adjustAddOn に hall ガードあり', () => {
  assert.match(RENDERER,
    /function adjustAddOn\s*\(delta\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'adjustAddOn に hall ガードなし');
});

test('B1-5: adjustSpecialStack に hall ガードあり', () => {
  assert.match(RENDERER,
    /function adjustSpecialStack\s*\(delta\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'adjustSpecialStack に hall ガードなし');
});

// ============================================================
// B2: tournaments:delete / importPayload → hall broadcast
// ============================================================
test('B2-1: tournaments:delete が _publishDualState(\'tournamentBasics\'...) を呼ぶ', () => {
  // delete ハンドラ内に tournamentBasics broadcast がある
  const deleteMatch = MAIN.match(
    /ipcMain\.handle\(\s*['"]tournaments:delete['"][\s\S]*?return\s*\{[^}]*activeId/
  );
  assert.ok(deleteMatch, 'tournaments:delete ハンドラが見つからない');
  assert.match(deleteMatch[0], /_publishDualState\(\s*['"]tournamentBasics['"]/,
    'tournaments:delete に tournamentBasics broadcast なし');
});

test('B2-2: tournaments:delete が timerState も broadcast する', () => {
  const deleteMatch = MAIN.match(
    /ipcMain\.handle\(\s*['"]tournaments:delete['"][\s\S]*?return\s*\{[^}]*activeId/
  );
  assert.ok(deleteMatch, 'tournaments:delete ハンドラが見つからない');
  assert.match(deleteMatch[0], /_publishDualState\(\s*['"]timerState['"]/,
    'tournaments:delete に timerState broadcast なし');
});

test('B2-3: tournaments:importPayload が _publishDualState を呼ぶ', () => {
  // importPayload ハンドラ内に broadcast がある
  const importMatch = MAIN.match(
    /ipcMain\.handle\(\s*['"]tournaments:importPayload['"][\s\S]*?return\s*\{[^}]*importedTournaments/
  );
  assert.ok(importMatch, 'tournaments:importPayload ハンドラが見つからない');
  assert.match(importMatch[0], /_publishDualState\(/,
    'tournaments:importPayload に _publishDualState 呼出なし');
});

// ============================================================
// B3: schedulePersistRuntime の _tournamentSwitching ガード
// ============================================================
test('B3: schedulePersistRuntime の setTimeout callback に _tournamentSwitching ガードあり', () => {
  // setTimeout callback 内に _tournamentSwitching check がある
  // 「function schedulePersistRuntime」の関数全体を抽出
  const m = RENDERER.match(/function schedulePersistRuntime\s*\(\s*\)\s*\{/);
  assert.ok(m, 'schedulePersistRuntime が見つからない');
  let depth = 1, i = m.index + m[0].length;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++;
    else if (RENDERER[i] === '}') depth--;
    i++;
  }
  const body = RENDERER.slice(m.index, i);
  assert.match(body, /_tournamentSwitching/,
    'schedulePersistRuntime の callback に _tournamentSwitching ガードなし');
});

// ============================================================
// B4: logo:setMode / logo:selectFile で logoUrl broadcast
// ============================================================
test('B4-1: logo:setMode が _publishDualState(\'logoUrl\'...) を呼ぶ', () => {
  // logo:setMode ハンドラ内に logoUrl broadcast がある
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]logo:setMode['"][\s\S]*?\}\s*\)/);
  assert.ok(m, 'logo:setMode ハンドラが見つからない');
  assert.match(m[0], /_publishDualState\(\s*['"]logoUrl['"]/,
    'logo:setMode に logoUrl broadcast なし');
});

test('B4-2: logo:selectFile が _publishDualState(\'logoUrl\'...) を呼ぶ', () => {
  // logo:selectFile ハンドラ開始位置から logo:setMode ハンドラ開始位置までを抽出
  const startIdx = MAIN.indexOf("'logo:selectFile'");
  assert.ok(startIdx >= 0, 'logo:selectFile ハンドラが見つからない');
  const endIdx = MAIN.indexOf("'logo:setMode'", startIdx);
  assert.ok(endIdx >= 0, 'logo:setMode ハンドラが見つからない（境界検出失敗）');
  const section = MAIN.slice(startIdx, endIdx);
  assert.match(section, /_publishDualState\(\s*['"]logoUrl['"]/,
    'logo:selectFile に logoUrl broadcast なし');
});

// ============================================================
// B5: リスト操作系 6 ハンドラ hall ガード
// ============================================================
test('B5-1: handleTournamentListToggle に hall ガードあり', () => {
  assert.match(RENDERER,
    /function handleTournamentListToggle\s*\([^)]*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'handleTournamentListToggle に hall ガードなし');
});

test('B5-2: handleTournamentListReset に hall ガードあり', () => {
  assert.match(RENDERER,
    /function handleTournamentListReset\s*\([^)]*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'handleTournamentListReset に hall ガードなし');
});

test('B5-3: handleTournamentListSelect に hall ガードあり', () => {
  assert.match(RENDERER,
    /function handleTournamentListSelect\s*\([^)]*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'handleTournamentListSelect に hall ガードなし');
});

test('B5-4: handleTournamentSelectChange に hall ガードあり', () => {
  assert.match(RENDERER,
    /function handleTournamentSelectChange\s*\(\s*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'handleTournamentSelectChange に hall ガードなし');
});

test('B5-5: handleTournamentGameTypeChange に hall ガードあり', () => {
  assert.match(RENDERER,
    /function handleTournamentGameTypeChange\s*\([^)]*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'handleTournamentGameTypeChange に hall ガードなし');
});

test('B5-6: handleTournamentSaveApply に hall ガードあり', () => {
  assert.match(RENDERER,
    /function handleTournamentSaveApply\s*\(\s*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'handleTournamentSaveApply に hall ガードなし');
});

// ============================================================
// B6: テロップタブ・プリセット click ハンドラ hall ガード
// ============================================================
test('B6-1: handleMarqueeTabPreview に hall ガードあり', () => {
  assert.match(RENDERER,
    /function handleMarqueeTabPreview\s*\(\s*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'handleMarqueeTabPreview に hall ガードなし');
});

test('B6-2: handleMarqueeTabSave に hall ガードあり', () => {
  assert.match(RENDERER,
    /function handleMarqueeTabSave\s*\(\s*\)\s*\{[^}]*appRole\s*===\s*['"]hall['"]/,
    'handleMarqueeTabSave に hall ガードなし');
});

test('B6-3: el.presetNew click handler に hall ガードあり', () => {
  // el.presetNew の addEventListener('click') コールバック内に hall ガード
  const m = RENDERER.match(/el\.presetNew\?\.addEventListener\(\s*['"]click['"][^\)]*\(\s*\)\s*=>/);
  assert.ok(m, 'el.presetNew addEventListener が見つからない');
  // presetNew callback の範囲を大まかに取得（次の addEventListener まで）
  const startIdx = m.index;
  const cbStart = RENDERER.indexOf('=>', startIdx) + 2;
  // presetNew の {} ブロック開始を探す
  const braceStart = RENDERER.indexOf('{', cbStart);
  let depth = 1, i = braceStart + 1;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++;
    else if (RENDERER[i] === '}') depth--;
    i++;
  }
  const callbackBody = RENDERER.slice(braceStart, i);
  assert.match(callbackBody, /appRole\s*===\s*['"]hall['"]/,
    'el.presetNew click に hall ガードなし');
});

test('B6-4: el.presetDuplicate click handler に hall ガードあり', () => {
  const m = RENDERER.match(/el\.presetDuplicate\?\.addEventListener\(\s*['"]click['"][^\)]*\(\s*\)\s*=>/);
  assert.ok(m, 'el.presetDuplicate addEventListener が見つからない');
  const cbStart = RENDERER.indexOf('=>', m.index) + 2;
  const braceStart = RENDERER.indexOf('{', cbStart);
  let depth = 1, i = braceStart + 1;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++;
    else if (RENDERER[i] === '}') depth--;
    i++;
  }
  const callbackBody = RENDERER.slice(braceStart, i);
  assert.match(callbackBody, /appRole\s*===\s*['"]hall['"]/,
    'el.presetDuplicate click に hall ガードなし');
});

test('B6-5: el.presetDelete click handler に hall ガードあり', () => {
  const m = RENDERER.match(/el\.presetDelete\?\.addEventListener\(\s*['"]click['"][^\)]*\(\s*\)\s*=>/);
  assert.ok(m, 'el.presetDelete addEventListener が見つからない');
  const cbStart = RENDERER.indexOf('=>', m.index) + 2;
  const braceStart = RENDERER.indexOf('{', cbStart);
  let depth = 1, i = braceStart + 1;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++;
    else if (RENDERER[i] === '}') depth--;
    i++;
  }
  const callbackBody = RENDERER.slice(braceStart, i);
  assert.match(callbackBody, /appRole\s*===\s*['"]hall['"]/,
    'el.presetDelete click に hall ガードなし');
});

// ============================================================
// 致命バグ保護 5 件 — 維持確認（cross-check）
// ============================================================
test('致命バグ保護 cross-check: schedulePersistRuntime は operator 側で引き続き動作（hall ガードは先頭のみ）', () => {
  // hall ガード追加後も実際の保存処理（setRuntime 呼出）が残っている
  assert.match(RENDERER, /window\.api\.tournaments\.setRuntime\s*\(/, 'setRuntime 呼出が消えた');
});

test('致命バグ保護 cross-check: schedulePersistRuntime の呼出が 6 箇所以上維持（C.1.8 不変条件）', () => {
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(callCount >= 6, `schedulePersistRuntime 呼出が ${callCount} 箇所（6 以上必要、C.1.8 不変条件）`);
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
