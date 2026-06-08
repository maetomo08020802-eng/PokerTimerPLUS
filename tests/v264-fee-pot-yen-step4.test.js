/**
 * v2.6.0 fee-pot-yen STEP 4 — ¥フィー欄 E-1（🔒fee-lock 撤去）+ 統合検証
 *
 * STEP 4（E-1）:
 *   - 🔒fee-lock（feeLockState / setFeeReadonly / lockAllFees / _resolveFeeElements / 解除ダイアログ）撤去
 *   - ¥フィー input は readonly 撤去＝「買込（店売上）の記録」として自由編集可。pool には無関係
 *   - ★ ensureEditorEditableState / setBlindsTableReadonly（致命バグ保護・別 namespace）は不可侵
 *
 * 統合検証: 店内通貨$ / プール=Σ(POT×件数) / 配当=金額固定 / %消滅 / ¥フィー独立 が揃う。
 * 実行: node tests/v264-fee-pot-yen-step4.test.js
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
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// E-1: 🔒fee-lock 撤去
// ============================================================
test('E1: ¥フィー 3 入力は readonly 撤去（買込記録として自由編集可）', () => {
  assert.ok(!/<input[^>]*id="js-tournament-buyin-fee"[^>]*readonly/.test(INDEX), 'buyin fee に readonly 残存');
  assert.ok(!/<input[^>]*id="js-tournament-reentry-fee"[^>]*readonly/.test(INDEX), 'reentry fee に readonly 残存');
  assert.ok(!/<input[^>]*id="js-tournament-addon-fee"[^>]*readonly/.test(INDEX), 'addon fee に readonly 残存');
  // 買込ラベル
  assert.ok(/フィー（買込/.test(INDEX), 'フィー（買込）ラベルがない');
});

test('E2: 🔒ボタン / 解除ダイアログ / fee-lock CSS が完全撤去', () => {
  assert.ok(!/id="js-tournament-buyin-fee-lock"/.test(INDEX), '🔒 buyin ボタン残存');
  assert.ok(!/id="js-fee-unlock-dialog"/.test(INDEX), '解除ダイアログ残存');
  assert.ok(!/class="tournament-editor__fee-lock-btn"/.test(INDEX), 'fee-lock-btn class 残存');
  assert.ok(!/\.tournament-editor__fee-lock-btn\s*\{/.test(STYLE), 'fee-lock-btn CSS 残存');
  assert.ok(!/\.tournament-editor__inline-label--locked\s*\{/.test(STYLE), '--locked CSS 残存');
});

test('E3: renderer の fee-lock 機構（実コード）が完全撤去', () => {
  assert.ok(!/const\s+feeLockState\s*=/.test(RENDERER), 'feeLockState 残存');
  assert.ok(!/function\s+setFeeReadonly\s*\(/.test(RENDERER), 'setFeeReadonly 残存');
  assert.ok(!/function\s+lockAllFees\s*\(/.test(RENDERER), 'lockAllFees 残存');
  assert.ok(!/function\s+_resolveFeeElements\s*\(/.test(RENDERER), '_resolveFeeElements 残存');
  assert.ok(!/function\s+openFeeUnlockDialog\s*\(/.test(RENDERER), 'openFeeUnlockDialog 残存');
  assert.ok(!/FeeLockBtn\?\.addEventListener/.test(RENDERER), '🔒 listener 残存');
  assert.ok(!/typeof\s+lockAllFees\s*===\s*'function'/.test(RENDERER), 'applyTournament の lockAllFees 呼出残存');
});

test('E4 (★致命保護不可侵): ensureEditorEditableState / setBlindsTableReadonly は維持', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState（致命バグ保護）を消してはいけない');
  assert.match(RENDERER, /setBlindsTableReadonly/, 'setBlindsTableReadonly を消してはいけない');
});

// ============================================================
// 統合検証（v2.6.0 モデル全体）
// ============================================================
test('G1 (統合): ¥フィーは pool 計算から独立（computeCalculatedPool は potAmounts のみ、fee 不使用）', () => {
  const i = RENDERER.indexOf('function computeCalculatedPool');
  const body = RENDERER.slice(i, i + 500);
  assert.ok(/tournamentState\.potAmounts/.test(body), 'computeCalculatedPool が potAmounts を使っていない');
  assert.ok(!/\.fee\b/.test(body), 'computeCalculatedPool が ¥フィーを参照している（独立でない）');
});

test('G2 (統合): ¥フィーは記録として保存継続（buildTournamentForm に buyIn.fee）', () => {
  assert.match(RENDERER, /fee:\s*num\(el\.tournamentBuyinFee/, '¥フィーの保存（記録）が消えている');
});

test('G3 (統合): アプリから % が消滅（フィー率% / 配分% UI とも無い）', () => {
  assert.ok(!/>反映率/.test(INDEX), 'フィー反映率% ラベル残存');
  assert.ok(!/name="payout-mode"/.test(INDEX), '配当 %/金額 toggle 残存');
  assert.ok(!/% で入力/.test(INDEX), '「% で入力」残存');
});

test('G4 (統合): 通貨=店内通貨$ / プール=Σ(POT×件数) / 配当=金額固定 が成立', () => {
  // 通貨既定 $
  assert.match(RENDERER, /currencySymbol:\s*'\$'/, '通貨既定 $ でない');
  // pool = Σ(POT×件数)
  assert.match(RENDERER, /Number\(pot\.buyIn\)\s*\|\|\s*0\)\s*\*\s*tournamentRuntime\.playersInitial/, 'pool=Σ(POT×件数) でない');
  // 配当金額固定（payoutMode==='amount' 分岐）
  assert.match(RENDERER, /tournamentState\.payoutMode\s*===\s*'amount'/, '配当金額固定分岐がない');
});

// ============================================================
// 保護
// ============================================================
test('P1 (保護): 致命バグ保護 5 件すべて維持', () => {
  assert.ok(/function\s+resetBlindProgressOnly\s*\(/.test(RENDERER), 'resetBlindProgressOnly 消失');
  assert.ok(/function\s+ensureEditorEditableState\s*\(/.test(RENDERER), 'ensureEditorEditableState 消失');
  assert.ok(/tournaments:setDisplaySettings/.test(MAIN_JS), 'timerState destructure 除外ハンドラ消失');
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `schedulePersistRuntime 呼出が ${calls} 件（8 以上期待）`);
});

test('P2: version 2.6.0（配信 bump 済）+ v264 登録', () => {
  assert.equal(PKG.version, '2.6.0', `version が ${PKG.version}`);
  assert.ok(PKG.scripts.test.includes('v264-fee-pot-yen-step4.test.js'), 'v264 未登録');
});

console.log(`\nv264-fee-pot-yen-step4.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
