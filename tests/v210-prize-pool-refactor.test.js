/**
 * v2.4.0 STEP 5 — 賞金プール計算改修テスト（v210 案件）
 *
 *   STEP 2: state スキーマ拡張 + migration（既存 100% / 新規 0%）
 *   STEP 3: 計算ロジックをプール率対応に書換
 *   STEP 4: UI 追加（readonly + 🔒 + 解除ダイアログ + プール率欄 + 案内文言 + 店舗デフォルト編集）
 *   STEP 4 fix: 動的キー組立て撤廃（_resolveFeeElements switch case 化）→ 🔒 バグ構造的根治
 *
 *   検証範囲:
 *     T1: tournamentState / DEFAULT_TOURNAMENT_EXT に poolRates フィールド存在（既存互換 100%）
 *     T2: sanitizePoolRate / sanitizePoolRates ヘルパー存在（0〜100 整数 clamp）
 *     T3: migrateTournamentSchema に poolRates 補完ロジック存在（既存 100% 補完、§11.2 解釈 B）
 *     T4: computeCalculatedPool に poolRates 参照 + rate / 100 計算式
 *     T5: computeTotalPoolFromForm にプール率入力欄経由読込み（state fallback あり）
 *     T6: index.html フィー 3 入力に readonly 属性
 *     T7: 解除ダイアログ <dialog id="js-fee-unlock-dialog"> 存在 + 確定文言
 *     T8: プール率入力欄 3 件存在
 *     T9: フィー欄真下の案内文言「フィー入力時はプライズに反映されます（反映率設定可）」存在
 *     T10: 動作テスト — pool = Σ(fee × count × rate / 100) 計算正しさ
 *     T11: 動作テスト — rate=0% で pool=0、GTD=N で pool=N（max(calc, gtd) 維持）
 *     T12: 致命バグ保護 5 件 cross-check
 *     T13: scripts.test 登録 + version 2.4.0
 *     T14: STEP 4 バグ再発防止 — 🔒ボタン 3 件の DOM ID と JS 参照キー完全一致 + 動的キー組立て撤廃
 *
 *   実行: node tests/v210-prize-pool-refactor.test.js
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
const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: tournamentState / DEFAULT_TOURNAMENT_EXT に poolRates フィールド存在
// ============================================================
test('T1 (STEP 2): tournamentState / DEFAULT_TOURNAMENT_EXT に poolRates: { buyIn:100, reentry:100, addOn:100 } 存在', () => {
  // renderer.js tournamentState 初期化
  assert.match(RENDERER, /poolRates:\s*\{\s*buyIn:\s*100,\s*reentry:\s*100,\s*addOn:\s*100\s*\}/,
    'renderer.js の tournamentState 初期定義に poolRates: { buyIn:100, reentry:100, addOn:100 } が見つからない');
  // main.js DEFAULT_TOURNAMENT_EXT
  assert.match(MAIN_JS, /poolRates:\s*\{\s*buyIn:\s*100,\s*reentry:\s*100,\s*addOn:\s*100\s*\}/,
    'main.js の DEFAULT_TOURNAMENT_EXT に poolRates: { buyIn:100, reentry:100, addOn:100 } が見つからない');
  // main.js store.defaults.appConfig.poolRatesDefault（新規 0%）。v2.6.0 で appConfig に potDefaults 追加のため
  //   poolRatesDefault のみを部分マッチ（appConfig の閉じ括弧は厳密一致しない）
  assert.match(MAIN_JS, /poolRatesDefault:\s*\{\s*buyIn:\s*0,\s*reentry:\s*0,\s*addOn:\s*0\s*\}/,
    'main.js の store.defaults.appConfig.poolRatesDefault: { 0, 0, 0 } が見つからない');
});

// ============================================================
// T2: sanitizePoolRate / sanitizePoolRates 関数定義存在
// ============================================================
test('T2 (STEP 2): sanitizePoolRate / sanitizePoolRates 関数定義存在（0〜100 整数 clamp）', () => {
  assert.match(MAIN_JS, /function\s+sanitizePoolRate\s*\(/, 'sanitizePoolRate 関数定義が見つからない');
  assert.match(MAIN_JS, /function\s+sanitizePoolRates\s*\(/, 'sanitizePoolRates 関数定義が見つからない');
  // 0〜100 clamp + Math.floor 整数化
  assert.match(MAIN_JS, /Math\.max\(0,\s*Math\.min\(100,\s*Math\.floor/,
    'sanitizePoolRate 内の 0〜100 clamp + Math.floor 整数化が見つからない');
});

// ============================================================
// T3: migrateTournamentSchema に poolRates 補完（既存 100%）
// ============================================================
test('T3 (STEP 2): migrateTournamentSchema に poolRates 100% 補完ロジック存在（§11.2 解釈 B）', () => {
  // !m.poolRates → DEFAULT_TOURNAMENT_EXT.poolRates (=100%) で補完
  assert.match(MAIN_JS, /if\s*\(\s*!m\.poolRates[\s\S]{0,200}DEFAULT_TOURNAMENT_EXT\.poolRates/,
    'migrateTournamentSchema 内の poolRates 補完（DEFAULT_TOURNAMENT_EXT.poolRates フォールバック）が見つからない');
  // touched = true で再保存
  const migIdx = MAIN_JS.indexOf('function migrateTournamentSchema');
  assert.ok(migIdx >= 0, 'migrateTournamentSchema 関数定義が見つからない');
  // 関数本体内に poolRates 補完が含まれる（広めの slice で検証）
  const migBody = MAIN_JS.slice(migIdx, migIdx + 6000);
  assert.match(migBody, /m\.poolRates\s*=\s*\{\s*\.\.\.DEFAULT_TOURNAMENT_EXT\.poolRates\s*\}/,
    'migrateTournamentSchema 内で m.poolRates = { ...DEFAULT_TOURNAMENT_EXT.poolRates } の補完式がない');
});

// ============================================================
// T4 (v2.6.0): computeCalculatedPool は potAmounts × 件数（poolRate% 廃止）
// ============================================================
test('T4 (v2.6.0): computeCalculatedPool は potAmounts × 件数（poolRate% / rate÷100 廃止）', () => {
  const declIdx = RENDERER.indexOf('function computeCalculatedPool');
  assert.ok(declIdx >= 0, 'computeCalculatedPool 関数定義が見つからない');
  const body = RENDERER.slice(declIdx, declIdx + 1200);
  // potAmounts 参照 + 件数積
  assert.match(body, /tournamentState\.potAmounts/,
    'computeCalculatedPool 内に tournamentState.potAmounts 参照がない');
  assert.match(body, /Number\(pot\.buyIn\)\s*\|\|\s*0\)\s*\*\s*tournamentRuntime\.playersInitial/,
    'computeCalculatedPool 内に POT buyIn × playersInitial がない');
  assert.match(body, /Number\(pot\.reentry\)\s*\|\|\s*0\)\s*\*\s*tournamentRuntime\.reentryCount/,
    'computeCalculatedPool 内に POT reentry × reentryCount がない');
  assert.match(body, /Number\(pot\.addOn\)\s*\|\|\s*0\)\s*\*\s*tournamentRuntime\.addOnCount/,
    'computeCalculatedPool 内に POT addOn × addOnCount がない');
  // poolRate% の rate/100 計算が残存していない（廃止確認）
  assert.ok(!/rates\.buyIn[\s\S]{0,40}\/\s*100/.test(body),
    'computeCalculatedPool に旧 poolRate% (rate/100) 計算が残存している');
});

// ============================================================
// T5: computeTotalPoolFromForm がプール率入力欄経由 + state fallback
// ============================================================
test('T5 (v2.6.0): computeTotalPoolFromForm が POT 入力欄経由読込み（state.potAmounts fallback あり）', () => {
  const declIdx = RENDERER.indexOf('function computeTotalPoolFromForm');
  assert.ok(declIdx >= 0, 'computeTotalPoolFromForm 関数定義が見つからない');
  const body = RENDERER.slice(declIdx, declIdx + 1500);
  // v2.6.0: _readPotFromInput 経由で $ POT 入力欄から読込み（id *-pot）
  assert.match(body, /_readPotFromInput\(el\.tournamentBuyinPot/,
    'computeTotalPoolFromForm 内に POT buyIn 読込み（_readPotFromInput 経由）がない');
  assert.match(body, /_readPotFromInput\(el\.tournamentReentryPot/,
    'computeTotalPoolFromForm 内に POT reentry 読込みがない');
  assert.match(body, /_readPotFromInput\(el\.tournamentAddonPot/,
    'computeTotalPoolFromForm 内に POT addOn 読込みがない');
  // state.potAmounts フォールバック
  assert.match(body, /tournamentState\.potAmounts\s*\|\|/,
    'computeTotalPoolFromForm 内の state.potAmounts フォールバックがない');
});

// ============================================================
// T6: index.html フィー 3 入力に readonly 属性
// ============================================================
test('T6 (v2.6.0 E-1): フィー 3 入力は readonly 撤去（買込記録として自由編集可）', () => {
  // 🔒fee-lock 撤去で fee input から readonly が外れている
  assert.ok(!/<input[^>]*id="js-tournament-buyin-fee"[^>]*readonly/.test(INDEX),
    'js-tournament-buyin-fee に readonly が残存（E-1 で撤去のはず）');
  assert.ok(!/<input[^>]*id="js-tournament-reentry-fee"[^>]*readonly/.test(INDEX),
    'js-tournament-reentry-fee に readonly が残存');
  assert.ok(!/<input[^>]*id="js-tournament-addon-fee"[^>]*readonly/.test(INDEX),
    'js-tournament-addon-fee に readonly が残存');
});

// ============================================================
// T7: 解除ダイアログ <dialog id="js-fee-unlock-dialog"> 存在
// ============================================================
test('T7 (v2.6.0 E-1): フィー解除確認ダイアログ撤去（虚偽文言も消滅）', () => {
  assert.ok(!/id="js-fee-unlock-dialog"/.test(INDEX), 'fee-unlock dialog が残存（E-1 で撤去のはず）');
  assert.ok(!INDEX.includes('フィーを入力するとプライズプールが変動します'),
    '虚偽化した解除ダイアログ文言が残存');
  assert.ok(!/id="js-fee-unlock-ok"/.test(INDEX) && !/id="js-fee-unlock-cancel"/.test(INDEX),
    '解除ダイアログのボタンが残存');
});

// ============================================================
// T8: プール率入力欄 3 件存在
// ============================================================
test('T8 (v2.6.0): POT 入力欄 3 件存在（$拠出、id *-pot、min0/step100/max なし）', () => {
  assert.match(INDEX, /id="js-tournament-buyin-pot"/, 'POT 入力欄 buyin 消失');
  assert.match(INDEX, /id="js-tournament-reentry-pot"/, 'POT 入力欄 reentry 消失');
  assert.match(INDEX, /id="js-tournament-addon-pot"/, 'POT 入力欄 addon 消失');
  const potInputs = INDEX.match(/id="js-tournament-(buyin|reentry|addon)-pot"[^>]*/g) || [];
  assert.equal(potInputs.length, 3, `POT 入力欄が 3 件でない（${potInputs.length} 件）`);
  for (const inp of potInputs) {
    assert.match(inp, /min="0"/, `POT 入力欄に min="0" がない: ${inp}`);
    assert.match(inp, /step="100"/, `POT 入力欄に step="100" がない: ${inp}`);
    assert.ok(!/max="100"/.test(inp), `POT 入力欄に旧 max="100"（% 制約）が残存: ${inp}`);
  }
});

