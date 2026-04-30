/**
 * v2.0.0 STEP 4 — 起動時のモニター選択ダイアログ 静的解析テスト
 *
 * 検証対象:
 *   - src/renderer/display-picker.html 存在 + CSP `script-src 'self'`
 *   - src/renderer/display-picker.js 存在
 *   - main.js に chooseHallDisplayInteractive + display-picker:fetch ハンドラ
 *   - preload.js に dual.fetchDisplays / dual.selectHallMonitor
 *   - 単画面（displays.length < 2）→ chooseHallDisplayInteractive が null 返す
 *   - displayId が null の場合 createOperatorWindow(_, true) のみ呼ばれる
 *   - 選択時のみ store.set('preferredHallDisplayId', ...) が呼ばれる
 *   - display-picker.html に inline script がない（CSP 不変担保）
 *
 * 実行: node tests/v2-display-picker.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PICKER_HTML_PATH = path.join(ROOT, 'src', 'renderer', 'display-picker.html');
const PICKER_JS_PATH   = path.join(ROOT, 'src', 'renderer', 'display-picker.js');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionBody(source, name, isAsync = false) {
  const prefix = isAsync ? 'async\\s+' : '';
  const re = new RegExp(`(?:${prefix})?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = source.match(re);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start + 1, i); }
  }
  return null;
}

// ============================================================
// T1: display-picker.html ファイル存在 + CSP `script-src 'self'`
// ============================================================
test('T1: display-picker.html 存在 + CSP script-src "self"', () => {
  assert.ok(fs.existsSync(PICKER_HTML_PATH), 'display-picker.html ファイルが存在しない');
  const html = fs.readFileSync(PICKER_HTML_PATH, 'utf8');
  assert.match(html, /<meta\s+http-equiv="Content-Security-Policy"[^>]*script-src\s+'self'/,
    'CSP script-src \'self\' なし');
  // role=picker（既存 [data-role] セレクタには影響しない独自 role）
  assert.match(html, /data-role="picker"/, 'data-role="picker" 属性なし');
});

// ============================================================
// T2: display-picker.html に inline script がない（CSP 不変担保）
// ============================================================
test('T2: display-picker.html に inline script がない', () => {
  const html = fs.readFileSync(PICKER_HTML_PATH, 'utf8');
  // <script> タグで src 属性なしのもの（=inline）が無いこと
  // <script src="..."></script> はOK、<script>code...</script> はNG
  const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i;
  assert.doesNotMatch(html, inlineScript, 'inline <script> が存在する（CSP 違反）');
  // 外部 script（display-picker.js）が読み込まれていること
  assert.match(html, /<script\s+src="display-picker\.js"/, '外部 script "display-picker.js" の読込なし');
});

// ============================================================
// T3: display-picker.js 存在 + selectHallMonitor / fetchDisplays 呼出
// ============================================================
test('T3: display-picker.js が selectHallMonitor / fetchDisplays を呼ぶ', () => {
  assert.ok(fs.existsSync(PICKER_JS_PATH), 'display-picker.js ファイルが存在しない');
  const js = fs.readFileSync(PICKER_JS_PATH, 'utf8');
  assert.match(js, /window\.api(?:\?\.|\.)dual[\s\S]*?fetchDisplays\s*\(\s*\)/, 'fetchDisplays 呼出なし');
  assert.match(js, /selectHallMonitor\s*\(/, 'selectHallMonitor 呼出なし');
  // キャンセルで window.close を呼ぶ（main 側で resolve(null) → 単画面モード）
  assert.match(js, /window\.close\s*\(\s*\)/, 'cancel 経路の window.close なし');
});

// ============================================================
// T4: main.js に chooseHallDisplayInteractive 関数 + 単画面 early return
// ============================================================
test('T4: chooseHallDisplayInteractive: displays.length < 2 で null を返す', () => {
  // async 関数として定義されている
  assert.match(MAIN, /async\s+function\s+chooseHallDisplayInteractive\s*\(/,
    'chooseHallDisplayInteractive (async) 関数定義なし');
  const body = extractFunctionBody(MAIN, 'chooseHallDisplayInteractive', true);
  assert.ok(body, '関数本体が抽出できない');
  // displays.length < 2 で null 返却
  assert.match(body, /displays\.length\s*<\s*2[\s\S]*?return\s+null/,
    'displays.length < 2 → return null の early return なし');
  // 前回選択を store.get('preferredHallDisplayId') から取得
  assert.match(body, /store\.get\(\s*['"]preferredHallDisplayId['"]/, '前回選択の取得なし');
});

// ============================================================
// T5: main.js に display-picker:fetch + dual:select-hall-monitor の経路
// ============================================================
test('T5: main.js に display-picker:fetch ハンドラ + dual:select-hall-monitor リスナ', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]display-picker:fetch['"]/,
    'display-picker:fetch ハンドラ登録なし');
  assert.match(MAIN, /ipcMain\.on\(\s*['"]dual:select-hall-monitor['"]/,
    'dual:select-hall-monitor リスナ登録なし（chooseHallDisplayInteractive 内）');
});

// ============================================================
// T6: preload.js に dual.fetchDisplays / dual.selectHallMonitor
// ============================================================
test('T6: preload.js に dual.fetchDisplays (invoke) / dual.selectHallMonitor (send)', () => {
  assert.match(PRELOAD, /fetchDisplays:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]display-picker:fetch['"]/,
    'fetchDisplays が ipcRenderer.invoke に紐付いていない');
  assert.match(PRELOAD, /selectHallMonitor:\s*\([^)]*\)\s*=>\s*ipcRenderer\.send\(\s*['"]dual:select-hall-monitor['"]/,
    'selectHallMonitor が ipcRenderer.send に紐付いていない');
});

// ============================================================
// T7: createMainWindow が hallId === null で単画面モード（operator-solo）に倒す
// ============================================================
test('T7: createMainWindow: hallId == null で createOperatorWindow(_, true) のみ', () => {
  assert.match(MAIN, /async\s+function\s+createMainWindow\s*\(/,
    'createMainWindow が async 化されていない');
  const body = extractFunctionBody(MAIN, 'createMainWindow', true);
  assert.ok(body, 'createMainWindow 関数本体が抽出できない');
  // hallId == null で createOperatorWindow(_, true) を呼ぶ early return
  assert.match(body, /hallId\s*==\s*null[\s\S]*?createOperatorWindow\([\s\S]*?,\s*true\s*\)/,
    'hallId == null 経路で createOperatorWindow(_, true) を呼んでいない');
  // chooseHallDisplayInteractive を await している
  assert.match(body, /await\s+chooseHallDisplayInteractive\s*\(/,
    'chooseHallDisplayInteractive を await していない');
});

// ============================================================
// T8: 選択時のみ store.set('preferredHallDisplayId') が呼ばれる
//     （キャンセル/closed 経路では保存しない）
// ============================================================
test('T8: store.set("preferredHallDisplayId") は選択時のみ（chooseHallDisplayInteractive 内）', () => {
  const body = extractFunctionBody(MAIN, 'chooseHallDisplayInteractive', true);
  assert.ok(body, 'chooseHallDisplayInteractive 本体抽出失敗');
  // store.set が body 内に存在する
  assert.match(body, /store\.set\(\s*['"]preferredHallDisplayId['"]/,
    '選択時に store.set("preferredHallDisplayId") を呼んでいない');
  // 'closed' イベントの経路で store.set を呼んでいないこと（キャンセル時は保存しない）
  // closed コールバックを抽出して中に store.set がないか確認
  const closedMatch = body.match(/pickerWin\.on\(\s*['"]closed['"][\s\S]*?\}\s*\)/);
  if (closedMatch) {
    assert.doesNotMatch(closedMatch[0], /store\.set\(/,
      'closed コールバック内で store.set を呼んでいる（キャンセル時に保存してはいけない）');
  }
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
