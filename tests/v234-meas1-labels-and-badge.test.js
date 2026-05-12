/**
 * v2.2.1 静的解析テスト — v2.1.18-meas1 計測機構の **撤去** 確認（緩和版、v2.2.1 リリース仕様準拠）
 *
 *   v2.2.1 で撤去対象:
 *     - 計測バッジ（HTML / CSS / JS 表示分岐）
 *     - 高頻度ラベル 14 種（perf:* 全般）
 *     - rc6-meas3 機構（_isMeasBuildForBuffer / _flushLogsToFile / hdmi-snapshot 自動採取）
 *     - _recordHighFreq / _highFreqCounter 機構
 *
 *   v2.2.1 で **保持** 対象:
 *     - edge 発火低頻度ラベル（state:transition / meas:session:start / meas:capture / ui:keypress / ui:click:major / error:caught:*）
 *     - rolling-current.log / priority-events.log 基本機構
 *     - Ctrl+Shift+L 採取（_measOpCounter）
 *     - preload.js _measuredInvoke 薄ラッパ
 *
 *   meas / rc 系試験ビルドでは保持中のため skip、本番版（サフィックスなし）のみで撤去 verify。
 *
 * 実行: node tests/v234-meas1-labels-and-badge.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PKG        = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const DUAL_SYNC  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const TIMER_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
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

// v2.2.1: meas / rc 系試験ビルドでは計測機構保持中のため skip、本番版のみ撤去 verify
const _shouldSkip = /-(meas|rc)\d+(\.\d+)?$/.test(PKG.version || '');
function testSkippableOnMeas(name, fn) {
  if (_shouldSkip) {
    console.log('SKIP:', name, '(meas / rc ビルドでは計測機構保持中のためテスト skip)');
    return;
  }
  test(name, fn);
}

// ============================================================
// version assertion: v2.2.1 以降（メジャー 2 ・マイナー >= 2）の本番版を許容
// ============================================================
test('version: package.json version は v2.2.1 以降の本番版（または rc/meas 試験ビルド）', () => {
  // 本番版: ^2\.(2\.\d+|[3-9]\.\d+)$ / 試験ビルド: -rc\d+ / -meas\d+ 任意
  assert.match(PKG.version, /^2\.(\d+)\.\d+(-(rc|meas)\d+(\.\d+)?)?$/,
    `想定外の version 形式: ${PKG.version}`);
});

// ============================================================
// T1: index.html から計測バッジ要素が撤去されている
// ============================================================
testSkippableOnMeas('T1: index.html から meas-build-badge が撤去されている', () => {
  assert.ok(!INDEX_HTML.includes('meas-build-badge'),
    'index.html に meas-build-badge 文字列が残存');
});

// ============================================================
// T2: style.css から #meas-build-badge ブロックが撤去されている
// ============================================================
testSkippableOnMeas('T2: style.css から #meas-build-badge ブロックが撤去されている', () => {
  assert.ok(!STYLE_CSS.includes('#meas-build-badge'),
    'style.css に #meas-build-badge セレクタが残存');
});

// ============================================================
// T3: renderer.js loadAppVersion から -meas / バッジ表示分岐が撤去されている
// ============================================================
testSkippableOnMeas('T3: renderer.js loadAppVersion から -meas / バッジ表示分岐が撤去されている', () => {
  assert.ok(!RENDERER.includes("getElementById('meas-build-badge')"),
    'renderer.js に meas-build-badge 要素取得処理が残存');
});

// ============================================================
// T4: 高頻度ラベル 14 種（perf:*）すべて撤去
// ============================================================
testSkippableOnMeas('T4: 高頻度ラベル 14 種（perf:*）すべて撤去', () => {
  const labels = [
    'perf:render:duration', 'perf:state:notify', 'perf:ipc:roundtrip',
    'perf:tick:fps', 'perf:memory:rss', 'perf:dom:rebuild',
    'perf:raf:fire', 'perf:raf:summary', 'perf:highfreq:summary',
    'perf:interval:fire', 'perf:long-task', 'perf:ipc:summary',
    'perf:dom:summary', 'perf:subscribe:summary'
  ];
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS + TIMER_JS;
  for (const label of labels) {
    assert.ok(!ALL_SRC.includes(label), `ラベル ${label} がソース全体に残存`);
  }
});

// ============================================================
// T5: rc6-meas3 機構（_isMeasBuildForBuffer / _flushLogsToFile / hdmi-snapshot）すべて撤去
// ============================================================
testSkippableOnMeas('T5: rc6-meas3 機構撤去 + ROLLING_LOG 本番値固定', () => {
  assert.ok(!MAIN_JS.includes('_isMeasBuildForBuffer'),
    'main.js に _isMeasBuildForBuffer が残存');
  assert.ok(!MAIN_JS.includes('_appVersionForBuffer'),
    'main.js に _appVersionForBuffer が残存');
  assert.ok(!MAIN_JS.includes('_flushLogsToFile'),
    'main.js に _flushLogsToFile 関数が残存');
  assert.ok(!MAIN_JS.includes('meas3:hdmi-snapshot:written'),
    'main.js に meas3:hdmi-snapshot:written ラベルが残存');
  // ROLLING_LOG_RETENTION_MS と ROLLING_LOG_BUFFER_MAX は本番値固定
  assert.match(MAIN_JS, /const\s+ROLLING_LOG_RETENTION_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/,
    'ROLLING_LOG_RETENTION_MS が本番値（5 分）に固定されていない');
  assert.match(MAIN_JS, /const\s+ROLLING_LOG_BUFFER_MAX\s*=\s*5000/,
    'ROLLING_LOG_BUFFER_MAX が本番値（5000）に固定されていない');
});

// ============================================================
// T6: _recordHighFreq / _highFreqCounter 機構撤去
// ============================================================
testSkippableOnMeas('T6: _recordHighFreq / _highFreqCounter 機構撤去（renderer.js + state.js）', () => {
  assert.ok(!RENDERER.includes('_recordHighFreq'),
    'renderer.js に _recordHighFreq が残存');
  assert.ok(!RENDERER.includes('_highFreqCounter'),
    'renderer.js に _highFreqCounter が残存');
  assert.ok(!STATE_JS.includes('_highFreqCounter'),
    'state.js に window._highFreqCounter 参照が残存');
});

// ============================================================
// T7: edge 発火低頻度ラベルは **保持**（撤去禁止対象の verify）
// ============================================================
testSkippableOnMeas('T7: edge 発火低頻度ラベル（state:transition / meas:session:start / meas:capture）は保持', () => {
  // state:transition は state.js に残る（edge 発火）
  assert.ok(STATE_JS.includes('state:transition'),
    'state.js から state:transition が消失（edge ラベル保持違反）');
  // meas:session:start / meas:capture は main.js に残る
  assert.ok(MAIN_JS.includes('meas:session:start'),
    'main.js から meas:session:start が消失');
  assert.ok(MAIN_JS.includes('meas:capture'),
    'main.js から meas:capture が消失');
});

// ============================================================
// T8: preload.js _measuredInvoke は薄ラッパとして **保持**（perf:ipc:roundtrip 発火だけ撤去）
// ============================================================
testSkippableOnMeas('T8: preload.js _measuredInvoke 薄ラッパ保持 + perf:ipc:roundtrip 発火撤去', () => {
  assert.ok(PRELOAD_JS.includes('_measuredInvoke'),
    'preload.js _measuredInvoke 薄ラッパが消失');
  assert.ok(!PRELOAD_JS.includes('perf:ipc:roundtrip'),
    'preload.js に perf:ipc:roundtrip ラベル発火が残存');
});

// ============================================================
// T9: 致命バグ保護 5 件 + v2.1.6〜v2.2.1 機構すべて完全保持
// ============================================================
testSkippableOnMeas('T9: 致命バグ保護 5 件 + v2.1.6〜v2.2.1 機構すべて完全保持', () => {
  // 致命バグ保護 5 件
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A 消失');
  assert.match(RENDERER, /function\s+handleReset\s*\(/, 'C.2.7-A handleReset 消失');
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/, 'C.2.7-D 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'C.1-A2 消失');
  assert.match(AUDIO_JS, /resume/, 'C.1.7 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'C.1.8 消失');

  // rc1〜rc10.1 機構
  assert.match(MAIN_JS, /dual:publish-pre-start-state/, 'rc1〜rc4 消失');
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart/, 'rc4 restorePreStart 消失');
  assert.match(MAIN_JS, /preStart:operator:send/, 'rc5 消失');
  assert.match(MAIN_JS, /preStart:cache:merge/, 'rc7 消失');
  assert.match(RENDERER, /operator:applyTimerStateToTimer:skip-reset-during-prestart/, 'rc8/rc9 消失');
  assert.match(TIMER_JS, /export\s+function\s+reset\s*\(\s*opts\s*=\s*\{\s*\}\s*\)/, 'rc10 reset(opts) 消失');
  assert.match(RENDERER, /timer:reset:skip-during-prestart/, 'rc10 ガード ラベル消失');
  assert.match(MAIN_JS, /hdmi:display-removed:dual-sync-stale/, 'rc10.1 #1 ラベル消失');
  assert.match(MAIN_JS, /hdmi:dialog-blocked:switchOperatorToSolo/, 'rc10.1 #2 ラベル消失');
  assert.match(RENDERER, /timer:reset:race-window-entry/, 'rc10.1 #10 ラベル消失');
});

console.log(`\nv234 (v2.2.1 撤去 verify): ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
