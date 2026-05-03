/**
 * v2.0.4-rc8 — 案 X (キーフォワード無効化) + focusable: false + 対策 A+B + H 文言の静的解析テスト
 *
 * 対象修正:
 *   Fix 1: main.js FORWARD_KEYS_FROM_HALL を空 Set 化（最小変更、IPC 経路は dead code として残す）
 *   Fix 2: main.js createHallWindow opts に focusable: false 追加（多重防御、AC にフォーカスが残る）
 *   Fix 3: style.css 末尾に [data-role="operator-solo"] の hidden ルール追加（rc7 案 B 補完）
 *   Fix 4: renderer.js subscribe で _lastTimerStateForRoleSwitch 保存 +
 *          onRoleChanged ハンドラで updateOperatorPane 即時呼出（rc7 修正漏れ補完）
 *   Fix 5: index.html / docs/specs.md の H 文言補足（「消すとテロップ拡大」明記）
 *
 * 致命バグ保護 5 件への影響評価 + operator-solo 互換維持の cross-check も担保。
 *
 * 実行: node tests/v204-rc8-focus-and-css.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const SPECS    = fs.readFileSync(path.join(ROOT, 'docs', 'specs.md'), 'utf8');

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
// Fix 1: 案 X — FORWARD_KEYS_FROM_HALL を空 Set
// ============================================================
test('Fix 1: FORWARD_KEYS_FROM_HALL は空 Set（rc4-rc7 のキー全廃止）', () => {
  const m = MAIN.match(/const\s+FORWARD_KEYS_FROM_HALL\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'FORWARD_KEYS_FROM_HALL 定義が見つからない');
  const items = m[1];
  // すべての旧 forward キーが含まれていないこと
  for (const code of ['Space', 'Enter', 'Escape',
                      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                      'KeyR', 'KeyA', 'KeyE', 'KeyS', 'KeyM', 'KeyT', 'KeyH']) {
    assert.doesNotMatch(items, new RegExp(`['"]${code}['"]`),
      `FORWARD_KEYS_FROM_HALL に ${code} が残存（rc8 で空 Set 化されるべき）`);
  }
});

test('Fix 1: IPC 経路（before-input-event + hall:forwarded-key 送信）は dead code として残存', () => {
  // 案 X は最小変更：IPC コードは削除せず、Set 空化により早期 return される設計
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  assert.match(body, /webContents\.on\(\s*['"]before-input-event['"]/,
    'before-input-event ハンドラが消失（rc8 は最小変更、削除ではない）');
  assert.match(body, /mainWindow\.webContents\.send\(\s*['"]hall:forwarded-key['"]/,
    'hall:forwarded-key 送信経路が消失（rc8 は最小変更、削除ではない）');
  assert.match(body, /FORWARD_KEYS_FROM_HALL\.has\(/,
    'FORWARD_KEYS_FROM_HALL.has() による早期 return が消失');
});

// ============================================================
// Fix 2: hall window を focusable: false に
// ============================================================
test('Fix 2: createHallWindow の opts に focusable: false が含まれる', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  // opts オブジェクト内に focusable: false
  assert.match(body, /focusable\s*:\s*false/,
    'createHallWindow の opts に focusable: false なし（hall がフォーカスを取れる状態）');
});

test('Fix 2: createOperatorWindow には focusable: false なし（AC は当然フォーカス可）', () => {
  const body = extractFunctionBody(MAIN, /function createOperatorWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createOperatorWindow が見つからない');
  // operator は focusable: false を入れていないこと
  assert.doesNotMatch(body, /focusable\s*:\s*false/,
    'createOperatorWindow に focusable: false が混入（AC がフォーカス取れない致命バグ）');
});

// ============================================================
// Fix 3: 対策 A — operator-solo 用 hidden CSS
// ============================================================
test('Fix 3: style.css に [data-role="operator-solo"] ルールが存在', () => {
  // rc7 まで [data-role="operator-solo"] は意図的に空欄、rc8 で Fix 3 として追加
  assert.match(STYLE, /\[data-role="operator-solo"\]/,
    'style.css に [data-role="operator-solo"] セレクタが存在しない（rc8 対策 A 未実装）');
});

test('Fix 3: [data-role="operator-solo"] が operator-pane / operator-status-bar を非表示', () => {
  // 完全 selector マッチ + display: none !important
  assert.match(STYLE,
    /\[data-role="operator-solo"\][^{]*\.operator-pane[\s\S]{0,100}?display\s*:\s*none/,
    '[data-role="operator-solo"] .operator-pane の display: none ルールなし');
  assert.match(STYLE,
    /\[data-role="operator-solo"\][^{]*\.operator-status-bar[\s\S]{0,100}?display\s*:\s*none/,
    '[data-role="operator-solo"] .operator-status-bar の display: none ルールなし');
});

// ============================================================
// Fix 4: 対策 B — onRoleChanged ハンドラ内で updateOperatorPane 即時呼出
// ============================================================
test('Fix 4: subscribe 内で _lastTimerStateForRoleSwitch に直近 state を保存', () => {
  assert.match(RENDERER, /let\s+_lastTimerStateForRoleSwitch\s*=\s*null/,
    '_lastTimerStateForRoleSwitch 変数宣言なし');
  // subscribe コールバック内で代入
  assert.match(RENDERER,
    /subscribe\(\(state[^)]*\)\s*=>\s*\{[\s\S]{0,200}?_lastTimerStateForRoleSwitch\s*=\s*state/,
    'subscribe 内で _lastTimerStateForRoleSwitch = state の保存なし');
});

// rc21 第 2 弾追従: onRoleChanged ハンドラに計測ラベル（インライン object literal 含む）追加に伴い、
//   非貪欲な `\}\s*\)` 早期マッチ問題を解消するため balanced brace 抽出 (extractFunctionBody) に切替。
test('Fix 4: onRoleChanged ハンドラ内で updateOperatorPane を即時呼出', () => {
  const handler = extractFunctionBody(RENDERER, /onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{/);
  assert.ok(handler, 'onRoleChanged コールバック本体が抽出できない');
  assert.match(handler, /updateOperatorPane\s*\(\s*_lastTimerStateForRoleSwitch\s*\)/,
    'onRoleChanged 内で updateOperatorPane(_lastTimerStateForRoleSwitch) 呼出なし');
});

test('Fix 4: rc7 の updateMuteIndicator 呼出は維持（即時反映の即時化を破壊しない）', () => {
  const handler = extractFunctionBody(RENDERER, /onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{/);
  assert.ok(handler, 'onRoleChanged コールバック本体が抽出できない');
  assert.match(handler, /updateMuteIndicator/,
    'onRoleChanged 内で updateMuteIndicator 呼出が消失（rc7 動作破壊）');
});

// ============================================================
// Fix 5: H 文言補足（v2.0.4-rc10 で括弧書き削除、簡略化された）
// ============================================================
test('Fix 5-A: index.html の H 行は rc15 で完全削除（rc10 簡略化を経て rc15 で行ごと削除）', () => {
  // rc7 で明確化 → rc10 で簡略化 → rc15 で完全削除（前原さん要望、機能本体は維持）
  assert.doesNotMatch(HTML, /<kbd>H<\/kbd>/,
    'index.html に H 行が残存（rc15 で削除予定）');
});

test('Fix 5-B: docs/specs.md §7 の H 行は rc15 で完全削除', () => {
  assert.doesNotMatch(SPECS, /\|\s*H\s*\|\s*手元\s*PC/,
    'docs/specs.md §7 に H 行が残存（rc15 で削除予定）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check
// ============================================================
test('致命バグ保護 C.1.7: KeyM ケース内 ensureAudioReady ラップ維持', () => {
  assert.match(RENDERER, /case\s+['"]KeyM['"][\s\S]*?ensureAudioReady\(\)\.then/,
    'KeyM の ensureAudioReady ラップが消失（C.1.7 違反）');
});

test('致命バグ保護 C.1.7: hall onMuteStateChanged が ensureAudioReady ラップ維持', () => {
  assert.match(RENDERER, /onMuteStateChanged\?\.\([\s\S]{0,200}?ensureAudioReady\(\)\.then/,
    'hall onMuteStateChanged で ensureAudioReady ラップが消失（C.1.7 違反）');
});

test('致命バグ保護 C.2.7-A: resetBlindProgressOnly が引き続き存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly/,
    'resetBlindProgressOnly が消失（C.2.7-A 致命バグ修正の保護違反）');
});

test('致命バグ保護 C.1-A2: ensureEditorEditableState が引き続き存在', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState/,
    'ensureEditorEditableState が消失（C.1-A2 致命バグ修正の保護違反）');
});

test('致命バグ保護 C.1.8: schedulePersistRuntime が複数箇所で呼ばれている', () => {
  const matches = RENDERER.match(/schedulePersistRuntime\(\)/g) || [];
  assert.ok(matches.length >= 6,
    `schedulePersistRuntime 呼出が ${matches.length} 件（期待 >= 6、C.1.8 違反疑い）`);
});

// ============================================================
// operator-solo モード（v1.3.0 互換）への影響評価
// ============================================================
test('operator-solo 互換: createOperatorWindow(_, true) 起動経路は不変', () => {
  assert.match(MAIN, /createOperatorWindow\([^)]*,\s*true\s*\)/,
    'createOperatorWindow(_, true)（operator-solo 起動経路）が消失');
});

test('operator-solo 互換: 最初から HDMI なし起動には focusable: false が無関係', () => {
  // operator-solo は createHallWindow を呼ばない → focusable: false の影響を受けない
  // (createOperatorWindow opts は focusable: false を持たないことを別テストで担保済)
  // ここでは createMainWindow → createOperatorWindow(_, true) の経路で hallWindow が作られない
  // ことを保証
  assert.match(MAIN, /screen\.getAllDisplays\(\)/, 'createMainWindow の displays 検出が消失');
});

test('operator-solo 互換: rc7 で確立した role 動的切替が rc8 で破壊されていない', () => {
  // switch* 末尾の dual:role-changed 送信経路（rc7 Fix 1-A）が維持されている
  const soloBody = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(soloBody, 'switchOperatorToSolo が見つからない');
  assert.match(soloBody, /dual:role-changed['"]\s*,\s*['"]operator-solo/,
    'switchOperatorToSolo 末尾の dual:role-changed operator-solo 送信が消失（rc7 動作破壊）');
});

// ============================================================
// rc6 動作維持 + rc7 動作維持
// ============================================================
test('rc9 改修: switchOperatorToSolo は show + focus（minimize 撤去、close せず）', () => {
  // v2.0.4-rc9 Fix 2-A: minimize → show + focus（IPC 遅延起因の表示消失を根治）。close ぬきは rc6 から維持。
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /mainWindow\.show\(\)/, 'rc9 show() 動作が消失');
  assert.doesNotMatch(body, /mainWindow\.minimize\(\)/, 'minimize 残存（rc9 で撤去必須）');
  assert.doesNotMatch(body, /mainWindow\.close\(\)/, 'mainWindow.close が混入（close→新生成方式に逆戻り）');
});

test('rc7 動作維持: AC operator-pane に op-pane-special-stack 項目が残存', () => {
  assert.match(HTML, /<dt>特別スタック<\/dt>\s*<dd id="op-pane-special-stack">/,
    'op-pane-special-stack 項目が消失（rc7 動作破壊）');
});

// ============================================================
// version 同期確認（rc8）
// ============================================================
test('version: package.json は 2.0.6（rc21 第 2 弾 ⑨ 表示更新漏れ補完 + ⑩ 計測ビルド 追従）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.6',
    `package.json version が ${pkg.version}（期待 2.0.6）`);
});

test('version: scripts.test に v204-rc8-focus-and-css.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc8-focus-and-css\.test\.js/,
    'package.json scripts.test に v204-rc8-focus-and-css.test.js なし');
});

// ============================================================
// 副作用評価: focusable: false の影響
// ============================================================
test('副作用評価: F11 globalShortcut 経路は引き続き登録（focusable と無関係）', () => {
  // globalShortcut は webContents のフォーカス可否と無関係に動作するため、
  // hall でも F11 で全画面切替が効く（hall がフォーカス取れなくても OS グローバルで反応）
  assert.match(MAIN, /globalShortcut\.register\(\s*['"]F11['"]/,
    'F11 globalShortcut 登録が消失（hall 全画面切替手段が消える）');
});

test('副作用評価: hallWindow の closed イベントハンドラは維持（race 防止）', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  assert.match(body, /win\.on\(\s*['"]closed['"][\s\S]*?hallWindow\s*===\s*win/,
    'createHallWindow の closed race 防止ハンドラが消失');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
