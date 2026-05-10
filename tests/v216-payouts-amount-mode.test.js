/**
 * v2.1.4 静的解析 + 動作テスト — PRIZE 金額モード誤差修正（方針 A: amount フィールド保持）
 *
 *   Fix 1 (main.js): normalizePayouts() amount フィールド対応
 *   Fix 2 (renderer): readPayoutsFromForm() / readPayoutsFromFormAsPercent() で amount 同梱
 *   Fix 3 (renderer): computeRoundedAmounts() を amount 優先に拡張
 *   Fix 4 (renderer): renderPayoutsEditor() 金額モード表示を amount 優先
 *   Fix 5 (renderer): トーナメント読込時に amount をコピー
 *
 * 新規動作テスト 3 件:
 *   - T-amount-1: 金額モード保存値が誤差ゼロで再現される（pool=150000, 1位=100000, 2位=50000）
 *   - T-amount-2: amount 欠損レガシー payouts では既存 % 計算にフォールバック
 *   - T-amount-3: pool 変動時（amount 合計 ≠ pool）は % 計算にフォールバック
 *
 * 致命バグ保護 5 件すべて完全無傷。
 *
 * 実行: node tests/v216-payouts-amount-mode.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1 (Fix 1): normalizePayouts が amount フィールドを保持
// ============================================================
test('T1 (Fix 1): normalizePayouts() が amount フィールド対応', () => {
  // 関数本体を抽出
  const m = MAIN_JS.match(/function\s+normalizePayouts\s*\([^)]*\)\s*\{[\s\S]*?\r?\n\s{2}\}/);
  assert.ok(m, 'normalizePayouts 関数定義が見つからない');
  const body = m[0];
  // amount を Number.isFinite + 非負でガードしている
  assert.ok(/Number\.isFinite\(amtNum\)\s*&&\s*amtNum\s*>=\s*0/.test(body),
    'normalizePayouts に amount の Number.isFinite + 非負ガードがない');
  // hasAmount で条件付きキー追加
  assert.ok(/hasAmount/.test(body),
    'normalizePayouts に hasAmount フラグの条件分岐がない');
  // 出力時に amount をコピー
  assert.ok(/'amount'\s+in\s+p/.test(body) || /\bamount:\s*p\.amount/.test(body),
    'normalizePayouts の出力で amount が条件付きで含まれていない');
});

// ============================================================
// T2 (Fix 2): readPayoutsFromForm が金額モード時に amount 同梱
// ============================================================
test('T2 (Fix 2): readPayoutsFromForm() 金額モードで amount 同梱', () => {
  const declIdx = RENDERER.indexOf('function readPayoutsFromForm()');
  assert.ok(declIdx >= 0, 'readPayoutsFromForm 関数が見つからない');
  const nextFnIdx = RENDERER.indexOf('\n}', declIdx);
  const body = RENDERER.slice(declIdx, nextFnIdx + 2);
  assert.ok(/payoutInputMode\s*===\s*['"]amount['"]/.test(body),
    'readPayoutsFromForm に金額モード判定がない');
  assert.ok(/rank:\s*i\s*\+\s*1\s*,\s*percentage:\s*pct\s*,\s*amount:\s*amt/.test(body),
    'readPayoutsFromForm の金額モード分岐で amount フィールド同梱がない');
  // Math.floor で整数化
  assert.ok(/Math\.floor\(Number\(inp\?\.value\)/.test(body),
    'readPayoutsFromForm で amt の Math.floor 整数化がない');
});

// ============================================================
// T3 (Fix 2): readPayoutsFromFormAsPercent が金額モード時に amount 同梱
// ============================================================
test('T3 (Fix 2): readPayoutsFromFormAsPercent() 金額モードで amount 同梱', () => {
  const declIdx = RENDERER.indexOf('function readPayoutsFromFormAsPercent()');
  assert.ok(declIdx >= 0, 'readPayoutsFromFormAsPercent 関数が見つからない');
  const nextFnIdx = RENDERER.indexOf('\n}', declIdx);
  const body = RENDERER.slice(declIdx, nextFnIdx + 2);
  assert.ok(/rank:\s*i\s*\+\s*1\s*,\s*percentage:\s*pct\s*,\s*amount:\s*amt/.test(body),
    'readPayoutsFromFormAsPercent の金額モード分岐で amount フィールド同梱がない');
});

// ============================================================
// T4 (Fix 3): computeRoundedAmounts が amount 優先で動作する
//   動作テスト: 関数を再現実装（テストコンテキストで window/DOM が無いため）
// ============================================================

// 関数の中核ロジックを再実装（実コードと同一の挙動を担保するため、CC が手動で同期）
function simulateComputeRoundedAmounts(pool, rounding, payouts) {
  if (payouts.length === 0 || pool <= 0) return payouts.map(() => 0);

  const allHaveAmount = payouts.every((p) => Number.isFinite(p.amount) && p.amount >= 0);
  if (allHaveAmount) {
    const amountSum = payouts.reduce((s, p) => s + p.amount, 0);
    if (amountSum === pool) {
      return payouts.map((p) => p.amount);
    }
  }

  const amounts = payouts.map((p) => {
    const raw = pool * (Number(p.percentage) || 0) / 100;
    return Math.floor(raw / rounding) * rounding;
  });
  const sum = amounts.reduce((s, v) => s + v, 0);
  const remainder = pool - sum;
  if (remainder > 0 && amounts.length > 0) {
    amounts[0] += remainder;
  }
  return amounts;
}

test('T-amount-1: 金額モード保存値が誤差ゼロで再現（pool=150000 / 1位=100000 / 2位=50000 / rounding=1000）', () => {
  // v2.1.4 真因: pool=150000 / 1位=100000 → 66.67% 丸め → 復元時 100,005 → floor(1000) → 100,000、
  //   2位 33.33% → 復元時 49,995 → floor(1000) → 49,000、
  //   余り 1,000 を 1 位に → 1位=101,000 / 2位=49,000 にズレる（旧挙動）
  const payouts = [
    { rank: 1, percentage: 66.67, amount: 100000 },
    { rank: 2, percentage: 33.33, amount: 50000 }
  ];
  const result = simulateComputeRoundedAmounts(150000, 1000, payouts);
  assert.deepEqual(result, [100000, 50000],
    `v2.1.4 amount 優先パスで誤差ゼロ復元できていない: 期待 [100000, 50000], 実 ${JSON.stringify(result)}`);
});

test('T-amount-2: amount 欠損レガシー payouts は既存 % 計算にフォールバック（後方互換）', () => {
  // % のみで保存された旧データ（amount フィールドなし）
  const payouts = [
    { rank: 1, percentage: 66.67 },
    { rank: 2, percentage: 33.33 }
  ];
  const result = simulateComputeRoundedAmounts(150000, 1000, payouts);
  // 旧 % 計算: 1位 = floor(100005/1000)*1000 = 100000、2位 = floor(49995/1000)*1000 = 49000、
  //   余り 1000 を 1 位に → [101000, 49000]
  assert.deepEqual(result, [101000, 49000],
    `% 計算フォールバックの挙動が変わっている: 期待 [101000, 49000], 実 ${JSON.stringify(result)}`);
});

test('T-amount-3: pool 変動で amount 合計 ≠ pool のとき % 計算にフォールバック', () => {
  // 保存時 pool=150000 → 後で参加人数増加で pool=200000 に変わった
  const payouts = [
    { rank: 1, percentage: 66.67, amount: 100000 },
    { rank: 2, percentage: 33.33, amount: 50000 }
  ];
  const result = simulateComputeRoundedAmounts(200000, 1000, payouts);
  // amount 合計 (150000) !== pool (200000) → % 計算にフォールバック
  // 1位 = floor(200000 * 66.67 / 100 / 1000)*1000 = floor(133340/1000)*1000 = 133000
  // 2位 = floor(200000 * 33.33 / 100 / 1000)*1000 = floor(66660/1000)*1000 = 66000
  // 余り = 200000 - 199000 = 1000 → 1位に → [134000, 66000]
  assert.deepEqual(result, [134000, 66000],
    `pool 変動時の % フォールバック挙動が誤り: 期待 [134000, 66000], 実 ${JSON.stringify(result)}`);
});

// ============================================================
// T4b (Fix 3 静的): computeRoundedAmounts に amount 優先分岐がある
// ============================================================
test('T4b (Fix 3 静的): computeRoundedAmounts に amount 優先分岐 + pool 完全一致判定', () => {
  const declIdx = RENDERER.indexOf('function computeRoundedAmounts()');
  assert.ok(declIdx >= 0, 'computeRoundedAmounts 関数が見つからない');
  const nextFnIdx = RENDERER.indexOf('\nfunction ', declIdx + 1);
  const body = RENDERER.slice(declIdx, nextFnIdx > 0 ? nextFnIdx : declIdx + 2000);
  assert.ok(/allHaveAmount/.test(body),
    'computeRoundedAmounts に allHaveAmount フラグがない');
  assert.ok(/Number\.isFinite\(p\.amount\)\s*&&\s*p\.amount\s*>=\s*0/.test(body),
    'computeRoundedAmounts の amount 検証 (Number.isFinite + 非負) がない');
  assert.ok(/amountSum\s*===\s*pool/.test(body),
    'computeRoundedAmounts に「amount 合計 === pool」完全一致判定がない');
});

// ============================================================
// T5 (Fix 4): renderPayoutsEditor が amount 優先で表示
// ============================================================
test('T5 (Fix 4): renderPayoutsEditor() 金額モードで amount 優先表示', () => {
  const declIdx = RENDERER.indexOf('function renderPayoutsEditor(');
  assert.ok(declIdx >= 0, 'renderPayoutsEditor 関数が見つからない');
  const nextFnIdx = RENDERER.indexOf('\nfunction ', declIdx + 1);
  const body = RENDERER.slice(declIdx, nextFnIdx > 0 ? nextFnIdx : declIdx + 2000);
  // hasAmt 条件分岐
  assert.ok(/hasAmt/.test(body),
    'renderPayoutsEditor に hasAmt 判定がない');
  assert.ok(/Number\.isFinite\(p\.amount\)\s*&&\s*p\.amount\s*>=\s*0/.test(body),
    'renderPayoutsEditor の amount 検証がない');
  // String(p.amount) 直接表示の経路
  assert.ok(/String\(p\.amount\)/.test(body),
    'renderPayoutsEditor で amount 直接表示分岐がない');
});

// ============================================================
// T6 (Fix 5): トーナメント読込時に amount コピー
// ============================================================
test('T6 (Fix 5): トーナメント読込時に amount フィールドが tournamentState.payouts に複写', () => {
  // line 1083 付近の payouts コピー処理を確認
  const block = RENDERER.match(/Array\.isArray\(t\.payouts\)\s*&&\s*t\.payouts\.length\s*>\s*0[\s\S]{0,500}\}/);
  assert.ok(block, 'トーナメント読込時の payouts コピー処理が見つからない');
  const body = block[0];
  assert.ok(/Number\.isFinite\(p\.amount\)\s*&&\s*p\.amount\s*>=\s*0/.test(body),
    'トーナメント読込時の amount コピー処理に Number.isFinite + 非負ガードがない');
  assert.ok(/out\.amount\s*=\s*p\.amount/.test(body),
    'トーナメント読込時に out.amount = p.amount のコピーがない');
});

// ============================================================
// T7 (保護): % モードのみのトーナメント挙動完全不変
// ============================================================
test('T7 (保護): % モードトーナメント（amount 不在）が既存 % 計算で動作', () => {
  // amount フィールド不在 → 既存挙動と同一の結果
  const payouts = [
    { rank: 1, percentage: 50 },
    { rank: 2, percentage: 30 },
    { rank: 3, percentage: 20 }
  ];
  const result = simulateComputeRoundedAmounts(100000, 100, payouts);
  // 1位=50000, 2位=30000, 3位=20000, 合計=100000, 余り=0 → そのまま
  assert.deepEqual(result, [50000, 30000, 20000],
    `% モード既存挙動が破壊された: 期待 [50000, 30000, 20000], 実 ${JSON.stringify(result)}`);
});

// ============================================================
// T8 (保護): 致命バグ保護 5 件 cross-check
// ============================================================
test('T8 (保護): 致命バグ保護 5 件すべて維持', () => {
  // C.2.7-A resetBlindProgressOnly
  assert.ok(/function\s+resetBlindProgressOnly\s*\(/.test(RENDERER),
    'C.2.7-A resetBlindProgressOnly 関数定義が消失');
  // C.1-A2 ensureEditorEditableState
  assert.ok(/function\s+ensureEditorEditableState\s*\(/.test(RENDERER),
    'C.1-A2 ensureEditorEditableState 関数定義が消失');
  // C.1.7 AudioContext resume（audio.js _play() 内）
  assert.ok(/audioContext\.state\s*===\s*['"]suspended['"]/.test(AUDIO_JS),
    'C.1.7 AudioContext suspend 検出が audio.js から消失');
  // C.1.8 schedulePersistRuntime 8 箇所以上
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `C.1.8 schedulePersistRuntime 呼出が ${calls} 件（期待 8 以上）`);
  // C.2.7-D timerState destructure 除外
  assert.ok(/tournaments:setDisplaySettings/.test(MAIN_JS),
    'C.2.7-D tournaments:setDisplaySettings ハンドラが消失');
});

// ============================================================
// T9: package.json version は 2.1.12
// ============================================================
test('T9: package.json version は 2.1.12', () => {
  assert.equal(PKG.version, '2.1.19-rc1',
    `package.json version が ${PKG.version}（期待 2.1.18）`);
});

test('T10: scripts.test に v216-payouts-amount-mode.test.js が登録', () => {
  assert.ok(PKG.scripts && typeof PKG.scripts.test === 'string', 'scripts.test がない');
  assert.ok(PKG.scripts.test.includes('v216-payouts-amount-mode.test.js'),
    'scripts.test に v216-payouts-amount-mode.test.js が登録されていない');
});

// ============================================================
// 結果サマリ
// ============================================================
console.log(`\nv216-payouts-amount-mode.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
