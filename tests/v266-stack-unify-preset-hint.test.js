/**
 * v2.6.0 stack-unify + preset-hint（2026-06-08）
 *
 * B: 初期スタックを buyIn.chips に統一・独立「スタートスタック」欄（startingStack）を UI 撤去。
 *   - computeAvgStack は buyIn.chips ベース（reentry/addOn/specialStack 項・playersRemaining<=0 早期 return は不変）
 *   - migration: 未 unified トーナメントに buyIn.chips := startingStack（AVG STACK 数値保全）+ stackModel='unified' marker
 *     （一度きり＝後続スタック編集を巻き戻さない / 旧形式 import も normalizeTournament で救済 / startingStack dormant 温存）
 * ③: 配当「プリセット適用」に説明 inline hint 追加（機能変更なし）。
 *
 * 実行: node tests/v266-stack-unify-preset-hint.test.js
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

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// B1: computeAvgStack は buyIn.chips ベース
// ============================================================
test('B1: computeAvgStack の初期スタック項が buyIn.chips（startingStack 不使用）', () => {
  const i = RENDERER.indexOf('function computeAvgStack');
  assert.ok(i >= 0, 'computeAvgStack が見つからない');
  const body = RENDERER.slice(i, i + 700);
  assert.match(body, /buyIn\?\.chips/, 'computeAvgStack が buyIn.chips を使っていない');
  assert.match(body, /buyInChips\s*\*\s*tournamentRuntime\.playersInitial/, '初期スタック項が buyInChips × playersInitial でない');
  assert.ok(!/tournamentState\.startingStack/.test(body), 'computeAvgStack に startingStack 参照が残存');
  // reentry/addOn/specialStack 項は不変
  assert.match(body, /reentry\.chips\s*\|\|\s*0\)\s*\*\s*tournamentRuntime\.reentryCount/, 'reentry 項が変わった');
  assert.match(body, /addOn\.chips\s*\|\|\s*0\)\s*\*\s*tournamentRuntime\.addOnCount/, 'addOn 項が変わった');
  // playersRemaining<=0 早期 return（負値ガード）維持
  assert.match(body, /playersRemaining\s*>\s*0/, 'playersRemaining ガードが消えた');
});

// ============================================================
// B2: UI — 独立スタートスタック欄撤去 / buyIn チップ（スタック）ラベル
// ============================================================
test('B2: 独立スタートスタック欄（js-tournament-starting-stack）が index.html から撤去', () => {
  assert.ok(!/js-tournament-starting-stack/.test(INDEX), 'js-tournament-starting-stack が残存');
  assert.ok(!/>スタートスタック</.test(INDEX), 'スタートスタック ラベルが残存');
});

test('B2b: バイインの「チップ（スタック）」欄は維持（初期スタック入力）', () => {
  assert.match(INDEX, /id="js-tournament-buyin-chips"/, 'buyin-chips 入力が消えた');
  assert.match(INDEX, /チップ（スタック）/, 'チップ（スタック）ラベルがない');
});

test('B3: renderer の startingStack 入力経路が撤去（el-map / 保存ビルドは入力欄を読まない）', () => {
  assert.ok(!/tournamentStartingStack:\s*document\.getElementById/.test(RENDERER), 'el.tournamentStartingStack 残存');
  assert.ok(!/el\.tournamentStartingStack/.test(RENDERER), 'el.tournamentStartingStack 参照残存');
  // 保存ビルドは dormant 値を凍結 pass-through（入力欄ではなく tournamentState から）
  assert.match(RENDERER, /startingStack:\s*tournamentState\.startingStack\s*\?\?\s*10000/, '保存ビルドの startingStack dormant 凍結がない');
});

// ============================================================
// B4: migration — buyIn.chips := startingStack + stackModel marker（AVG STACK 保全）
// ============================================================
test('B4a: migrateTournamentSchema が未 unified に buyIn.chips := startingStack + stackModel', () => {
  const i = MAIN_JS.indexOf('function migrateTournamentSchema');
  assert.ok(i >= 0, 'migrateTournamentSchema が見つからない');
  const body = MAIN_JS.slice(i, i + 6000);
  assert.match(body, /m\.stackModel\s*!==\s*'unified'/, 'migration の未 unified ガードがない');
  assert.match(body, /m\.buyIn\.chips\s*=\s*Number\(m\.startingStack\)\s*\|\|\s*0/, 'migration の buyIn.chips := startingStack がない');
  assert.match(body, /m\.stackModel\s*=\s*'unified'/, 'migration の stackModel marker 設定がない');
});

test('B4b: normalizeTournament が未 unified（旧形式 import 等）を救済 + startingStack 温存', () => {
  // wasUnified / out.buyIn.chips := startingStack は normalizeTournament 内のみに出現（全体検索で堅牢に）
  assert.match(MAIN_JS, /wasUnified\s*=\s*\(t\.stackModel\s*===\s*'unified'\)\s*\|\|\s*\(fallback\.stackModel\s*===\s*'unified'\)/, 'normalize の wasUnified 判定がない');
  assert.match(MAIN_JS, /if\s*\(!wasUnified\)\s*out\.buyIn\.chips\s*=\s*Number\(out\.startingStack\)/, 'normalize の未 unified 時 buyIn.chips := startingStack がない');
  assert.match(MAIN_JS, /out\.stackModel\s*=\s*'unified'/, 'normalize の stackModel 設定がない');
  // startingStack は削除せず温存（dormant ロールバック）— normalize に startingStack 既定補完が残る
  assert.match(MAIN_JS, /if\s*\(typeof\s+out\.startingStack\s*!==\s*'number'\)\s*out\.startingStack\s*=\s*DEFAULT_TOURNAMENT_EXT\.startingStack/, 'normalize の startingStack dormant 温存がない');
});

test('B4c: migration は startingStack を delete しない（dormant 温存・downgrade ロールバック安全）', () => {
  // migration / normalize ブロックで startingStack の delete が無いこと
  assert.ok(!/delete\s+m\.startingStack/.test(MAIN_JS), 'm.startingStack が削除されている（ロールバック不可）');
  assert.ok(!/delete\s+out\.startingStack/.test(MAIN_JS), 'out.startingStack が削除されている');
});

// ============================================================
// ③: プリセット適用の説明 hint
// ============================================================
test('C1: プリセット適用ボタン付近に説明 inline hint が追加（機能変更なし）', () => {
  // ボタン直後に hint 文（定番配分 / 自動入力 / 上書き の要素）
  const i = INDEX.indexOf('id="js-tournament-payout-preset"');
  assert.ok(i >= 0, 'プリセット適用ボタンが見つからない');
  const after = INDEX.slice(i, i + 400);
  assert.match(after, /定番配分/, 'プリセット説明（定番配分）がない');
  assert.match(after, /自動入力/, 'プリセット説明（自動入力）がない');
  assert.match(after, /上書き/, 'プリセット説明（上書き）がない');
  // ボタン文言・機能は不変
  assert.match(INDEX, /id="js-tournament-payout-preset">プリセット適用</, 'プリセット適用ボタン文言が変わった');
});

// ============================================================
// 保護
// ============================================================
test('P1 (保護): 致命バグ保護 5 件すべて維持', () => {
  assert.ok(/function\s+resetBlindProgressOnly\s*\(/.test(RENDERER), 'resetBlindProgressOnly 消失');
  assert.ok(/function\s+ensureEditorEditableState\s*\(/.test(RENDERER), 'ensureEditorEditableState 消失');
  assert.ok(/setBlindsTableReadonly/.test(RENDERER), 'setBlindsTableReadonly 消失');
  assert.ok(/tournaments:setDisplaySettings/.test(MAIN_JS), 'timerState destructure 除外ハンドラ消失');
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `schedulePersistRuntime 呼出が ${calls} 件（8 以上期待）`);
});

test('P2 (保護): pool 計算（potAmounts）・reentry/addOn は非接触', () => {
  // computeCalculatedPool は potAmounts のみ（buyIn.chips を pool に混ぜない）
  const i = RENDERER.indexOf('function computeCalculatedPool');
  const body = RENDERER.slice(i, i + 400);
  assert.match(body, /tournamentState\.potAmounts/, 'computeCalculatedPool が potAmounts を使っていない');
  assert.ok(!/\.chips/.test(body), 'computeCalculatedPool に chips 参照が混入');
});

test('P3: version 2.6.0 据置（早期 bump なし）+ v266 登録', () => {
  assert.equal(PKG.version, '2.6.3', `version が ${PKG.version}`);
  assert.ok(PKG.scripts.test.includes('v266-stack-unify-preset-hint.test.js'), 'v266 未登録');
});

// ============================================================
// 機能シミュレーション: migration の AVG STACK 保全（純ロジック）
// ============================================================
test('F1 (機能): migration ロジックで AVG STACK 数値が不変（buyIn.chips := startingStack）', () => {
  // computeAvgStack 相当の純関数（buyIn.chips ベース・新実装）
  const avgNew = (t, rt) => {
    const buyInChips = Number(t.buyIn?.chips) || 0;
    const reentry = t.reentry || { chips: 0 };
    const addOn   = t.addOn   || { chips: 0 };
    const ss      = t.specialStack || { enabled: false };
    const ssChips = ss.enabled ? (Number(ss.chips) || 0) * (Number(ss.appliedCount) || 0) : 0;
    const total = buyInChips * rt.playersInitial + (reentry.chips || 0) * rt.reentryCount
                + (addOn.chips || 0) * rt.addOnCount + ssChips;
    return rt.playersRemaining > 0 ? Math.floor(total / rt.playersRemaining) : 0;
  };
  // 旧 AVG（startingStack ベース）
  const avgOld = (t, rt) => {
    const startingStack = Number(t.startingStack) || 0;
    const reentry = t.reentry || { chips: 0 };
    const addOn   = t.addOn   || { chips: 0 };
    const ss      = t.specialStack || { enabled: false };
    const ssChips = ss.enabled ? (Number(ss.chips) || 0) * (Number(ss.appliedCount) || 0) : 0;
    const total = startingStack * rt.playersInitial + (reentry.chips || 0) * rt.reentryCount
                + (addOn.chips || 0) * rt.addOnCount + ssChips;
    return rt.playersRemaining > 0 ? Math.floor(total / rt.playersRemaining) : 0;
  };
  // migration: buyIn.chips := startingStack
  const migrate = (t) => ({ ...t, buyIn: { ...t.buyIn, chips: Number(t.startingStack) || 0 }, stackModel: 'unified' });

  const cases = [
    { startingStack: 20000, buyIn: { fee: 3000, chips: 10000 }, reentry: { chips: 8000 }, addOn: { chips: 10000 }, specialStack: { enabled: true, chips: 5000, appliedCount: 2 } },
    { startingStack: 15000, buyIn: { fee: 3000, chips: 0 },     reentry: { chips: 8000 }, addOn: { chips: 10000 }, specialStack: { enabled: false } },
    { startingStack: 30000, buyIn: { fee: 5000, chips: 30000 }, reentry: { chips: 30000 }, addOn: { chips: 30000 }, specialStack: { enabled: false } },
  ];
  const rt = { playersInitial: 9, playersRemaining: 6, reentryCount: 3, addOnCount: 2 };
  for (const t of cases) {
    const before = avgOld(t, rt);
    const after  = avgNew(migrate(t), rt);
    assert.equal(after, before, `AVG STACK が migration で変化（before=${before} after=${after}, stack=${t.startingStack} buyInChips=${t.buyIn.chips}）`);
  }
});

console.log(`\nv266-stack-unify-preset-hint.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
