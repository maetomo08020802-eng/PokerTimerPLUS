/**
 * v2.1.18-rc1 静的解析テスト — トーナメント終了オーバーレイ実装
 *
 *   index.html: 既存 #js-timer-finished-overlay div を再構成、main + sub の 2 行
 *   style.css : .clock__timer-finished-overlay をオレンジ枠 (#FF8C1A) + 中央配置 + clamp/vw 自動縮小に変更
 *               .clock__timer-finished-main / .clock__timer-finished-sub クラス追加
 *   timer.js  : handlers に onTournamentComplete 追加、advanceToNextLevel で最終レベル完走時に発火
 *   renderer.js: setHandlers で onTournamentComplete 登録 → operator local オーバーレイ表示
 *               captureCurrentTimerState で「最終レベル + IDLE + 0 remainingMs」検知 → 'finished' 返却
 *               （hall 同期は既存 dual-sync timerState 経路 + applyTimerStateToTimer 'finished' 分岐で完結）
 *   解除      : 既存 handleReset / resetBlindProgressOnly の `el.clock?.classList.remove('clock--timer-finished')` で対応
 *
 * 新規 IPC 追加なし: main.js sanitization 既存 normalizeTimerState の VALID_TIMER_STATUS に 'finished' は既に含まれている。
 *
 * 致命バグ保護 5 件すべて完全無傷。
 *
 * 実行: node tests/v231-tournament-end-overlay.test.js
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
const STYLE_CSS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: index.html に id="js-timer-finished-overlay" 要素存在 + main / sub 2 行構成
// ============================================================
test('T1: index.html に #js-timer-finished-overlay 要素 + main/sub 2 行構成', () => {
  // div id="js-timer-finished-overlay" 存在
  assert.match(INDEX_HTML, /id="js-timer-finished-overlay"/,
    'index.html に #js-timer-finished-overlay 要素がない');
  // main 「トーナメント終了」と sub 「TOURNAMENT COMPLETE」の 2 行構成
  assert.match(INDEX_HTML, /<span\s+class="clock__timer-finished-main"[^>]*>\s*トーナメント終了\s*<\/span>/,
    'main 「トーナメント終了」span がない');
  assert.match(INDEX_HTML, /<span\s+class="clock__timer-finished-sub"[^>]*>\s*TOURNAMENT\s+COMPLETE\s*<\/span>/,
    'sub 「TOURNAMENT COMPLETE」span がない');
});

// ============================================================
// T2: style.css に オレンジ枠 + 中央配置 + clamp/vw + サブクラスフォント指定
// ============================================================
test('T2: style.css に オレンジ枠 + 中央配置 + clamp/vw + main/sub スタイル', () => {
  // .clock__timer-finished-overlay にオレンジ枠
  const overlayMatch = STYLE_CSS.match(/\.clock__timer-finished-overlay\s*\{([^}]+)\}/);
  assert.ok(overlayMatch, '.clock__timer-finished-overlay クラスが消失');
  const overlayBody = overlayMatch[1];
  // オレンジ #FF8C1A 枠
  assert.match(overlayBody, /border:\s*[\d.]+\w*\s+solid\s+#FF8C1A/i,
    '.clock__timer-finished-overlay にオレンジ #FF8C1A 枠がない');
  // 中央配置
  assert.match(overlayBody, /position:\s*absolute/, 'position: absolute がない');
  assert.match(overlayBody, /top:\s*50%/, 'top: 50% がない');
  assert.match(overlayBody, /left:\s*50%/, 'left: 50% がない');
  // 不透明背景 #0a0a0a
  assert.match(overlayBody, /background-color:\s*#0a0a0a/i,
    '不透明背景 #0a0a0a がない');
  // .clock__timer-finished-main クラス
  const mainMatch = STYLE_CSS.match(/\.clock__timer-finished-main\s*\{([^}]+)\}/);
  assert.ok(mainMatch, '.clock__timer-finished-main クラスがない');
  const mainBody = mainMatch[1];
  assert.match(mainBody, /font-size:\s*clamp/, 'main フォントサイズに clamp() がない');
  assert.match(mainBody, /color:\s*#FF8C1A/i, 'main フォント色 #FF8C1A がない');
  // .clock__timer-finished-sub クラス
  const subMatch = STYLE_CSS.match(/\.clock__timer-finished-sub\s*\{([^}]+)\}/);
  assert.ok(subMatch, '.clock__timer-finished-sub クラスがない');
  const subBody = subMatch[1];
  assert.match(subBody, /font-size:\s*clamp/, 'sub フォントサイズに clamp() がない');
  assert.match(subBody, /color:\s*#FFA94D/i, 'sub フォント色 #FFA94D がない');
});

// ============================================================
// T3: 最終レベル到達検知ロジック存在
//   - timer.js advanceToNextLevel で onTournamentComplete 発火
//   - renderer.js captureCurrentTimerState で 「最終レベル + IDLE + remainingMs===0」検知 → 'finished' 返却
// ============================================================
test('T3: 最終レベル到達検知ロジック（timer.js + renderer.js captureCurrentTimerState）', () => {
  // timer.js advanceToNextLevel 内で onTournamentComplete 発火
  const advanceMatch = TIMER_JS.match(/function\s+advanceToNextLevel\s*\(\s*\)\s*\{([\s\S]*?\n\})/);
  assert.ok(advanceMatch, 'timer.js advanceToNextLevel 関数本体が見当たらない');
  const advanceBody = advanceMatch[1];
  assert.match(advanceBody, /target\s*>=\s*getLevelCount\s*\(\s*\)/,
    'advanceToNextLevel に target >= getLevelCount() 判定がない');
  assert.match(advanceBody, /handlers\.onTournamentComplete\s*\(\s*\)/,
    'advanceToNextLevel で handlers.onTournamentComplete() 呼出がない（Fix 3 未実装）');
  // renderer.js captureCurrentTimerState で 'finished' 返却
  const captureMatch = RENDERER.match(/function\s+captureCurrentTimerState\s*\(\s*\)\s*\{([\s\S]*?\n\})/);
  assert.ok(captureMatch, 'captureCurrentTimerState 関数本体が見当たらない');
  const captureBody = captureMatch[1];
  // lastLevelIndex / getLevelCount + remainingMs === 0 + status === IDLE 判定
  assert.match(captureBody, /getLevelCount\s*\(\s*\)/,
    'captureCurrentTimerState で getLevelCount() 呼出がない');
  assert.match(captureBody, /remainingMs\s*===\s*0/,
    'captureCurrentTimerState で remainingMs === 0 判定がない');
  // status: 'finished' 返却
  assert.match(captureBody, /status:\s*['"]finished['"]/,
    "captureCurrentTimerState で status: 'finished' 返却がない");
});

// ============================================================
// T4: 表示制御関数存在 = renderer.js で onTournamentComplete を登録 + clock--timer-finished クラス付与
// ============================================================
test('T4: renderer.js setHandlers の onTournamentComplete 登録 + clock--timer-finished クラス付与', () => {
  // setHandlers ブロック内 (またはどこか) で onTournamentComplete: () => { ... clock--timer-finished ... } のパターン
  assert.match(RENDERER, /onTournamentComplete:\s*\(\s*\)\s*=>\s*\{[\s\S]*?clock--timer-finished/,
    'renderer.js setHandlers に onTournamentComplete 登録 + clock--timer-finished クラス付与がない');
  // timer.js setHandlers の引数 destructure に onTournamentComplete 含む
  const setHandlersMatch = TIMER_JS.match(/export\s+function\s+setHandlers\s*\(\s*\{([^}]+)\}\s*\)/);
  assert.ok(setHandlersMatch, 'timer.js setHandlers 関数定義が見当たらない');
  assert.match(setHandlersMatch[1], /\bonTournamentComplete\b/,
    'timer.js setHandlers の引数 destructure に onTournamentComplete がない');
});

// ============================================================
// T5: リセット経路 / resetBlindProgressOnly で clock--timer-finished クラス削除（既存挙動維持）
// ============================================================
test('T5: handleReset / resetBlindProgressOnly で clock--timer-finished 解除（既存維持）', () => {
  // handleReset 内で classList.remove('clock--timer-finished')
  const resetMatch = RENDERER.match(/function\s+handleReset\s*\(\s*\)\s*\{([\s\S]*?\n\})/);
  assert.ok(resetMatch, 'handleReset 関数本体が見当たらない');
  assert.match(resetMatch[1], /classList\.remove\s*\(\s*['"]clock--timer-finished['"]\s*\)/,
    'handleReset 内に clock--timer-finished クラス削除がない');
  // resetBlindProgressOnly 内で classList.remove('clock--timer-finished')
  const rbpoMatch = RENDERER.match(/function\s+resetBlindProgressOnly\s*\(\s*\)\s*\{([\s\S]*?\n\})/);
  assert.ok(rbpoMatch, 'resetBlindProgressOnly 関数本体が見当たらない');
  assert.match(rbpoMatch[1], /classList\.remove\s*\(\s*['"]clock--timer-finished['"]\s*\)/,
    'resetBlindProgressOnly 内に clock--timer-finished クラス削除がない');
});

// ============================================================
// T6: 新規 IPC 追加なし（既存 normalizeTimerState の 'finished' status を再利用、4 経路完全網羅 = 不要）
//   - VALID_TIMER_STATUS に 'finished' が含まれている
//   - applyTimerStateToTimer の 'finished' 経路で clock--timer-finished クラス付与
// ============================================================
test('T6: 新規 IPC 追加不要、既存 normalizeTimerState 経路で hall 同期完結', () => {
  // main.js VALID_TIMER_STATUS に 'finished'
  assert.match(MAIN_JS, /VALID_TIMER_STATUS\s*=\s*\[[^\]]*['"]finished['"]/,
    "main.js VALID_TIMER_STATUS に 'finished' がない");
  // applyTimerStateToTimer 内に if (ts.status === 'finished') 経路 + clock--timer-finished クラス付与
  assert.match(RENDERER, /if\s*\(\s*ts\.status\s*===\s*['"]finished['"]\s*\)[\s\S]*?classList\.add\s*\(\s*['"]clock--timer-finished['"]\s*\)/,
    "applyTimerStateToTimer に ts.status === 'finished' 経路 + clock--timer-finished クラス付与がない");
});

console.log(`\n結果: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
