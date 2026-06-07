/**
 * v2.1.4 静的解析 + 動作テスト — PRIZE 金額モード誤差修正（方針 A: amount フィールド保持）
 *
 * ※ v2.5.2（payout-amount-default）で挙動更新:
 *   - 金額モードは payoutMode==='amount' で「入力額を固定」（pool 変動でもドリフトしない。amountSum===pool 条件は撤廃）
 *   - ％モードは「最大剰余法」で per-rank を綺麗に着地（合計=pool 維持、旧「余り全部1位上乗せ」を是正）
 *   T-amount-1/2/3 と T4b 静的の期待値を v2.5.2 挙動へ更新済。詳細テストは v260-payout-amount-default.test.js。
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

// v2.5.2 で挙動更新: モード分岐（金額=固定 / ％=最大剰余法）。実コード computeRoundedAmounts と手動同期。
function simulateComputeRoundedAmounts(pool, rounding, payouts, mode) {
  if (payouts.length === 0 || pool <= 0) return payouts.map(() => 0);

  // v2.5.2: 金額モード = 入力額を固定（amount をそのまま返す。pool で逆算しない＝ドリフトなし）
  if (mode === 'amount') {
    return payouts.map((p) =>
      (Number.isFinite(p.amount) && p.amount >= 0)
        ? p.amount
        : Math.floor(pool * (Number(p.percentage) || 0) / 100 / rounding) * rounding);
  }

  // ％モード: pool×% を floor、端数を最大剰余法で配分（合計 === pool 厳密維持）
  const raws    = payouts.map((p) => pool * (Number(p.percentage) || 0) / 100);
  const amounts = raws.map((raw) => Math.floor(raw / rounding) * rounding);
  const remainders = raws.map((raw, i) => raw - amounts[i]);
  const order = payouts.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a]);
  let units = Math.floor((pool - amounts.reduce((s, v) => s + v, 0)) / rounding);
  for (let k = 0; units > 0 && order.length > 0; k++, units--) {
    amounts[order[k % order.length]] += rounding;
  }
  const residual = pool - amounts.reduce((s, v) => s + v, 0);
  if (residual !== 0 && amounts.length > 0) {
    amounts[order.length > 0 ? order[0] : 0] += residual;
  }
  return amounts;
}

test('T-amount-1: 金額モード保存値が誤差ゼロで再現（pool=150000 / 1位=100000 / 2位=50000）', () => {
  const payouts = [
    { rank: 1, percentage: 66.67, amount: 100000 },
    { rank: 2, percentage: 33.33, amount: 50000 }
  ];
  const result = simulateComputeRoundedAmounts(150000, 1000, payouts, 'amount');
  assert.deepEqual(result, [100000, 50000],
    `金額モードで誤差ゼロ復元できていない: 期待 [100000, 50000], 実 ${JSON.stringify(result)}`);
});

test('T-amount-2: ％モードは最大剰余法で per-rank が綺麗に着地（合計=pool 維持）', () => {
  // v2.5.2: amount 不在の％トーナメント。66.67/33.33 → 100005/49995 のズレを最大剰余法で是正。
  const payouts = [
    { rank: 1, percentage: 66.67 },
    { rank: 2, percentage: 33.33 }
  ];
  const result = simulateComputeRoundedAmounts(150000, 1000, payouts, 'percent');
  // floor: [100000, 49000]（余り [5, 995]）→ leftover 1000（1単位）→ 余り大きい2位へ → [100000, 50000]
  assert.deepEqual(result, [100000, 50000],
    `％最大剰余法の着地が誤り: 期待 [100000, 50000], 実 ${JSON.stringify(result)}`);
  assert.equal(result.reduce((s, v) => s + v, 0), 150000, '合計 = pool が維持されていない');
});

test('T-amount-3: 金額モードは pool 変動でもドリフトしない（入力額固定）', () => {
  // v2.5.2 核: 保存時 pool=150000 → 人数増で pool=200000 になっても入れた額のまま
  const payouts = [
    { rank: 1, percentage: 66.67, amount: 100000 },
    { rank: 2, percentage: 33.33, amount: 50000 }
  ];
  const result = simulateComputeRoundedAmounts(200000, 1000, payouts, 'amount');
  assert.deepEqual(result, [100000, 50000],
    `金額モードが pool 変動で固定されていない（ドリフト発生）: 期待 [100000, 50000], 実 ${JSON.stringify(result)}`);
});

// ============================================================
// T4b (Fix 3 静的): computeRoundedAmounts に amount 優先分岐がある
// ============================================================
test('T4b (v2.5.2 静的): computeRoundedAmounts に payoutMode 分岐 + 最大剰余法', () => {
  const declIdx = RENDERER.indexOf('function computeRoundedAmounts()');
  assert.ok(declIdx >= 0, 'computeRoundedAmounts 関数が見つからない');
  const nextFnIdx = RENDERER.indexOf('\nfunction ', declIdx + 1);
  const body = RENDERER.slice(declIdx, nextFnIdx > 0 ? nextFnIdx : declIdx + 2000);
  // 金額モード固定分岐
  assert.ok(/tournamentState\.payoutMode\s*===\s*['"]amount['"]/.test(body),
    'computeRoundedAmounts に payoutMode === amount 分岐がない');
  assert.ok(/Number\.isFinite\(p\.amount\)\s*&&\s*p\.amount\s*>=\s*0/.test(body),
    'computeRoundedAmounts の amount 検証 (Number.isFinite + 非負) がない');
  // ％モード最大剰余法（remainder 降順配分 + residual で合計=pool 保証）
  assert.ok(/remainders/.test(body),
    'computeRoundedAmounts に最大剰余法（remainders）がない');
  assert.ok(/residual/.test(body),
    'computeRoundedAmounts に residual（割り切れない端数の合計=pool 保証）がない');
  // 旧「余り全部を1位上乗せ」回帰防止（amounts[0] += remainder 単独パターンの消失確認）
  assert.ok(!/const\s+remainder\s*=\s*pool\s*-\s*sum/.test(body),
    '旧「余り全部を1位上乗せ」ロジックが残存している');
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
  assert.equal(PKG.version, '2.5.1',
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
