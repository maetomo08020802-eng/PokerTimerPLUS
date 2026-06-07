/**
 * v2.5.2 payout-amount-default — 金額固定 + 初期値金額 + ％端数根治
 *
 * 確定部分（やること1〜4。§5 の TOTAL POOL 表示分岐 / isPayoutsValid 緩和は前原確定後・別 plan）:
 *   1. 金額モード = payoutMode==='amount' で入力額を固定（pool 変動でもドリフトしない）
 *   2. 初期値 = 金額（新規トーナメント newT に payoutMode:'amount'、編集開きは payoutMode に同期）
 *   3. ％モード = 従来どおりプール比例（挙動不変）
 *   4. ％端数根治 = 最大剰余法で per-rank が綺麗に着地、合計 === pool 維持
 *   + payoutMode 永続化（schema / migration 推論 / normalize / read 同梱）
 *
 * 致命バグ保護 5 件は独立（影響なし）。
 * 実行: node tests/v260-payout-amount-default.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 実コード computeRoundedAmounts と同一ロジックの再実装（手動同期）
function simulate(pool, rounding, payouts, mode) {
  if (payouts.length === 0 || pool <= 0) return payouts.map(() => 0);
  if (mode === 'amount') {
    return payouts.map((p) =>
      (Number.isFinite(p.amount) && p.amount >= 0)
        ? p.amount
        : Math.floor(pool * (Number(p.percentage) || 0) / 100 / rounding) * rounding);
  }
  const raws    = payouts.map((p) => pool * (Number(p.percentage) || 0) / 100);
  const amounts = raws.map((raw) => Math.floor(raw / rounding) * rounding);
  const remainders = raws.map((raw, i) => raw - amounts[i]);
  const order = payouts.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a]);
  let units = Math.floor((pool - amounts.reduce((s, v) => s + v, 0)) / rounding);
  for (let k = 0; units > 0 && order.length > 0; k++, units--) {
    amounts[order[k % order.length]] += rounding;
  }
  const residual = pool - amounts.reduce((s, v) => s + v, 0);
  if (residual !== 0 && amounts.length > 0) amounts[order.length > 0 ? order[0] : 0] += residual;
  return amounts;
}

// ============================================================
// 動作: 金額モード固定
// ============================================================
test('B1: 金額モードは開き直し・pool 変動でドリフトしない（症状の根治）', () => {
  const p = [{ rank: 1, percentage: 66.67, amount: 100000 }, { rank: 2, percentage: 33.33, amount: 50000 }];
  // pool=150000（保存時）も pool=180000（人数増）も入力額固定
  assert.deepEqual(simulate(150000, 100, p, 'amount'), [100000, 50000]);
  assert.deepEqual(simulate(180000, 100, p, 'amount'), [100000, 50000]);
  assert.deepEqual(simulate(150000, 1, p, 'amount'), [100000, 50000], '¥1 丸めでも固定額はズレない');
});

// ============================================================
// 動作: ％端数根治（最大剰余法）
// ============================================================
test('B2: ％モードの 100005/49995 ズレが最大剰余法で綺麗に着地（rounding=100）', () => {
  const p = [{ rank: 1, percentage: 66.67 }, { rank: 2, percentage: 33.33 }];
  const r = simulate(150000, 100, p, 'percent');
  assert.deepEqual(r, [100000, 50000], `期待 [100000,50000], 実 ${JSON.stringify(r)}`);
  assert.equal(r.reduce((s, v) => s + v, 0), 150000, '合計 = pool 維持');
});

test('B3: ％モードは合計 === pool を厳密維持（pool が rounding の倍数でない場合も）', () => {
  const p = [{ rank: 1, percentage: 50 }, { rank: 2, percentage: 50 }];
  const r = simulate(150050, 100, p, 'percent'); // 150050 は 100 の倍数でない
  assert.equal(r.reduce((s, v) => s + v, 0), 150050, `合計が pool に一致しない: ${JSON.stringify(r)}`);
});

test('B4: ％モード 3 位構成は従来どおり比例（挙動不変）', () => {
  const p = [{ rank: 1, percentage: 50 }, { rank: 2, percentage: 30 }, { rank: 3, percentage: 20 }];
  assert.deepEqual(simulate(100000, 100, p, 'percent'), [50000, 30000, 20000]);
  // pool 増 → 比例して増える
  assert.deepEqual(simulate(200000, 100, p, 'percent'), [100000, 60000, 40000]);
});

test('B5: 既存％トーナメント（amount 不在）も開くと綺麗（移行不要・計算改善で達成）', () => {
  const legacy = [{ rank: 1, percentage: 66.67 }, { rank: 2, percentage: 33.33 }]; // amount なし
  assert.deepEqual(simulate(150000, 1000, legacy, 'percent'), [100000, 50000]);
});

test('B6: pool<=0 は全 0（金額・％とも）', () => {
  const p = [{ rank: 1, percentage: 100, amount: 50000 }];
  assert.deepEqual(simulate(0, 100, p, 'amount'), [0]);
  assert.deepEqual(simulate(0, 100, p, 'percent'), [0]);
});

// ============================================================
// 静的: 永続化 + 初期値金額（renderer）
// ============================================================
test('S1 (renderer): computeRoundedAmounts に金額固定分岐 + 最大剰余法', () => {
  const i = RENDERER.indexOf('function computeRoundedAmounts()');
  const body = RENDERER.slice(i, i + 1600);
  assert.ok(/tournamentState\.payoutMode\s*===\s*['"]amount['"]/.test(body), '金額モード分岐がない');
  assert.ok(/remainders/.test(body) && /residual/.test(body), '最大剰余法 + residual がない');
});

test('S2 (renderer): 新規トーナメント newT に payoutMode:amount（初期値金額）', () => {
  // newT は generateUniqueId('tournament') 直後の object literal
  assert.ok(/generateUniqueId\('tournament'\)[\s\S]{0,500}payoutMode:\s*['"]amount['"]/.test(RENDERER),
    '新規トーナメント newT に payoutMode:amount がない');
});

test('S3 (renderer): 編集開きの入力モードが payoutMode に同期（percent 固定リセットを撤廃）', () => {
  assert.ok(/payoutInputMode\s*=\s*\(tournamentState\.payoutMode\s*===\s*['"]amount['"]\)/.test(RENDERER),
    '編集開き時に payoutInputMode を payoutMode へ同期していない');
});

test('S4 (renderer): applyTournament が payoutMode を tournamentState へ複写', () => {
  assert.ok(/t\.payoutMode\s*===\s*['"]amount['"]\s*\|\|\s*t\.payoutMode\s*===\s*['"]percent['"]/.test(RENDERER),
    'applyTournament の payoutMode 取込がない');
  assert.ok(/tournamentState\.payoutMode\s*=\s*t\.payoutMode/.test(RENDERER),
    'tournamentState.payoutMode への代入がない');
});

test('S5 (renderer): 保存ビルドが payoutMode を同梱', () => {
  assert.ok(/payoutMode:\s*\(payoutInputMode\s*===\s*['"]amount['"]\)\s*\?\s*['"]amount['"]\s*:\s*['"]percent['"]/.test(RENDERER),
    'buildTournamentForm の payoutMode 同梱がない');
});

// ============================================================
// 静的: 永続化（main）
// ============================================================
test('S6 (main): DEFAULT_TOURNAMENT_EXT に payoutMode（最終 fallback = percent）', () => {
  const i = MAIN_JS.indexOf('const DEFAULT_TOURNAMENT_EXT');
  const body = MAIN_JS.slice(i, i + 1800);
  assert.ok(/payoutMode:\s*['"]percent['"]/.test(body), 'DEFAULT に payoutMode がない');
});

test('S7 (main): normalizeTournament が payoutMode を whitelist 検証 + 既定補完', () => {
  const i = MAIN_JS.indexOf('function normalizeTournament');
  const body = MAIN_JS.slice(i, i + 9000);
  assert.ok(/'payoutMode'\s+in\s+t/.test(body), 'payoutMode 取込分岐がない');
  assert.ok(/out\.payoutMode\s*=\s*\(t\.payoutMode\s*===\s*['"]amount['"]\)/.test(body), 'whitelist 検証がない');
  assert.ok(/out\.payoutMode\s*!==\s*['"]amount['"]\s*&&\s*out\.payoutMode\s*!==\s*['"]percent['"]/.test(body),
    '既定補完がない');
});

test('S8 (main): migration が payouts の amount 有無から payoutMode を推論', () => {
  const i = MAIN_JS.indexOf('function migrateTournamentSchema(s)');
  const body = MAIN_JS.slice(i, i + 4000);
  assert.ok(/m\.payoutMode\s*!==\s*['"]amount['"]\s*&&\s*m\.payoutMode\s*!==\s*['"]percent['"]/.test(body),
    'migration の payoutMode 補完条件がない');
  assert.ok(/allHaveAmount\s*\?\s*['"]amount['"]\s*:\s*['"]percent['"]/.test(body),
    'migration の amount 有無推論がない');
});

test('S9 (main): tournaments:list が payoutMode を同梱', () => {
  const i = MAIN_JS.indexOf("ipcMain.handle('tournaments:list'");
  const body = MAIN_JS.slice(i, i + 1500);
  assert.ok(/payoutMode:\s*\(t\.payoutMode\s*===\s*['"]amount['"]\s*\|\|\s*t\.payoutMode\s*===\s*['"]percent['"]\)/.test(body),
    'tournaments:list の payoutMode 同梱がない');
});

// ============================================================
// 保護: 致命バグ保護 5 件 + version 据え置き + プール計算不変
// ============================================================
test('S10 (保護): 致命バグ保護 5 件すべて維持', () => {
  assert.ok(/function\s+resetBlindProgressOnly\s*\(/.test(RENDERER), 'resetBlindProgressOnly 消失');
  assert.ok(/function\s+ensureEditorEditableState\s*\(/.test(RENDERER), 'ensureEditorEditableState 消失');
  assert.ok(/tournaments:setDisplaySettings/.test(MAIN_JS), 'timerState destructure 除外ハンドラ消失');
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `schedulePersistRuntime 呼出が ${calls} 件（8 以上期待）`);
});

test('S11 (保護): プール計算（computeCalculatedPool / poolRates）は不変', () => {
  // poolRates を使ったプール計算式が renderer に残存（payout 改修で触っていない）
  assert.ok(/poolRates\.buyIn/.test(RENDERER) && /tournamentRuntime\.playersInitial/.test(RENDERER),
    'computeCalculatedPool のプール計算式が変質している疑い');
});

test('S12: version 据え置き（実装中は bump しない）', () => {
  assert.equal(PKG.version, '2.5.1', `version が ${PKG.version}（実装中は 2.5.1 据え置き、配信時 2.5.2）`);
});

test('S13: scripts.test に v260 が登録', () => {
  assert.ok(PKG.scripts.test.includes('v260-payout-amount-default.test.js'),
    'scripts.test に v260-payout-amount-default.test.js が未登録');
});

console.log(`\nv260-payout-amount-default.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
