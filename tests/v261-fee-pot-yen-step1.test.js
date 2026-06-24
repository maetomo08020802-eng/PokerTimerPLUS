/**
 * v2.6.0 fee-pot-yen STEP 1 — 基盤（potAmounts$ モデル / 数値中立）
 *
 * STEP 1 範囲（UI・通貨は不変、計算ソースのみ potAmounts に切替）:
 *   - potAmounts スキーマ + sanitizePotAmount/sanitizePotAmounts + DEFAULT + potDefaults
 *   - migration: poolRates% → potAmounts$（POT = round(fee × poolRate / 100)、poolRates dormant 温存、中間%件数ログ）
 *   - computeCalculatedPool = Σ(POT × 件数)（¥フィー独立、$整数で端数ゼロ）
 *   - normalize 取込 + 既定補完（potDefaults）+ list 同梱 / applyTournament 複写 / 保存ビルド経過措置派生
 *
 * v2.4.0 不変条件: 移行で poolRate 100%→POT=fee / 0%→0 ＝ TOTAL POOL 数値厳密一致。
 * 実データ監査（2026-06-08）: 既存 13 トーナメント全て 0/100% のみ＝中間% 0 件＝全件数値厳密一致。
 *
 * 実行: node tests/v261-fee-pot-yen-step1.test.js
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

// computeCalculatedPool 再実装（Σ POT × 件数）
function simulatePool(pot, runtime) {
  return (Number(pot.buyIn)   || 0) * runtime.playersInitial
       + (Number(pot.reentry) || 0) * runtime.reentryCount
       + (Number(pot.addOn)   || 0) * runtime.addOnCount;
}
// migration の POT 変換式（POT = round(fee × poolRate / 100)）
function migratePot(fee, rate) { return Math.max(0, Math.round((Number(fee) || 0) * (Number(rate) || 0) / 100)); }

// ============================================================
// 動作: pool = Σ(POT × 件数)・端数ゼロ
// ============================================================
test('B1: pool = Σ(POT × 件数)。$整数 × 件数で端数ゼロ', () => {
  const r = { playersInitial: 24, reentryCount: 5, addOnCount: 3 };
  assert.equal(simulatePool({ buyIn: 3000, reentry: 2000, addOn: 2000 }, r), 88000);
  assert.equal(simulatePool({ buyIn: 3000, reentry: 0, addOn: 0 }, r), 72000);
  // 端数ゼロ確認: 整数 POT × 整数件数は常に整数
  const v = simulatePool({ buyIn: 3333, reentry: 1, addOn: 0 }, r);
  assert.equal(v % 1, 0, '端数が出ている');
});

test('B2: POT 全 0 → pool 0（新規既定、賞金プール未形成）', () => {
  assert.equal(simulatePool({ buyIn: 0, reentry: 0, addOn: 0 }, { playersInitial: 50, reentryCount: 20, addOnCount: 10 }), 0);
});

// ============================================================
// 動作: migration（poolRate% → POT$）の v2.4.0 不変条件
// ============================================================
test('B3: migration POT=round(fee×rate/100) — 100%→fee 厳密 / 0%→0（TOTAL POOL 数値不変）', () => {
  assert.equal(migratePot(3000, 100), 3000, '100% → POT=fee 厳密一致でない');
  assert.equal(migratePot(5000, 100), 5000);
  assert.equal(migratePot(3000, 0), 0, '0% → POT=0 でない');
  // 旧 pool（fee×count×100/100）と新 pool（POT×count）が一致
  const r = { playersInitial: 24, reentryCount: 5, addOnCount: 3 };
  const oldPool = 3000 * 24 * 100 / 100 + 2000 * 5 * 100 / 100 + 2000 * 3 * 100 / 100;
  const newPool = simulatePool({ buyIn: migratePot(3000, 100), reentry: migratePot(2000, 100), addOn: migratePot(2000, 100) }, r);
  assert.equal(newPool, oldPool, `移行後 pool が旧 pool と不一致: old=${oldPool} new=${newPool}`);
});

test('B4: 中間%（実運用ほぼ皆無）は round で ≤端数ズレ（前原承認範囲）', () => {
  // fee=3333, 50% → round(1666.5)=1667（旧 pool 1666.5×count との差は丸め誤差のみ）
  assert.equal(migratePot(3333, 50), 1667);
  assert.equal(migratePot(4000, 50), 2000); // 割り切れる場合は厳密
});

// ============================================================
// 静的: main データ層
// ============================================================
test('S1 (main): sanitizePotAmount / sanitizePotAmounts 定義（非負整数 + 上限 cap）', () => {
  assert.match(MAIN_JS, /function\s+sanitizePotAmount\s*\(/, 'sanitizePotAmount 定義なし');
  assert.match(MAIN_JS, /function\s+sanitizePotAmounts\s*\(/, 'sanitizePotAmounts 定義なし');
  assert.match(MAIN_JS, /MAX_POT_AMOUNT/, '上限 cap MAX_POT_AMOUNT がない');
});

test('S2 (main): DEFAULT_TOURNAMENT_EXT.potAmounts = 0 + appConfig.potDefaults = 0', () => {
  const i = MAIN_JS.indexOf('const DEFAULT_TOURNAMENT_EXT');
  const body = MAIN_JS.slice(i, i + 3200);
  assert.match(body, /potAmounts:\s*\{\s*buyIn:\s*0,\s*reentry:\s*0,\s*addOn:\s*0\s*\}/, 'DEFAULT.potAmounts=0 がない');
  assert.match(MAIN_JS, /potDefaults:\s*\{\s*buyIn:\s*0,\s*reentry:\s*0,\s*addOn:\s*0\s*\}/, 'appConfig.potDefaults=0 がない');
});

test('S3 (main): migration が poolRates → potAmounts 変換（round(fee×rate/100)）+ poolRates 温存', () => {
  const i = MAIN_JS.indexOf('function migrateTournamentSchema(s)');
  const body = MAIN_JS.slice(i, i + 7000);
  assert.match(body, /!m\.potAmounts/, 'potAmounts 補完分岐がない');
  assert.match(body, /Math\.round\(feeOf\(m\.buyIn\)\s*\*\s*\(Number\(rate\.buyIn\)/, 'POT=round(fee×rate/100) 変換式がない');
  assert.match(body, /intermediatePoolRateCount/, '中間%件数ログ集計がない');
  // 旧 poolRates を削除していない（dormant 温存）= poolRates 補完が残存
  assert.match(body, /m\.poolRates\s*=\s*\{\s*\.\.\.DEFAULT_TOURNAMENT_EXT\.poolRates\s*\}/, 'poolRates 補完（温存）が消えている');
});

test('S4 (main): normalizeTournament が potAmounts 取込 + 既定補完(potDefaults) + list 同梱', () => {
  const i = MAIN_JS.indexOf('function normalizeTournament');
  const body = MAIN_JS.slice(i, i + 12000);
  assert.match(body, /out\.potAmounts\s*=\s*sanitizePotAmounts/, 'potAmounts 取込がない');
  assert.match(body, /\.potDefaults\s*\|\|\s*\{\s*buyIn:\s*0/, 'potDefaults 既定補完がない');
  assert.match(MAIN_JS, /potAmounts:\s*sanitizePotAmounts\(t\.potAmounts/, 'list 同梱がない');
});

// ============================================================
// 静的: renderer
// ============================================================
test('S5 (renderer): computeCalculatedPool が potAmounts × 件数（poolRate% 不使用）', () => {
  const i = RENDERER.indexOf('function computeCalculatedPool');
  const body = RENDERER.slice(i, i + 800);
  assert.match(body, /tournamentState\.potAmounts/, 'potAmounts 参照がない');
  assert.match(body, /pot\.buyIn\)\s*\|\|\s*0\)\s*\*\s*tournamentRuntime\.playersInitial/, 'POT×件数 計算がない');
  assert.ok(!/rates\.buyIn[\s\S]{0,40}\/\s*100/.test(body), '旧 poolRate% 計算が残存');
});

test('S6 (renderer): tournamentState.potAmounts 既定 + applyTournament 複写', () => {
  assert.match(RENDERER, /potAmounts:\s*\{\s*buyIn:\s*0,\s*reentry:\s*0,\s*addOn:\s*0\s*\}/, 'tournamentState.potAmounts 既定なし');
  assert.match(RENDERER, /tournamentState\.potAmounts\s*=\s*\{/, 'applyTournament の potAmounts 複写がない');
});

test('S7 (renderer): 保存ビルドが potAmounts を同梱（v2.6.0 STEP2＝$ 入力直読み）', () => {
  // STEP 2 で経過措置（%×fee 派生）を撤去し $ 入力直読みに置換済
  assert.match(RENDERER, /potAmounts:\s*\{[\s\S]{0,400}_readPotFromInput\(el\.tournamentBuyinPot/,
    '保存ビルドの potAmounts（$ 直読み）がない');
  assert.ok(!/Math\.round\(num\(el\.tournamentBuyinFee[\s\S]{0,80}_readPoolRateFromInput/.test(RENDERER),
    'STEP1 経過措置の %×fee 派生が残存している');
});

// ============================================================
// 保護
// ============================================================
test('S8 (保護): 致命バグ保護 5 件すべて維持', () => {
  assert.ok(/function\s+resetBlindProgressOnly\s*\(/.test(RENDERER), 'resetBlindProgressOnly 消失');
  assert.ok(/function\s+ensureEditorEditableState\s*\(/.test(RENDERER), 'ensureEditorEditableState 消失');
  assert.ok(/tournaments:setDisplaySettings/.test(MAIN_JS), 'timerState destructure 除外ハンドラ消失');
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `schedulePersistRuntime 呼出が ${calls} 件（8 以上期待）`);
});

test('S9: version 2.6.0（配信 bump 済）', () => {
  assert.equal(PKG.version, '2.6.5', `version が ${PKG.version}`);
});

test('S10: scripts.test に v261 登録', () => {
  assert.ok(PKG.scripts.test.includes('v261-fee-pot-yen-step1.test.js'), 'v261 未登録');
});

console.log(`\nv261-fee-pot-yen-step1.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
