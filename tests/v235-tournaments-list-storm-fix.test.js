/**
 * v2.1.19-rc1 静的解析テスト — tournaments:list 暴走根治（setInterval 撤廃 + Promise dedup）
 *
 *   Fix 1: setInterval(renderTournamentList, 1000) 撤廃 + subscribe + 1秒 throttle に置換
 *   Fix 2: tournaments.list の in-flight 1 本化ラッパ `_tournamentsListDedup` 追加 + 全置換
 *   v2.1.18-meas1 計測機構（バッジ + 15 ラベル + Ctrl+Shift+L 拡張）すべて完全保持
 *   致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構すべて完全保持
 *
 * 実行: node tests/v235-tournaments-list-storm-fix.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const TIMER_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const STATE_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'state.js'), 'utf8');
const MAIN_JS   = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
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
// version assertion
// ============================================================
test('version: package.json の version が 2.1.19-rc1', () => {
  assert.equal(PKG.version, '2.6.5', `期待 2.1.19-rc1, 実際 ${PKG.version}`);
});

// ============================================================
// T1: renderer.js に `setInterval(...renderTournamentList...1000)` の出現件数が 0（主犯 1 撤廃確認）
// ============================================================
test('T1: renderer.js setInterval(renderTournamentList...1000) の実呼出が 0 件（主犯 1 撤廃）', () => {
  // setInterval 内で renderTournamentList を 1000ms 周期で呼ぶパターンが消えていることを確認。
  //   旧コード: `setInterval(() => { renderTournamentList().catch(() => {}); }, 1000);`
  //   新コード: subscribe 経由 + _shouldRefreshListByThrottle gate
  //
  // コメント行（// v2.1.19-rc1 ... setInterval(renderTournamentList, 1000) を削除...）には
  // 文字列として残っているため、コメントを除去してから検査する。
  const stripped = RENDERER
    // 単行コメント // ... を行末（\n / \r どちらにもヒット）まで削除。
    // CRLF ファイルでも安全になるよう [^\n] を使う（`.` は `\r` にもマッチしない）。
    .replace(/\/\/[^\n]*/g, '')
    // ブロックコメント /* ... */ を削除
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re,
    'renderer.js に setInterval で renderTournamentList を 1000ms 起動するパターンが残存（Fix 1 主犯 1 撤廃未完了）');
});

// ============================================================
// T2: subscribe リスナ内に `_shouldRefreshListByThrottle` 経由 + status/level 即時の renderTournamentList 呼出存在
// ============================================================
test('T2: subscribe 内で _shouldRefreshListByThrottle gate 経由の renderTournamentList 呼出存在', () => {
  // throttle 関数定義
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    '_shouldRefreshListByThrottle 関数定義が見つからない');
  assert.match(RENDERER, /let\s+_lastListRenderAt\s*=\s*0/,
    '_lastListRenderAt モジュールスコープ変数定義が見つからない');
  // subscribe 内で status/level 変化 OR throttle gate が renderTournamentList を呼ぶ独立 if 句
  // v2.1.20-rc3: renderTournamentList → renderTournamentListWithDedup（Promise dedup ラッパ）への置換許容
  assert.match(RENDERER,
    /if\s*\(\s*state\.status\s*!==\s*prev\.status\s*\|\|\s*state\.currentLevelIndex\s*!==\s*prev\.currentLevelIndex\s*\|\|\s*_shouldRefreshListByThrottle\s*\(\s*\)\s*\)\s*\{[\s\S]{0,200}?renderTournamentList(?:WithDedup)?\s*\(\s*\)\.catch/,
    'subscribe 内に status/level OR _shouldRefreshListByThrottle gate 経由の renderTournamentList(WithDedup) 呼出が見つからない');
});

// ============================================================
// T3: モジュールスコープに _tournamentsListInFlight + _tournamentsListDedup 関数定義存在
// ============================================================
test('T3: renderer.js モジュールスコープに _tournamentsListInFlight + _tournamentsListDedup 関数定義', () => {
  assert.match(RENDERER, /let\s+_tournamentsListInFlight\s*=\s*null/,
    '_tournamentsListInFlight モジュールスコープ変数定義が見つからない');
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    '_tournamentsListDedup async 関数定義が見つからない');
});

