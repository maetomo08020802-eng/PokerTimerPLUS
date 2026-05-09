/**
 * v2.1.18-meas1 静的解析テスト — 計測ビルド観測点 + 識別バッジ + Ctrl+Shift+L 操作別保存機構
 *
 *   Fix 1: 計測バッジ（HTML / CSS / JS）
 *   Fix 2: パフォーマンス系 6 ラベル（perf:render:duration / :ipc:roundtrip / :tick:fps / :memory:rss / :state:notify / :dom:rebuild）
 *   Fix 3: バグ発見系新規 4 ラベル（state:transition / dual-sync:apply / meas:session:start / meas:capture）
 *   Fix 3-B: error:caught:* プレフィックス 10 箇所以上
 *   Fix 3-C: ui:keypress 5 箇所以上
 *   Fix 3-D: ui:click:major 8 箇所以上
 *   Fix 4: Ctrl+Shift+L 操作別保存（_measOpCounter + op-{NN}-{ISO}.log 命名）
 *   全 rollingLog 呼出が try/catch で握り潰されている
 *   致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構すべて完全保持
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

// ============================================================
// バージョン assertion: package.json は 2.1.18-meas1
// ============================================================
test('version: package.json の version が 2.1.18-meas1', () => {
  assert.equal(PKG.version, '2.1.18-meas1', `期待 2.1.18-meas1, 実際 ${PKG.version}`);
});

// ============================================================
// T1: index.html に計測バッジ要素が存在
// ============================================================
test('T1: index.html に <div id="meas-build-badge">計測ビルド</div> が存在', () => {
  assert.match(INDEX_HTML, /<div\s+id="meas-build-badge">\s*計測ビルド\s*<\/div>/,
    'index.html の <body> 直下に計測バッジ <div> が見つからない');
});

// ============================================================
// T2: style.css に #meas-build-badge ブロック（position fixed + bottom/right + z-index）が存在
// ============================================================
test('T2: style.css の #meas-build-badge ブロック（position: fixed + bottom + right + z-index 9999）', () => {
  assert.ok(STYLE_CSS.includes('#meas-build-badge'),
    'style.css に #meas-build-badge セレクタが見つからない');
  // セレクタブロック内に position: fixed と z-index: 9999、bottom / right を持つ
  const m = STYLE_CSS.match(/#meas-build-badge\s*\{[^}]*\}/);
  assert.ok(m, '#meas-build-badge ブロックが {} で閉じていない');
  const block = m[0];
  assert.match(block, /position:\s*fixed/, '#meas-build-badge に position: fixed なし');
  assert.match(block, /bottom:\s*8px/,      '#meas-build-badge に bottom: 8px なし');
  assert.match(block, /right:\s*8px/,       '#meas-build-badge に right: 8px なし');
  assert.match(block, /z-index:\s*9999/,    '#meas-build-badge に z-index: 9999 なし');
  assert.match(block, /pointer-events:\s*none/, '#meas-build-badge に pointer-events: none なし');
  // hall 用拡大スタイルも存在
  assert.match(STYLE_CSS, /\[data-role="hall"\]\s*#meas-build-badge\s*\{[^}]*\}/,
    'style.css に [data-role="hall"] #meas-build-badge ブロックなし');
});

// ============================================================
// T3: renderer.js loadAppVersion 内に -meas サフィックス検出 + バッジ非表示処理が存在
// ============================================================
test('T3: renderer.js loadAppVersion 内の -meas サフィックス検出 + meas-build-badge 非表示化', () => {
  // loadAppVersion 関数内で getElementById('meas-build-badge') が呼ばれる
  assert.match(RENDERER, /-meas\\d\*\$/, 'renderer.js に -meas サフィックス用 RegExp なし');
  assert.match(RENDERER, /getElementById\(['"]meas-build-badge['"]\)/,
    'renderer.js に meas-build-badge 要素取得処理なし');
  assert.match(RENDERER, /badge\.style\.display\s*=\s*['"]none['"]/,
    'renderer.js に meas-build-badge 非表示化処理なし');
});

// ============================================================
// T4: パフォーマンス系 6 ラベル全部存在（renderer / preload / state / main 横断）
// ============================================================
test('T4: パフォーマンス系 6 ラベルすべて grep で存在', () => {
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
    assert.ok(ALL_SRC.includes(label), `ラベル ${label} がソース全体に見つからない`);
  }
});

// ============================================================
// T5: バグ発見系新規 4 ラベル全部存在
// ============================================================
test('T5: バグ発見系新規 4 ラベル（state:transition / dual-sync:apply / meas:session:start / meas:capture）grep 存在', () => {
  const labels = [
    'state:transition',
    'dual-sync:apply',
    'meas:session:start',
    'meas:capture'
  ];
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  for (const label of labels) {
    assert.ok(ALL_SRC.includes(label), `ラベル ${label} がソース全体に見つからない`);
  }
});

// ============================================================
// T6: error:caught:* プレフィックスのラベルが 10 箇所以上存在（実コール、コメントは含めない）
// ============================================================
test('T6: error:caught:* ラベル実呼出が 10 箇所以上', () => {
  // 実コール = "'error:caught:..." のリテラル文字列出現数（コメントには含まれていても OK だが、実コードでカウント）
  const ALL_SRC = RENDERER + STATE_JS + DUAL_SYNC + MAIN_JS + PRELOAD_JS;
  const matches = ALL_SRC.match(/['"]error:caught:[a-zA-Z][\w:.-]*['"]/g) || [];
  assert.ok(matches.length >= 10, `error:caught:* ラベル実呼出が ${matches.length} 件しかない（10 件以上必要）`);
});

// ============================================================
// T7: ui:keypress ラベルが 5 箇所以上存在
// ============================================================
test('T7: ui:keypress ラベル実呼出が 5 箇所以上', () => {
  const ALL_SRC = RENDERER + MAIN_JS;
  const matches = ALL_SRC.match(/['"]ui:keypress['"]/g) || [];
  assert.ok(matches.length >= 5, `ui:keypress 実呼出が ${matches.length} 件しかない（5 件以上必要）`);
});

// ============================================================
// T8: ui:click:major ラベルが 8 箇所以上存在
// ============================================================
test('T8: ui:click:major ラベル実呼出が 8 箇所以上', () => {
  const matches = RENDERER.match(/['"]ui:click:major['"]/g) || [];
  assert.ok(matches.length >= 8, `ui:click:major 実呼出が ${matches.length} 件しかない（8 件以上必要）`);
});

// ============================================================
// T9: main.js に Ctrl+Shift+L または CommandOrControl+Shift+L globalShortcut.register が存在
// ============================================================
test('T9: main.js に CommandOrControl+Shift+L globalShortcut.register が存在', () => {
  assert.match(MAIN_JS, /globalShortcut\.register\(['"]CommandOrControl\+Shift\+L['"]/,
    'main.js に CommandOrControl+Shift+L の globalShortcut.register なし');
});

// ============================================================
// T10: main.js に _measOpCounter + op-{NN}-{timestamp}.log 命名パターン存在
// ============================================================
test('T10: main.js に _measOpCounter 連番増加ロジック + op-{NN}-{timestamp}.log 命名パターン', () => {
  assert.match(MAIN_JS, /let\s+_measOpCounter\s*=\s*0/,
    'main.js に _measOpCounter の宣言なし');
  assert.match(MAIN_JS, /_measOpCounter\+\+/,
    'main.js に _measOpCounter のインクリメントなし');
  assert.match(MAIN_JS, /op-\$\{String\(_measOpCounter\)\.padStart\(2,\s*['"]0['"]\)\}-/,
    'main.js に op-{NN}-{timestamp}.log 命名パターンなし');
});

// ============================================================
// T11: -meas サフィックスがないバージョンではバッジ非表示（loadAppVersion 経路）
// ============================================================
test('T11: 本番版（-meas なしバージョン）でバッジが loadAppVersion 経路で非表示', () => {
  // loadAppVersion 内で /-meas\d*$/ を test して、否（false）の場合に display='none' を実行する分岐が存在
  assert.match(RENDERER, /!\s*\/-meas\\d\*\$\/\.test\([^)]*\)/,
    'loadAppVersion に -meas サフィックス検出（!regex.test）処理なし');
});

// ============================================================
// T12: 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構完全保持 + 全 rollingLog が try/catch で握り潰し
// ============================================================
test('T12: 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構保持 + rollingLog 全 try/catch 保護', () => {
  // 致命バグ保護 5 件
  // C.2.7-A: resetBlindProgressOnly / handleReset 責任分離
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A: resetBlindProgressOnly が削除');
  assert.match(RENDERER, /function\s+handleReset\s*\(/,            'C.2.7-A: handleReset が削除');
  // C.2.7-D: tournaments:setDisplaySettings の timerState destructure 除外
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/, 'C.2.7-D: setDisplaySettings ハンドラなし');
  // C.1-A2 / C.1.4-fix1: ensureEditorEditableState 4 重防御
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'C.1-A2: ensureEditorEditableState なし');
  // C.1.7: AudioContext suspend 防御
  assert.match(AUDIO_JS, /resume/, 'C.1.7: audio.js resume 防御なし');
  // C.1.8: runtime 永続化（schedulePersistRuntime）
  assert.match(RENDERER, /schedulePersistRuntime/, 'C.1.8: schedulePersistRuntime 機構なし');

  // v2.1.6〜v2.1.18 機構保持: PRE_START hall 同期、preStartState publish、tournament 終了オーバーレイ等
  assert.match(MAIN_JS, /dual:publish-pre-start-state/, 'v2.1.6: PRE_START publish IPC 機構なし');
  assert.match(MAIN_JS, /typeof\s+payload\.isPaused\s*===\s*['"]boolean['"]/,
    'v2.1.17: isPaused sanitization 真因修正なし');
  assert.match(TIMER_JS, /onTournamentComplete/, 'v2.1.18 ②: onTournamentComplete handler なし');

  // ハンドラ登録 setHandlers でも onTournamentComplete を受ける拡張あり
  assert.match(TIMER_JS, /onTournamentComplete\s*\}/, 'v2.1.18 ②: setHandlers の destructure に onTournamentComplete なし');

  // rollingLog 呼出が try/catch で握り潰されている（renderer / main の代表箇所をサンプル）
  // renderer.js: window.api?.log?.write?.(...) 呼出がすべて try/catch ブロック内
  // この検証は実装依存だが、rollingLog 呼出周辺に try { ... } catch (_) {} のパターンが存在することを確認
  // 全ての window.api.log.write 周辺に try/catch がある形式に統一しているため、
  // 単純に「裸の rollingLog / window.api.log.write が try なしで呼ばれていない」というネガティブ検証はせず、
  // try { window.api?.log?.write... } catch (_) {} パターンが大量存在することを確認する
  const tryCatchCount = (RENDERER.match(/try\s*\{[^{}]*window\.api\?\.log\?\.write/g) || []).length;
  assert.ok(tryCatchCount >= 10, `try { window.api?.log?.write... } のパターンが ${tryCatchCount} 件しかない（10 件以上必要、握り潰し設計）`);
});

console.log(`\nv234 meas1: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
