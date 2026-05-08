/**
 * v2.0.13 静的解析テスト — PRE_START 動的桁切替 + PIP タイマー幅固定
 *   Fix 1（renderer.js）: formatPreStartTime / dataset.prestartFormat を残り時間ベースに変更
 *   Fix 2（style.css）: .pip-timer__digits に font-variant-numeric: tabular-nums を追加
 *
 * 致命バグ保護 5 件 + v2.0.10 観測機構 + v2.0.11 自動更新根治 すべて完全無傷。
 *
 * 実行: node tests/v213-prestart-and-pip-format.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const PKG  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const STYLE_CSS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: formatPreStartTime 内の useHMS 判定が ms 引数ベース
// ============================================================
test('T1: formatPreStartTime 内の useHMS 判定が ms 引数ベース（残り時間で動的判定）', () => {
  const m = RENDERER_JS.match(/function formatPreStartTime\(ms\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'formatPreStartTime 関数が見つからない');
  const body = m[0];
  assert.ok(/const useHMS\s*=\s*ms\s*>=\s*60\s*\*\s*60\s*\*\s*1000/.test(body),
    `formatPreStartTime 内の useHMS が "ms >= 60 * 60 * 1000" 形式でない:\n${body}`);
  assert.ok(!/useHMS\s*=\s*getPreStartTotalMs\(\)/.test(body),
    'formatPreStartTime 内に getPreStartTotalMs() ベースの useHMS が残存（旧仕様）');
});

// ============================================================
// T2: dataset.prestartFormat を設定する 2 箇所が remainingMs 判定
// ============================================================
test('T2: dataset.prestartFormat 設定 2 箇所がともに remainingMs 判定', () => {
  const matches = [...RENDERER_JS.matchAll(/el\.clock\.dataset\.prestartFormat\s*=\s*([^;]+);/g)];
  // 設定 2 箇所 + delete 1 箇所のうち、設定（=）は 2 件
  assert.ok(matches.length >= 2, `dataset.prestartFormat 設定箇所が 2 件未満（実: ${matches.length} 件）`);
  for (const m of matches) {
    const expr = m[1];
    assert.ok(/remainingMs\s*>=\s*60\s*\*\s*60\s*\*\s*1000/.test(expr),
      `dataset.prestartFormat 設定式が remainingMs 判定でない: ${expr}`);
    assert.ok(!/getPreStartTotalMs\(\)/.test(expr),
      `dataset.prestartFormat 設定式に getPreStartTotalMs() が残存（旧仕様）: ${expr}`);
  }
});

// ============================================================
// T3: .pip-timer__digits の CSS ルール内に font-variant-numeric: tabular-nums
// ============================================================
test('T3: .pip-timer__digits に font-variant-numeric: tabular-nums が含まれる', () => {
  const m = STYLE_CSS.match(/\.pip-timer__digits\s*\{[\s\S]*?\}/);
  assert.ok(m, '.pip-timer__digits ブロックが見つからない');
  const body = m[0];
  assert.ok(/font-variant-numeric\s*:\s*tabular-nums/.test(body),
    `.pip-timer__digits に font-variant-numeric: tabular-nums がない:\n${body}`);
});

// ============================================================
// T4: .clock__time の tabular-nums 設定が維持（破壊なし）
// ============================================================
test('T4: .clock__time の tabular-nums 設定維持（既存対策の破壊なし）', () => {
  const m = STYLE_CSS.match(/\.clock__time\s*\{[\s\S]*?\}/);
  assert.ok(m, '.clock__time ブロックが見つからない');
  const body = m[0];
  assert.ok(/font-variant-numeric\s*:\s*tabular-nums/.test(body),
    `.clock__time の font-variant-numeric: tabular-nums が消えている:\n${body}`);
});

// ============================================================
// T5: formatTime 関数（PIP の RUNNING/BREAK 用）の動的判定が維持
// ============================================================
test('T5: formatTime 関数の hours > 0 ? HH:MM:SS : MM:SS ロジック維持', () => {
  const m = RENDERER_JS.match(/function formatTime\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, 'formatTime 関数が見つからない');
  const body = m[0];
  assert.ok(/hours\s*>\s*0/.test(body),
    `formatTime 関数内の "hours > 0" 判定が見つからない:\n${body}`);
});

// ============================================================
// T6: package.json version が 2.0.13
// ============================================================
test('T6: package.json version が 2.0.13', () => {
  assert.equal(PKG.version, '2.1.16',
    `package.json version が ${PKG.version}（期待 2.0.13）`);
});

// ============================================================
// T7: package.json scripts.test に v213-prestart-and-pip-format.test.js が含まれる
// ============================================================
test('T7: package.json scripts.test に v213 テストが登録', () => {
  assert.ok(PKG.scripts && typeof PKG.scripts.test === 'string',
    'package.json scripts.test が存在しない');
  assert.ok(PKG.scripts.test.includes('v213-prestart-and-pip-format.test.js'),
    'scripts.test に v213-prestart-and-pip-format.test.js が含まれない');
});

// ============================================================
// 致命バグ保護 cross-check
// ============================================================
test('保護: v2.0.11 build.win 設定（artifactName / verifyUpdateCodeSignature / publisherName 削除）維持', () => {
  assert.equal(PKG.build.win.artifactName, 'pokertimerplus-setup-${version}.${ext}',
    'build.win.artifactName が変更されている');
  assert.equal(PKG.build.win.verifyUpdateCodeSignature, false,
    'build.win.verifyUpdateCodeSignature が変更されている');
  assert.equal(PKG.build.win.publisherName, undefined,
    'build.win.publisherName が復活している');
});

test('保護: v2.0.10 観測機構（electron-log + rollingLog）が維持', () => {
  assert.ok(PKG.dependencies && PKG.dependencies['electron-log'],
    'dependencies.electron-log が削除されている');
  const MAIN_JS = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.ok(/function rollingLog\b/.test(MAIN_JS) || /rollingLog\s*=\s*function/.test(MAIN_JS) || /const rollingLog\b/.test(MAIN_JS) || /rollingLog\(/.test(MAIN_JS),
    'main.js に rollingLog 関連コードが見当たらない');
});

// ============================================================
// 結果
// ============================================================
console.log(`\nv213-prestart-and-pip-format.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
