/**
 * v2.1.19-rc2 静的解析テスト — v2.1.18-meas1 計測機構撤去 + rc1 機構完全保持
 *
 *   Fix 1: 計測バッジ撤去（HTML + CSS + JS）
 *   Fix 2: 計測ラベル全撤去（perf:* / state:transition / dual-sync:apply / meas:* / error:caught:* meas1分 / ui:keypress meas1分 / ui:click:major meas1分）
 *   Fix 3: Ctrl+Shift+L 拡張撤去（_measOpCounter / op-{NN} / 拡張ハンドラ）
 *   v2.1.19-rc1 重さ根治機構（_tournamentsListDedup / _shouldRefreshListByThrottle / setInterval 撤廃）すべて完全保持
 *
 * 実行: node tests/v236-meas-removal.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PKG        = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const DUAL_SYNC  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const STATE_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'state.js'), 'utf8');
const MAIN_JS    = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const STYLE_CSS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// v2.1.20-rc1: meas / rc 系試験ビルドでは計測機構が**保持**されているため、本テスト（撤去 verify）は skip。
//   本番版（サフィックスなし）でのみ撤去 verify を実施。
const _shouldSkipMeasBuild = /-(meas|rc)\d+$/.test(PKG.version || '');
function testSkippableOnMeas(name, fn) {
  if (_shouldSkipMeasBuild) {
    console.log('SKIP:', name, '(meas / rc ビルドでは計測機構保持中のため撤去 verify を skip)');
    return;
  }
  test(name, fn);
}

// ============================================================
// version assertion: meas ビルドは別系列、test ではなく skip 経由で許容
// ============================================================
test('T0 version: package.json.version が現行版数（meas/non-meas どちらも許容）', () => {
  // v2.1.20-rc8: rc + meas 複合サフィックス（例 `rc6-meas3`）を許容するため regex 拡張
  assert.match(PKG.version, /^2\.\d+\.\d+(-(meas|rc)\d+(-meas\d+)?)?$/, `想定外の version: ${PKG.version}`);
});

// ============================================================
// T2: src/renderer/index.html 内 meas-build-badge 出現 0 件
// ============================================================
testSkippableOnMeas('T2: index.html 内 meas-build-badge 出現 0 件', () => {
  assert.ok(!INDEX_HTML.includes('meas-build-badge'),
    'index.html に meas-build-badge 文字列が残存（Fix 1 撤去未完了）');
});

// ============================================================
// T3: src/renderer/style.css 内 #meas-build-badge 出現 0 件
// ============================================================
testSkippableOnMeas('T3: style.css 内 #meas-build-badge 出現 0 件', () => {
  assert.ok(!STYLE_CSS.includes('#meas-build-badge'),
    'style.css に #meas-build-badge セレクタが残存（Fix 1 撤去未完了）');
  // バッジ用 CSS ブロック内の特徴的記述 (background: #FFD700) も撤去確認
  const badgeBlock = STYLE_CSS.match(/#meas-build-badge\s*\{[^}]*\}/);
  assert.ok(!badgeBlock, 'バッジ CSS ブロックが残存');
});

// ============================================================
// T4: src/renderer/renderer.js 内 meas-build-badge 出現 0 件
// ============================================================
testSkippableOnMeas('T4: renderer.js 内 meas-build-badge 出現 0 件', () => {
  assert.ok(!RENDERER.includes('meas-build-badge'),
    'renderer.js に meas-build-badge 文字列が残存（loadAppVersion バッジ表示分岐撤去未完了）');
});

// ============================================================
// T5: perf 系 6 ラベル全撤去
// ============================================================
testSkippableOnMeas('T5: perf 系 6 ラベルすべて 0 件（perf:render:duration / perf:ipc:roundtrip / perf:tick:fps / perf:memory:rss / perf:state:notify / perf:dom:rebuild）', () => {
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
// T6: meas:session:start / meas:capture 各 0 件
// ============================================================
testSkippableOnMeas('T6: renderer.js / main.js 内 meas:session:start / meas:capture 各 0 件', () => {
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  assert.ok(!ALL_SRC.includes('meas:session:start'),
    'meas:session:start が残存（Fix 2-3F 撤去未完了）');
  assert.ok(!ALL_SRC.includes('meas:capture'),
    'meas:capture が残存（Fix 4 撤去未完了）');
});

// ============================================================
// T7: src/main.js 内 _measOpCounter 出現 0 件
// ============================================================
testSkippableOnMeas('T7: main.js 内 _measOpCounter 出現 0 件', () => {
  assert.ok(!MAIN_JS.includes('_measOpCounter'),
    'main.js に _measOpCounter が残存（Fix 3 Ctrl+Shift+L 拡張撤去未完了）');
});

// ============================================================
// T8: src/main.js 内 padStart(2, '0') 形式の op 連番命名ロジック 0 件
// ============================================================
testSkippableOnMeas('T8: main.js 内 padStart(2, "0") の op 連番命名ロジック 0 件', () => {
  assert.ok(!/padStart\s*\(\s*2\s*,\s*['"]0['"]\s*\)/.test(MAIN_JS),
    'main.js に padStart(2, "0") の op 連番命名ロジックが残存（Fix 3 Ctrl+Shift+L 拡張撤去未完了）');
  // 念のため `op-${...}` 形式の filename 構築も撤去確認
  assert.ok(!/op-\$\{[^}]*\}-\$\{[^}]*\}\.log/.test(MAIN_JS),
    'main.js に op-{NN}-{timestamp}.log 命名テンプレートが残存');
});

// ============================================================
// T9: rc1 機構完全保持
// ============================================================
// v2.1.20-meas1: T9 は rc1 機構保持の verify。meas ビルドでも rc1 機構は保持されるため skip しない。
test('T9: v2.1.19-rc1 機構完全保持（_tournamentsListDedup / _shouldRefreshListByThrottle / setInterval 撤廃 / 直接 list 呼出 0 件 / dedup 12 件以上）', () => {
  // 関数定義
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    '_tournamentsListDedup 関数定義が消失（rc1 機構消失）');
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    '_shouldRefreshListByThrottle 関数定義が消失（rc1 機構消失）');
  assert.match(RENDERER, /let\s+_tournamentsListInFlight\s*=\s*null/,
    '_tournamentsListInFlight 変数定義が消失（rc1 機構消失）');
  assert.match(RENDERER, /let\s+_lastListRenderAt\s*=\s*0/,
    '_lastListRenderAt 変数定義が消失（rc1 機構消失）');

  // setInterval(renderTournamentList, 1000) 撤廃確認（コメント剥離後に検査）
  const stripped = RENDERER
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re,
    'setInterval(renderTournamentList, 1000) パターンが残存（rc1 主犯 1 撤廃が破壊された）');

  // 主犯 2（永続化用 5 秒 setInterval）は維持
  // v2.1.20-meas1: _wrappedSetInterval(_IntervalLabel.PERIODIC_PERSIST, ...) でラップ、両形式許容
  assert.match(RENDERER,
    /(?:setInterval\s*\(\s*periodicPersistAllRunning\s*,\s*5000\s*\)|_wrappedSetInterval\s*\(\s*_IntervalLabel\.PERIODIC_PERSIST\s*,\s*periodicPersistAllRunning\s*,\s*5000\s*\))/,
    '主犯 2 (periodicPersistAllRunning 5 秒 setInterval) が消失（永続化機能、維持必須）');

  // 直接 list 呼出 0 件
  const directCalls = RENDERER.match(/await\s+window\.api\??\.?tournaments\??\.?list\??\.?\(\)/g) || [];
  assert.equal(directCalls.length, 0,
    `await window.api.tournaments.list() 直接呼出が ${directCalls.length} 件残存（dedup 経由必須）`);
  // dedup wrapper 経由 12 件以上
  const dedupCalls = (RENDERER.match(/_tournamentsListDedup\s*\(\)/g) || []).length;
  assert.ok(dedupCalls >= 12, `_tournamentsListDedup() 呼出が ${dedupCalls} 件しかない（12 件以上必要）`);
});

console.log(`\nv236 meas-removal: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
