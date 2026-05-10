/**
 * v2.1.14 静的解析テスト — BREAK 中スライドショー不発の構造同期 2 穴 + ログ過剰の根治
 *
 *   Fix 1: src/main.js `tournaments:setActive` ハンドラ末尾に
 *          `_publishDualState('structure', preset)` 経路追加（穴 2 根治）
 *   Fix 2: src/main.js `dual:state-sync-init` ハンドラに
 *          `snapshot.structure === null` ガード付きの structure 補完追加（穴 1 根治、本丸）
 *   Fix 3: src/renderer/renderer.js `render:tick:hall` ログを
 *          status / level 変化時のみ条件付き発火に変更（副次真因 = ログ過剰削減）
 *
 * 真因（穴 1 = 起動時）: `_dualStateCache.structure` の初期値 null →
 *   `dual:state-sync-init` ハンドラが structure を補完しない設計 →
 *   hall 側 setStructure(null) → currentStructure = null →
 *   isBreakLevel(idx) === false 確定 → ブレイク挿入が反映されず
 *   BREAK 中スライドショー起動条件を満たさない真因。
 *
 * 真因（穴 2 = 切替時）: `tournaments:setActive` ハンドラが structure を broadcast
 *   しない設計 → tournamentBasics 受信 → hall 側 loadPresetById async fallback の
 *   遅延の間、structure が前回のまま。
 *
 * 副次真因: render:tick:hall ログが v2.1.11 hall 60fps tick 副作用で 70Hz 発火
 *   （1412 件 / 20 秒）→ IPC 負荷でアプリ重さの一因 → 条件付き発火で数 Hz に圧縮。
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 *
 * 実行: node tests/v226-structure-hall-sync-2-holes.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// IPC ハンドラ本体（balanced brace）抽出ヘルパ
function extractIpcHandlerBody(source, channelName) {
  const re = new RegExp(`ipcMain\\.handle\\(['"]${channelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"][^,]*,\\s*[^=]*=>\\s*\\{`);
  const m = source.match(re);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

// ============================================================
// T1 (Fix 1): tournaments:setActive ハンドラ末尾に _publishDualState('structure', preset) 経路存在
// ============================================================
test('T1 (Fix 1): tournaments:setActive 内に _publishDualState("structure", preset) 経路存在', () => {
  const body = extractIpcHandlerBody(MAIN_JS, 'tournaments:setActive');
  assert.ok(body, 'tournaments:setActive ハンドラ本体が抽出できない');
  assert.match(body, /_publishDualState\s*\(\s*['"]structure['"]\s*,\s*preset\s*\)/,
    'tournaments:setActive 内に _publishDualState("structure", preset) broadcast がない（Fix 1 未実装）');
  // return 文より前に存在することを確認（順序保証）
  const returnIdx = body.indexOf('return { ...found');
  assert.ok(returnIdx >= 0, 'tournaments:setActive の return 文が見つからない');
  const broadcastIdx = body.indexOf("_publishDualState('structure', preset)");
  assert.ok(broadcastIdx >= 0 && broadcastIdx < returnIdx,
    'structure broadcast が return 文より後にある（実行されない位置）');
});

// ============================================================
// T2 (Fix 1): preset 検索が userPresets.find + BUILTIN_PRESETS.find の or フォールバック構造
// ============================================================
test('T2 (Fix 1): preset 検索が userPresets + BUILTIN_PRESETS の or フォールバック', () => {
  const body = extractIpcHandlerBody(MAIN_JS, 'tournaments:setActive');
  assert.ok(body, 'tournaments:setActive ハンドラ本体が抽出できない');
  assert.match(body, /userPresets\.find\([\s\S]*?p\.id\s*===\s*found\.blindPresetId[\s\S]*?\)\s*\|\|\s*BUILTIN_PRESETS\.find\([\s\S]*?p\.id\s*===\s*found\.blindPresetId/,
    'userPresets.find(...) || BUILTIN_PRESETS.find(...) の or フォールバック構造になっていない');
});

// ============================================================
// T3 (Fix 1): broadcast に Array.isArray(preset.levels) ガード（型安全）
// ============================================================
test('T3 (Fix 1): structure broadcast に Array.isArray(preset.levels) 型ガード', () => {
  const body = extractIpcHandlerBody(MAIN_JS, 'tournaments:setActive');
  assert.ok(body, 'tournaments:setActive ハンドラ本体が抽出できない');
  // Array.isArray(preset.levels) ガード → _publishDualState('structure', preset) の順序
  assert.match(body, /Array\.isArray\(preset\.levels\)[\s\S]{0,200}?_publishDualState\s*\(\s*['"]structure['"]/,
    'Array.isArray(preset.levels) ガード直後に _publishDualState("structure") が続いていない');
});

// ============================================================
// T4 (Fix 2): dual:state-sync-init ハンドラに snapshot.structure === null ガード付きの補完経路存在
// ============================================================
test('T4 (Fix 2): dual:state-sync-init 内に snapshot.structure === null ガード付き補完経路', () => {
  const body = extractIpcHandlerBody(MAIN_JS, 'dual:state-sync-init');
  assert.ok(body, 'dual:state-sync-init ハンドラ本体が抽出できない');
  // snapshot.structure === null ガード経路存在
  assert.match(body, /snapshot\.structure\s*===\s*null[\s\S]{0,500}?snapshot\.structure\s*=\s*preset/,
    'dual:state-sync-init に snapshot.structure === null ガード経路 + snapshot.structure = preset 補完がない');
});

// ============================================================
// T5 (Fix 2): T4 の補完が userPresets + BUILTIN_PRESETS 二段検索 + Array.isArray(preset.levels) ガード
// ============================================================
test('T5 (Fix 2): dual:state-sync-init の補完が二段検索 + 型ガード付き', () => {
  const body = extractIpcHandlerBody(MAIN_JS, 'dual:state-sync-init');
  assert.ok(body, 'dual:state-sync-init ハンドラ本体が抽出できない');
  // userPresets.find || BUILTIN_PRESETS.find の or フォールバック（active.blindPresetId 経由）
  assert.match(body, /userPresets\.find\([\s\S]*?p\.id\s*===\s*active\.blindPresetId[\s\S]*?\)\s*\|\|\s*BUILTIN_PRESETS\.find\([\s\S]*?p\.id\s*===\s*active\.blindPresetId/,
    'dual:state-sync-init の補完で userPresets + BUILTIN_PRESETS の or フォールバック構造になっていない');
  // Array.isArray(preset.levels) ガード
  assert.match(body, /Array\.isArray\(preset\.levels\)[\s\S]{0,200}?snapshot\.structure\s*=\s*preset/,
    'Array.isArray(preset.levels) 型ガード後に snapshot.structure = preset の代入が続いていない');
});

// ============================================================
// T6 (Fix 3): renderer.js render:tick:hall ログが status/level 変化時のみの条件付き発火
// ============================================================
test('T6 (Fix 3): render:tick:hall ログが status / level 変化時のみ条件付き発火', () => {
  // 'render:tick:hall' リテラルが log.write の引数として登場する位置を起点に、
  //   その直前 400 文字以内に status/level 変化条件が存在することを確認（regex バックトラッキング回避）
  const tickHallIdx = RENDERER.indexOf("'render:tick:hall'");
  assert.ok(tickHallIdx > 0, "'render:tick:hall' リテラル参照が renderer.js から消えている");
  const before = RENDERER.slice(Math.max(0, tickHallIdx - 400), tickHallIdx);
  assert.match(before, /state\.status\s*!==\s*prev\.status/,
    'render:tick:hall ログ直前に state.status !== prev.status の条件が存在しない（Fix 3 未実装）');
  assert.match(before, /state\.currentLevelIndex\s*!==\s*prev\.currentLevelIndex/,
    'render:tick:hall ログ直前に state.currentLevelIndex !== prev.currentLevelIndex の条件が存在しない（Fix 3 未実装）');
  // || で OR 結合されていること
  assert.match(before, /state\.status\s*!==\s*prev\.status\s*\|\|\s*state\.currentLevelIndex\s*!==\s*prev\.currentLevelIndex/,
    'status / level 変化条件が || で結合された条件付き発火になっていない');
});

// ============================================================
// T7 (Fix 3): T6 の条件付き発火が appRole === 'hall' ガードの内側
// ============================================================
test('T7 (Fix 3): 条件付き発火が appRole === "hall" ガードの内側で実装', () => {
  // 'render:tick:hall' リテラルの直前 400 文字に appRole === 'hall' ガード + status/level 変化条件が
  //   両方存在することを確認（appRole ガード内側に if ネストされた構造）
  const tickHallIdx = RENDERER.indexOf("'render:tick:hall'");
  assert.ok(tickHallIdx > 0, "'render:tick:hall' リテラル参照が renderer.js から消えている");
  const before = RENDERER.slice(Math.max(0, tickHallIdx - 400), tickHallIdx);
  assert.match(before, /window\.appRole\s*===\s*['"]hall['"]/,
    'render:tick:hall ログ直前に window.appRole === "hall" ガードが存在しない（operator 側不変保証）');
  // appRole === 'hall' が status/level 変化条件より前（外側）にあることを順序で検証
  const appRoleIdx = before.search(/window\.appRole\s*===\s*['"]hall['"]/);
  const conditionIdx = before.search(/state\.status\s*!==\s*prev\.status\s*\|\|/);
  assert.ok(appRoleIdx >= 0 && conditionIdx >= 0 && appRoleIdx < conditionIdx,
    'appRole === "hall" ガードが status/level 変化条件より外側（先）にネストされていない');
});

// ============================================================
// T8: package.json version 2.1.14 + scripts.test に v226 登録
// ============================================================
test('T8: package.json version は 2.1.14 + scripts.test に v226 登録', () => {
  assert.equal(PKG.version, '2.1.19-rc1',
    `package.json version が ${PKG.version}（期待 2.1.18）`);
  assert.match(PKG.scripts.test, /v226-structure-hall-sync-2-holes\.test\.js/,
    'scripts.test に v226-structure-hall-sync-2-holes.test.js が登録されていない');
});

// ============================================================
// T9: 致命バグ保護 5 件すべて維持
// ============================================================
test('T9: 致命バグ保護 5 件すべて維持', () => {
  // C.2.7-A: resetBlindProgressOnly が renderer.js に存在
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly が renderer.js から消えている');
  // C.2.7-D: tournaments:setDisplaySettings の timerState destructure 除外
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラが消えている');
  // C.1-A2: ensureEditorEditableState が renderer.js に存在
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState が renderer.js から消えている');
  // C.1.7: AudioContext suspend resume 経路が audio.js _play に存在
  assert.match(AUDIO_JS, /audioContext\.state\s*===\s*['"]suspended['"]/,
    'C.1.7: AudioContext suspend 検出が audio.js から消えている');
  // C.1.8: tournaments:setRuntime IPC が main.js に存在
  assert.match(MAIN_JS, /tournaments:setRuntime/,
    'C.1.8: tournaments:setRuntime IPC が main.js から消えている');
  // schedulePersistRuntime 8 箇所以上
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `C.1.8: schedulePersistRuntime 呼出が ${calls} 件（期待 8 以上）`);
});

// ============================================================
// T10: v2.1.6〜v2.1.13 機構（hallPreStartState / hallTickState / data-status セット）touch なし
// ============================================================
test('T10: v2.1.6〜v2.1.13 機構（hall PRE_START / hall 60fps tick / data-status）touch なし', () => {
  // hallPreStartState / hallTickState 状態オブジェクト維持
  assert.match(RENDERER, /const\s+hallPreStartState\s*=\s*\{/,
    'hallPreStartState 定義が消えている（v2.1.6 機構の core）');
  assert.match(RENDERER, /const\s+hallTickState\s*=\s*\{/,
    'hallTickState 定義が消えている（v2.1.11 60fps tick の core）');
  // renderHallPreStartTick / renderHallTickFrame 関数維持
  assert.match(RENDERER, /function\s+renderHallPreStartTick\s*\(/,
    'renderHallPreStartTick 関数が消えている');
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/,
    'renderHallTickFrame 関数が消えている');
  // v2.1.13 で確立した el.clock.dataset.status = 'PRE_START' セット維持
  assert.match(RENDERER, /el\.clock\.dataset\.status\s*=\s*['"]PRE_START['"]/,
    'v2.1.13 で確立した el.clock.dataset.status = "PRE_START" セットが消えている');
  // v2.1.13 解除経路（IDLE 復元 + delete prestartFormat）維持
  assert.match(RENDERER, /el\.clock\.dataset\.status\s*=\s*['"]IDLE['"]/,
    'v2.1.13 解除経路の el.clock.dataset.status = "IDLE" 復元が消えている');
  assert.match(RENDERER, /delete\s+el\.clock\.dataset\.prestartFormat/,
    'v2.1.13 解除経路の delete el.clock.dataset.prestartFormat が消えている');
  // v2.1.12 で確立した el.time.textContent = formatPreStartTime 経路維持
  assert.match(RENDERER, /el\.time\.textContent\s*=\s*formatPreStartTime/,
    'v2.1.12 で確立した el.time.textContent = formatPreStartTime 経路が消えている');
  // v2.1.12 で確立した userOverride='auto' リセット経路維持
  assert.match(RENDERER, /slideshowState\.userOverride\s*=\s*['"]auto['"]/,
    'v2.1.12 で確立した userOverride = "auto" リセット経路が消えている');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