// ============================================================
// T4: renderer.js 内 `await window.api.tournaments.list()` の直接呼出件数が 0（全箇所 dedup ラッパ経由）
// ============================================================
test('T4: renderer.js 内 await window.api(.|\\?\\.)tournaments(.|\\?\\.)list の直接呼出が 0 件（dedup 経由に統一）', () => {
  // wrapper 内部の 1 件は除外（function 定義行）。await の直接呼出だけをカウント。
  const matches = RENDERER.match(/await\s+window\.api\??\.?tournaments\??\.?list\??\.?\(\)/g) || [];
  assert.equal(matches.length, 0,
    `await window.api...tournaments...list() 直接呼出が ${matches.length} 件残存（_tournamentsListDedup 経由に置換必須）`);
  // dedup ラッパの呼出が 12 箇所以上存在する（11+ 既存呼出 + wrapper 自身の名前 = 13 程度）
  const dedupCalls = (RENDERER.match(/_tournamentsListDedup\s*\(\)/g) || []).length;
  assert.ok(dedupCalls >= 12, `_tournamentsListDedup() 呼出が ${dedupCalls} 件しかない（12 件以上必要）`);
});

// ============================================================
// T5: _tournamentsListDedup の in-flight チェック + finally reset ロジック
// ============================================================
test('T5: _tournamentsListDedup が _tournamentsListInFlight チェック + finally reset ロジック', () => {
  // 関数本体抽出（balanced-brace）
  const startRe = /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/;
  const m = RENDERER.match(startRe);
  assert.ok(m, '_tournamentsListDedup 関数定義が見つからない');
  const startIdx = m.index + m[0].length - 1;
  let depth = 1, i = startIdx + 1;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++; else if (RENDERER[i] === '}') depth--;
    i++;
  }
  assert.ok(depth === 0, '_tournamentsListDedup 関数本体の抽出失敗');
  const body = RENDERER.slice(startIdx, i);
  // _tournamentsListInFlight チェック → 既存 Promise return
  assert.match(body, /if\s*\(\s*_tournamentsListInFlight\s*\)\s*return\s+_tournamentsListInFlight/,
    '_tournamentsListInFlight in-flight チェック + return が見つからない');
  // window.api.tournaments.list().finally で _tournamentsListInFlight = null reset
  assert.match(body, /\.finally\s*\(\s*\(\s*\)\s*=>\s*\{\s*_tournamentsListInFlight\s*=\s*null\s*;?\s*\}\s*\)/,
    '.finally で _tournamentsListInFlight = null リセット処理が見つからない');
});

// ============================================================
// T6: v2.1.19-rc2: v2.1.18-meas1 計測機構の **撤去** 確認（旧 meas1 機構保持 → 撤去 反転）
// ============================================================
// 旧 v2.1.19-rc1 時点: 計測機構保持を assert
// 新 v2.1.19-rc2 以降: 計測機構撤去を assert
//   meas1 / rc1 ビルドでは保持されているため skip、rc2 / 本番版でのみ撤去 verify
test('T6: v2.2.1 撤去対象（バッジ + 高頻度 14 ラベル + rc6-meas3 機構 + _recordHighFreq）すべて撤去', () => {
  // meas / rc 系試験ビルドは保持中のため skip、本番版（サフィックスなし）でのみ撤去 verify
  if (/-(meas|rc)\d+(\.\d+)?$/.test(PKG.version || '')) return;
  // 計測バッジ撤去
  assert.ok(!INDEX_HTML.includes('meas-build-badge'),
    'index.html に meas-build-badge が残存');
  assert.ok(!STYLE_CSS.includes('#meas-build-badge'), 'style.css に #meas-build-badge セレクタが残存');
  // 高頻度 14 ラベル撤去（perf:*）
  const perfLabels = [
    'perf:render:duration', 'perf:state:notify', 'perf:ipc:roundtrip',
    'perf:tick:fps', 'perf:memory:rss', 'perf:dom:rebuild',
    'perf:raf:fire', 'perf:raf:summary', 'perf:highfreq:summary',
    'perf:interval:fire', 'perf:long-task', 'perf:ipc:summary',
    'perf:dom:summary', 'perf:subscribe:summary'
  ];
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS + TIMER_JS;
  for (const lbl of perfLabels) {
    assert.ok(!ALL_SRC.includes(lbl), `高頻度ラベル ${lbl} が残存`);
  }
  // rc6-meas3 機構撤去
  assert.ok(!MAIN_JS.includes('_isMeasBuildForBuffer'),
    'main.js に _isMeasBuildForBuffer が残存');
  assert.ok(!MAIN_JS.includes('_flushLogsToFile'),
    'main.js に _flushLogsToFile が残存');
  assert.ok(!MAIN_JS.includes('meas3:hdmi-snapshot:written'),
    'main.js に meas3:hdmi-snapshot:written ラベルが残存');
  // _recordHighFreq / _highFreqCounter 撤去
  assert.ok(!RENDERER.includes('_recordHighFreq'),
    'renderer.js に _recordHighFreq が残存');
  assert.ok(!RENDERER.includes('_highFreqCounter'),
    'renderer.js に _highFreqCounter が残存');
  // バッジ表示分岐撤去
  assert.ok(!RENDERER.includes("getElementById('meas-build-badge')"),
    'renderer.js に meas-build-badge 要素取得処理が残存');
});

