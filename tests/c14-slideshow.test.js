/**
 * STEP 10 フェーズC.1.4 — 休憩中スライドショー + PIP タイマーの回帰防止テスト
 *
 * 検証対象:
 *   Fix 1: データモデル拡張（breakImages / breakImageInterval / pipSize + sanitize）
 *   Fix 2: 設定タブ UI（break-images-panel）
 *   Fix 3: スライドショー全画面表示モード
 *   Fix 4: PIP タイマー（右下縮小、Barlow Condensed、3 サイズ切替）
 *   Fix 5: 手動切替ボタン 2 種 + userOverride
 *   Fix 6: 残り 60 秒自動復帰 + ボタン disabled
 *
 * 実行: node tests/c14-slideshow.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');

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
// T1: sanitizeBreakImages の上限 + 不正 prefix 弾き
// ============================================================
test('T1: sanitizeBreakImages が 20 枚上限 + 不正 prefix を弾く', () => {
  assert.match(MAIN, /BREAK_IMAGES_MAX_COUNT\s*=\s*20/, 'BREAK_IMAGES_MAX_COUNT が 20 で定義されていない');
  assert.match(MAIN, /function\s+sanitizeBreakImages\s*\(/, 'sanitizeBreakImages 関数定義がない');
  const body = extractFunctionBody(MAIN, 'sanitizeBreakImages');
  assert.ok(body, 'sanitizeBreakImages の関数本体抽出失敗');
  // 20 枚で break する処理（length >= 20 で break 等）
  assert.match(body, /BREAK_IMAGES_MAX_COUNT/, '20 枚上限の参照がない');
  // 各要素を sanitizeBackgroundImage で検証している
  assert.match(body, /sanitizeBackgroundImage/, '個別検証に sanitizeBackgroundImage を使っていない');
});

// ============================================================
// T2: sanitizeBreakImageInterval が 3〜60 範囲外を 10 に補正
// ============================================================
test("T2: sanitizeBreakImageInterval が 3〜60 範囲外を 10 に補正", () => {
  assert.match(MAIN, /function\s+sanitizeBreakImageInterval\s*\(/, 'sanitizeBreakImageInterval 関数定義がない');
  const body = extractFunctionBody(MAIN, 'sanitizeBreakImageInterval');
  assert.ok(body, '関数本体抽出失敗');
  // 3 と 60 の境界、10 のフォールバック
  assert.match(body, /<\s*3\s*\|\|\s*v\s*>\s*60/, '3〜60 範囲外検出ロジックがない');
  assert.match(body, /return\s+10\b/, '範囲外時に 10 を返す経路がない');
});

// ============================================================
// T3: sanitizePipSize が 'small'/'medium'/'large' 以外を 'medium' に補正
// ============================================================
test("T3: sanitizePipSize が VALID_PIP_SIZES 以外を 'medium' に補正", () => {
  assert.match(MAIN, /VALID_PIP_SIZES\s*=\s*\[\s*['"]small['"]\s*,\s*['"]medium['"]\s*,\s*['"]large['"]\s*\]/,
    "VALID_PIP_SIZES が ['small','medium','large'] で定義されていない");
  assert.match(MAIN, /function\s+sanitizePipSize\s*\(/, 'sanitizePipSize 関数定義がない');
  const body = extractFunctionBody(MAIN, 'sanitizePipSize');
  assert.ok(body, '関数本体抽出失敗');
  assert.match(body, /['"]medium['"]/, "fallback 'medium' がない");
});

// ============================================================
// T4: displaySettings 既定値に breakImages: [] / breakImageInterval: 10 / pipSize: 'medium'
// ============================================================
test("T4: DEFAULT_TOURNAMENT_EXT.displaySettings + store.defaults.display に breakImages/Interval/pipSize", () => {
  // DEFAULT_TOURNAMENT_EXT.displaySettings ブロックに breakImages: [] / breakImageInterval: 10 / pipSize: 'medium'
  assert.match(MAIN, /breakImages\s*:\s*\[\s*\]/, "breakImages: [] の既定値がない");
  assert.match(MAIN, /breakImageInterval\s*:\s*10/, "breakImageInterval: 10 の既定値がない");
  assert.match(MAIN, /pipSize\s*:\s*['"]medium['"]/, "pipSize: 'medium' の既定値がない");
});

// ============================================================
// T5: renderer.js に slideshowState / userOverride / autoEndedAt
// ============================================================
test('T5: renderer.js に slideshowState 構造 + userOverride + autoEndedAt フィールド', () => {
  assert.match(RENDERER, /const\s+slideshowState\s*=\s*\{/, 'slideshowState 定義がない');
  assert.match(RENDERER, /userOverride\s*:\s*['"]auto['"]/, "userOverride: 'auto' 既定値がない");
  assert.match(RENDERER, /autoEndedAt\s*:/, 'autoEndedAt フィールドがない');
  assert.match(RENDERER, /SLIDESHOW_AUTO_END_MS\s*=\s*60_?000/, 'SLIDESHOW_AUTO_END_MS = 60000 がない');
});

// ============================================================
// T6: スライドショー開始ロジックが BREAK / PRE_START 両方をトリガ
// ============================================================
test('T6: isSlideshowEligibleStatus が BREAK と PRE_START 両方をカバー', () => {
  assert.match(RENDERER, /function\s+isSlideshowEligibleStatus\s*\(/, 'isSlideshowEligibleStatus 関数がない');
  const body = extractFunctionBody(RENDERER, 'isSlideshowEligibleStatus');
  assert.ok(body, '関数本体抽出失敗');
  assert.match(body, /States\.BREAK/, 'States.BREAK のチェックがない');
  assert.match(body, /States\.PRE_START/, 'States.PRE_START のチェックがない');
});

// ============================================================
// T7: 残り 60 秒自動復帰ロジックが <= 60_000 ms で発火
// ============================================================
test('T7: syncSlideshowFromState の残り 60 秒自動 OFF 判定', () => {
  const body = extractFunctionBody(RENDERER, 'syncSlideshowFromState');
  assert.ok(body, 'syncSlideshowFromState 関数本体抽出失敗');
  // remainingMs <= SLIDESHOW_AUTO_END_MS
  assert.match(body, /remainingMs\s*<=\s*SLIDESHOW_AUTO_END_MS/,
    '残り 60 秒以下の判定がない');
  // autoEndedAt にフラグして 1 回だけ deactivate
  assert.match(body, /autoEndedAt/, 'autoEndedAt の重複防止フラグがない');
  assert.match(body, /deactivateSlideshow\s*\(\s*\)/, 'deactivateSlideshow 呼出がない');
});

// ============================================================
// T8: 「スライドショーに戻る」ボタン disabled が <= 60_000 ms
// ============================================================
test('T8: updatePipShowSlideshowDisabled が <= SLIDESHOW_AUTO_END_MS で disabled', () => {
  const body = extractFunctionBody(RENDERER, 'updatePipShowSlideshowDisabled');
  assert.ok(body, '関数本体抽出失敗');
  assert.match(body, /remainingMs\s*<=\s*SLIDESHOW_AUTO_END_MS/, '残り 60 秒以下の disabled 判定がない');
  assert.match(body, /\.disabled\s*=/, 'disabled 設定がない');
});

// ============================================================
// T9: index.html に slideshow-stage / pip-timer / pip-action-btn 要素
// ============================================================
test('T9: HTML に slideshow-stage / pip-timer / pip-action-btn × 2', () => {
  assert.match(HTML, /id=["']js-slideshow-stage["']/, 'slideshow-stage 要素がない');
  assert.match(HTML, /id=["']js-slideshow-img["']/, 'slideshow-img 要素がない');
  assert.match(HTML, /id=["']js-pip-timer["']/, 'pip-timer 要素がない');
  assert.match(HTML, /id=["']js-pip-digits["']/, 'pip-digits 要素がない');
  assert.match(HTML, /id=["']js-pip-show-timer["']/, '「タイマー画面に戻す」ボタンがない');
  assert.match(HTML, /id=["']js-pip-show-slideshow["']/, '「スライドショーに戻る」ボタンがない');
  // 設定パネル UI
  assert.match(HTML, /id=["']js-break-images-add["']/, '画像追加ボタンがない');
  assert.match(HTML, /id=["']js-break-images-list["']/, 'break-images-list がない');
  assert.match(HTML, /id=["']js-break-image-interval["']/, '切替間隔入力がない');
  assert.match(HTML, /name=["']pip-size["']/, 'PIP サイズラジオがない');
});

// ============================================================
// T10: style.css に :root[data-slideshow="active"] + pip-timer サイズ切替 3 種
// ============================================================
test('T10: CSS の data-slideshow="active" + PIP サイズ切替 + Barlow Condensed', () => {
  assert.match(STYLE, /:root\[data-slideshow="active"\]/, 'data-slideshow="active" ルールがない');
  // PIP サイズ 3 種
  assert.match(STYLE, /:root\[data-pip-size="small"\]/, 'data-pip-size="small" がない');
  assert.match(STYLE, /:root\[data-pip-size="medium"\]/, 'data-pip-size="medium" がない');
  assert.match(STYLE, /:root\[data-pip-size="large"\]/, 'data-pip-size="large" がない');
  // PIP タイマー本体
  assert.match(STYLE, /\.pip-timer\s*\{/, '.pip-timer ルールがない');
  // Barlow Condensed フォント
  assert.match(STYLE, /\.pip-timer__digits[\s\S]*?Barlow Condensed/,
    'pip-timer__digits に Barlow Condensed が指定されていない');
  // スライドショーステージ
  assert.match(STYLE, /\.slideshow-stage\s*\{/, '.slideshow-stage ルールがない');
});

// ============================================================
// T11: preload.js に selectBreakImages ブリッジ
// ============================================================
test('T11: preload.js の display.selectBreakImages bridge', () => {
  assert.match(PRELOAD, /selectBreakImages\s*:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]display:selectBreakImages['"]/,
    'preload.js の display.selectBreakImages bridge がない');
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]display:selectBreakImages['"]/,
    'main.js の display:selectBreakImages handler がない');
  // 複数選択
  assert.match(MAIN, /multiSelections/, 'multiSelections プロパティがない（複数画像選択）');
});

// ============================================================
// T12: C.1.3 系の VALID_BACKGROUNDS / backgroundImage は不変（回帰防止）
// ============================================================
test('T12: C.1.3 系の不変条件（VALID_BACKGROUNDS = 9 / sanitizeBackgroundImage）', () => {
  // VALID_BACKGROUNDS の長さ 9 を維持（image を勝手に外していない）
  const reMain = /const\s+VALID_BACKGROUNDS\s*=\s*\[([^\]]+)\]/;
  const m1 = MAIN.match(reMain);
  assert.ok(m1, 'main.js VALID_BACKGROUNDS 定義がない');
  const items1 = m1[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.equal(items1.length, 9, 'VALID_BACKGROUNDS が 9 でない（C.1.3 系の回帰）');
  assert.ok(items1.includes('image'), "VALID_BACKGROUNDS に 'image' が残っていない（回帰）");
  // sanitizeBackgroundImage / sanitizeBackgroundOverlay が残っている
  assert.match(MAIN, /function\s+sanitizeBackgroundImage\s*\(/, 'sanitizeBackgroundImage が残っていない');
  assert.match(MAIN, /function\s+sanitizeBackgroundOverlay\s*\(/, 'sanitizeBackgroundOverlay が残っていない');
  // 致命バグ修正の保護: handlePresetApply が resetBlindProgressOnly を呼ぶ
  const body = extractFunctionBody(RENDERER, 'handlePresetApply');
  assert.ok(body, 'handlePresetApply 関数本体抽出失敗');
  assert.match(body, /resetBlindProgressOnly\s*\(\s*\)/,
    'handlePresetApply で resetBlindProgressOnly が呼ばれていない（致命バグリグレッション）');
});

// ============================================================
// C.1.4-fix1 追加分（前原さん実機確認後の 5 件修正）
// ============================================================

// T13: bottom-bar が z-index + position relative + 背景保護
test('T13: .bottom-bar に z-index: 3 + position: relative + image 時の不透明背景', () => {
  const block = STYLE.match(/\.bottom-bar\s*\{[\s\S]*?\}/);
  assert.ok(block, '.bottom-bar ブロックがない');
  assert.match(block[0], /z-index:\s*3/, '.bottom-bar に z-index: 3 がない（C.1.4-fix1 Fix 1）');
  assert.match(block[0], /position:\s*relative/, '.bottom-bar に position: relative がない');
  // image 時の不透明背景ルール
  assert.match(STYLE, /:root\[data-bg="image"\]\s+\.bottom-bar\s*\{[\s\S]*?background:\s*var\(--bg-deep/,
    'image 時の .bottom-bar 不透明背景ルールがない');
});

// T14: syncSlideshowFromState で残り 60 秒超えに autoEndedAt リセット
test('T14: syncSlideshowFromState の > 60s 経路で autoEndedAt = null リセット', () => {
  const body = extractFunctionBody(RENDERER, 'syncSlideshowFromState');
  assert.ok(body, '関数本体抽出失敗');
  // > 60s 経路に autoEndedAt の null リセット
  assert.match(body, /autoEndedAt\s*!==\s*null[\s\S]*?autoEndedAt\s*=\s*null/,
    '> 60s 経路で autoEndedAt を null にリセットする処理がない（C.1.4-fix1 Fix 3）');
});

// T15: onTick / onPreStartTick から syncSlideshowFromState 呼出が削除（音復活）
test('T15: setHandlers の onTick / onPreStartTick から syncSlideshowFromState 呼出を削除', () => {
  // setHandlers の引数オブジェクトを抽出
  const m = RENDERER.match(/setHandlers\(\s*\{[\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'setHandlers 呼出が見つからない');
  const block = m[0];
  // onTick: handler 内
  const onTickMatch = block.match(/onTick:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}\s*,/);
  assert.ok(onTickMatch, 'onTick handler が抽出できない');
  assert.doesNotMatch(onTickMatch[0], /syncSlideshowFromState\s*\(/,
    'onTick handler に syncSlideshowFromState 呼出が残存（C.1.4-fix1 Fix 2 で削除のはず）');
  // onPreStartTick: handler 内
  const onPreMatch = block.match(/onPreStartTick:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}\s*,?/);
  assert.ok(onPreMatch, 'onPreStartTick handler が抽出できない');
  assert.doesNotMatch(onPreMatch[0], /syncSlideshowFromState\s*\(/,
    'onPreStartTick handler に syncSlideshowFromState 呼出が残存');
  // handleAudioOnTick の warning-1min 発火経路は維持されている
  const audioBody = extractFunctionBody(RENDERER, 'handleAudioOnTick');
  assert.ok(audioBody, 'handleAudioOnTick 関数本体抽出失敗');
  assert.match(audioBody, /remainingSec\s*===\s*60[\s\S]*?warning-1min/,
    '残り 60 秒 → warning-1min 発火コードが消えている');
});

// T16: PIP ボタンが left 配置 + 旧 right 削除
test('T16: #js-pip-show-timer / #js-pip-show-slideshow が left 配置（旧 right を削除）', () => {
  const showTimerBlock = STYLE.match(/#js-pip-show-timer\s*\{[\s\S]*?\}/);
  assert.ok(showTimerBlock, '#js-pip-show-timer ブロックがない');
  assert.match(showTimerBlock[0], /left:\s*2vw/,
    '#js-pip-show-timer に left: 2vw がない（C.1.4-fix1 Fix 4）');
  assert.doesNotMatch(showTimerBlock[0], /\bright:\s*\d/,
    '#js-pip-show-timer に旧 right 宣言が残存');

  const showSlideshowBlock = STYLE.match(/#js-pip-show-slideshow\s*\{[\s\S]*?\}/);
  assert.ok(showSlideshowBlock, '#js-pip-show-slideshow ブロックがない');
  assert.match(showSlideshowBlock[0], /left:\s*2vw/,
    '#js-pip-show-slideshow に left: 2vw がない');
  assert.doesNotMatch(showSlideshowBlock[0], /\bright:\s*\d/,
    '#js-pip-show-slideshow に旧 right 宣言が残存');
});

// T17: _handleTournamentNewImpl の RAF 内で ensureEditorEditableState 再呼出
test('T17: _handleTournamentNewImpl の RAF 内で ensureEditorEditableState を再呼出（C.1.4-fix1 Fix 5）', () => {
  const body = extractFunctionBody(RENDERER, '_handleTournamentNewImpl');
  assert.ok(body, '_handleTournamentNewImpl 関数本体抽出失敗');
  // requestAnimationFrame ブロック内に ensureEditorEditableState 呼出
  const rafMatch = body.match(/requestAnimationFrame\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(rafMatch, 'RAF ブロックが抽出できない');
  assert.match(rafMatch[0], /ensureEditorEditableState\s*\(\s*\)/,
    'RAF 内に ensureEditorEditableState 再呼出がない（Fix 5 防御的多重化）');
  // 同期側の呼出も維持（C.1.2-bugfix の効果を残す）
  assert.match(body, /ensureEditorEditableState\s*\(\s*\)/, '同期側の ensureEditorEditableState 呼出が消えている');
});

// ============================================================
// C.1.4-fix2 追加分（30 秒遅延 + 初回フェードイン）
// ============================================================

// T18: SLIDESHOW_BREAK_DELAY_MS と breakStartedAt 定義
test('T18: SLIDESHOW_BREAK_DELAY_MS = 30_000 + slideshowState.breakStartedAt フィールド', () => {
  assert.match(RENDERER, /SLIDESHOW_BREAK_DELAY_MS\s*=\s*30_?000/,
    'SLIDESHOW_BREAK_DELAY_MS = 30000 が定義されていない');
  // slideshowState 内に breakStartedAt フィールド
  const m = RENDERER.match(/const\s+slideshowState\s*=\s*\{[\s\S]*?\}\s*;/);
  assert.ok(m, 'slideshowState 定義が抽出できない');
  assert.match(m[0], /breakStartedAt\s*:/, 'slideshowState.breakStartedAt フィールドがない');
});

// T19: subscribe コールバックで BREAK 突入時に Date.now() 記録 / 抜けたら null
test('T19: subscribe で BREAK 突入時に breakStartedAt 記録 + 抜けで null', () => {
  // status 変化分岐内で BREAK 突入記録 + 非 BREAK で null
  assert.match(RENDERER, /state\.status\s*===\s*States\.BREAK\s*&&\s*prev\.status\s*!==\s*States\.BREAK[\s\S]*?breakStartedAt\s*=\s*Date\.now\(\)/,
    'BREAK 突入時に breakStartedAt = Date.now() を記録するコードがない');
  assert.match(RENDERER, /state\.status\s*!==\s*States\.BREAK[\s\S]*?breakStartedAt\s*=\s*null/,
    'BREAK から抜けた時に breakStartedAt = null にクリアするコードがない');
});

// T20: syncSlideshowFromState で 30 秒遅延判定（PRE_START は対象外）
test('T20: syncSlideshowFromState で BREAK 開始 30 秒未満は active 化しない', () => {
  const body = extractFunctionBody(RENDERER, 'syncSlideshowFromState');
  assert.ok(body, '関数本体抽出失敗');
  // status === States.BREAK + breakStartedAt !== null + elapsed < SLIDESHOW_BREAK_DELAY_MS
  assert.match(body, /status\s*===\s*States\.BREAK[\s\S]*?breakStartedAt\s*!==\s*null/,
    'BREAK + breakStartedAt の条件分岐がない');
  assert.match(body, /Date\.now\(\)\s*-\s*slideshowState\.breakStartedAt/,
    '経過時間計算（Date.now() - breakStartedAt）がない');
  assert.match(body, /elapsed\s*<\s*SLIDESHOW_BREAK_DELAY_MS/,
    '経過 30 秒未満判定がない');
});

// T21: CSS の slideshow-stage / pip-timer に transition: opacity + フェードイン規則
test('T21: .slideshow-stage と .pip-timer が opacity: 0 + transition + active で opacity: 1', () => {
  // .slideshow-stage 本体
  const stageBlock = STYLE.match(/\.slideshow-stage\s*\{[\s\S]*?\}/);
  assert.ok(stageBlock, '.slideshow-stage ブロックがない');
  assert.match(stageBlock[0], /opacity:\s*0/, '.slideshow-stage に opacity: 0 既定値がない');
  assert.match(stageBlock[0], /transition:\s*opacity/, '.slideshow-stage に transition: opacity がない');
  assert.match(stageBlock[0], /pointer-events:\s*none/, '.slideshow-stage に pointer-events: none がない');
  // active 時の opacity 1
  assert.match(STYLE, /:root\[data-slideshow="active"\]\s+\.slideshow-stage[\s\S]*?opacity:\s*1/,
    'data-slideshow="active" 時の slideshow-stage opacity: 1 ルールがない');
  // .pip-timer 同等
  const pipBlock = STYLE.match(/\.pip-timer\s*\{[\s\S]*?\}/);
  assert.ok(pipBlock, '.pip-timer ブロックがない');
  assert.match(pipBlock[0], /opacity:\s*0/, '.pip-timer に opacity: 0 既定値がない');
  assert.match(pipBlock[0], /transition:\s*opacity/, '.pip-timer に transition: opacity がない');
  assert.match(STYLE, /:root\[data-slideshow="active"\]\s+\.pip-timer[\s\S]*?opacity:\s*1/,
    'data-slideshow="active" 時の pip-timer opacity: 1 ルールがない');
});

// ============================================================
// C.1.4-fix3 追加分（注意書き + 画像サイズ警告）
// ============================================================

// T22: 注意書き「休憩開始から 30 秒後」「再開 1 分前にタイマーに戻ります」が HTML に含まれる
test('T22: index.html にスライドショー注意書き（30 秒後 / 再開 1 分前）', () => {
  // 文言の核キーワードが両方入っていること（多少の表記ゆれは許容するが core 表現は固定）
  assert.match(HTML, /休憩開始から\s*30\s*秒後/, '「休憩開始から 30 秒後」の文言がない');
  assert.match(HTML, /再開\s*1\s*分前にタイマーに戻ります/, '「再開 1 分前にタイマーに戻ります」の文言がない');
  // break-images-panel__note クラスのスタイル定義
  assert.match(STYLE, /\.break-images-panel__note\s*\{/, '.break-images-panel__note の CSS ルールがない');
});

// T23: 画像合計サイズ累積計算 + 150MB 閾値判定
test('T23: renderer.js に画像サイズ累積計算 + 150MB 閾値判定', () => {
  // 閾値定数（150 * 1024 * 1024 等）
  assert.match(RENDERER, /IMAGE_SIZE_WARNING_THRESHOLD_BYTES\s*=\s*150\s*\*\s*1024\s*\*\s*1024/,
    'IMAGE_SIZE_WARNING_THRESHOLD_BYTES = 150MB 定数がない');
  // 累積関数
  assert.match(RENDERER, /function\s+computeImagesTotalBytes\s*\(/, 'computeImagesTotalBytes 関数がない');
  const body = extractFunctionBody(RENDERER, 'computeImagesTotalBytes');
  assert.ok(body, '関数本体抽出失敗');
  // backgroundImage と breakImages の両方を集計
  assert.match(body, /backgroundImage/, 'backgroundImage の集計がない');
  assert.match(body, /breakImages/, 'breakImages の集計がない');
  // base64 → byte 換算（length × 0.75 近似）
  assert.match(RENDERER, /length\s*\*\s*0\.75/, 'base64 → byte 換算（length × 0.75）がない');
  // 1 セッション 1 度フラグ
  assert.match(RENDERER, /imageSizeWarningShownInSession/, 'imageSizeWarningShownInSession フラグがない');
});

// T24: ⚠ アイコン要素 + CSS
test('T24: index.html に .size-warning-icon × 2（bg / break）+ CSS ルール', () => {
  assert.match(HTML, /id=["']js-size-warning-bg["']/, 'js-size-warning-bg 要素がない');
  assert.match(HTML, /id=["']js-size-warning-break["']/, 'js-size-warning-break 要素がない');
  assert.match(HTML, /class=["']size-warning-icon["']/, 'size-warning-icon クラスがない');
  // CSS 側のスタイル
  assert.match(STYLE, /\.size-warning-icon\s*\{/, '.size-warning-icon の CSS ルールがない');
  assert.match(STYLE, /\.size-warning-icon[\s\S]*?color:\s*var\(--warning/,
    '.size-warning-icon に warning 色がない');
});

console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
