/**
 * STEP 10 フェーズC.1.8 — トーナメント途中の再起動でランタイムデータ消失バグの修正
 *
 * 真因: tournaments テーブルに runtime フィールドが無く、tournamentRuntime は renderer メモリのみ。
 *       アプリ終了でメモリ消失 → 再起動でデフォルト 0 → ランタイムデータが消える。
 *
 * 修正:
 *   - main.js: DEFAULT_TOURNAMENT_EXT.runtime / store.defaults.tournaments[0].runtime
 *              + sanitizeRuntime + migrateTournamentSchema + normalizeTournament + tournaments:list
 *              + 新 IPC tournaments:setRuntime
 *   - preload.js: tournaments.setRuntime bridge
 *   - renderer.js: schedulePersistRuntime（debounce 500ms）+ applyTournament で復元
 *                  + addNewEntry / cancelNewEntry / eliminatePlayer / revivePlayer /
 *                    initTournamentRuntime / resetTournamentRuntime / adjustReentry / adjustAddOn
 *                  に schedulePersistRuntime() フック
 *
 * 実行: node tests/c18-runtime-persistence.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');

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

// ============================================================
// T43: tournaments テーブル保存時に runtime フィールドが含まれる
// ============================================================
test('T43: DEFAULT_TOURNAMENT_EXT + store.defaults.tournaments[0] に runtime フィールド', () => {
  // DEFAULT_TOURNAMENT_EXT.runtime
  assert.match(MAIN, /runtime:\s*\{\s*playersInitial[\s\S]*?playersRemaining[\s\S]*?reentryCount[\s\S]*?addOnCount/,
    'DEFAULT_TOURNAMENT_EXT.runtime に 4 フィールドがない');
  // sanitizeRuntime 関数定義
  assert.match(MAIN, /function\s+sanitizeRuntime\s*\(/, 'sanitizeRuntime 関数定義がない');
});

// ============================================================
// T44: 起動時の tournaments ロードで runtime が復元（applyTournament + tournaments:list）
// ============================================================
test('T44: applyTournament で t.runtime からメモリへ反映 + tournaments:list が runtime 同梱', () => {
  // applyTournament 内の runtime 復元コード
  const body = extractFunctionBody(RENDERER, 'applyTournament');
  assert.ok(body, 'applyTournament 関数本体抽出失敗');
  assert.match(body, /t\.runtime[\s\S]*?tournamentRuntime\.playersInitial/,
    'applyTournament で t.runtime → tournamentRuntime 復元コードがない');
  assert.match(body, /tournamentRuntime\.playersRemaining/, 'playersRemaining の復元がない');
  assert.match(body, /tournamentRuntime\.reentryCount/, 'reentryCount の復元がない');
  assert.match(body, /tournamentRuntime\.addOnCount/, 'addOnCount の復元がない');
  // tournaments:list で runtime 同梱
  assert.match(MAIN, /timerState:\s*normalizeTimerState[\s\S]*?runtime:\s*sanitizeRuntime/,
    'tournaments:list の return に runtime: sanitizeRuntime 同梱がない');
});

// ============================================================
// T45: プレイヤー人数変更が store に保存される（schedulePersistRuntime 呼出）
// ============================================================
test('T45: addNewEntry / eliminatePlayer / cancelNewEntry / revivePlayer で schedulePersistRuntime 呼出', () => {
  for (const fn of ['addNewEntry', 'cancelNewEntry', 'eliminatePlayer', 'revivePlayer']) {
    const body = extractFunctionBody(RENDERER, fn);
    assert.ok(body, `${fn} 関数本体抽出失敗`);
    assert.match(body, /schedulePersistRuntime\s*\(\s*\)/,
      `${fn} で schedulePersistRuntime 呼出がない（再起動でランタイム消失リスク）`);
  }
  // schedulePersistRuntime 関数自体の定義
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'schedulePersistRuntime 関数定義がない');
});

// ============================================================
// T46: リエントリー / アドオン / プレスタート初期化 / 明示リセットでも保存
// ============================================================
test('T46: adjustReentry / adjustAddOn / initTournamentRuntime / resetTournamentRuntime で schedulePersistRuntime', () => {
  for (const fn of ['adjustReentry', 'adjustAddOn', 'initTournamentRuntime', 'resetTournamentRuntime']) {
    const body = extractFunctionBody(RENDERER, fn);
    assert.ok(body, `${fn} 関数本体抽出失敗`);
    assert.match(body, /schedulePersistRuntime\s*\(\s*\)/,
      `${fn} で schedulePersistRuntime 呼出がない`);
  }
  // IPC: tournaments:setRuntime
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'main.js に tournaments:setRuntime IPC handler がない');
  // preload bridge
  assert.match(PRELOAD, /setRuntime:\s*\(.*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]tournaments:setRuntime['"]/,
    'preload.js に setRuntime bridge がない');
});

// ============================================================
// T47: 旧バージョンデータ（runtime 未定義）のマイグレーション補完
// ============================================================
test('T47: migrateTournamentSchema で runtime 未定義時に既定値補完', () => {
  // migrateTournamentSchema 関数本体に runtime 補完ロジック
  const body = extractFunctionBody(MAIN, 'migrateTournamentSchema');
  assert.ok(body, 'migrateTournamentSchema 関数本体抽出失敗');
  assert.match(body, /m\.runtime\s*\|\|\s*typeof\s+m\.runtime\s*!==\s*['"]object['"]|!m\.runtime\s*\|\|\s*typeof\s+m\.runtime\s*!==\s*['"]object['"]/,
    'runtime 未定義/object 以外の判定がない');
  assert.match(body, /m\.runtime\s*=\s*\{[\s\S]*?playersInitial[\s\S]*?playersRemaining/,
    '既定値補完（playersInitial/playersRemaining 等）がない');
  // sanitizeRuntime 経由の整合化
  assert.match(body, /sanitizeRuntime/, 'マイグレーションで sanitizeRuntime 経由の整合化がない');
});

// ============================================================
// T48: C.2.7-A 致命バグ修正の保護（resetBlindProgressOnly が runtime に触らない）
// ============================================================
test('T48: resetBlindProgressOnly が tournamentRuntime に触らない（致命バグ 8-8 保護）', () => {
  const body = extractFunctionBody(RENDERER, 'resetBlindProgressOnly');
  assert.ok(body, 'resetBlindProgressOnly 関数本体抽出失敗');
  // tournamentRuntime への代入が含まれないこと（playersInitial/Remaining/reentryCount/addOnCount）
  assert.doesNotMatch(body, /tournamentRuntime\.\w+\s*=/,
    'resetBlindProgressOnly で tournamentRuntime への代入が再発（致命バグ 8-8 リグレッション）');
  // schedulePersistRuntime も呼ばない（runtime 保護のため永続化トリガすら不要）
  assert.doesNotMatch(body, /schedulePersistRuntime/,
    'resetBlindProgressOnly で schedulePersistRuntime 呼出が再発');
  // handlePresetApply の reset 分岐も resetBlindProgressOnly 経由（既存致命バグ保護テスト）
  const applyBody = extractFunctionBody(RENDERER, 'handlePresetApply');
  assert.ok(applyBody, 'handlePresetApply 関数本体抽出失敗');
  assert.match(applyBody, /resetBlindProgressOnly\s*\(\s*\)/,
    'handlePresetApply で resetBlindProgressOnly 呼出が消失（致命バグリグレッション）');
});

console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
