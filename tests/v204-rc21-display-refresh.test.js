/**
 * v2.0.4-rc21 第 2 弾静的解析テスト（タスク 1 + 2 + バージョン assertion）
 *
 * 対象修正:
 *   タスク 1（問題 ⑨ 案 ⑨-A）: setStructure-only 経路 4 箇所末尾の表示更新漏れを補完する
 *                              共通ヘルパ `_refreshDisplayAfterStructureChange()` 追加 +
 *                              4 経路（handleTournamentGameTypeChange / handleTournamentSaveTournament idle /
 *                              doApplyTournament apply-only / handlePresetApply apply-only）末尾呼出。
 *                              IDLE 時は α により setState({ remainingMs, totalMs }) で新 Lv1 duration 反映、
 *                              非 IDLE（PAUSED 等）時は ③ c により remainingMs に触らず明示更新呼出のみ。
 *   タスク 2（問題 ⑩ 案 ⑩-C 計測ビルド）: renderer.js onRoleChanged ハンドラ周辺に 6 ラベル +
 *                                      preload.js onRoleChanged コールバックに 2 ラベル追加（rc22 削除予定）。
 *                                      rc12 修正コード（setAttribute + window.appRole 代入の try-catch 順序）は不変保護。
 *
 * 致命バグ保護 5 件 cross-check（rc21 で全件影響なしを担保） + rc12 保護 cross-check。
 *
 * 実行: node tests/v204-rc21-display-refresh.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const AUDIO    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ヘルパ: _refreshDisplayAfterStructureChange 関数本体を抽出（balanced brace 走査）
function extractRefreshHelper() {
  const startRe = /function\s+_refreshDisplayAfterStructureChange\s*\(\s*\)\s*\{/;
  const m = RENDERER.match(startRe);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < RENDERER.length && depth > 0) {
    const c = RENDERER[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return RENDERER.slice(m.index, i);
}

// ヘルパ: onRoleChanged ハンドラ全体を抽出（renderer.js 内）
function extractOnRoleChangedHandler() {
  const startRe = /window\.api\?\.dual\?\.onRoleChanged\?\.\(\s*\(\s*newRole\s*\)\s*=>\s*\{/;
  const m = RENDERER.match(startRe);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < RENDERER.length && depth > 0) {
    const c = RENDERER[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return RENDERER.slice(m.index, i);
}

// ============================================================
// タスク 1: 問題 ⑨ 案 ⑨-A（_refreshDisplayAfterStructureChange ヘルパ + 4 経路追加）
// ============================================================

test('T1: renderer.js に _refreshDisplayAfterStructureChange 関数定義存在', () => {
  assert.match(RENDERER, /function\s+_refreshDisplayAfterStructureChange\s*\(\s*\)\s*\{/,
    '_refreshDisplayAfterStructureChange 関数定義が見つからない（タスク 1 未実装）');
});

test('T2: _refreshDisplayAfterStructureChange 内に IDLE 判定 + setState({ remainingMs, totalMs }) 経路存在', () => {
  const body = extractRefreshHelper();
  assert.ok(body, 'ヘルパ本体抽出失敗');
  // IDLE 判定（status === States.IDLE もしくは 'IDLE' 文字列）
  assert.match(body, /state\.status\s*===\s*(?:States\.IDLE|['"]IDLE['"])/,
    'IDLE 状態判定が見つからない（α 経路の入口がない）');
  // setState({ remainingMs: ..., totalMs: ... }) 呼出（α: 新 Lv1 duration 反映）
  assert.match(body, /setState\(\s*\{\s*remainingMs\s*:[\s\S]*?totalMs\s*:[\s\S]*?\}\s*\)/,
    'IDLE 分岐に setState({ remainingMs, totalMs }) 呼出が見つからない（α 経路の核心がない）');
});

test('T3: _refreshDisplayAfterStructureChange 内に非 IDLE 判定 + 明示更新呼出経路存在', () => {
  const body = extractRefreshHelper();
  assert.ok(body, 'ヘルパ本体抽出失敗');
  // updateOperatorStatusBar / updateOperatorPane / renderTime / renderNextBreak の呼出が含まれる
  assert.match(body, /updateOperatorStatusBar\s*\(/, 'updateOperatorStatusBar 呼出が見つからない');
  assert.match(body, /updateOperatorPane\s*\(/,      'updateOperatorPane 呼出が見つからない');
  assert.match(body, /renderTime\s*\(/,              'renderTime 呼出が見つからない');
  assert.match(body, /renderNextBreak\s*\(/,         'renderNextBreak 呼出が見つからない');
});

test('T4: 4 経路末尾で _refreshDisplayAfterStructureChange() 呼出存在', () => {
  // 全経路に共通のパターン: setStructure(...) + renderCurrentLevel + renderNextLevel + _refreshDisplayAfterStructureChange()
  const callMatches = RENDERER.match(/_refreshDisplayAfterStructureChange\s*\(\s*\)/g) || [];
  // 関数定義 1 箇所 + 4 呼出 = 5 件以上（呼出のみで 4 件以上）
  // ただし定義の左辺は `function _refreshDisplayAfterStructureChange()` で `()` パターンも該当する
  // 厳密には呼出 4 件 + 定義 1 件 = 5 件マッチを期待
  assert.ok(callMatches.length >= 5,
    `_refreshDisplayAfterStructureChange() マッチ件数 ${callMatches.length}、期待 5 件以上（定義 1 + 呼出 4）`);
});

test('T5: PAUSED 等の非 IDLE 分岐に setState({ remainingMs: ... }) 呼出が無い（③ c 厳守）', () => {
  const body = extractRefreshHelper();
  assert.ok(body, 'ヘルパ本体抽出失敗');
  // 非 IDLE 分岐（else ブロック）を抽出して setState({ remainingMs: ... } パターン不在を assertion
  const elseMatch = body.match(/\}\s*else\s*\{([\s\S]*?)\}\s*\}\s*catch/);
  // body は外側 try { ... } catch (_) { ... } で wrap されている、else 分岐は内側 if-else の else
  // 内側 if-else 抽出: if (state.status === ... ) { ... } else { ELSE_BODY }
  const innerMatch = body.match(/if\s*\(\s*state\.status\s*===\s*(?:States\.IDLE|['"]IDLE['"])\s*\)\s*\{[\s\S]*?\}\s*else\s*\{([\s\S]*?)\}\s*\}\s*catch/);
  if (!innerMatch) {
    // フォールバック: 全体に対して、remainingMs を含む setState が「非 IDLE 分岐内」に存在しないこと（IDLE 判定外の検査）
    // 厳密 assertion: setState({ remainingMs パターンは body 全体で 1 件（IDLE 分岐内）のみ
    const setStateCalls = body.match(/setState\s*\(\s*\{\s*remainingMs\s*:/g) || [];
    assert.equal(setStateCalls.length, 1,
      `setState({ remainingMs: ... }) 呼出件数 ${setStateCalls.length}、期待 1 件（IDLE 分岐内のみ、③ c 違反防止）`);
    return;
  }
  const elseBody = innerMatch[1];
  assert.doesNotMatch(elseBody, /setState\s*\(\s*\{\s*remainingMs\s*:/,
    '非 IDLE 分岐に setState({ remainingMs: ... }) 呼出が混入（③ c 違反、targetTime 整合性破壊リスク）');
});

test('T6: timer.js の targetTime 経路に新規呼出が無い（③ c 厳守、③ c の構造維持）', () => {
  const TIMER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
  // _refreshDisplayAfterStructureChange は renderer.js 専用、timer.js には流入しない
  assert.doesNotMatch(TIMER, /_refreshDisplayAfterStructureChange/,
    'timer.js に _refreshDisplayAfterStructureChange が混入（③ c 違反、timer 内部から呼ぶと targetTime race）');
});

// ============================================================
// タスク 2: 問題 ⑩ 案 ⑩-C 計測ビルド（renderer.js 6 ラベル + preload.js 2 ラベル）
// ============================================================

test('T7: renderer.js から 6 件の renderer:onRoleChanged: 計測ラベル送信が削除されている（rc23 で全削除）', () => {
  const handler = extractOnRoleChangedHandler();
  assert.ok(handler, 'onRoleChanged ハンドラ抽出失敗');
  const removedLabels = [
    'renderer:onRoleChanged:before-setAttribute',
    'renderer:onRoleChanged:after-setAttribute',
    'renderer:onRoleChanged:after-appRole-assign',
    'renderer:onRoleChanged:after-updateMuteIndicator',
    'renderer:onRoleChanged:after-updateOperatorPane',
    'renderer:onRoleChanged:after-updateFocusBanner'
  ];
  for (const label of removedLabels) {
    assert.ok(handler.indexOf(label) < 0,
      `onRoleChanged ハンドラに計測ラベル "${label}" が残存（rc23 で削除されているはず）`);
  }
});

test('T8: preload.js から preload:onRoleChanged:enter / :catch ラベル送信が削除されている（rc23 で全削除）', () => {
  assert.ok(PRELOAD.indexOf('preload:onRoleChanged:enter') < 0,
    'preload.js に preload:onRoleChanged:enter ラベルが残存（rc23 で削除されているはず）');
  assert.ok(PRELOAD.indexOf('preload:onRoleChanged:catch') < 0,
    'preload.js に preload:onRoleChanged:catch ラベルが残存（rc23 で削除されているはず）');
});

test('T9: rc12 修正コード（setAttribute + window.appRole 代入の try-catch 順序）が現存し順序変化なし', () => {
  const handler = extractOnRoleChangedHandler();
  assert.ok(handler, 'onRoleChanged ハンドラ抽出失敗');
  // setAttribute('data-role', newRole) が try-catch で wrap されている
  assert.match(handler, /try\s*\{[\s\S]*?document\.documentElement\.setAttribute\(\s*['"]data-role['"]\s*,\s*newRole\s*\)[\s\S]*?\}\s*catch\s*\(\s*_\s*\)/,
    'rc12 根治コード setAttribute("data-role", newRole) の try-catch 構造が破壊（致命バグ再発リスク）');
  // window.appRole = newRole が try-catch で wrap されている
  assert.match(handler, /try\s*\{\s*window\.appRole\s*=\s*newRole\s*;?\s*\}\s*catch\s*\(\s*_\s*\)/,
    'rc12 根治コード window.appRole = newRole の try-catch 構造が破壊（致命バグ再発リスク）');
  // 順序: setAttribute が window.appRole 代入より前
  const setAttrIdx  = handler.indexOf('setAttribute');
  const appRoleIdx  = handler.indexOf('window.appRole = newRole');
  assert.ok(setAttrIdx >= 0 && appRoleIdx >= 0,
    'rc12 根治コードの両方の経路が見つからない');
  assert.ok(setAttrIdx < appRoleIdx,
    `rc12 根治コードの順序破壊: setAttribute (${setAttrIdx}) < window.appRole (${appRoleIdx}) を期待（rc12 真因再発リスク）`);
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc21 で全件影響なし）
// ============================================================

test('致命バグ保護 C.2.7-A: resetBlindProgressOnly が renderer.js に存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly が消失（C.2.7-A 破壊）');
});

test('致命バグ保護 C.2.7-D: setDisplaySettings の timerState destructure 除外維持', () => {
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'tournaments:setDisplaySettings IPC ハンドラが見つからない');
  assert.doesNotMatch(m[0], /const\s*\{[^}]*\btimerState\b[^}]*\}\s*=/,
    'setDisplaySettings で timerState destructure が混入（C.2.7-D 致命バグ再発）');
});

test('致命バグ保護 C.1-A2: ensureEditorEditableState 関数定義が維持', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState が消失（C.1-A2 破壊）');
});

test('致命バグ保護 C.1.7: AudioContext suspend resume 経路が維持', () => {
  assert.match(AUDIO, /audioContext\.state\s*===?\s*['"]suspended['"]/,
    'audio.js から audioContext.state suspended 検出が消失（C.1.7 破壊）');
  assert.match(AUDIO, /audioContext\.resume\(\)/,
    'audio.js から audioContext.resume() 呼出が消失（C.1.7 破壊）');
});

test('致命バグ保護 C.1.8: tournaments:setRuntime IPC 維持 + _refreshDisplayAfterStructureChange に schedulePersistRuntime 不在', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime ハンドラが消失（C.1.8 破壊）');
  // _refreshDisplayAfterStructureChange ヘルパ本体に schedulePersistRuntime / runtime 永続化系の混入なし
  // （表示更新と runtime 永続化の境界保護、preset 経路で runtime を触らない原則）
  const body = extractRefreshHelper();
  assert.ok(body, 'ヘルパ本体抽出失敗');
  assert.doesNotMatch(body, /schedulePersistRuntime|tournaments:setRuntime/,
    '_refreshDisplayAfterStructureChange に runtime 永続化系の呼出が混入（C.1.8 境界曖昧化）');
});

// ============================================================
// rc12 投入済 onRoleChanged 不変保護
// ============================================================

test('rc12 不変保護: onRoleChanged ハンドラ内 _logRoleChange 呼出が setAttribute より前で維持', () => {
  const handler = extractOnRoleChangedHandler();
  assert.ok(handler, 'onRoleChanged ハンドラ抽出失敗');
  const logIdx     = handler.indexOf('_logRoleChange(newRole)');
  const setAttrIdx = handler.indexOf('setAttribute');
  assert.ok(logIdx >= 0, '_logRoleChange(newRole) 呼出が消失（rc15 ロギング破壊）');
  assert.ok(setAttrIdx >= 0, 'setAttribute 呼出が消失（rc12 根治破壊）');
  assert.ok(logIdx < setAttrIdx,
    `_logRoleChange (${logIdx}) は setAttribute (${setAttrIdx}) より前で呼ばれること`);
});

// ============================================================
// version assertion（rc21）
// ============================================================

test('version: package.json は 2.0.5', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.5',
    `package.json version が ${pkg.version}（期待 2.0.5）`);
});

test('version: scripts.test に v204-rc21-display-refresh.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc21-display-refresh\.test\.js/,
    'package.json scripts.test に新規テスト v204-rc21-display-refresh.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
