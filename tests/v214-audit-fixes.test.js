/**
 * v2.1.0 静的解析テスト — audit 結果中重要度 7 項目 + B-6 一括修正
 *   Fix 1 (M8/C-2):  tournaments:setActive に _isSwitchingMode ガード
 *   Fix 2 (M4/B-1):  PIP タイマーの dataset.prestartFormat 切替 + CSS hms/ms ルール
 *   Fix 3 (M2/A-3):  computeLiveTimerState の currentLevelIndex クランプ
 *   Fix 4 (M3/A-8):  schedulePersistRuntime の beforeunload flush
 *   Fix 5 (M6/B-4):  operator-pane / operator-status-bar に tabular-nums
 *   Fix 6 (M5/B-2):  renderBreakImagesList の interval input typing guard
 *   Fix 7 (M11/C-11): autoUpdater error / check-rejected の dialog 通知
 *   Fix 8 (B-6):     .clock__time + .pip-timer__digits の transition に font-size
 *
 * 致命バグ保護 5 件すべて完全無傷（C.1.8 は本フェーズで拡張保護として強化）。
 *
 * 実行: node tests/v214-audit-fixes.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const PKG  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const STYLE_CSS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: Fix 1 — tournaments:setActive ハンドラ内に _isSwitchingMode ガード
// ============================================================
test('T1 (Fix 1): tournaments:setActive に _isSwitchingMode ガード追加', () => {
  // setActive ハンドラブロックを抽出
  const m = MAIN_JS.match(/ipcMain\.handle\('tournaments:setActive'[\s\S]{0,800}?\}\);/);
  assert.ok(m, 'tournaments:setActive ハンドラブロックが見つからない');
  const body = m[0];
  assert.ok(/if\s*\(\s*_isSwitchingMode\s*\)\s*return/.test(body),
    `setActive 内に _isSwitchingMode ガードがない:\n${body.slice(0, 400)}...`);
});

// ============================================================
// T2: Fix 2 — updatePipTimer に dataset.prestartFormat セット
// ============================================================
test('T2 (Fix 2): updatePipTimer 内で el.pipTimer.dataset.prestartFormat をセット', () => {
  const declIdx = RENDERER_JS.indexOf('function updatePipTimer(');
  assert.ok(declIdx >= 0, 'updatePipTimer 関数が見つからない');
  const nextFnIdx = RENDERER_JS.indexOf('\nfunction ', declIdx + 1);
  const body = RENDERER_JS.slice(declIdx, nextFnIdx > 0 ? nextFnIdx : declIdx + 2000);
  assert.ok(/el\.pipTimer.*\bdataset\.prestartFormat\b/.test(body),
    `updatePipTimer 内に el.pipTimer.dataset.prestartFormat セットがない`);
  assert.ok(/remainingMs\s*>=\s*60\s*\*\s*60\s*\*\s*1000\s*\?\s*'hms'\s*:\s*'ms'/.test(body),
    `prestartFormat 判定が remainingMs ベースでない`);
});

// ============================================================
// T3: Fix 2 — style.css に PIP 用 [data-prestart-format="hms"] ルール
// ============================================================
test('T3 (Fix 2): style.css に .pip-timer[data-prestart-format="hms"] ルール存在', () => {
  assert.ok(/\.pip-timer\[data-prestart-format="hms"\]\s*\.pip-timer__digits/.test(STYLE_CSS),
    '.pip-timer[data-prestart-format="hms"] .pip-timer__digits のルールがない');
});

// ============================================================
// T4: Fix 3 — computeLiveTimerState 内で currentLevel クランプ
// ============================================================
test('T4 (Fix 3): computeLiveTimerState 冒頭で Math.min(levels.length, ...) クランプ', () => {
  // 関数定義を探した後、Math.max(1, Math.min(levels.length, ...)) パターンが
  // 同関数内（次の function 宣言の前まで）に存在することを確認
  const declIdx = RENDERER_JS.indexOf('function computeLiveTimerState(');
  assert.ok(declIdx >= 0, 'computeLiveTimerState 関数が見つからない');
  const nextFnIdx = RENDERER_JS.indexOf('\nfunction ', declIdx + 1);
  const body = RENDERER_JS.slice(declIdx, nextFnIdx > 0 ? nextFnIdx : declIdx + 3000);
  assert.ok(/let\s+level\s*=\s*Math\.max\(1,\s*Math\.min\(levels\.length/.test(body),
    `computeLiveTimerState 内に Math.min(levels.length, ...) クランプがない`);
});

// ============================================================
// T5: Fix 4 — beforeunload 内で flushPendingRuntimePersist 呼出
// ============================================================
test('T5 (Fix 4): beforeunload リスナ内で flushPendingRuntimePersist 呼出', () => {
  const m = RENDERER_JS.match(/window\.addEventListener\('beforeunload'[\s\S]{0,500}?\}\);/);
  assert.ok(m, 'beforeunload リスナが見つからない');
  const body = m[0];
  assert.ok(/flushPendingRuntimePersist\s*\(\s*\)/.test(body),
    `beforeunload リスナ内で flushPendingRuntimePersist() 呼出がない:\n${body}`);
});

// ============================================================
// T6: Fix 4 — flushPendingRuntimePersist 関数定義 + idle 時 no-op + setRuntime 呼出
// ============================================================
test('T6 (Fix 4): flushPendingRuntimePersist 関数定義 + idle no-op + setRuntime 呼出', () => {
  const m = RENDERER_JS.match(/function flushPendingRuntimePersist\(\)\s*\{[\s\S]{0,1000}?\r?\n\}/);
  assert.ok(m, 'flushPendingRuntimePersist 関数定義が見つからない');
  const body = m[0];
  assert.ok(/if\s*\(\s*!runtimePersistTimer\s*\)\s*return/.test(body),
    `flushPendingRuntimePersist に idle 時 no-op ガードがない:\n${body}`);
  assert.ok(/window\.api\.tournaments\.setRuntime\(/.test(body),
    `flushPendingRuntimePersist 内で setRuntime IPC 呼出がない:\n${body}`);
});

// ============================================================
// T7: Fix 5 — operator-pane / operator-status-bar に tabular-nums
// ============================================================
test('T7 (Fix 5): operator-pane__info-list dd と operator-status-bar__item に tabular-nums', () => {
  const ddRule = STYLE_CSS.match(/\.operator-pane__info-list\s+dd\s*\{[\s\S]{0,400}?\}/);
  assert.ok(ddRule, 'operator-pane__info-list dd ルールが見つからない');
  assert.ok(/font-variant-numeric\s*:\s*tabular-nums/.test(ddRule[0]),
    `operator-pane__info-list dd に tabular-nums がない:\n${ddRule[0]}`);

  const barRule = STYLE_CSS.match(/\.operator-status-bar__item\s*\{[\s\S]{0,400}?\}/);
  assert.ok(barRule, 'operator-status-bar__item ルールが見つからない');
  assert.ok(/font-variant-numeric\s*:\s*tabular-nums/.test(barRule[0]),
    `operator-status-bar__item に tabular-nums がない:\n${barRule[0]}`);
});

// ============================================================
// T8: Fix 6 — renderBreakImagesList 内で activeElement ガード
// ============================================================
test('T8 (Fix 6): renderBreakImagesList で breakImageInterval の activeElement ガード', () => {
  const m = RENDERER_JS.match(/function renderBreakImagesList\(\)\s*\{[\s\S]{0,2000}?\r?\n\}/);
  assert.ok(m, 'renderBreakImagesList 関数が見つからない');
  const body = m[0];
  assert.ok(/document\.activeElement\s*!==\s*el\.breakImageInterval/.test(body),
    `renderBreakImagesList 内に activeElement ガードがない:\n${body.slice(-500)}`);
});

// ============================================================
// T9: Fix 7 — notifyAutoUpdaterError 関数定義 + dialog.showMessageBox 呼出
// ============================================================
test('T9 (Fix 7): notifyAutoUpdaterError 関数 + dialog.showMessageBox 経路', () => {
  assert.ok(/function notifyAutoUpdaterError\(/.test(MAIN_JS),
    'notifyAutoUpdaterError 関数定義が見つからない');
  // error ハンドラブロックを行ベースで抽出
  const errStart = MAIN_JS.indexOf("autoUpdater.on('error',");
  assert.ok(errStart >= 0, 'autoUpdater.on(error) ハンドラが見つからない');
  // 直後 1000 char 以内のブロック範囲
  const errBlock = MAIN_JS.slice(errStart, errStart + 800);
  assert.ok(/notifyAutoUpdaterError\(/.test(errBlock),
    `error ハンドラ内で notifyAutoUpdaterError 呼出がない:\n${errBlock}`);
  assert.ok(/rollingLog\('autoUpdater:error'/.test(errBlock),
    `error ハンドラ内の既存 rollingLog が削除されている`);
  assert.ok(/console\.warn\('\[auto-updater\] error:'/.test(errBlock),
    `error ハンドラ内の既存 console.warn が削除されている`);

  // notifyAutoUpdaterError 関数本体を行ベースで抽出（次の関数 / if 宣言まで）
  const notifyStart = MAIN_JS.indexOf('function notifyAutoUpdaterError(');
  assert.ok(notifyStart >= 0, 'notifyAutoUpdaterError 関数本体が見つからない');
  const notifyBody = MAIN_JS.slice(notifyStart, notifyStart + 1500);
  assert.ok(/dialog\.showMessageBox/.test(notifyBody),
    `notifyAutoUpdaterError 内で dialog.showMessageBox 呼出がない`);
  assert.ok(/再試行/.test(notifyBody),
    `notifyAutoUpdaterError のダイアログに「再試行」ボタンがない`);
});

// ============================================================
// T10: Fix 8 — .clock__time + .pip-timer__digits の transition に font-size
// ============================================================
test('T10 (Fix 8): .clock__time の transition に font-size 含む', () => {
  const m = STYLE_CSS.match(/\.clock__time\s*\{[\s\S]{0,2000}?\r?\n\}/);
  assert.ok(m, '.clock__time ルールが見つからない');
  const body = m[0];
  const transition = body.match(/transition\s*:\s*[^;]+;/);
  assert.ok(transition, '.clock__time に transition プロパティがない');
  assert.ok(/font-size/.test(transition[0]),
    `.clock__time の transition に font-size がない: ${transition[0]}`);
});

test('T10b (Fix 8): .pip-timer__digits の transition に font-size 含む', () => {
  const m = STYLE_CSS.match(/\.pip-timer__digits\s*\{[\s\S]{0,500}?\}/);
  assert.ok(m, '.pip-timer__digits ルールが見つからない');
  const body = m[0];
  assert.ok(/transition\s*:\s*font-size/.test(body),
    `.pip-timer__digits の transition に font-size がない:\n${body}`);
});

// ============================================================
// T11: package.json version 2.1.0 + scripts.test に v214 登録
// ============================================================
test('T11: package.json version 2.1.2 + scripts.test に v214 登録', () => {
  assert.equal(PKG.version, '2.2.1', `version が ${PKG.version}（期待 2.1.18）`);
  assert.ok(PKG.scripts.test.includes('v214-audit-fixes.test.js'),
    'scripts.test に v214-audit-fixes.test.js が含まれない');
});

// ============================================================
// 致命バグ保護 cross-check
// ============================================================
test('保護: C.1.8 既存 schedulePersistRuntime 呼出が 8 箇所以上維持', () => {
  // schedulePersistRuntime 関数定義 + 呼出箇所のカウント
  const calls = (RENDERER_JS.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  // 関数定義 1 + 呼出 8 箇所以上 = 9 箇所以上ヒット想定
  assert.ok(calls >= 8, `schedulePersistRuntime 呼出が 8 箇所未満（実: ${calls} 件）— C.1.8 既存 8 箇所が壊された可能性`);
});

test('保護: resetBlindProgressOnly が schedulePersistRuntime / setRuntime を呼ばない（永続化フックなし維持）', () => {
  const m = RENDERER_JS.match(/function resetBlindProgressOnly\([\s\S]{0,2000}?\r?\n\}/);
  assert.ok(m, 'resetBlindProgressOnly 関数が見つからない');
  const body = m[0];
  assert.ok(!/schedulePersistRuntime\s*\(/.test(body),
    `resetBlindProgressOnly 内で schedulePersistRuntime 呼出が存在（C.1.8 設計違反）`);
  assert.ok(!/setRuntime\(/.test(body),
    `resetBlindProgressOnly 内で setRuntime 呼出が存在（C.1.8 設計違反）`);
});

test('保護: v2.0.11 build.win 設定（artifactName / verifyUpdateCodeSignature / publisherName 削除）維持', () => {
  assert.equal(PKG.build.win.artifactName, 'pokertimerplus-setup-${version}.${ext}',
    'build.win.artifactName が変更されている');
  assert.equal(PKG.build.win.verifyUpdateCodeSignature, false,
    'build.win.verifyUpdateCodeSignature が変更されている');
  assert.equal(PKG.build.win.publisherName, undefined,
    'build.win.publisherName が復活している');
});

test('保護: v2.0.13 formatPreStartTime の ms 引数判定維持', () => {
  const m = RENDERER_JS.match(/function formatPreStartTime\(ms\)\s*\{[\s\S]*?\r?\n\}/);
  assert.ok(m, 'formatPreStartTime 関数が見つからない');
  assert.ok(/const useHMS\s*=\s*ms\s*>=/.test(m[0]),
    'formatPreStartTime の useHMS 判定が ms ベースでない（v2.0.13 退行）');
});

test('保護: autoUpdater update-downloaded ダイアログ + v2.1.2 方針 Z（quitAndInstall 削除済）', () => {
  assert.ok(/dialog\.showMessageBox\(mainWindow,\s*\{[\s\S]*?title:\s*'更新の準備ができました'/.test(MAIN_JS),
    'update-downloaded ハンドラの「更新の準備ができました」ダイアログが破壊されている');
  // v2.1.2 方針 Z: update-downloaded ハンドラ内では quitAndInstall を呼ばない（autoInstallOnAppQuit:true で代替）
  const handlerStart = MAIN_JS.indexOf("autoUpdater.on('update-downloaded'");
  assert.ok(handlerStart >= 0, 'update-downloaded ハンドラが見つからない');
  const handlerEnd = MAIN_JS.indexOf("rollingLog('autoUpdater:check-call'", handlerStart);
  const handlerBlock = MAIN_JS.slice(handlerStart, handlerEnd > 0 ? handlerEnd : handlerStart + 1500);
  assert.ok(!/autoUpdater\.quitAndInstall\s*\(/.test(handlerBlock),
    'v2.1.2 違反: update-downloaded ハンドラ内に quitAndInstall 呼出が残存');
});

test('保護: rollingLog 関数 + Ctrl+Shift+L 救済経路維持', () => {
  assert.ok(/function rollingLog\b/.test(MAIN_JS) || /const rollingLog\b/.test(MAIN_JS),
    'main.js から rollingLog 関数定義が消失');
  assert.ok(/CommandOrControl\+Shift\+L/.test(MAIN_JS),
    'Ctrl+Shift+L globalShortcut 登録が削除されている');
});

// ============================================================
// 結果
// ============================================================
console.log(`\nv214-audit-fixes.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
