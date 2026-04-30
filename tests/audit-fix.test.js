/**
 * STEP 10 フェーズC.2.7-audit-fix — UI 監査修正の回帰防止テスト
 *
 * 修正項目:
 *   1. ブレイクラベル削除（CSS display: none）
 *   2. powerSaveBlocker（RUNNING/PRE_START/BREAK 中はディスプレイスリープ抑止）
 *   3. import 時の UTF-8 BOM ストリップ
 *   4. marquee テキスト 200 文字上限（main.js）
 *   5. tournament 削除の二重起動防止
 *
 * 実行: node tests/audit-fix.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: ブレイクラベルが CSS で display:none されている
// ============================================================
test('T1: .clock__break-label が display:none（前原さん要望で削除）', () => {
  // .clock__break-label { ... display: none ... } のブロックを抽出
  const m = STYLE.match(/\.clock__break-label\s*\{[^}]*\}/);
  assert.ok(m, '.clock__break-label のルールが見つからない');
  assert.match(m[0], /display\s*:\s*none/, '.clock__break-label に display:none が設定されていない');
});

// ============================================================
// T2: powerSaveBlocker IPC ハンドラが定義されている
// ============================================================
test('T2: main.js に power:preventDisplaySleep IPC ハンドラが定義されている', () => {
  assert.match(
    MAIN,
    /ipcMain\.handle\(\s*['"]power:preventDisplaySleep['"]/,
    'power:preventDisplaySleep IPC ハンドラが見つからない'
  );
  assert.match(
    MAIN,
    /ipcMain\.handle\(\s*['"]power:allowDisplaySleep['"]/,
    'power:allowDisplaySleep IPC ハンドラが見つからない'
  );
  assert.match(MAIN, /powerSaveBlocker\.start/, 'powerSaveBlocker.start の呼び出しが見つからない');
  assert.match(MAIN, /powerSaveBlocker\.stop/, 'powerSaveBlocker.stop の呼び出しが見つからない');
});

// ============================================================
// T3: preload.js が power API を公開している
// ============================================================
test('T3: preload.js に power.preventDisplaySleep / allowDisplaySleep が公開されている', () => {
  assert.match(PRELOAD, /preventDisplaySleep/, 'preventDisplaySleep が preload に公開されていない');
  assert.match(PRELOAD, /allowDisplaySleep/, 'allowDisplaySleep が preload に公開されていない');
});

// ============================================================
// T4: renderer.js が syncPowerSaveBlocker を subscribe で呼んでいる
// ============================================================
test('T4: renderer.js の subscribe 内で syncPowerSaveBlocker が呼ばれる', () => {
  assert.match(RENDERER, /function\s+syncPowerSaveBlocker\s*\(/, 'syncPowerSaveBlocker 関数が定義されていない');
  // subscribe 内に呼び出しがあるか
  const subscribeBlock = RENDERER.match(/subscribe\(\(state, prev\) => \{[\s\S]+?\}\);/);
  assert.ok(subscribeBlock, 'subscribe ブロックが見つからない');
  assert.match(subscribeBlock[0], /syncPowerSaveBlocker\s*\(/, 'subscribe 内で syncPowerSaveBlocker が呼ばれていない');
});

// ============================================================
// T5: BOM ストリップヘルパが定義され、import で使われている
// ============================================================
test('T5: stripBom ヘルパが renderer.js に定義され import で使われている', () => {
  assert.match(RENDERER, /function\s+stripBom\s*\(/, 'stripBom 関数が定義されていない');
  // 0xFEFF 検出のロジック
  assert.match(RENDERER, /0xFEFF/, 'BOM コードポイント (0xFEFF) のチェックがない');
});

// ============================================================
// T6: main.js も BOM をストリップしてから JSON.parse する
// ============================================================
test('T6: main.js の readImportFile が BOM を除去してから parse する', () => {
  // ハンドラ宣言から JSON.parse 行までの範囲で 0xFEFF チェックの存在を確認
  const idx = MAIN.indexOf("'tournaments:readImportFile'");
  assert.ok(idx >= 0, 'readImportFile ハンドラの宣言が見つからない');
  const parseIdx = MAIN.indexOf('JSON.parse', idx);
  assert.ok(parseIdx > idx, 'JSON.parse が readImportFile 後に見つからない');
  const slice = MAIN.slice(idx, parseIdx + 50);
  assert.match(slice, /0xFEFF/, 'readImportFile 内で BOM チェックがされていない');
});

// ============================================================
// T7: marquee テキストの 200 文字上限が main.js で強制されている
// ============================================================
test('T7: sanitizeMarqueeSettings がテキストを 200 文字までで slice する', () => {
  assert.match(MAIN, /MARQUEE_TEXT_MAX\s*=\s*200/, 'MARQUEE_TEXT_MAX = 200 が定義されていない');
  // sanitizeMarqueeSettings 内で slice が呼ばれている
  const fn = MAIN.match(/function\s+sanitizeMarqueeSettings[\s\S]+?\n\}/);
  assert.ok(fn, 'sanitizeMarqueeSettings 関数が見つからない');
  assert.match(fn[0], /\.slice\(0,\s*MARQUEE_TEXT_MAX\)/, 'sanitizeMarqueeSettings 内で slice が使われていない');
});

// ============================================================
// T8: index.html の textarea に maxlength="200" が設定されている
// ============================================================
test('T8: js-marquee-text の textarea に maxlength="200" 属性がある', () => {
  const m = HTML.match(/<textarea[^>]*id=["']js-marquee-text["'][^>]*>/);
  assert.ok(m, 'js-marquee-text の textarea が見つからない');
  assert.match(m[0], /maxlength=["']200["']/, 'js-marquee-text に maxlength="200" がない');
});

// ============================================================
// T9: tournament 削除の二重起動防止フラグが定義されている
// ============================================================
test('T9: handleTournamentRowDelete に _tournamentDeleteInFlight ガードがある', () => {
  assert.match(RENDERER, /_tournamentDeleteInFlight/, '_tournamentDeleteInFlight フラグが見つからない');
  // try/finally で確実にリセット
  const fn = RENDERER.match(/async function handleTournamentRowDelete[\s\S]+?\n\}/);
  assert.ok(fn, 'handleTournamentRowDelete 関数が見つからない');
  assert.match(fn[0], /finally\s*\{[\s\S]*?_tournamentDeleteInFlight\s*=\s*false/, 'finally ブロックでフラグがリセットされていない');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