// ============================================================
// T9: 案内文言「フィー入力時はプライズに反映されます（反映率設定可）」存在
// ============================================================
test('T9 (v2.6.0): 旧「反映率」案内文言は撤去（POT モデルの案内に置換済）', () => {
  assert.ok(!INDEX.includes('フィー入力時はプライズに反映されます（反映率設定可）'),
    '旧「反映率」案内文言が残存（v2.6.0 で置換のはず）');
  // 新案内（1件あたり拠出 × 件数）が存在
  assert.ok(/1件あたり拠出/.test(INDEX) && /プライズプールに積み上がります/.test(INDEX),
    'POT モデルの新案内文言がない');
});

// ============================================================
// T10: 動作テスト — pool = Σ(fee × count × rate / 100) 計算正しさ
// ============================================================
function simulateComputeCalculatedPool(state, runtime) {
  // v2.6.0: computeCalculatedPool の再実装＝Σ(POT × 件数)（potAmounts、¥フィー独立）。
  const pot = state.potAmounts || { buyIn: 0, reentry: 0, addOn: 0 };
  return (Number(pot.buyIn)   || 0) * runtime.playersInitial
       + (Number(pot.reentry) || 0) * runtime.reentryCount
       + (Number(pot.addOn)   || 0) * runtime.addOnCount;
}

