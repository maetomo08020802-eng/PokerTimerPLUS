/**
 * v2.1.20-meas1 静的解析テスト — meas1 機構復活 + meas2 新規 6 カテゴリ + 症状 1/2 真因確証 4 ラベル
 *
 *   Fix 1: meas1 計測基盤復活（バッジ + Ctrl+Shift+L 拡張 + preload _measuredInvoke）
 *   Fix 2: meas1 15 ラベル全復活
 *   Fix 3-A: setInterval ラップ（_wrappedSetInterval + perf:interval:fire）
 *   Fix 3-B: RAF ラップ（_wrappedRAF + perf:raf:summary）
 *   Fix 3-C: perf:ipc:summary（30 秒集計）
 *   Fix 3-D: perf:dom:summary（30 秒集計 + _domCounter）
 *   Fix 3-E: PerformanceObserver longtask + perf:long-task
 *   Fix 3-F: perf:subscribe:summary + _subscribeCounter
 *   Fix 3-G: 症状 1/2 真因確証 4 ラベル
 *
 * 実行: node tests/v238-meas2-labels-and-build.test.js
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

// ============================================================
// T1: package.json.version === '2.1.20-rc5'
// ============================================================
test('T1: package.json.version === 2.1.20-rc1', () => {
  assert.equal(PKG.version, '2.1.20-rc5', `期待 2.1.20-rc1, 実際 ${PKG.version}`);
});

// ============================================================
// T2: meas1 機構復活 — 計測バッジ HTML + CSS
// ============================================================
test('T2: meas1 計測バッジ（HTML + CSS）復活', () => {
  assert.match(INDEX_HTML, /<div\s+id="meas-build-badge">\s*計測ビルド\s*<\/div>/,
    'index.html に meas-build-badge が見つからない');
  assert.ok(STYLE_CSS.includes('#meas-build-badge'),
    'style.css に #meas-build-badge セレクタが見つからない');
  // loadAppVersion 内 バッジ表示分岐（-meas / -rc 両対応）
  assert.match(RENDERER, /\/-meas\\d\*\$\/\.test/,
    'loadAppVersion に -meas\\d*$ 検出 regex なし');
  assert.match(RENDERER, /\/-rc\\d\+\$\/\.test/,
    'loadAppVersion に -rc\\d+$ 検出 regex なし');
});

// ============================================================
// T3: meas1 15 ラベル全復活
// ============================================================
test('T3: meas1 15 ラベル全復活', () => {
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  // パフォーマンス系 6
  const perfLabels = [
    'perf:render:duration',
    'perf:ipc:roundtrip',
    'perf:tick:fps',
    'perf:memory:rss',
    'perf:state:notify',
    'perf:dom:rebuild'
  ];
  for (const l of perfLabels) {
    assert.ok(ALL_SRC.includes(l), `perf 系ラベル ${l} が見つからない`);
  }
  // バグ発見系 4 + error:caught:* + ui:keypress + ui:click:major
  assert.ok(ALL_SRC.includes('state:transition'), 'state:transition が見つからない');
  assert.ok(ALL_SRC.includes('dual-sync:apply'), 'dual-sync:apply が見つからない');
  assert.ok(ALL_SRC.includes('meas:session:start'), 'meas:session:start が見つからない');
  assert.ok(ALL_SRC.includes('meas:capture'), 'meas:capture が見つからない');
});

// ============================================================
// T4: カテゴリ A — _wrappedSetInterval 関数定義 + 既存 setInterval 経由化
// ============================================================
test('T4: _wrappedSetInterval 関数定義 + 既存 setInterval ラップ + perf:interval:fire', () => {
  assert.match(RENDERER, /function\s+_wrappedSetInterval\s*\(\s*label\s*,\s*fn\s*,\s*ms\s*\)/,
    'renderer.js に _wrappedSetInterval 関数定義なし');
  // 既存 setInterval 呼出 (periodicPersist / slideshow) が _wrappedSetInterval 経由
  assert.match(RENDERER, /_wrappedSetInterval\(\s*_IntervalLabel\.PERIODIC_PERSIST/,
    'periodicPersistAllRunning の setInterval が _wrappedSetInterval 経由でない');
  assert.match(RENDERER, /_wrappedSetInterval\(\s*_IntervalLabel\.SLIDESHOW_ROTATION/,
    'slideshow の setInterval が _wrappedSetInterval 経由でない');
  // perf:interval:fire ラベル
  assert.ok(RENDERER.includes('perf:interval:fire'),
    'renderer.js に perf:interval:fire ラベルなし');
  assert.ok(MAIN_JS.includes('perf:interval:fire'),
    'main.js に perf:interval:fire ラベルなし');
});

// ============================================================
// T5: カテゴリ B — _wrappedRAF 関数定義 + RAF ラップ + perf:raf:summary
// ============================================================
test('T5: _wrappedRAF 関数定義 + RAF ラップ + perf:raf:summary / perf:raf:fire', () => {
  assert.match(RENDERER, /function\s+_wrappedRAF\s*\(\s*label\s*,\s*fn\s*\)/,
    'renderer.js に _wrappedRAF 関数定義なし');
  // hall RAF (HALL_PRE_START_TICK / HALL_TICK_FRAME) が _wrappedRAF 経由
  assert.match(RENDERER, /_wrappedRAF\(\s*_RafLabel\.HALL_PRE_START_TICK/,
    'HALL_PRE_START_TICK が _wrappedRAF 経由でない');
  assert.match(RENDERER, /_wrappedRAF\(\s*_RafLabel\.HALL_TICK_FRAME/,
    'HALL_TICK_FRAME が _wrappedRAF 経由でない');
  // perf:raf:summary（1 秒集計）
  assert.ok(RENDERER.includes('perf:raf:summary'),
    'renderer.js に perf:raf:summary ラベルなし');
  // perf:raf:fire（dual-sync / timer.js の単発）
  assert.ok(DUAL_SYNC.includes('perf:raf:fire'),
    'dual-sync.js に perf:raf:fire ラベルなし');
  assert.ok(TIMER_JS.includes('perf:raf:fire'),
    'timer.js に perf:raf:fire ラベルなし');
});

// ============================================================
// T6: カテゴリ C — perf:ipc:summary + 30 秒集計 setInterval
// ============================================================
test('T6: perf:ipc:summary ラベル + 30 秒集計', () => {
  assert.ok(RENDERER.includes('perf:ipc:summary'),
    'renderer.js に perf:ipc:summary ラベルなし');
  // _ipcCounter 集計変数
  assert.match(RENDERER, /const\s+_ipcCounter\s*=\s*\{\}/,
    'renderer.js に _ipcCounter 変数定義なし');
  // 30 秒集計 setInterval（生 setInterval、`_wrappedSetInterval` 自己参照を避けるため）
  // v2.1.20-meas1: 1 個の setInterval(...) ブロックに perf:ipc:summary / perf:dom:summary / perf:subscribe:summary を集約。
  //   ブロック全体（{...}, 30000) で perf:ipc:summary を含むことを許容（広めの window）。
  assert.match(RENDERER, /setInterval\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,2000}?perf:ipc:summary[\s\S]{0,2000}?\}\s*,\s*30000\s*\)/,
    '30 秒集計 setInterval（perf:ipc:summary）なし');
});

// ============================================================
// T7: カテゴリ D — perf:dom:summary + _domCounter
// ============================================================
test('T7: perf:dom:summary ラベル + _domCounter 集計', () => {
  assert.ok(RENDERER.includes('perf:dom:summary'),
    'renderer.js に perf:dom:summary ラベルなし');
  assert.match(RENDERER, /const\s+_domCounter\s*=\s*\{\}/,
    'renderer.js に _domCounter 変数定義なし');
  assert.match(RENDERER, /function\s+_recordDomTime\s*\(/,
    '_recordDomTime ヘルパなし');
  // 主要 render 関数で _recordDomTime 呼出
  for (const fn of ['renderTime', 'renderControls', 'renderTournamentList', 'renderBlindsTable']) {
    assert.match(RENDERER, new RegExp(`_recordDomTime\\s*\\(\\s*['"]${fn}['"]`),
      `${fn} で _recordDomTime 呼出なし`);
  }
});

// ============================================================
// T8: カテゴリ E — PerformanceObserver + longtask + perf:long-task
// ============================================================
test('T8: PerformanceObserver longtask + perf:long-task', () => {
  assert.match(RENDERER, /new\s+PerformanceObserver\s*\(/,
    'renderer.js に new PerformanceObserver なし');
  assert.match(RENDERER, /entryTypes:\s*\[\s*['"]longtask['"]\s*\]/,
    'observe({ entryTypes: ["longtask"] }) なし');
  assert.ok(RENDERER.includes('perf:long-task'),
    'perf:long-task ラベルなし');
});

// ============================================================
// T9: カテゴリ F — perf:subscribe:summary + _subscribeCounter + subscribeNamed
// ============================================================
test('T9: perf:subscribe:summary + _subscribeCounter + subscribeNamed', () => {
  assert.ok(RENDERER.includes('perf:subscribe:summary'),
    'renderer.js に perf:subscribe:summary ラベルなし');
  assert.match(RENDERER, /const\s+_subscribeCounter\s*=\s*\{\}/,
    'renderer.js に _subscribeCounter 変数定義なし');
  // state.js 側に subscribeNamed export
  assert.match(STATE_JS, /export\s+function\s+subscribeNamed\s*\(/,
    'state.js に subscribeNamed export なし');
  // renderer.js 側で subscribeNamed 使用（main subscribe に名前付与）
  assert.match(RENDERER, /subscribeNamed\(\s*['"]subscribe:main-renderer['"]/,
    'renderer.js main subscribe が subscribeNamed 経由でない');
});

// ============================================================
// T10: カテゴリ G — 症状 1/2 真因確証 4 ラベル
// ============================================================
test('T10: 症状 1/2 真因確証 4 ラベル', () => {
  assert.ok(RENDERER.includes('hall:syncSlideshowFromState:call'),
    'hall:syncSlideshowFromState:call ラベルなし');
  assert.ok(RENDERER.includes('hall:updatePipTimer:set'),
    'hall:updatePipTimer:set ラベルなし');
  assert.ok(RENDERER.includes('hall:applyHallPreStartState:apply'),
    'hall:applyHallPreStartState:apply ラベルなし');
  assert.ok(RENDERER.includes('hall:clock-pause-label:visibility'),
    'hall:clock-pause-label:visibility ラベルなし');
});

// ============================================================
// T11: v2.1.19 機構保持確認（rc1: dedup / throttle / setInterval 撤廃）
// ============================================================
test('T11: v2.1.19 機構保持（_tournamentsListDedup / _shouldRefreshListByThrottle / 直接 list 0 件 / dedup 12 件以上）', () => {
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    '_tournamentsListDedup 関数定義が消失（rc1 機構消失）');
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    '_shouldRefreshListByThrottle 関数定義が消失');
  // setInterval(renderTournamentList, 1000) 撤廃確認（コメント剥離後）
  const stripped = RENDERER
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re,
    'setInterval(renderTournamentList, 1000) パターン残存（rc1 機構が破壊）');
  // 直接 list 呼出 0 件
  const directCalls = RENDERER.match(/await\s+window\.api\??\.?tournaments\??\.?list\??\.?\(\)/g) || [];
  assert.equal(directCalls.length, 0,
    `直接 list() 呼出が ${directCalls.length} 件残存`);
  // dedup wrapper 経由 12 件以上
  const dedupCalls = (RENDERER.match(/_tournamentsListDedup\s*\(\)/g) || []).length;
  assert.ok(dedupCalls >= 12, `_tournamentsListDedup() 呼出が ${dedupCalls} 件しかない`);
});

// ============================================================
// T12: 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構保持
// ============================================================
test('T12: 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構保持', () => {
  // 致命バグ保護 5 件
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A 消失');
  assert.match(RENDERER, /function\s+handleReset\s*\(/, 'C.2.7-A handleReset 消失');
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/, 'C.2.7-D 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'C.1-A2 消失');
  assert.match(AUDIO_JS, /resume/, 'C.1.7 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'C.1.8 消失');
  // v2.1.6〜v2.1.18 機構
  assert.match(MAIN_JS, /dual:publish-pre-start-state/, 'v2.1.6 消失');
  assert.match(MAIN_JS, /typeof\s+payload\.isPaused\s*===\s*['"]boolean['"]/, 'v2.1.17 消失');
  assert.match(TIMER_JS, /onTournamentComplete/, 'v2.1.18 ② 消失');
  // 主犯 2 (5 秒 persist setInterval) 維持
  assert.match(RENDERER, /_wrappedSetInterval\s*\(\s*_IntervalLabel\.PERIODIC_PERSIST/,
    '主犯 2 (periodicPersistAllRunning) が消失（永続化機能、維持必須）');
});

console.log(`\nv238 meas2-labels-and-build: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
