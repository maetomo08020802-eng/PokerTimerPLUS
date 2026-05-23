/**
 * v2.1.17 静的解析テスト — ① PRE_START 一時停止 hall 同期の真の根治（main.js sanitization fix）
 *
 *   Fix 1 (本丸): main.js `dual:publish-pre-start-state` IPC ハンドラの `if (isActive)` ブロック内に
 *                `if (typeof payload.isPaused === 'boolean') sanitized.isPaused = payload.isPaused;` 追加
 *   Fix 2: rc1/rc2 計測ログ 12 ラベル全撤去
 *   Fix 3: 計測モードバッジ撤去
 *   Fix 4: 試験 5 修正（handlePipShowSlideshow の breakStartedAt = null）継続採用
 *   Fix 5: v2.1.15 / v2.1.16 isPaused 維持機構完全保持
 *
 * 真因: v2.1.6 で `dual:publish-pre-start-state` ハンドラを新設した時、後の v2.1.15/v2.1.16 で
 *   renderer 側に追加された `isPaused` フィールドがサニタイズロジックで転送されておらず、
 *   operator → main → hall の IPC 経路で常に isPaused フィールドが消失 → hall 側で undefined → false 化。
 *   rc2 観測ログ `meas:hall:applyPreStart:detail.payloadHasIsPausedKey: FALSE` で決定的証拠取得。
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 *
 * 実行: node tests/v229-publish-pre-start-isPaused-fix.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const TIMER_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const MAIN_JS   = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const AUDIO_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1 (Fix 1, 本丸): main.js dual:publish-pre-start-state ハンドラの if (isActive) ブロック内に
//                  typeof payload.isPaused === 'boolean' 判定 + sanitized.isPaused 代入存在
// ============================================================
test('T1 (Fix 1, 本丸): main.js dual:publish-pre-start-state に isPaused 転送経路', () => {
  // ハンドラ抽出
  const handlerStart = MAIN_JS.indexOf("ipcMain.on('dual:publish-pre-start-state'");
  assert.ok(handlerStart >= 0, 'dual:publish-pre-start-state ハンドラが見当たらない');
  // ハンドラ末尾は次の ipcMain.on / ipcMain.handle まで
  const nextHandler = Math.min(
    ...['ipcMain.on(', 'ipcMain.handle(']
      .map((s) => {
        const idx = MAIN_JS.indexOf(s, handlerStart + 30);
        return idx < 0 ? Infinity : idx;
      })
  );
  const handlerBody = MAIN_JS.slice(handlerStart, nextHandler);
  // typeof payload.isPaused === 'boolean' 判定
  assert.match(handlerBody, /typeof\s+payload\.isPaused\s*===\s*['"]boolean['"]/,
    'main.js dual:publish-pre-start-state に typeof payload.isPaused === "boolean" 判定がない（Fix 1 未実装）');
  // sanitized.isPaused = payload.isPaused 代入
  assert.match(handlerBody, /sanitized\.isPaused\s*=\s*payload\.isPaused/,
    'sanitized.isPaused = payload.isPaused 代入がない');
});

// ============================================================
// T2 (Fix 2): rc1/rc2 計測ログ 12 ラベルが全削除されている
// ============================================================
test('T2 (Fix 2): rc1/rc2 計測ログ 12 ラベル全削除（main.js / renderer.js / timer.js / preload.js）', () => {
  const labels = [
    'meas:pause:preStartCheck',
    'meas:pause:onPreStartPause:call',
    'meas:pause:onPreStartPause:skipped',
    'meas:onPreStartPause:invoked',
    'meas:publishPreStart:enter',
    'meas:publishPreStart:exit:ok',
    'meas:publishPreStart:exit:err',
    'meas:hall:applyPreStart:detail',
    'meas:hall:applyPreStart:pausedBranch',
    'meas:hall:applyPreStart:activeBranch',
    'meas:hall:renderPreStartTick:enter',
    'meas:hall:applyTimerState:hallPreStartConflict'
  ];
  for (const label of labels) {
    assert.ok(!MAIN_JS.includes(label), `main.js に ${label} が残存（Fix 2 未完了）`);
    assert.ok(!RENDERER.includes(label), `renderer.js に ${label} が残存（Fix 2 未完了）`);
    assert.ok(!TIMER_JS.includes(label), `timer.js に ${label} が残存（Fix 2 未完了）`);
    assert.ok(!PRELOAD_JS.includes(label), `preload.js に ${label} が残存`);
  }
});

// ============================================================
// T3 (Fix 3): 計測モードバッジが index.html / style.css / renderer.js から削除
// ============================================================
test('T3 (Fix 3): measurement-mode-badge 全削除', () => {
  assert.ok(!INDEX_HTML.includes('measurement-mode-badge'),
    'index.html に measurement-mode-badge が残存（Fix 3 未完了）');
  assert.ok(!STYLE_CSS.includes('measurement-mode-badge'),
    'style.css に measurement-mode-badge が残存（Fix 3 未完了）');
  assert.ok(!RENDERER.includes('measurement-mode-badge'),
    'renderer.js に measurement-mode-badge が残存（Fix 3 未完了）');
});

// ============================================================
// T4: publishPreStartIfOperator が try/catch 1 行形式（rc1 split を元に戻した形）
// ============================================================
test('T4: publishPreStartIfOperator が try/catch 1 行形式', () => {
  const fnMatch = RENDERER.match(/function\s+publishPreStartIfOperator\s*\([^)]*\)\s*\{([\s\S]*?\n\})/);
  assert.ok(fnMatch, 'publishPreStartIfOperator 関数本体が見当たらない');
  const body = fnMatch[1];
  // 1 行 try { ... } catch (_) { /* ignore */ } のパターン
  assert.match(body, /try\s*\{\s*window\.api\.dual\.publishPreStartState\s*\(\s*payload\s*\)\s*;?\s*\}\s*catch\s*\(\s*_\s*\)\s*\{[^}]*\}/,
    'publishPreStartIfOperator の try/catch が 1 行形式ではない（rc1 split が残っている）');
});