function simulateComputeTotalPool(state, runtime) {
  const calc = simulateComputeCalculatedPool(state, runtime);
  const gtd  = Number(state.guarantee) || 0;
  return Math.max(calc, gtd);
}

test('T10 (v2.6.0 動作): pool = Σ(POT × 件数) 計算正しさ（POT=移行値 3000/2000/2000 等）', () => {
  const runtime = { playersInitial: 24, reentryCount: 5, addOnCount: 3 };
  // ケース 1: POT={3000,2000,2000}（旧 全100% 移行値）→ 3000*24 + 2000*5 + 2000*3 = 88,000
  const case1 = simulateComputeCalculatedPool({ potAmounts: { buyIn: 3000, reentry: 2000, addOn: 2000 } }, runtime);
  assert.equal(case1, 88000, `POT {3000,2000,2000} で 88000 期待、実 ${case1}`);

  // ケース 2: buyIn POT=1500（旧 buyIn 50% 移行値）→ 1500*24 + 2000*5 + 2000*3 = 52,000
  const case2 = simulateComputeCalculatedPool({ potAmounts: { buyIn: 1500, reentry: 2000, addOn: 2000 } }, runtime);
  assert.equal(case2, 52000, `POT {1500,2000,2000} で 52000 期待、実 ${case2}`);

  // ケース 3: 全 POT=0（新規デフォルト）→ pool=0
  const case3 = simulateComputeCalculatedPool({ potAmounts: { buyIn: 0, reentry: 0, addOn: 0 } }, runtime);
  assert.equal(case3, 0, `全 POT 0 で 0 期待、実 ${case3}`);

  // ケース 4: 部分 POT（3000 / 1000 / 0）→ 3000*24 + 1000*5 + 0 = 77,000
  const case4 = simulateComputeCalculatedPool({ potAmounts: { buyIn: 3000, reentry: 1000, addOn: 0 } }, runtime);
  assert.equal(case4, 77000, `POT {3000,1000,0} で 77000 期待、実 ${case4}`);
});

