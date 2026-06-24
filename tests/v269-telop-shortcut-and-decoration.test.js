/**
 * v2.6.2（telop-dualscreen-ideas ①③）回帰テスト
 *
 *   ① 単独 T キーでテロップ表示/非表示トグル（toggleMarquee）
 *     - dispatchClockShortcut に case 'KeyT'（修飾なし時のみ toggleMarquee）
 *     - toggleMarquee: enabled 反転 → applyMarquee → setMarqueeSettings（永続化＋hall同期）/ hall ガード
 *   ③ テロップ部分装飾（色のみ・案A）: 記法 [color]…[/color] を限定パースして span 化
 *     - innerHTML 不使用（createElement+textContent+検証済 color のみ）＝XSS 構造的に不可
 *     - 保存スキーマ無変更（text 文字列に乗る）
 *
 *   ③は実ソース（MARQUEE_COLORS / resolveMarqueeColor / renderMarqueeContent）を抽出し
 *   new Function + DOM スタブで実行＝出荷コードをそのまま検証（v252 と同パターン）。
 *
 *   実行: node tests/v269-telop-shortcut-and-decoration.test.js
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

// ===== ③ パーサを出荷ソースから組み立てて実行可能化 =====
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
    set(v) { _text = String(v); node._kids = []; }   // DOM 同様 textContent='' で子をクリア
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
// container の子要素を {text, color, isSpan} に要約
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

const P = buildMarqueeParser();

// ============================================================
// ③ resolveMarqueeColor: ホワイトリスト / #RRGGBB / 許可外
// ============================================================
test('T1: resolveMarqueeColor — ホワイトリスト名（大小無視）と #RRGGBB を解決、許可外は null', () => {
  assert.equal(P.resolveMarqueeColor('red'), P.MARQUEE_COLORS.red, 'red が解決されない');
  assert.equal(P.resolveMarqueeColor('RED'), P.MARQUEE_COLORS.red, '大文字 RED が解決されない（大小無視のはず）');
  assert.equal(P.resolveMarqueeColor('#abcdef'), '#abcdef', '#RRGGBB が通らない');
  assert.equal(P.resolveMarqueeColor('#ABCDEF'), '#ABCDEF', '大文字 hex が通らない');
  assert.equal(P.resolveMarqueeColor('bogus'), null, '許可外色名が null でない');
  assert.equal(P.resolveMarqueeColor('#ff'), null, '不正 hex が null でない');
  assert.equal(P.resolveMarqueeColor(123), null, '非文字列が null でない');
});

// ============================================================
// ③ プレーン文字列は span を作らず text node のみ
// ============================================================
test('T2: プレーンテキストは装飾なし（text node のみ・span ゼロ）', () => {
  const c = makeContainer();
  P.renderMarqueeContent(c, 'HELLO WORLD');
  const parts = summarize(c);
  assert.equal(parts.length, 1, '子要素が1つでない');
  assert.equal(parts[0].isSpan, false, 'span が生成された（プレーンのはず）');
  assert.equal(visibleText(c), 'HELLO WORLD', '表示テキストが一致しない');
});

// ============================================================
// ③ [red]…[/red] → span 1つ・色は red hex
// ============================================================
test('T3: [red]WIN[/red] が span 1つ・color=red hex で描画', () => {
  const c = makeContainer();
  P.renderMarqueeContent(c, '[red]WIN[/red]');
  const spans = summarize(c).filter((p) => p.isSpan);
  assert.equal(spans.length, 1, 'span が1つでない');
  assert.equal(spans[0].text, 'WIN', 'span テキストが WIN でない');
  assert.equal(spans[0].color, P.MARQUEE_COLORS.red, 'span の色が red hex でない');
  assert.equal(visibleText(c), 'WIN', '可視テキストが WIN でない（タグは消える）');
});

// ============================================================
// ③ 地の文＋装飾＋地の文の混在
// ============================================================
test('T4: A[gold]B[/gold]C が text/span(gold)/text の3片で連続', () => {
  const c = makeContainer();
  P.renderMarqueeContent(c, 'A[gold]B[/gold]C');
  const parts = summarize(c);
  assert.equal(visibleText(c), 'ABC', '可視テキストが ABC でない');
  const span = parts.find((p) => p.isSpan);
  assert.ok(span, 'span が生成されていない');
  assert.equal(span.text, 'B', '装飾されるのは B のみのはず');
  assert.equal(span.color, P.MARQUEE_COLORS.gold, 'B の色が gold でない');
});

// ============================================================
// ③ #RRGGBB 直指定
// ============================================================
test('T5: [#ff0000]R[/#ff0000] が color=#ff0000 の span', () => {
  const c = makeContainer();
  P.renderMarqueeContent(c, '[#ff0000]R[/#ff0000]');
  const spans = summarize(c).filter((p) => p.isSpan);
  assert.equal(spans.length, 1, 'span が1つでない');
  assert.equal(spans[0].color, '#ff0000', 'color が #ff0000 でない');
});

// ============================================================
// ③ 未知の色はタグごと地の文字でフォールバック（壊れない）
// ============================================================
test('T6: 未知色 [foo]X[/foo] は span を作らず記法ごと地の文字で残る', () => {
  const c = makeContainer();
  P.renderMarqueeContent(c, '[foo]X[/foo]');
  const spans = summarize(c).filter((p) => p.isSpan);
  assert.equal(spans.length, 0, '未知色で span が作られた（フォールバック失敗）');
  assert.equal(visibleText(c), '[foo]X[/foo]', '未知記法が地の文字で保持されていない');
});

// ============================================================
// ③ XSS 安全: 装飾内の HTML 風文字列は textContent でそのまま（実行されない）
// ============================================================
test('T7: [red]<script>…</script>[/red] は span.textContent にリテラル格納（innerHTML 不使用）', () => {
  const c = makeContainer();
  const payload = '<script>alert(1)</script>';
  P.renderMarqueeContent(c, `[red]${payload}[/red]`);
  const spans = summarize(c).filter((p) => p.isSpan);
  assert.equal(spans.length, 1, 'span が1つでない');
  assert.equal(spans[0].text, payload, 'span に HTML がリテラルで入っていない（textContent のはず）');
  // marquee.js に innerHTML 系の「使用」が無いことを静的にも担保（コメント内の語は除外＝実使用パターンで判定）
  assert.doesNotMatch(MARQUEE, /\.(innerHTML|outerHTML)\b|insertAdjacentHTML\s*\(/, 'marquee.js に innerHTML 系の使用が混入');
});

// ============================================================
// ③ applyMarquee が renderMarqueeContent 経由（生 textContent= 直書きを置換）
// ============================================================
test('T8: applyMarquee が renderMarqueeContent を呼ぶ（textContent 直書きを廃止）', () => {
  const body = extractFunctionBody(MARQUEE, 'applyMarquee');
  assert.ok(body, 'applyMarquee 本体抽出失敗');
  assert.match(body, /renderMarqueeContent\s*\(\s*dom\.content\s*,/, 'applyMarquee が renderMarqueeContent を呼んでいない');
  assert.doesNotMatch(body, /dom\.content\.textContent\s*=/, 'applyMarquee に textContent 直書きが残っている');
});

// ============================================================
// ① toggleMarquee: enabled 反転 + setMarqueeSettings + hall ガード
// ============================================================
test('T9: toggleMarquee が enabled 反転・hall ガード・setMarqueeSettings 永続化を持つ', () => {
  const body = extractFunctionBody(RENDERER, 'toggleMarquee');
  assert.ok(body, 'toggleMarquee 本体抽出失敗');
  assert.match(body, /window\.appRole\s*===\s*['"]hall['"]/, 'hall ガードがない');
  assert.match(body, /!\s*lastMarqueeSettings\.enabled/, 'enabled 反転がない');
  assert.match(body, /applyMarquee\s*\(/, 'applyMarquee 呼出がない');
  assert.match(body, /setMarqueeSettings\s*\(/, 'setMarqueeSettings（永続化＋hall同期）呼出がない');
});

// ============================================================
// ① dispatchClockShortcut に単独 T トグル（Ctrl+T とは別）
// ============================================================
test('T10: dispatchClockShortcut の KeyT が修飾なし時のみ toggleMarquee を呼ぶ', () => {
  const body = extractFunctionBody(RENDERER, 'dispatchClockShortcut');
  assert.ok(body, 'dispatchClockShortcut 本体抽出失敗');
  assert.match(body, /case\s+['"]KeyT['"]\s*:/, "case 'KeyT' がない");
  // KeyT case 内に修飾なしガード + toggleMarquee
  const idx = body.indexOf("case 'KeyT'") >= 0 ? body.indexOf("case 'KeyT'") : body.indexOf('case "KeyT"');
  const seg = body.slice(idx, idx + 260);
  assert.match(seg, /!event\.ctrlKey\s*&&\s*!event\.metaKey/, 'KeyT case に修飾なしガードがない');
  assert.match(seg, /toggleMarquee\s*\(\s*\)/, 'KeyT case で toggleMarquee を呼んでいない');
  // Ctrl+T のダイアログ導線（先取り）が健在
  assert.match(body, /event\.code\s*===\s*['"]KeyT['"]/, 'Ctrl+T 先取り判定が消えた');
  assert.match(body, /openMarqueeDialog\s*\(\s*\)/, 'Ctrl+T の openMarqueeDialog 導線が消えた');
});

// ============================================================
// ① UI ヒント/ヘルプの追加（index.html）
// ============================================================
test('T11: index.html に T トグルのヘルプ表記と装飾記法ヒントがある', () => {
  assert.match(HTML, /テロップ表示\s*\/\s*非表示/, '操作一覧/strip に T トグル表記がない');
  assert.match(HTML, /\[red\]文字\[\/red\]/, 'テロップ装飾記法ヒントがない');
  // 装飾ヒントは2箇所（ダイアログ + 設定タブ）
  const hintCount = (HTML.match(/marquee-decor-hint/g) || []).length;
  assert.ok(hintCount >= 2, `装飾ヒントが2箇所未満（実際: ${hintCount}）`);
});

// ============================================================
// 致命バグ保護 5 件マーカー健在（本変更は表示/ショートカットのみで非接触）
// ============================================================
test('T12: 致命バグ保護 5 件マーカーが renderer に健在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'resetBlindProgressOnly 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'ensureEditorEditableState 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'schedulePersistRuntime（runtime 永続化）消失');
});

console.log(`\nv269 telop-shortcut-and-decoration: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
