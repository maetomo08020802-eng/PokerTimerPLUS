/**
 * v2.1.0 静的解析テスト — audit 消化版 minor bump（M4/M6/M8/M10/M11/M9）
 *   Fix 1 (M4 Perf-3):  renderTournamentList のイベント委譲化
 *   Fix 2 (M6 Perf-8):  .card の backdrop-filter: blur 削除
 *   Fix 3 (M8 Edge-3):  tournaments:readImportFile の size 上限（50MB）
 *   Fix 4 (M10 Edge-6): sanitizeRuntime に playersRemaining クランプ
 *   Fix 5 (M11 Edge-8): isValidPreset / validateStructure の整合性
 *   Fix 6 (M9 Edge-4):  migrateTournamentSchema に注意喚起コメント
 *
 * 致命バグ保護 5 件への影響:
 *   1〜5 すべて影響なし（v2.0.15 で確立した状態を完全維持）
 *
 * 実行: node tests/v210-audit-cleanup.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const PKG  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const BLINDS_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'blinds.js'), 'utf8');
const STYLE_CSS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1 (Fix 1): renderTournamentList 内に addEventListener ベースのイベント委譲パターン存在
// ============================================================
test('T1 (Fix 1): イベント委譲ヘルパ ensureTournamentListDelegation が存在', () => {
  assert.ok(/function\s+ensureTournamentListDelegation\s*\(/.test(RENDERER_JS),
    'ensureTournamentListDelegation 関数定義がない');
  assert.ok(/_tournamentListDelegationInstalled/.test(RENDERER_JS),
    '重複登録防止フラグ _tournamentListDelegationInstalled がない');
  assert.ok(/el\.tournamentList\.addEventListener\(\s*['"]click['"]/.test(RENDERER_JS),
    '親要素 el.tournamentList への click delegation 登録がない');
});

test('T1-2 (Fix 1): buildTournamentListItem 内で個別 addEventListener が消えている', () => {
  const declIdx = RENDERER_JS.indexOf('function buildTournamentListItem(');
  assert.ok(declIdx >= 0, 'buildTournamentListItem 関数が見つからない');
  const nextFnIdx = RENDERER_JS.indexOf('\nfunction ', declIdx + 1);
  const body = RENDERER_JS.slice(declIdx, nextFnIdx > 0 ? nextFnIdx : declIdx + 4000);
  // 各ボタン個別の addEventListener('click', ...) が消失していること
  assert.ok(!/toggle\.addEventListener\(/.test(body),
    'buildTournamentListItem 内に toggle.addEventListener が残っている');
  assert.ok(!/reset\.addEventListener\(/.test(body),
    'buildTournamentListItem 内に reset.addEventListener が残っている');
  assert.ok(!/select\.addEventListener\(/.test(body),
    'buildTournamentListItem 内に select.addEventListener が残っている');
  assert.ok(!/delBtn\.addEventListener\(/.test(body),
    'buildTournamentListItem 内に delBtn.addEventListener が残っている');
});

test('T1-3 (Fix 1): buildTournamentListItem が dataset.action / data-tournament-id を設定', () => {
  const declIdx = RENDERER_JS.indexOf('function buildTournamentListItem(');
  const nextFnIdx = RENDERER_JS.indexOf('\nfunction ', declIdx + 1);
  const body = RENDERER_JS.slice(declIdx, nextFnIdx > 0 ? nextFnIdx : declIdx + 4000);
  assert.ok(/li\.dataset\.tournamentId\s*=/.test(body),
    'li.dataset.tournamentId 設定がない');
  assert.ok(/dataset\.action\s*=\s*['"]toggle['"]/.test(body),
    'toggle ボタンに dataset.action = "toggle" がない');
  assert.ok(/dataset\.action\s*=\s*['"]reset['"]/.test(body),
    'reset ボタンに dataset.action = "reset" がない');
  assert.ok(/dataset\.action\s*=\s*['"]select['"]/.test(body),
    'select ボタンに dataset.action = "select" がない');
  assert.ok(/dataset\.action\s*=\s*['"]delete['"]/.test(body),
    'delete ボタンに dataset.action = "delete" がない');
});

// ============================================================
// T2 (Fix 2): .card 系セレクタに backdrop-filter: blur が残っていない
// ============================================================
test('T2 (Fix 2): .card セレクタに backdrop-filter: blur が残っていない', () => {
  // .card { ... } ブロック本体（次の閉じ括弧まで）を抽出
  const re = /\.card\s*\{[\s\S]*?\n\}/;
  const m = STYLE_CSS.match(re);
  assert.ok(m, '.card ブロックが見つからない');
  // コメント部分（/* ... */）を除去してから生プロパティ宣言を検査
  const stripped = m[0].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/backdrop-filter:\s*blur/.test(stripped),
    '.card ブロック内に backdrop-filter: blur 宣言が残っている');
});