// ============================================================
// T11: 動作テスト — rate=0% で pool=0、GTD=N で pool=N
// ============================================================
test('T11 (v2.6.0 動作): max(calc, GTD) ロジック維持 — POT=0 で GTD のみ反映', () => {
  const runtime = { playersInitial: 24, reentryCount: 5, addOnCount: 3 };

  // ケース 1: POT 全 0, GTD=0 → pool=0
  const c1 = simulateComputeTotalPool(
    { potAmounts: { buyIn: 0, reentry: 0, addOn: 0 }, guarantee: 0 }, runtime);
  assert.equal(c1, 0, `POT 全 0 / GTD 0 で 0 期待、実 ${c1}`);

  // ケース 2: POT 全 0, GTD=50000 → pool=50000（GTD 優先、新規トーナメントの安全側挙動）
  const c2 = simulateComputeTotalPool(
    { potAmounts: { buyIn: 0, reentry: 0, addOn: 0 }, guarantee: 50000 }, runtime);
  assert.equal(c2, 50000, `POT 全 0 / GTD 50000 で 50000 期待、実 ${c2}`);

  // ケース 3: POT {3000,2000,2000}, GTD=50000, calc=88000 → pool=88000（calc > GTD）
  const c3 = simulateComputeTotalPool(
    { potAmounts: { buyIn: 3000, reentry: 2000, addOn: 2000 }, guarantee: 50000 }, runtime);
  assert.equal(c3, 88000, `POT calc 88000 / GTD 50000 で 88000 期待、実 ${c3}`);

  // ケース 4: POT {3000,2000,2000}, GTD=200000, calc=88000 → pool=200000（GTD 優先）
  const c4 = simulateComputeTotalPool(
    { potAmounts: { buyIn: 3000, reentry: 2000, addOn: 2000 }, guarantee: 200000 }, runtime);
  assert.equal(c4, 200000, `POT calc 88000 / GTD 200000 で 200000 期待、実 ${c4}`);
});

