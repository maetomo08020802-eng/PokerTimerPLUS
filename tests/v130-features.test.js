/**
 * STEP 10 フェーズC.1.2 — v1.3.0 機能追加 5 件の回帰防止テスト
 *
 * 検証対象:
 *   Fix 1: Ctrl+Q 状態別メッセージ — confirmQuit が active timerState を読んで分岐
 *   Fix 2: DONE 状態 'finished' — VALID_TIMER_STATUS 拡張、computeLiveTimerState の return、
 *          applyTimerStateToTimer の早期 return、handleReset での overlay クリア
 *   Fix 3: electron-updater 統合 — main.js の require、autoUpdater イベント、package.json publish
 *   Fix 4: About 画面に DevTools 注記
 *   Fix 5: package.json version === 1.3.0
 *
 * 実行: node tests/v130-features.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// ============================================================
// Fix 1: Ctrl+Q 状態別メッセージ
// ============================================================
test('T1: confirmQuit がアクティブ timerState を読んでメッセージ分岐', () => {
  const idx = MAIN.indexOf('async function confirmQuit');
  assert.ok(idx >= 0, 'confirmQuit が見つからない');
  const slice = MAIN.slice(idx, idx + 1500);
  // active timerState から status 取得
  assert.match(slice, /activeTournamentId/, 'active id 取得が含まれていない');
  assert.match(slice, /timerState\?\.status/, 'timerState.status 参照がない');
  // 'running' / 'paused' / 'break' 判定
  assert.match(slice, /running.+paused.+break|paused.+running.+break|break.+running.+paused/, 'timer active 状態の分岐がない');
  // 警告メッセージ
  assert.match(slice, /タイマーが進行中/, '進行中警告メッセージがない');
});

// ============================================================
// Fix 2: 'finished' status
// ============================================================
test('T2: main.js VALID_TIMER_STATUS に finished が含まれる', () => {
  assert.match(MAIN, /VALID_TIMER_STATUS\s*=\s*\[[^\]]*['"]finished['"]/, 'finished が VALID_TIMER_STATUS に含まれていない');
});

test('T3: computeLiveTimerState が全レベル完走時に finished を返す', () => {
  const start = RENDERER.indexOf('function computeLiveTimerState');
  assert.ok(start >= 0);
  const slice = RENDERER.slice(start, start + 2000);
  assert.match(slice, /status:\s*['"]finished['"]/, 'finished 返却がない');
});

test('T4: applyTimerStateToTimer が finished 時に timerReset + overlay 表示', () => {
  const start = RENDERER.indexOf('function applyTimerStateToTimer');
  assert.ok(start >= 0);
  const slice = stripComments(RENDERER.slice(start, start + 1500));
  // status === 'finished' で早期処理
  assert.match(slice, /status\s*===\s*['"]finished['"]/, 'finished 判定がない');
  assert.match(slice, /clock--timer-finished/, 'overlay クラス追加がない');
});

test('T5: handleReset / resetBlindProgressOnly が clock--timer-finished を解除', () => {
  const handleResetBody = stripComments(RENDERER.match(/function handleReset\(\)\s*\{[\s\S]+?\n\}/)[0]);
  assert.match(handleResetBody, /classList\.remove\(['"]clock--timer-finished['"]/, 'handleReset で overlay 解除がない');

  const resetBPBody = stripComments(RENDERER.match(/function resetBlindProgressOnly\(\)\s*\{[\s\S]+?\n\}/)[0]);
  assert.match(resetBPBody, /classList\.remove\(['"]clock--timer-finished['"]/, 'resetBlindProgressOnly で overlay 解除がない');
});

test('T6: index.html に js-timer-finished-overlay 要素 + style.css に対応 CSS', () => {
  assert.match(HTML, /id=["']js-timer-finished-overlay["']/, 'timer-finished overlay 要素がない');
  assert.match(HTML, /トーナメント終了/, '日本語ラベルがない');
  assert.match(STYLE, /\.clock__timer-finished-overlay/, 'overlay の CSS ルールがない');
  assert.match(STYLE, /\.clock--timer-finished\s+\.clock__timer-finished-overlay/, '可視化用 .clock--timer-finished 派生ルールがない');
});

// ============================================================
// Fix 3: electron-updater
// ============================================================
test('T7: main.js が electron-updater を require + autoUpdater 設定', () => {
  assert.match(MAIN, /require\(['"]electron-updater['"]\)/, 'electron-updater require がない');
  assert.match(MAIN, /autoUpdater\.on\(['"]update-downloaded['"]/, 'update-downloaded handler がない');
  assert.match(MAIN, /autoUpdater\.checkForUpdatesAndNotify/, 'checkForUpdatesAndNotify 呼出がない');
  // 開発時はスキップ（C.1.2-followup で hasPublishConfig 条件も追加された）
  assert.match(MAIN, /if\s*\(\s*!isDev\s+&&\s+autoUpdater\b/, 'isDev スキップガードがない');
});

test('T8: build.publish が GitHub provider で設定済 + main.js の hasPublishConfig ガード維持', () => {
  assert.ok(PKG.build, 'build セクションがない');
  // C.3-A: GitHub リポジトリ作成済（maetomo08020802-eng/PokerTimerPLUS）。
  //   publish 設定が github provider + owner + repo で有効化されていることを検証。
  assert.ok(PKG.build.publish, 'build.publish が未設定（C.3-A 配布準備で再追加されているはず）');
  assert.equal(PKG.build.publish.provider, 'github', 'provider が github でない');
  assert.ok(typeof PKG.build.publish.owner === 'string' && PKG.build.publish.owner.length > 0,
    'build.publish.owner が空');
  assert.ok(typeof PKG.build.publish.repo === 'string' && PKG.build.publish.repo.length > 0,
    'build.publish.repo が空');
  // main.js 側: publish 未設定時の no-op ガードは維持（hasPublishConfig 判定）
  assert.match(MAIN, /hasPublishConfig/, 'main.js に publish 設定の存在チェック (hasPublishConfig) がない');
  assert.match(MAIN, /build\.publish/, 'main.js で package.json の build.publish を参照していない');
});

test('T9: dependencies に electron-updater', () => {
  assert.ok(PKG.dependencies['electron-updater'], 'electron-updater が dependencies にない');
});

// ============================================================
// Fix 4: About 画面に DevTools 注記
// ============================================================
test('T10: About 画面に F12 DevTools 注記', () => {
  assert.match(HTML, /class=["']about-devtools-note["']/, 'about-devtools-note 要素がない');
  assert.match(HTML, /F12.*Ctrl\+Shift\+I.*開発者ツール/, '注記テキストの実体がない');
  assert.match(STYLE, /\.about-devtools-note/, '対応 CSS ルールがない');
});

// ============================================================
// Fix 5: version 2.0.0（v2.0.0 STEP 7 で 1.3.0 → 2.0.0 に bump、テストも追従）
// ============================================================
test('T11: package.json version === 2.0.0', () => {
  // v2.0.0 STEP 7 (2026-05-01): version bump 1.3.0 → 2.0.0 に追従。
  // 本テストは「リリース版を表すバージョン文字列が期待値である」ことを担保するもの。
  // 今後の minor / patch リリース時はここを追従更新する（テスト skip / 無効化ではない）。
  assert.equal(PKG.version, '2.0.5', `version が ${PKG.version}（期待 2.0.5）`);
});

// ============================================================
// 既存挙動維持
// ============================================================
test('T12: handlePresetApply の reset 分岐は引き続き resetBlindProgressOnly（C.2.7-A 致命バグ修正の保護）', () => {
  // handlePresetApply 関数の本体全体を抽出（async function は通常の function と署名が異なるため手動）
  const re = /async\s+function\s+handlePresetApply\s*\([^)]*\)\s*\{/;
  const m = RENDERER.match(re);
  assert.ok(m, 'handlePresetApply が見つからない');
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++;
    else if (RENDERER[i] === '}') depth--;
    i++;
  }
  const body = stripComments(RENDERER.slice(m.index, i));
  assert.match(body, /resetBlindProgressOnly\(/, 'resetBlindProgressOnly が消えている');
  assert.doesNotMatch(body, /\bhandleReset\(/, 'handleReset が誤って呼ばれている');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
