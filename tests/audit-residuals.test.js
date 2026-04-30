/**
 * STEP 10 フェーズC.1.1 — audit 残課題のうち実装した 3 件の回帰防止テスト
 *
 * 実装:
 *   Fix 2: cancelPendingTimerStatePersist は debounce のみ cancel するが、
 *          _tournamentSwitching フラグで periodicPersistAllRunning を skip
 *   Fix 6: preset 削除前に tournaments.list を引いて参照中なら警告メッセージを表示
 *   Fix 7: tournament/preset ID 生成を `${prefix}-${Date.now()}-${random6}` に強化
 *
 * 実装せず（再現性なし or 既に防御済み）:
 *   Fix 1（DONE 状態）: computeLiveTimerState は paused を返す設計、DONE 状態は存在しない
 *   Fix 3（Space ダイアログ中）: keydown handler で dialog.open + INPUT/TEXTAREA target 早期 return
 *   Fix 4（IME Space）: 同上、INPUT/TEXTAREA 内では Space を pass-through
 *   Fix 5（Ctrl+Q）: confirmQuit ダイアログが既に存在（main.js:783）
 *   Fix 8（avgStack 負値）: computeAvgStack で playersRemaining<=0 早期 return
 *
 * 実行: node tests/audit-residuals.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

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
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// ============================================================
// T1（Fix 2）: _tournamentSwitching フラグが定義されている
// ============================================================
test('T1: _tournamentSwitching フラグが定義されている', () => {
  assert.match(RENDERER, /let\s+_tournamentSwitching\s*=\s*false/, '_tournamentSwitching フラグが定義されていない');
});

// ============================================================
// T2（Fix 2）: periodicPersistAllRunning が _tournamentSwitching で skip
// ============================================================
test('T2: periodicPersistAllRunning が _tournamentSwitching で skip する', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'periodicPersistAllRunning'));
  assert.match(body, /if\s*\(\s*_tournamentSwitching\s*\)\s*return/, 'periodicPersistAllRunning に switching ガードがない');
});

// ============================================================
// T3（Fix 2）: handleTournamentNew が switching フラグを finally でリセット
// ============================================================
test('T3: handleTournamentNew が _tournamentSwitching を try/finally で管理', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handleTournamentNew'));
  assert.match(body, /_tournamentSwitching\s*=\s*true/, '_tournamentSwitching=true がない');
  assert.match(body, /finally[\s\S]*_tournamentSwitching\s*=\s*false/, 'finally ブロックで false にリセットされていない');
});

// ============================================================
// T4（Fix 2）: handleTournamentDuplicate も switching ガード
// ============================================================
test('T4: handleTournamentDuplicate が _tournamentSwitching を try/finally で管理', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handleTournamentDuplicate'));
  assert.match(body, /_tournamentSwitching\s*=\s*true/, '_tournamentSwitching=true がない');
  assert.match(body, /finally[\s\S]*_tournamentSwitching\s*=\s*false/, 'finally ブロックで false にリセットされていない');
});

// ============================================================
// T5（Fix 7）: generateUniqueId ヘルパが定義されている
// ============================================================
test('T5: generateUniqueId ヘルパが定義され、Math.random base36 サフィックスを使う', () => {
  assert.match(RENDERER, /function\s+generateUniqueId\s*\(/, 'generateUniqueId 関数が定義されていない');
  const body = stripComments(extractFunctionBody(RENDERER, 'generateUniqueId'));
  assert.match(body, /Date\.now\(\)/, 'Date.now() を使っていない');
  assert.match(body, /Math\.random\(\)\.toString\(36\)/, 'Math.random base36 サフィックスがない');
});

// ============================================================
// T6（Fix 7）: ID 生成の主要箇所が generateUniqueId を使う
// ============================================================
test('T6: handleTournamentNew / Duplicate / preset 系 で generateUniqueId を使う', () => {
  // tournament-${Date.now()} の旧パターンが完全に消えている
  // （コメント内の歴史記述は除外、実コードのみ）
  const stripped = stripComments(RENDERER);
  assert.doesNotMatch(stripped, /id:\s*`tournament-\$\{Date\.now\(\)\}`/, '旧 tournament ID 生成パターンが残っている');
  assert.doesNotMatch(stripped, /id\s*=\s*`user-\$\{Date\.now\(\)\}`/, '旧 user preset ID 生成パターンが残っている');
  // generateUniqueId 呼出が複数箇所
  const callMatches = stripped.match(/generateUniqueId\s*\(/g) || [];
  assert.ok(callMatches.length >= 4, `generateUniqueId 呼出が 4 箇所以上ない（${callMatches.length} 件）`);
});

// ============================================================
// T7（Fix 6）: presetDelete handler が tournaments.list を引いて使用検出
// ============================================================
test('T7: presetDelete ハンドラが tournaments.list で参照中チェックする', () => {
  const idx = RENDERER.indexOf("el.presetDelete?.addEventListener('click'");
  assert.ok(idx >= 0, 'presetDelete のクリックハンドラが見つからない');
  const slice = stripComments(RENDERER.slice(idx, idx + 2500));
  assert.match(slice, /tournaments\.list/, '削除前に tournaments.list が呼ばれていない');
  assert.match(slice, /blindPresetId\s*===\s*deletedId/, 'blindPresetId === deletedId のフィルタがない');
  assert.match(slice, /で使用中/, '使用中メッセージが含まれていない');
});

// ============================================================
// T8（既存挙動維持）: handlePresetApply の reset 分岐は resetBlindProgressOnly を維持
// ============================================================
test('T8: handlePresetApply は引き続き resetBlindProgressOnly を呼ぶ（C.2.7-A 致命バグ修正の保護）', () => {
  const body = stripComments(extractFunctionBody(RENDERER, 'handlePresetApply'));
  assert.match(body, /resetBlindProgressOnly\(/, 'resetBlindProgressOnly が消えている');
  assert.doesNotMatch(body, /\bhandleReset\(/, 'handleReset が誤って呼ばれている');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
