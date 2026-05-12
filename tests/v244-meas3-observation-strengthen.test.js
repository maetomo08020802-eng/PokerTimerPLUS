/**
 * v2.2.1 静的解析テスト — rc6-meas3 観測強化機構の **撤去** 確認（緩和版、v2.2.1 リリース仕様準拠）
 *
 *   v2.2.1 で撤去対象（旧 rc6-meas3 機構）:
 *     - Fix A: buffer 容量定数の三項演算 → 本番値固定
 *     - Fix B: _flushLogsToFile 関数 + hdmi-snapshot 採取 → 撤去
 *     - Fix E: display ハンドラ内 _flushLogsToFile 呼出 → 撤去
 *     - Fix F: _highFreqCounter + _recordHighFreq + 1 秒 summary → 撤去
 *     - Fix G: 高頻度ラベル発火元差し替えコード → 撤去（呼出箇所も撤去）
 *     - Fix H: state.js perf:state:notify 集約 → 撤去
 *
 *   v2.2.1 で **保持** 対象（priority buffer + edge ラベル）:
 *     - Fix C: priority buffer 機構（_isPriorityLabel / _appendPriorityLog / _flushPriorityLog）保持
 *     - Fix D: rollingLog 内 priority 分岐 保持
 *     - PRIORITY_LOG_LABELS Set（meas3:hdmi-snapshot:written のみ削除して 12 ラベル維持 + rc10.1 3 ラベル追加で 13 ラベル）
 *
 * 実行: node tests/v244-meas3-observation-strengthen.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const TIMER_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const STATE_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'state.js'), 'utf8');
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: package.json.version 形式確認
// ============================================================
test('T1: package.json.version は v2.2.1 以降 or 試験ビルド', () => {
  assert.match(PKG.version, /^2\.(\d+)\.\d+(-(rc|meas)\d+(\.\d+)?)?$/,
    `想定外の version 形式: ${PKG.version}`);
});

// ============================================================
// T2: 旧 Fix A — buffer 容量定数が **本番値固定**（三項演算撤去）
// ============================================================
test('T2: ROLLING_LOG_RETENTION_MS / BUFFER_MAX が本番値固定（三項演算撤去）', () => {
  assert.match(MAIN_JS, /const\s+ROLLING_LOG_RETENTION_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/,
    'ROLLING_LOG_RETENTION_MS が本番値（5 分）固定でない');
  assert.match(MAIN_JS, /const\s+ROLLING_LOG_BUFFER_MAX\s*=\s*5000/,
    'ROLLING_LOG_BUFFER_MAX が本番値（5000）固定でない');
  // _isMeasBuildForBuffer / _appVersionForBuffer 撤去
  assert.ok(!MAIN_JS.includes('_isMeasBuildForBuffer'),
    '_isMeasBuildForBuffer が残存（三項演算撤去未完了）');
  assert.ok(!MAIN_JS.includes('_appVersionForBuffer'),
    '_appVersionForBuffer が残存（dead code）');
});

// ============================================================
// T3: 旧 Fix B / E — _flushLogsToFile 関数 + display ハンドラ呼出 撤去
// ============================================================
test('T3: _flushLogsToFile 関数 + display ハンドラ呼出 + hdmi-snapshot ラベル 撤去', () => {
  assert.ok(!MAIN_JS.includes('_flushLogsToFile'),
    '_flushLogsToFile が残存');
  assert.ok(!MAIN_JS.includes('hdmi-snapshot'),
    'hdmi-snapshot 文字列が残存');
  assert.ok(!MAIN_JS.includes('meas3:hdmi-snapshot:written'),
    'meas3:hdmi-snapshot:written ラベルが残存');
});

// ============================================================
// T4: 旧 Fix C — priority buffer 機構は **保持**（撤去対象外）
// ============================================================
test('T4: priority buffer 機構保持（PRIORITY_LOG_LABELS Set + 3 関数）', () => {
  assert.match(MAIN_JS, /const\s+PRIORITY_LOG_BUFFER_MAX\s*=\s*10000/,
    'PRIORITY_LOG_BUFFER_MAX が消失');
  assert.match(MAIN_JS, /const\s+PRIORITY_LOG_LABELS\s*=\s*new\s+Set\s*\(/,
    'PRIORITY_LOG_LABELS Set が消失');
  // 関数定義 3 種保持
  assert.match(MAIN_JS, /function\s+_isPriorityLabel\s*\(\s*label\s*\)\s*\{/,
    '_isPriorityLabel が消失');
  assert.match(MAIN_JS, /function\s+_appendPriorityLog\s*\(\s*entry\s*\)\s*\{/,
    '_appendPriorityLog が消失');
  assert.match(MAIN_JS, /async\s+function\s+_flushPriorityLog\s*\(\s*\)\s*\{/,
    '_flushPriorityLog が消失');
});

// ============================================================
// T5: 旧 Fix D — rollingLog 内 _isPriorityLabel + _appendPriorityLog 呼出 保持
// ============================================================
test('T5: rollingLog 関数内に _isPriorityLabel(entry.label) + _appendPriorityLog(entry) 呼出 保持', () => {
  const m = MAIN_JS.match(/function\s+rollingLog\s*\(\s*label\s*,\s*data\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'rollingLog 関数本体抽出失敗');
  const body = m[1];
  assert.match(body, /_isPriorityLabel\s*\(\s*entry\.label\s*\)/,
    'rollingLog 内 _isPriorityLabel 呼出消失');
  assert.match(body, /_appendPriorityLog\s*\(\s*entry\s*\)/,
    'rollingLog 内 _appendPriorityLog 呼出消失');
});

// ============================================================
// T6: 旧 Fix F / G — _highFreqCounter + _recordHighFreq 撤去
// ============================================================
test('T6: _highFreqCounter + _recordHighFreq 機構 撤去', () => {
  assert.ok(!RENDERER.includes('_highFreqCounter'),
    'renderer.js に _highFreqCounter が残存');
  assert.ok(!RENDERER.includes('_recordHighFreq'),
    'renderer.js に _recordHighFreq が残存');
  // 1 秒 setInterval 内 perf:highfreq:summary 出力撤去
  assert.ok(!RENDERER.includes('perf:highfreq:summary'),
    'renderer.js に perf:highfreq:summary が残存');
});

// ============================================================
// T7: 旧 Fix H — state.js window._highFreqCounter 共有撤去
// ============================================================
test('T7: state.js から window._highFreqCounter 共有 + perf:state:notify 集約 撤去', () => {
  assert.ok(!STATE_JS.includes('_highFreqCounter'),
    'state.js に _highFreqCounter 参照が残存');
  assert.ok(!STATE_JS.includes('perf:state:notify'),
    'state.js に perf:state:notify ラベルが残存');
});

// ============================================================
// T8: rc1〜rc5 機構 + 致命バグ保護 5 件 完全保持
// ============================================================
test('T8: rc1〜rc5 機構 + v2.1.19 + 致命バグ保護 5 件 完全保持', () => {
  // rc1 Fix 2-A: DocumentFragment
  assert.match(RENDERER, /document\.createDocumentFragment\s*\(\s*\)/, 'rc1 Fix 2-A 退行');
  // rc1 Fix 2-B: memoized
  assert.match(RENDERER, /function\s+computeLiveTimerStateMemoized\s*\(/, 'rc1 Fix 2-B 退行');
  // rc2: hallTickState reset 3 trigger
  for (const tg of ['applyTimerStateToTimer-non-running', 'applyHallPreStartState-inactive', 'hall-window-init']) {
    assert.ok(RENDERER.includes(`'${tg}'`), `rc2 退行: ${tg} 消失`);
  }
  // rc4: timer.js restorePreStart
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  // rc4: applyOperatorPreStartState
  assert.match(RENDERER, /function\s+applyOperatorPreStartState\s*\(\s*payload\s*\)\s*\{/, 'rc4 退行');
  // rc5
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
// T9: rc7 / rc8 / rc9 / rc10 / rc10.1 機構 完全保持
// ============================================================
test('T9: rc7〜rc10.1 機構 完全保持', () => {
  // rc7
  assert.match(MAIN_JS, /preStart:cache:merge/, 'rc7 消失');
  // rc8/rc9
  assert.match(RENDERER, /operator:applyTimerStateToTimer:skip-reset-during-prestart/, 'rc8/rc9 消失');
  // rc10
  assert.match(TIMER_JS, /export\s+function\s+reset\s*\(\s*opts\s*=\s*\{\s*\}\s*\)/, 'rc10 reset(opts) 消失');
  assert.match(RENDERER, /timer:reset:skip-during-prestart/, 'rc10 ガード ラベル消失');
  // rc10.1
  assert.match(MAIN_JS, /hdmi:display-removed:dual-sync-stale/, 'rc10.1 #1 消失');
  assert.match(MAIN_JS, /hdmi:dialog-blocked:switchOperatorToSolo/, 'rc10.1 #2 消失');
  assert.match(RENDERER, /timer:reset:race-window-entry/, 'rc10.1 #10 消失');
});

// ============================================================
// T10: edge 発火ラベル（保持対象）完全保持
// ============================================================
test('T10: edge 発火ラベル（state:transition / meas:capture / meas:session:start / display 系）完全保持', () => {
  // state.js edge ラベル
  assert.ok(STATE_JS.includes('state:transition'), 'state:transition 消失');
  // main.js edge ラベル
  assert.ok(MAIN_JS.includes('meas:session:start'), 'meas:session:start 消失');
  assert.ok(MAIN_JS.includes('meas:capture'), 'meas:capture 消失');
  assert.ok(MAIN_JS.includes('display-removed'), 'display-removed 消失');
  assert.ok(MAIN_JS.includes('display-added'), 'display-added 消失');
  assert.ok(MAIN_JS.includes('switchOperatorToSolo:enter'), 'switchOperatorToSolo:enter 消失');
});

console.log(`\nv244 meas3-removal (v2.2.1): ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
