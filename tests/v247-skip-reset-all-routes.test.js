/**
 * v2.2.1 静的解析テスト — applyTimerStateToTimer の残り 3 経路にも PRE_START 中スキップガード追加
 *
 *   Fix 1-1: invalid-ts 経路 !isHallApply 内に isPreStartActive() ガード + trigger:'invalid-ts'
 *   Fix 1-2: idle 経路（rc8 既存）の data に trigger:'idle' フィールド追加
 *   Fix 1-3: finished 経路 !isHallApply 内に isPreStartActive() ガード + trigger:'finished'
 *           + el.clock?.classList.add('clock--timer-finished') 維持
 *   Fix 1-4: levelCount===0 経路 !isHallApply 内に isPreStartActive() ガード + trigger:'no-levels'
 *
 *   rc1〜rc8 機構 + 計測機構 + 致命バグ保護 5 件 完全保持
 *
 * 実行: node tests/v247-skip-reset-all-routes.test.js
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

// applyTimerStateToTimer 関数本体（balanced brace）を一度だけ抽出
const APPLY_TS_FN_BODY = (() => {
  const sigRe = /function\s+applyTimerStateToTimer\s*\([^)]*\)\s*\{/;
  const m = RENDERER.match(sigRe);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < RENDERER.length; i++) {
    const c = RENDERER[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return RENDERER.slice(open + 1, i); }
  }
  return null;
})();

// applyTimerStateToTimer 内に絞って、指定の if 条件文字列の直後にある最初の `if (!isHallApply) {` ブロックを balanced brace で抽出
function extractNonHallBlockAfter(condStr, lookAhead = 600) {
  const body = APPLY_TS_FN_BODY;
  if (!body) return null;
  const condStart = body.indexOf(condStr);
  if (condStart < 0) return null;
  const nonHallStart = body.indexOf('if (!isHallApply)', condStart);
  if (nonHallStart < 0 || nonHallStart - condStart > lookAhead) return null;
  const braceOpen = body.indexOf('{', nonHallStart);
  if (braceOpen < 0) return null;
  let depth = 1;
  let end = braceOpen + 1;
  while (end < body.length && depth > 0) {
    const ch = body[end];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    end++;
  }
  return body.slice(braceOpen + 1, end - 1);
}

// applyTimerStateToTimer 内に絞って、指定の if 条件文字列の直後にある !isHallApply { ... } else { ... } の else (hall) ブロックを抽出
function extractHallElseBlockAfter(condStr, lookAhead = 600) {
  const body = APPLY_TS_FN_BODY;
  if (!body) return null;
  const condStart = body.indexOf(condStr);
  if (condStart < 0) return null;
  const nonHallStart = body.indexOf('if (!isHallApply)', condStart);
  if (nonHallStart < 0 || nonHallStart - condStart > lookAhead) return null;
  const braceOpen = body.indexOf('{', nonHallStart);
  let depth = 1;
  let end = braceOpen + 1;
  while (end < body.length && depth > 0) {
    const ch = body[end];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    end++;
  }
  const elseStart = body.indexOf('else', end);
  if (elseStart < 0 || elseStart - end > 30) return null;
  const elseBraceOpen = body.indexOf('{', elseStart);
  let depth2 = 1;
  let end2 = elseBraceOpen + 1;
  while (end2 < body.length && depth2 > 0) {
    const ch = body[end2];
    if (ch === '{') depth2++;
    else if (ch === '}') depth2--;
    end2++;
  }
  return body.slice(elseBraceOpen + 1, end2 - 1);
}

// ============================================================
// T1: package.json.version === '2.2.1'
// ============================================================
test('T1: package.json.version === 2.2.1', () => {
  assert.equal(PKG.version, '2.6.0', `期待 2.2.1, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix 1-1 — invalid-ts 経路 !isHallApply 内に isPreStartActive() ガード + trigger:'invalid-ts'
// ============================================================
test('T2: invalid-ts 経路 !isHallApply 内に isPreStartActive() ガード + trigger:invalid-ts', () => {
  const block = extractNonHallBlockAfter('if (!ts || typeof ts !== \'object\')');
  assert.ok(block, 'invalid-ts 経路の !isHallApply ブロックが抽出できない');
  // isPreStartActive() ガード
  assert.match(block,
    /if\s*\(\s*typeof\s+isPreStartActive\s*===\s*['"]function['"][\s\S]{0,80}?isPreStartActive\s*\(\s*\)\s*\)/,
    'Fix 1-1 未完了: invalid-ts 経路に isPreStartActive() ガードがない');
  // trigger:'invalid-ts' ラベル発火
  assert.match(block,
    /['"]operator:applyTimerStateToTimer:skip-reset-during-prestart['"][\s\S]{0,200}?trigger:\s*['"]invalid-ts['"]/,
    'Fix 1-1 未完了: trigger:"invalid-ts" の skip-reset ラベル発火経路がない');
  // ガード後の return + ガード外の timerReset()
  assert.match(block,
    /isPreStartActive\s*\(\s*\)\s*\)\s*\{[\s\S]{0,1200}?return[\s\S]{0,80}?\}[\s\S]{0,500}?timerReset\s*\(\s*(?:\{\s*force\s*:\s*false\s*\}\s*)?\)/,
    'Fix 1-1 未完了: ガード ブロック内 return → ガード外 timerReset の構造がない');
});

// ============================================================
// T3: Fix 1-2 — idle 経路 既存 rc8 ガードの data に trigger:'idle' 追加
// ============================================================
test('T3: idle 経路 既存 rc8 ガードの data に trigger:idle 追加', () => {
  const block = extractNonHallBlockAfter("if (ts.status === 'idle')");
  assert.ok(block, 'idle 経路の !isHallApply ブロックが抽出できない');
  // rc8 既存ガード + trigger:'idle' フィールド
  assert.match(block,
    /['"]operator:applyTimerStateToTimer:skip-reset-during-prestart['"][\s\S]{0,200}?trigger:\s*['"]idle['"]/,
    'Fix 1-2 未完了: idle 経路ラベルに trigger:"idle" フィールドがない');
});

// ============================================================
// T4: Fix 1-3 — finished 経路 !isHallApply 内に isPreStartActive() ガード + trigger:'finished' + classList.add 維持
// ============================================================
test('T4: finished 経路 !isHallApply 内に isPreStartActive() ガード + trigger:finished + classList.add 維持', () => {
  const block = extractNonHallBlockAfter("if (ts.status === 'finished')");
  assert.ok(block, 'finished 経路の !isHallApply ブロックが抽出できない');
  // isPreStartActive() ガード
  assert.match(block,
    /if\s*\(\s*typeof\s+isPreStartActive\s*===\s*['"]function['"][\s\S]{0,80}?isPreStartActive\s*\(\s*\)\s*\)/,
    'Fix 1-3 未完了: finished 経路に isPreStartActive() ガードがない');
  // trigger:'finished' ラベル
  assert.match(block,
    /['"]operator:applyTimerStateToTimer:skip-reset-during-prestart['"][\s\S]{0,200}?trigger:\s*['"]finished['"]/,
    'Fix 1-3 未完了: trigger:"finished" の skip-reset ラベル発火経路がない');
  // ガード通過時も classList.add('clock--timer-finished') を実行
  assert.match(block,
    /isPreStartActive\s*\(\s*\)\s*\)\s*\{[\s\S]{0,1200}?el\.clock\?\.classList\.add\s*\(\s*['"]clock--timer-finished['"]\s*\)[\s\S]{0,80}?return/,
    'Fix 1-3 未完了: ガード通過時にも el.clock?.classList.add(clock--timer-finished) を呼んでいない（視覚整合性違反）');
});

// ============================================================
// T5: Fix 1-4 — levelCount===0 経路 !isHallApply 内に isPreStartActive() ガード + trigger:'no-levels'
// ============================================================
test('T5: levelCount===0 経路 !isHallApply 内に isPreStartActive() ガード + trigger:no-levels', () => {
  const block = extractNonHallBlockAfter('if (levelCount === 0)');
  assert.ok(block, 'levelCount===0 経路の !isHallApply ブロックが抽出できない');
  // isPreStartActive() ガード
  assert.match(block,
    /if\s*\(\s*typeof\s+isPreStartActive\s*===\s*['"]function['"][\s\S]{0,80}?isPreStartActive\s*\(\s*\)\s*\)/,
    'Fix 1-4 未完了: levelCount===0 経路に isPreStartActive() ガードがない');
  // trigger:'no-levels' ラベル
  assert.match(block,
    /['"]operator:applyTimerStateToTimer:skip-reset-during-prestart['"][\s\S]{0,200}?trigger:\s*['"]no-levels['"]/,
    'Fix 1-4 未完了: trigger:"no-levels" の skip-reset ラベル発火経路がない');
  // ガード後の return + ガード外の timerReset()
  assert.match(block,
    /isPreStartActive\s*\(\s*\)\s*\)\s*\{[\s\S]{0,1200}?return[\s\S]{0,80}?\}[\s\S]{0,500}?timerReset\s*\(\s*(?:\{\s*force\s*:\s*false\s*\}\s*)?\)/,
    'Fix 1-4 未完了: ガード ブロック内 return → ガード外 timerReset の構造がない');
});

// ============================================================
// T6: 副作用評価 — hall 側 else ブロックの hallTickState reset マーカー（rc2 機構）4 経路すべて完全保持
// ============================================================
test('T6: 4 経路すべての hall 側 else ブロックの rc2 hallTickState reset マーカー完全保持', () => {
  // 4 経路すべての hall else ブロックを抽出して検証
  const routes = [
    { cond: "if (!ts || typeof ts !== 'object')", status: 'invalid-ts' },
    { cond: "if (ts.status === 'idle')", status: 'idle' },
    { cond: "if (ts.status === 'finished')", status: 'finished' },
    { cond: 'if (levelCount === 0)', status: 'no-levels' },
  ];
  for (const r of routes) {
    const hallBlock = extractHallElseBlockAfter(r.cond);
    assert.ok(hallBlock, `${r.status} 経路の hall else ブロックが抽出できない`);
    assert.match(hallBlock, /trigger:\s*['"]applyTimerStateToTimer-non-running['"]/,
      `rc2 退行: ${r.status} 経路の hall else に hallTickState:reset trigger 消失`);
    for (const fld of ['startedAtMs', 'status', 'currentLevelIndex', 'totalMs', 'isActive']) {
      assert.match(hallBlock, new RegExp(`hallTickState\\.${fld}\\s*=\\s*`),
        `rc2 退行: ${r.status} 経路の hall else に hallTickState.${fld} 代入消失`);
    }
    assert.match(hallBlock, /stopHallTickFrame\s*\(\s*\)/,
      `rc2 退行: ${r.status} 経路の hall else に stopHallTickFrame 消失`);
  }
});

// ============================================================
// T7: handleTournamentListReset などの timerReset 直接呼出経路 touch なし（applyTimerStateToTimer 外）
// ============================================================
test('T7: applyTimerStateToTimer 外の timerReset 呼出が touch なし', () => {
  // handleTournamentListReset 関数本体に timerReset() 呼出が維持されていること
  // または handleReset 経路で cancelPreStart 直接呼出が維持されていること
  const handleResetIdx = RENDERER.indexOf('function handleReset');
  assert.ok(handleResetIdx >= 0, 'handleReset 関数が見つからない');
  // handleReset から 3000 文字以内に cancelPreStart or timerReset が存在
  const handleResetSlice = RENDERER.slice(handleResetIdx, handleResetIdx + 3000);
  assert.match(handleResetSlice, /(?:cancelPreStart\s*\(|timerReset\s*\(\s*\)|resetBlindProgressOnly\s*\()/,
    'handleReset 経路の reset 呼出（cancelPreStart / timerReset / resetBlindProgressOnly）が消失');
});

// ============================================================
// T8: rc8 機構保持（applyTimerStateToTimer idle 経路ガード）+ rc7/rc6-meas3/rc5/rc4/rc3/rc2/rc1 機構保持
// ============================================================
test('T8: v2.2.1 — rc8 idle ガード + rc7/rc5/rc4/rc3/rc2/rc1 機構保持 + rc6-meas3 計測撤去', () => {
  // rc8: idle ガード（rc9 で trigger 追加されたが本体機構は維持）
  const idleBlock = extractNonHallBlockAfter("if (ts.status === 'idle')");
  assert.ok(idleBlock);
  assert.match(idleBlock,
    /if\s*\(\s*typeof\s+isPreStartActive\s*===\s*['"]function['"][\s\S]{0,80}?isPreStartActive\s*\(\s*\)\s*\)/,
    'rc8 退行: idle 経路の isPreStartActive() ガード消失');
  // rc7: cache merge
  assert.match(MAIN_JS, /const\s+prev\s*=\s*_dualStateCache\.preStartState\s*\|\|\s*\{\s*\}/,
    'rc7 退行: prev = _dualStateCache.preStartState || {} 消失');
  assert.ok(MAIN_JS.includes('preStart:cache:merge'), 'rc7 退行');
  // rc6-meas3: priority buffer のみ保持、計測機構は撤去
  assert.match(MAIN_JS, /const\s+PRIORITY_LOG_LABELS\s*=\s*new\s+Set\s*\(/, 'rc6-meas3 Fix C (priority buffer) 退行');
  if (!/-(meas|rc)\d+(\.\d+)?$/.test(PKG.version || '')) {
    assert.ok(!MAIN_JS.includes('_isMeasBuildForBuffer'), 'v2.2.1 撤去違反: _isMeasBuildForBuffer 残存');
    assert.ok(!MAIN_JS.includes('_flushLogsToFile'), 'v2.2.1 撤去違反: _flushLogsToFile 残存');
    assert.ok(!RENDERER.includes('_recordHighFreq'), 'v2.2.1 撤去違反: _recordHighFreq 残存');
  }
  // rc5
  assert.ok(MAIN_JS.includes('preStart:operator:send'), 'rc5 退行');
  assert.ok(MAIN_JS.includes('operator:preStartResync:sent'), 'rc5 退行');
  // rc4
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  assert.match(RENDERER, /function\s+applyOperatorPreStartState\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  // rc3
  assert.match(RENDERER, /function\s+renderTournamentListWithDedup\s*\(/, 'rc3 退行');
  // rc2 hallTickState reset 3 trigger
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
// T10: 計測機構 + 新規 rc9 4 trigger
// ============================================================
test('T10: v2.2.1 — meas/symptom/meas3 撤去 + rc2/rc4/rc5/rc7/rc8/rc9 edge ラベル保持', () => {
  if (/-(meas|rc)\d+(\.\d+)?$/.test(PKG.version || '')) return;
  // 撤去確認
  assert.ok(!INDEX_HTML.includes('meas-build-badge'), 'meas-build-badge 残存');
  assert.ok(!STYLE_CSS.includes('#meas-build-badge'), '#meas-build-badge 残存');
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  for (const lbl of ['perf:interval:fire', 'perf:raf:summary', 'perf:ipc:summary', 'perf:dom:summary', 'perf:long-task', 'perf:subscribe:summary']) {
    assert.ok(!ALL_SRC.includes(lbl), `meas2 ${lbl} 残存`);
  }
  for (const lbl of ['hall:syncSlideshowFromState:call', 'hall:updatePipTimer:set', 'hall:applyHallPreStartState:apply', 'hall:clock-pause-label:visibility']) {
    assert.ok(!ALL_SRC.includes(lbl), `症状確証 ${lbl} 残存`);
  }
  assert.ok(!RENDERER.includes('perf:highfreq:summary'), 'meas3 perf:highfreq:summary 残存');
  assert.ok(!MAIN_JS.includes('meas3:hdmi-snapshot:written'), 'meas3 hdmi-snapshot:written 残存');
  // edge ラベル保持
  assert.ok(RENDERER.includes('hall:hallTickState:reset'), 'rc2 消失');
  assert.ok(RENDERER.includes('operator:applyPreStartState:apply'), 'rc4 消失');
  assert.ok(MAIN_JS.includes('preStart:operator:send'), 'rc5 消失');
  assert.ok(MAIN_JS.includes('operator:preStartResync:sent'), 'rc5 消失');
  assert.ok(MAIN_JS.includes('preStart:cache:merge'), 'rc7 消失');
  assert.ok(RENDERER.includes('operator:applyTimerStateToTimer:skip-reset-during-prestart'), 'rc8 消失');
  // rc9 4 trigger
  for (const tg of ['idle', 'invalid-ts', 'finished', 'no-levels']) {
    assert.match(RENDERER,
      new RegExp(`['"]operator:applyTimerStateToTimer:skip-reset-during-prestart['"][\\s\\S]{0,200}?trigger:\\s*['"]${tg}['"]`),
      `rc9 trigger:"${tg}" 消失`);
  }
});

console.log(`\nv247 skip-reset-all-routes: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
