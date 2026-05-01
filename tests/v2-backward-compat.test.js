/**
 * v2.0.0 STEP 6 — 後方互換テスト（operator-solo モード = v1.3.0 完全同等の担保強化）
 *
 * 検証対象:
 *   - operator-solo で起動した renderer.js が v1.3.0 と同じ初期化パスを経由
 *   - [data-role="operator-solo"] が「すべての要素を hidden にしない」
 *   - notifyOperatorActionIfNeeded ヘルパーが削除されている（v2.0.2 cleanup）
 *   - dual-sync の hall 限定ガード（operator-solo で誤作動しない）
 *   - 致命バグ修正 5 件すべて operator-solo で機能
 *   - v1.3.0 配布物の挙動を一切壊していない（既存関数の存在確認）
 *
 * 実行: node tests/v2-backward-compat.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const AUDIO    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: operator-solo の起動は initialize() を呼ぶ（v1.3.0 と同じパス）
// ============================================================
test('T1: operator-solo モードは initialize() を経由（v1.3.0 と同じ起動パス）', () => {
  // __appRole === 'operator-solo' or else 分岐が initialize() を呼ぶ
  // STEP 5 で ensureAudioReady() も追加されたが、initialize() が主役
  const elseMatch = RENDERER.match(/__appRole\s*===\s*['"]operator['"][\s\S]*?\}\s*else\s*\{([\s\S]*?)\}\s*$/m);
  assert.ok(elseMatch, '__appRole 分岐の else (operator-solo) ブロック抽出失敗');
  const elseBlock = elseMatch[1];
  assert.match(elseBlock, /initialize\s*\(\s*\)/, 'operator-solo 経路で initialize() を呼んでいない');
  // initDualSyncForHall は呼ばれない（hall 限定）
  assert.doesNotMatch(elseBlock, /initDualSyncForHall\s*\(/,
    'operator-solo 経路で initDualSyncForHall を誤って呼んでいる');
});

// ============================================================
// T2: [data-role="operator-solo"] は要素を hidden にしない（v1.3.0 完全同等）
// ============================================================
test('T2: [data-role="operator-solo"] が UI 要素を hidden にしない', () => {
  // [data-role="operator-solo"] の宣言ブロックを抽出
  const soloRules = STYLE.match(/\[data-role="operator-solo"\][^{]*\{[^}]*\}/g) || [];
  // 重要要素（.clock / .bottom-bar / .marquee / .form-dialog / .confirm-dialog）に display:none を当てているルールが無いこと
  const protectedSelectors = ['.clock', '.bottom-bar', '.marquee', '.form-dialog', '.confirm-dialog',
                              '.slideshow-stage', '.pip-timer'];
  for (const rule of soloRules) {
    for (const sel of protectedSelectors) {
      const sanitized = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${sanitized}\\s*\\{[^}]*display:\\s*none`);
      if (re.test(rule)) {
        throw new Error(`[data-role="operator-solo"] で ${sel} を hidden 化（v1.3.0 互換違反）: ${rule}`);
      }
    }
  }
  // 補強: hall / operator のみが display:none を持つ
  assert.match(STYLE, /\[data-role="hall"\]\s+\.bottom-bar/, 'hall の .bottom-bar hidden ルール消失');
  assert.match(STYLE, /\[data-role="operator"\]\s+\.clock/, 'operator の .clock hidden ルール消失');
});

// ============================================================
// T3: v2.0.2 cleanup — notifyOperatorActionIfNeeded ヘルパーが完全削除されている
//     （元々 dual:operator-action へ通知する wrapper、main 側ハンドラがデッドコードのため撤去）
// ============================================================
test('T3: notifyOperatorActionIfNeeded ヘルパーが削除されている（v2.0.2 cleanup）', () => {
  // 関数定義が消えている
  assert.doesNotMatch(RENDERER, /function\s+notifyOperatorActionIfNeeded\s*\(/,
    'notifyOperatorActionIfNeeded 関数定義が残存（v2.0.2 で撤去予定）');
  // 呼出も消えている
  assert.doesNotMatch(RENDERER, /notifyOperatorActionIfNeeded\s*\(\s*['"]/,
    'notifyOperatorActionIfNeeded 呼出が残存（v2.0.2 で撤去予定）');
});

// ============================================================
// T4: dual-sync の initDualSyncForHall が hall 限定ガード（operator-solo で誤作動しない）
// ============================================================
test('T4: initDualSyncForHall が window.appRole !== "hall" で早期 return', () => {
  assert.match(DUAL_SYNC, /window\.appRole\s*!==\s*['"]hall['"][\s\S]*?return/,
    'initDualSyncForHall に hall 限定ガードなし');
});

// ============================================================
// T5: 致命バグ修正 5 件すべて operator-solo で機能（cross-step 関数本体存在確認）
// ============================================================
test('T5: 致命バグ修正 5 件の関数本体・経路が維持されている', () => {
  // C.2.7-A: resetBlindProgressOnly が tournamentRuntime に触らない
  const resetBody = (() => {
    const m = RENDERER.match(/function\s+resetBlindProgressOnly\s*\([^)]*\)\s*\{([\s\S]*?)^\}/m);
    return m ? m[1] : null;
  })();
  assert.ok(resetBody, 'resetBlindProgressOnly 関数本体抽出失敗');
  assert.doesNotMatch(resetBody, /tournamentRuntime\.\w+\s*=/,
    'resetBlindProgressOnly が tournamentRuntime を変更している（C.2.7-A 違反）');

  // C.2.7-D: setDisplaySettings の destructure に timerState 混入なし
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?const\s*\{\s*([^}]*)\s*\}\s*=\s*payload/);
  assert.ok(m, 'setDisplaySettings destructure 抽出失敗');
  assert.doesNotMatch(m[1], /timerState/, 'setDisplaySettings destructure に timerState 混入（C.2.7-D 違反）');

  // C.1-A2: ensureEditorEditableState 関数定義 + handleTournamentNew で呼出
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'ensureEditorEditableState 関数なし');
  assert.match(RENDERER, /handleTournamentNew[\s\S]*?ensureEditorEditableState\s*\(/,
    'handleTournamentNew 経路に ensureEditorEditableState 呼出なし');

  // C.1.7: audio.js の _play 内 suspend resume
  assert.match(AUDIO, /audioContext\.state\s*===\s*['"]suspended['"][\s\S]*?resume/,
    'audio.js _play 内の suspend resume なし（C.1.7 違反）');

  // C.1.8: schedulePersistRuntime が複数箇所で呼ばれる + main.js に setRuntime IPC + sanitizeRuntime
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'schedulePersistRuntime 関数なし');
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/, 'tournaments:setRuntime IPC なし');
  assert.match(MAIN, /function\s+sanitizeRuntime\s*\(/, 'sanitizeRuntime 関数なし');
});

// ============================================================
// T6: v1.3.0 既存関数が renderer.js / main.js に保持されている
// ============================================================
test('T6: v1.3.0 既存の主要関数群が renderer.js / main.js / audio.js に保持されている', () => {
  // renderer.js
  const rendererFns = [
    'handleReset', 'handleTournamentNew', 'handlePresetApply', 'handlePresetSave',
    'handleMarqueeSave', 'addNewEntry', 'eliminatePlayer', 'adjustReentry', 'adjustAddOn',
    'applyTournament', 'renderTime', 'renderControls'
  ];
  for (const fn of rendererFns) {
    const re = new RegExp(`function\\s+${fn}\\s*\\(`);
    assert.match(RENDERER, re, `renderer.js から関数 ${fn} が消失（v1.3.0 互換違反）`);
  }
  // main.js
  const mainFns = [
    'normalizeTimerState', 'normalizeTournament', 'sanitizeBackgroundImage',
    'sanitizeBreakImages', 'sanitizeMarqueeSettings', 'sanitizeRuntime'
  ];
  for (const fn of mainFns) {
    const re = new RegExp(`function\\s+${fn}\\s*\\(`);
    assert.match(MAIN, re, `main.js から関数 ${fn} が消失（v1.3.0 互換違反）`);
  }
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
