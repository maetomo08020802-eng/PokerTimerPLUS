// v2.0.1 stabilization: ウィンドウ参照 race 防止のリグレッションテスト
//
// 修正前のコード:
//   mainWindow.on('closed', () => { mainWindow = null; });
// 修正後のコード:
//   win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
//
// 旧実装では switchOperatorToSolo で window1 close → 新 window2 生成後に
// window1 の closed が遅延発火し、新 window2 への参照が誤って null 上書きされる race があった。
// 「自分自身がクローズした時だけクリア」のガードで防御。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'g');
  const m = re.exec(source);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(m.index, i + 1);
    i++;
  }
  return null;
}

const MAIN_NOCOMMENT = stripComments(MAIN);

test('T1: createOperatorWindow に「mainWindow === win」race ガードあり', () => {
  // main.js 全体に「if (mainWindow === win)」が含まれているか
  // createOperatorWindow 内にしか書かれない特殊なパターンなので、
  // 全体検査で十分（hallWindow === win との混同もない）
  assert.match(MAIN_NOCOMMENT, /if\s*\(\s*mainWindow\s*===\s*win\s*\)/,
    'main.js に「if (mainWindow === win)」がない（createOperatorWindow の race 修正が壊れている可能性）');
});

test('T2: createHallWindow に「hallWindow === win」race ガードあり', () => {
  assert.match(MAIN_NOCOMMENT, /if\s*\(\s*hallWindow\s*===\s*win\s*\)/,
    'main.js に「if (hallWindow === win)」がない（createHallWindow の race 修正が壊れている可能性）');
});

test('T3: createOperatorWindow がローカル変数 win を経由してウィンドウを保持', () => {
  const body = extractFunctionBody(MAIN_NOCOMMENT, 'createOperatorWindow');
  assert.ok(body, 'createOperatorWindow が見つからない');
  // 「const win = new BrowserWindow(opts)」のようなローカル変数経由パターン
  const hasLocalRef = /const\s+win\s*=\s*new\s+BrowserWindow/.test(body);
  assert.ok(hasLocalRef, 'createOperatorWindow が「const win = new BrowserWindow(...)」パターンを使っていない（race 修正が壊れている可能性）');
});

test('T4: createHallWindow がローカル変数 win を経由してウィンドウを保持', () => {
  const body = extractFunctionBody(MAIN_NOCOMMENT, 'createHallWindow');
  assert.ok(body, 'createHallWindow が見つからない');
  const hasLocalRef = /const\s+win\s*=\s*new\s+BrowserWindow/.test(body);
  assert.ok(hasLocalRef, 'createHallWindow が「const win = new BrowserWindow(...)」パターンを使っていない（race 修正が壊れている可能性）');
});
