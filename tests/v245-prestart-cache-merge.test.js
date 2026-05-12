/**
 * v2.1.20-rc9 静的解析テスト — preStartState cache merge + priority log lazy init
 *
 *   Fix 1: main.js dual:publish-pre-start-state ハンドラに cache merge ロジック追加
 *          （tick / pause / resume / adjust 経由 publish で totalMs 欠落を防止）
 *   Fix 2: main.js _appendPriorityLog 内に lazy init 呼出追加
 *          （priority-events.log が生成されない問題を修正）
 *
 *   rc1〜rc6-meas3 機構 + 計測機構 + 致命バグ保護 5 件 完全保持
 *
 * 実行: node tests/v245-prestart-cache-merge.test.js
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

// dual:publish-pre-start-state ハンドラの匿名コールバック本体を balanced brace で抽出
function extractPublishPreStartHandler() {
  const startRe = /ipcMain\.on\s*\(\s*['"]dual:publish-pre-start-state['"][\s\S]*?\(\s*_event\s*,\s*payload\s*\)\s*=>\s*\{/;
  const m = MAIN_JS.match(startRe);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < MAIN_JS.length && depth > 0) {
    const c = MAIN_JS[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return MAIN_JS.slice(m.index, i);
}

// ============================================================
// T1: package.json.version === '2.1.20-rc9'
// ============================================================
test('T1: package.json.version === 2.1.20-rc9', () => {
  assert.equal(PKG.version, '2.1.20-rc9', `期待 2.1.20-rc9, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix 1 — `const prev = _dualStateCache.preStartState || {};` 取得行存在
// ============================================================
test('T2: dual:publish-pre-start-state ハンドラ内に prev = _dualStateCache.preStartState || {} 取得行存在', () => {
  const body = extractPublishPreStartHandler();
  assert.ok(body, 'dual:publish-pre-start-state ハンドラが抽出できない');
  assert.match(body,
    /const\s+prev\s*=\s*_dualStateCache\.preStartState\s*\|\|\s*\{\s*\}/,
    'Fix 1 未完了: prev = _dualStateCache.preStartState || {} 取得行なし');
});

// ============================================================
// T3: Fix 1 — 各フィールド（totalMs / remainingMs / startAtMs / isPaused）に cache fallback 分岐
// ============================================================
test('T3: 各フィールドに cache fallback 分岐（else if Number.isFinite(prev.X) / else if typeof prev.isPaused）', () => {
  const body = extractPublishPreStartHandler();
  assert.ok(body, 'dual:publish-pre-start-state ハンドラが抽出できない');
  // totalMs
  assert.match(body,
    /else\s+if\s*\(\s*Number\.isFinite\s*\(\s*prev\.totalMs\s*\)/,
    'Fix 1 未完了: totalMs に cache fallback 分岐なし');
  // remainingMs
  assert.match(body,
    /else\s+if\s*\(\s*Number\.isFinite\s*\(\s*prev\.remainingMs\s*\)/,
    'Fix 1 未完了: remainingMs に cache fallback 分岐なし');
  // startAtMs
  assert.match(body,
    /else\s+if\s*\(\s*Number\.isFinite\s*\(\s*prev\.startAtMs\s*\)/,
    'Fix 1 未完了: startAtMs に cache fallback 分岐なし');
  // isPaused
  assert.match(body,
    /else\s+if\s*\(\s*typeof\s+prev\.isPaused\s*===\s*['"]boolean['"]/,
    'Fix 1 未完了: isPaused に cache fallback 分岐なし');
});

// ============================================================
// T4: Fix 1 — 新規確証ラベル `preStart:cache:merge` + `mergedFromCache` フラグ経由
// ============================================================
test('T4: 新規確証ラベル preStart:cache:merge + mergedFromCache フラグ経由発火', () => {
  const body = extractPublishPreStartHandler();
  assert.ok(body, 'dual:publish-pre-start-state ハンドラが抽出できない');
  assert.match(body, /let\s+mergedFromCache\s*=\s*false/,
    'Fix 1 未完了: mergedFromCache フラグ宣言なし');
  assert.match(body, /mergedFromCache\s*=\s*true/,
    'Fix 1 未完了: mergedFromCache = true 代入経路なし');
  // ラベル発火が if (mergedFromCache) ブロック内
  assert.match(body,
    /if\s*\(\s*mergedFromCache\s*\)\s*\{[\s\S]{0,300}?rollingLog\s*\(\s*['"]preStart:cache:merge['"]/,
    'Fix 1 未完了: if (mergedFromCache) ブロック内に preStart:cache:merge ラベル発火経路なし');
});

// ============================================================
// T5: Fix 1 — isActive: false 経路では merge 分岐に入らない（if (isActive) 内に閉じ込め）
// ============================================================
test('T5: cache merge 分岐は if (isActive) ブロック内に閉じ込められている', () => {
  const body = extractPublishPreStartHandler();
  assert.ok(body, 'dual:publish-pre-start-state ハンドラが抽出できない');
  // if (isActive) { ... } ブロックを balanced brace で抽出
  const ifIdx = body.search(/if\s*\(\s*isActive\s*\)\s*\{/);
  assert.ok(ifIdx >= 0, 'if (isActive) ブロックが見つからない');
  const braceOpen = body.indexOf('{', ifIdx);
  let depth = 1;
  let end = braceOpen + 1;
  while (end < body.length && depth > 0) {
    const ch = body[end];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    end++;
  }
  const isActiveBlock = body.slice(braceOpen + 1, end - 1);
  // merge ロジック（prev 参照 + mergedFromCache）がブロック内に存在
  assert.match(isActiveBlock, /prev\.totalMs/,
    'Fix 1 未完了: if (isActive) ブロック内に prev.totalMs 参照なし（merge ロジックがブロック外？）');
  assert.match(isActiveBlock, /mergedFromCache/,
    'Fix 1 未完了: if (isActive) ブロック内に mergedFromCache 参照なし');
  // isActive: false 経路（if (isActive) ブロック外）に prev 参照がない
  const beforeIf = body.slice(0, ifIdx);
  const afterIfBlock = body.slice(end);
  assert.doesNotMatch(beforeIf + afterIfBlock, /prev\.totalMs/,
    'Fix 1 未完了: if (isActive) ブロック外に prev.totalMs 参照が漏れている');
});

// ============================================================
// T6: Fix 2 — _appendPriorityLog 関数内冒頭に _initPriorityLogFile() 呼出
// ============================================================
test('T6: _appendPriorityLog 関数内冒頭に _initPriorityLogFile() 呼出存在', () => {
  const m = MAIN_JS.match(/function\s+_appendPriorityLog\s*\(\s*entry\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, '_appendPriorityLog 関数本体が見つからない');
  const body = m[1];
  // try { 内冒頭で _initPriorityLogFile() 呼出 + _priorityLogBuffer.push より前
  assert.match(body,
    /try\s*\{[\s\S]{0,200}?_initPriorityLogFile\s*\(\s*\)[\s\S]{0,200}?_priorityLogBuffer\.push/,
    'Fix 2 未完了: _appendPriorityLog 内 try { 冒頭に _initPriorityLogFile() + push 順序なし');
});

// ============================================================
// T7: rc6-meas3 機構保持（_isMeasBuildForBuffer / _flushLogsToFile / PRIORITY_LOG_LABELS / _recordHighFreq / display ハンドラ _flushLogsToFile）
// ============================================================
test('T7: rc6-meas3 機構（観測強化 4 件）完全保持', () => {
  // Fix A: buffer 容量定数の計測ビルド時拡張
  assert.match(MAIN_JS, /const\s+_isMeasBuildForBuffer\s*=/,
    'rc6-meas3 Fix A 退行: _isMeasBuildForBuffer 消失');
  assert.match(MAIN_JS,
    /const\s+ROLLING_LOG_RETENTION_MS\s*=\s*_isMeasBuildForBuffer\s*\?/,
    'rc6-meas3 Fix A 退行: ROLLING_LOG_RETENTION_MS 条件分岐消失');
  assert.match(MAIN_JS,
    /const\s+ROLLING_LOG_BUFFER_MAX\s*=\s*_isMeasBuildForBuffer\s*\?/,
    'rc6-meas3 Fix A 退行: ROLLING_LOG_BUFFER_MAX 条件分岐消失');
  // Fix B: _flushLogsToFile
  assert.match(MAIN_JS, /function\s+_flushLogsToFile\s*\(\s*suffix\s*\)\s*\{/,
    'rc6-meas3 Fix B 退行: _flushLogsToFile 消失');
  // Fix C: priority buffer 機構
  assert.match(MAIN_JS, /const\s+PRIORITY_LOG_LABELS\s*=\s*new\s+Set\s*\(/,
    'rc6-meas3 Fix C 退行: PRIORITY_LOG_LABELS Set 消失');
  assert.match(MAIN_JS, /async\s+function\s+_flushPriorityLog\s*\(\s*\)\s*\{/,
    'rc6-meas3 Fix C 退行: _flushPriorityLog 消失');
  // Fix D: rollingLog 内 priority 分岐
  const rl = MAIN_JS.match(/function\s+rollingLog\s*\(\s*label\s*,\s*data\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(rl);
  assert.match(rl[1], /_isPriorityLabel\s*\(\s*entry\.label\s*\)/,
    'rc6-meas3 Fix D 退行: rollingLog 内 _isPriorityLabel 分岐消失');
  // Fix E: display ハンドラ内 _flushLogsToFile
  assert.match(MAIN_JS,
    /screen\.on\s*\(\s*['"]display-removed['"][\s\S]{0,800}?_flushLogsToFile\s*\(\s*['"]display-removed['"]/,
    'rc6-meas3 Fix E 退行: display-removed ハンドラ内 _flushLogsToFile 消失');
  assert.match(MAIN_JS,
    /screen\.on\s*\(\s*['"]display-added['"][\s\S]{0,800}?_flushLogsToFile\s*\(\s*['"]display-added['"]/,
    'rc6-meas3 Fix E 退行: display-added ハンドラ内 _flushLogsToFile 消失');
  // Fix F: _highFreqCounter + _recordHighFreq
  assert.match(RENDERER, /const\s+_highFreqCounter\s*=\s*\{\s*\}/,
    'rc6-meas3 Fix F 退行: _highFreqCounter 消失');
  assert.match(RENDERER, /function\s+_recordHighFreq\s*\(\s*label\s*,\s*ms\s*\)\s*\{/,
    'rc6-meas3 Fix F 退行: _recordHighFreq 消失');
  // Fix G: 高頻度ラベル直接 log.write 残存 0 件
  const renderDurationDirect = RENDERER.match(/window\.api\?\.log\?\.write\?\.\s*\(\s*['"]perf:render:duration['"]/g) || [];
  assert.equal(renderDurationDirect.length, 0,
    `rc6-meas3 Fix G 退行: perf:render:duration の直接 log.write ${renderDurationDirect.length} 件残存`);
  // Fix H: state.js _highFreqCounter 経由
  assert.match(STATE_JS, /window\._highFreqCounter[\s\S]{0,300}?perf:state:notify/,
    'rc6-meas3 Fix H 退行: state.js 内 perf:state:notify 集約消失');
});

// ============================================================
// T8: rc1〜rc5 機構保持 + v2.1.19 + 致命バグ保護 5 件
// ============================================================
test('T8: rc1〜rc5 + v2.1.19 + 致命バグ保護 5 件 完全保持', () => {
  // rc1 Fix 1: renderHallTickFrame setState 撤廃
  const stripped = RENDERER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const fnStart = stripped.indexOf('function renderHallTickFrame()');
  assert.ok(fnStart >= 0);
  const fnSnippet = stripped.slice(fnStart, fnStart + 2000);
  assert.doesNotMatch(fnSnippet, /setState\s*\(\s*\{[^}]*remainingMs/, 'rc1 Fix 1 退行');
  // rc1 Fix 2-A: DocumentFragment
  assert.match(RENDERER, /document\.createDocumentFragment\s*\(\s*\)/, 'rc1 Fix 2-A 退行');
  // rc1 Fix 2-B: memoized
  assert.match(RENDERER, /function\s+computeLiveTimerStateMemoized\s*\(/, 'rc1 Fix 2-B 退行');
  // rc1 Fix 4: CSS 統一
  assert.match(STYLE_CSS, /\.clock\[data-prestart-paused="true"\]\s+\.clock__pause-label\s*\{[^}]*opacity\s*:\s*1/, 'rc1 Fix 4 退行');
  // rc2: hallTickState reset 3 trigger
  for (const tg of ['applyTimerStateToTimer-non-running', 'applyHallPreStartState-inactive', 'hall-window-init']) {
    assert.ok(RENDERER.includes(`'${tg}'`), `rc2 退行: ${tg} 消失`);
  }
  // rc3: renderTournamentListWithDedup
  assert.match(RENDERER, /function\s+renderTournamentListWithDedup\s*\(/, 'rc3 Fix 2 退行');
  // rc4: timer.js restorePreStart export
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  // rc4: handleStartPauseToggle PRE_START 分岐
  const fnH = RENDERER.match(/function\s+handleStartPauseToggle\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnH);
  assert.match(fnH[1],
    /if\s*\(\s*status\s*===\s*States\.PRE_START[\s\S]{0,80}?isPreStartActive\s*\(\s*\)\s*\)/,
    'rc4 退行');
  // rc4: applyOperatorPreStartState 関数
  assert.match(RENDERER, /function\s+applyOperatorPreStartState\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  // rc5: preStart:operator:send + operator:preStartResync:sent
  assert.ok(MAIN_JS.includes('preStart:operator:send'), 'rc5 退行');
  assert.ok(MAIN_JS.includes('operator:preStartResync:sent'), 'rc5 退行');
  // v2.1.19 _tournamentsListDedup
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/, 'v2.1.19 退行');
  // 致命バグ保護 5 件
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A 消失');
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/, 'C.2.7-D 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'C.1-A2 消失');
  assert.match(AUDIO_JS, /resume/, 'C.1.7 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'C.1.8 消失');
});

// ============================================================
// T9: 計測機構保持 + 新規 rc7 ラベル `preStart:cache:merge`
// ============================================================
test('T9: meas1+meas2+症状確証 4+rc2/rc4/rc5/meas3 ラベル + 新規 rc7 ラベル preStart:cache:merge 保持', () => {
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
  // rc2 / rc4 / rc5
  assert.ok(RENDERER.includes('hall:hallTickState:reset'), 'rc2 退行');
  assert.ok(RENDERER.includes('operator:applyPreStartState:apply'), 'rc4 退行');
  assert.ok(MAIN_JS.includes('preStart:operator:send'), 'rc5 退行');
  assert.ok(MAIN_JS.includes('operator:preStartResync:sent'), 'rc5 退行');
  // meas3 新規 2 ラベル
  assert.ok(RENDERER.includes('perf:highfreq:summary'), 'meas3 退行');
  assert.ok(MAIN_JS.includes('meas3:hdmi-snapshot:written'), 'meas3 退行');
  // rc7 新規ラベル
  assert.ok(MAIN_JS.includes('preStart:cache:merge'),
    'rc7 新規ラベル preStart:cache:merge が main.js に見つからない');
});

// ============================================================
// T10: 副作用なし — restorePreStart / applyOperatorPreStartState 関数本体 touch なし
// ============================================================
test('T10: timer.js restorePreStart + renderer.js applyOperatorPreStartState 関数本体は touch なし', () => {
  // restorePreStart 関数本体に既存 totalMs ガードが維持されている（rc4 で実装、rc7 でも維持）
  const rp = TIMER_JS.match(/export\s+function\s+restorePreStart\s*\(\s*payload\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(rp, 'restorePreStart 関数本体抽出失敗');
  assert.match(rp[1], /if\s*\(\s*typeof\s+totalMs\s*!==\s*['"]number['"][\s\S]{0,80}?return/,
    'restorePreStart の totalMs ガードが消失（rc4 既存防御の退行）');
  assert.match(rp[1], /isPreStart\s*=\s*true/, 'restorePreStart の isPreStart = true 代入消失');
  // applyOperatorPreStartState 関数本体に既存 isActive 分岐 + timerRestorePreStart 呼出が維持
  const ao = RENDERER.match(/function\s+applyOperatorPreStartState\s*\(\s*payload\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(ao, 'applyOperatorPreStartState 関数本体抽出失敗');
  assert.match(ao[1], /timerRestorePreStart\s*\(/,
    'applyOperatorPreStartState の timerRestorePreStart 呼出消失');
  assert.match(ao[1], /operator:applyPreStartState:apply/,
    'applyOperatorPreStartState の operator:applyPreStartState:apply ラベル消失');
});

console.log(`\nv245 prestart-cache-merge: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
