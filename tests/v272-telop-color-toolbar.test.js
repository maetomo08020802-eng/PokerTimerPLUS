/**
 * v2.6.x（telop-color-ux-simplify）回帰テスト
 *
 *   テロップ文字色を「文字を選んで色ボタンを押す」方式に作り直した入力 UI の検証。
 *   - 利用者は記法 [color]…[/color] を手打ちしない。色ボタン/任意色/「色を消す」で生成・除去する。
 *   - 保存フォーマット（[color]…[/color] 文字列）と描画バックエンド（marquee.js renderMarqueeContent）は無改変。
 *   - 純粋関数 stripMarqueeColorTags / wrapMarqueeSelectionValue を実ソースから抽出して実行（v269 同パターン）。
 *   - 生成トークンは常に resolveMarqueeColor 非 null → renderMarqueeContent への往復で期待色 span になることを実証。
 *
 *   実行: node tests/v272-telop-color-toolbar.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const MARQUEE  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'marquee.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// function NAME(...) { ... } の全文を波括弧マッチで抽出（テンプレ内 ${} も括弧は均衡）
function extractFunctionSource(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = source.match(re);
  if (!m) return null;
  const fnStart = m.index;
  const braceStart = source.indexOf('{', fnStart);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(fnStart, i + 1); }
  }
  return null;
}

// ===== marquee.js の出荷パーサを実行可能化（往復描画の検証用） =====
function makeDocStub() {
  return {
    createElement: (tag) => ({
      tagName: String(tag).toUpperCase(), textContent: '', style: {}, _kids: [],
      appendChild(c) { this._kids.push(c); }
    }),
    createTextNode: (s) => ({ nodeType: 3, textContent: String(s) })
  };
}
function makeContainer() {
  const node = { _kids: [] };
  let _text = '';
  Object.defineProperty(node, 'textContent', {
    get() { return _text; },
    set(v) { _text = String(v); node._kids = []; }
  });
  node.appendChild = (c) => { node._kids.push(c); };
  return node;
}
function buildMarqueeParser() {
  const colorsSrc  = MARQUEE.match(/const MARQUEE_COLORS = Object\.freeze\(\{[\s\S]*?\}\);/);
  const resolveSrc = MARQUEE.match(/function resolveMarqueeColor\(name\) \{[\s\S]*?\n\}/);
  const renderSrc  = MARQUEE.match(/function renderMarqueeContent\(container, text\) \{[\s\S]*?\n\}/);
  assert.ok(colorsSrc, 'MARQUEE_COLORS 抽出失敗');
  assert.ok(resolveSrc, 'resolveMarqueeColor 抽出失敗');
  assert.ok(renderSrc, 'renderMarqueeContent 抽出失敗');
  const factory = new Function('document',
    `${colorsSrc[0]}\n${resolveSrc[0]}\n${renderSrc[0]}\n` +
    'return { MARQUEE_COLORS, resolveMarqueeColor, renderMarqueeContent };'
  );
  return factory(makeDocStub());
}
const P = buildMarqueeParser();

// ===== renderer.js の純粋関数を実行可能化（resolveMarqueeColor を注入） =====
function buildRendererPureFns() {
  const stripSrc = extractFunctionSource(RENDERER, 'stripMarqueeColorTags');
  const wrapSrc  = extractFunctionSource(RENDERER, 'wrapMarqueeSelectionValue');
  assert.ok(stripSrc, 'stripMarqueeColorTags 抽出失敗');
  assert.ok(wrapSrc, 'wrapMarqueeSelectionValue 抽出失敗');
  const factory = new Function('resolveMarqueeColor',
    `${stripSrc}\n${wrapSrc}\n return { stripMarqueeColorTags, wrapMarqueeSelectionValue };`
  );
  return factory(P.resolveMarqueeColor);
}
const R = buildRendererPureFns();

function summarize(container) {
  return container._kids.map((k) => ({
    text: k.textContent,
    color: (k.style && k.style.color) || null,
    isSpan: k.tagName === 'SPAN'
  }));
}
function visibleText(container) {
  return container._kids.map((k) => k.textContent).join('');
}
function renderToSpans(str) {
  const c = makeContainer();
  P.renderMarqueeContent(c, str);
  return { spans: summarize(c).filter((p) => p.isSpan), visible: visibleText(c) };
}

// ============================================================
// 純粋関数: 選択範囲ラップ（記法の自動生成）
// ============================================================
test('T1: wrapMarqueeSelectionValue — 色名トークンで [name]…[/name] を生成', () => {
  const r = R.wrapMarqueeSelectionValue('WIN NOW', 0, 3, 'red');
  assert.equal(r.value, '[red]WIN[/red] NOW', '色名ラップ結果が一致しない');
  assert.equal(r.selStart, 0, 'selStart が選択先頭でない');
  assert.equal(r.selEnd, '[red]WIN[/red]'.length, 'selEnd が包んだ範囲末尾でない');
});

test('T2: wrapMarqueeSelectionValue — 任意色 #rrggbb トークンで [#rrggbb]…[/#rrggbb] を生成', () => {
  const r = R.wrapMarqueeSelectionValue('X', 0, 1, '#ff0000');
  assert.equal(r.value, '[#ff0000]X[/#ff0000]', '#rrggbb ラップ結果が一致しない');
});

// ============================================================
// 純粋関数: 既存色タグ除去（ネスト防止・後勝ちの土台）
// ============================================================
test('T3: stripMarqueeColorTags — 解決可能な色タグのみ除去、未知ブラケットは温存', () => {
  assert.equal(R.stripMarqueeColorTags('[red]A[/red]'), 'A', '色タグが除去されていない');
  assert.equal(R.stripMarqueeColorTags('[#00ff00]B[/#00ff00]'), 'B', '#rrggbb タグが除去されていない');
  assert.equal(R.stripMarqueeColorTags('[foo]C[/foo]'), '[foo]C[/foo]', '未知ブラケットが温存されていない');
  assert.equal(R.stripMarqueeColorTags('普通の文字'), '普通の文字', '地の文が変化した');
});

// ============================================================
// ネスト防止 + 後勝ち往復（review 提案2）:
//   既に色付きの範囲を別色で上書き → strip で旧タグ除去 → 新色で 1 段ラップ → 描画で期待色 span
// ============================================================
test('T4: 色付き範囲を別色で上書きしてもネストせず後勝ち（往復描画で gold span）', () => {
  // 'A[red]B[/red]C' の [red]B[/red] 部分（index 1..13）を gold で上書き
  const src = 'A[red]B[/red]C';
  const r = R.wrapMarqueeSelectionValue(src, 1, 13, 'gold');
  assert.equal(r.value, 'A[gold]B[/gold]C', 'ネスト防止後の後勝ち結果が一致しない');
  const { spans, visible } = renderToSpans(r.value);
  assert.equal(visible, 'ABC', '可視テキストが ABC でない');
  assert.equal(spans.length, 1, 'span が 1 つでない（ネスト/重複の疑い）');
  assert.equal(spans[0].text, 'B', '色が付くのは B のみのはず');
  assert.equal(spans[0].color, P.MARQUEE_COLORS.gold, 'B の色が gold でない（後勝ち失敗）');
});

// ============================================================
// 生成トークンは常に解決可能 → 往復描画で必ず期待色 span（手打ち不要の安全性）
// ============================================================
test('T5: 9 色 + 任意色いずれも wrap→render で期待色 span（生成トークン全解決）', () => {
  const names = Object.keys(P.MARQUEE_COLORS);
  assert.equal(names.length, 9, 'ホワイトリストが 9 色でない');
  for (const name of names) {
    const r = R.wrapMarqueeSelectionValue('X', 0, 1, name);
    assert.notEqual(P.resolveMarqueeColor(name), null, `${name} が解決されない（生成トークン不正）`);
    const { spans } = renderToSpans(r.value);
    assert.equal(spans.length, 1, `${name}: span が 1 つでない`);
    assert.equal(spans[0].color, P.MARQUEE_COLORS[name], `${name}: span の色が一致しない`);
  }
  // 任意色（小文字 hex を生成する想定）
  const rc = R.wrapMarqueeSelectionValue('X', 0, 1, '#3fb6d4');
  assert.equal(renderToSpans(rc.value).spans[0].color, '#3fb6d4', '任意色 hex の span 色が一致しない');
});

// ============================================================
// 旧データ互換: 旧 [red]…[/red] 文字列はそのまま読込・描画できる（破壊しない）
// ============================================================
test('T6: 旧 [color]…[/color] データが renderMarqueeContent でそのまま色付き描画（後退なし）', () => {
  const legacy = 'おめでとう [gold]優勝[/gold] さん';
  const { spans, visible } = renderToSpans(legacy);
  assert.equal(visible, 'おめでとう 優勝 さん', '旧データの可視テキストが崩れた');
  assert.equal(spans.length, 1, '旧データの span が 1 つでない');
  assert.equal(spans[0].color, P.MARQUEE_COLORS.gold, '旧データの色が gold でない');
});

// ============================================================
// XSS 非回帰: marquee.js は innerHTML 系を使わない / 装飾内 HTML はリテラル textContent
// ============================================================
test('T7: XSS 後退なし（innerHTML 不使用・HTML はリテラル格納）', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const r = R.wrapMarqueeSelectionValue(payload, 0, payload.length, 'red');
  const { spans } = renderToSpans(r.value);
  assert.equal(spans.length, 1, 'span が 1 つでない');
  assert.equal(spans[0].text, payload, 'HTML がリテラルで span に入っていない（textContent のはず）');
  assert.doesNotMatch(MARQUEE, /\.(innerHTML|outerHTML)\b|insertAdjacentHTML\s*\(/, 'marquee.js に innerHTML 系の使用が混入');
});

// ============================================================
// marquee.js: 安全資産の追加 export（無改変・参照のみ）
// ============================================================
test('T8: marquee.js が renderMarqueePreview / resolveMarqueeColor / MARQUEE_COLORS / renderMarqueeContent を export', () => {
  const exportLine = MARQUEE.match(/export\s*\{[^}]*\}\s*;/g) || [];
  const joined = exportLine.join('\n');
  assert.match(joined, /renderMarqueePreview/, 'renderMarqueePreview が export されていない');
  assert.match(joined, /resolveMarqueeColor/, 'resolveMarqueeColor が export されていない');
  assert.match(joined, /MARQUEE_COLORS/, 'MARQUEE_COLORS が export されていない');
  assert.match(joined, /renderMarqueeContent/, 'renderMarqueeContent が export されていない');
  // renderMarqueePreview は cleanText + renderMarqueeContent を呼ぶ薄いラッパ（新経路を作らない）
  const previewSrc = extractFunctionSource(MARQUEE, 'renderMarqueePreview');
  assert.ok(previewSrc, 'renderMarqueePreview 抽出失敗');
  assert.match(previewSrc, /renderMarqueeContent\s*\(/, 'renderMarqueePreview が renderMarqueeContent を呼んでいない');
  assert.match(previewSrc, /cleanText\s*\(/, 'renderMarqueePreview が cleanText を経由していない');
});

// ============================================================
// renderer.js: import / 配線 / maxLength ガード / hall ガード
// ============================================================
test('T9: renderer.js が renderMarqueePreview / resolveMarqueeColor を import', () => {
  const importBlock = RENDERER.match(/import \{[\s\S]*?\} from '\.\/marquee\.js';/);
  assert.ok(importBlock, "marquee.js の import ブロックが見つからない");
  assert.match(importBlock[0], /renderMarqueePreview/, 'renderMarqueePreview を import していない');
  assert.match(importBlock[0], /resolveMarqueeColor/, 'resolveMarqueeColor を import していない');
});

test('T10: wireMarqueeColorToolbar が 2 箇所（設定タブ + ダイアログ）で呼ばれる', () => {
  // 定義（function wireMarqueeColorToolbar({ textarea, ... ）を除き、el.* を渡す呼出のみ数える
  const calls = (RENDERER.match(/wireMarqueeColorToolbar\(\{\s*[\r\n]\s*textarea:\s*el\./g) || []).length;
  assert.equal(calls, 2, `wireMarqueeColorToolbar の呼出が 2 でない（実際: ${calls}）`);
  // tab / dialog 両方の textarea を渡している
  assert.match(RENDERER, /textarea:\s*el\.marqueeTabText/, '設定タブ版 textarea を配線していない');
  assert.match(RENDERER, /textarea:\s*el\.marqueeText\b/, 'ダイアログ版 textarea を配線していない');
});

test('T11: applyMarqueeColorToSelection に maxLength 超過ガードと選択なしガードと hall ガードがある', () => {
  const body = extractFunctionSource(RENDERER, 'applyMarqueeColorToSelection');
  assert.ok(body, 'applyMarqueeColorToSelection 抽出失敗');
  assert.match(body, /textarea\.maxLength/, 'maxLength 参照がない');
  assert.match(body, /result\.value\.length\s*>\s*max/, 'maxLength 超過ガードがない');
  assert.match(body, /start\s*===\s*end/, '選択なしガードがない');
  assert.match(body, /window\.appRole\s*===\s*['"]hall['"]/, 'hall ガードがない');
});

// ============================================================
// index.html: 2 箇所のツールバー UI（スウォッチ 9 + 任意色 + クリア + プレビュー）
// ============================================================
test('T12: 両編集 UI に色ツールバー一式が存在（スウォッチ 9×2・任意色・クリア・プレビュー）', () => {
  // ツールバー container は 2 箇所
  assert.match(HTML, /id="js-marquee-tab-color-toolbar"/, '設定タブ版ツールバーがない');
  assert.match(HTML, /id="js-marquee-color-toolbar"/, 'ダイアログ版ツールバーがない');
  // スウォッチ合計 18（9 × 2）
  const swatches = (HTML.match(/class="marquee-color-swatch"/g) || []).length;
  assert.equal(swatches, 18, `スウォッチ数が 18 でない（実際: ${swatches}）`);
  // 任意色 input・クリアボタン・プレビュー box が各 2
  assert.match(HTML, /id="js-marquee-tab-color-custom"/, '設定タブ版 任意色 input がない');
  assert.match(HTML, /id="js-marquee-color-custom"/, 'ダイアログ版 任意色 input がない');
  assert.match(HTML, /id="js-marquee-tab-color-clear"/, '設定タブ版 クリアボタンがない');
  assert.match(HTML, /id="js-marquee-color-clear"/, 'ダイアログ版 クリアボタンがない');
  assert.match(HTML, /id="js-marquee-tab-preview-box"/, '設定タブ版 プレビュー box がない');
  assert.match(HTML, /id="js-marquee-preview-box"/, 'ダイアログ版 プレビュー box がない');
  // telop-preview-label: 表示専用と分かる「プレビュー」ラベルが各 UI に（編集領域と誤認させない）
  const labelCount = (HTML.match(/class="marquee-preview-label"/g) || []).length;
  assert.equal(labelCount, 2, `プレビューラベルが 2 箇所でない（実際: ${labelCount}）`);
});

test('T13: 全スウォッチの data-color がホワイトリストで解決できる（生成記法が必ず色になる）', () => {
  const names = [...HTML.matchAll(/class="marquee-color-swatch" data-color="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 18, `data-color 付きスウォッチが 18 未満（実際: ${names.length}）`);
  for (const n of names) {
    assert.notEqual(P.resolveMarqueeColor(n), null, `スウォッチ data-color="${n}" がホワイトリストで解決できない`);
  }
  // 9 色すべてが各 UI に揃っている
  for (const name of Object.keys(P.MARQUEE_COLORS)) {
    const count = names.filter((n) => n === name).length;
    assert.equal(count, 2, `色 ${name} のスウォッチが 2 箇所に揃っていない（実際: ${count}）`);
  }
});

test('T14: 旧記法ヒント（marquee-decor-hint / [red]文字[/red]）が両 UI に温存（v269 互換）', () => {
  const hintCount = (HTML.match(/marquee-decor-hint/g) || []).length;
  assert.ok(hintCount >= 2, `装飾ヒントが 2 箇所未満（実際: ${hintCount}）`);
  assert.match(HTML, /\[red\]文字\[\/red\]/, '[red]文字[/red] の記法表記が消えた');
  // 新しい操作案内（選んで色ボタン）も両 UI に
  const helpCount = (HTML.match(/marquee-color-help/g) || []).length;
  assert.ok(helpCount >= 2, `操作案内が 2 箇所未満（実際: ${helpCount}）`);
});

// ============================================================
// 致命バグ保護 5 件マーカー健在（本変更は入力 UI のみで非接触）
// ============================================================
test('T15: 致命バグ保護 5 件マーカーが renderer に健在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'resetBlindProgressOnly 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'ensureEditorEditableState 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'schedulePersistRuntime（runtime 永続化）消失');
});

console.log(`\nv272 telop-color-toolbar: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
