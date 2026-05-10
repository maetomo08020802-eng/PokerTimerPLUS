/**
 * v2.1.19-rc2 静的解析テスト — v2.1.18-meas1 計測機構の **撤去** 確認（旧 v234 の assertion を全反転）
 *
 *   元 v234 (v2.1.18-meas1 時点): 計測機構の「存在」を確認
 *   現 v234 (v2.1.19-rc2 以降): 計測機構の「撤去」を確認
 *
 *   meas1 機構をすべて撤去（バッジ + 15 ラベル + Ctrl+Shift+L 拡張）。
 *   meas / rc1 ビルドでは skip（保持されているため）、rc2 / 本番版でのみ撤去 verify。
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

// v2.1.19-rc2: meas1 / rc1 ビルドでは skip（meas1 機構保持中のため撤去 verify は不可能）。
//   rc2 / 本番版でのみ撤去 verify を実施。
const _shouldSkip = /-(meas\d+|rc1)$/.test(PKG.version || '');
function testSkippableOnMeas(name, fn) {
  if (_shouldSkip) {
    console.log('SKIP:', name, '(meas1 / rc1 ビルドでは meas1 機構保持中のためテスト skip)');
    return;
  }
  test(name, fn);
}

// ============================================================
// version assertion
// ============================================================
test('version: package.json version は 2.1.19-rc2 以上', () => {
  // v2.1.19-rc2 / 2.1.19 / 2.1.20 等以降を許容、meas1 / rc1 では skip 経路に振る
  assert.match(PKG.version, /^2\.1\.(19-rc[2-9]|19$|2\d|[3-9]\d)/, `期待 2.1.19-rc2 以上, 実際 ${PKG.version}`);
});

// ============================================================
// T1: index.html から計測バッジ要素が撤去されている
// ============================================================
testSkippableOnMeas('T1: index.html から meas-build-badge が撤去されている', () => {
  assert.ok(!INDEX_HTML.includes('meas-build-badge'),
    'index.html に meas-build-badge 文字列が残存（Fix 1 撤去未完了）');
});

// ============================================================
// T2: style.css から #meas-build-badge ブロックが撤去されている
// ============================================================
testSkippableOnMeas('T2: style.css から #meas-build-badge ブロックが撤去されている', () => {
  assert.ok(!STYLE_CSS.includes('#meas-build-badge'),
    'style.css に #meas-build-badge セレクタが残存（Fix 1 撤去未完了）');
});

// ============================================================
// T3: renderer.js loadAppVersion から -meas / バッジ表示分岐が撤去されている
// ============================================================
testSkippableOnMeas('T3: renderer.js loadAppVersion から -meas / バッジ表示分岐が撤去されている', () => {
  // バッジ要素取得・display none 処理が消えていること
  assert.ok(!RENDERER.includes("getElementById('meas-build-badge')"),
    'renderer.js に meas-build-badge 要素取得処理が残存');
  assert.ok(!/-meas\\d\*\$/.test(RENDERER),
    'renderer.js に -meas\\d*$ サフィックス検出 regex が残存');
});

// ============================================================
// T4: パフォーマンス系 6 ラベルがすべて撤去されている
// ============================================================
testSkippableOnMeas('T4: パフォーマンス系 6 ラベル（perf:*）すべて撤去', () => {
  const labels = [
    'perf:render:duration',
    'perf:ipc:roundtrip',
    'perf:tick:fps',
    'perf:memory:rss',
    'perf:state:notify',
    'perf:dom:rebuild'
  ];
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  for (const label of labels) {
    assert.ok(!ALL_SRC.includes(label), `ラベル ${label} がソース全体に残存（Fix 2 撤去未完了）`);
  }
});

// ============================================================
// T5: バグ発見系新規 4 ラベル（meas1 で追加）すべて撤去
// ============================================================
testSkippableOnMeas('T5: バグ発見系新規 4 ラベル（state:transition / dual-sync:apply / meas:session:start / meas:capture）すべて撤去', () => {
  const labels = [
    'state:transition',
    'dual-sync:apply',
    'meas:session:start',
    'meas:capture'
  ];
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  for (const label of labels) {
    assert.ok(!ALL_SRC.includes(label), `ラベル ${label} がソース全体に残存（Fix 2 撤去未完了）`);
  }
});

// ============================================================
// T6: error:caught:* / ui:keypress / ui:click:major（meas1 追加分）すべて撤去
// ============================================================
testSkippableOnMeas('T6: error:caught:* / ui:keypress / ui:click:major（meas1 追加分）すべて撤去', () => {
  // meas1 で追加した分はすべて撤去（v2.1.18 以前から存在するログ呼出は触らない）。
  // 検証: ALL_SRC で各ラベルの実呼出が 0 件
  const ALL_SRC = RENDERER + STATE_JS + DUAL_SYNC + MAIN_JS + PRELOAD_JS;
  const errCatchMatches = ALL_SRC.match(/['"]error:caught:[a-zA-Z][\w:.-]*['"]/g) || [];
  assert.equal(errCatchMatches.length, 0, `error:caught:* が ${errCatchMatches.length} 件残存（meas1 追加分撤去未完了）`);
  const keypressMatches = ALL_SRC.match(/['"]ui:keypress['"]/g) || [];
  assert.equal(keypressMatches.length, 0, `ui:keypress が ${keypressMatches.length} 件残存`);
  const clickMatches = ALL_SRC.match(/['"]ui:click:major['"]/g) || [];
  assert.equal(clickMatches.length, 0, `ui:click:major が ${clickMatches.length} 件残存`);
});

// ============================================================
// T7: main.js から _measOpCounter + op-{NN} 命名ロジックが撤去
// ============================================================
testSkippableOnMeas('T7: main.js から _measOpCounter + op-{NN} 命名ロジックが撤去', () => {
  assert.ok(!MAIN_JS.includes('_measOpCounter'),
    'main.js に _measOpCounter が残存（Fix 3 Ctrl+Shift+L 拡張撤去未完了）');
  assert.ok(!/padStart\(2,\s*['"]0['"]\)/.test(MAIN_JS),
    'main.js に padStart(2, "0") の op 連番命名ロジックが残存');
});

// ============================================================
// T8: preload.js から _measuredInvoke ラッパが撤去（ipcRenderer.invoke 直接呼出に戻る）
// ============================================================
testSkippableOnMeas('T8: preload.js から _measuredInvoke ラッパが撤去', () => {
  assert.ok(!PRELOAD_JS.includes('_measuredInvoke'),
    'preload.js に _measuredInvoke 関数が残存（perf:ipc:roundtrip 撤去未完了）');
  assert.ok(!PRELOAD_JS.includes('rollingLogViaIpc'),
    'preload.js に rollingLogViaIpc ヘルパが残存');
});

// ============================================================
// T9: 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 + v2.1.19-rc1 機構すべて完全保持
// ============================================================
testSkippableOnMeas('T9: 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 + v2.1.19-rc1 機構すべて完全保持', () => {
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

  // v2.1.19-rc1 機構（重さ根治）
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    'v2.1.19-rc1 _tournamentsListDedup 消失');
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    'v2.1.19-rc1 _shouldRefreshListByThrottle 消失');
  assert.match(RENDERER, /let\s+_tournamentsListInFlight\s*=\s*null/,
    'v2.1.19-rc1 _tournamentsListInFlight 消失');
});

console.log(`\nv234 (v2.1.19-rc2 inverted): ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
