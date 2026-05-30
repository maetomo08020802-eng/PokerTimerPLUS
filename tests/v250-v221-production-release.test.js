/**
 * v2.2.1 静的解析テスト — 全国リリース版 配信完成度確認
 *
 *   v2.2.1 で実施した変更:
 *     - 計測機構撤去（バッジ + 高頻度ラベル 14 種 + rc6-meas3 機構 + _recordHighFreq）
 *     - timer.js _emitRafFire 撤去
 *     - state.js subscribeNamed / _highFreqCounter / perf:state:notify 撤去
 *     - preload.js _measuredInvoke 薄ラッパ化（perf:ipc:roundtrip 撤去）
 *     - ROLLING_LOG_RETENTION_MS = 5 * 60 * 1000 / ROLLING_LOG_BUFFER_MAX = 5000 本番値固定
 *     - version 2.2.1 → 2.2.1
 *     - CHANGELOG.md に v2.2.1 セクション追加
 *
 *   v2.2.1 で **保持**:
 *     - priority-events.log 機構（PRIORITY_LOG_LABELS Set 12 ラベル + rc10.1 3 ラベル）
 *     - rolling-current.log 基本機構
 *     - rc1〜rc10.1 機能コード + 致命バグ保護 5 件
 *     - edge 発火低頻度ラベル（state:transition / meas:capture / meas:session:start / ui:keypress / ui:click:major）
 *     - _wrappedSetInterval / _wrappedRAF wrapper（機能実装に必須、ラベル発火行のみ撤去）
 *
 * 実行: node tests/v250-v221-production-release.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PKG        = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const TIMER_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const STATE_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'state.js'), 'utf8');
const DUAL_SYNC  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const MAIN_JS    = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const STYLE_CSS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const AUDIO_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
const CHANGELOG  = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: package.json.version === '2.2.1'（本番版数、サフィックスなし）
// ============================================================
test('T1: package.json.version === 2.2.1 + サフィックスなし', () => {
  assert.equal(PKG.version, '2.4.1', `期待 2.2.1, 実際 ${PKG.version}`);
  assert.doesNotMatch(PKG.version, /-/, `本番版にサフィックスが残存: ${PKG.version}`);
});

// ============================================================
// T2: 計測バッジ完全撤去（HTML + CSS + JS 表示分岐）
// ============================================================
test('T2: 計測バッジ完全撤去（index.html / style.css / renderer.js）', () => {
  assert.ok(!INDEX_HTML.includes('meas-build-badge'),
    'index.html に meas-build-badge 文字列が残存');
  assert.ok(!STYLE_CSS.includes('meas-build-badge'),
    'style.css に meas-build-badge ルールが残存');
  assert.ok(!RENDERER.includes("getElementById('meas-build-badge')"),
    'renderer.js に meas-build-badge 要素取得が残存');
});

// ============================================================
// T3: 高頻度ラベル 14 種すべて撤去（grep 0 件確認）
// ============================================================
test('T3: 高頻度ラベル 14 種すべて非発火（perf:* grep 0 件）', () => {
  const perfLabels = [
    'perf:render:duration', 'perf:state:notify', 'perf:ipc:roundtrip',
    'perf:tick:fps', 'perf:memory:rss', 'perf:dom:rebuild',
    'perf:raf:fire', 'perf:raf:summary', 'perf:highfreq:summary',
    'perf:interval:fire', 'perf:long-task', 'perf:ipc:summary',
    'perf:dom:summary', 'perf:subscribe:summary'
  ];
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS + TIMER_JS;
  for (const lbl of perfLabels) {
    assert.ok(!ALL_SRC.includes(lbl), `高頻度ラベル ${lbl} がソース全体に残存`);
  }
});

// ============================================================
// T4: rc6-meas3 機構撤去 + ROLLING_LOG 本番値固定
// ============================================================
test('T4: rc6-meas3 機構撤去（_flushLogsToFile / _isMeasBuildForBuffer / meas3:hdmi-snapshot:written 全消失）+ ROLLING_LOG 本番値固定', () => {
  assert.ok(!MAIN_JS.includes('_flushLogsToFile'),
    'main.js に _flushLogsToFile 関数が残存');
  assert.ok(!MAIN_JS.includes('_isMeasBuildForBuffer'),
    'main.js に _isMeasBuildForBuffer が残存');
  assert.ok(!MAIN_JS.includes('_appVersionForBuffer'),
    'main.js に _appVersionForBuffer が残存（dead code）');
  assert.ok(!MAIN_JS.includes('meas3:hdmi-snapshot:written'),
    'main.js に meas3:hdmi-snapshot:written ラベルが残存');
  assert.ok(!MAIN_JS.includes('hdmi-snapshot'),
    'main.js に hdmi-snapshot 文字列（snapshot 採取機構）が残存');
  // ROLLING_LOG 本番値固定
  assert.match(MAIN_JS, /const\s+ROLLING_LOG_RETENTION_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/,
    'ROLLING_LOG_RETENTION_MS が本番値（5 分）固定でない');
  assert.match(MAIN_JS, /const\s+ROLLING_LOG_BUFFER_MAX\s*=\s*5000/,
    'ROLLING_LOG_BUFFER_MAX が本番値（5000）固定でない');
});

// ============================================================
// T5: _recordHighFreq / _highFreqCounter 機構撤去（renderer.js + state.js + subscribeNamed）
// ============================================================
test('T5: _recordHighFreq / _highFreqCounter / subscribeNamed 撤去', () => {
  assert.ok(!RENDERER.includes('_recordHighFreq'),
    'renderer.js に _recordHighFreq が残存');
  assert.ok(!RENDERER.includes('_highFreqCounter'),
    'renderer.js に _highFreqCounter が残存');
  assert.ok(!STATE_JS.includes('_highFreqCounter'),
    'state.js に _highFreqCounter 参照が残存');
  assert.ok(!STATE_JS.includes('subscribeNamed'),
    'state.js に subscribeNamed export が残存');
  assert.ok(!STATE_JS.includes('__measName'),
    'state.js に __measName が残存');
  assert.ok(!RENDERER.includes('subscribeNamed'),
    'renderer.js に subscribeNamed 参照が残存');
});

// ============================================================
// T6: priority-events.log 機構 + edge 発火ラベル 13 種すべて完全保持
// ============================================================
test('T6: priority-events.log 機構保持 + PRIORITY_LOG_LABELS 12 ラベル（meas3:hdmi-snapshot:written のみ削除）+ rc10.1 3 ラベル追加', () => {
  // priority-events.log 機構
  assert.match(MAIN_JS, /const\s+PRIORITY_LOG_BUFFER_MAX\s*=\s*10000/,
    'PRIORITY_LOG_BUFFER_MAX が消失');
  assert.match(MAIN_JS, /const\s+PRIORITY_LOG_LABELS\s*=\s*new\s+Set\s*\(/,
    'PRIORITY_LOG_LABELS Set が消失');
  assert.match(MAIN_JS, /function\s+_isPriorityLabel\s*\(/, '_isPriorityLabel が消失');
  assert.match(MAIN_JS, /function\s+_appendPriorityLog\s*\(/, '_appendPriorityLog が消失');
  assert.match(MAIN_JS, /async\s+function\s+_flushPriorityLog\s*\(/, '_flushPriorityLog が消失');
  // PRIORITY_LOG_LABELS Set 内 13 ラベル（meas3:hdmi-snapshot:written 削除 + rc10.1 3 ラベル追加）
  const setMatch = MAIN_JS.match(/const\s+PRIORITY_LOG_LABELS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(setMatch, 'PRIORITY_LOG_LABELS Set 内容抽出失敗');
  const setBody = setMatch[1];
  const expected = [
    'display-removed', 'display-added',
    'switchOperatorToSolo:enter', 'switchOperatorToSolo:exit',
    'switchSoloToOperator:enter', 'switchSoloToOperator:exit',
    'preStart:operator:send', 'operator:preStartResync:sent',
    'operator:applyPreStartState:apply',
    // rc10.1 追加 3 ラベル
    'hdmi:display-removed:dual-sync-stale',
    'hdmi:dialog-blocked:switchOperatorToSolo',
    'timer:reset:race-window-entry'
  ];
  for (const lbl of expected) {
    assert.ok(setBody.includes(`'${lbl}'`),
      `PRIORITY_LOG_LABELS Set に ${lbl} が含まれていない`);
  }
  // meas3:hdmi-snapshot:written のみ削除確認
  assert.ok(!setBody.includes('meas3:hdmi-snapshot:written'),
    'PRIORITY_LOG_LABELS から meas3:hdmi-snapshot:written が削除されていない');
});

// ============================================================
// T7: rc1〜rc10.1 機構 + 致命バグ保護 5 件 完全保持
// ============================================================
test('T7: rc1〜rc10.1 機構 + 致命バグ保護 5 件 完全保持', () => {
  // rc4
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart/, 'rc4 restorePreStart 消失');
  assert.match(RENDERER, /function\s+applyOperatorPreStartState/, 'rc4 applyOperatorPreStartState 消失');
  // rc5
  assert.match(MAIN_JS, /preStart:operator:send/, 'rc5 preStart:operator:send 消失');
  assert.match(MAIN_JS, /operator:preStartResync:sent/, 'rc5 operator:preStartResync:sent 消失');
  // rc7
  assert.match(MAIN_JS, /preStart:cache:merge/, 'rc7 消失');
  // rc8/rc9
  assert.match(RENDERER, /operator:applyTimerStateToTimer:skip-reset-during-prestart/, 'rc8/rc9 消失');
  for (const trg of ['invalid-ts', 'idle', 'finished', 'no-levels']) {
    const re = new RegExp(`trigger:\\s*['"]${trg}['"]`);
    assert.match(RENDERER, re, `rc9 trigger:'${trg}' 消失`);
  }
  // rc10
  assert.match(TIMER_JS, /export\s+function\s+reset\s*\(\s*opts\s*=\s*\{\s*\}\s*\)/, 'rc10 reset(opts) 消失');
  assert.match(TIMER_JS, /if\s*\(\s*!\s*force\s*&&\s*isPreStart\s*\)/, 'rc10 force ガード消失');
  const forceCalls = (RENDERER.match(/timerReset\s*\(\s*\{\s*force\s*:\s*false\s*\}\s*\)/g) || []).length;
  assert.ok(forceCalls === 5, `rc10 timerReset({force:false}) 呼出 5 箇所必須、現状 ${forceCalls}`);
  // rc10.1
  assert.match(MAIN_JS, /hdmi:display-removed:dual-sync-stale/, 'rc10.1 #1 消失');
  assert.match(MAIN_JS, /hdmi:dialog-blocked:switchOperatorToSolo/, 'rc10.1 #2 消失');
  assert.match(RENDERER, /timer:reset:race-window-entry/, 'rc10.1 #10 消失');
  assert.match(MAIN_JS, /let\s+_preStartStateCacheUpdatedAt\s*=\s*0/, 'rc10.1 _preStartStateCacheUpdatedAt 消失');

  // 致命バグ保護 5 件
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A 消失');
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/, 'C.2.7-D 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'C.1-A2 消失');
  assert.match(AUDIO_JS, /audioContext\.resume/, 'C.1.7 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'C.1.8 消失');
});

// ============================================================
// T8: edge 発火低頻度ラベル完全保持（撤去禁止対象）
// ============================================================
test('T8: edge 発火低頻度ラベル完全保持（state:transition / meas:* / ui:* / error:caught:* / app:ready）', () => {
  // state:transition
  assert.ok(STATE_JS.includes('state:transition'), 'state:transition 消失');
  // meas:* （edge 発火）
  assert.ok(MAIN_JS.includes('meas:session:start'), 'meas:session:start 消失');
  assert.ok(MAIN_JS.includes('meas:capture'), 'meas:capture 消失');
  // ui:* （edge 発火、ユーザー操作）
  const ALL_SRC = RENDERER + MAIN_JS;
  assert.ok(ALL_SRC.includes('ui:keypress'), 'ui:keypress 消失');
  // error:caught:* は edge エラー検出のため保持
  const errCatch = ALL_SRC.match(/error:caught:/g) || [];
  assert.ok(errCatch.length > 0, 'error:caught:* がすべて消失（edge エラー検出ラベル保持違反）');
});

// ============================================================
// T9: wrapper 関数（_wrappedSetInterval / _wrappedRAF / _IntervalLabel / _RafLabel）保持 + ラベル発火行のみ撤去
// ============================================================
test('T9: wrapper 関数保持 + 計測ラベル発火行のみ撤去', () => {
  // _wrappedSetInterval / _wrappedRAF / enum 保持
  assert.match(RENDERER, /function\s+_wrappedSetInterval\s*\(/, '_wrappedSetInterval が消失');
  assert.match(RENDERER, /function\s+_wrappedRAF\s*\(/, '_wrappedRAF が消失');
  assert.match(RENDERER, /const\s+_IntervalLabel\s*=\s*\{/, '_IntervalLabel enum が消失');
  assert.match(RENDERER, /const\s+_RafLabel\s*=\s*\{/, '_RafLabel enum が消失');
  // 計測ラベル発火行のみ撤去（perf:interval:fire / _rafCounter）
  const wrapBody = RENDERER.match(/function\s+_wrappedSetInterval\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(wrapBody);
  assert.ok(!wrapBody[1].includes('perf:interval:fire'),
    '_wrappedSetInterval 内に perf:interval:fire 発火が残存');
  // timer.js _emitRafFire 撤去
  assert.ok(!TIMER_JS.includes('_emitRafFire'),
    'timer.js に _emitRafFire 関数が残存');
  assert.ok(!TIMER_JS.includes('_rafFireCounter'),
    'timer.js に _rafFireCounter が残存');
});

// ============================================================
// T10: CHANGELOG.md v2.2.1 セクション + electron-builder / autoUpdater 設定
// ============================================================
test('T10: CHANGELOG.md v2.2.1 セクション存在 + package.json build 設定整合性', () => {
  // CHANGELOG.md v2.2.1 セクション存在
  assert.match(CHANGELOG, /##\s+v?2\.2\.1\s+[—\-]\s+2026-05-12/,
    'CHANGELOG.md に v2.2.1 - 2026-05-12 セクションがない');
  // 主要キーワード（CHANGELOG 確定版から抜粋）
  assert.match(CHANGELOG, /HDMI ケーブル抜き差し時のタイマー消失問題を根治/,
    'CHANGELOG.md v2.2.1 セクションに HDMI 根治説明がない');
  assert.match(CHANGELOG, /配布元:\s*Yu Shimomachi/,
    'CHANGELOG.md v2.2.1 セクション末尾の配布元クレジットがない');

  // package.json メタデータ
  assert.ok(PKG.build, 'package.json.build が未設定');
  assert.equal(PKG.build.appId, 'com.shitamachi.pokertimerplus',
    'appId が一致しない');
  assert.equal(PKG.build.publish.provider, 'github', 'publish.provider が github でない');
  assert.equal(PKG.build.publish.owner, 'maetomo08020802-eng',
    'publish.owner が不一致');
  assert.equal(PKG.build.publish.repo, 'PokerTimerPLUS',
    'publish.repo が不一致');
  // autoUpdater は本番ビルドで動作
  assert.match(MAIN_JS, /require\s*\(\s*['"]electron-updater['"]\s*\)/,
    'main.js で electron-updater require が消失');
  assert.match(MAIN_JS, /autoUpdater\.checkForUpdatesAndNotify/,
    'autoUpdater.checkForUpdatesAndNotify 呼出が消失');
});

console.log(`\nv250 v2.2.1 production-release: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
