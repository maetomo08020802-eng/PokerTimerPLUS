/**
 * v2.2.1 静的解析テスト — rc10-audit 高優先観測ラベル 3 個追加（致命級 race 配信後監視基盤）
 *
 *   Fix 1: main.js `_preStartStateCacheUpdatedAt` 変数 + `_publishDualState` 内 preStartState 経路で更新時刻記録
 *          + display-removed ハンドラ内で `hdmi:display-removed:dual-sync-stale` 発火（500ms ガード）
 *   Fix 2: main.js switchOperatorToSolo 関数で 50ms 超部 `hdmi:dialog-blocked:switchOperatorToSolo` 発火
 *   Fix 3: renderer.js applyTimerStateToTimer 4 経路 + initialize 経路の 5 箇所すべてに race window 計測
 *          + `timer:reset:race-window-entry` ラベル（1ms 超部発火、trigger 5 種別）
 *   Fix 4: PRIORITY_LOG_LABELS Set に新規 3 ラベル追加 + 既存 10 ラベル完全保持
 *
 *   rc10 機構 + rc1〜rc9 機構 + 計測機構 + 致命バグ保護 5 件 完全保持
 *   timer.js touch なし（v249 T10 で自動 verify）
 *
 * 実行: node tests/v249-audit-race-observation.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const TIMER_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// balanced brace function body extraction
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

// ============================================================
// T1: package.json version === '2.2.1'
// ============================================================
test('T1: package.json.version === 2.2.1', () => {
  assert.equal(PKG.version, '2.5.0', `期待 2.2.1, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix 1 — main.js `_preStartStateCacheUpdatedAt` + `_publishDualState` 記録 + display-removed stale ラベル
// ============================================================
test('T2: Fix 1 — main.js _preStartStateCacheUpdatedAt + _publishDualState 記録 + display-removed stale ラベル', () => {
  // _preStartStateCacheUpdatedAt 変数定義
  assert.match(MAIN_JS, /let\s+_preStartStateCacheUpdatedAt\s*=\s*0\s*;/,
    'Fix 1: _preStartStateCacheUpdatedAt = 0 変数定義がない');
  // _publishDualState 内 preStartState 経路で更新時刻記録
  const publishBody = extractFnBody(MAIN_JS, /function\s+_publishDualState\s*\([^)]*\)\s*\{/);
  assert.ok(publishBody, '_publishDualState 関数本体抽出失敗');
  assert.match(publishBody, /if\s*\(\s*kind\s*===\s*['"]preStartState['"][\s\S]{0,200}?_preStartStateCacheUpdatedAt\s*=\s*Date\.now\(\)/,
    'Fix 1: _publishDualState 内 preStartState 経路で _preStartStateCacheUpdatedAt = Date.now() 記録がない');
  // display-removed ハンドラ内で hdmi:display-removed:dual-sync-stale 発火
  assert.match(MAIN_JS, /hdmi:display-removed:dual-sync-stale[\s\S]{0,200}?cacheAgeMs/,
    'Fix 1: display-removed ハンドラ内で hdmi:display-removed:dual-sync-stale ラベル発火経路 + cacheAgeMs 記録がない');
  // 500ms ガード
  assert.match(MAIN_JS, /cacheAgeMs\s*>=\s*500/,
    'Fix 1: 500ms ガード判定がない');
});

// ============================================================
// T3: Fix 2 — main.js switchOperatorToSolo 関数で 50ms 超部 hdmi:dialog-blocked:switchOperatorToSolo 発火
// ============================================================
test('T3: Fix 2 — switchOperatorToSolo で _switchStartTimeMs 取得 + 50ms 超部ラベル発火', () => {
  const body = extractFnBody(MAIN_JS, /async\s+function\s+switchOperatorToSolo\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo 関数本体抽出失敗');
  // 冒頭で _switchStartTimeMs = Date.now() 取得
  assert.match(body, /const\s+_switchStartTimeMs\s*=\s*Date\.now\(\)/,
    'Fix 2: switchOperatorToSolo 冒頭で _switchStartTimeMs = Date.now() がない');
  // finally で経過時間計測 + ラベル発火（50ms ガード）
  assert.match(body, /const\s+_switchDurationMs\s*=\s*Date\.now\(\)\s*-\s*_switchStartTimeMs/,
    'Fix 2: finally 内で _switchDurationMs = Date.now() - _switchStartTimeMs 計算がない');
  assert.match(body, /_switchDurationMs\s*>=\s*50[\s\S]{0,300}?hdmi:dialog-blocked:switchOperatorToSolo[\s\S]{0,100}?durationMs/,
    'Fix 2: 50ms 超部 hdmi:dialog-blocked:switchOperatorToSolo ラベル発火経路 + durationMs 記録がない');
});

// ============================================================
// T4: Fix 3 — renderer.js applyTimerStateToTimer 4 経路 + initialize 1 経路に race window 計測
// ============================================================
test('T4: Fix 3 — renderer.js 5 経路すべてに _raceEntryMs / _raceExitMs + timer:reset:race-window-entry 発火（trigger 5 種別）', () => {
  // applyTimerStateToTimer 関数本体抽出
  const applyBody = extractFnBody(RENDERER, /function\s+applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(applyBody, 'applyTimerStateToTimer 関数本体抽出失敗');
  // 4 trigger 値で timer:reset:race-window-entry ラベル発火
  for (const trg of ['invalid-ts', 'idle', 'finished', 'no-levels']) {
    const re = new RegExp(`timer:reset:race-window-entry[\\s\\S]{0,300}?trigger:\\s*['"]${trg}['"][\\s\\S]{0,100}?windowMs`);
    assert.match(applyBody, re, `Fix 3: applyTimerStateToTimer 内に trigger:'${trg}' の race-window-entry 発火経路がない`);
  }
  // 4 経路すべての _raceEntryMs 取得（performance.now() 経路）
  const raceEntries = applyBody.match(/_raceEntryMs\s*=\s*\(typeof\s+performance/g) || [];
  assert.ok(raceEntries.length === 4,
    `Fix 3: applyTimerStateToTimer 内に _raceEntryMs 取得 4 箇所必須、現状 ${raceEntries.length}`);
  // 1ms ガード（4 箇所）
  const guards = applyBody.match(/_raceWindowMs\s*>=\s*1/g) || [];
  assert.ok(guards.length === 4,
    `Fix 3: applyTimerStateToTimer 内に _raceWindowMs >= 1 ガード 4 箇所必須、現状 ${guards.length}`);

  // initialize 経路: ctx:'initialize:restoredFromTimerState-false' で race-window-entry 発火
  // 直接 renderer.js 全体から検索（initialize 経路は applyTimerStateToTimer 外）
  assert.match(RENDERER, /timer:reset:race-window-entry[\s\S]{0,300}?trigger:\s*['"]initialize:restoredFromTimerState-false['"][\s\S]{0,100}?windowMs/,
    'Fix 3: initialize 経路に trigger:"initialize:restoredFromTimerState-false" の race-window-entry 発火経路がない');
});

// ============================================================
// T5: Fix 3 副作用評価 — 既存 5 trigger 値の skip-reset-during-prestart + skip-during-prestart 完全保持
// ============================================================
test('T5: 既存 operator:applyTimerStateToTimer:skip-reset-during-prestart 4 trigger + timer:reset:skip-during-prestart 5 ctx 保持', () => {
  // rc8/rc9 既存 4 trigger 値（applyTimerStateToTimer 内）完全保持
  for (const trg of ['invalid-ts', 'idle', 'finished', 'no-levels']) {
    const re = new RegExp(`operator:applyTimerStateToTimer:skip-reset-during-prestart[\\s\\S]{0,200}?trigger:\\s*['"]${trg}['"]`);
    assert.match(RENDERER, re, `rc8/rc9 trigger:'${trg}' skip-reset-during-prestart ラベルが消失`);
  }
  // rc10 既存 5 ctx 値（timer:reset:skip-during-prestart）完全保持
  for (const ctx of ['applyTimerStateToTimer:invalid-ts', 'applyTimerStateToTimer:idle',
                     'applyTimerStateToTimer:finished', 'applyTimerStateToTimer:no-levels',
                     'initialize:restoredFromTimerState-false']) {
    const re = new RegExp(`timer:reset:skip-during-prestart[\\s\\S]{0,300}?ctx:\\s*['"]${ctx}['"]`);
    assert.match(RENDERER, re, `rc10 ctx:'${ctx}' skip-during-prestart ラベルが消失`);
  }
});

// ============================================================
// T6: Fix 4 — PRIORITY_LOG_LABELS Set に新規 3 ラベル追加 + 既存 10 ラベル完全保持
// ============================================================
test('T6: v2.2.1 — PRIORITY_LOG_LABELS Set に rc10.1 3 ラベル保持 + meas3:hdmi-snapshot:written のみ撤去', () => {
  const m = MAIN_JS.match(/const\s+PRIORITY_LOG_LABELS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'PRIORITY_LOG_LABELS Set 定義が見つからない');
  const body = m[1];
  // 新規 3 ラベル（rc10.1）
  for (const lbl of ['hdmi:display-removed:dual-sync-stale', 'hdmi:dialog-blocked:switchOperatorToSolo',
                     'timer:reset:race-window-entry']) {
    assert.ok(body.includes(`'${lbl}'`),
      `rc10.1 ラベル '${lbl}' が PRIORITY_LOG_LABELS Set から消失`);
  }
  // 既存 9 ラベル保持（meas3:hdmi-snapshot:written のみ削除）
  for (const lbl of ['display-removed', 'display-added', 'switchOperatorToSolo:enter',
                     'switchOperatorToSolo:exit', 'switchSoloToOperator:enter', 'switchSoloToOperator:exit',
                     'preStart:operator:send', 'operator:preStartResync:sent',
                     'operator:applyPreStartState:apply']) {
    assert.ok(body.includes(`'${lbl}'`),
      `既存ラベル '${lbl}' が PRIORITY_LOG_LABELS Set から消失`);
  }
  // v2.2.1: meas3:hdmi-snapshot:written のみ撤去確認
  if (!/-(meas|rc)\d+(\.\d+)?$/.test(PKG.version || '')) {
    assert.ok(!body.includes("'meas3:hdmi-snapshot:written'"),
      'v2.2.1 撤去違反: meas3:hdmi-snapshot:written が PRIORITY_LOG_LABELS Set に残存');
  }
});

// ============================================================
// T7: rc10 機構（reset({force: false}) + 5 経路）完全保持
// ============================================================
test('T7: rc10 機構 reset({force: false}) + 5 経路 timerReset({ force: false }) 完全保持', () => {
  // timer.js reset(opts = {}) シグネチャ + force ガード保持
  assert.match(TIMER_JS, /export\s+function\s+reset\s*\(\s*opts\s*=\s*\{\s*\}\s*\)/,
    'rc10: timer.js reset(opts = {}) シグネチャが消失');
  assert.match(TIMER_JS, /if\s*\(\s*!\s*force\s*&&\s*isPreStart\s*\)\s*\{?\s*\n?\s*return\s+false/,
    'rc10: timer.js reset 内 force ガードが消失');
  // renderer.js 5 経路で timerReset({ force: false }) 呼出
  const calls = RENDERER.match(/timerReset\s*\(\s*\{\s*force\s*:\s*false\s*\}\s*\)/g) || [];
  assert.ok(calls.length === 5, `rc10: timerReset({ force: false }) 呼出 5 箇所必須、現状 ${calls.length}`);
});

// ============================================================
// T8: rc1〜rc9 機構保持 + 致命バグ保護 5 件
// ============================================================
test('T8: rc1〜rc9 機構 + 致命バグ保護 5 件 完全保持', () => {
  // rc4: restorePreStart / applyOperatorPreStartState
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart/, 'rc4 restorePreStart 消失');
  assert.match(RENDERER, /applyOperatorPreStartState/, 'rc4 applyOperatorPreStartState 消失');
  // rc5
  assert.match(MAIN_JS, /preStart:operator:send/, 'rc5 preStart:operator:send 消失');
  assert.match(MAIN_JS, /operator:preStartResync:sent/, 'rc5 operator:preStartResync:sent 消失');
  // rc7
  assert.match(MAIN_JS, /preStart:cache:merge/, 'rc7 preStart:cache:merge 消失');
  // rc8/rc9
  assert.match(RENDERER, /operator:applyTimerStateToTimer:skip-reset-during-prestart/, 'rc8/rc9 skip-reset 消失');
  // C.2.7-A resetBlindProgressOnly
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A resetBlindProgressOnly 消失');
  // C.1.7 AudioContext resume
  const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
  assert.match(AUDIO_JS, /audioContext\.resume/, 'C.1.7 AudioContext.resume 消失');
  // C.1.8 schedulePersistRuntime
  assert.match(RENDERER, /schedulePersistRuntime/, 'C.1.8 schedulePersistRuntime 消失');
});

// ============================================================
// T9: 計測機構保持 + 新規 rc10.1 3 ラベル
// ============================================================
test('T9: v2.2.1 — rc2/rc4/rc5/rc7/rc8/rc9/rc10 edge ラベル保持 + rc10.1 新規 3 ラベル保持（meas3 ラベルは撤去）', () => {
  // 試験ビルド時は skip
  if (/-(meas|rc)\d+(\.\d+)?$/.test(PKG.version || '')) {
    // rc/meas ビルドでは meas3 ラベル保持確認
    assert.match(RENDERER, /perf:highfreq:summary/, '試験ビルド meas3 perf:highfreq:summary 消失');
    assert.match(MAIN_JS, /meas3:hdmi-snapshot:written/, '試験ビルド meas3 hdmi-snapshot:written 消失');
  } else {
    // v2.2.1: meas3 ラベル撤去確認
    assert.ok(!RENDERER.includes('perf:highfreq:summary'), 'v2.2.1 撤去違反: meas3 perf:highfreq:summary 残存');
    assert.ok(!MAIN_JS.includes('meas3:hdmi-snapshot:written'), 'v2.2.1 撤去違反: meas3 hdmi-snapshot:written 残存');
  }
  // edge ラベル保持
  assert.match(RENDERER, /hall:hallTickState:reset/, 'rc2 hallTickState:reset 消失');
  assert.match(RENDERER, /operator:applyPreStartState:apply/, 'rc4 applyPreStartState:apply 消失');
  // rc10 既存 5 ctx 値（skip-during-prestart）
  for (const ctx of ['applyTimerStateToTimer:invalid-ts', 'applyTimerStateToTimer:idle',
                     'applyTimerStateToTimer:finished', 'applyTimerStateToTimer:no-levels',
                     'initialize:restoredFromTimerState-false']) {
    const re = new RegExp(`timer:reset:skip-during-prestart[\\s\\S]{0,300}?ctx:\\s*['"]${ctx}['"]`);
    assert.match(RENDERER, re, `rc10 ctx:'${ctx}' 消失`);
  }
  // rc10.1 新規 3 ラベル（main.js / renderer.js のいずれかに存在）
  assert.match(MAIN_JS, /hdmi:display-removed:dual-sync-stale/, 'rc10.1 hdmi:display-removed:dual-sync-stale 消失');
  assert.match(MAIN_JS, /hdmi:dialog-blocked:switchOperatorToSolo/, 'rc10.1 hdmi:dialog-blocked:switchOperatorToSolo 消失');
  assert.match(RENDERER, /timer:reset:race-window-entry/, 'rc10.1 timer:reset:race-window-entry 消失');
});

// ============================================================
// T10: timer.js touch なし（rc10.1 は main.js + renderer.js のみ変更）
// ============================================================
test('T10: timer.js に rc10.1 機構追加なし（新規ラベル発火 / 計測変数追加なし）', () => {
  // timer.js 内に rc10.1 新規 3 ラベルが含まれないこと
  for (const lbl of ['hdmi:display-removed:dual-sync-stale', 'hdmi:dialog-blocked:switchOperatorToSolo',
                     'timer:reset:race-window-entry']) {
    assert.doesNotMatch(TIMER_JS, new RegExp(lbl),
      `rc10.1 ラベル '${lbl}' が timer.js に誤って追加されている（spec 違反）`);
  }
  // timer.js 内に _preStartStateCacheUpdatedAt / _switchStartTimeMs / _raceEntryMs が含まれないこと
  for (const v of ['_preStartStateCacheUpdatedAt', '_switchStartTimeMs', '_raceEntryMs']) {
    assert.doesNotMatch(TIMER_JS, new RegExp(v),
      `rc10.1 変数 '${v}' が timer.js に誤って追加されている（spec 違反）`);
  }
});

// ============================================================
console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
