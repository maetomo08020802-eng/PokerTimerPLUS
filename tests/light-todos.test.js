/**
 * STEP 10 フェーズC.1-A — 軽 TODO 4 件のうち実装した 2 件の回帰防止テスト
 *
 * 実装:
 *   Fix 3: preset name の JS 側 sanitize（main.js: presets:saveUser で slice(0, 50)）
 *          + HTML maxlength=50（index.html: js-preset-name）
 *   Fix 4: renderBlindsTable で DocumentFragment 採用（reflow を 1 回に削減）
 *
 * 実装せず:
 *   Fix 1（debounce）: 既存 last-write-wins で最終状態正しい、軽微 flicker のみ → 不要
 *   Fix 2（破棄ボタン）: 既存 UI に該当ボタンなし、preset 切替経由の rollback で機能 → 不要
 *
 * 実行: node tests/light-todos.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = source.match(re);
  if (!m) throw new Error(`function ${name} が見つからない`);
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return source.slice(m.index, i);
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

// ============================================================
// T1（Fix 3 JS）: presets:saveUser ハンドラが preset.name を slice(0, 50) する
// ============================================================
test('T1: presets:saveUser が preset.name を slice(0, 50) で sanitize', () => {
  // ハンドラ宣言から sanitized 構築までを抽出
  const idx = MAIN.indexOf("'presets:saveUser'");
  assert.ok(idx >= 0, 'presets:saveUser ハンドラが見つからない');
  const sliced = MAIN.slice(idx, idx + 2000);
  // String(preset.name).slice(0, 50) のパターン確認
  assert.match(
    sliced,
    /String\(preset\.name\)\.slice\(0,\s*50\)/,
    'preset.name の slice(0, 50) が見つからない'
  );
  // sanitized オブジェクトの name に safeName が使われているか
  assert.match(sliced, /name:\s*safeName/, 'sanitized.name に safeName が使われていない');
});

// ============================================================
// T2（Fix 3 HTML）: js-preset-name の input に maxlength="50"
// ============================================================
test('T2: js-preset-name input に maxlength="50"', () => {
  const m = HTML.match(/<input[^>]*id=["']js-preset-name["'][^>]*>/);
  assert.ok(m, 'js-preset-name input が見つからない');
  assert.match(m[0], /maxlength=["']50["']/, 'maxlength="50" が設定されていない');
});

// ============================================================
// T3（Fix 4）: renderBlindsTable が DocumentFragment を使う
// ============================================================
test('T3: renderBlindsTable が DocumentFragment で行追加をバッチ化', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'renderBlindsTable'));
  // createDocumentFragment 呼び出しの存在
  assert.match(body, /document\.createDocumentFragment\(\)/, 'createDocumentFragment が呼ばれていない');
  // for ループ内で frag.appendChild
  assert.match(body, /frag\.appendChild\(/, 'frag.appendChild が呼ばれていない');
  // 最終的に tbody.appendChild(frag)
  assert.match(body, /blindsTbody\.appendChild\(frag\)/, 'tbody.appendChild(frag) が呼ばれていない');
});

// ============================================================
// T4（Fix 4 副作用なし）: 既存の el.blindsTbody.innerHTML = '' は維持
// ============================================================
test('T4: renderBlindsTable が tbody クリアと readonly 反映を維持', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'renderBlindsTable'));
  // tbody を空にしてから fragment 追加
  assert.match(body, /blindsTbody\.innerHTML\s*=\s*['"]['"]/,'tbody.innerHTML="" が消えている');
  // setBlindsTableReadonly が末尾で呼ばれる（新規行への disabled 伝播）
  assert.match(body, /setBlindsTableReadonly\(/, 'setBlindsTableReadonly が呼ばれていない');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