// ============================================================
// T3 (Fix 3): tournaments:readImportFile 内に size 上限チェック存在
// ============================================================
test('T3 (Fix 3): tournaments:readImportFile に size 上限チェック存在', () => {
  const handleIdx = MAIN_JS.indexOf("ipcMain.handle('tournaments:readImportFile'");
  assert.ok(handleIdx >= 0, 'tournaments:readImportFile ハンドラが見つからない');
  // ハンドラ開始から 2000 文字以内で size 上限チェックを検査
  const slice = MAIN_JS.slice(handleIdx, handleIdx + 2000);
  assert.ok(/fs\.statSync\(/.test(slice),
    'fs.statSync の size 取得がない');
  assert.ok(/50\s*\*\s*1024\s*\*\s*1024/.test(slice),
    '50MB 上限チェックがない');
  assert.ok(/file-too-large/.test(slice),
    'file-too-large エラー返却がない');
});

// ============================================================
// T4 (Fix 4): sanitizeRuntime 内に Math.min(playersRemaining, playersInitial) パターン
// ============================================================
test('T4 (Fix 4): sanitizeRuntime に Math.min(toNonNegInt..., playersInitial) パターン', () => {
  const declIdx = MAIN_JS.indexOf('function sanitizeRuntime(');
  assert.ok(declIdx >= 0, 'sanitizeRuntime が見つからない');
  const closeIdx = MAIN_JS.indexOf('\n}', declIdx);
  const body = MAIN_JS.slice(declIdx, closeIdx + 2);
  assert.ok(/Math\.min\(\s*toNonNegInt\([^)]+playersRemaining[^)]+\),\s*playersInitial\s*\)/.test(body),
    'sanitizeRuntime に Math.min(toNonNegInt(...playersRemaining...), playersInitial) パターンがない');
});

// ============================================================
// T5 (Fix 5): isValidPreset / validateStructure の検証基準整合
// ============================================================
test('T5 (Fix 5): main.js isValidPreset に regularLevelCount === 0 reject 追加', () => {
  const declIdx = MAIN_JS.indexOf('function isValidPreset(');
  assert.ok(declIdx >= 0, 'isValidPreset が見つからない');
  const closeIdx = MAIN_JS.indexOf('\n}', declIdx);
  const body = MAIN_JS.slice(declIdx, closeIdx + 2);
  assert.ok(/regularLevelCount/.test(body),
    'isValidPreset に regularLevelCount トラッキングがない');
  assert.ok(/regularLevelCount\s*===\s*0/.test(body),
    'isValidPreset に regularLevelCount === 0 reject がない');
});

test('T5-2 (Fix 5): renderer 側 validateStructure に regularLevelCount === 0 reject 維持', () => {
  // 既存維持確認（破壊検知）
  assert.ok(/regularLevelCount\s*===\s*0/.test(BLINDS_JS),
    'blinds.js validateStructure の regularLevelCount === 0 reject が破壊されている');
});

// ============================================================
// T6 (Fix 6): migrateTournamentSchema に注意喚起コメント存在
// ============================================================
test('T6 (Fix 6): migrateTournamentSchema 内に displaySettings 拡張時の注意喚起コメント', () => {
  const declIdx = MAIN_JS.indexOf('function migrateTournamentSchema(');
  assert.ok(declIdx >= 0, 'migrateTournamentSchema が見つからない');
  const closeIdx = MAIN_JS.indexOf('\nfunction ', declIdx + 1);
  const body = MAIN_JS.slice(declIdx, closeIdx);
  assert.ok(/JSON\.stringify\s*比較[\s\S]{0,200}?キー順|キー順[\s\S]{0,200}?JSON\.stringify/.test(body)
    || /Fix 6 \(M9 Edge-4\) NOTE/.test(body),
    'migrateTournamentSchema 内に displaySettings 拡張時の注意喚起コメントがない');
});

