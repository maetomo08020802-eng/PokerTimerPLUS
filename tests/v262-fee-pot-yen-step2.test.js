/**
 * v2.6.0 fee-pot-yen STEP 2 — プール $拠出 UI + 通貨 $（店内通貨）
 *
 * STEP 2 範囲:
 *   - フィー隣「反映率%」入力 → 「1件あたり拠出 $」入力（label/attrs/unit）
 *   - ハウス既定 %→$（potDefaults、settings:setPotDefaults）
 *   - 通貨既定 ¥→$（新規 + 既存 '¥' 読み替え migration、カスタム記号不可侵）
 *   - computeTotalPoolFromForm / 保存ビルド / フォーム同期 / ハウス既定保存 を $ 直読みに
 *
 * 致命バグ保護 5 件は独立。pool 数値は STEP 1 の potAmounts で確定済（本 STEP は UI/通貨）。
 * 実行: node tests/v262-fee-pot-yen-step2.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const INDEX    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// index.html: $拠出 UI
// ============================================================
test('I1: フィー隣 POT 入力 3 件が「1件あたり拠出」label + min0/step100（max なし）+ 単位 $', () => {
  // 「1件あたり拠出」label が 3 件以上（フィー3 + ハウス既定 1）
  const labels = (INDEX.match(/1件あたり拠出/g) || []).length;
  assert.ok(labels >= 3, `「1件あたり拠出」label が ${labels} 件（3 以上期待）`);
  // tournament POT 入力に js-pot-unit（通貨同期）が 3 件
  assert.equal((INDEX.match(/class="[^"]*js-pot-unit[^"]*"/g) || []).length, 3, 'js-pot-unit が 3 件でない');
  // 旧「反映率」label が消えている
  assert.ok(!/>反映率/.test(INDEX), '旧「反映率」label が残存');
});

test('I2: 通貨記号 placeholder が $（店内通貨）', () => {
  assert.match(INDEX, /id="js-tournament-currency"[^>]*placeholder="\$"/, '通貨 placeholder が $ でない');
  assert.ok(!/id="js-tournament-currency"[^>]*placeholder="¥"/.test(INDEX), '通貨 placeholder に旧 ¥ が残存');
});

test('I3: ハウス既定が「1件あたり拠出（$）」+ 単位 $（旧 %プール率 表記撤去）', () => {
  assert.ok(INDEX.includes('店舗デフォルト 1件あたり拠出'), 'ハウス既定 label が $拠出 になっていない');
  assert.ok(!/店舗デフォルト プール率/.test(INDEX), '旧「店舗デフォルト プール率」が残存');
});

// ============================================================
// renderer
// ============================================================
test('R1: _readPotFromInput 定義（非負整数・100 上限 clamp 廃止）', () => {
  assert.match(RENDERER, /function\s+_readPotFromInput\s*\(/, '_readPotFromInput 定義なし');
  const i = RENDERER.indexOf('function _readPotFromInput');
  const body = RENDERER.slice(i, i + 300);
  assert.ok(!/Math\.min\(100/.test(body), '_readPotFromInput に旧 100 上限 clamp が残存');
  assert.ok(!/_readPoolRateFromInput/.test(RENDERER), '旧 _readPoolRateFromInput が残存');
});

test('R2: computeTotalPoolFromForm が Σ(POT×件数)（rate/100 不使用）', () => {
  const i = RENDERER.indexOf('function computeTotalPoolFromForm');
  const body = RENDERER.slice(i, i + 1200);
  assert.match(body, /buyInPot\s*\*\s*tournamentRuntime\.playersInitial/, 'POT×件数 計算がない');
  assert.ok(!/\/\s*100/.test(body), 'rate/100 計算が残存');
});

test('R3: ハウス既定保存が settings.setPotDefaults を使用（setPoolRatesDefault 依存撤去）', () => {
  const i = RENDERER.indexOf('function handleAppPotDefaultSave');
  const body = RENDERER.slice(i, i + 1500);
  assert.match(body, /window\.api\.settings\.setPotDefaults/, 'setPotDefaults 呼出がない');
  assert.match(body, /result\.potDefaults/, 'result.potDefaults 参照がない');
});

test('R4: 通貨既定が $（tournamentState 既定 + フォールバック）', () => {
  assert.match(RENDERER, /currencySymbol:\s*'\$'/, "tournamentState 既定 currencySymbol が '$' でない");
  assert.ok(!/\|\|\s*'¥'/.test(RENDERER), "renderer に '¥' フォールバックが残存");
});

test('R5: refreshPotUnitLabels 定義（.js-pot-unit を通貨記号に同期）', () => {
  assert.match(RENDERER, /function\s+refreshPotUnitLabels\s*\(/, 'refreshPotUnitLabels 定義なし');
  assert.match(RENDERER, /querySelectorAll\('\.js-pot-unit'\)/, '.js-pot-unit 同期がない');
});

// ============================================================
// main + preload
// ============================================================
test('M1: settings:setPotDefaults ハンドラ（potDefaults 保存）', () => {
  assert.match(MAIN_JS, /ipcMain\.handle\('settings:setPotDefaults'/, 'setPotDefaults ハンドラなし');
  const i = MAIN_JS.indexOf("ipcMain.handle('settings:setPotDefaults'");
  const body = MAIN_JS.slice(i, i + 400);
  assert.match(body, /sanitizePotAmounts/, 'setPotDefaults が sanitizePotAmounts を使っていない');
  assert.match(body, /potDefaults:\s*sanitized/, 'appConfig.potDefaults 保存がない');
});

test('M2: currency ¥→$ migration（リテラル ¥ のみ置換・カスタム不可侵）', () => {
  const i = MAIN_JS.indexOf('function migrateTournamentSchema(s)');
  const body = MAIN_JS.slice(i, i + 10000);
  assert.match(body, /m\.currencySymbol\s*===\s*'¥'/, 'currency ¥ 完全一致判定がない');
  assert.match(body, /m\.currencySymbol\s*=\s*'\$'/, 'currency → $ 置換がない');
});

test('M3: currency 既定が $（store default / normalize default）', () => {
  assert.match(MAIN_JS, /if\s*\(typeof out\.currencySymbol\s*!==\s*'string'\)\s*out\.currencySymbol\s*=\s*'\$'/,
    'normalizeTournament の currency 既定が $ でない');
});

test('P1: preload が settings.setPotDefaults を公開', () => {
  assert.match(PRELOAD, /setPotDefaults:\s*\(value\)\s*=>/, 'preload に setPotDefaults がない');
});

// ============================================================
// 保護
// ============================================================
test('S1 (保護): 致命バグ保護（resetBlindProgressOnly / ensureEditorEditableState）維持', () => {
  assert.ok(/function\s+resetBlindProgressOnly\s*\(/.test(RENDERER), 'resetBlindProgressOnly 消失');
  assert.ok(/function\s+ensureEditorEditableState\s*\(/.test(RENDERER), 'ensureEditorEditableState 消失');
  // 注: fee-lock（🔒）は STEP 4（E-1）で撤去済。本 STEP2 テストでは存続を要求しない（v264 が撤去を担保）。
});

test('S2: version 2.6.0（配信 bump 済）+ v262 登録', () => {
  assert.equal(PKG.version, '2.7.0', `version が ${PKG.version}`);
  assert.ok(PKG.scripts.test.includes('v262-fee-pot-yen-step2.test.js'), 'v262 未登録');
});

console.log(`\nv262-fee-pot-yen-step2.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
