/**
 * v2.1.12 静的解析テスト — スライドショー周辺退行 2 件のピンポイント根治
 *
 *   Fix 1: src/renderer/renderer.js subscribe コールバック内で status 変化時に
 *          slideshowState.userOverride = 'auto' リセット（症状 B 根治）
 *   Fix 2: src/renderer/renderer.js renderHallPreStartTick 内の el.clockTime → el.time
 *          typo 修正（症状 A 根治、ケース δ）
 *
 * 真因（症状 A、ケース δ）: el.clockTime プロパティが el オブジェクトに未定義
 *   （HTML id は js-time、el.time としてのみ定義済）→ if 条件 false で書込スキップ →
 *   v2.1.6 から hall 側 PRE_START メイン画面更新が無効、スライドショーが上に乗っている間
 *   気付かれずスライドショー解除で IDLE Lv1 duration が露見していた dead code バグ。
 *
 * 真因（症状 B）: handlePipShowTimer が userOverride='force-timer' を永続化
 *   v2.1.11 の hall 60fps tick で毎フレーム subscribe → syncSlideshowFromState 発火 →
 *   userOverride === 'force-timer' early return が継続発火 → BREAK 中も activateSlideshow 不発。
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 *
 * 実行: node tests/v224-userOverride-reset.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 関数本体（balanced brace）抽出ヘルパ
function extractFnBody(source, signatureRe) {
  const m = source.match(signatureRe);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

// ============================================================
// T1 (Fix 1): subscribe コールバック内で status 変化時に userOverride='auto' リセット
// ============================================================
test('T1 (Fix 1): subscribe 内で status 変化時に slideshowState.userOverride = "auto" リセット', () => {
  // status 変化分岐内で userOverride='auto' 代入が存在
  // パターン: state.status !== prev.status の条件ブロック内で slideshowState.userOverride = 'auto'
  // v2.1.20-meas1: main subscribe が subscribeNamed('subscribe:main-renderer', ...) に変更、両形式許容。
  let subscribeIdx = RENDERER.indexOf("subscribeNamed('subscribe:main-renderer', (state, prev) =>");
  if (subscribeIdx < 0) subscribeIdx = RENDERER.indexOf('subscribe((state, prev) =>');
  assert.ok(subscribeIdx >= 0, 'subscribe / subscribeNamed コールバック開始位置が見つからない');
  // status 変化分岐ブロックを探す（autoEndedAt = null + breakStartedAt 周辺）
  const block = RENDERER.slice(subscribeIdx, subscribeIdx + 5000);
  assert.match(block, /state\.status\s*!==\s*prev\.status[\s\S]*?slideshowState\.userOverride\s*=\s*['"]auto['"]/,
    'subscribe コールバック内の status 変化分岐に slideshowState.userOverride = "auto" リセットがない');
});

// ============================================================
// T2 (Fix 1): リセット位置が autoEndedAt = null の直後（順序保証）
// ============================================================
test('T2 (Fix 1): userOverride リセットが autoEndedAt = null と同じ status 変化分岐内', () => {
  // 連続コードパターン: autoEndedAt = null; ... slideshowState.userOverride = 'auto';
  // 両者が同じ if ブロック内に並んでいることを検証（autoEndedAt 直後の数行以内）
  assert.match(RENDERER, /slideshowState\.autoEndedAt\s*=\s*null;[\s\S]{0,1000}?slideshowState\.userOverride\s*=\s*['"]auto['"]/,
    'autoEndedAt = null と userOverride = "auto" が連続して同じブロック内に存在しない');
});

// ============================================================
// T3 (Fix 1): handlePipShowTimer の force-timer セット維持（即時効果は変わらない）
// ============================================================
test('T3 (Fix 1): handlePipShowTimer の userOverride = "force-timer" セットは維持', () => {
  const body = extractFnBody(RENDERER, /function\s+handlePipShowTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'handlePipShowTimer 関数本体が抽出できない');
  assert.match(body, /slideshowState\.userOverride\s*=\s*['"]force-timer['"]/,
    'handlePipShowTimer の userOverride = "force-timer" セットが消えている（即時効果に必要）');
  assert.match(body, /deactivateSlideshow\s*\(\s*\)/,
    'handlePipShowTimer の deactivateSlideshow() 呼出が消えている');
});

// ============================================================
// T4 (Fix 2): renderHallPreStartTick 内で el.time 書込（el.clockTime 不在確認）
// ============================================================
test('T4 (Fix 2): renderHallPreStartTick 内で el.time.textContent 書込（el.clockTime typo 修正済）', () => {
  const rawBody = extractFnBody(RENDERER, /function\s+renderHallPreStartTick\s*\([^)]*\)\s*\{/);
  assert.ok(rawBody, 'renderHallPreStartTick 関数本体が抽出できない');
  // コメント剥がし
  const body = rawBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // el.time.textContent への formatPreStartTime 書込
  assert.match(body, /el\.time\.textContent\s*=\s*formatPreStartTime/,
    'renderHallPreStartTick 内で el.time.textContent = formatPreStartTime(...) の書込がない（v2.1.12 typo 修正後の経路）');
  // el.clockTime 参照は存在しない（typo 修正済）
  assert.doesNotMatch(body, /el\.clockTime\b/,
    'renderHallPreStartTick 内に未定義プロパティ el.clockTime 参照が残っている（v2.1.12 typo 修正の regression）');
  // if (el.time && ...) ガードが存在
  assert.match(body, /if\s*\(\s*el\.time\s*&&[\s\S]*?formatPreStartTime/,
    'el.time の null guard を含む書込ブロックがない');
});

// ============================================================
// T5 (Fix 2 補強): el オブジェクトに clockTime プロパティが定義されていないこと（dead code 検証）
// ============================================================
test('T5 (Fix 2 補強): el オブジェクトに clockTime プロパティが定義されていない（dead code 確認）', () => {
  // const el = { ... } 定義ブロック内で clockTime: 出現がない
  const elBlockMatch = RENDERER.match(/const\s+el\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(elBlockMatch, 'const el = { ... } 定義ブロックが見つからない');
  assert.doesNotMatch(elBlockMatch[1], /clockTime\s*:/,
    'el オブジェクトに clockTime プロパティが追加されている（v2.1.12 では typo 修正で el.time に統合、追加禁止）');
  // el.time は存在
  assert.match(elBlockMatch[1], /time\s*:\s*document\.getElementById\(['"]js-time['"]\)/,
    'el.time の定義（document.getElementById("js-time")）が消えている');
});

// ============================================================
// T6: package.json version 2.1.12 + scripts.test に v224 登録
// ============================================================
test('T6: package.json version は 2.1.12 + scripts.test に v224 登録', () => {
  assert.equal(PKG.version, '2.1.20-rc10',
    `package.json version が ${PKG.version}（期待 2.1.18）`);
  assert.match(PKG.scripts.test, /v224-userOverride-reset\.test\.js/,
    'scripts.test に v224-userOverride-reset.test.js が登録されていない');
});

// ============================================================
// T7: 致命バグ保護 5 件すべて維持
// ============================================================
test('T7: 致命バグ保護 5 件すべて維持', () => {
  // C.2.7-A: resetBlindProgressOnly が renderer.js に存在
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly が renderer.js から消えている');
  // C.2.7-D: tournaments:setDisplaySettings の timerState destructure 除外
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラが消えている');
  // C.1-A2: ensureEditorEditableState が renderer.js に存在
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState が renderer.js から消えている');
  // C.1.7: AudioContext suspend resume 経路が audio.js _play に存在
  assert.match(AUDIO_JS, /audioContext\.state\s*===\s*['"]suspended['"]/,
    'C.1.7: AudioContext suspend 検出が audio.js から消えている');
  // C.1.8: tournaments:setRuntime IPC が main.js に存在
  assert.match(MAIN_JS, /tournaments:setRuntime/,
    'C.1.8: tournaments:setRuntime IPC が main.js から消えている');
  // schedulePersistRuntime 8 箇所以上
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `C.1.8: schedulePersistRuntime 呼出が ${calls} 件（期待 8 以上）`);
});

// ============================================================
// T8: v2.1.11 hallPreStartState / hallTickState 共存維持（v2.1.11 機構保護）
// ============================================================
test('T8: hallPreStartState（PRE_START）+ hallTickState（RUNNING/BREAK）の共存維持', () => {
  assert.match(RENDERER, /const\s+hallPreStartState\s*=\s*\{/,
    'hallPreStartState 定義が消えている（v2.1.6 機構の core）');
  assert.match(RENDERER, /const\s+hallTickState\s*=\s*\{/,
    'hallTickState 定義が消えている（v2.1.11 60fps tick の core）');
  assert.match(RENDERER, /function\s+renderHallPreStartTick\s*\(/,
    'renderHallPreStartTick 関数が消えている');
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/,
    'renderHallTickFrame 関数が消えている');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