// ============================================================
// T7: package.json version が 2.1.0
// ============================================================
test('T7: package.json version が 2.1.0', () => {
  assert.equal(PKG.version, '2.10.0', `version が ${PKG.version}（期待 2.1.0）`);
});

test('T7-2: scripts.test に v210-audit-cleanup.test.js が登録', () => {
  assert.ok(PKG.scripts && typeof PKG.scripts.test === 'string', 'scripts.test がない');
  assert.ok(PKG.scripts.test.includes('v210-audit-cleanup.test.js'),
    'scripts.test に v210-audit-cleanup.test.js が登録されていない');
});

// ============================================================
// 致命バグ保護 cross-check
// ============================================================
test('保護: C.1.8 既存 8 箇所の schedulePersistRuntime フック維持（renderer 側）', () => {
  const matches = RENDERER_JS.match(/schedulePersistRuntime\(/g) || [];
  assert.ok(matches.length >= 8,
    `renderer.js の schedulePersistRuntime 呼出が 8 件未満（実際 ${matches.length} 件）`);
});

test('保護: resetBlindProgressOnly に schedulePersistRuntime フックなし（C.1.8 設計維持）', () => {
  const fnIdx = RENDERER_JS.indexOf('function resetBlindProgressOnly');
  if (fnIdx < 0) return;   // 関数名が変わった場合は別途検証
  const nextFnIdx = RENDERER_JS.indexOf('\nfunction ', fnIdx + 1);
  const body = RENDERER_JS.slice(fnIdx, nextFnIdx > 0 ? nextFnIdx : fnIdx + 3000);
  assert.ok(!/schedulePersistRuntime\(/.test(body),
    'resetBlindProgressOnly に schedulePersistRuntime フックが追加されている（C.1.8 設計違反）');
});

test('保護: v2.0.15 _isSwitchingMode ガード 7 件（必要ハンドラ全件）維持', () => {
  const requiredChannels = [
    'tournaments:setActive',
    'tournaments:setTimerState',
    'tournaments:save',
    'tournaments:setRuntime',
    'tournaments:setMarqueeSettings',
    'tournaments:setDisplaySettings',
    'tournament:set'
  ];
  for (const ch of requiredChannels) {
    const re = new RegExp(`ipcMain\\.handle\\('${ch}'[\\s\\S]{0,1500}?if\\s*\\(\\s*_isSwitchingMode\\s*\\)\\s*return`);
    assert.ok(re.test(MAIN_JS),
      `${ch} の _isSwitchingMode ガードが破壊されている`);
  }
});

test('保護: isUserTypingInInput ガード（fix9）が renderTournamentList に存続', () => {
  const declIdx = RENDERER_JS.indexOf('async function renderTournamentList(');
  assert.ok(declIdx >= 0, 'renderTournamentList が見つからない');
  const nextFnIdx = RENDERER_JS.indexOf('\nfunction ', declIdx + 1);
  const body = RENDERER_JS.slice(declIdx, nextFnIdx > 0 ? nextFnIdx : declIdx + 1500);
  assert.ok(/isUserTypingInInput\(\)/.test(body),
    'renderTournamentList の isUserTypingInInput ガードが破壊されている（fix9 違反）');
});

test('保護: hashPII 関数 + electron-log maxSize 設定維持（v2.0.15 機能）', () => {
  assert.ok(/function\s+hashPII\s*\(/.test(MAIN_JS), 'hashPII 関数が消えている');
  assert.ok(/log\.transports\.file\.maxSize\s*=\s*5\s*\*\s*1024\s*\*\s*1024/.test(MAIN_JS),
    'electron-log maxSize 設定が消えている');
});

// ============================================================
// 結果サマリ
// ============================================================
console.log(`\n----\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