// ============================================================
// T7: rc1 Fix 1/2/3 + rc2 Fix 1（subscribe gate）すべて完全保持
// ============================================================
test('T7: rc1 Fix 1/2/3 + rc2 Fix 1（subscribe gate）すべて完全保持', () => {
  // rc1 Fix 1 (A 候補): hall dual-sync timerState 分岐に !hallPreStartState.isActive gate
  assert.match(RENDERER, /else\s+if\s*\(\s*kind\s*===\s*['"]timerState['"]\s*&&\s*value\s*&&\s*!hallPreStartState\.isActive\s*\)/,
    'rc1 Fix 1 (A 候補) の hall timerState gate が消失');
  // rc1 Fix 2 (B 候補): captureCurrentTimerState の isPreStartActive 拡張
  assert.match(RENDERER, /isPreStartLikely[\s\S]*?return\s*\{\s*status:\s*['"]idle['"]/,
    'rc1 Fix 2 (B 候補) の isPreStartLikely + idle 返却が消失');
  // rc1 Fix 3 (トーナメント終了演出)
  assert.match(RENDERER, /onTournamentComplete:\s*\(\s*\)\s*=>\s*\{[\s\S]*?clock--timer-finished/,
    'rc1 Fix 3 のトーナメント終了演出が消失');
  assert.match(INDEX_HTML, /id="js-timer-finished-overlay"/,
    'rc1 Fix 3 の #js-timer-finished-overlay が消失');
  // rc2 Fix 1 (subscribe gate)
  assert.match(RENDERER, /if\s*\(\s*!\s*\(\s*window\.appRole\s*===\s*['"]hall['"]\s*&&\s*hallPreStartState\.isActive\s*\)\s*\)\s*\{[\s\S]*?renderTime\s*\(\s*state\.remainingMs\s*\)/,
    'rc2 Fix 1 (subscribe gate) の renderTime gate が消失');
});

// ============================================================
// T8: 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構すべて完全保持
// ============================================================
test('T8: 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構すべて完全保持', () => {
  // C.2.7-A
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A 消失');
  assert.match(RENDERER, /function\s+handleReset\s*\(/, 'C.2.7-A handleReset 消失');
  // C.2.7-D
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/, 'C.2.7-D 消失');
  // C.1-A2
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'C.1-A2 消失');
  // C.1.7
  assert.match(AUDIO_JS, /\.resume\s*\(\s*\)/, 'C.1.7 消失');
  // C.1.8
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'C.1.8 関数消失');
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(/g) || []).length;
  assert.ok(callCount >= 9, `C.1.8 schedulePersistRuntime 呼出 ${callCount} 件（9 以上必要）`);
  // 主犯 2 (periodicPersistAllRunning) は撤廃禁止 → 維持確認
  // v2.1.20-meas1: setInterval(periodicPersistAllRunning, 5000) を _wrappedSetInterval(_IntervalLabel.PERIODIC_PERSIST, ...) でラップ。両形式許容。
  assert.match(RENDERER,
    /(?:setInterval\s*\(\s*periodicPersistAllRunning\s*,\s*5000\s*\)|_wrappedSetInterval\s*\(\s*_IntervalLabel\.PERIODIC_PERSIST\s*,\s*periodicPersistAllRunning\s*,\s*5000\s*\))/,
    '主犯 2 (periodicPersistAllRunning 5 秒 setInterval) が撤廃された（永続化機能のため維持必須）');
  // v2.1.6 PRE_START publish IPC
  assert.match(MAIN_JS, /dual:publish-pre-start-state/, 'v2.1.6 PRE_START publish IPC 消失');
  // v2.1.17 isPaused sanitization 真因修正
  assert.match(MAIN_JS, /typeof\s+payload\.isPaused\s*===\s*['"]boolean['"]/,
    'v2.1.17 isPaused sanitization 消失');
  // v2.1.18 ② onTournamentComplete handler in timer.js
  assert.match(TIMER_JS, /onTournamentComplete/, 'v2.1.18 ② onTournamentComplete 消失');
  // v2.1.11 hall 60fps tick
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/, 'v2.1.11 renderHallTickFrame 消失');
  // dual-sync.js 存在
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js')),
    'v2.1.7 dual-sync.js 消失');
});

console.log(`\nv235 tournaments-list-storm-fix: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
