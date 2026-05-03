/**
 * v2.0.0 STEP 6 — エッジケース・異常系テスト
 *
 * 検証対象:
 *   - モニター 3 枚以上検出時の動作
 *   - display.label 空文字列のフォールバックラベル
 *   - display-removed で operator 側の display が抜けたケース
 *   - display-added で 3 枚目追加（既に 2 画面）の早期 return
 *   - chooseHallDisplayInteractive の二重 resolve 防止
 *   - _dualStateCache のキー固定（仕様の明示）
 *
 * 実行: node tests/v2-edge-cases.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT       = path.join(__dirname, '..');
const MAIN       = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PICKER_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'display-picker.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionBody(source, name, isAsync = false) {
  const prefix = isAsync ? 'async\\s+' : '';
  const re = new RegExp(`(?:${prefix})?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
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
// T1: モニター 3 枚以上対応 — chooseHallDisplayInteractive は < 2 のみ早期 return
// ============================================================
test('T1: モニター 3 枚以上検出時、chooseHallDisplayInteractive は forEach で全表示', () => {
  // chooseHallDisplayInteractive: displays.length < 2 のみ early return（>= 2 では全モニターを picker に渡す）
  const body = extractFunctionBody(MAIN, 'chooseHallDisplayInteractive', true);
  assert.ok(body, 'chooseHallDisplayInteractive 抽出失敗');
  // < 2 の早期 return
  assert.match(body, /displays\.length\s*<\s*2[\s\S]*?return\s+null/, '< 2 の early return なし');
  // > 2 を別扱いするコードが**ない**こと（つまり >= 2 はすべて同じ経路）
  assert.doesNotMatch(body, /displays\.length\s*>\s*2/, '3 枚以上を別扱いする条件分岐が存在（仕様外）');
  assert.doesNotMatch(body, /displays\.length\s*===\s*2/, '2 枚ちょうどを特殊扱いする条件分岐が存在（仕様外）');

  // display-picker:fetch ハンドラが displays 配列をそのまま map（slice なし）
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]display-picker:fetch['"][\s\S]*?\.map\(/,
    'display-picker:fetch で displays.map による全件返却なし');

  // display-picker.js が forEach ですべてのモニターをカード化
  assert.match(PICKER_JS, /data\.displays\.forEach\(/, 'display-picker.js で forEach 全件処理なし');
});

// ============================================================
// T2: display.label 空文字列のフォールバック（Windows 環境対応）
// ============================================================
test('T2: display.label が空のとき "モニター N" のフォールバックラベル生成', () => {
  // display-picker.js の buildLabel 関数 or 「モニター ${i + 1}」フォールバック
  assert.match(PICKER_JS, /モニター\s*\$\{[^}]+\}/, 'モニター ${...} のフォールバックラベルなし');
  // main.js 側: display-picker:fetch で label を string に正規化（fallback は picker 側だが、空文字をそのまま渡す経路）
  assert.match(MAIN, /typeof\s+d\.label\s*===\s*['"]string['"]/, 'main.js の display-picker:fetch で label 文字列正規化なし');
});

// ============================================================
// T3: display-removed の処理（rc23 で hallWindow alive 時は無条件 close + switchOperatorToSolo に変更）
// ============================================================
test('T3: display-removed は hallWindow 不在/destroyed なら early return + alive なら無条件 solo モード遷移（rc23 真因根治）', () => {
  const body = extractFunctionBody(MAIN, 'setupDisplayChangeListeners');
  assert.ok(body, 'setupDisplayChangeListeners 抽出失敗');
  const removedMatch = body.match(/screen\.on\(\s*['"]display-removed['"][\s\S]*?(?=screen\.on\(\s*['"]display-added['"]|$)/);
  assert.ok(removedMatch, 'display-removed ハンドラ抽出失敗');
  const removed = removedMatch[0];
  // hallWindow 不在 / destroyed の早期 return（既存ガード維持）
  assert.match(removed, /!hallWindow\s*\|\|\s*hallWindow\.isDestroyed\(\)[\s\S]*?return/,
    'hallWindow 不在 / destroyed の early return なし');
  // rc23: isWindowOnDisplay 判定は意図的に削除済（HDMI 抜き直後の hallWindow 移動で必ず false 返却 → solo 不発火真因）
  assert.doesNotMatch(removed, /isWindowOnDisplay\s*\(/,
    'rc23 真因根治: display-removed ハンドラから isWindowOnDisplay 判定が削除されているはず');
  // hallWindow alive 時は無条件 close + switchOperatorToSolo
  assert.match(removed, /hallWindow\.close\s*\(\s*\)[\s\S]*?switchOperatorToSolo\s*\(\s*\)/,
    'hallWindow.close() + switchOperatorToSolo() の無条件遷移経路が見つからない（rc23 真因根治）');
});

// ============================================================
// T4: display-added で既に 2 画面なら何もしない（3 枚目追加の早期 return）
// ============================================================
test('T4: display-added で hallWindow が既に存在するなら early return', () => {
  const body = extractFunctionBody(MAIN, 'setupDisplayChangeListeners');
  assert.ok(body, 'setupDisplayChangeListeners 抽出失敗');
  const addedMatch = body.match(/screen\.on\(\s*['"]display-added['"][\s\S]*$/);
  assert.ok(addedMatch, 'display-added ハンドラ抽出失敗');
  const added = addedMatch[0];
  assert.match(added, /hallWindow\s*&&\s*!hallWindow\.isDestroyed\(\)[\s\S]*?return/,
    '既に 2 画面なら early return（3 枚目追加対策）なし');
});

// ============================================================
// T5: chooseHallDisplayInteractive の Promise 二重 resolve 防止
// ============================================================
test('T5: chooseHallDisplayInteractive に resolved フラグで二重 resolve 防止', () => {
  const body = extractFunctionBody(MAIN, 'chooseHallDisplayInteractive', true);
  assert.ok(body, 'chooseHallDisplayInteractive 抽出失敗');
  // resolved フラグ
  assert.match(body, /let\s+resolved\s*=\s*false/, 'resolved フラグ宣言なし（二重 resolve 防止失敗）');
  // resolved = true セット
  assert.match(body, /resolved\s*=\s*true/, 'resolved = true セットなし');
  // if (resolved) return early ガード
  assert.match(body, /if\s*\(\s*resolved\s*\)\s*return/, 'if (resolved) return ガードなし');
});

// ============================================================
// T6: _dualStateCache のキーが 10 種類で固定されている（仕様の明示）
//   v2.0.4-rc10 Fix 1-A で specialStack 追加（9 → 10）。Ctrl+E の hall 反映に必要。
// ============================================================
test('T6: _dualStateCache のキーが期待の 10 種類のみ', () => {
  // _dualStateCache の宣言を抽出（コメント内に { } を含むため `};` 終端で抽出）
  const m = MAIN.match(/const\s+_dualStateCache\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(m, '_dualStateCache 宣言抽出失敗');
  // 行コメント `// ...` を除いた状態で行頭キーを数える（コメント内の "{" "}" を誤検出しない）
  const cleanedBlock = m[1].replace(/\/\/[^\n]*/g, '');
  // 期待キー（順不同）
  const expectedKeys = [
    'timerState', 'structure', 'displaySettings', 'marqueeSettings',
    'tournamentRuntime', 'tournamentBasics', 'audioSettings', 'logoUrl', 'venueName',
    'specialStack' // v2.0.4-rc10 Fix 1-A
  ];
  for (const k of expectedKeys) {
    const re = new RegExp(`\\b${k}\\s*:`);
    assert.match(cleanedBlock, re, `_dualStateCache に期待キー "${k}" がない`);
  }
  // 想定外のキー追加が無いか（行頭 `\w+:` を数える）
  const keyLines = cleanedBlock.match(/^\s*\w+\s*:/gm) || [];
  assert.ok(keyLines.length === expectedKeys.length,
    `_dualStateCache のキー数が ${keyLines.length}、期待 ${expectedKeys.length}（仕様外キーが追加されている可能性）`);
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
