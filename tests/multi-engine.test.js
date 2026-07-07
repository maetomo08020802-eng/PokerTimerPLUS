/**
 * multi-tournament-4up Phase 1 — 独立時計エンジン（multi-engine.mjs）のテスト
 *
 * 検証観点（Phase 1 brief DoD / plan §5.6）:
 *   1. 独立性: 1 区画（エンジン 1 個）への操作が他区画のエンジン記録に影響しない
 *   2. 遷移: start / pause / resume / advanceLevel / reset / レベル跨ぎ / 最終レベル完走(finished)
 *   3. 同値検証: 既存 renderer.js の computeLiveTimerState（並行進行モデルの正）と
 *      同入力・同時刻で同じレベル・同等の残時間になること（移植ロジックの乖離防止）
 *
 * 実行: node tests/multi-engine.test.js
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

// テスト用レベル構造（3 レベル + ブレイク + 最終レベル、分単位）
const LEVELS = [
  { level: 1, durationMinutes: 20, sb: 100, bb: 200 },
  { level: 2, durationMinutes: 20, sb: 200, bb: 400 },
  { level: 3, durationMinutes: 15, sb: 300, bb: 600 },
  { level: null, durationMinutes: 10, isBreak: true, label: 'ブレイク' },
  { level: 4, durationMinutes: 30, sb: 500, bb: 1000 }
];
const MIN = 60 * 1000;

(async () => {
  const engineModule = await import('../src/renderer/multi/multi-engine.mjs');
  const { createClockEngine, computePaneNow, computeNextBreakMsFor, ENGINE_STATUS } = engineModule;

  // ============================================================
  // 1. 独立性（区画 2 の操作が区画 1/3/4 の記録を変えない）
  // ============================================================
  test('独立性: 4 エンジンは相互に影響しない', () => {
    const T0 = 1_000_000;
    const engines = [0, 1, 2, 3].map(() => createClockEngine(LEVELS));
    engines.forEach((e) => e.start(T0));
    const before = [engines[0].getRecord(), engines[2].getRecord(), engines[3].getRecord()];

    // 区画 2（index 1）だけを操作: pause → レベル送り ×2 → resume → reset
    engines[1].pause(T0 + 5 * MIN);
    engines[1].advanceLevel(1, T0 + 6 * MIN);
    engines[1].advanceLevel(1, T0 + 7 * MIN);
    engines[1].resume(T0 + 8 * MIN);
    engines[1].reset();

    const after = [engines[0].getRecord(), engines[2].getRecord(), engines[3].getRecord()];
    assert.deepEqual(after, before, '区画 2 の操作で他区画の記録が変化した');
    assert.equal(engines[1].getRecord().status, 'idle', '区画 2 は reset 後 idle');
  });

  test('独立性: 片方 pause しても他方は進行し続ける', () => {
    const T0 = 2_000_000;
    const a = createClockEngine(LEVELS);
    const b = createClockEngine(LEVELS);
    a.start(T0); b.start(T0);
    a.pause(T0 + 5 * MIN);
    const at = a.computeNow(T0 + 10 * MIN);
    const bt = b.computeNow(T0 + 10 * MIN);
    assert.equal(at.status, ENGINE_STATUS.PAUSED);
    assert.equal(Math.round(at.remainingMs / 1000), 15 * 60, 'pause した側は残 15:00 で停止');
    assert.equal(bt.status, ENGINE_STATUS.RUNNING);
    assert.equal(Math.round(bt.remainingMs / 1000), 10 * 60, '進行側は残 10:00');
  });

  // ============================================================
  // 2. 遷移
  // ============================================================
  test('遷移: start → running（Level 1 満了 duration 投入）', () => {
    const T0 = 0;
    const e = createClockEngine(LEVELS);
    assert.equal(e.computeNow(T0).status, ENGINE_STATUS.IDLE);
    e.start(T0);
    const now = e.computeNow(T0);
    assert.equal(now.status, ENGINE_STATUS.RUNNING);
    assert.equal(now.levelIndex, 0);
    assert.equal(now.remainingMs, 20 * MIN);
  });

  test('遷移: レベル跨ぎ（境界超過分の繰越 = computeLiveTimerState と同義）', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    // 20分+5分経過 → Level 2 の残 15 分
    const now = e.computeNow(25 * MIN);
    assert.equal(now.levelIndex, 1);
    assert.equal(now.remainingMs, 15 * MIN);
    // 20+20+15+10+29分 経過 → 最終レベル残 1 分
    const now2 = e.computeNow(94 * MIN);
    assert.equal(now2.levelIndex, 4);
    assert.equal(now2.remainingMs, 1 * MIN);
  });

  test('遷移: ブレイクレベルも通常レベルと同様に進行（isBreak は表示側判定）', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    const now = e.computeNow(56 * MIN); // 20+20+15=55分 + 1分 → break レベル残 9 分
    assert.equal(now.levelIndex, 3);
    assert.equal(LEVELS[now.levelIndex].isBreak, true);
    assert.equal(now.remainingMs, 9 * MIN);
  });

  test('遷移: 全レベル完走 → finished（remainingMs=0・最終インデックス）', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    const total = (20 + 20 + 15 + 10 + 30) * MIN;
    const now = e.computeNow(total + 1000);
    assert.equal(now.status, ENGINE_STATUS.FINISHED);
    assert.equal(now.levelIndex, LEVELS.length - 1);
    assert.equal(now.remainingMs, 0);
    // 完走境界ちょうど（remaining==0）でも finished
    const boundary = e.computeNow(total);
    assert.equal(boundary.status, ENGINE_STATUS.FINISHED);
  });

  test('遷移: pause → resume で残時間が保存される（レベル跨ぎ後の pause も commit される）', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    e.pause(25 * MIN); // Level 2 残 15 分で停止
    const rec = e.getRecord();
    assert.equal(rec.status, 'paused');
    assert.equal(rec.currentLevelIndex, 1);
    assert.equal(rec.pausedRemainingMs, 15 * MIN);
    const frozen = e.computeNow(100 * MIN); // 停止中は時間が経っても不変
    assert.equal(frozen.remainingMs, 15 * MIN);
    e.resume(200 * MIN);
    const resumed = e.computeNow(205 * MIN);
    assert.equal(resumed.status, ENGINE_STATUS.RUNNING);
    assert.equal(resumed.remainingMs, 10 * MIN);
  });

  test('遷移: advanceLevel は移動先レベルの満了 duration から（running / paused / idle）', () => {
    // running
    const e1 = createClockEngine(LEVELS);
    e1.start(0);
    e1.advanceLevel(1, 5 * MIN);
    const n1 = e1.computeNow(5 * MIN);
    assert.equal(n1.levelIndex, 1);
    assert.equal(n1.remainingMs, 20 * MIN);
    // 下限クランプ（Level 1 から戻し → Level 1 のまま満了）
    e1.advanceLevel(-1, 6 * MIN);
    e1.advanceLevel(-1, 6 * MIN);
    assert.equal(e1.computeNow(6 * MIN).levelIndex, 0);
    // paused
    const e2 = createClockEngine(LEVELS);
    e2.start(0);
    e2.pause(5 * MIN);
    e2.advanceLevel(1, 6 * MIN);
    const n2 = e2.computeNow(6 * MIN);
    assert.equal(n2.status, ENGINE_STATUS.PAUSED);
    assert.equal(n2.levelIndex, 1);
    assert.equal(n2.remainingMs, 20 * MIN);
    // idle（表示位置のみ移動、start は現在位置から）
    const e3 = createClockEngine(LEVELS);
    e3.advanceLevel(1, 0);
    assert.equal(e3.computeNow(0).levelIndex, 1);
    e3.start(0);
    assert.equal(e3.computeNow(0).levelIndex, 1);
  });

  test('遷移: reset で idle / Level 1 / 満了 duration に戻る', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    e.pause(25 * MIN);
    e.reset();
    const now = e.computeNow(30 * MIN);
    assert.equal(now.status, ENGINE_STATUS.IDLE);
    assert.equal(now.levelIndex, 0);
    assert.equal(now.remainingMs, 20 * MIN);
  });

  test('防御: 空 levels では start しない / computePaneNow は安全な idle を返す', () => {
    const e = createClockEngine([]);
    e.start(0);
    assert.equal(e.getRecord().status, 'idle');
    const now = computePaneNow(null, [], 0);
    assert.equal(now.status, ENGINE_STATUS.IDLE);
    assert.equal(now.remainingMs, 0);
  });

  // ============================================================
  // 3. 同値検証（renderer.js computeLiveTimerState との突合）
  // ============================================================
  const RENDERER = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');

  // renderer.js から computeLiveTimerState 関数本体をソース抽出して Function 化。
  // 内部の Date.now() 呼出（1 箇所）を注入可能な nowFn に差し替えて時刻を固定する。
  function extractComputeLiveTimerState() {
    const m = RENDERER.match(/function computeLiveTimerState\(ts, levels\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'renderer.js から computeLiveTimerState を抽出できない（リネーム時は本テストを更新）');
    const src = m[0];
    const occurrences = (src.match(/Date\.now\(\)/g) || []).length;
    assert.equal(occurrences, 1, `computeLiveTimerState 内の Date.now() は 1 箇所想定（実際 ${occurrences} 箇所）`);
    const injectable = src.replace('Date.now()', '__nowFn()');
    // eslint-disable-next-line no-new-func
    return new Function('__nowFn', `${injectable}; return computeLiveTimerState;`);
  }

  test('同値検証: running 中の各時刻でレベル・残時間が computeLiveTimerState と一致', () => {
    const factory = extractComputeLiveTimerState();
    const T0 = 1_700_000_000_000;
    const e = createClockEngine(LEVELS);
    e.start(T0);

    // 開始直後 / レベル中盤 / レベル境界直前後 / ブレイク中 / 最終レベル / 完走後 を網羅
    const offsetsMin = [0, 0.5, 10, 19.99, 20.01, 25, 56, 70, 94, 95.5, 200];
    for (const off of offsetsMin) {
      const nowMs = T0 + Math.round(off * MIN);
      const engineNow = e.computeNow(nowMs);
      const live = factory(() => nowMs)(
        { status: 'running', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: T0, pausedAt: null },
        LEVELS
      );
      if (live.status === 'finished') {
        assert.equal(engineNow.status, ENGINE_STATUS.FINISHED, `+${off}分: finished 一致`);
        continue;
      }
      // computeLiveTimerState は currentLevel が 1-based
      assert.equal(engineNow.levelIndex, live.currentLevel - 1, `+${off}分: レベル一致（engine=${engineNow.levelIndex} live=${live.currentLevel - 1}）`);
      const liveRemainSec = LEVELS[live.currentLevel - 1].durationMinutes * 60 - live.elapsedSecondsInLevel;
      const engineRemainSec = engineNow.remainingMs / 1000;
      assert.ok(Math.abs(engineRemainSec - liveRemainSec) <= 1,
        `+${off}分: 残時間一致（engine=${engineRemainSec}s live=${liveRemainSec}s、許容±1s）`);
    }
  });

  test('同値検証: computeNextBreakMsFor が renderer.js computeNextBreakMs と同ロジック', () => {
    // renderer.js 版は getStructure() シングルトン依存のため、ロジック仕様（現在 break なら 0 /
    // 後続 break まで残り+duration 積算 / break なしなら null）を数値で固定する
    assert.equal(computeNextBreakMsFor(LEVELS, 3, 5 * MIN), 0, '現在レベルが break なら 0');
    assert.equal(computeNextBreakMsFor(LEVELS, 0, 12 * MIN), (12 + 20 + 15) * MIN, 'Level1 残12分 → 12+20+15');
    assert.equal(computeNextBreakMsFor(LEVELS, 4, 10 * MIN), null, '以降に break が無ければ null');
  });

  console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
