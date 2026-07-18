/**
 * v2.1.15 静的解析テスト — ①②③ 統合根治（rc1 観測ログから真因確定）
 *
 *   Fix 1: renderer.js import に `isBreakLevel` 追加（③② 共通根治）
 *   Fix 2: renderer.js `computeHeaderLevelText` ヘルパ追加 + ヘッダー表示ロジック書き換え（②）
 *   Fix 3: timer.js `pause()` / `resume()` に onPreStartPause / onPreStartResume 通知追加（①）
 *   Fix 4: renderer.js setHandlers 登録に onPreStartPause / onPreStartResume 追加（①）
 *   Fix 5: renderer.js hallPreStartState に isPaused、applyHallPreStartState で受信、
 *          renderHallPreStartTick で早期 return、style.css に「一時停止中」ラベル（①）
 *   Fix 6: rc1 計測ログ 6 ラベル + 計測モードバッジ完全撤去
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 *
 * 実行: node tests/v227-three-bug-integration-fix.test.js
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
const AUDIO_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1 (Fix 1): renderer.js の blinds.js import 文に isBreakLevel が含まれる
// ============================================================
test('T1 (Fix 1): renderer.js blinds.js import に isBreakLevel が含まれる', () => {
  // import { ... isBreakLevel ... } from './blinds.js';
  const importBlock = RENDERER.match(/import\s*\{[^}]*\}\s*from\s*['"]\.\/blinds\.js['"]/);
  assert.ok(importBlock, "renderer.js に './blinds.js' からの import 文が存在しない");
  assert.match(importBlock[0], /\bisBreakLevel\b/, "import 文に isBreakLevel が含まれていない（Fix 1 未実装）");
});

// ============================================================
// T2 (Fix 2): computeHeaderLevelText 関数が renderer.js に存在
// ============================================================
test('T2 (Fix 2): computeHeaderLevelText 関数が renderer.js に存在し BREAK 行で「次のレベル: Lv N」を返す', () => {
  assert.match(RENDERER, /function\s+computeHeaderLevelText\s*\(\s*currentLevelIndex\s*\)/,
    'computeHeaderLevelText 関数が定義されていない（Fix 2 未実装）');
  // BREAK 行で「次のレベル: Lv N」テンプレートリテラルを生成する経路があることを確認
  const fnMatch = RENDERER.match(/function\s+computeHeaderLevelText\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'computeHeaderLevelText の関数本体が抽出できない');
  assert.match(fnMatch[0], /次のレベル:\s*Lv/, 'BREAK 行の「次のレベル: Lv N」表示文字列が含まれていない');
});

// ============================================================
// T3 (Fix 2): 通常レベルでは BREAK 行を除いた連番を返す（regularCount 参照）
// ============================================================
test('T3 (Fix 2): computeHeaderLevelText は通常レベルで regularCount 連番を返す', () => {
  const fnMatch = RENDERER.match(/function\s+computeHeaderLevelText\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'computeHeaderLevelText の関数本体が抽出できない');
  // !levels[i]?.isBreak で件数を数える経路が存在すること
  assert.match(fnMatch[0], /!levels\[i\]\?\.isBreak/,
    'BREAK 行を除外した連番計算が見当たらない');
  // String(regularCount) で返す経路があること
  assert.match(fnMatch[0], /return\s+String\s*\(\s*regularCount\s*\)/,
    '通常レベルの連番返却（String(regularCount)）が見当たらない');
});

// ============================================================
// T4 (Fix 2): 末尾 BREAK の場合「BREAK」フォールバック表示
// ============================================================
test('T4 (Fix 2): 末尾 BREAK の場合「BREAK」フォールバック', () => {
  const fnMatch = RENDERER.match(/function\s+computeHeaderLevelText\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'computeHeaderLevelText の関数本体が抽出できない');
  assert.match(fnMatch[0], /hasNext\s*\?\s*`次のレベル:\s*Lv\$\{[^}]+\}`\s*:\s*['"]BREAK['"]/,
    '末尾 BREAK のフォールバック (hasNext ? ... : "BREAK") が見当たらない');
});

// ============================================================
// T5 (Fix 3): timer.js setHandlers の引数 destructure に onPreStartPause / onPreStartResume
// ============================================================
test('T5 (Fix 3): timer.js setHandlers 引数 destructure に onPreStartPause / onPreStartResume', () => {
  const setHandlersMatch = TIMER_JS.match(/export\s+function\s+setHandlers\s*\(\s*\{([^}]+)\}\s*\)/);
  assert.ok(setHandlersMatch, 'timer.js setHandlers 関数定義が見当たらない');
  const args = setHandlersMatch[1];
  assert.match(args, /\bonPreStartPause\b/, 'setHandlers 引数に onPreStartPause がない（Fix 3 未実装）');
  assert.match(args, /\bonPreStartResume\b/, 'setHandlers 引数に onPreStartResume がない（Fix 3 未実装）');
});

// ============================================================
// T6 (Fix 3): timer.js pause() 関数末尾に if (isPreStart) ガード付き onPreStartPause 呼出
// ============================================================
test('T6 (Fix 3): timer.js pause() 関数内で if(isPreStart) ガード付き handlers.onPreStartPause(...) 呼出', () => {
  const pauseMatch = TIMER_JS.match(/export\s+function\s+pause\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(pauseMatch, 'timer.js pause() 関数本体が見当たらない');
  const body = pauseMatch[1];
  assert.match(body, /if\s*\(\s*isPreStart\s*\)\s*\{[\s\S]*?handlers\.onPreStartPause\s*\(\s*\{[\s\S]*?remainingMs[\s\S]*?\}\s*\)/,
    'pause() 内に if (isPreStart) { handlers.onPreStartPause({ remainingMs }) } の経路がない（Fix 3 未実装）');
});

// ============================================================
// T7 (Fix 3): timer.js resume() 関数の if (isPreStart) ブロック内で onPreStartResume 呼出
// ============================================================
test('T7 (Fix 3): timer.js resume() 関数の if(isPreStart) ブロック内で handlers.onPreStartResume(...) 呼出', () => {
  const resumeMatch = TIMER_JS.match(/export\s+function\s+resume\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(resumeMatch, 'timer.js resume() 関数本体が見当たらない');
  const body = resumeMatch[1];
  // resume() 内では if (isPreStart) ブロックの中で onPreStartResume が呼ばれる
  assert.match(body, /if\s*\(\s*isPreStart\s*\)\s*\{[\s\S]*?handlers\.onPreStartResume\s*\(\s*\{[\s\S]*?remainingMs[\s\S]*?\}\s*\)/,
    'resume() 内に if (isPreStart) { ... handlers.onPreStartResume({ remainingMs }) } の経路がない（Fix 3 未実装）');
});

// ============================================================
// T8 (Fix 4): renderer.js setHandlers 登録に onPreStartPause / onPreStartResume ハンドラが定義
// ============================================================
test('T8 (Fix 4): renderer.js setHandlers 登録に onPreStartPause / onPreStartResume', () => {
  // setHandlers({ ... }) の引数オブジェクトリテラル内
  assert.match(RENDERER, /onPreStartPause:\s*\(\s*\{[\s\S]*?remainingMs[\s\S]*?\}\s*\)\s*=>/,
    'renderer.js setHandlers に onPreStartPause ハンドラ定義がない');
  assert.match(RENDERER, /onPreStartResume:\s*\(\s*\{[\s\S]*?remainingMs[\s\S]*?\}\s*\)\s*=>/,
    'renderer.js setHandlers に onPreStartResume ハンドラ定義がない');
  // publishPreStartIfOperator 経由で hall に isPaused / isActive を broadcast している
  assert.match(RENDERER, /publishPreStartIfOperator\s*\(\s*\{[^}]*isActive:\s*true[\s\S]*?isPaused:\s*true[^}]*\}\s*\)/,
    'onPreStartPause が publishPreStartIfOperator({ isActive: true, isPaused: true }) を呼んでいない');
  assert.match(RENDERER, /publishPreStartIfOperator\s*\(\s*\{[^}]*isActive:\s*true[\s\S]*?isPaused:\s*false[^}]*\}\s*\)/,
    'onPreStartResume が publishPreStartIfOperator({ isActive: true, isPaused: false }) を呼んでいない');
});

// ============================================================
// T9 (Fix 5): applyHallPreStartState 内で payload.isPaused を読み取って hallPreStartState.isPaused にセット
// ============================================================
test('T9 (Fix 5): applyHallPreStartState で isPaused 受信 + hallPreStartState.isPaused 更新', () => {
  const fnMatch = RENDERER.match(/function\s+applyHallPreStartState\s*\([^)]*\)\s*\{([\s\S]*?\n\})/);
  assert.ok(fnMatch, 'applyHallPreStartState 関数本体が見当たらない');
  const body = fnMatch[1];
  // v2.1.16: 元の `const isPaused = !!payload.isPaused` から `hasOwnProperty` 検査による defensive 化に進化。
  //   両パターンで「const isPaused = ...」+ payload.isPaused 参照を含むことを許容。
  assert.match(body, /const\s+isPaused\s*=[\s\S]*?payload\.isPaused/,
    'applyHallPreStartState 内で isPaused 抽出経路がない（Fix 5 未実装）');
  assert.match(body, /hallPreStartState\.isPaused\s*=\s*isPaused/,
    'hallPreStartState.isPaused = isPaused の代入が見当たらない');
  // 一時停止中の固定表示経路（dataset.prestartPaused = 'true'）が存在すること
  assert.match(body, /dataset\.prestartPaused\s*=\s*['"]true['"]/,
    '一時停止中の dataset.prestartPaused = "true" セットが見当たらない');
});

// ============================================================
// T10 (Fix 5): renderHallPreStartTick 冒頭に hallPreStartState.isPaused 早期 return
// ============================================================
test('T10 (Fix 5): renderHallPreStartTick 冒頭に hallPreStartState.isPaused 早期 return', () => {
  const fnMatch = RENDERER.match(/function\s+renderHallPreStartTick\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'renderHallPreStartTick 関数本体が見当たらない');
  const body = fnMatch[1];
  // 冒頭で early return（!isActive || isPaused）
  assert.match(body, /if\s*\(\s*!hallPreStartState\.isActive\s*\|\|\s*hallPreStartState\.isPaused\s*\)\s*return/,
    'renderHallPreStartTick 冒頭の early return に hallPreStartState.isPaused が含まれていない（Fix 5 未実装）');
});

// ============================================================
// T11 (Fix 5): style.css に [data-role="hall"] .clock[data-prestart-paused="true"]::after セレクタ + 「一時停止中」content
// ============================================================
test('T11 (Fix 5): style.css に「一時停止中」ラベル表示ルールが存在（v2.1.15 ::after / v2.1.20-rc1 .clock__pause-label のいずれか）', () => {
  // v2.1.15 ① 当初実装: [data-role="hall"] .clock[data-prestart-paused="true"]::after + content: '一時停止中'
  // v2.1.20-rc1 症状 1 修正: 上記を撤去し、通常 PAUSED と同じ .clock__pause-label を流用（HTML 側に「一時停止中」テキストあり）
  const HAS_OLD = /\[data-role="hall"\]\s*\.clock\[data-prestart-paused="true"\]::after/.test(STYLE_CSS);
  const HAS_NEW = /\.clock\[data-prestart-paused="true"\]\s+\.clock__pause-label\s*\{[^}]*opacity\s*:\s*1/.test(STYLE_CSS);
  assert.ok(HAS_OLD || HAS_NEW,
    'style.css に PRE_START 一時停止時の「一時停止中」表示ルールが見つからない（v2.1.15 ::after または v2.1.20-rc1 .clock__pause-label 経由のいずれか必須）');
  if (HAS_OLD) {
    const blockMatch = STYLE_CSS.match(/\[data-role="hall"\]\s*\.clock\[data-prestart-paused="true"\]::after\s*\{([^}]+)\}/);
    assert.ok(blockMatch, 'CSS ブロック本体が抽出できない');
    assert.match(blockMatch[1], /content:\s*['"]一時停止中['"]/,
      '旧 ::after 形式の content プロパティに「一時停止中」が含まれていない');
  }
  // 新形式は HTML 側 <div class="clock__pause-label">一時停止中</div> が表示テキストの真実源
});

// ============================================================
// T12 (Fix 6): rc1 計測ログ 6 ラベルが全ファイルから削除済み
// ============================================================
test('T12 (Fix 6): rc1 計測ログ 6 ラベルすべて 0 件（main.js / renderer.js / timer.js）', () => {
  const labels = [
    'meas:structure:publish',
    'meas:structure:recv',
    'meas:isBreakLevel:check',
    'meas:preset:save',
    'meas:headerLevel:render',
    'meas:timer:pause:enter'
  ];
  for (const label of labels) {
    assert.ok(!MAIN_JS.includes(label), `main.js に ${label} が残存（Fix 6 未完了）`);
    assert.ok(!RENDERER.includes(label), `renderer.js に ${label} が残存（Fix 6 未完了）`);
    assert.ok(!TIMER_JS.includes(label), `timer.js に ${label} が残存（Fix 6 未完了）`);
  }
});

// ============================================================
// T13 (Fix 6): rc1 計測モードバッジ — 本番ビルドでは削除、-rcN ビルドでは復活許容
//   v2.1.15 で撤去、v2.1.17-rc1 で復活（観測ビルド用）、v2.1.17 本番で再撤去予定。
//   PKG.version に -rcN サフィックスがあればバッジ存在許容、無ければ撤去状態を強制。
// ============================================================
test('T13 (Fix 6): 計測モードバッジ要素 (measurement-mode-badge) — 本番では削除、rc では復活許容', () => {
  const isRc = /-rc\d+/.test(PKG.version || '');
  if (isRc) {
    // -rcN ビルドではバッジが存在することを許容（観測ビルド用、v2.1.15-rc1 / v2.1.17-rc1 のパターン）
    return;
  }
  assert.ok(!INDEX_HTML.includes('measurement-mode-badge'),
    'index.html に measurement-mode-badge が残存（本番ビルドでは Fix 6 未完了）');
  assert.ok(!STYLE_CSS.includes('measurement-mode-badge'),
    'style.css に measurement-mode-badge が残存（本番ビルドでは Fix 6 未完了）');
  assert.ok(!RENDERER.includes('measurement-mode-badge'),
    'renderer.js に measurement-mode-badge が残存（本番ビルドでは Fix 6 未完了）');
});

// ============================================================
// T14 (Fix 7): package.json version が 2.1.18（rc1 サフィックスなし）
// ============================================================
test('T14 (Fix 7): package.json version が 2.1.15', () => {
  assert.equal(PKG.version, '2.10.0', `package.json version が 2.1.15 ではない（実際: ${PKG.version}）`);
});

// ============================================================
// T15: 致命バグ保護 5 件 cross-check
// ============================================================
test('T15: 致命バグ保護 5 件すべて維持（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）', () => {
  // C.2.7-A: resetBlindProgressOnly 関数が存在
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly 関数が消失');
  // C.2.7-D: tournaments:setDisplaySettings ハンドラ内で timerState を destructure 除外
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラが消失');
  // C.1-A2: ensureEditorEditableState 関数が存在
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState 関数が消失');
  // C.1.7: AudioContext resume 防御（_play 内で resume コール）
  assert.match(AUDIO_JS, /\.resume\s*\(\s*\)/,
    'C.1.7: AudioContext resume 防御が消失');
  // C.1.8: schedulePersistRuntime 関数が renderer.js に存在 + 8 箇所以上の呼出
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/,
    'C.1.8: schedulePersistRuntime 関数が消失（renderer.js）');
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(/g) || []).length;
  // 関数定義 1 + 呼出 8 以上 = 9 回以上出現
  assert.ok(callCount >= 9, `C.1.8: schedulePersistRuntime 出現回数が ${callCount} 件（9 件以上必要）`);
});

// ============================================================
// T16: v2.1.6〜v2.1.14 機構（PRE_START broadcast 既存経路 / hall atomic update / hall 60fps tick / userOverride リセット / data-status セット / 構造同期 2 穴根治）touch なし
// ============================================================
test('T16: v2.1.6〜v2.1.14 機構すべて完全保持（既存ロジック書換は最小侵襲）', () => {
  // v2.1.6 PRE_START broadcast: onPreStartStart / onPreStartCancel 経路が hallPreStartState 経由で既存
  assert.match(RENDERER, /onPreStartStart:\s*\(\s*\{[\s\S]*?totalMs[\s\S]*?startAtMs[\s\S]*?\}\s*\)\s*=>/,
    'v2.1.6 onPreStartStart broadcast 経路消失');
  assert.match(RENDERER, /onPreStartCancel:\s*\(\s*\)\s*=>\s*\{\s*publishPreStartIfOperator\s*\(\s*\{\s*isActive:\s*false\s*\}\s*\)/,
    'v2.1.6 onPreStartCancel broadcast 経路消失');
  // v2.1.7 hall atomic update（dual-sync diff buffer）
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js')),
    'v2.1.7 dual-sync.js 消失');
  // v2.1.11 hall 自前 60fps tick（renderHallTickFrame）
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/,
    'v2.1.11 renderHallTickFrame 関数消失');
  // v2.1.13 PRE_START data-status セット
  assert.match(RENDERER, /el\.clock\.dataset\.status\s*=\s*['"]PRE_START['"]/,
    'v2.1.13 data-status PRE_START セット経路消失');
  // v2.1.14 構造同期 2 穴根治
  assert.match(MAIN_JS, /_publishDualState\s*\(\s*['"]structure['"]\s*,\s*preset\s*\)/,
    'v2.1.14 tournaments:setActive structure broadcast 消失');
  assert.match(MAIN_JS, /snapshot\.structure\s*===\s*null/,
    'v2.1.14 dual:state-sync-init 内の snapshot.structure === null ガード消失');
});

console.log(`\n結果: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
