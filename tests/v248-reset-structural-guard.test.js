/**
 * v2.1.20-rc10 静的解析テスト — timer.js reset() に force フラグ引数追加で PRE_START を構造的保護
 *
 *   Fix 1: timer.js reset(opts = {}) シグネチャ + const { force = true } + if (!force && isPreStart) return false;
 *   Fix 2: renderer.js 5 経路で timerReset({ force: false }) 呼出 + 戻り値判定 + timer:reset:skip-during-prestart ラベル発火
 *   Fix 3: 意図的リセット経路 6 箇所は touch なし（force: true デフォルト維持）
 *   Fix 4: package.json version bump 2.1.20-rc9 → 2.1.20-rc10 + scripts.test 末尾追記
 *
 *   rc1〜rc9 機構 + 計測機構 + 致命バグ保護 5 件 完全保持
 *
 * 実行: node tests/v248-reset-structural-guard.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PKG        = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const TIMER_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const MAIN_JS    = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// balanced-brace function body 抽出ヘルパ
function extractFnBody(src, sigRe) {
  const m = src.match(sigRe);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

const APPLY_TS_FN_BODY = extractFnBody(RENDERER, /function\s+applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
const RESET_FN_BODY    = extractFnBody(TIMER_JS, /export\s+function\s+reset\s*\([^)]*\)\s*\{/);

// ============================================================
// T1: package.json version === '2.1.20-rc10'
// ============================================================
test('T1: package.json.version === 2.1.20-rc10', () => {
  assert.equal(PKG.version, '2.1.20-rc10', `version 不一致: ${PKG.version}`);
});

// ============================================================
// T2: timer.js reset(opts = {}) シグネチャ + force ガード存在
// ============================================================
test('T2: timer.js reset() に opts.force 引数とガード存在', () => {
  // シグネチャ: export function reset(opts = {}) {
  assert.match(TIMER_JS, /export\s+function\s+reset\s*\(\s*opts\s*=\s*\{\s*\}\s*\)\s*\{/,
    'reset(opts = {}) シグネチャがない');
  assert.ok(RESET_FN_BODY, 'reset 関数本体抽出失敗');
  // const { force = true } = opts;
  assert.match(RESET_FN_BODY, /const\s*\{\s*force\s*=\s*true\s*\}\s*=\s*opts\s*;/,
    'const { force = true } = opts; が含まれていない');
  // if (!force && isPreStart) return false;
  assert.match(RESET_FN_BODY, /if\s*\(\s*!\s*force\s*&&\s*isPreStart\s*\)\s*\{?\s*\n?\s*return\s+false\s*;/,
    'if (!force && isPreStart) return false; ガードがない');
});

// ============================================================
// T3: reset() のデフォルト動作（force=true）で従来挙動が保持
// ============================================================
test('T3: reset() force=true デフォルトで wasPreStart 経由 onPreStartCancel 発火が保持', () => {
  assert.ok(RESET_FN_BODY, 'reset 関数本体抽出失敗');
  // 既存の wasPreStart チェック維持
  assert.match(RESET_FN_BODY, /const\s+wasPreStart\s*=\s*isPreStart\s*;/,
    'const wasPreStart = isPreStart; が消えている');
  // PRE_START 状態クリア
  assert.match(RESET_FN_BODY, /isPreStart\s*=\s*false\s*;/, 'isPreStart = false; が消えている');
  assert.match(RESET_FN_BODY, /preStartTotalMs\s*=\s*0\s*;/, 'preStartTotalMs = 0; が消えている');
  // wasPreStart === true 時の onPreStartCancel 発火
  assert.match(RESET_FN_BODY, /if\s*\(\s*wasPreStart\s*\)\s*\{[\s\S]{0,200}?handlers\.onPreStartCancel\s*\(\s*\)/,
    'wasPreStart 経由 handlers.onPreStartCancel() 発火が保持されていない');
  // return true; が末尾にある（force=true 経路で reset 実行成功を示す）
  assert.match(RESET_FN_BODY, /return\s+true\s*;/, 'return true; が末尾にない');
});

// ============================================================
// T4: applyTimerStateToTimer 4 経路で timerReset({ force: false }) + ラベル発火
// ============================================================
test('T4: applyTimerStateToTimer 4 経路すべてで timerReset({ force: false }) + skip-during-prestart ラベル発火', () => {
  assert.ok(APPLY_TS_FN_BODY, 'applyTimerStateToTimer 関数本体抽出失敗');
  // 4 経路すべてに timerReset({ force: false }) が含まれる（計 4 箇所）
  const calls = APPLY_TS_FN_BODY.match(/timerReset\(\s*\{\s*force\s*:\s*false\s*\}\s*\)/g) || [];
  assert.ok(calls.length === 4, `timerReset({ force: false }) 4 箇所必須、現状 ${calls.length}`);
  // 4 ctx 値すべて存在: invalid-ts / idle / finished / no-levels
  for (const ctx of ['applyTimerStateToTimer:invalid-ts', 'applyTimerStateToTimer:idle',
                     'applyTimerStateToTimer:finished', 'applyTimerStateToTimer:no-levels']) {
    const re = new RegExp(`timer:reset:skip-during-prestart[\\s\\S]{0,200}?ctx:\\s*['"]${ctx.replace(/:/g, ':')}['"]`);
    assert.match(APPLY_TS_FN_BODY, re, `ctx: '${ctx}' ラベル発火経路がない`);
  }
});

// ============================================================
// T5: initialize 経路で timerReset({ force: false }) + ラベル発火
// ============================================================
test('T5: initialize 経路 restoredFromTimerState-false で timerReset({ force: false }) + ラベル発火', () => {
  // initialize 関数内の restoredFromTimerState 周辺を抽出
  const idx = RENDERER.indexOf('let restoredFromTimerState');
  assert.ok(idx >= 0, 'restoredFromTimerState 宣言が見つからない');
  const slice = RENDERER.slice(idx, idx + 2000);
  // if (!restoredFromTimerState) ブロック内で timerReset({ force: false }) 呼出
  assert.match(slice, /if\s*\(\s*!restoredFromTimerState\s*\)[\s\S]{0,500}?timerReset\(\s*\{\s*force\s*:\s*false\s*\}\s*\)/,
    'initialize 経路で timerReset({ force: false }) 呼出がない');
  // ctx: 'initialize:restoredFromTimerState-false' ラベル発火
  assert.match(slice, /timer:reset:skip-during-prestart[\s\S]{0,300}?ctx:\s*['"]initialize:restoredFromTimerState-false['"]/,
    'ctx: initialize:restoredFromTimerState-false ラベル発火経路がない');
});

// ============================================================
// T6: 意図的リセット経路 6 箇所は touch なし（force: true デフォルト維持）
// ============================================================
test('T6: handleReset / resetBlindProgressOnly / handleTournamentListReset / new / duplicate / applyOperatorPreStartState 6 経路は touch なし', () => {
  // handleReset
  const handleResetBody = extractFnBody(RENDERER, /function\s+handleReset\s*\(\s*\)\s*\{/);
  assert.ok(handleResetBody, 'handleReset 関数本体抽出失敗');
  assert.match(handleResetBody, /\btimerReset\(\s*\)/, 'handleReset 内 timerReset() 引数なし呼出が消えている（touch なし要求違反）');
  assert.doesNotMatch(handleResetBody, /timerReset\(\s*\{\s*force/, 'handleReset 内 timerReset に force 引数が誤って追加されている');

  // resetBlindProgressOnly
  const rbpBody = extractFnBody(RENDERER, /function\s+resetBlindProgressOnly\s*\(\s*\)\s*\{/);
  assert.ok(rbpBody, 'resetBlindProgressOnly 関数本体抽出失敗');
  assert.match(rbpBody, /\btimerReset\(\s*\)/, 'resetBlindProgressOnly 内 timerReset() 引数なし呼出が消えている');
  assert.doesNotMatch(rbpBody, /timerReset\(\s*\{\s*force/, 'resetBlindProgressOnly に force 引数が誤って追加されている');

  // handleTournamentListReset / _handleTournamentNewImpl / _handleTournamentDuplicateImpl 内
  // それぞれに timerReset() 引数なし呼出が存在することを確認（行単位での簡易検証）
  const targets = [
    /handleTournamentListReset/,
    /_handleTournamentNewImpl/,
    /_handleTournamentDuplicateImpl/,
  ];
  for (const re of targets) {
    const idx = RENDERER.search(re);
    assert.ok(idx >= 0, `${re} が見つからない`);
  }
  // 全体で timerReset() 引数なし呼出が 5 箇所以上残っている（handleReset + resetBlindProgressOnly + 上記 3 + 他）
  const plainCalls = RENDERER.match(/\btimerReset\(\s*\)/g) || [];
  assert.ok(plainCalls.length >= 5,
    `timerReset() 引数なし呼出が 5 箇所以上必須（意図的経路維持）、現状 ${plainCalls.length}`);

  // applyOperatorPreStartState は timerCancelPreStart を使う（別経路、touch なし）
  assert.match(RENDERER, /timerCancelPreStart\s*\(\s*\)/, 'applyOperatorPreStartState 経由の timerCancelPreStart 呼出が消えている');
});

// ============================================================
// T7: rc8/rc9 既存 4 経路 isPreStartActive() ガードは保持（多層防御）
// ============================================================
test('T7: rc8/rc9 既存 4 経路 isPreStartActive() ガードが保持（撤去されていない）', () => {
  assert.ok(APPLY_TS_FN_BODY, 'applyTimerStateToTimer 関数本体抽出失敗');
  // 4 経路すべて isPreStartActive() ガード存在
  const guardMatches = APPLY_TS_FN_BODY.match(/isPreStartActive\s*===\s*['"]function['"]\s*&&\s*isPreStartActive\(\)/g) || [];
  assert.ok(guardMatches.length === 4, `isPreStartActive() ガード 4 箇所必須、現状 ${guardMatches.length}`);
  // 4 trigger 値すべて存在
  for (const trg of ['invalid-ts', 'idle', 'finished', 'no-levels']) {
    const re = new RegExp(`operator:applyTimerStateToTimer:skip-reset-during-prestart[\\s\\S]{0,200}?trigger:\\s*['"]${trg}['"]`);
    assert.match(APPLY_TS_FN_BODY, re, `trigger: '${trg}' ラベル発火経路が消えている`);
  }
});

// ============================================================
// T8: rc1〜rc9 機構保持 + 致命バグ保護 5 件
// ============================================================
test('T8: rc1〜rc9 機構 + 致命バグ保護 5 件 完全保持', () => {
  // rc4: restorePreStart / applyOperatorPreStartState
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart/, 'rc4 restorePreStart が消えている');
  assert.match(RENDERER, /applyOperatorPreStartState/, 'rc4 applyOperatorPreStartState 参照が消えている');
  // rc5: preStart:operator:send + operator:preStartResync:sent + subscribeStateSync
  assert.match(MAIN_JS, /preStart:operator:send/, 'rc5 preStart:operator:send ラベルが消えている');
  assert.match(MAIN_JS, /operator:preStartResync:sent/, 'rc5 operator:preStartResync:sent ラベルが消えている');
  // rc7: preStart:cache:merge
  assert.match(MAIN_JS, /preStart:cache:merge/, 'rc7 preStart:cache:merge ラベルが消えている');
  // rc8/rc9: skip-reset-during-prestart
  assert.match(RENDERER, /operator:applyTimerStateToTimer:skip-reset-during-prestart/, 'rc8/rc9 ラベルが消えている');
  // 致命バグ保護 C.2.7-A: resetBlindProgressOnly 関数存在
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A resetBlindProgressOnly が消えている');
  // 致命バグ保護 C.1.7: AudioContext resume in _play
  const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
  assert.match(AUDIO_JS, /audioContext\.resume/, 'C.1.7 AudioContext.resume が消えている');
  // 致命バグ保護 C.1.8: schedulePersistRuntime
  assert.match(RENDERER, /schedulePersistRuntime/, 'C.1.8 schedulePersistRuntime が消えている');
});

// ============================================================
// T9: 計測機構保持 + 新規 rc10 ラベル 5 ctx 値
// ============================================================
test('T9: meas1+meas2+症状確証4+rc2/rc4/rc5/meas3/rc7/rc8/rc9 ラベル + 新規 rc10 5 ctx 値保持', () => {
  // meas1 計測バッジ
  const HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(HTML, /id=["']js-meas-build-badge["']|計測ビルド/, 'meas1 計測バッジが消えている');
  // rc2 hallTickState:reset 3 trigger
  assert.match(RENDERER, /hall:hallTickState:reset/, 'rc2 hallTickState:reset ラベルが消えている');
  // rc4 ラベル
  assert.match(RENDERER, /operator:applyPreStartState:apply/, 'rc4 applyPreStartState:apply ラベルが消えている');
  // rc5 ラベル
  assert.match(MAIN_JS, /preStart:operator:send/, 'rc5 ラベルが消えている');
  // meas3 ラベル
  assert.match(RENDERER, /perf:highfreq:summary/, 'meas3 perf:highfreq:summary ラベルが消えている');
  assert.match(MAIN_JS, /meas3:hdmi-snapshot:written/, 'meas3 hdmi-snapshot:written ラベルが消えている');
  // rc7 ラベル
  assert.match(MAIN_JS, /preStart:cache:merge/, 'rc7 ラベルが消えている');
  // rc8 ラベル（trigger:'idle' 含む）
  assert.match(RENDERER, /trigger:\s*['"]idle['"]/, 'rc9 trigger:"idle" が消えている');
  // rc9 ラベル 4 trigger 全種別
  for (const trg of ['invalid-ts', 'idle', 'finished', 'no-levels']) {
    const re = new RegExp(`trigger:\\s*['"]${trg}['"]`);
    assert.match(RENDERER, re, `rc9 trigger:'${trg}' が消えている`);
  }
  // 新規 rc10 ラベル 5 ctx 値すべて
  for (const ctx of ['applyTimerStateToTimer:invalid-ts', 'applyTimerStateToTimer:idle',
                     'applyTimerStateToTimer:finished', 'applyTimerStateToTimer:no-levels',
                     'initialize:restoredFromTimerState-false']) {
    const re = new RegExp(`timer:reset:skip-during-prestart[\\s\\S]{0,300}?ctx:\\s*['"]${ctx}['"]`);
    assert.match(RENDERER, re, `rc10 ctx:'${ctx}' が renderer.js にない`);
  }
});

// ============================================================
// T10: timer.js reset() 関数本体内に window.api?.log?.write?. 呼出が含まれていない
//      （rc10 観測ラベルは呼出側 renderer.js から発火、reset() 内では依存ゼロ維持）
//      ※ rc6-meas3 で追加された perf:raf:fire（_emitRafFire 内）は timer.js 内の別関数なので対象外
// ============================================================
test('T10: timer.js reset() 関数本体は window.api?.log?.write?. を呼ばない（rc10 設計判断）', () => {
  assert.ok(RESET_FN_BODY, 'reset 関数本体抽出失敗');
  assert.doesNotMatch(RESET_FN_BODY, /window\.api/,
    'reset() 関数本体内に window.api 参照がある（rc10 設計判断: ガード発火時の log は呼出側 renderer.js で）');
  assert.doesNotMatch(RESET_FN_BODY, /log\?\.write\?/,
    'reset() 関数本体内に log?.write? 呼出がある（rc10 設計判断違反）');
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