// ============================================================
// T5: timer.js pause() の _wasPreStartBeforeSetState / _isPreStartAfterSetState 変数が削除
// ============================================================
test('T5: timer.js pause() の rc1 ローカル変数が削除', () => {
  assert.ok(!TIMER_JS.includes('_wasPreStartBeforeSetState'),
    'timer.js に _wasPreStartBeforeSetState 変数が残存（Fix 2 未完了）');
  assert.ok(!TIMER_JS.includes('_isPreStartAfterSetState'),
    'timer.js に _isPreStartAfterSetState 変数が残存（Fix 2 未完了）');
});

// ============================================================
// T6: timer.js pause() の rc1 観測ログ削除（else ブロックの skipped ログ含む）
// ============================================================
test('T6: timer.js pause() の rc1 観測ログ削除', () => {
  const pauseMatch = TIMER_JS.match(/export\s+function\s+pause\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(pauseMatch, 'pause() 関数本体が見当たらない');
  const body = pauseMatch[1];
  // meas:pause:〜 系のログ呼出が無いこと
  assert.ok(!/meas:pause/.test(body), 'pause() 内に meas:pause ログ呼出が残存');
  // pause() の else ブロックも撤去 → if (isPreStart) 後に else がないことを期待
  // 注: 別の if/else があれば誤検知するが、pause() 本体は短いので最後の括弧を探す
  // body 末尾に直接の if (isPreStart) ブロック後の閉じ括弧構造のみ
  assert.match(body, /if\s*\(\s*isPreStart\s*\)\s*\{[\s\S]*?handlers\.onPreStartPause[\s\S]*?\}\s*$/,
    'pause() 末尾の if (isPreStart) { handlers.onPreStartPause(...) } 構造が崩れている');
});

// ============================================================
// T7: v2.1.15 / v2.1.16 機構保持確認
// ============================================================
test('T7: v2.1.15 / v2.1.16 isPaused 維持機構すべて完全保持', () => {
  // v2.1.15 onPreStartPause / onPreStartResume handler
  assert.match(RENDERER, /onPreStartPause:\s*\(\s*\{[\s\S]*?remainingMs[\s\S]*?\}\s*\)\s*=>/,
    'v2.1.15 onPreStartPause ハンドラ消失');
  assert.match(RENDERER, /onPreStartResume:\s*\(\s*\{[\s\S]*?remainingMs[\s\S]*?\}\s*\)\s*=>/,
    'v2.1.15 onPreStartResume ハンドラ消失');
  // v2.1.15 hallPreStartState.isPaused 拡張
  const hpsMatch = RENDERER.match(/const\s+hallPreStartState\s*=\s*\{([^}]+)\}/);
  assert.ok(hpsMatch, 'hallPreStartState 定義消失');
  assert.match(hpsMatch[1], /isPaused:\s*false/, 'v2.1.15 hallPreStartState.isPaused 初期値消失');
  // v2.1.15 dataset.prestartPaused
  assert.match(RENDERER, /dataset\.prestartPaused\s*=\s*['"]true['"]/,
    'v2.1.15 dataset.prestartPaused="true" セット消失');
  // v2.1.16 onPreStartAdjust isPaused 維持
  assert.match(RENDERER, /onPreStartAdjust[\s\S]*?isPreStartActive[\s\S]*?status\s*===\s*States\.PAUSED/,
    'v2.1.16 onPreStartAdjust isPaused 維持機構消失');
  // v2.1.16 applyHallPreStartState defensive
  assert.match(RENDERER, /Object\.prototype\.hasOwnProperty\.call\s*\(\s*payload\s*,\s*['"]isPaused['"]\s*\)/,
    'v2.1.16 applyHallPreStartState defensive isPaused 消失');
  // timer.js pause() の if (isPreStart) handlers.onPreStartPause 呼出
  assert.match(TIMER_JS, /if\s*\(\s*isPreStart\s*\)\s*\{[\s\S]*?handlers\.onPreStartPause/,
    'timer.js pause() の if (isPreStart) onPreStartPause 呼出消失');
  // timer.js resume() の if (isPreStart) handlers.onPreStartResume 呼出
  assert.match(TIMER_JS, /if\s*\(\s*isPreStart\s*\)\s*\{[\s\S]*?handlers\.onPreStartResume/,
    'timer.js resume() の if (isPreStart) onPreStartResume 呼出消失');
  // timer.js setHandlers の destructure
  const setHandlersMatch = TIMER_JS.match(/export\s+function\s+setHandlers\s*\(\s*\{([^}]+)\}\s*\)/);
  assert.ok(setHandlersMatch, 'timer.js setHandlers 関数定義が見当たらない');
  assert.match(setHandlersMatch[1], /\bonPreStartPause\b/, 'setHandlers onPreStartPause 引数消失');
  assert.match(setHandlersMatch[1], /\bonPreStartResume\b/, 'setHandlers onPreStartResume 引数消失');
});

// ============================================================
// T8 (Fix 4): handlePipShowSlideshow 内の slideshowState.breakStartedAt = null 継続保持
// ============================================================
test('T8 (Fix 4): handlePipShowSlideshow の breakStartedAt = null 継続保持（試験 5 修正）', () => {
  const fnMatch = RENDERER.match(/function\s+handlePipShowSlideshow\s*\(\s*\)\s*\{([\s\S]*?\n\})/);
  assert.ok(fnMatch, 'handlePipShowSlideshow 関数本体が見当たらない');
  const body = fnMatch[1];
  assert.match(body, /slideshowState\.breakStartedAt\s*=\s*null/,
    'handlePipShowSlideshow 内の slideshowState.breakStartedAt = null が消失（rc1 で追加した試験 5 修正の継続失敗）');
});

// ============================================================
// T9 (Fix 6): package.json version が 2.1.18（-rc2 サフィックスなし）
// ============================================================
test('T9 (Fix 6): package.json version が 2.1.17', () => {
  assert.equal(PKG.version, '2.4.0', `package.json version が 2.1.17 ではない（実際: ${PKG.version}）`);
});

// ============================================================
// T10: 致命バグ保護 5 件 cross-check
// ============================================================
test('T10: 致命バグ保護 5 件すべて維持（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）', () => {
  // C.2.7-A: resetBlindProgressOnly 関数が存在
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly 関数が消失');
  // C.2.7-D: tournaments:setDisplaySettings ハンドラ存在
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラが消失');
  // C.1-A2: ensureEditorEditableState 関数が存在
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState 関数が消失');
  // C.1.7: AudioContext resume 防御
  assert.match(AUDIO_JS, /\.resume\s*\(\s*\)/,
    'C.1.7: AudioContext resume 防御が消失');
  // C.1.8: schedulePersistRuntime 関数 + 8 箇所以上の呼出
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/,
    'C.1.8: schedulePersistRuntime 関数が消失（renderer.js）');
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(/g) || []).length;
  assert.ok(callCount >= 9, `C.1.8: schedulePersistRuntime 出現回数が ${callCount} 件（9 件以上必要）`);
});

// ============================================================
// T11: v2.1.6〜v2.1.16 機構（dual-sync diff buffer / hall atomic update / isBreakLevel import / computeHeaderLevelText / 構造同期 2 穴根治 / isSlideshowEligibleStatus 拡張）touch なし
// ============================================================
test('T11: v2.1.6〜v2.1.16 機構すべて完全保持', () => {
  // v2.1.7 hall atomic update（dual-sync diff buffer）
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js')),
    'v2.1.7 dual-sync.js 消失');
  // v2.1.11 hall 自前 60fps tick
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/,
    'v2.1.11 renderHallTickFrame 関数消失');
  // v2.1.13 PRE_START data-status セット経路
  assert.match(RENDERER, /el\.clock\.dataset\.status\s*=\s*['"]PRE_START['"]/,
    'v2.1.13 data-status PRE_START セット経路消失');
  // v2.1.14 構造同期 2 穴根治
  assert.match(MAIN_JS, /_publishDualState\s*\(\s*['"]structure['"]\s*,\s*preset\s*\)/,
    'v2.1.14 tournaments:setActive structure broadcast 消失');
  assert.match(MAIN_JS, /snapshot\.structure\s*===\s*null/,
    'v2.1.14 dual:state-sync-init 内の snapshot.structure === null ガード消失');
  // v2.1.15 isBreakLevel import
  const importBlock = RENDERER.match(/import\s*\{[^}]*\}\s*from\s*['"]\.\/blinds\.js['"]/);
  assert.ok(importBlock && /\bisBreakLevel\b/.test(importBlock[0]),
    'v2.1.15 isBreakLevel import 消失');
  // v2.1.15 computeHeaderLevelText
  assert.match(RENDERER, /function\s+computeHeaderLevelText\s*\(/,
    'v2.1.15 computeHeaderLevelText 関数消失');
  // v2.1.16 isSlideshowEligibleStatus 拡張（PAUSED 経路）
  const islideMatch = RENDERER.match(/function\s+isSlideshowEligibleStatus\s*\(\s*status\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(islideMatch, 'isSlideshowEligibleStatus 関数消失');
  assert.match(islideMatch[1], /status\s*===\s*States\.PAUSED/,
    'v2.1.16 isSlideshowEligibleStatus PAUSED 経路消失');
});

console.log(`\n結果: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
