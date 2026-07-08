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

  // ============================================================
  // 4. Phase 2: PRE_START（区画独立の開始前カウントダウン）
  // ============================================================
  const { formatPreStartClock, computeTotalGameTimeMsFor } = engineModule;

  test('prestart: idle からのみ起動・レベル 0 固定・派生は preStart フラグ付き', () => {
    const T0 = 3_000_000;
    const e = createClockEngine(LEVELS);
    e.advanceLevel(1, T0); // idle で表示位置を Level 2 へ動かしても
    e.startPreStart(5 * MIN, T0);
    const rec = e.getRecord();
    assert.equal(rec.status, 'prestart');
    assert.equal(rec.currentLevelIndex, 0, 'プレスタートはレベル 0 固定（単一モード忠実）');
    assert.equal(rec.preStartTotalMs, 5 * MIN);
    const now = e.computeNow(T0 + 2 * MIN);
    assert.equal(now.status, ENGINE_STATUS.PRESTART);
    assert.equal(now.preStart, true);
    assert.equal(now.levelIndex, 0);
    assert.equal(now.remainingMs, 3 * MIN, 'カウントダウン残 3 分');
  });

  test('prestart: totalMs<=0 / 非有限 は即時 start（レベル 0 running）と等価', () => {
    for (const bad of [0, -100, NaN, undefined]) {
      const e = createClockEngine(LEVELS);
      e.startPreStart(bad, 1000);
      const now = e.computeNow(1000);
      assert.equal(now.status, ENGINE_STATUS.RUNNING, `totalMs=${bad} → 即時 running`);
      assert.equal(now.levelIndex, 0);
      assert.equal(now.remainingMs, 20 * MIN);
    }
  });

  test('prestart: idle 以外からの起動は no-op（running / prestart 重複 / paused）', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    e.startPreStart(5 * MIN, 1000);
    assert.equal(e.getRecord().status, 'running', 'running 中の startPreStart は no-op');
    const e2 = createClockEngine(LEVELS);
    e2.startPreStart(5 * MIN, 0);
    e2.startPreStart(10 * MIN, 1000);
    assert.equal(e2.getRecord().preStartTotalMs, 5 * MIN, 'prestart 中の重複起動は no-op');
  });

  test('prestart: 0 着地で自動的にレベル 0（Level 1）へ満了 duration の running 遷移', () => {
    const T0 = 4_000_000;
    const e = createClockEngine(LEVELS);
    e.startPreStart(5 * MIN, T0);
    const land = e.computeNow(T0 + 5 * MIN); // 着地ちょうど
    assert.equal(land.status, ENGINE_STATUS.RUNNING);
    assert.equal(land.levelIndex, 0);
    assert.equal(land.remainingMs, 20 * MIN, '着地瞬間にレベル 0 満了 duration 投入');
    assert.ok(!land.preStart, '着地後は preStart フラグなし');
    const after = e.computeNow(T0 + 5 * MIN + 7 * MIN);
    assert.equal(after.levelIndex, 0);
    assert.equal(after.remainingMs, 13 * MIN, '着地 7 分後は残 13 分');
    const crossed = e.computeNow(T0 + 5 * MIN + 25 * MIN);
    assert.equal(crossed.levelIndex, 1, '着地 25 分後はレベル跨ぎで Level 2');
    assert.equal(crossed.remainingMs, 15 * MIN);
    const done = e.computeNow(T0 + 5 * MIN + 95 * MIN + 1000);
    assert.equal(done.status, ENGINE_STATUS.FINISHED, '全レベル超過で finished');
  });

  test('prestart: 一時停止で残時間固定 → 再開で続きから（単一モード PRE_START⇄PAUSED 忠実）', () => {
    const T0 = 5_000_000;
    const e = createClockEngine(LEVELS);
    e.startPreStart(10 * MIN, T0);
    e.pause(T0 + 4 * MIN);
    const rec = e.getRecord();
    assert.equal(rec.status, 'paused');
    assert.equal(rec.preStartTotalMs, 10 * MIN, 'paused でも preStart 由来の印を維持');
    const frozen = e.computeNow(T0 + 60 * MIN);
    assert.equal(frozen.status, ENGINE_STATUS.PAUSED);
    assert.equal(frozen.preStart, true, 'prestart 由来の paused は preStart フラグ付き');
    assert.equal(frozen.remainingMs, 6 * MIN, '停止中は残 6 分で固定');
    e.resume(T0 + 100 * MIN);
    const resumed = e.computeNow(T0 + 101 * MIN);
    assert.equal(resumed.status, ENGINE_STATUS.PRESTART, 'resume でカウントダウンへ復帰');
    assert.equal(resumed.remainingMs, 5 * MIN);
    // 再開後の 0 着地も自動 running
    const landed = e.computeNow(T0 + 100 * MIN + 6 * MIN + 1000);
    assert.equal(landed.status, ENGINE_STATUS.RUNNING);
    assert.equal(landed.levelIndex, 0);
  });

  test('prestart: 0 着地後の pause は running に確定してから停止（commit 経路）', () => {
    const T0 = 6_000_000;
    const e = createClockEngine(LEVELS);
    e.startPreStart(5 * MIN, T0);
    e.pause(T0 + 5 * MIN + 8 * MIN); // 着地 8 分後に一時停止
    const rec = e.getRecord();
    assert.equal(rec.status, 'paused');
    assert.equal(rec.preStartTotalMs, null, '着地後の paused は preStart 由来ではない');
    assert.equal(rec.currentLevelIndex, 0);
    assert.equal(rec.pausedRemainingMs, 12 * MIN, 'Level 1 残 12 分で停止');
  });

  test('prestart: キャンセル（cancelPreStart / reset）で idle へ。running からの cancel は no-op', () => {
    const e = createClockEngine(LEVELS);
    e.startPreStart(10 * MIN, 0);
    e.cancelPreStart();
    assert.equal(e.getRecord().status, 'idle');
    assert.equal(e.computeNow(0).remainingMs, 20 * MIN, 'idle = レベル 0 満了 duration');
    // prestart-paused からもキャンセル可
    const e2 = createClockEngine(LEVELS);
    e2.startPreStart(10 * MIN, 0);
    e2.pause(2 * MIN);
    e2.cancelPreStart();
    assert.equal(e2.getRecord().status, 'idle');
    // reset でも idle へ
    const e3 = createClockEngine(LEVELS);
    e3.startPreStart(10 * MIN, 0);
    e3.reset();
    assert.equal(e3.getRecord().status, 'idle');
    // running からの cancelPreStart は no-op
    const e4 = createClockEngine(LEVELS);
    e4.start(0);
    e4.cancelPreStart();
    assert.equal(e4.getRecord().status, 'running');
  });

  test('prestart: カウントダウン中（および一時停止中）のレベル操作は no-op、着地後は commit して有効', () => {
    const e = createClockEngine(LEVELS);
    e.startPreStart(10 * MIN, 0);
    e.advanceLevel(1, 2 * MIN);
    assert.equal(e.getRecord().status, 'prestart', 'カウントダウン中のレベル送りは no-op');
    assert.equal(e.getRecord().currentLevelIndex, 0);
    e.pause(3 * MIN);
    e.advanceLevel(1, 4 * MIN);
    assert.equal(e.getRecord().currentLevelIndex, 0, 'カウントダウン一時停止中も no-op');
    e.resume(5 * MIN);
    // 着地後（record は prestart のまま）のレベル送りは running に確定してから有効
    e.advanceLevel(1, 5 * MIN + 10 * MIN + 3 * MIN);
    const rec = e.getRecord();
    assert.equal(rec.status, 'running');
    assert.equal(rec.currentLevelIndex, 1, '着地 3 分後のレベル送り → Level 2');
  });

  test('prestart: 区画独立性（1 区画のカウントダウン操作が他区画の record に一切影響しない）', () => {
    const T0 = 7_000_000;
    const engines = [0, 1, 2, 3].map(() => createClockEngine(LEVELS));
    engines[0].start(T0);
    engines[2].startPreStart(15 * MIN, T0);
    // 区画 4（index 3）は idle のまま
    const before = [engines[0].getRecord(), engines[2].getRecord(), engines[3].getRecord()];
    // 区画 2（index 1）だけを操作: カウントダウン開始 → 一時停止 → 再開 → キャンセル → 再度開始
    engines[1].startPreStart(5 * MIN, T0);
    engines[1].pause(T0 + 1 * MIN);
    engines[1].resume(T0 + 2 * MIN);
    engines[1].cancelPreStart();
    engines[1].startPreStart(30 * MIN, T0 + 3 * MIN);
    const after = [engines[0].getRecord(), engines[2].getRecord(), engines[3].getRecord()];
    assert.deepEqual(after, before, '区画 2 の PRE_START 操作で他区画の記録が変化した');
    assert.equal(engines[1].getRecord().preStartTotalMs, 30 * MIN);
  });

  test('prestart: TOTAL GAME TIME はトーナメント未開始なので 0（idle と同様）', () => {
    assert.equal(computeTotalGameTimeMsFor(LEVELS, 0, 5 * MIN, ENGINE_STATUS.PRESTART), 0);
    assert.equal(computeTotalGameTimeMsFor(LEVELS, 0, 5 * MIN, ENGINE_STATUS.IDLE), 0);
    assert.ok(computeTotalGameTimeMsFor(LEVELS, 0, 5 * MIN, ENGINE_STATUS.RUNNING) > 0);
  });

  // renderer.js から formatPreStartTime をソース抽出（純関数・Date.now 非依存）
  function extractFormatPreStartTime() {
    const m = RENDERER.match(/function formatPreStartTime\(ms\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'renderer.js から formatPreStartTime を抽出できない（リネーム時は本テストを更新）');
    // eslint-disable-next-line no-new-func
    return new Function(`${m[0]}; return formatPreStartTime;`)();
  }

  test('同値検証: formatPreStartClock が renderer.js formatPreStartTime と同フォーマット（60 分境界含む）', () => {
    const single = extractFormatPreStartTime();
    const samples = [0, 500, 9_999, 10_000, 59_999, 60_000, 61_500, 599_000, 3_599_000, 3_599_999,
      3_600_000, 3_600_001, 5_400_000, 7_199_999, 2 * 3_600_000];
    for (const ms of samples) {
      const ours = formatPreStartClock(ms);
      assert.equal(ours.text, single(ms), `${ms}ms: 表示文字列一致`);
      // data-prestart-format の切替規則（renderer.js:944 と同じ 60 分閾値）
      assert.equal(ours.format, ms >= 60 * 60 * 1000 ? 'hms' : 'ms', `${ms}ms: format 一致`);
    }
  });

  // ============================================================
  // 5. Phase 2c: adjustTimeBy（±30秒等の時間微調整）
  //    単一モード timer.js advanceTimeBy（L342-372 の繰越規則）/ advancePreStartBy の仕様値を固定する
  //    スペックテスト。※ advanceTimeBy 本体は state/blinds/rAF シングルトン密結合のためソース抽出
  //    による直接同値検証は不能 → 仕様値固定で乖離を防ぐ（computeNextBreakMsFor と同パターン）
  // ============================================================
  test('adjustTimeBy: RUNNING 進める方向はレベル繰越（超過分引継）・全レベル超過で finished', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    // Level 1 残 20 分 → −21 分 → Level 2 の残 19 分（超過 1 分の引継 = timer.js ケース A）
    e.adjustTimeBy(-21 * MIN, 0);
    let now = e.computeNow(0);
    assert.equal(now.levelIndex, 1);
    assert.equal(now.remainingMs, 19 * MIN);
    // 残り全部（19+15+10+30 分）を超えて進める → 完走
    e.adjustTimeBy(-(19 + 15 + 10 + 30) * MIN - 1000, 0);
    now = e.computeNow(0);
    assert.equal(now.status, ENGINE_STATUS.FINISHED);
  });

  test('adjustTimeBy: 戻す方向は前レベルへ繰越・レベル 0 でクランプ', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    e.adjustTimeBy(-25 * MIN, 0); // Level 2 残 15 分へ
    // +17 分 → 32 分 > Level2 初期 20 分 → 前レベル（Level 1）へ超過 12 分（timer.js ケース B）
    e.adjustTimeBy(17 * MIN, 0);
    let now = e.computeNow(0);
    assert.equal(now.levelIndex, 0);
    assert.equal(now.remainingMs, 12 * MIN);
    // さらに +30 分 → Level 1 初期 20 分でクランプ
    e.adjustTimeBy(30 * MIN, 0);
    now = e.computeNow(0);
    assert.equal(now.levelIndex, 0);
    assert.equal(now.remainingMs, 20 * MIN);
  });

  test('adjustTimeBy: PAUSED 中も残り時間を調整（状態は PAUSED のまま）', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    e.pause(5 * MIN); // Level 1 残 15 分で停止
    e.adjustTimeBy(-30 * 1000, 6 * MIN);
    const rec = e.getRecord();
    assert.equal(rec.status, 'paused');
    assert.equal(rec.pausedRemainingMs, 15 * MIN - 30 * 1000, '残 14:30 で停止のまま');
  });

  test('adjustTimeBy: PRESTART はカウントダウン残に作用（戻しはクランプなしで加算・0 到達で自動レベル 0 running）', () => {
    const T0 = 8_000_000;
    const e = createClockEngine(LEVELS);
    e.startPreStart(2 * MIN, T0);
    e.adjustTimeBy(30 * 1000, T0 + 1 * MIN); // 残 1 分 → 戻して残 1:30
    assert.equal(Math.round(e.computeNow(T0 + 1 * MIN).remainingMs / 1000), 90);
    assert.equal(e.getRecord().status, 'prestart');
    // 残 1:30 → −2 分で 0 到達 → 即レベル 0 満了 duration の running（単一モード advancePreStartBy と同義）
    e.adjustTimeBy(-2 * MIN, T0 + 1 * MIN);
    const now = e.computeNow(T0 + 1 * MIN);
    assert.equal(now.status, ENGINE_STATUS.RUNNING);
    assert.equal(now.levelIndex, 0);
    assert.equal(now.remainingMs, 20 * MIN);
  });

  test('adjustTimeBy: prestart 由来 PAUSED はクランプのみ・running へ遷移しない（advancePreStartBy paused 分岐に忠実）', () => {
    const e = createClockEngine(LEVELS);
    e.startPreStart(2 * MIN, 0);
    e.pause(1 * MIN); // カウントダウン残 1 分で一時停止
    e.adjustTimeBy(-5 * MIN, 2 * MIN); // 0 未満 → 0 でクランプ・遷移しない
    const rec = e.getRecord();
    assert.equal(rec.status, 'paused');
    assert.equal(rec.pausedRemainingMs, 0);
    assert.equal(e.computeNow(10 * MIN).preStart, true, 'prestart 由来のまま');
    // resume すると残 0 のカウントダウン → 即着地で running 派生
    e.resume(20 * MIN);
    assert.equal(e.computeNow(20 * MIN).status, ENGINE_STATUS.RUNNING);
  });

  test('adjustTimeBy: IDLE / FINISHED は no-op（単一モードの早期 return に忠実）', () => {
    const e = createClockEngine(LEVELS);
    const before = e.getRecord();
    e.adjustTimeBy(-30 * 1000, 0);
    assert.deepEqual(e.getRecord(), before, 'idle で record 不変');
    const e2 = createClockEngine(LEVELS);
    e2.start(0);
    e2.adjustTimeBy(-(20 + 20 + 15 + 10 + 30) * MIN - 1000, 0); // 完走させる
    assert.equal(e2.getRecord().status, 'finished');
    const beforeFin = e2.getRecord();
    e2.adjustTimeBy(30 * 1000, 0);
    assert.deepEqual(e2.getRecord(), beforeFin, 'finished で record 不変（戻しも no-op）');
  });

  test('adjustTimeBy: 区画独立性（1 区画の ±30秒 が他区画の record に影響しない）', () => {
    const T0 = 9_000_000;
    const engines = [0, 1, 2, 3].map(() => createClockEngine(LEVELS));
    engines[0].start(T0);
    engines[2].startPreStart(10 * MIN, T0);
    const before = [engines[0].getRecord(), engines[2].getRecord(), engines[3].getRecord()];
    engines[1].start(T0);
    engines[1].adjustTimeBy(-30 * 1000, T0 + MIN);
    engines[1].adjustTimeBy(30 * 1000, T0 + 2 * MIN);
    const after = [engines[0].getRecord(), engines[2].getRecord(), engines[3].getRecord()];
    assert.deepEqual(after, before, '区画 2 の時間調整で他区画の記録が変化した');
  });

  test('adjustTimeBy: 防御（空 levels / delta 0 / 非有限は no-op）', () => {
    const e = createClockEngine(LEVELS);
    e.start(0);
    const before = e.getRecord();
    e.adjustTimeBy(0, 0);
    e.adjustTimeBy(NaN, 0);
    assert.deepEqual(e.getRecord(), before);
    const empty = createClockEngine([]);
    empty.adjustTimeBy(-30 * 1000, 0); // throw しない
    assert.equal(empty.getRecord().status, 'idle');
  });

  // ============================================================
  // 6. Phase 2d: applyRuntimeOp（runtime 操作の純粋計算・単一モード操作パリティ）
  //    増減規則・クランプは renderer.js addNewEntry〜adjustSpecialStack（L7833-7982）の仕様値を固定
  // ============================================================
  const { applyRuntimeOp } = engineModule;
  const RT_SNAP = Object.freeze({
    title: 'テスト',
    runtime: Object.freeze({ playersInitial: 10, playersRemaining: 8, reentryCount: 2, addOnCount: 1 }),
    specialStack: Object.freeze({ enabled: true, chips: 5000, appliedCount: 3, label: '早期' })
  });

  test('applyRuntimeOp: エントリー追加/取消（initial&remaining 同時増減・上限999・下限0）', () => {
    const added = applyRuntimeOp(RT_SNAP, 'addEntry');
    assert.equal(added.runtime.playersInitial, 11);
    assert.equal(added.runtime.playersRemaining, 9, '追加は initial++ かつ remaining++（単一 addNewEntry）');
    const cancelled = applyRuntimeOp(RT_SNAP, 'cancelEntry');
    assert.equal(cancelled.runtime.playersInitial, 9);
    assert.equal(cancelled.runtime.playersRemaining, 7, '取消は両方 --（単一 cancelNewEntry）');
    // 上限 999
    const atMax = { ...RT_SNAP, runtime: { ...RT_SNAP.runtime, playersInitial: 999 } };
    assert.equal(applyRuntimeOp(atMax, 'addEntry'), null, '999 で追加は no-op');
    // 下限 0
    const atZero = { ...RT_SNAP, runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 } };
    assert.equal(applyRuntimeOp(atZero, 'cancelEntry'), null, 'initial 0 で取消は no-op');
  });

  test('applyRuntimeOp: 脱落/復活（remaining のみ・下限0・initial を超えない）', () => {
    const out = applyRuntimeOp(RT_SNAP, 'eliminate');
    assert.equal(out.runtime.playersRemaining, 7);
    assert.equal(out.runtime.playersInitial, 10, '脱落は remaining のみ --（単一 eliminatePlayer）');
    const revived = applyRuntimeOp(RT_SNAP, 'revive');
    assert.equal(revived.runtime.playersRemaining, 9);
    const zero = { ...RT_SNAP, runtime: { ...RT_SNAP.runtime, playersRemaining: 0 } };
    assert.equal(applyRuntimeOp(zero, 'eliminate'), null, 'remaining 0 で脱落は no-op');
    const full = { ...RT_SNAP, runtime: { ...RT_SNAP.runtime, playersRemaining: 10 } };
    assert.equal(applyRuntimeOp(full, 'revive'), null, 'remaining=initial で復活は no-op（単一 revivePlayer）');
  });

  test('applyRuntimeOp: リエントリー/アドオン ±（下限0・変更なしは null）', () => {
    assert.equal(applyRuntimeOp(RT_SNAP, 'reentryPlus').runtime.reentryCount, 3);
    assert.equal(applyRuntimeOp(RT_SNAP, 'reentryMinus').runtime.reentryCount, 1);
    assert.equal(applyRuntimeOp(RT_SNAP, 'addOnPlus').runtime.addOnCount, 2);
    assert.equal(applyRuntimeOp(RT_SNAP, 'addOnMinus').runtime.addOnCount, 0);
    const zero = { ...RT_SNAP, runtime: { ...RT_SNAP.runtime, reentryCount: 0, addOnCount: 0 } };
    assert.equal(applyRuntimeOp(zero, 'reentryMinus'), null, 'リエントリー 0 で −1 は no-op（単一 adjustReentry）');
    assert.equal(applyRuntimeOp(zero, 'addOnMinus'), null);
  });

  test('applyRuntimeOp: 特殊スタック ±（enabled 時のみ・0〜999 クランプ）', () => {
    assert.equal(applyRuntimeOp(RT_SNAP, 'specialPlus').specialStack.appliedCount, 4);
    assert.equal(applyRuntimeOp(RT_SNAP, 'specialMinus').specialStack.appliedCount, 2);
    const disabled = { ...RT_SNAP, specialStack: { ...RT_SNAP.specialStack, enabled: false } };
    assert.equal(applyRuntimeOp(disabled, 'specialPlus'), null, '無効時は no-op（単一 adjustSpecialStack）');
    const at999 = { ...RT_SNAP, specialStack: { ...RT_SNAP.specialStack, appliedCount: 999 } };
    assert.equal(applyRuntimeOp(at999, 'specialPlus'), null, '999 で +1 は no-op');
    const at0 = { ...RT_SNAP, specialStack: { ...RT_SNAP.specialStack, appliedCount: 0 } };
    assert.equal(applyRuntimeOp(at0, 'specialMinus'), null, '0 で −1 は no-op');
  });

  test('applyRuntimeOp: 純粋関数（入力 snapshot を変更しない・他フィールドは共有維持）', () => {
    const before = JSON.stringify(RT_SNAP);
    const out = applyRuntimeOp(RT_SNAP, 'addEntry');
    assert.equal(JSON.stringify(RT_SNAP), before, '入力が変更された（freeze 下で throw もしない）');
    assert.notEqual(out.runtime, RT_SNAP.runtime, 'runtime は新オブジェクト');
    assert.equal(out.title, 'テスト', '他フィールドは引き継がれる');
  });

  test('applyRuntimeOp: 防御（不正 op / 不正 snapshot は null）', () => {
    assert.equal(applyRuntimeOp(RT_SNAP, 'unknownOp'), null);
    assert.equal(applyRuntimeOp(null, 'addEntry'), null);
    assert.equal(applyRuntimeOp(undefined, 'addEntry'), null);
  });

  // ============================================================
  // 7. Phase 2e: セッション復帰（停電・クラッシュ）の純粋計算
  // ============================================================
  const { toPowerLossPausedRecord, sanitizeRecord } = engineModule;

  test('復帰: running は書出し時点で PAUSED 化（remaining=endAtMs−savedAtMs・0クランプ・レベル非前進）', () => {
    const rec = { status: 'running', currentLevelIndex: 2, endAtMs: 1_000_000 + 7 * MIN, pausedRemainingMs: null, preStartTotalMs: null };
    const out = toPowerLossPausedRecord(rec, 1_000_000);
    assert.equal(out.status, 'paused');
    assert.equal(out.currentLevelIndex, 2, 'レベル維持');
    assert.equal(out.pausedRemainingMs, 7 * MIN, '書出し時点の残り時間で停止');
    // 停電中にそのレベルの残りが尽きていた場合: 0 クランプ・勝手にレベルを進めない（安全側）
    const expired = toPowerLossPausedRecord(rec, 1_000_000 + 30 * MIN);
    assert.equal(expired.status, 'paused');
    assert.equal(expired.currentLevelIndex, 2, 'レベル非前進');
    assert.equal(expired.pausedRemainingMs, 0);
  });

  test('復帰: prestart は preStartTotalMs 維持で PAUSED 化 → resume でカウントダウンへ復帰', () => {
    const rec = { status: 'prestart', currentLevelIndex: 0, endAtMs: 5_000_000 + 4 * MIN, pausedRemainingMs: null, preStartTotalMs: 10 * MIN };
    const out = toPowerLossPausedRecord(rec, 5_000_000);
    assert.equal(out.status, 'paused');
    assert.equal(out.pausedRemainingMs, 4 * MIN);
    assert.equal(out.preStartTotalMs, 10 * MIN, 'prestart 由来の印を維持');
    const e = createClockEngine(LEVELS, out);
    const now = e.computeNow(9_000_000);
    assert.equal(now.status, ENGINE_STATUS.PAUSED);
    assert.equal(now.preStart, true, '復元後も「スタートまで」表示系で描画される');
    e.resume(9_000_000);
    const resumed = e.computeNow(9_000_000 + 1 * MIN);
    assert.equal(resumed.status, ENGINE_STATUS.PRESTART, '再開でカウントダウンへ復帰');
    assert.equal(resumed.remainingMs, 3 * MIN);
  });

  test('復帰: idle / paused / finished は不変（時計を進めない）', () => {
    for (const rec of [
      { status: 'idle', currentLevelIndex: 0, endAtMs: null, pausedRemainingMs: null, preStartTotalMs: null },
      { status: 'paused', currentLevelIndex: 1, endAtMs: null, pausedRemainingMs: 5 * MIN, preStartTotalMs: null },
      { status: 'finished', currentLevelIndex: 4, endAtMs: null, pausedRemainingMs: null, preStartTotalMs: null }
    ]) {
      assert.deepEqual(toPowerLossPausedRecord(rec, 123_456), rec, `${rec.status} は不変`);
    }
  });

  test('復帰: createClockEngine(levels, record) の round-trip 決定論（seed→同一状態→再開続行可）', () => {
    const src = createClockEngine(LEVELS);
    src.start(1_000_000);
    src.pause(1_000_000 + 3 * MIN); // Level 1 残 17 分で停止
    const saved = src.getRecord();
    const restored = createClockEngine(LEVELS, saved);
    assert.deepEqual(restored.getRecord(), saved, '同一 record を導出（決定論）');
    assert.deepEqual(restored.computeNow(2_000_000), src.computeNow(2_000_000), '派生状態も一致');
    restored.resume(2_000_000);
    assert.equal(restored.computeNow(2_000_000 + 1 * MIN).remainingMs, 16 * MIN, '再開して続行できる');
  });

  test('復帰: sanitizeRecord は不正入力を安全側 idle に・第2引数省略は後方互換', () => {
    assert.equal(sanitizeRecord(null, LEVELS).status, 'idle');
    assert.equal(sanitizeRecord({ status: 'bogus' }, LEVELS).status, 'idle');
    assert.equal(sanitizeRecord({ status: 'running', endAtMs: 'x' }, LEVELS).status, 'idle', 'running の endAtMs 欠落は idle');
    assert.equal(sanitizeRecord({ status: 'paused' }, LEVELS).status, 'idle', 'paused の残時間欠落は idle');
    const clamped = sanitizeRecord({ status: 'paused', currentLevelIndex: 99, pausedRemainingMs: 5 * MIN }, LEVELS);
    assert.equal(clamped.currentLevelIndex, LEVELS.length - 1, 'レベル index はクランプ');
    const e = createClockEngine(LEVELS);
    assert.equal(e.getRecord().status, 'idle', '第2引数省略は従来どおり idle 初期化');
  });

  // ============================================================
  // 8. Phase 2f: 復元方式「経過を反映」（toPowerLossElapsedRecord）
  // ============================================================
  const { toPowerLossElapsedRecord } = engineModule;

  test('経過反映: 現レベル内の経過 → 同レベル・残減で PAUSED', () => {
    const T = 1_000_000;
    const rec = { status: 'running', currentLevelIndex: 0, endAtMs: T + 10 * MIN, pausedRemainingMs: null, preStartTotalMs: null };
    const out = toPowerLossElapsedRecord(rec, LEVELS, T + 4 * MIN);
    assert.equal(out.status, 'paused');
    assert.equal(out.currentLevelIndex, 0);
    assert.equal(out.pausedRemainingMs, 6 * MIN);
    assert.equal(out.preStartTotalMs, null);
  });

  test('経過反映: レベル跨ぎの経過 → 繰上げ位置で PAUSED（「そこから再開」との差分明示）', () => {
    const T = 1_000_000;
    const rec = { status: 'running', currentLevelIndex: 0, endAtMs: T + 10 * MIN, pausedRemainingMs: null, preStartTotalMs: null };
    const out = toPowerLossElapsedRecord(rec, LEVELS, T + 15 * MIN); // Level 1 残 10 分を超え Level 2 へ 5 分侵入
    assert.equal(out.status, 'paused');
    assert.equal(out.currentLevelIndex, 1, 'レベル繰上げを反映');
    assert.equal(out.pausedRemainingMs, 15 * MIN, 'Level 2（20分）の残 15 分');
    // 同入力の「そこから再開」は 0 クランプ・レベル非前進（両方式の違い）
    const frozen = toPowerLossPausedRecord(rec, T + 15 * MIN);
    assert.equal(frozen.currentLevelIndex, 0);
    assert.equal(frozen.pausedRemainingMs, 0);
  });

  test('経過反映: 全レベル超過 → FINISHED として復元', () => {
    const T = 1_000_000;
    const rec = { status: 'running', currentLevelIndex: 0, endAtMs: T + 10 * MIN, pausedRemainingMs: null, preStartTotalMs: null };
    // 停電時点の残り: L1 10 + L2 20 + L3 15 + Break 10 + L4 30 = 85 分
    const out = toPowerLossElapsedRecord(rec, LEVELS, T + 86 * MIN);
    assert.equal(out.status, 'finished');
    assert.equal(out.currentLevelIndex, LEVELS.length - 1);
    assert.equal(out.pausedRemainingMs, null);
  });

  test('経過反映: prestart 経過<残 → カウントダウン PAUSED（preStartTotalMs 維持・resume で復帰）', () => {
    const T = 5_000_000;
    const rec = { status: 'prestart', currentLevelIndex: 0, endAtMs: T + 8 * MIN, pausedRemainingMs: null, preStartTotalMs: 10 * MIN };
    const out = toPowerLossElapsedRecord(rec, LEVELS, T + 3 * MIN);
    assert.equal(out.status, 'paused');
    assert.equal(out.currentLevelIndex, 0);
    assert.equal(out.pausedRemainingMs, 5 * MIN);
    assert.equal(out.preStartTotalMs, 10 * MIN, 'prestart 由来の印を維持');
    const e = createClockEngine(LEVELS, out);
    e.resume(9_000_000);
    assert.equal(e.computeNow(9_000_000 + 1 * MIN).status, ENGINE_STATUS.PRESTART, '再開でカウントダウンへ復帰');
  });

  test('経過反映: prestart 経過≥残 → 0 着地して running 派生位置で PAUSED（preStartTotalMs null）', () => {
    const T = 5_000_000;
    const rec = { status: 'prestart', currentLevelIndex: 0, endAtMs: T + 8 * MIN, pausedRemainingMs: null, preStartTotalMs: 10 * MIN };
    const out = toPowerLossElapsedRecord(rec, LEVELS, T + 13 * MIN); // 着地後 5 分 = Level 1 残 15 分
    assert.equal(out.status, 'paused');
    assert.equal(out.currentLevelIndex, 0);
    assert.equal(out.pausedRemainingMs, 15 * MIN);
    assert.equal(out.preStartTotalMs, null, 'もう prestart ではない');
    // さらに超過すればレベル繰上げ / 全レベル完走で FINISHED まで反映
    const advanced = toPowerLossElapsedRecord(rec, LEVELS, T + 8 * MIN + 25 * MIN);
    assert.equal(advanced.currentLevelIndex, 1);
    const done = toPowerLossElapsedRecord(rec, LEVELS, T + 8 * MIN + 95 * MIN + 1);
    assert.equal(done.status, 'finished');
  });

  test('経過反映: idle / paused / finished は不変（時計を進めない）', () => {
    for (const rec of [
      { status: 'idle', currentLevelIndex: 0, endAtMs: null, pausedRemainingMs: null, preStartTotalMs: null },
      { status: 'paused', currentLevelIndex: 1, endAtMs: null, pausedRemainingMs: 5 * MIN, preStartTotalMs: null },
      { status: 'finished', currentLevelIndex: 4, endAtMs: null, pausedRemainingMs: null, preStartTotalMs: null }
    ]) {
      assert.deepEqual(toPowerLossElapsedRecord(rec, LEVELS, 9_999_999), rec, `${rec.status} は不変`);
    }
  });

  test('経過反映: 防御 — levels 欠落 / nowMs 非有限でも生きた時計を返さない（paused 版へフォールバック）', () => {
    const T = 1_000_000;
    const rec = { status: 'running', currentLevelIndex: 2, endAtMs: T + 7 * MIN, pausedRemainingMs: null, preStartTotalMs: null };
    const noLevels = toPowerLossElapsedRecord(rec, [], T + 1 * MIN);
    assert.deepEqual(noLevels, toPowerLossPausedRecord(rec, T + 1 * MIN), 'levels 空は「そこから再開」凍結と一致');
    const badNow = toPowerLossElapsedRecord(rec, LEVELS, NaN);
    assert.equal(badNow.status, 'paused', 'nowMs 非有限でも paused（running を返さない）');
  });

  test('経過反映: round-trip — 変換後 record を seed に同一派生・resume で続行できる', () => {
    const T = 1_000_000;
    const rec = { status: 'running', currentLevelIndex: 0, endAtMs: T + 10 * MIN, pausedRemainingMs: null, preStartTotalMs: null };
    const out = toPowerLossElapsedRecord(rec, LEVELS, T + 15 * MIN);
    const e = createClockEngine(LEVELS, out);
    assert.deepEqual(e.getRecord(), out, 'sanitize を通しても同一 record（決定論）');
    e.resume(2_000_000);
    assert.equal(e.computeNow(2_000_000 + 5 * MIN).remainingMs, 10 * MIN, '再開して続行できる');
  });

  test('同値検証: prestart 0 着地後のレベル・残時間が computeLiveTimerState（着地時刻起点）と一致', () => {
    const factory = extractComputeLiveTimerState();
    const T0 = 1_700_000_000_000;
    const PRE = 10 * MIN;
    const e = createClockEngine(LEVELS);
    e.startPreStart(PRE, T0);
    const TLand = T0 + PRE; // 0 着地時刻 = 単一モードの startAtLevel(0) 実行時刻
    const offsetsMin = [0, 0.5, 10, 19.99, 20.01, 25, 56, 70, 94, 95.5, 200];
    for (const off of offsetsMin) {
      const nowMs = TLand + Math.round(off * MIN);
      const engineNow = e.computeNow(nowMs);
      const live = factory(() => nowMs)(
        { status: 'running', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: TLand, pausedAt: null },
        LEVELS
      );
      if (live.status === 'finished') {
        assert.equal(engineNow.status, ENGINE_STATUS.FINISHED, `着地+${off}分: finished 一致`);
        continue;
      }
      assert.equal(engineNow.levelIndex, live.currentLevel - 1, `着地+${off}分: レベル一致`);
      const liveRemainSec = LEVELS[live.currentLevel - 1].durationMinutes * 60 - live.elapsedSecondsInLevel;
      assert.ok(Math.abs(engineNow.remainingMs / 1000 - liveRemainSec) <= 1,
        `着地+${off}分: 残時間一致（許容±1s）`);
    }
  });

  console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
