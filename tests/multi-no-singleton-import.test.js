/**
 * multi-tournament-4up Phase 1 — 非接触性の静的検証
 *
 * 「multi 系新ファイルが既存シングルトン（timer.js / state.js / blinds.js / audio.js / dual-sync.js /
 *  marquee.js / renderer.js）を import しない」「store 書込 API を呼ばない」
 * 「ページ大域（document.documentElement）へ書かない」ことをソース文字列レベルで担保する。
 * これが破られると、単一モードとの状態衝突（Phase 0 plan §1.5 のシングルトン障害）が再発する。
 *
 * 実行: node tests/multi-no-singleton-import.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

const MULTI_DIR = path.join(__dirname, '..', 'src', 'renderer', 'multi');
const MULTI_FILES = ['multi-engine.mjs', 'multi-grid.js', 'multi-control.js', 'multi-grid.html', 'multi-control.html', 'multi.css'];
const sources = {};
for (const f of MULTI_FILES) {
  sources[f] = fs.readFileSync(path.join(MULTI_DIR, f), 'utf8');
}

// コメント（設計原則の説明文）は検査対象外にする。「〜は使わない」という原則コメント自体が
// 禁止パターンに誤検知されるため、コード実体のみを検査する。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // JS/CSS ブロックコメント
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // JS 行コメント（URL の :// は除外）
    .replace(/<!--[\s\S]*?-->/g, '');   // HTML コメント
}
const code = {};
for (const f of MULTI_FILES) code[f] = stripComments(sources[f]);
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const RENDERER = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');

// ============================================================
// 1. 既存シングルトンモジュールを import しない
// ============================================================
test('multi 系 JS は既存シングルトン（timer/state/blinds/audio/dual-sync/marquee/renderer）を import しない', () => {
  const banned = ['timer.js', 'state.js', 'blinds.js', 'audio.js', 'dual-sync.js', 'marquee.js', 'renderer.js'];
  for (const f of ['multi-engine.mjs', 'multi-grid.js', 'multi-control.js']) {
    const src = code[f];
    for (const b of banned) {
      assert.ok(!new RegExp(`import[^;]*['"][^'"]*${b.replace('.', '\\.')}['"]`).test(src),
        `${f} が ${b} を import している`);
    }
  }
});

test('multi HTML は index.html の資産（style.css / renderer.js / audio / marquee）を読み込まない', () => {
  for (const f of ['multi-grid.html', 'multi-control.html']) {
    const src = code[f];
    assert.ok(!/href="\.\.\/style\.css"|src="\.\.\/renderer\.js"|src="\.\.\/audio\.js"|src="\.\.\/marquee\.js"/.test(src),
      `${f} が単一モードの資産を読み込んでいる`);
  }
});

// ============================================================
// 2. 無効化 3 項目 + 付随（スライドショー / 音 / テロップ / PIP / ミュートバッジ）が DOM ごと存在しない
// ============================================================
test('multi-grid に スライドショー / 音 / テロップ / PIP / ミュートバッジ の痕跡がない', () => {
  const src = code['multi-grid.html'] + code['multi-grid.js'] + code['multi.css'];
  const banned = [/slideshow/i, /marquee/i, /AudioContext/, /playSound/, /pip-timer|pipTimer|data-pip/i, /mute-indicator|muteIndicator|ミュート中/];
  for (const re of banned) {
    assert.ok(!re.test(src), `multi-grid に ${re} の痕跡がある`);
  }
});

// ============================================================
// 3. store 書込 API を呼ばない（読み取り専用 snapshot 設計の担保 = 致命保護⑤非衝突の根拠）
// ============================================================
test('multi 系 JS は store 書込系 API（setTimerState/setRuntime/setActive/save/delete 等）を呼ばない', () => {
  const banned = ['setTimerState', 'setRuntime', 'setActive', 'tournaments.save', 'tournaments.delete',
    'setDisplaySettings', 'setMarqueeSettings', 'saveUser', 'deleteUser', 'importPayload', 'audio.set'];
  for (const f of ['multi-engine.mjs', 'multi-grid.js', 'multi-control.js']) {
    for (const b of banned) {
      assert.ok(!code[f].includes(b), `${f} が ${b} を呼んでいる`);
    }
  }
});

test('main.js の multi ブロックは store.set を呼ばない（読み取りのみ）', () => {
  // multi ブロック（マーカーコメント〜 registerMultiIpcHandlers() 呼出まで）を抽出して検証
  const m = MAIN.match(/\/\/ ===== multi-tournament-4up Phase 1[\s\S]*?registerMultiIpcHandlers\(\);/);
  assert.ok(m, 'main.js に multi ブロックが見つからない');
  assert.ok(!/store\.set\(/.test(m[0]), 'multi ブロックが store.set を呼んでいる');
  assert.ok(/store\.get\(/.test(m[0]), 'multi ブロックの store 参照は get のみのはず');
});

// ============================================================
// 4. ページ大域（document.documentElement）へ書かない（区画コンテナ単位テーマの担保）
// ============================================================
test('multi-grid.js / multi-control.js は document.documentElement に触れない', () => {
  for (const f of ['multi-grid.js', 'multi-control.js']) {
    assert.ok(!code[f].includes('document.documentElement'), `${f} が document.documentElement に触れている`);
  }
});

test('multi.css は transform: scale を使わない（レイアウトシフト撲滅原則）', () => {
  assert.ok(!/transform\s*:\s*scale/i.test(code['multi.css']), 'multi.css に transform: scale がある');
});

// ============================================================
// 5. 入口・チャンネルの配線が存在する（結線切れの検知）
// ============================================================
test('入口: index.html にボタン、renderer.js 末尾にハンドラ、preload に multi API がある', () => {
  assert.ok(INDEX_HTML.includes('js-multi-mode-enter'), 'index.html に入口ボタンがない');
  assert.ok(RENDERER.includes("getElementById('js-multi-mode-enter')"), 'renderer.js に入口ハンドラがない');
  assert.ok(PRELOAD.includes("'multi:enter'") && PRELOAD.includes("'multi:state-sync-init'"), 'preload.js に multi API がない');
});

test('main.js: multi:* IPC（enter/exit/publish/state-sync-init）が登録されている', () => {
  for (const ch of ["'multi:enter'", "'multi:exit'", "'multi:publish'", "'multi:state-sync-init'"]) {
    assert.ok(MAIN.includes(ch), `main.js に ${ch} ハンドラがない`);
  }
});

test('main.js: 既存 dual 系コアは無改変（_publishDualState の hallWindow 単一送信 / _dualStateCache 構造）', () => {
  // multi 追加後も dual-sync コアの不変条件が保たれていることの回帰ガード
  assert.match(MAIN, /function _broadcastDualState\(channel, payload\) \{\s*if \(!hallWindow \|\| hallWindow\.isDestroyed\(\)\) return;/,
    '_broadcastDualState の hall 単一送信ガードが変わっている');
  assert.ok(!/multiGridWindow/.test(MAIN.match(/function _publishDualState[\s\S]*?\n\}/)[0]),
    '_publishDualState が multi ウィンドウに送信している（別チャンネル原則違反）');
});

test('multi-grid.js は rAF ループ 1 本（requestAnimationFrame の自己再帰が 1 箇所）', () => {
  const count = (code['multi-grid.js'].match(/requestAnimationFrame\(/g) || []).length;
  // tickLoop 内の自己再帰 + 起動時の 1 回 = 2 呼出箇所まで（ループ自体は 1 本）
  assert.ok(count <= 2, `multi-grid.js の requestAnimationFrame 呼出が ${count} 箇所（rAF 1 本原則）`);
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
