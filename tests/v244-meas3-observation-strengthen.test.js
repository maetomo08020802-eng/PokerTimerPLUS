/**
 * v2.1.20-rc10 静的解析テスト — 観測機構強化（HDMI 自動採取 + 高頻度集約 + buffer 拡張 + priority buffer）
 *
 *   Fix A: main.js buffer 容量定数の計測ビルド時拡張
 *   Fix B: main.js _flushLogsToFile(suffix) 新規追加
 *   Fix C: main.js priority buffer 機構（_isPriorityLabel / _appendPriorityLog / _flushPriorityLog 等）
 *   Fix D: main.js rollingLog 内に priority 分岐
 *   Fix E: main.js display-removed / display-added ハンドラに _flushLogsToFile 呼出追加
 *   Fix F: renderer.js _highFreqCounter + _recordHighFreq + 1 秒 summary
 *   Fix G: renderer.js 5 箇所の高頻度ラベル発火元差し替え
 *   Fix H: state.js perf:state:notify 集約化
 *
 *   rc1〜rc5 機構 + 計測機構 + 致命バグ保護 5 件 完全保持
 *
 * 実行: node tests/v244-meas3-observation-strengthen.test.js
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

// ============================================================
// T1: package.json.version === '2.1.20-rc10'
// ============================================================
test('T1: package.json.version === 2.1.20-rc10', () => {
  assert.equal(PKG.version, '2.1.20-rc10', `期待 2.1.20-rc10, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix A — main.js buffer 容量定数の計測ビルド時条件分岐
// ============================================================
test('T2: main.js に _isMeasBuildForBuffer + ROLLING_LOG_RETENTION_MS / ROLLING_LOG_BUFFER_MAX 条件分岐', () => {
  assert.match(MAIN_JS, /const\s+_isMeasBuildForBuffer\s*=/,
    'Fix A 未完了: _isMeasBuildForBuffer 定数定義なし');
  // ROLLING_LOG_RETENTION_MS が条件分岐に置換
  assert.match(MAIN_JS,
    /const\s+ROLLING_LOG_RETENTION_MS\s*=\s*_isMeasBuildForBuffer\s*\?\s*30\s*\*\s*60\s*\*\s*1000\s*:\s*5\s*\*\s*60\s*\*\s*1000/,
    'Fix A 未完了: ROLLING_LOG_RETENTION_MS の条件分岐なし');
  // ROLLING_LOG_BUFFER_MAX が条件分岐に置換
  assert.match(MAIN_JS,
    /const\s+ROLLING_LOG_BUFFER_MAX\s*=\s*_isMeasBuildForBuffer\s*\?\s*50000\s*:\s*5000/,
    'Fix A 未完了: ROLLING_LOG_BUFFER_MAX の条件分岐なし');
});

// ============================================================
// T3: Fix B — main.js _flushLogsToFile(suffix) 関数 + meas3:hdmi-snapshot:written ラベル
// ============================================================
test('T3: main.js _flushLogsToFile(suffix) 関数定義 + fs.promises.writeFile + meas3:hdmi-snapshot:written', () => {
  assert.match(MAIN_JS, /function\s+_flushLogsToFile\s*\(\s*suffix\s*\)\s*\{/,
    'Fix B 未完了: _flushLogsToFile(suffix) 関数定義なし');
  // 関数本体に fs.promises.writeFile + hdmi-snapshot ファイル名
  const m = MAIN_JS.match(/function\s+_flushLogsToFile\s*\(\s*suffix\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, '_flushLogsToFile 関数本体抽出失敗');
  const body = m[1];
  assert.match(body, /fs\.promises\.writeFile\s*\(/,
    'Fix B 未完了: _flushLogsToFile 内に fs.promises.writeFile 呼出なし');
  assert.match(body, /hdmi-snapshot/,
    'Fix B 未完了: _flushLogsToFile 内に hdmi-snapshot ファイル名生成なし');
  assert.match(body, /meas3:hdmi-snapshot:written/,
    'Fix B 未完了: meas3:hdmi-snapshot:written ラベル発火なし');
});

// ============================================================
// T4: Fix C — main.js priority buffer 機構
// ============================================================
test('T4: main.js PRIORITY_LOG_BUFFER_MAX + PRIORITY_LOG_LABELS Set + _isPriorityLabel / _appendPriorityLog / _flushPriorityLog 関数', () => {
  assert.match(MAIN_JS, /const\s+PRIORITY_LOG_BUFFER_MAX\s*=\s*10000/,
    'Fix C 未完了: PRIORITY_LOG_BUFFER_MAX = 10000 定義なし');
  assert.match(MAIN_JS, /const\s+PRIORITY_LOG_LABELS\s*=\s*new\s+Set\s*\(/,
    'Fix C 未完了: PRIORITY_LOG_LABELS Set 定義なし');
  // 主要ラベルが Set に含まれること
  for (const lbl of ['display-removed', 'display-added', 'preStart:operator:send', 'operator:preStartResync:sent', 'operator:applyPreStartState:apply', 'meas3:hdmi-snapshot:written']) {
    assert.ok(MAIN_JS.includes(`'${lbl}'`),
      `Fix C 未完了: PRIORITY_LOG_LABELS に ${lbl} が含まれていない`);
  }
  // 関数定義 3 種
  assert.match(MAIN_JS, /function\s+_isPriorityLabel\s*\(\s*label\s*\)\s*\{/,
    'Fix C 未完了: _isPriorityLabel 関数定義なし');
  assert.match(MAIN_JS, /function\s+_appendPriorityLog\s*\(\s*entry\s*\)\s*\{/,
    'Fix C 未完了: _appendPriorityLog 関数定義なし');
  assert.match(MAIN_JS, /async\s+function\s+_flushPriorityLog\s*\(\s*\)\s*\{/,
    'Fix C 未完了: _flushPriorityLog async 関数定義なし');
});

// ============================================================
// T5: Fix D — main.js rollingLog 関数内に _isPriorityLabel + _appendPriorityLog 呼出
// ============================================================
test('T5: rollingLog 関数内に _isPriorityLabel(entry.label) 分岐 + _appendPriorityLog(entry) 呼出', () => {
  const m = MAIN_JS.match(/function\s+rollingLog\s*\(\s*label\s*,\s*data\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'rollingLog 関数本体抽出失敗');
  const body = m[1];
  assert.match(body, /_isPriorityLabel\s*\(\s*entry\.label\s*\)/,
    'Fix D 未完了: rollingLog 内に _isPriorityLabel(entry.label) 呼出なし');
  assert.match(body, /_appendPriorityLog\s*\(\s*entry\s*\)/,
    'Fix D 未完了: rollingLog 内に _appendPriorityLog(entry) 呼出なし');
});

// ============================================================
// T6: Fix E — main.js display-removed / display-added ハンドラに _flushLogsToFile 呼出
// ============================================================
test('T6: screen.on(display-removed/added) ハンドラ内に _flushLogsToFile 呼出存在', () => {
  // display-removed ハンドラ内
  assert.match(MAIN_JS,
    /screen\.on\s*\(\s*['"]display-removed['"][\s\S]{0,800}?_flushLogsToFile\s*\(\s*['"]display-removed['"]/,
    'Fix E 未完了: display-removed ハンドラ内に _flushLogsToFile(display-removed) 呼出なし');
  // display-added ハンドラ内
  assert.match(MAIN_JS,
    /screen\.on\s*\(\s*['"]display-added['"][\s\S]{0,800}?_flushLogsToFile\s*\(\s*['"]display-added['"]/,
    'Fix E 未完了: display-added ハンドラ内に _flushLogsToFile(display-added) 呼出なし');
});

// ============================================================
// T7: Fix F — renderer.js _highFreqCounter + _recordHighFreq + perf:highfreq:summary
// ============================================================
test('T7: renderer.js _highFreqCounter 定数 + _recordHighFreq 関数 + perf:highfreq:summary ラベル + 1 秒 setInterval 内 summary', () => {
  assert.match(RENDERER, /const\s+_highFreqCounter\s*=\s*\{\s*\}/,
    'Fix F 未完了: _highFreqCounter 定数定義なし');
  assert.match(RENDERER, /function\s+_recordHighFreq\s*\(\s*label\s*,\s*ms\s*\)\s*\{/,
    'Fix F 未完了: _recordHighFreq 関数定義なし');
  // perf:highfreq:summary ラベル発火 + 1 秒 setInterval 内
  assert.match(RENDERER, /perf:highfreq:summary/,
    'Fix F 未完了: perf:highfreq:summary ラベル消失');
  // 1 秒 setInterval 内に _highFreqCounter summary 出力
  assert.match(RENDERER,
    /setInterval\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?_rafCounter[\s\S]{0,500}?_highFreqCounter[\s\S]{0,300}?perf:highfreq:summary/,
    'Fix F 未完了: 1 秒 setInterval 内に _highFreqCounter summary 出力なし');
});

// ============================================================
// T8: Fix G/H — 高頻度ラベルの直接 log.write 呼出が _recordHighFreq に差し替え済
// ============================================================
test('T8: 高頻度ラベル（perf:render:duration / hall:updatePipTimer:set / perf:state:notify）の直接 log.write 残存 0 件', () => {
  // renderer.js: 'perf:render:duration' を含む log.write 呼出が 0 件
  const renderDurationDirect = RENDERER.match(/window\.api\?\.log\?\.write\?\.\s*\(\s*['"]perf:render:duration['"]/g) || [];
  assert.equal(renderDurationDirect.length, 0,
    `Fix G 未完了: renderer.js に perf:render:duration の直接 log.write が ${renderDurationDirect.length} 件残存`);
  // renderer.js: 'hall:updatePipTimer:set' を含む log.write 呼出が 0 件
  const pipDirect = RENDERER.match(/window\.api\?\.log\?\.write\?\.\s*\(\s*['"]hall:updatePipTimer:set['"]/g) || [];
  assert.equal(pipDirect.length, 0,
    `Fix G 未完了: renderer.js に hall:updatePipTimer:set の直接 log.write が ${pipDirect.length} 件残存`);
  // state.js: 'perf:state:notify' を含む直接 log.write 呼出が 0 件（_highFreqCounter 経由に置換）
  const notifyDirect = STATE_JS.match(/window\.api\.log\.write\s*\(\s*['"]perf:state:notify['"]/g) || [];
  assert.equal(notifyDirect.length, 0,
    `Fix H 未完了: state.js に perf:state:notify の直接 log.write が ${notifyDirect.length} 件残存`);
  // _recordHighFreq 呼出 + perf:render:duration 文字列が 4 箇所以上（4 か所 + ラベル定義）
  const recordHighFreqCalls = (RENDERER.match(/_recordHighFreq\s*\(/g) || []).length;
  assert.ok(recordHighFreqCalls >= 4,
    `Fix G 未完了: _recordHighFreq 呼出が ${recordHighFreqCalls} 件（4 件以上必要、render×4 + pip×1 想定）`);
  // state.js 内 _highFreqCounter 経由置換
  assert.match(STATE_JS, /window\._highFreqCounter[\s\S]{0,300}?perf:state:notify/,
    'Fix H 未完了: state.js 内 window._highFreqCounter 経由の perf:state:notify 集計なし');
});

// ============================================================
// T9: rc1〜rc5 機構保持 + v2.1.19 機構 + 致命バグ保護 5 件
// ============================================================
test('T9: rc1〜rc5 機構 + v2.1.19 + 致命バグ保護 5 件 完全保持', () => {
  // rc1 Fix 1: renderHallTickFrame setState 撤廃
  const stripped = RENDERER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const fnStart = stripped.indexOf('function renderHallTickFrame()');
  assert.ok(fnStart >= 0);
  const fnSnippet = stripped.slice(fnStart, fnStart + 2000);
  assert.doesNotMatch(fnSnippet, /setState\s*\(\s*\{[^}]*remainingMs/,
    'rc1 Fix 1 退行: renderHallTickFrame に setState({...remainingMs...}) が残存');
  // rc1 Fix 2-A: DocumentFragment
  assert.match(RENDERER, /document\.createDocumentFragment\s*\(\s*\)/, 'rc1 Fix 2-A 退行');
  // rc1 Fix 2-B: memoized
  assert.match(RENDERER, /function\s+computeLiveTimerStateMemoized\s*\(/, 'rc1 Fix 2-B 退行');
  // rc1 Fix 4: CSS 統一
  assert.match(STYLE_CSS, /\.clock\[data-prestart-paused="true"\]\s+\.clock__pause-label\s*\{[^}]*opacity\s*:\s*1/,
    'rc1 Fix 4 退行');
  // rc2: hallTickState reset 3 trigger
  for (const tg of ['applyTimerStateToTimer-non-running', 'applyHallPreStartState-inactive', 'hall-window-init']) {
    assert.ok(RENDERER.includes(`'${tg}'`), `rc2 退行: ${tg} 消失`);
  }
  // rc3: renderTournamentListWithDedup
  assert.match(RENDERER, /function\s+renderTournamentListWithDedup\s*\(/, 'rc3 Fix 2 退行');
  // rc4: timer.js restorePreStart
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  // rc4: handleStartPauseToggle 内 PRE_START 分岐
  const fnH = RENDERER.match(/function\s+handleStartPauseToggle\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnH);
  assert.match(fnH[1],
    /if\s*\(\s*status\s*===\s*States\.PRE_START[\s\S]{0,80}?isPreStartActive\s*\(\s*\)\s*\)/,
    'rc4 退行: handleStartPauseToggle PRE_START 分岐消失');
  // rc4: applyOperatorPreStartState 関数
  assert.match(RENDERER, /function\s+applyOperatorPreStartState\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  // rc5: preStart:operator:send + operator:preStartResync:sent ラベル + subscribeStateSync 経路
  assert.ok(MAIN_JS.includes('preStart:operator:send'), 'rc5 退行: preStart:operator:send 消失');
  assert.ok(MAIN_JS.includes('operator:preStartResync:sent'), 'rc5 退行: operator:preStartResync:sent 消失');
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
// T10: 計測機構保持 + 新規 meas3 ラベル
// ============================================================
test('T10: meas1 + meas2 + 症状確証 4 + rc2/rc4/rc5 ラベル + 新規 meas3 ラベル（perf:highfreq:summary + meas3:hdmi-snapshot:written）保持', () => {
  // meas1 バッジ
  assert.match(INDEX_HTML, /<div\s+id="meas-build-badge">\s*計測ビルド\s*<\/div>/, 'meas-build-badge HTML 消失');
  assert.ok(STYLE_CSS.includes('#meas-build-badge'), '#meas-build-badge CSS 消失');
  // meas2 6 カテゴリ
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  for (const lbl of ['perf:interval:fire', 'perf:raf:summary', 'perf:ipc:summary', 'perf:dom:summary', 'perf:long-task', 'perf:subscribe:summary']) {
    assert.ok(ALL_SRC.includes(lbl), `meas2 ラベル ${lbl} 消失`);
  }
  // 症状確証 4（hall:updatePipTimer:set は Fix G で集約化されたが、ラベル名は _recordHighFreq 引数で文字列として残存）
  for (const lbl of ['hall:syncSlideshowFromState:call', 'hall:updatePipTimer:set', 'hall:applyHallPreStartState:apply', 'hall:clock-pause-label:visibility']) {
    assert.ok(ALL_SRC.includes(lbl), `症状確証ラベル ${lbl} 消失`);
  }
  // rc2 / rc4 ラベル
  assert.ok(RENDERER.includes('hall:hallTickState:reset'), 'rc2 退行');
  assert.ok(RENDERER.includes('operator:applyPreStartState:apply'), 'rc4 退行');
  // rc5 新規 2 ラベル
  assert.ok(MAIN_JS.includes('preStart:operator:send'), 'rc5 退行');
  assert.ok(MAIN_JS.includes('operator:preStartResync:sent'), 'rc5 退行');
  // meas3 新規 2 ラベル
  assert.ok(RENDERER.includes('perf:highfreq:summary'),
    'meas3 新規ラベル perf:highfreq:summary が renderer.js に見つからない');
  assert.ok(MAIN_JS.includes('meas3:hdmi-snapshot:written'),
    'meas3 新規ラベル meas3:hdmi-snapshot:written が main.js に見つからない');
});

console.log(`\nv244 meas3-observation-strengthen: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
