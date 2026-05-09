/**
 * v2.1.10 静的解析テスト — hall window の rAF 競合解消（4 → 1）+ 計測機構同梱
 *
 *   Fix 1: src/renderer/renderer.js applyTimerStateToTimer 内の timer.js 関数呼出
 *          （timerReset / timerStartAtLevel / timerAdvanceBy / timerPause）に hall ガード
 *          → 案 3 細分化、DOM 描画 / setState は hall でも続行
 *   Fix 2: src/renderer/renderer.js renderHallPreStartTick の独立 rAF 廃止
 *          → renderHallPreStartFrame に renamed、broadcast 受信時の即時 DOM 更新化（案 6）
 *   Fix 3: src/renderer/dual-sync.js に hall 限定の計測機構同梱
 *          （IPC 受信 / flush 所要時間 / frame skip / DOM 更新タイミング）
 *
 * 真因（hall 表示遅延 1 秒）: hall window で 3〜4 個の独立 rAF ループ同時回転 → frame skip
 *   → 累積 1 秒。timer.js tick / preStartTick + renderHallPreStartTick + dual-sync flush。
 * 修正効果: PRE_START 中の同時 rAF: 4 → 1（dual-sync flush のみ）。RUNNING 中: 2 → 1。
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 * v2.1.6 / v2.1.7 / v2.1.8 / v2.1.9 機構すべて維持。
 *
 * 実行: node tests/v222-hall-rAF-reduction.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');

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
// T1 (Fix 1): applyTimerStateToTimer 内で timerStartAtLevel 呼出が hall ガードで囲まれている
// ============================================================
test('T1 (Fix 1): applyTimerStateToTimer 内で timerStartAtLevel に hall ガード', () => {
  const body = extractFnBody(RENDERER, /function\s+applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyTimerStateToTimer 関数本体が抽出できない');
  // isHallApply 変数で hall 判定 → !isHallApply ガードで timer.js 関数呼出を skip
  assert.match(body, /isHallApply[\s\S]*?window\.appRole\s*===\s*['"]hall['"]/,
    'applyTimerStateToTimer 冒頭で window.appRole === "hall" 判定の isHallApply 変数がない');
  // timerStartAtLevel 呼出は !isHallApply ガード内
  assert.match(body, /if\s*\(\s*!isHallApply\s*\)\s*\{[\s\S]*?timerStartAtLevel\s*\(/,
    'timerStartAtLevel 呼出が !isHallApply ガードで囲まれていない');
});

// ============================================================
// T2 (Fix 1): 同関数内で timerReset / timerAdvanceBy / timerPause 呼出にも hall ガード
// ============================================================
test('T2 (Fix 1): timerReset / timerAdvanceBy / timerPause すべてに hall ガード', () => {
  const body = extractFnBody(RENDERER, /function\s+applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyTimerStateToTimer 関数本体が抽出できない');
  // timerReset の全呼出箇所が `if (!isHallApply) timerReset()` パターン
  // 元実装は無条件 timerReset() が 4 箇所、すべて hall ガード必須
  const timerResetCalls = body.match(/timerReset\s*\(\s*\)/g) || [];
  assert.ok(timerResetCalls.length >= 4,
    `timerReset 呼出が 4 件以上必要（現在 ${timerResetCalls.length}件）`);
  // 各 timerReset 呼出の直前に !isHallApply or 同等のガードがあること
  // 文字列パターンで全箇所 `!isHallApply\) timerReset` を検証
  const guardedResetMatches = body.match(/!\s*isHallApply\s*\)\s*timerReset\s*\(\s*\)/g) || [];
  assert.ok(guardedResetMatches.length >= 4,
    `timerReset 呼出で !isHallApply ガード付きが 4 件以上必要（現在 ${guardedResetMatches.length}件）`);

  // timerAdvanceBy / timerPause 呼出が !isHallApply ブロック内に存在
  assert.match(body, /if\s*\(\s*!isHallApply\s*\)\s*\{[\s\S]*?timerAdvanceBy\s*\(/,
    'timerAdvanceBy 呼出が !isHallApply ガードブロック内にない');
  assert.match(body, /if\s*\(\s*!isHallApply\s*\)\s*\{[\s\S]*?timerPause\s*\(\s*\)/,
    'timerPause 呼出が !isHallApply ガードブロック内にない');
});

// ============================================================
// T3 (Fix 1 動作保証): hall 経路でも setState を呼んで subscribe コールバックを発火させる
// ============================================================
test('T3 (Fix 1): hall 経路で setState 直接呼出 + DOM 更新は hall ガードで囲まれていない', () => {
  const body = extractFnBody(RENDERER, /function\s+applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyTimerStateToTimer 関数本体が抽出できない');
  // hall 経路で setState 直接呼出（subscribe → renderTime / renderNextBreak 経路の保持）
  assert.match(body, /setState\s*\(\s*\{[\s\S]*?currentLevelIndex[\s\S]*?remainingMs[\s\S]*?totalMs[\s\S]*?status[\s\S]*?\}\s*\)/,
    'hall 経路で setState({ currentLevelIndex, remainingMs, totalMs, status }) の直接呼出がない');
  // DOM 更新（el.clock?.classList.remove/add）は無条件（hall ガードなし）で実行される
  // 1 つ目の el.clock?.classList.remove 行を確認
  const firstClockClass = body.indexOf('el.clock?.classList.remove(\'clock--timer-finished\')');
  assert.ok(firstClockClass >= 0, 'el.clock?.classList.remove の呼出が見つからない');
  // この行の直後（次の文）が timerReset ではなく無条件で続いていること
  // つまり、el.clock?.classList.remove と timerReset は別行で、!isHallApply ガードはあくまで timerReset 側にだけ適用
  const after = body.slice(firstClockClass);
  assert.match(after, /el\.clock\?\.classList\.remove\('clock--timer-finished'\);[\s\S]*?(if\s*\(\s*!isHallApply\s*\)\s*timerReset|isHallApply)/,
    'DOM 更新（classList.remove）と timerReset 呼出が同条件で囲まれている（hall でも DOM は更新するべき）');
});

// ============================================================
// T4 (Fix 2): renderHallPreStartTick の rAF 駆動部分が削除されている
//
// v2.1.11 注記: 本テストは v2.1.10 で「rAF 廃止」を検証していたが、その設計が
//   「PRE_START カウントダウン進まず」「BREAK カクカク」症状を生んだため v2.1.11 で
//   rAF 自己再帰を v2.1.6 同等に復活させた。本 assertion は v2.1.11 で破壊されるため
//   削除する（履歴は CHANGELOG / git log で参照可、代替検証は v223 T5）。
// ============================================================

// ============================================================
// T5 (Fix 2): applyHallPreStartState で broadcast 受信時の即時 DOM 更新ロジックが存在
// ============================================================
test('T5 (Fix 2): applyHallPreStartState で broadcast 受信時の即時 DOM 更新呼出', () => {
  const body = extractFnBody(RENDERER, /function\s+applyHallPreStartState\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyHallPreStartState 関数本体が抽出できない');
  // isActive=true 経路で renderHallPreStartFrame() or renderHallPreStartTick() を 1 回呼出
  // （旧名 / 新名どちらでも可、再帰 rAF 廃止後の即時 DOM 更新パターン）
  assert.match(body, /renderHallPreStartFrame\s*\(\s*\)|renderHallPreStartTick\s*\(\s*\)/,
    'applyHallPreStartState 内で broadcast 受信時の即時 DOM 更新関数（renderHallPreStartFrame / Tick）の呼出がない');
  // window.appRole !== 'hall' 早期 return ガードは維持（既存）
  assert.match(body, /window\.appRole\s*!==\s*['"]hall['"][\s\S]{0,30}return/,
    'applyHallPreStartState 冒頭の hall ガード（appRole !== "hall" 早期 return）が消えている');
});

// ============================================================
// T6 (Fix 3): 計測機構が hall window でのみ動作する（_isHall() ガード）
// ============================================================
test('T6 (Fix 3): 計測機構の _isHall ガード + 主要記録ラベルの存在', () => {
  // dual-sync.js に _isHall / _logHall ヘルパが存在
  assert.match(DUAL_SYNC, /function\s+_isHall\s*\(\s*\)\s*\{[\s\S]*?window\.appRole\s*===\s*['"]hall['"]/,
    'dual-sync.js に _isHall() ヘルパ関数（window.appRole === "hall" 判定）がない');
  assert.match(DUAL_SYNC, /function\s+_logHall\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*!_isHall\(\)\s*\)\s*return/,
    'dual-sync.js に _logHall() ヘルパ関数（!_isHall() で operator では計測しない）がない');
  // 主要記録ラベル: hall:dualSync:recv / hall:dualSync:flush / hall:dualSync:frameSkip
  assert.match(DUAL_SYNC, /['"]hall:dualSync:recv['"]/,
    'dual-sync.js に IPC 受信ログラベル "hall:dualSync:recv" がない');
  assert.match(DUAL_SYNC, /['"]hall:dualSync:flush['"]/,
    'dual-sync.js に flush 計測ログラベル "hall:dualSync:flush" がない');
  assert.match(DUAL_SYNC, /['"]hall:dualSync:frameSkip['"]/,
    'dual-sync.js に frame skip ログラベル "hall:dualSync:frameSkip" がない');
  // FRAME_SKIP_THRESHOLD_MS = 25 が定義されている
  assert.match(DUAL_SYNC, /FRAME_SKIP_THRESHOLD_MS\s*=\s*25/,
    'dual-sync.js に FRAME_SKIP_THRESHOLD_MS = 25 の定義がない');

  // renderer.js: applyTimerStateToTimer / applyHallPreStartState の DOM 更新時刻記録ラベル
  assert.match(RENDERER, /['"]hall:applyTimerStateToTimer:enter['"]/,
    'renderer.js に DOM 更新タイミングログラベル "hall:applyTimerStateToTimer:enter" がない');
  assert.match(RENDERER, /['"]hall:applyHallPreStartState:enter['"]/,
    'renderer.js に DOM 更新タイミングログラベル "hall:applyHallPreStartState:enter" がない');
});

// ============================================================
// T7: package.json version 2.1.12 + scripts.test に v222 登録
// ============================================================
test('T7: package.json version は 2.1.12 + scripts.test に v222 登録', () => {
  assert.equal(PKG.version, '2.1.18-rc2',
    `package.json version が ${PKG.version}（期待 2.1.18-rc2）`);
  assert.match(PKG.scripts.test, /v222-hall-rAF-reduction\.test\.js/,
    'scripts.test に v222-hall-rAF-reduction.test.js が登録されていない');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
