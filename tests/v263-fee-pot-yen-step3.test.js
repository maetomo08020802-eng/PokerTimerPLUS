/**
 * v2.6.0 fee-pot-yen STEP 3 — 配当 % 撤去（金額固定）+ §5 自然解消
 *
 * STEP 3 範囲:
 *   - payout-mode toggle（% / 金額）を UI から撤去 → 配当は常に金額（店内通貨 $）入力
 *   - payoutInputMode 常時 'amount'、% 分岐コード撤去（updatePayoutsSum/renderPayoutsEditor/
 *     readPayoutsFromForm/isPayoutsValid から % 経路を除去）
 *   - §5 解消: TOTAL POOL = max(Σ POT×件数, GTD) を無改造流用、isPayoutsValid は「合計≒pool」を流用
 *   - computeRoundedAmounts の % 分岐は「既存 % トーナメントの後方表示」用に残置（撤去しない）
 *
 * 致命バグ保護 5 件は独立。実行: node tests/v263-fee-pot-yen-step3.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const INDEX    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// % 撤去（UI）
// ============================================================
test('I1: payout-mode toggle（% / 金額 切替）が index.html から撤去', () => {
  assert.ok(!/id="js-tournament-payout-mode"/.test(INDEX), 'payout-mode toggle が残存');
  assert.ok(!/name="payout-mode"/.test(INDEX), 'payout-mode radio が残存');
  assert.ok(!/% で入力/.test(INDEX), '「% で入力」ラベルが残存');
  // 金額入力の案内が存在
  assert.ok(/配当は金額（店内通貨）で入力します/.test(INDEX), '金額入力の案内文言がない');
});

test('I2: payouts-mode-toggle CSS が撤去（デッド CSS 除去）', () => {
  assert.ok(!/\.payouts-mode-toggle\s*\{/.test(STYLE), '.payouts-mode-toggle CSS が残存');
  assert.ok(!/\.payouts-mode-row\s*\{/.test(STYLE), '.payouts-mode-row CSS が残存');
});

// ============================================================
// % 撤去（renderer）
// ============================================================
test('R1: payoutInputMode は常時 amount（init + tab-open）+ toggle 参照撤去', () => {
  assert.ok(/let\s+payoutInputMode\s*=\s*'amount'/.test(RENDERER), "init が payoutInputMode='amount' でない");
  assert.ok(/payoutInputMode\s*=\s*'amount';/.test(RENDERER), "tab-open の payoutInputMode='amount' がない");
  assert.ok(!/getElementById\('js-tournament-payout-mode'\)/.test(RENDERER), 'payout-mode toggle el 参照が残存');
  assert.ok(!/tournamentPayoutMode\?\.addEventListener/.test(RENDERER), 'payout-mode 切替ハンドラが残存');
});

test('R2: % 分岐コードが撤去（updatePayoutsSum / isPayoutsValid から % 経路除去）', () => {
  // updatePayoutsSum に「100% にしてください」% 経路が無い
  const sumIdx = RENDERER.indexOf('function updatePayoutsSum');
  const sumBody = RENDERER.slice(sumIdx, sumIdx + 1200);
  assert.ok(!/100%\s*にしてください/.test(sumBody), 'updatePayoutsSum に旧 % 経路が残存');
  // isPayoutsValid に「=== 100」% 判定が無い
  const valIdx = RENDERER.indexOf('function isPayoutsValid');
  const valBody = RENDERER.slice(valIdx, valIdx + 600);
  assert.ok(!/sum\s*-\s*100/.test(valBody) && !/-\s*100\)\s*<\s*0\.01/.test(valBody),
    'isPayoutsValid に旧 % (===100) 判定が残存');
  assert.ok(/Math\.abs\(sum\s*-\s*pool\)\s*<\s*1/.test(valBody), 'isPayoutsValid の 合計≒pool 判定がない');
});

test('R3: 保存メッセージが金額向け（「100% にしてください」撤去）', () => {
  assert.ok(/賞金配当の合計をプール額に合わせてください/.test(RENDERER), '金額向け保存メッセージがない');
  assert.ok(!/賞金構造の合計を 100% にしてください/.test(RENDERER), '旧 % 保存メッセージが残存');
});

// ============================================================
// §5 解消 + 後方表示の維持
// ============================================================
test('R4 (§5 解消): TOTAL POOL = max(Σ POT×件数, GTD) を無改造流用（特別分岐なし）', () => {
  // computeTotalPool は max(computeCalculatedPool, gtd) のまま
  const i = RENDERER.indexOf('function computeTotalPool(');
  const body = RENDERER.slice(i, i + 300);
  assert.ok(/Math\.max\(calc,\s*gtd\)/.test(body), 'computeTotalPool が max(calc, gtd) でない');
  // isPayoutsValid は pool（POT 由来）に対する 合計≒pool（§5 は法令判断なしで解消）
  assert.ok(/computeTotalPoolFromForm\(\)/.test(RENDERER), 'isPayoutsValid 等の pool 参照がない');
});

test('R5 (後方表示): computeRoundedAmounts の % 分岐は残置（既存 % トーナメント表示用）', () => {
  const i = RENDERER.indexOf('function computeRoundedAmounts()');
  const body = RENDERER.slice(i, i + 1600);
  // payoutMode==='amount' 分岐（固定）と、% フォールバック（最大剰余法）が両方存在
  assert.ok(/tournamentState\.payoutMode\s*===\s*'amount'/.test(body), '金額固定分岐が消えている');
  assert.ok(/remainders/.test(body), '% フォールバック（最大剰余法）が消えている（後方表示が壊れる）');
});

test('R6: buildTournamentForm の payoutMode は amount（金額固定保存）', () => {
  assert.ok(/payoutMode:\s*\(payoutInputMode\s*===\s*'amount'\)\s*\?\s*'amount'\s*:\s*'percent'/.test(RENDERER)
    || /payoutMode:\s*'amount'/.test(RENDERER), '保存ビルドの payoutMode が amount にならない');
});

// ============================================================
// 保護
// ============================================================
test('S1 (保護): 致命バグ保護 5 件維持（fee-lock は STEP4/E-1 で撤去済）', () => {
  assert.ok(/function\s+resetBlindProgressOnly\s*\(/.test(RENDERER), 'resetBlindProgressOnly 消失');
  assert.ok(/function\s+ensureEditorEditableState\s*\(/.test(RENDERER), 'ensureEditorEditableState 消失');
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `schedulePersistRuntime 呼出が ${calls} 件（8 以上期待）`);
  // 注: fee-lock（🔒）は STEP 4（E-1）で撤去済。存続を要求しない（v264 が撤去を担保）。
});

test('S2: version 2.6.0（配信 bump 済）+ v263 登録', () => {
  assert.equal(PKG.version, '2.6.5', `version が ${PKG.version}`);
  assert.ok(PKG.scripts.test.includes('v263-fee-pot-yen-step3.test.js'), 'v263 未登録');
});

console.log(`\nv263-fee-pot-yen-step3.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
