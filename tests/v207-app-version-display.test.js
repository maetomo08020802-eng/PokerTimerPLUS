/**
 * v2.0.7 静的解析テスト
 *   STEP 1: ハウス情報タブのバージョン表示バグ修正
 *     - 旧バグ: loadInitialSettings() 内の `return false;` 後（unreachable）にバージョン取得コードが
 *       置かれていたため永遠に実行されず、ハウス情報タブの「バージョン」欄が「—」のままだった
 *     - 修正: 独立関数 loadAppVersion() として切り出し、initialize() の末尾から fire-and-forget で呼出
 *     - preload.js / main.js / index.html は既に正常実装済（renderer 側のコード配置ミスのみ）
 *
 * 致命バグ保護 5 件 + rc12 / rc18 / rc22 / rc23 + C.1.4-fix1 PIP ボタン位置 すべて完全無傷。
 *
 * 実行: node tests/v207-app-version-display.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ブレース深度カウントで関数本体を抽出
function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
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
// T1: index.html に js-app-version 要素が存在
// ============================================================

test('T1: index.html に id="js-app-version" の要素（バージョン表示先）が存在', () => {
  assert.match(HTML, /id\s*=\s*["']js-app-version["']/,
    'index.html に id="js-app-version" 要素が見つからない');
});

// ============================================================
// T2: renderer.js に window.api.app.getVersion() を呼ぶコードが存在
// ============================================================

test('T2: renderer.js 内に window.api.app.getVersion() 呼出コードが存在', () => {
  assert.match(RENDERER, /window\.api\?\.app\?\.getVersion/,
    'renderer.js に window.api?.app?.getVersion 経路がない');
  assert.match(RENDERER, /await\s+window\.api\.app\.getVersion\s*\(\s*\)/,
    'renderer.js に await window.api.app.getVersion() 呼出がない');
  assert.match(RENDERER, /el\.appVersion\.textContent\s*=\s*version/,
    'renderer.js に el.appVersion.textContent = version の代入がない');
});

// ============================================================
// T3: バージョン取得コードが return 文の後に置かれていない（unreachable code 防止）
// ============================================================

test('T3: バージョン取得コードが独立関数 loadAppVersion 内に配置（unreachable code 防止）', () => {
  // 独立関数 loadAppVersion が定義されている
  assert.match(RENDERER, /async\s+function\s+loadAppVersion\s*\(\s*\)\s*\{/,
    'async function loadAppVersion() の定義がない（独立関数として切り出されていない）');
  // loadAppVersion 関数本体に getVersion 呼出が含まれる
  const body = extractFunctionBody(RENDERER, 'loadAppVersion');
  assert.ok(body, 'loadAppVersion 関数本体が抽出できない');
  assert.match(body, /window\.api\?\.app\?\.getVersion/,
    'loadAppVersion 内に window.api?.app?.getVersion 経路がない');
  assert.match(body, /el\.appVersion\.textContent/,
    'loadAppVersion 内に el.appVersion.textContent 代入がない');
});

test('T3 補足: loadInitialSettings の return false; の後にバージョン取得コードが残っていない', () => {
  const body = extractFunctionBody(RENDERER, 'loadInitialSettings');
  assert.ok(body, 'loadInitialSettings 関数本体が抽出できない');
  // loadInitialSettings 内で `return false;` 以降の unreachable 領域に
  // バージョン取得 (window.api.app.getVersion) が含まれていないことを確認
  // ブレース末尾の return false; から関数末尾までの領域を抽出
  const m = body.match(/return\s+false\s*;[\s\S]*$/);
  if (m) {
    const tail = m[0];
    assert.doesNotMatch(tail, /window\.api\?\.app\?\.getVersion/,
      'loadInitialSettings の return false; 後に getVersion 経路が残存（unreachable code）');
    assert.doesNotMatch(tail, /el\.appVersion\.textContent/,
      'loadInitialSettings の return false; 後に el.appVersion.textContent 代入が残存（unreachable code）');
  }
});

test('T3 補足 2: initialize() 関数から loadAppVersion() を呼出している', () => {
  const body = extractFunctionBody(RENDERER, 'initialize');
  assert.ok(body, 'initialize 関数本体が抽出できない');
  assert.match(body, /loadAppVersion\s*\(\s*\)\s*;?/,
    'initialize() 内から loadAppVersion() を呼出していない（reachable な実行経路がない）');
});

// ============================================================
// T4: preload.js の getVersion bridge が維持されている
// ============================================================

test('T4: preload.js の getVersion: () => ipcRenderer.invoke("app:getVersion") が維持', () => {
  assert.match(PRELOAD,
    /getVersion\s*:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\s*\(\s*['"]app:getVersion['"]\s*\)/,
    'preload.js の getVersion: () => ipcRenderer.invoke("app:getVersion") bridge がない');
});

// ============================================================
// T5: main.js の ipcMain.handle('app:getVersion', ...) が維持されている
// ============================================================

test('T5: main.js の ipcMain.handle("app:getVersion", () => app.getVersion()) が維持', () => {
  assert.match(MAIN,
    /ipcMain\.handle\s*\(\s*['"]app:getVersion['"]\s*,\s*\(\s*\)\s*=>\s*app\.getVersion\s*\(\s*\)\s*\)/,
    'main.js の ipcMain.handle("app:getVersion", () => app.getVersion()) ハンドラがない');
});

// ============================================================
// version assertion
// ============================================================

test('version: package.json は 2.0.11', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.1.14',
    `package.json version が ${pkg.version}（期待 2.0.11）`);
});

test('version: scripts.test に v207-app-version-display.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v207-app-version-display\.test\.js/,
    'package.json scripts.test に v207-app-version-display.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`v207-app-version-display.test.js: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
