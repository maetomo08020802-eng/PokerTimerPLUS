/**
 * STEP 10 フェーズC.1.3 — 背景画像機能（9 種類目「カスタム画像」）の回帰防止テスト
 *
 * 検証対象:
 *   Fix 1: VALID_BACKGROUNDS 拡張 + backgroundImage / backgroundOverlay フィールド + sanitize
 *   Fix 2: UI（9 番目チップ + 詳細パネル + body 直下 overlay 要素）
 *   Fix 3: CSS（data-bg="image" ルール + thumb swatch + panel + overlay）
 *   Fix 4: IPC（display:selectBackgroundImage + tournaments:setDisplaySettings の拡張）
 *
 * 実行: node tests/c13-bg-image.test.js
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

// ブレース深度カウントで関数本体を抽出（既存テストと同じパターン）
function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = source.match(re);
  if (!m) return null;
  const start = m.index + m[0].length - 1;   // 開き { の位置
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start + 1, i); }
  }
  return null;
}

// ============================================================
// T1: VALID_BACKGROUNDS に 'image' 追加（renderer + main、長さ 9）
// ============================================================
test("T1: VALID_BACKGROUNDS に 'image' を追加 + 長さ 9", () => {
  const reMain = /const\s+VALID_BACKGROUNDS\s*=\s*\[([^\]]+)\]/;
  const m1 = MAIN.match(reMain);
  assert.ok(m1, 'main.js に VALID_BACKGROUNDS 定義がない');
  const items1 = m1[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.equal(items1.length, 9, `main.js VALID_BACKGROUNDS の長さは 9 のはず（実際 ${items1.length}）`);
  assert.ok(items1.includes('image'), "main.js VALID_BACKGROUNDS に 'image' が含まれていない");

  const m2 = RENDERER.match(reMain);
  assert.ok(m2, 'renderer.js に VALID_BACKGROUNDS 定義がない');
  const items2 = m2[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.equal(items2.length, 9, `renderer.js VALID_BACKGROUNDS の長さは 9 のはず（実際 ${items2.length}）`);
  assert.ok(items2.includes('image'), "renderer.js VALID_BACKGROUNDS に 'image' が含まれていない");
});

// ============================================================
// T2: sanitizeBackgroundImage が不正な data URL とサイズ超過を弾く
// ============================================================
test('T2: sanitizeBackgroundImage の data URL prefix 検証 + 5MB 上限', () => {
  // 関数定義の存在
  assert.match(MAIN, /function\s+sanitizeBackgroundImage\s*\(/, 'sanitizeBackgroundImage 関数がない');
  // data URL 形式の正規表現が png/jpe?g/webp に限定されている
  assert.match(MAIN, /data:image\\\/\(png\|jpe\?g\|webp\)/,
    'data URL prefix の正規表現が png/jpe?g/webp に限定されていない');
  // 5MB 上限定数
  assert.match(MAIN, /BACKGROUND_IMAGE_MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/,
    'BACKGROUND_IMAGE_MAX_BYTES が 5MB に設定されていない');
  // 上限超過時に null を返す（呼出側で warning）
  assert.match(MAIN, /BACKGROUND_IMAGE_DATA_URL_MAX_LEN/,
    'data URL の長さチェック定数 BACKGROUND_IMAGE_DATA_URL_MAX_LEN がない');
  assert.match(MAIN, /return\s+null\s*;?\s*\/\/\s*サイズ超過/,
    'サイズ超過時に null を返す経路が見当たらない');
});

// ============================================================
// T3: sanitizeBackgroundOverlay が low/mid/high 以外を 'mid' に補正
// ============================================================
test("T3: sanitizeBackgroundOverlay が low/mid/high 以外を 'mid' に補正", () => {
  assert.match(MAIN, /VALID_BG_OVERLAYS\s*=\s*\[\s*['"]low['"]\s*,\s*['"]mid['"]\s*,\s*['"]high['"]\s*\]/,
    "VALID_BG_OVERLAYS が ['low','mid','high'] で定義されていない");
  assert.match(MAIN, /function\s+sanitizeBackgroundOverlay\s*\(/, 'sanitizeBackgroundOverlay 関数がない');
  // フォールバックが 'mid' を最終採用する
  assert.match(MAIN, /['"]mid['"]/, "fallback 既定値 'mid' が定義されていない");
});

// ============================================================
// T4: applyBackground が image を documentElement.dataset.bg に設定 + CSS 変数設定
// ============================================================
test('T4: applyBackground が image 時に CSS 変数 --custom-bg-image / --bg-overlay-alpha をセット', () => {
  // applyBackground の本体内で image 分岐 + setProperty 呼出
  assert.match(RENDERER, /setProperty\(\s*['"]--custom-bg-image['"]/,
    '--custom-bg-image を setProperty していない');
  assert.match(RENDERER, /setProperty\(\s*['"]--bg-overlay-alpha['"]/,
    '--bg-overlay-alpha を setProperty していない');
  // dataset.bg に値を入れる
  assert.match(RENDERER, /document\.documentElement\.dataset\.bg\s*=/,
    'dataset.bg への代入がない');
});

// ============================================================
// T5: backgroundImage 空 + background='image' 時のフォールバック挙動
// ============================================================
test("T5: image 選択中で画像未設定なら _lastColorBackground にフォールバック", () => {
  assert.match(RENDERER, /_lastColorBackground/, '_lastColorBackground 変数がない');
  // フォールバック分岐: !hasImage で _lastColorBackground を effective に採用
  assert.match(RENDERER, /isImage\s*&&\s*!hasImage/,
    'image 選択中 + 画像未設定のフォールバック分岐がない');
  // 色背景時のみ _lastColorBackground を更新（image は記憶しない）
  assert.match(RENDERER, /_lastColorBackground\s*=\s*effective/,
    '_lastColorBackground 更新ロジックがない');
});

// ============================================================
// T6: グローバル既定値 → 新規トーナメントへの引継ぎ
// ============================================================
test('T6: getDefaultDisplaySettings + migrateTournamentSchema が backgroundImage / Overlay を補完', () => {
  // getDefaultDisplaySettings に backgroundImage / backgroundOverlay の return がある
  const m = MAIN.match(/function\s+getDefaultDisplaySettings\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(m, 'getDefaultDisplaySettings の関数本体が抽出できない');
  assert.match(m[0], /backgroundImage\s*:/, 'getDefaultDisplaySettings に backgroundImage がない');
  assert.match(m[0], /backgroundOverlay\s*:/, 'getDefaultDisplaySettings に backgroundOverlay がない');
  // store.defaults.display にも追加されている
  assert.match(MAIN, /backgroundImage\s*:\s*['"]['"]/, 'store.defaults.display.backgroundImage が空文字で定義されていない');
  // DEFAULT_TOURNAMENT_EXT.displaySettings に backgroundImage / Overlay がある
  assert.match(MAIN, /displaySettings\s*:\s*\{\s*background\s*:[^}]*backgroundImage\s*:[^}]*backgroundOverlay/,
    'DEFAULT_TOURNAMENT_EXT.displaySettings に backgroundImage / Overlay がない');
});

// ============================================================
// T7: CSS — data-bg="image" 関連ルールが style.css にある
// ============================================================
test('T7: style.css に data-bg="image" 関連 CSS（body / overlay / thumb）', () => {
  // :root[data-bg="image"] の宣言（CSS 変数）
  assert.match(STYLE, /:root\[data-bg="image"\]\s*\{/,
    ':root[data-bg="image"] のルールがない');
  // body の background-image: var(--custom-bg-image)
  assert.match(STYLE, /:root\[data-bg="image"\]\s+body[\s\S]*?background-image:\s*var\(--custom-bg-image\)/,
    ':root[data-bg="image"] body で var(--custom-bg-image) を使っていない');
  // .bg-image-overlay 要素の CSS
  assert.match(STYLE, /\.bg-image-overlay\s*\{/, '.bg-image-overlay の CSS ルールがない');
  assert.match(STYLE, /:root\[data-bg="image"\]\s+\.bg-image-overlay/,
    'image 時のみ overlay を表示するルールがない');
  // 9 番目チップの swatch
  assert.match(STYLE, /\.bg-thumb__swatch\[data-bg-swatch="image"\]/,
    '9 番目チップの swatch CSS がない');
});

// ============================================================
// T8: overlay 強度マッピング（low 0.3 / mid 0.5 / high 0.7）
// ============================================================
test('T8: BG_OVERLAY_ALPHA = { low: 0.3, mid: 0.5, high: 0.7 } が renderer.js に定義', () => {
  assert.match(RENDERER, /BG_OVERLAY_ALPHA\s*=\s*\{[^}]*low\s*:\s*0\.3/,
    'BG_OVERLAY_ALPHA.low = 0.3 が定義されていない');
  assert.match(RENDERER, /BG_OVERLAY_ALPHA\s*=\s*\{[^}]*mid\s*:\s*0\.5/,
    'BG_OVERLAY_ALPHA.mid = 0.5 が定義されていない');
  assert.match(RENDERER, /BG_OVERLAY_ALPHA\s*=\s*\{[^}]*high\s*:\s*0\.7/,
    'BG_OVERLAY_ALPHA.high = 0.7 が定義されていない');
});

// ============================================================
// T9: HTML — 9 番目チップ + 詳細パネル + body 直下 overlay 要素
// ============================================================
test('T9: index.html に 9 番目チップ + bg-image-panel + bg-image-overlay', () => {
  assert.match(HTML, /class=["']bg-thumb["'][^>]*data-bg-value=["']image["']/,
    '9 番目の bg-thumb (data-bg-value="image") が HTML にない');
  assert.match(HTML, /id=["']js-bg-image-panel["']/, 'js-bg-image-panel 要素がない');
  assert.match(HTML, /id=["']js-bg-image-select["']/, 'js-bg-image-select ボタンがない');
  assert.match(HTML, /id=["']js-bg-image-clear["']/, 'js-bg-image-clear ボタンがない');
  assert.match(HTML, /id=["']js-bg-image-preview["']/, 'js-bg-image-preview img 要素がない');
  assert.match(HTML, /name=["']bg-overlay-intensity["'][^>]*value=["']low["']/, 'overlay 強度ラジオ low がない');
  assert.match(HTML, /name=["']bg-overlay-intensity["'][^>]*value=["']mid["']/, 'overlay 強度ラジオ mid がない');
  assert.match(HTML, /name=["']bg-overlay-intensity["'][^>]*value=["']high["']/, 'overlay 強度ラジオ high がない');
  assert.match(HTML, /id=["']js-bg-image-overlay["']/, 'body 直下の bg-image-overlay 要素がない');
});

// ============================================================
// T10: IPC — display:selectBackgroundImage（main.js + preload.js）
// ============================================================
test('T10: IPC display:selectBackgroundImage が main + preload に橋渡しされている', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]display:selectBackgroundImage['"]/,
    'main.js に display:selectBackgroundImage の ipcMain.handle がない');
  // base64 化 + dataUrl 返却
  assert.match(MAIN, /toString\(\s*['"]base64['"]\s*\)/, 'fs Buffer の base64 化がない');
  assert.match(MAIN, /data:\$\{mime\};base64,/, 'data URL の組み立てがない');
  // preload bridge
  assert.match(PRELOAD, /selectBackgroundImage\s*:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]display:selectBackgroundImage['"]/,
    'preload.js の display.selectBackgroundImage bridge がない');
});

// ============================================================
// T11: tournaments:setDisplaySettings が backgroundImage / backgroundOverlay を受け付け
// ============================================================
test('T11: tournaments:setDisplaySettings が backgroundImage / Overlay を扱う + image-too-large エラー', () => {
  // ハンドラ本体に backgroundImage を受ける分岐
  assert.match(MAIN, /['"]backgroundImage['"]\s+in\s+ds/, '"backgroundImage" in ds の分岐がない');
  assert.match(MAIN, /image-too-large/, 'image-too-large エラーコードを返す経路がない');
  assert.match(MAIN, /backgroundOverlay\s*:[^,]*sanitizeBackgroundOverlay/,
    'sanitizeBackgroundOverlay 経由で overlay を保存していない');
});

// ============================================================
// 不変条件: 致命バグ修正の保護（C.2.7-A）
// ============================================================
test('T12: handlePresetApply の reset 分岐は引き続き resetBlindProgressOnly（C.2.7-A 致命バグ修正の保護）', () => {
  const body = extractFunctionBody(RENDERER, 'handlePresetApply');
  assert.ok(body, 'handlePresetApply 関数本体が抽出できない');
  // resetBlindProgressOnly の呼出が含まれている
  assert.match(body, /resetBlindProgressOnly\s*\(\s*\)/,
    'handlePresetApply 内で resetBlindProgressOnly が呼ばれていない（致命バグ 8-8 リグレッション）');
  // handleReset() が直接呼ばれていない
  assert.doesNotMatch(body, /\bhandleReset\s*\(\s*\)/,
    'handlePresetApply 内で handleReset() が直接呼ばれている（致命バグリグレッション）');
});

// ============================================================
// C.1.3-fix1 追加分（前原さん実機確認後の 3 件修正）
// ============================================================

// T13: _userBgChoice 変数 + setBgImageState の判定使用
test('T13: _userBgChoice が宣言され、setBgImageState が _userBgChoice を判定に使う', () => {
  // 変数宣言
  assert.match(RENDERER, /let\s+_userBgChoice\s*=/, '_userBgChoice の let 宣言がない');
  // applyBackground 内で記録
  const applyBody = extractFunctionBody(RENDERER, 'applyBackground');
  assert.ok(applyBody, 'applyBackground 関数本体が抽出できない');
  assert.match(applyBody, /_userBgChoice\s*=\s*bg/,
    'applyBackground で _userBgChoice にユーザー意図値を記録していない');
  // setBgImageState 内の判定が _userBgChoice
  const setBody = extractFunctionBody(RENDERER, 'setBgImageState');
  assert.ok(setBody, 'setBgImageState 関数本体が抽出できない');
  assert.match(setBody, /_userBgChoice\s*===\s*['"]image['"]/,
    'setBgImageState が _userBgChoice === \'image\' で判定していない（C.1.3-fix1 Fix 2）');
  // 旧判定 dataset.bg === 'image' は使われていないこと
  assert.doesNotMatch(setBody, /dataset\.bg\s*===\s*['"]image['"]/,
    'setBgImageState に旧判定 dataset.bg === "image" が残っている（C.1.3-fix1 Fix 2 の回帰）');
});

// T14: プレビュー枠 16:9 + max-width + object-fit: contain
test('T14: .bg-image-panel__preview に aspect-ratio + img が object-fit: contain', () => {
  // プレビュー枠ブロック内の aspect-ratio
  const previewBlock = STYLE.match(/\.bg-image-panel__preview\s*\{[\s\S]*?\}/);
  assert.ok(previewBlock, '.bg-image-panel__preview ブロックがない');
  assert.match(previewBlock[0], /aspect-ratio:\s*16\s*\/\s*9/,
    '.bg-image-panel__preview に aspect-ratio: 16 / 9 がない');
  assert.match(previewBlock[0], /max-width:\s*\d+px/,
    '.bg-image-panel__preview に max-width: ___px が定義されていない');
  // 旧 height: 9vw が残っていない
  assert.doesNotMatch(previewBlock[0], /height:\s*9vw/,
    '.bg-image-panel__preview に旧 height: 9vw が残存（fix1 で削除のはず）');
  // img 側の object-fit: contain
  const imgBlock = STYLE.match(/\.bg-image-panel__preview\s+img\s*\{[\s\S]*?\}/);
  assert.ok(imgBlock, '.bg-image-panel__preview img ブロックがない');
  assert.match(imgBlock[0], /object-fit:\s*contain/,
    '.bg-image-panel__preview img の object-fit が contain でない（C.1.3-fix1 Fix 1）');
});

// T15: form-dialog--tabs の flex 化を巻き戻したことを保証する回帰防止テスト
//   背景: C.1.3-fix1 Fix 3 で <dialog> に display: flex / overflow: hidden を当てたところ
//   ✕ボタンと resize ハンドルが両方効かなくなったため緊急ロールバック（C.1.3-fix1-rollback）。
//   今後同じ間違いを繰り返さないよう「flex 化が再発していない」ことを検証する。
test('T15: form-dialog--tabs に display: flex / overflow: hidden が再発していない（rollback 維持）', () => {
  const tabsBlock = STYLE.match(/\.form-dialog\.form-dialog--tabs\s*\{[\s\S]*?\}/);
  assert.ok(tabsBlock, '.form-dialog.form-dialog--tabs ブロックがない');
  assert.doesNotMatch(tabsBlock[0], /display:\s*flex/,
    '.form-dialog--tabs に display: flex が再発（<dialog> の flex 化は ✕ボタン / resize を壊す）');
  assert.doesNotMatch(tabsBlock[0], /overflow:\s*hidden/,
    '.form-dialog--tabs に overflow: hidden が再発（resize ハンドルが効かなくなる）');
  assert.match(tabsBlock[0], /resize:\s*both/,
    '.form-dialog--tabs に resize: both がない（縦横リサイズ機能が消失）');
  assert.match(tabsBlock[0], /overflow:\s*auto/,
    '.form-dialog--tabs に overflow: auto がない');
  // body 側: C.1.6 Fix 1 で wrapper 経由の flex に移行 → 単体ブロックの max-height / flex は撤廃。
  //   wrapper ルール（.form-dialog__shell > .form-dialog__body）側で flex: 1 / max-height: none が当たる。
  //   そちらは c16-features.test.js T30 で検証する。
  const bodyBlock = STYLE.match(/^\.form-dialog__body\s*\{[\s\S]*?\}/m);
  assert.ok(bodyBlock, '.form-dialog__body ブロックがない');
  assert.doesNotMatch(bodyBlock[0], /flex:\s*1/,
    '.form-dialog__body 単体に flex: 1 が直書き（wrapper 経由のみが正、C.1.6 Fix 1）');
  // ダイアログサイズ検証（fix3: 初期サイズ + 95vw/vh 上限）
  assert.match(tabsBlock[0], /max-width:\s*95vw/,
    '.form-dialog--tabs の max-width: 95vw が消失（fix3）');
  assert.match(tabsBlock[0], /max-height:\s*95vh/,
    '.form-dialog--tabs の max-height: 95vh が消失（fix3）');
  assert.match(tabsBlock[0], /width:\s*min\(1000px/,
    '.form-dialog--tabs の初期 width が消失（fix3 で固定値、ハンドル可視確保）');
  assert.match(tabsBlock[0], /height:\s*min\(700px/,
    '.form-dialog--tabs の初期 height が消失（fix3 で固定値、ハンドル可視確保）');
});

// ============================================================
// C.1.4-fix3 追加分（フォント拡大）— c13 ファイルに追加（CSS 検証なので場所を統一）
// ============================================================

// T25: .level-display font-size が拡大（3.4vw → 5.8〜6.8vw 範囲）
test('T25: .level-display font-size が C.1.4-fix3 で拡大（5.8〜6.8vw）', () => {
  const block = STYLE.match(/\.level-display\s*\{[\s\S]*?\}/);
  assert.ok(block, '.level-display ブロックがない');
  const m = block[0].match(/font-size:\s*([\d.]+)vw/);
  assert.ok(m, '.level-display に font-size: ___vw がない');
  const v = parseFloat(m[1]);
  assert.ok(v >= 5.8 && v <= 6.8, `.level-display font-size ${v}vw が範囲外（5.8〜6.8vw 期待）`);
  // 旧値 3.4vw は残っていない
  assert.notEqual(v, 3.4, '.level-display font-size が旧 3.4vw のまま');
});

// T26: .stat-value font-size が拡大（3.5vw → 4.55〜5.25vw 範囲）
test('T26: .stat-value font-size が C.1.4-fix3 で拡大（4.55〜5.25vw）', () => {
  const block = STYLE.match(/\.stat-value\s*\{[\s\S]*?\}/);
  assert.ok(block, '.stat-value ブロックがない');
  const m = block[0].match(/font-size:\s*([\d.]+)vw/);
  assert.ok(m, '.stat-value に font-size: ___vw がない');
  const v = parseFloat(m[1]);
  assert.ok(v >= 4.55 && v <= 5.25, `.stat-value font-size ${v}vw が範囲外（4.55〜5.25vw 期待）`);
});

// T27: .stat-value-small が 3vw（×1.5）に拡大
test('T27: .stat-value-small font-size が 3vw（×1.5 拡大）', () => {
  const block = STYLE.match(/\.stat-value-small\s*\{[\s\S]*?\}/);
  assert.ok(block, '.stat-value-small ブロックがない');
  assert.match(block[0], /font-size:\s*3vw\b/, '.stat-value-small font-size が 3vw でない');
});

// T28: avg stack の 8 桁時 0.8 倍縮小（C.1.4-fix3-patch）
test('T28: 8 桁時 avg stack 自動縮小（renderer.js + style.css）', () => {
  // renderer.js: avg stack 表示時に is-8digit クラス toggle
  assert.match(RENDERER, /el\.avgStack\.classList\.toggle\(\s*['"]is-8digit['"]/,
    'renderer.js に is-8digit クラスの toggle がない（8 桁時自動縮小ロジック欠落）');
  assert.match(RENDERER, /String\(Math\.floor\(Math\.abs\(\s*\w+\s*\)\)\)\.length\s*>=\s*8/,
    'renderer.js に 8 桁判定ロジックがない');
  // style.css: .stat-value.is-8digit { font-size: 3.64vw; }
  assert.match(STYLE, /\.stat-value\.is-8digit\s*\{[^}]*font-size:\s*3\.64vw/,
    'style.css に .stat-value.is-8digit の font-size: 3.64vw がない');
});

console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
