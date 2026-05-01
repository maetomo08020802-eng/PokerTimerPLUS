/**
 * v2.0.4-rc5 — ミュート視覚フィードバック + M/H フォワード追加 + テロップ表記の静的解析テスト
 *
 * 対象修正:
 *   - FORWARD_KEYS_FROM_HALL に KeyM, KeyH 追加（前原さん判断、便利機能の対称性）
 *   - .mute-indicator 要素 + CSS（全 role 適用、ただし operator は CSS で打ち消し → 運用情報「音」で代替）
 *   - updateMuteIndicator 関数（M キー押下 hook + 起動時呼出）
 *   - operator-pane に「音」項目（id=op-pane-mute-status）追加、updateOperatorPane で audioIsMuted 反映
 *   - 「マーキー」→「テロップ」UI 表記統一（コード内部 marquee* 変数名は維持）
 *
 * 実行: node tests/v204-rc5-mute-indicator.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionBody(source, signaturePattern) {
  const m = source.match(signaturePattern);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(m.index, i);
}

// ============================================================
// A-1: KeyM / KeyH を FORWARD_KEYS_FROM_HALL に追加
// ============================================================
test('A-1: FORWARD_KEYS_FROM_HALL に KeyM / KeyH が追加された', () => {
  const m = MAIN.match(/const\s+FORWARD_KEYS_FROM_HALL\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'FORWARD_KEYS_FROM_HALL 定義が見つからない');
  const items = m[1];
  assert.match(items, /['"]KeyM['"]/, 'KeyM が forward 対象になっていない（rc5 で追加すべき）');
  assert.match(items, /['"]KeyH['"]/, 'KeyH が forward 対象になっていない（rc5 で前回判断撤回、追加すべき）');
});

// ============================================================
// A-6: ミュート視覚フィードバック
// ============================================================
test('A-6 HTML: <div class="mute-indicator" id="js-mute-indicator" hidden> が存在', () => {
  assert.match(HTML,
    /<div[^>]*class="mute-indicator"[^>]*id="js-mute-indicator"[^>]*hidden/,
    'ミュートインジケータ要素なし');
  assert.match(HTML, /🔇\s*ミュート中/,
    'ミュートインジケータのテキスト「🔇 ミュート中」なし');
});

test('A-6 CSS: .mute-indicator が position: fixed; z-index 95 で右下配置', () => {
  // .mute-indicator { ... position: fixed; bottom: 16px; right: 16px; }
  assert.match(STYLE,
    /\.mute-indicator\s*\{[^}]*position\s*:\s*fixed/,
    '.mute-indicator に position: fixed なし');
  assert.match(STYLE,
    /\.mute-indicator\s*\{[^}]*bottom\s*:\s*16px[^}]*right\s*:\s*16px/,
    '.mute-indicator に bottom/right 16px の右下配置なし');
});

test('A-6 CSS: operator role では .mute-indicator が打ち消される（運用情報で代替）', () => {
  assert.match(STYLE,
    /\[data-role="operator"\]\s+\.mute-indicator\s*\{[^}]*display\s*:\s*none/,
    '[data-role="operator"] .mute-indicator { display: none } なし（AC では運用情報で代替する設計）');
});

test('A-6 CSS: hall / operator-solo に .mute-indicator 打ち消しがない（v1.3.0 互換例外、便利機能適用）', () => {
  assert.doesNotMatch(STYLE,
    /\[data-role="hall"\]\s+\.mute-indicator\s*\{[^}]*display\s*:\s*none/,
    'hall に .mute-indicator 打ち消しが混入');
  assert.doesNotMatch(STYLE,
    /\[data-role="operator-solo"\]\s+\.mute-indicator\s*\{[^}]*display\s*:\s*none/,
    'operator-solo に .mute-indicator 打ち消しが混入（rc5 で全 role 適用方針違反）');
});

test('A-6 JS: updateMuteIndicator 関数が定義され、audioIsMuted を読む', () => {
  const body = extractFunctionBody(RENDERER, /function\s+updateMuteIndicator\s*\(\s*\)\s*\{/);
  assert.ok(body, 'updateMuteIndicator 関数定義なし');
  assert.match(body, /audioIsMuted\s*\(\s*\)/, 'updateMuteIndicator が audioIsMuted() を読んでいない');
  assert.match(body, /js-mute-indicator/, 'updateMuteIndicator が #js-mute-indicator を参照していない');
});

test('A-6 JS: KeyM 押下時の dispatcher で updateMuteIndicator が呼ばれる', () => {
  // dispatchClockShortcut 内の case 'KeyM' ブロックで updateMuteIndicator() がある
  const body = extractFunctionBody(RENDERER, /function\s+dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない');
  // case 'KeyM' から次の case までを抽出
  const km = body.match(/case\s+['"]KeyM['"][\s\S]*?break\s*;/);
  assert.ok(km, "case 'KeyM' ブロック抽出失敗");
  assert.match(km[0], /updateMuteIndicator\s*\(/,
    'case KeyM のブロックで updateMuteIndicator 呼出なし（M 押下後に視覚反映されない）');
});

test('A-6 JS: 起動時に updateMuteIndicator が呼ばれる（initialize 末尾）', () => {
  const body = extractFunctionBody(RENDERER, /async function initialize\s*\(\s*\)\s*\{/);
  assert.ok(body, 'initialize が見つからない');
  assert.match(body, /updateMuteIndicator\s*\(\s*\)/,
    'initialize に updateMuteIndicator 呼出なし（起動時の初期反映が無い）');
});

// ============================================================
// A-6-4: operator-pane の「音」項目
// ============================================================
test('A-6-4 HTML: operator-pane に dd id="op-pane-mute-status" がある', () => {
  assert.match(HTML, /id="op-pane-mute-status"/,
    'operator-pane に「音」表示用 dd (id=op-pane-mute-status) なし');
});

test('A-6-4 JS: updateOperatorPane が op-pane-mute-status に audioIsMuted を反映', () => {
  const body = extractFunctionBody(RENDERER, /function\s+updateOperatorPane\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'updateOperatorPane が見つからない');
  assert.match(body, /op-pane-mute-status/,
    'updateOperatorPane が op-pane-mute-status を参照していない');
  assert.match(body, /audioIsMuted/,
    'updateOperatorPane が audioIsMuted を読んでいない');
  // 「ミュート中」「通常」の日本語表記
  assert.match(body, /['"`]ミュート中['"`]/, 'updateOperatorPane に「ミュート中」表記なし');
  assert.match(body, /['"`]通常['"`]/, 'updateOperatorPane に「通常」表記なし');
});

test('A-6-4 CSS: op-pane-mute-status[data-muted="true"] でミュート中の赤系強調', () => {
  assert.match(STYLE,
    /op-pane-mute-status\[data-muted="true"\]\s*\{[^}]*color/,
    '#op-pane-mute-status[data-muted="true"] でミュート時の color 強調がない');
});

// ============================================================
// A-2 / A-3: F2 削除 / F12 操作一覧から削除
// ============================================================
test('A-2: operator-pane 操作一覧から F2 が削除されている', () => {
  const paneMatch = HTML.match(/<section[^>]*operator-pane[\s\S]*?<\/section>/);
  assert.ok(paneMatch, 'operator-pane セクションなし');
  assert.doesNotMatch(paneMatch[0], /<kbd>F2<\/kbd>/,
    'operator-pane に F2 行が残存（rc5 で削除予定）');
});

test('A-3: operator-pane 操作一覧から F12 が削除されている（コード自体は維持）', () => {
  const paneMatch = HTML.match(/<section[^>]*operator-pane[\s\S]*?<\/section>/);
  assert.ok(paneMatch, 'operator-pane セクションなし');
  assert.doesNotMatch(paneMatch[0], /<kbd>F12<\/kbd>/,
    'operator-pane に F12 行が残存（rc5 で削除、specs §7 と main.js コードは維持）');
  // 一方 main.js では F12 globalShortcut は維持
  assert.match(MAIN, /globalShortcut\.register\(\s*['"]F12['"]/,
    'main.js の F12 globalShortcut 登録が消失（コード自体は維持すべき）');
});

// ============================================================
// A-4: マーキー→テロップ UI 表記統一（コード内部 marquee* は維持）
// ============================================================
test('A-4 HTML: operator-pane の操作一覧で「テロップ編集」表記', () => {
  const paneMatch = HTML.match(/<section[^>]*operator-pane[\s\S]*?<\/section>/);
  assert.ok(paneMatch, 'operator-pane セクションなし');
  assert.match(paneMatch[0], /<kbd>Ctrl<\/kbd>\+<kbd>T<\/kbd>\s*テロップ編集/,
    'operator-pane の Ctrl+T 行が「テロップ編集」になっていない');
  assert.doesNotMatch(paneMatch[0], /マーキー/,
    'operator-pane に「マーキー」表記残存（rc5 でテロップに統一）');
});

test('A-4 コード内部の marquee* 変数名は維持（リスク回避）', () => {
  // marqueeDialog / openMarqueeDialog / readMarqueeTabForm 等の識別子は触らない
  assert.match(RENDERER, /marqueeDialog/,
    'marqueeDialog 識別子が消失（コード内部変数名は維持すべき）');
  assert.match(RENDERER, /openMarqueeDialog/,
    'openMarqueeDialog 識別子が消失（コード内部変数名は維持すべき）');
});

// ============================================================
// A-5: 操作一覧 5 カテゴリ
// ============================================================
test('A-5: 操作一覧が 5 カテゴリの shortcut-section に分割されている', () => {
  const paneMatch = HTML.match(/<section[^>]*operator-pane[\s\S]*?<\/section>/);
  assert.ok(paneMatch, 'operator-pane セクションなし');
  const sections = paneMatch[0].match(/<div[^>]*class="shortcut-section"/g) || [];
  assert.equal(sections.length, 5,
    `shortcut-section の数が ${sections.length}（5 カテゴリ必須）`);
});

// ============================================================
// 致命バグ保護 cross-check
// ============================================================
test('致命バグ保護: dispatchClockShortcut の KeyM / KeyH case が引き続き動作', () => {
  const body = extractFunctionBody(RENDERER, /function\s+dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない');
  assert.match(body, /case\s+['"]KeyM['"][\s\S]*?audioToggleMute/,
    'KeyM の audioToggleMute 呼出が消失');
  assert.match(body, /case\s+['"]KeyH['"][\s\S]*?toggleBottomBar/,
    'KeyH の toggleBottomBar 呼出が消失');
});

test('致命バグ保護: schedulePersistRuntime / runtime 永続化フックが維持（C.1.8）', () => {
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'schedulePersistRuntime 関数なし');
  // 8 箇所以上のフック呼出（rc1 で確立した不変条件）
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(callCount >= 6,
    `schedulePersistRuntime 呼出が ${callCount} 箇所（6 以上必要、C.1.8 不変条件）`);
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
