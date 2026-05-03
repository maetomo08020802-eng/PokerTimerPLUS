/**
 * v2.0.4-rc19 タスク 2（問題 ⑥ 残部修正）静的解析テスト
 *
 * 対象修正:
 *   タスク 2（案 ⑥-A）: main.js の tournaments:save ハンドラ publish payload に
 *                        structure: validated.structure を直接同梱。
 *                        renderer.js の dual-sync 受信側で value.structure があれば
 *                        setStructure を直接呼び、無ければ既存 loadPresetById フォールバック。
 *
 * 実行: node tests/v204-rc19-structure-payload.test.js
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
// タスク 2: main.js publish payload に structure 同梱 + renderer.js 受信側
// ============================================================

test('T5: main.js の tournaments:save ハンドラ周辺で publish payload に structure: validated.structure 同梱', () => {
  // tournaments:save ハンドラ内の _publishDualState('tournamentBasics', ...) ブロックで
  // payload に structure: validated.structure キーを含む
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:save['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'tournaments:save ハンドラが見つからない');
  // ハンドラ内に _publishDualState('tournamentBasics', { ... structure: validated.structure ... })
  const re = /_publishDualState\(\s*['"]tournamentBasics['"]\s*,\s*\{[\s\S]*?structure\s*:\s*validated\.structure[\s\S]*?\}\s*\)/;
  assert.match(m[0], re,
    'tournaments:save の _publishDualState(tournamentBasics, {...}) payload に structure: validated.structure が同梱されていない（案 ⑥-A 不在）');
});

test('T6: renderer.js dual-sync handler kind === "tournamentBasics" 経路で value.structure 分岐が存在', () => {
  // value.structure && typeof value.structure === 'object' のガード分岐が含まれる
  const re = /kind\s*===\s*['"]tournamentBasics['"][\s\S]*?value\.structure\s*&&\s*typeof\s+value\.structure\s*===\s*['"]object['"]/;
  assert.match(RENDERER, re,
    'tournamentBasics 経路で value.structure 分岐が見つからない（案 ⑥-A 受信側不在）');
});

test('T7: renderer.js dual-sync handler で fallback 経路（loadPresetById）が維持', () => {
  // value.structure 分岐の後ろに else if (typeof t.blindPresetId === 'string' ...) loadPresetById(t.blindPresetId) が続く
  const re = /value\.structure\s*&&\s*typeof\s+value\.structure\s*===\s*['"]object['"][\s\S]*?else\s+if\s*\(\s*typeof\s+t\.blindPresetId\s*===\s*['"]string['"][\s\S]*?loadPresetById\s*\(\s*t\.blindPresetId\s*\)/;
  assert.match(RENDERER, re,
    'value.structure 分岐の fallback (else if loadPresetById) 経路が見つからない（rc18 第 1 弾経路破壊）');
});

// ============================================================
// version assertion（rc19）
// ============================================================

test('version: package.json は 2.0.4-rc23', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.4-rc23',
    `package.json version が ${pkg.version}（期待 2.0.4-rc23）`);
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
