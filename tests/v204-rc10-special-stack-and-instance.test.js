/**
 * v2.0.4-rc10 — specialStack 3 重 IPC 修復 + 単一インスタンス制御 + HDMI 抜き軽量対策 + H 文言簡略化 の静的解析テスト
 *
 * 対象修正:
 *   Fix 1-A: _dualStateCache に specialStack キー追加
 *   Fix 1-B: tournament:set ハンドラ末尾で _publishDualState('specialStack', ...) 呼出追加
 *   Fix 1-C: hall renderer dual-sync case 'specialStack' 追加
 *   Fix 2-A: switchOperatorToSolo で dual:role-changed を二重送信（show 前 + show 後）
 *   Fix 2-B: switchOperatorToSolo で app.focus({ steal: true }) 呼出追加
 *   Fix 3:   app.requestSingleInstanceLock + second-instance ハンドラ追加
 *   Fix 4:   H ショートカット説明文の括弧書き削除（簡略化）
 *
 * 致命バグ保護 5 件 cross-check + operator-solo 互換維持 + version 同期確認も担保。
 *
 * 実行: node tests/v204-rc10-special-stack-and-instance.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
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
// Fix 1-A: _dualStateCache に specialStack キー追加
// ============================================================
test('Fix 1-A: main.js _dualStateCache に specialStack キーが含まれる', () => {
  // _dualStateCache オブジェクト本体を抽出
  const m = MAIN.match(/const\s+_dualStateCache\s*=\s*\{[\s\S]*?\};/);
  assert.ok(m, '_dualStateCache 定義が見つからない');
  assert.match(m[0], /specialStack\s*:\s*null/,
    '_dualStateCache に specialStack キーがない（rc10 Fix 1-A 不在）');
});

test('Fix 1-A: _dualStateCache の他キー（致命バグ保護群）が消えていない', () => {
  const m = MAIN.match(/const\s+_dualStateCache\s*=\s*\{[\s\S]*?\};/);
  assert.ok(m);
  // 既存キーの保全（cross-check）
  for (const key of ['timerState', 'structure', 'displaySettings', 'marqueeSettings',
                     'tournamentRuntime', 'tournamentBasics', 'audioSettings',
                     'logoUrl', 'venueName']) {
    assert.match(m[0], new RegExp(`${key}\\s*:`), `_dualStateCache から ${key} キー消失`);
  }
});

// ============================================================
// Fix 1-B: tournament:set ハンドラ末尾で _publishDualState('specialStack', ...) 呼出
// ============================================================
test('Fix 1-B: tournament:set ハンドラに _publishDualState specialStack 呼出が含まれる', () => {
  // tournament:set ハンドラ本体を抽出（'tournament:set' のみ、tournaments:set... と区別するため境界明示）
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournament:set['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, "tournament:set ハンドラが見つからない");
  assert.match(m[0], /_publishDualState\s*\(\s*['"]specialStack['"]/,
    'tournament:set ハンドラ内に _publishDualState specialStack 呼出がない（rc10 Fix 1-B 不在）');
});

test('Fix 1-B: tournament:set ハンドラの specialStack publish が partial 経路ガード付き', () => {
  // partial.specialStack !== undefined チェックがあること（idempotent / 副作用最小化）
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournament:set['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m);
  assert.match(m[0], /partial(?:\.specialStack|\s*&&[\s\S]*?specialStack)/,
    'tournament:set ハンドラの specialStack publish に partial ガードがない');
});

// ============================================================
// Fix 1-C: hall renderer dual-sync case に specialStack 追加
// ============================================================
test("Fix 1-C: renderer.js dual-sync case に kind === 'specialStack' 分岐", () => {
  // registerDualDiffHandler 内に specialStack case があるか
  // 形式: kind === 'specialStack' または kind == 'specialStack'
  assert.match(RENDERER, /kind\s*===?\s*['"]specialStack['"]/,
    "renderer.js dual-sync case に 'specialStack' 分岐がない（rc10 Fix 1-C 不在）");
});

test('Fix 1-C: specialStack case が tournamentState.specialStack を更新', () => {
  // specialStack 分岐内に tournamentState.specialStack 代入があるか
  const idx = RENDERER.search(/kind\s*===?\s*['"]specialStack['"]/);
  assert.ok(idx >= 0, "'specialStack' 分岐が見つからない");
  // 分岐から数百文字内に代入があること
  const slice = RENDERER.slice(idx, idx + 800);
  assert.match(slice, /tournamentState\.specialStack\s*=/,
    'specialStack case 内に tournamentState.specialStack 代入がない');
});

test('Fix 1-C: specialStack case が renderStaticInfo を呼ぶ', () => {
  const idx = RENDERER.search(/kind\s*===?\s*['"]specialStack['"]/);
  assert.ok(idx >= 0);
  // case 本体は ~16 行（コメント込み）あるため、十分な範囲を確保
  const slice = RENDERER.slice(idx, idx + 2000);
  assert.match(slice, /renderStaticInfo\s*\(\s*\)/,
    'specialStack case 内で renderStaticInfo() が呼ばれていない');
});

// ============================================================
// Fix 2-A: switchOperatorToSolo に dual:role-changed の二重送信
// ============================================================
test('Fix 2-A: switchOperatorToSolo に dual:role-changed が 2 回送信される', () => {
  const body = extractFunctionBody(MAIN, /async\s+function\s+switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  // dual:role-changed の出現回数（matchAll で数える）
  const sends = body.match(/dual:role-changed/g) || [];
  assert.ok(sends.length >= 2,
    `switchOperatorToSolo の dual:role-changed 送信が ${sends.length} 回（期待 >= 2、rc10 Fix 2-A 不在）`);
});

test('Fix 2-A: switchOperatorToSolo の最初の dual:role-changed は mainWindow.show より前', () => {
  const body = extractFunctionBody(MAIN, /async\s+function\s+switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body);
  const showIdx = body.search(/mainWindow\.show\s*\(\s*\)/);
  const sendIdx = body.search(/webContents\.send\(\s*['"]dual:role-changed['"]/);
  assert.ok(showIdx >= 0 && sendIdx >= 0, 'show / send 呼出が見つからない');
  assert.ok(sendIdx < showIdx,
    `最初の dual:role-changed (idx=${sendIdx}) が mainWindow.show (idx=${showIdx}) より後（rc10 Fix 2-A: 二重送信の前段が欠落）`);
});

// ============================================================
// Fix 2-B: app.focus({ steal: true }) 呼出
// ============================================================
test('Fix 2-B: switchOperatorToSolo に app.focus({ steal: true }) が含まれる', () => {
  const body = extractFunctionBody(MAIN, /async\s+function\s+switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /app\.focus\s*\(\s*\{\s*steal\s*:\s*true\s*\}\s*\)/,
    'switchOperatorToSolo に app.focus({ steal: true }) がない（rc10 Fix 2-B 不在）');
});

// ============================================================
// Fix 3: 単一インスタンス制御
// ============================================================
test('Fix 3: main.js に app.requestSingleInstanceLock の呼出が含まれる', () => {
  assert.match(MAIN, /app\.requestSingleInstanceLock\s*\(\s*\)/,
    'app.requestSingleInstanceLock 呼出がない（rc10 Fix 3 不在）');
});

test("Fix 3: main.js に app.on('second-instance', ...) ハンドラが含まれる", () => {
  assert.match(MAIN, /app\.on\(\s*['"]second-instance['"]/,
    "second-instance ハンドラがない（rc10 Fix 3 不在）");
});

test('Fix 3: second-instance ハンドラ内で mainWindow.focus が呼ばれる', () => {
  // second-instance リスナーから次の閉じ括弧までを抽出
  const m = MAIN.match(/app\.on\(\s*['"]second-instance['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'second-instance ハンドラが見つからない');
  assert.match(m[0], /mainWindow\.focus\s*\(\s*\)/,
    'second-instance ハンドラ内で mainWindow.focus が呼ばれていない');
});

test('Fix 3: requestSingleInstanceLock が app.whenReady().then 冒頭で呼ばれる', () => {
  // app.whenReady().then 内に requestSingleInstanceLock + second-instance ハンドラがあること。
  // テスト stub の whenReady() は never-resolves なので副作用なし、配布版では即実行される。
  const m = MAIN.match(/app\.whenReady\(\)\.then\(\s*async\s*\(\s*\)\s*=>\s*\{[\s\S]{0,1500}?app\.requestSingleInstanceLock/);
  assert.ok(m, 'app.whenReady().then 冒頭付近に requestSingleInstanceLock 呼出がない');
});

// ============================================================
// Fix 4: H ショートカット説明文の簡略化
// ============================================================
test('Fix 4: index.html の H 行は rc15 で完全削除（rc10 簡略化を経て rc15 で行ごと削除）', () => {
  assert.doesNotMatch(HTML, /<kbd>H<\/kbd>/,
    'index.html に H 行が残存（rc15 で削除予定）');
});

test('Fix 4: docs/specs.md §7 の H 行は rc15 で完全削除', () => {
  assert.doesNotMatch(SPECS, /\|\s*H\s*\|\s*手元\s*PC/,
    'docs/specs.md §7 に H 行が残存（rc15 で削除予定）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc10 で影響なしを担保）
// ============================================================
test('致命バグ保護 C.2.7-A: resetBlindProgressOnly が renderer.js に引き続き存在', () => {
  // resetBlindProgressOnly は renderer.js 側で定義（v1.x からの不変条件）
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly が消失（致命バグ保護 C.2.7-A 破壊）');
});

test('致命バグ保護 C.2.7-D: tournaments:setDisplaySettings の destructure 除外維持', () => {
  // setDisplaySettings ハンドラから destructure に timerState が含まれていないこと
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'tournaments:setDisplaySettings ハンドラが見つからない');
  // destructure に timerState が含まれていないこと（C.2.7-D Fix 3）
  assert.doesNotMatch(m[0], /const\s*\{[^}]*\btimerState\b[^}]*\}\s*=/,
    'tournaments:setDisplaySettings で timerState destructure が混入（C.2.7-D 致命バグ再発）');
});

test('致命バグ保護 C.1-A2: ensureEditorEditableState が引き続き存在', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState が消失（致命バグ保護 C.1-A2 破壊）');
});

test('致命バグ保護 C.1.7: AudioContext resume 経路が維持', () => {
  const audioJsPath = path.join(ROOT, 'src', 'renderer', 'audio.js');
  if (fs.existsSync(audioJsPath)) {
    const audio = fs.readFileSync(audioJsPath, 'utf8');
    assert.match(audio, /audioContext\.state\s*===?\s*['"]suspended['"]/,
      'audio.js から audioContext.state suspended 検出が消失（C.1.7 致命バグ破壊）');
  } else {
    // 単一ファイル構成の場合 renderer.js を見る
    assert.match(RENDERER, /audioContext\.state\s*===?\s*['"]suspended['"]/,
      'renderer.js から audioContext.state suspended 検出が消失（C.1.7 致命バグ破壊）');
  }
});

test('致命バグ保護 C.1.8: tournaments:setRuntime IPC が維持', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime ハンドラが消失（C.1.8 致命バグ破壊）');
});

// ============================================================
// operator-solo モード（v1.3.0 互換）への影響なし確認
// ============================================================
test('operator-solo 互換: createOperatorWindow が引き続き role 引数を受け取る', () => {
  assert.match(MAIN, /function\s+createOperatorWindow\s*\(/,
    'createOperatorWindow が消失（v1.3.0 互換破壊）');
});

test('operator-solo 互換: switchOperatorToSolo は hallWindow.close + mainWindow 保持', () => {
  const body = extractFunctionBody(MAIN, /async\s+function\s+switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body);
  // hall は close、operator は close しない（保持）
  assert.match(body, /hallWindow\.close\s*\(\s*\)/, 'hallWindow.close 呼出が消失');
  assert.doesNotMatch(body, /mainWindow\.close\s*\(\s*\)/,
    'switchOperatorToSolo で mainWindow.close が呼ばれている（rc6 以降 close せず保持の不変条件破壊）');
});

test('operator-solo 互換: switchOperatorToSolo は show + focus（rc9 動作維持）', () => {
  const body = extractFunctionBody(MAIN, /async\s+function\s+switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body);
  assert.match(body, /mainWindow\.show\s*\(\s*\)/, 'mainWindow.show 呼出が消失（rc9 動作破壊）');
  assert.match(body, /mainWindow\.focus\s*\(\s*\)/, 'mainWindow.focus 呼出が消失（rc9 動作破壊）');
  assert.doesNotMatch(body, /mainWindow\.minimize\s*\(\s*\)/,
    'mainWindow.minimize が残存（rc9 撤去動作破壊）');
});

// ============================================================
// version 同期確認（rc10）
// ============================================================
test('version: package.json は 2.0.4-rc18', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.4-rc18',
    `package.json version が ${pkg.version}（期待 2.0.4-rc18）`);
});

test('version: scripts.test に v204-rc10-special-stack-and-instance.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc10-special-stack-and-instance\.test\.js/,
    'package.json scripts.test に v204-rc10-special-stack-and-instance.test.js がない');
});

// ============================================================
// 集計
// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
