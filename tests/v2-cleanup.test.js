/**
 * v2.0.3 Cleanup — 残提案項目 + 検証項目修正の静的解析テスト
 *
 * 対象 Fix:
 *   P2  refreshPresetList: フィルタ後 option 不在時に value をクリア
 *   P3  sanitizeBreakImages: partial update に含まれない場合は cur.breakImages 直接維持
 *   P4  app.on('will-quit') の二重登録を 1 ハンドラに統合（globalShortcut.unregisterAll を統合）
 *   L   captureCurrentTimerState: PRE_START 中は idle 相当として保存（スリープ復帰の race 防止）
 *   M   EXPORT_VERSION_RENDERER を main.js EXPORT_VERSION (=2) と同期（PC 間移行致命バグ修正）
 *
 * 実行: node tests/v2-cleanup.test.js
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
// P2: refreshPresetList が「フィルタ後 option 不在 → value クリア」する
// ============================================================
test('P2: refreshPresetList が meta 不在時に el.presetSelect.value = "" を設定', () => {
  // refreshPresetList 関数本体を抽出
  const m = RENDERER.match(/async function refreshPresetList\s*\(\s*\)\s*\{/);
  assert.ok(m, 'refreshPresetList が見つからない');
  let depth = 1, i = m.index + m[0].length;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++;
    else if (RENDERER[i] === '}') depth--;
    i++;
  }
  const body = RENDERER.slice(m.index, i);
  // meta 一致時の if 分岐の else に value = '' クリアがある
  assert.match(body,
    /\}\s*else\s*\{[\s\S]*?el\.presetSelect\.value\s*=\s*['"]['"]/,
    'refreshPresetList の meta 不在 else 分岐で el.presetSelect.value クリアなし');
});

// ============================================================
// P3: 部分更新で breakImages 既存値を直接維持（v2.5.0: setTournamentImages へ移設）
// ============================================================
test('P3: setTournamentImages の breakImages 部分更新が既存値を直接維持（v2.5.0 画像分離後）', () => {
  // v2.5.0: 画像（backgroundImage / breakImages）は tournament-images.json へ分離。
  //   旧 setDisplaySettings の breakImages 三項保護（partial update で既存値を再 sanitize せず直接維持し、
  //   5MB 上限導入前データの silent drop を防ぐ）は setTournamentImages へ移設。保護意図は不変。
  assert.match(MAIN, /function setTournamentImages\(/, 'setTournamentImages（画像専用ストア書込）が見つからない');
  // 既定の next.breakImages は cur.breakImages を直接（Array.isArray チェックのみ、再 sanitize しない）
  assert.match(MAIN, /breakImages:\s*Array\.isArray\(cur\.breakImages\)\s*\?\s*cur\.breakImages\s*:\s*\[\]/,
    'breakImages 既定が cur.breakImages 直接維持になっていない（partial update での silent drop リスク）');
  // sanitizeBreakImages は patch に breakImages が含まれる時のみ呼ぶ
  assert.match(MAIN, /['"]breakImages['"]\s*in\s*patch/,
    'breakImages の patch 判定（含まれる時のみ更新）が無い');
});

// ============================================================
// P4: app.on('will-quit') が 1 個のみ
// ============================================================
test('P4: app.on(\'will-quit\') が 1 ハンドラのみ（重複登録なし）', () => {
  const matches = MAIN.match(/app\.on\(\s*['"]will-quit['"]/g) || [];
  assert.equal(matches.length, 1,
    `app.on('will-quit') が ${matches.length} 個（1 個に統合のはず）`);
});

test('P4: 統合された will-quit ハンドラ内で globalShortcut.unregisterAll が呼ばれる', () => {
  // will-quit ハンドラの本体に unregisterAll が含まれる
  const m = MAIN.match(/app\.on\(\s*['"]will-quit['"][\s\S]*?\}\s*\)/);
  assert.ok(m, 'will-quit ハンドラが見つからない');
  assert.match(m[0], /globalShortcut\.unregisterAll/,
    '統合された will-quit に globalShortcut.unregisterAll なし（統合漏れ）');
  assert.match(m[0], /powerSaveBlocker\.stop/,
    '統合された will-quit に powerSaveBlocker.stop なし（既存ロジック消失）');
});

// ============================================================
// L: captureCurrentTimerState が PRE_START を idle 相当に保存
// ============================================================
test('L: captureCurrentTimerState が PRE_START を idle 相当として保存（スリープ race 防止）', () => {
  const m = RENDERER.match(/function captureCurrentTimerState\s*\(\s*\)\s*\{/);
  assert.ok(m, 'captureCurrentTimerState が見つからない');
  let depth = 1, i = m.index + m[0].length;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++;
    else if (RENDERER[i] === '}') depth--;
    i++;
  }
  const body = RENDERER.slice(m.index, i);
  // 関数冒頭で States.PRE_START を判定して early return
  assert.match(body, /s\.status\s*===\s*States\.PRE_START/,
    'captureCurrentTimerState 内に States.PRE_START 判定なし');
  assert.match(body, /States\.PRE_START[\s\S]*?return\s*\{[^}]*status:\s*['"]idle['"]/,
    'PRE_START 判定 → idle 相当の return がない');
});

// ============================================================
// M: EXPORT_VERSION_RENDERER が main.js EXPORT_VERSION と同期
// ============================================================
test('M: EXPORT_VERSION_RENDERER が main.js EXPORT_VERSION と一致', () => {
  // main.js の EXPORT_VERSION を取得
  const mainM = MAIN.match(/const\s+EXPORT_VERSION\s*=\s*(\d+)/);
  assert.ok(mainM, 'main.js に EXPORT_VERSION 定義なし');
  const mainVersion = mainM[1];
  // renderer.js の EXPORT_VERSION_RENDERER を取得
  const rendM = RENDERER.match(/const\s+EXPORT_VERSION_RENDERER\s*=\s*(\d+)/);
  assert.ok(rendM, 'renderer.js に EXPORT_VERSION_RENDERER 定義なし');
  const rendVersion = rendM[1];
  // 一致確認
  assert.equal(rendVersion, mainVersion,
    `EXPORT_VERSION_RENDERER (${rendVersion}) が main.js EXPORT_VERSION (${mainVersion}) と不一致`);
});

// ============================================================
// 致命バグ保護 5 件 — cross-check（影響なし確認）
// ============================================================
test('致命バグ保護 cross-check: schedulePersistRuntime / setRuntime / sanitizeRuntime が維持', () => {
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'schedulePersistRuntime 関数なし（C.1.8 違反）');
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/, 'tournaments:setRuntime IPC なし（C.1.8 違反）');
  assert.match(MAIN, /function\s+sanitizeRuntime\s*\(/, 'sanitizeRuntime 関数なし（C.1.8 違反）');
});

test('致命バグ保護 cross-check: resetBlindProgressOnly は tournamentRuntime に触らない（C.2.7-A）', () => {
  const m = RENDERER.match(/function\s+resetBlindProgressOnly\s*\(\s*\)\s*\{/);
  assert.ok(m, 'resetBlindProgressOnly が見つからない');
  let depth = 1, i = m.index + m[0].length;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++;
    else if (RENDERER[i] === '}') depth--;
    i++;
  }
  const body = RENDERER.slice(m.index, i);
  assert.doesNotMatch(body, /tournamentRuntime\.\w+\s*=/,
    'resetBlindProgressOnly が tournamentRuntime を変更している（C.2.7-A 違反）');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