// ============================================================
// T12: 致命バグ保護 5 件 cross-check
// ============================================================
test('T12 (保護): 致命バグ保護 5 件すべて完全維持', () => {
  // C.2.7-A: resetBlindProgressOnly
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly 関数消失');
  // C.1-A2: ensureEditorEditableState
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState 関数消失');
  // C.1.7: AudioContext.resume（audio.js _play() 内 suspended 検出）
  assert.match(AUDIO_JS, /audioContext\.state\s*===\s*['"]suspended['"]/,
    'C.1.7: AudioContext suspend 検出が audio.js から消失');
  // C.1.8: schedulePersistRuntime 8 箇所以上
  const persistCalls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(persistCalls >= 8, `C.1.8: schedulePersistRuntime 呼出が ${persistCalls} 件（期待 8 以上）`);
  // C.2.7-D: tournaments:setDisplaySettings 経路
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラ消失');
});

// ============================================================
// T13: scripts.test 登録 + version 2.4.0
// ============================================================
test('T13: scripts.test 登録 + package.json version = 2.4.0', () => {
  assert.equal(PKG.version, '2.6.2',
    `package.json version が ${PKG.version}（期待 2.4.0）`);
  assert.ok(PKG.scripts && typeof PKG.scripts.test === 'string', 'scripts.test がない');
  assert.ok(PKG.scripts.test.includes('v210-prize-pool-refactor.test.js'),
    'scripts.test に v210-prize-pool-refactor.test.js が登録されていない');
});

// ============================================================
// T14 (v2.6.0 E-1): 🔒fee-lock 機構（ボタン / feeLockState / setFeeReadonly /
//     _resolveFeeElements / 解除ダイアログ）が完全撤去されている
// ============================================================
test('T14 (v2.6.0 E-1): 🔒fee-lock 機構が完全撤去（ボタン / JS / 解除ダイアログ）', () => {
  // (a) HTML 側の 🔒ボタン id が消滅
  assert.ok(!/id="js-tournament-buyin-fee-lock"/.test(INDEX), 'HTML: 🔒 buyin ボタンが残存');
  assert.ok(!/id="js-tournament-reentry-fee-lock"/.test(INDEX), 'HTML: 🔒 reentry ボタンが残存');
  assert.ok(!/id="js-tournament-addon-fee-lock"/.test(INDEX), 'HTML: 🔒 addon ボタンが残存');

  // (b) renderer.js 側の fee-lock 機構（実コード）が消滅
  assert.ok(!/const\s+feeLockState\s*=/.test(RENDERER), 'feeLockState が残存');
  assert.ok(!/function\s+setFeeReadonly\s*\(/.test(RENDERER), 'setFeeReadonly が残存');
  assert.ok(!/function\s+lockAllFees\s*\(/.test(RENDERER), 'lockAllFees が残存');
  assert.ok(!/function\s+_resolveFeeElements\s*\(/.test(RENDERER), '_resolveFeeElements が残存');
  assert.ok(!/FeeLockBtn:\s*document\.getElementById/.test(RENDERER), 'FeeLockBtn el 参照が残存');

  // (c) ★致命保護不可侵: ensureEditorEditableState / setBlindsTableReadonly は維持（別 namespace）
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState（致命バグ保護）まで消してはいけない');

  // (d) 🔒 click listener も消滅（直接登録 / 動的キー組立てとも残っていない）
  assert.ok(!/FeeLockBtn\?\.addEventListener/.test(RENDERER), '🔒 ボタンの listener 登録が残存');
  assert.doesNotMatch(RENDERER, /function\s+_capitalizeFeeTarget\s*\(/,
    '_capitalizeFeeTarget 関数（動的キー組立て）が残存');

  // (e) 店舗デフォルト IPC は dormant の setPoolRatesDefault に加え v2.6.0 setPotDefaults を公開
  assert.match(PRELOAD, /setPotDefaults:\s*\(value\)\s*=>/, 'preload.js の setPotDefaults API 公開消失');
  assert.match(MAIN_JS, /ipcMain\.handle\(\s*['"]settings:setPotDefaults['"]/,
    'main.js の settings:setPotDefaults IPC ハンドラ消失');
});

// ============================================================
// 結果サマリ
// ============================================================
console.log(`\nv210-prize-pool-refactor: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
