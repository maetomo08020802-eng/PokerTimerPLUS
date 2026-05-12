/**
 * v2.1.20-rc8 静的解析テスト — applyTimerStateToTimer の PRE_START 中 reset スキップ
 *
 *   Fix 1: renderer.js applyTimerStateToTimer の 'idle' 経路 operator 側に isPreStartActive() ガード追加
 *          HDMI 挿し直し時 operator 再生成 → initialize() 内 applyTimerStateToTimer({status:'idle'}) →
 *          timerReset() → reset() 内 wasPreStart=true → onPreStartCancel → publishPreStartIfOperator
 *          ({isActive:false}) で main cache 破壊する race を阻止。
 *
 *   rc1〜rc7 機構 + 計測機構 + 致命バグ保護 5 件 完全保持
 *
 * 実行: node tests/v246-prestart-skip-reset.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PKG        = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const TIMER_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const DUAL_SYNC  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const STATE_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'state.js'), 'utf8');
const MAIN_JS    = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const STYLE_CSS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const AUDIO_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// applyTimerStateToTimer 内 idle 経路の if (!isHallApply) ブロックを balanced brace で抽出
function extractIdleNonHallBlock() {
  const idleStart = RENDERER.indexOf("if (ts.status === 'idle')");
  if (idleStart < 0) return null;
  // この後の最初の `if (!isHallApply)` を探す
  const nonHallStart = RENDERER.indexOf('if (!isHallApply)', idleStart);
  if (nonHallStart < 0 || nonHallStart - idleStart > 500) return null;
  const braceOpen = RENDERER.indexOf('{', nonHallStart);
  if (braceOpen < 0) return null;
  let depth = 1;
  let end = braceOpen + 1;
  while (end < RENDERER.length && depth > 0) {
    const ch = RENDERER[end];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    end++;
  }
  return RENDERER.slice(braceOpen + 1, end - 1);
}

// applyTimerStateToTimer 内 idle 経路の else（hall）ブロックを balanced brace で抽出
function extractIdleHallBlock() {
  const idleStart = RENDERER.indexOf("if (ts.status === 'idle')");
  if (idleStart < 0) return null;
  const nonHallStart = RENDERER.indexOf('if (!isHallApply)', idleStart);
  if (nonHallStart < 0) return null;
  const braceOpen = RENDERER.indexOf('{', nonHallStart);
  let depth = 1;
  let end = braceOpen + 1;
  while (end < RENDERER.length && depth > 0) {
    const ch = RENDERER[end];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    end++;
  }
  // end は !isHallApply ブロックの閉じ } の次の位置 → else { ... } をその後ろから抽出
  const elseStart = RENDERER.indexOf('else', end);
  if (elseStart < 0 || elseStart - end > 30) return null;
  const elseBraceOpen = RENDERER.indexOf('{', elseStart);
  let depth2 = 1;
  let end2 = elseBraceOpen + 1;
  while (end2 < RENDERER.length && depth2 > 0) {
    const ch = RENDERER[end2];
    if (ch === '{') depth2++;
    else if (ch === '}') depth2--;
    end2++;
  }
  return RENDERER.slice(elseBraceOpen + 1, end2 - 1);
}

// ============================================================
// T1: package.json.version === '2.1.20-rc8'
// ============================================================
test('T1: package.json.version === 2.1.20-rc8', () => {
  assert.equal(PKG.version, '2.1.20-rc8', `期待 2.1.20-rc8, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix 1 — !isHallApply ブロック内に isPreStartActive() ガード存在
// ============================================================
test('T2: applyTimerStateToTimer idle 経路 !isHallApply 内に isPreStartActive() ガード存在', () => {
  const block = extractIdleNonHallBlock();
  assert.ok(block, '!isHallApply ブロックが抽出できない');
  // isPreStartActive() 呼出 + ガード経路
  assert.match(block,
    /if\s*\(\s*typeof\s+isPreStartActive\s*===\s*['"]function['"][\s\S]{0,80}?isPreStartActive\s*\(\s*\)\s*\)/,
    'Fix 1 未完了: !isHallApply ブロック内に isPreStartActive() ガードがない');
});

// ============================================================
// T3: Fix 1 — 新規ラベル `operator:applyTimerStateToTimer:skip-reset-during-prestart` 存在
// ============================================================
test('T3: 新規ラベル operator:applyTimerStateToTimer:skip-reset-during-prestart が renderer.js 内に存在', () => {
  assert.ok(RENDERER.includes('operator:applyTimerStateToTimer:skip-reset-during-prestart'),
    'Fix 1 未完了: 新規ラベル operator:applyTimerStateToTimer:skip-reset-during-prestart が見つからない');
  // !isHallApply ブロック内で発火
  const block = extractIdleNonHallBlock();
  assert.ok(block);
  assert.match(block,
    /['"]operator:applyTimerStateToTimer:skip-reset-during-prestart['"]/,
    'Fix 1 未完了: 新規ラベルが !isHallApply ブロック内で発火していない');
});

// ============================================================
// T4: Fix 1 — ガード通過時に return（timerReset() を呼ばずに早期 return）
// ============================================================
test('T4: isPreStartActive() ガード true 経路で return（timerReset を呼ばない）', () => {
  const block = extractIdleNonHallBlock();
  assert.ok(block, '!isHallApply ブロックが抽出できない');
  // ガード ブロック内に return 存在 + その後に timerReset()
  assert.match(block,
    /isPreStartActive\s*\(\s*\)\s*\)\s*\{[\s\S]{0,400}?return[\s\S]{0,80}?\}[\s\S]{0,200}?timerReset\s*\(\s*\)/,
    'Fix 1 未完了: ガード ブロック内に return → ガード外に timerReset() の構造がない');
});

// ============================================================
// T5: hall 側 else ブロックの hallTickState reset 3 マーカー（rc2 機構）touch なし
// ============================================================
test('T5: hall 側 else ブロックの rc2 hallTickState reset マーカー完全保持', () => {
  const hallBlock = extractIdleHallBlock();
  assert.ok(hallBlock, 'idle hall else ブロックが抽出できない');
  // rc2 trigger ラベル
  assert.match(hallBlock, /trigger:\s*['"]applyTimerStateToTimer-non-running['"]/,
    'rc2 退行: hall else ブロックの hallTickState:reset trigger 消失');
  // hallTickState フィールド reset 5 種
  for (const fld of ['startedAtMs', 'status', 'currentLevelIndex', 'totalMs', 'isActive']) {
    assert.match(hallBlock, new RegExp(`hallTickState\\.${fld}\\s*=\\s*`),
      `rc2 退行: hall else ブロックの hallTickState.${fld} 代入消失`);
  }
  // stopHallTickFrame + setState(States.IDLE) 経路維持
  assert.match(hallBlock, /stopHallTickFrame\s*\(\s*\)/,
    'rc2 退行: hall else ブロックの stopHallTickFrame 消失');
  assert.match(hallBlock, /setState\s*\(\s*\{[\s\S]{0,200}?status:\s*States\.IDLE/,
    'rc2 退行: hall else ブロックの setState(IDLE) 消失');
});

// ============================================================
// T6: 他 status 経路（'finished' / invalid-ts / levelCount === 0）の operator 側 timerReset 呼出 touch なし
// ============================================================
test('T6: 他 status 経路（finished / invalid / levelCount===0）の operator timerReset 呼出 touch なし', () => {
  // 'finished' 経路: !isHallApply で timerReset() 呼出が維持されている（ガードなし）
  const finishedStart = RENDERER.indexOf("if (ts.status === 'finished')");
  assert.ok(finishedStart >= 0, "finished 経路が見つからない");
  const finishedSlice = RENDERER.slice(finishedStart, finishedStart + 800);
  assert.match(finishedSlice, /if\s*\(\s*!isHallApply\s*\)\s*timerReset\s*\(\s*\)/,
    "'finished' 経路の !isHallApply で timerReset() が無条件 touch されている（rc8 範囲外、変更禁止）");
  // 'finished' 経路には isPreStartActive ガードを追加していないこと
  assert.doesNotMatch(finishedSlice, /isPreStartActive\s*\(\s*\)[\s\S]{0,200}?return[\s\S]{0,200}?timerReset/,
    "'finished' 経路に isPreStartActive ガードが追加されている（rc8 スコープ違反）");
});

// ============================================================
// T7: rc7 機構保持（cache merge / preStart:cache:merge / _appendPriorityLog lazy init）
// ============================================================
test('T7: rc7 機構（cache merge + priority log lazy init）完全保持', () => {
  // cache merge ロジック
  assert.match(MAIN_JS, /const\s+prev\s*=\s*_dualStateCache\.preStartState\s*\|\|\s*\{\s*\}/,
    'rc7 退行: prev = _dualStateCache.preStartState || {} 消失');
  assert.match(MAIN_JS, /else\s+if\s*\(\s*Number\.isFinite\s*\(\s*prev\.totalMs\s*\)/,
    'rc7 退行: totalMs cache fallback 消失');
  assert.ok(MAIN_JS.includes('preStart:cache:merge'),
    'rc7 退行: preStart:cache:merge ラベル消失');
  // _appendPriorityLog 内 lazy init
  const m = MAIN_JS.match(/function\s+_appendPriorityLog\s*\(\s*entry\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m);
  assert.match(m[1],
    /try\s*\{[\s\S]{0,200}?_initPriorityLogFile\s*\(\s*\)[\s\S]{0,200}?_priorityLogBuffer\.push/,
    'rc7 退行: _appendPriorityLog 内 lazy init 消失');
});

// ============================================================
// T8: rc1〜rc6-meas3 機構保持
// ============================================================
test('T8: rc1〜rc6-meas3 機構完全保持', () => {
  // rc6-meas3 主要機構
  assert.match(MAIN_JS, /const\s+_isMeasBuildForBuffer\s*=/, 'rc6-meas3 Fix A 退行');
  assert.match(MAIN_JS, /function\s+_flushLogsToFile\s*\(\s*suffix\s*\)\s*\{/, 'rc6-meas3 Fix B 退行');
  assert.match(MAIN_JS, /const\s+PRIORITY_LOG_LABELS\s*=\s*new\s+Set\s*\(/, 'rc6-meas3 Fix C 退行');
  assert.match(RENDERER, /function\s+_recordHighFreq\s*\(\s*label\s*,\s*ms\s*\)\s*\{/, 'rc6-meas3 Fix F 退行');
  // rc5 機構
  assert.ok(MAIN_JS.includes('preStart:operator:send'), 'rc5 退行');
  assert.ok(MAIN_JS.includes('operator:preStartResync:sent'), 'rc5 退行');
  // rc4 機構
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  assert.match(RENDERER, /function\s+applyOperatorPreStartState\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  // rc3
  assert.match(RENDERER, /function\s+renderTournamentListWithDedup\s*\(/, 'rc3 退行');
  // rc2
  for (const tg of ['applyTimerStateToTimer-non-running', 'applyHallPreStartState-inactive', 'hall-window-init']) {
    assert.ok(RENDERER.includes(`'${tg}'`), `rc2 退行: ${tg} 消失`);
  }
  // rc1
  assert.match(RENDERER, /document\.createDocumentFragment\s*\(\s*\)/, 'rc1 Fix 2-A 退行');
  assert.match(RENDERER, /function\s+computeLiveTimerStateMemoized\s*\(/, 'rc1 Fix 2-B 退行');
  assert.match(STYLE_CSS, /\.clock\[data-prestart-paused="true"\]\s+\.clock__pause-label\s*\{[^}]*opacity\s*:\s*1/, 'rc1 Fix 4 退行');
});

// ============================================================
// T9: v2.1.19 + 致命バグ保護 5 件
// ============================================================
test('T9: v2.1.19 機構 + 致命バグ保護 5 件 完全保持', () => {
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/, 'v2.1.19 退行');
  // 致命バグ保護 5 件
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A 消失');
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/, 'C.2.7-D 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'C.1-A2 消失');
  assert.match(AUDIO_JS, /resume/, 'C.1.7 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'C.1.8 消失');
});

// ============================================================
// T10: 計測機構 + 新規 rc8 ラベル
// ============================================================
test('T10: meas1+meas2+症状確証 4+rc2/rc4/rc5/meas3/rc7 ラベル + 新規 rc8 ラベル保持', () => {
  // meas1 バッジ
  assert.match(INDEX_HTML, /<div\s+id="meas-build-badge">\s*計測ビルド\s*<\/div>/, 'meas-build-badge HTML 消失');
  assert.ok(STYLE_CSS.includes('#meas-build-badge'), '#meas-build-badge CSS 消失');
  // meas2 6 カテゴリ
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  for (const lbl of ['perf:interval:fire', 'perf:raf:summary', 'perf:ipc:summary', 'perf:dom:summary', 'perf:long-task', 'perf:subscribe:summary']) {
    assert.ok(ALL_SRC.includes(lbl), `meas2 ラベル ${lbl} 消失`);
  }
  // 症状確証 4
  for (const lbl of ['hall:syncSlideshowFromState:call', 'hall:updatePipTimer:set', 'hall:applyHallPreStartState:apply', 'hall:clock-pause-label:visibility']) {
    assert.ok(ALL_SRC.includes(lbl), `症状確証ラベル ${lbl} 消失`);
  }
  // rc2 / rc4 / rc5 / meas3 / rc7
  assert.ok(RENDERER.includes('hall:hallTickState:reset'), 'rc2 退行');
  assert.ok(RENDERER.includes('operator:applyPreStartState:apply'), 'rc4 退行');
  assert.ok(MAIN_JS.includes('preStart:operator:send'), 'rc5 退行');
  assert.ok(MAIN_JS.includes('operator:preStartResync:sent'), 'rc5 退行');
  assert.ok(RENDERER.includes('perf:highfreq:summary'), 'meas3 退行');
  assert.ok(MAIN_JS.includes('meas3:hdmi-snapshot:written'), 'meas3 退行');
  assert.ok(MAIN_JS.includes('preStart:cache:merge'), 'rc7 退行');
  // rc8 新規ラベル
  assert.ok(RENDERER.includes('operator:applyTimerStateToTimer:skip-reset-during-prestart'),
    'rc8 新規ラベル operator:applyTimerStateToTimer:skip-reset-during-prestart が renderer.js に見つからない');
});

console.log(`\nv246 prestart-skip-reset: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
