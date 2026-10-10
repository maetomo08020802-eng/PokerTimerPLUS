/**
 * clock-sync-structure-only Codex 再査定対応（2026-10-10）回帰テスト
 *
 *   C1 停電中の全レベル完走で旧 levelTotalSeconds が残り、復元時に時計が再開する
 *   C2 DB の同レベル判定が旧全体時間を保持しすぎて前レベルへ戻る
 *   C3 別大会の遅延 DB 応答を現在の大会へ適用する（既存の穴）
 *   C4 共有構造の上書きで非表示大会の現レベル時間が変わる
 *
 *   実 timer.js / state.js / blinds.js / clock-payload.mjs と renderer.js の実関数を結線して状態遷移を通す
 *   （ハーネスは tests/clock-sync-structure-only.test.js と同一方式）。
 *
 *   実行: node tests/clock-sync-codex.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT     = path.join(__dirname, '..');
const read     = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RENDERER = read('src', 'renderer', 'renderer.js');
const MAIN_JS  = read('src', 'main.js');

let pass = 0, fail = 0;
// 非同期テストが途中で止まったまま終了すると exit 0 で偽 PASS になるため、最後まで到達しなければ失敗にする
let completed = false;
process.on('exit', () => { if (!completed) { console.log('FAIL: テストが最後まで実行されなかった'); process.exitCode = 1; } });
async function test(name, fn) {
  try { await fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionSource(source, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = source.match(re);
  if (!m) return null;
  let i = m.index + m[0].length, depthP = 1;
  for (; i < source.length && depthP > 0; i++) { if (source[i] === '(') depthP++; else if (source[i] === ')') depthP--; }
  const braceStart = source.indexOf('{', i);
  let depth = 0;
  for (let j = braceStart; j < source.length; j++) {
    const c = source[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(m.index, j + 1); }
  }
  return null;
}
const src = (name, from = RENDERER) => { const s = extractFunctionSource(from, name); assert.ok(s, `${name} が見つからない`); return s; };

globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
Object.defineProperty(globalThis, 'performance', { value: { now: () => 1000000 }, configurable: true, writable: true });

let _seq = 0;
async function loadModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `clock-sync-codex-${process.pid}-${_seq++}-`));
  const fix = (s) => s.replace(/'\.\/state\.js'/g, "'./state.mjs'").replace(/'\.\/blinds\.js'/g, "'./blinds.mjs'");
  for (const f of ['state', 'blinds', 'timer']) fs.writeFileSync(path.join(dir, `${f}.mjs`), fix(read('src', 'renderer', `${f}.js`)));
  const state  = await import(pathToFileURL(path.join(dir, 'state.mjs')).href);
  const blinds = await import(pathToFileURL(path.join(dir, 'blinds.mjs')).href);
  const timer  = await import(pathToFileURL(path.join(dir, 'timer.mjs')).href);
  timer.setHandlers({ onTick: () => {}, onLevelChange: () => {}, onLevelEnd: () => {} });
  return { state, blinds, timer };
}

function makeStub() {
  const f = function () { return undefined; };
  return new Proxy(f, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : makeStub()), set: () => true, apply: () => undefined });
}
const GLOBAL_OK = new Set(['Math', 'Number', 'JSON', 'Date', 'Array', 'Object', 'String', 'Boolean', 'Infinity', 'NaN',
  'undefined', 'console', 'isNaN', 'parseInt', 'Error', 'Promise', 'Set', 'Map', 'WeakMap', 'performance', 'Symbol']);

const NAMES = ['mapStateToStorageStatus', 'captureCurrentTimerState', '_liveLevelTotalMs', 'computeLiveTimerState',
  'applyTimerStateToTimer', 'isDbLinkOriginCurrent', 'decideDbLevelStartTotalMs', 'applyDbToEngine', 'runDbLinkProbe',
  'planSharedPresetTimerPreserve', 'preserveSharedPresetTimers', 'endSharedPresetPreserve', '_dbLinkOriginNow', 'handleDbLinkEvent',
  'periodicPersistAllRunning', '_periodicPersistAllRunningBody', 'applyBlindsKeepProgress', '_refreshDisplayAfterStructureChange',
  'resolveGaugeMinutes', 'computeGaugeRatio'];

// env は外から書き換え可能（遅延応答中の大会切替を再現するため env オブジェクトを返す）
function buildRenderer(mods, { role = 'operator-solo', extra = {} } = {}) {
  const { state, blinds, timer } = mods;
  const env = {
    window: { appRole: role, api: { log: { write: () => {} } } },
    States: state.States, getState: state.getState, setState: state.setState,
    getLevel: blinds.getLevel, getLevelCount: blinds.getLevelCount, isBreakLevel: blinds.isBreakLevel,
    setStructure: blinds.setStructure, getStructure: blinds.getStructure, cloneStructure: blinds.cloneStructure,
    isPreStartActive: timer.isPreStartActive, timerStartAtLevel: timer.startAtLevel, timerAdvanceBy: timer.advanceTimeBy,
    timerPause: timer.pause, timerResume: timer.resume, timerReset: timer.reset, timerRestorePreStart: timer.restorePreStart,
    timerCancelPreStart: timer.cancelPreStart,
    hallTickState: { rafId: null }, blindPresetCache: new Map(),
    // 実ソースの let 変数（with(env) 経由で読み書き）。未定義だと no-op スタブ（関数＝真値・thenable）になり誤動作するため明示
    _tournamentSwitching: false, _tournamentsListInFlight: null, _periodicPersistRun: null,
    _sharedPreserveBusy: false, _sharedPreserveEpoch: 0,
    ...extra
  };
  const proxy = new Proxy(env, {
    has: (t, k) => typeof k === 'string' && !GLOBAL_OK.has(k),
    get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : makeStub()))
  });
  // 実ソースのモジュール定数（関数抽出の対象外）は値をそのまま取り込む
  const consts = (RENDERER.match(/^const DB_RESTART_TOLERANCE_MS = .*$/m) || [''])[0];
  const body = `with (env) {\n${consts}\n${NAMES.map((n) => src(n)).join('\n')}\nreturn { ${NAMES.join(', ')} };\n}`;
  const fns = new Function('env', body)(proxy);
  return { ...fns, env };
}

const normalizeTimerState = new Function(`const VALID_TIMER_STATUS = ['idle','running','paused','finished'];\n${src('normalizeTimerState', MAIN_JS)}\nreturn normalizeTimerState;`)();

const MIN = 60 * 1000;
const near = (a, b, msg, tol = 100) => assert.ok(Math.abs(a - b) < tol, `${msg || ''} ${a} ≉ ${b}`);
const struct = (mins) => ({ id: 'p', name: 'p', structureType: 'BLIND', levels: mins.map((m, i) => ({ level: i + 1, sb: 100 * (i + 1), bb: 200 * (i + 1), bbAnte: 0, durationMinutes: m, isBreak: false })) });
const classRec = () => { const set = new Set(); return { set, el: { clock: { classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) }, dataset: {} } } }; };

(async () => {
  const payload = await import(pathToFileURL(path.join(ROOT, 'src', 'link', 'clock-payload.mjs')).href);

  // ============================================================
  // C1: 停電中の全レベル完走
  // ============================================================
  const runningTs = (elapsed, lts, minutesAgo) => ({ status: 'running', currentLevel: 1, elapsedSecondsInLevel: elapsed, startedAt: Date.now() - minutesAgo * MIN, pausedAt: null, levelTotalSeconds: lts });
  await test('C1-1: computeLiveTimerState — 完走時は finished・levelTotalSeconds を残さない（Codex 例: Lv1 旧20分/新10分・最終Lv2 10分・26分経過）', async () => {
    const r = buildRenderer(await loadModules());
    const live = r.computeLiveTimerState(runningTs(300, 1200, 26), struct([10, 10]).levels);
    assert.equal(live.status, 'finished');
    assert.equal(live.currentLevel, 2);
    assert.equal('levelTotalSeconds' in live, false);
  });
  for (const [label, lastMin, lts] of [['旧全体>最終', 10, 1200], ['旧全体<最終', 30, 600], ['旧全体=最終', 20, 1200]]) {
    await test(`C1-2(${label}): 操作側の復元は時計を再開しない（IDLE・完走表示）`, async () => {
      const op = await loadModules();
      op.blinds.setStructure(struct([10, lastMin]));
      const rec = classRec();
      const r = buildRenderer(op, { extra: { el: rec.el } });
      const elapsedMin = (lts / 60 - 5) + lastMin + 1;   // 現レベル残り + 最終レベル全体 + 1 分
      r.applyTimerStateToTimer(runningTs(300, lts, elapsedMin), struct([10, lastMin]).levels, { silent: true });
      assert.equal(op.state.getState().status, 'IDLE', '再開しない');
      assert.ok(rec.set.has('clock--timer-finished'), '完走表示（ゲージは CSS で非表示）');
    });
  }
  await test('C1-3: 会場側の復元も完走（IDLE・残り0・完走表示）', async () => {
    const hall = await loadModules();
    hall.blinds.setStructure(struct([10, 10]));
    const rec = classRec();
    buildRenderer(hall, { role: 'hall', extra: { el: rec.el } }).applyTimerStateToTimer(runningTs(300, 1200, 26), struct([10, 10]).levels, { silent: true });
    const s = hall.state.getState();
    assert.equal(s.status, 'IDLE');
    assert.equal(s.remainingMs, 0);
    assert.ok(rec.set.has('clock--timer-finished'));
  });
  await test('C1-4: 単一最終レベル・ちょうど終了時刻でも完走（再開しない）', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10]));
    const rec = classRec();
    const r = buildRenderer(op, { extra: { el: rec.el } });
    r.applyTimerStateToTimer({ status: 'running', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: Date.now() - 15 * MIN, pausedAt: null, levelTotalSeconds: 1200 },
      struct([10]).levels, { silent: true });
    assert.equal(op.state.getState().status, 'IDLE');
    assert.ok(rec.set.has('clock--timer-finished'));
  });
  await test('C1-5: 完走前なら従来どおり（次レベルは新構造の時間で再開）', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 10]));
    const r = buildRenderer(op, { extra: { el: classRec().el } });
    r.applyTimerStateToTimer(runningTs(300, 1200, 20), struct([10, 10]).levels, { silent: true });   // 旧残り15分 → Lv2 へ 5 分
    const s = op.state.getState();
    assert.equal(s.currentLevelIndex, 1);
    assert.equal(s.totalMs, 10 * MIN);
    assert.equal(s.status, 'RUNNING');
  });

  // ============================================================
  // C2: DB 同レベル判定
  // ============================================================
  await test('C2-1: decideDbLevelStartTotalMs — 継続/延長再開始/構造超過/負/別レベル', async () => {
    const d = buildRenderer(await loadModules()).decideDbLevelStartTotalMs;
    assert.equal(d({ sameLevel: true,  localTotalMs: 20 * MIN, structTotalMs: 10 * MIN, remainingTargetMs: 15 * MIN }), 20 * MIN, '短縮後の継続=旧時間');
    assert.equal(d({ sameLevel: true,  localTotalMs: 10 * MIN, structTotalMs: 20 * MIN, remainingTargetMs: 20 * MIN }), 0, '延長後に新時間で再開始=構造時間');
    assert.equal(d({ sameLevel: true,  localTotalMs: 10 * MIN, structTotalMs: 20 * MIN, remainingTargetMs: 25 * MIN }), 25 * MIN, '構造も超える=残りそのもの（戻さない）');
    assert.equal(d({ sameLevel: true,  localTotalMs: 20 * MIN, structTotalMs: 10 * MIN, remainingTargetMs: -2 * MIN }), 20 * MIN, '負（境界越え）は継続扱いで前進');
    assert.equal(d({ sameLevel: false, localTotalMs: 20 * MIN, structTotalMs: 10 * MIN, remainingTargetMs: 8 * MIN }), 0, '別レベルは構造時間');
    assert.equal(d({ sameLevel: false, localTotalMs: 20 * MIN, structTotalMs: 10 * MIN, remainingTargetMs: 12 * MIN }), 12 * MIN, '別レベルでも構造超過は戻さない');
  });
  const linkExtra = (op, extra = {}) => ({
    _dbLinkSend: { active: true, pcId: 'T-A', dbId: 'DB-A' }, _dbLinkGen: 1, _dbLinkApplying: false, _dbLinkDown: false,
    planClockApply: payload.planClockApply, planRuntimeApply: payload.planRuntimeApply,
    tournamentState: { id: 'T-A' }, tournamentRuntime: { playersInitial: 10, playersRemaining: 8, reentryCount: 0, addOnCount: 0 },
    ...extra
  });
  const ORIGIN_A = { pcId: 'T-A', dbId: 'DB-A', gen: 1 };
  async function dbScenario({ levels, runIdx, newMinutes, row, breakIdx = -1 }) {
    const op = await loadModules();
    const s0 = struct(levels); if (breakIdx >= 0) s0.levels[breakIdx].isBreak = true;
    op.blinds.setStructure(s0);
    op.timer.startAtLevel(runIdx);
    op.timer.advanceTimeBy(-1 * MIN);
    op.timer.pause();
    const changed = levels.slice(); changed[runIdx] = newMinutes;
    const s1 = struct(changed); if (breakIdx >= 0) s1.levels[breakIdx].isBreak = true;
    op.blinds.setStructure(s1);                        // 構造のみ適用
    const r = buildRenderer(op, { extra: linkExtra(op, { schedulePersistRuntime: () => {} }) });
    r.applyDbToEngine(row(Date.now()), ORIGIN_A);
    return op.state.getState();
  }
  await test('C2-2: Codex 例 — Lv2 を 10→20 分に構造のみ適用後、DB=Lv2・一時停止・残り20分 → Lv2・残り20分（修正前 Lv1・残り10分）', async () => {
    const s = await dbScenario({ levels: [20, 10], runIdx: 1, newMinutes: 20,
      row: () => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: 20 * MIN, pre_start_total_ms: 0 }) });
    assert.equal(s.currentLevelIndex, 1);
    assert.equal(s.remainingMs, 20 * MIN);
    assert.equal(s.status, 'PAUSED');
  });
  await test('C2-3: 同条件の running 行でも Lv2・残り20分', async () => {
    const s = await dbScenario({ levels: [20, 10], runIdx: 1, newMinutes: 20,
      row: (now) => ({ status: 'running', current_level_index: 1, end_at_ms: now + 20 * MIN }) });
    assert.equal(s.currentLevelIndex, 1);
    near(s.remainingMs, 20 * MIN);
  });
  await test('C2-4: 最初のレベル（Lv1 10→20 分）・旧全体超過の残り18分 → Lv1・残り18分', async () => {
    const s = await dbScenario({ levels: [10, 10], runIdx: 0, newMinutes: 20,
      row: () => ({ status: 'paused', current_level_index: 0, paused_remaining_ms: 18 * MIN, pre_start_total_ms: 0 }) });
    assert.equal(s.currentLevelIndex, 0);
    assert.equal(s.remainingMs, 18 * MIN);
  });
  await test('C2-5: ブレイク（Lv2 ブレイク 10→15 分）・DB 残り15分で進行 → ブレイクのまま残り15分', async () => {
    const s = await dbScenario({ levels: [20, 10, 20], runIdx: 1, newMinutes: 15, breakIdx: 1,
      row: (now) => ({ status: 'running', current_level_index: 1, end_at_ms: now + 15 * MIN }) });
    assert.equal(s.currentLevelIndex, 1);
    assert.equal(s.status, 'BREAK');
    near(s.remainingMs, 15 * MIN);
  });
  await test('C2-6: 範囲外レベル（DB index 5・構成 3 レベル）は最終へ丸めるが「継続」扱いにしない（構造時間）', async () => {
    const s = await dbScenario({ levels: [10, 10, 20], runIdx: 2, newMinutes: 10,
      row: () => ({ status: 'paused', current_level_index: 5, paused_remaining_ms: 5 * MIN, pre_start_total_ms: 0 }) });
    assert.equal(s.currentLevelIndex, 2);
    assert.equal(s.totalMs, 10 * MIN, '丸めた場合は PC の旧全体時間（20分）を使わない');
    assert.equal(s.remainingMs, 5 * MIN);
  });
  await test('C2-7: 20→10 分短縮後の継続（残り15分）は今回の修正どおり旧時間を保持', async () => {
    const s = await dbScenario({ levels: [20, 20], runIdx: 1, newMinutes: 10,
      row: () => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: 15 * MIN, pre_start_total_ms: 0 }) });
    assert.equal(s.currentLevelIndex, 1);
    assert.equal(s.remainingMs, 15 * MIN);
    assert.equal(s.totalMs, 20 * MIN);
  });
  await test('C2-8: ←→キーのレベル越境（advanceTimeBy）は従来どおり', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 10]));
    op.timer.startAtLevel(1); op.timer.pause();
    op.timer.advanceTimeBy(+1 * MIN);   // Lv2 満タンから戻す → Lv1 残り1分
    assert.equal(op.state.getState().currentLevelIndex, 0);
    assert.equal(op.state.getState().remainingMs, 1 * MIN);
  });

  // ============================================================
  // C3: 遅延応答の取り違え
  // ============================================================
  const rowA = (now) => ({ status: 'running', current_level_index: 0, end_at_ms: now + 3 * MIN,
    players_initial: 50, players_remaining: 40, reentry_count: 7, addon_count: 3 });
  async function pausedAt20() {
    const op = await loadModules();
    op.blinds.setStructure(struct([20, 20]));
    op.timer.startAtLevel(0); op.timer.pause();
    return op;
  }
  await test('C3-1: 応答元が現在の連携対象と一致しない（別大会/世代違い/紐付け変更/dbId無し/連携OFF）なら時計・人数・保存に触れない', async () => {
    const cases = [
      ['別大会 A→B',         ORIGIN_A, { _dbLinkSend: { active: true, pcId: 'T-B', dbId: 'DB-B' }, _dbLinkGen: 2, tournamentState: { id: 'T-B' } }],
      ['A→B→A（世代違い）',   ORIGIN_A, { _dbLinkGen: 3 }],
      ['同一大会の紐付け変更', ORIGIN_A, { _dbLinkSend: { active: true, pcId: 'T-A', dbId: 'DB-X' }, _dbLinkGen: 2 }],
      ['dbId 無し',           { pcId: 'T-A' }, {}],
      ['連携 OFF 後',         ORIGIN_A, { _dbLinkSend: { active: false, pcId: '', dbId: '' } }]
    ];
    for (const [label, origin, patch] of cases) {
      const op = await pausedAt20();
      let persisted = 0;
      const r = buildRenderer(op, { extra: linkExtra(op, { schedulePersistRuntime: () => { persisted++; }, ...patch }) });
      r.applyDbToEngine(rowA(Date.now()), origin);
      assert.equal(op.state.getState().remainingMs, 20 * MIN, `${label}: 時計不変`);
      assert.equal(op.state.getState().status, 'PAUSED', label);
      assert.equal(r.env.tournamentRuntime.playersRemaining, 8, `${label}: 人数不変`);
      assert.equal(persisted, 0, `${label}: 保存しない`);
    }
  });
  await test('C3-2: 現在の正しい大会の応答は従来どおり時計・人数を反映して保存', async () => {
    const op = await pausedAt20();
    let persisted = 0;
    const r = buildRenderer(op, { extra: linkExtra(op, { schedulePersistRuntime: () => { persisted++; } }) });
    r.applyDbToEngine(rowA(Date.now()), ORIGIN_A);
    near(op.state.getState().remainingMs, 3 * MIN);
    assert.equal(r.env.tournamentRuntime.playersRemaining, 40);
    assert.equal(persisted, 1);
  });
  await test('C3-3: probe の遅延応答 — 待機中に大会を切り替えたら適用しない／切り替えなければ適用', async () => {
    for (const switched of [true, false]) {
      const op = await pausedAt20();
      let resolveProbe;
      let persisted = 0;
      const r = buildRenderer(op, { extra: linkExtra(op, {
        schedulePersistRuntime: () => { persisted++; },
        window: { appRole: 'operator-solo', api: { log: { write: () => {} }, dblink: { probe: () => new Promise((res) => { resolveProbe = res; }) } } }
      }) });
      const p = r.runDbLinkProbe(true);
      if (switched) {
        r.env._dbLinkSend = { active: true, pcId: 'T-B', dbId: 'DB-B' };
        r.env._dbLinkGen = 2;
        r.env.tournamentState = { id: 'T-B' };
      }
      resolveProbe({ ok: true, clock: rowA(Date.now()) });
      await p;
      if (switched) {
        assert.equal(op.state.getState().remainingMs, 20 * MIN, '切替後は A の応答を B に当てない');
        assert.equal(persisted, 0);
      } else {
        near(op.state.getState().remainingMs, 3 * MIN);
        assert.equal(persisted, 1);
      }
    }
  });
  await test('C3-4: 競合 push（apply-db）は DB 大会 id を添えて通知し、renderer の全適用経路が送り先を照合', () => {
    const LINK = read('src', 'link', 'db-link.js');
    // R2-3 で origin（送信時点の PC 大会・世代）も返すよう変更
    assert.match(LINK, /_notify\(\{ type: 'apply-db', clock: clock\.clock, dbId, origin: \(meta && meta\.origin\) \|\| null \}\)/);
    assert.match(RENDERER, /applyDbToEngine\(payload\.clock, o \? \{ pcId: o\.pcId, dbId: payload\.dbId, gen: o\.gen \} : null\)/);
    assert.match(RENDERER, /applyDbToEngine\(res\.clock, \{ pcId: curId, dbId: db\.id \}\)/);
    assert.match(RENDERER, /applyDbToEngine\(res\.clock, origin\)/);
    const calls = (RENDERER.match(/applyDbToEngine\([^)\n]*\)/g) || []).filter((c) => c !== 'applyDbToEngine(clock, origin)');
    assert.equal(calls.length, 3, calls.join(' | '));
    assert.match(src('applyDbToEngine'), /if \(!isDbLinkOriginCurrent\(origin\)\)/);
  });

  // ============================================================
  // C4: 共有構造の上書き
  // ============================================================
  await test('C4-1: 一時停止・短縮(20→10)/延長(20→30) とも旧1200秒を付ける／現レベルが同じなら変更なし', async () => {
    const r = buildRenderer(await loadModules());
    const paused = { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: 1 };
    assert.equal(r.planSharedPresetTimerPreserve(paused, struct([20, 20]).levels, struct([10, 20]).levels, 0).levelTotalSeconds, 1200);
    assert.equal(r.planSharedPresetTimerPreserve(paused, struct([20, 20]).levels, struct([30, 20]).levels, 0).levelTotalSeconds, 1200);
    assert.equal(r.planSharedPresetTimerPreserve(paused, struct([20, 20]).levels, struct([20, 10]).levels, 0), null);
  });
  await test('C4-2: 進行中は旧構造で現在地まで進めて rebase（startedAt=now）し、到達レベルの旧時間を付ける', async () => {
    const r = buildRenderer(await loadModules());
    const now = Date.now();
    const running = { status: 'running', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: now - 20 * MIN, pausedAt: null };
    const next = r.planSharedPresetTimerPreserve(running, struct([20, 30]).levels, struct([10, 15]).levels, now);
    assert.equal(next.currentLevel, 2, '旧構造では 25 分経過で Lv2（新構造で早送りしない）');
    assert.equal(next.elapsedSecondsInLevel, 300);
    assert.equal(next.startedAt, now);
    assert.equal(next.levelTotalSeconds, 1800);
  });
  await test('C4-3: 既に override を持つ大会は値を維持、ブレイクも同様、旧構造で完走済みなら finished', async () => {
    const r = buildRenderer(await loadModules());
    const has = { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 60, startedAt: null, pausedAt: 1, levelTotalSeconds: 2400 };
    assert.equal(r.planSharedPresetTimerPreserve(has, struct([20]).levels, struct([10]).levels, 0), null, '既に 2400 を保持=変更不要');
    const br = struct([20, 10]); br.levels[1].isBreak = true;
    const br2 = struct([20, 5]); br2.levels[1].isBreak = true;
    const onBreak = { status: 'paused', currentLevel: 2, elapsedSecondsInLevel: 60, startedAt: null, pausedAt: 1 };
    assert.equal(r.planSharedPresetTimerPreserve(onBreak, br.levels, br2.levels, 0).levelTotalSeconds, 600);
    const now = Date.now();
    const done = r.planSharedPresetTimerPreserve({ status: 'running', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: now - 60 * MIN, pausedAt: null },
      struct([20, 20]).levels, struct([10, 10]).levels, now);
    assert.equal(done.status, 'finished');
    assert.equal('levelTotalSeconds' in done, false);
  });
  await test('C4-4: 連携 — 「すべてに反映」直前に非表示大会 B（停止・残り15分）を保全 → B を新構造で復元しても残り15分（修正前 5分）', async () => {
    const op = await loadModules();
    const calls = [];
    const list = [
      { id: 'T-A', blindPresetId: 'P', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 60, startedAt: null, pausedAt: 1 } },
      { id: 'T-B', blindPresetId: 'P', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: 1 } },
      { id: 'T-C', blindPresetId: 'Q', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: 1 } },
      { id: 'T-D', blindPresetId: 'P', timerState: { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null } }
    ];
    const r = buildRenderer(op, { extra: {
      tournamentState: { id: 'T-A' }, _tournamentsListDedup: async () => list,
      loadPresetById: async (id) => (id === 'P' ? struct([20, 20]) : null),
      window: { appRole: 'operator-solo', api: { log: { write: () => {} }, tournaments: { setTimerState: async (id, ts) => { calls.push([id, ts]); return { ok: true }; } } } }
    } });
    assert.equal(await r.preserveSharedPresetTimers('P', struct([10, 20]).levels), true);
    assert.deepEqual(calls.map((c) => c[0]), ['T-B'], '選択中 A・別構造 C・待機中 D は触らない');
    const savedB = normalizeTimerState(calls[0][1]);
    assert.equal(savedB.levelTotalSeconds, 1200);
    const b = await loadModules();
    b.blinds.setStructure(struct([10, 20]));
    const rb = buildRenderer(b, { extra: { el: classRec().el } });
    rb.applyTimerStateToTimer(rb.computeLiveTimerState(savedB, struct([10, 20]).levels), struct([10, 20]).levels, { silent: true });
    assert.equal(b.state.getState().remainingMs, 15 * MIN);
    assert.equal(b.state.getState().currentLevelIndex, 0);
    // 対照: 保全しなかった場合（元の timerState のまま）は 10 − 5 = 5 分
    const c = await loadModules();
    c.blinds.setStructure(struct([10, 20]));
    const rc = buildRenderer(c, { extra: { el: classRec().el } });
    rc.applyTimerStateToTimer(list[1].timerState, struct([10, 20]).levels, { silent: true });
    assert.equal(c.state.getState().remainingMs, 5 * MIN);
  });
  await test('C4-5: 保全は「すべてに反映」の時だけ（「このトーナメントだけ変更」では呼ばない）', () => {
    const body = src('_savePresetCore');
    assert.match(body, /if \(choice === 'all'\) \{[\s\S]{0,200}?await preserveSharedPresetTimers\(blindsEditor\.meta\?\.id, presetToSave\.levels\);/);
    assert.equal((RENDERER.match(/await preserveSharedPresetTimers\(/g) || []).length, 1);
  });
  // ============================================================
  // R2-1: 完走を保存・再起動・会場同期まで保持
  // ============================================================
  await test('R2-1a: 完走の復元後、エンジンは「最終レベル・残り0・IDLE」→ 保存は finished（Lv1 満タンの idle にしない）・人数は不変', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 10, 5]));
    const rec = classRec();
    const runtime = { playersInitial: 30, playersRemaining: 1, reentryCount: 4, addOnCount: 2 };
    const r = buildRenderer(op, { extra: { el: rec.el, tournamentRuntime: runtime } });
    r.applyTimerStateToTimer({ status: 'finished', currentLevel: 3, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: null }, struct([10, 10, 5]).levels, { silent: true });
    const s = op.state.getState();
    assert.equal(s.status, 'IDLE');
    assert.equal(s.currentLevelIndex, 2);
    assert.equal(s.remainingMs, 0);
    assert.ok(rec.set.has('clock--timer-finished'));
    const saved = normalizeTimerState(r.captureCurrentTimerState());   // 自動保存と同じ捕獲 → main 正規化
    assert.equal(saved.status, 'finished');
    assert.deepEqual(runtime, { playersInitial: 30, playersRemaining: 1, reentryCount: 4, addOnCount: 2 });
  });
  await test('R2-1b: 停電中の完走（C1 経路）も同じく保存は finished。その保存値で再起動・会場受信しても完走のまま', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 10]));
    const r = buildRenderer(op, { extra: { el: classRec().el } });
    r.applyTimerStateToTimer({ status: 'running', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: Date.now() - 26 * MIN, pausedAt: null, levelTotalSeconds: 1200 },
      struct([10, 10]).levels, { silent: true });
    const saved = normalizeTimerState(r.captureCurrentTimerState());
    assert.equal(saved.status, 'finished');
    // 再起動（新しいエンジン）
    const op2 = await loadModules();
    op2.blinds.setStructure(struct([10, 10]));
    const rec2 = classRec();
    const r2 = buildRenderer(op2, { extra: { el: rec2.el } });
    r2.applyTimerStateToTimer(saved, struct([10, 10]).levels, { silent: true });
    assert.equal(op2.state.getState().status, 'IDLE');
    assert.ok(rec2.set.has('clock--timer-finished'));
    assert.equal(normalizeTimerState(r2.captureCurrentTimerState()).status, 'finished', '2 回目以降も finished を保存');
    // 会場側の受信
    const hall = await loadModules();
    hall.blinds.setStructure(struct([10, 10]));
    const rec3 = classRec();
    buildRenderer(hall, { role: 'hall', extra: { el: rec3.el } }).applyTimerStateToTimer(saved, struct([10, 10]).levels, { silent: true });
    assert.ok(rec3.set.has('clock--timer-finished'));
    assert.equal(hall.state.getState().remainingMs, 0);
  });
  await test('R2-1c: 明示的なリセット（timer.reset）後は idle を保存（完走から正常に抜けられる）', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 10]));
    const r = buildRenderer(op, { extra: { el: classRec().el } });
    r.applyTimerStateToTimer({ status: 'finished', currentLevel: 2, elapsedSecondsInLevel: 600, startedAt: null, pausedAt: null }, struct([10, 10]).levels, { silent: true });
    op.timer.reset({ force: true });
    const s = op.state.getState();
    assert.equal(s.currentLevelIndex, 0);
    assert.equal(s.remainingMs, 10 * MIN);
    assert.equal(normalizeTimerState(r.captureCurrentTimerState()).status, 'idle');
  });

  // ============================================================
  // R2-2: 同レベル再開始の判別（API 情報不足の軽減）
  // ============================================================
  await test('R2-2a: decide — 残りが構造時間ちょうど（±1.5秒）で PC の全体時間と異なる → 再開始とみなし構造時間', async () => {
    const d = buildRenderer(await loadModules()).decideDbLevelStartTotalMs;
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: 10 * MIN, remainingTargetMs: 10 * MIN }), 0);
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: 10 * MIN, remainingTargetMs: 10 * MIN - 800 }), 0, '受信遅延 0.8 秒');
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: 10 * MIN, remainingTargetMs: 15 * MIN }), 20 * MIN, '正当な継続（旧20・新10・残り15）');
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: 20 * MIN, remainingTargetMs: 20 * MIN }), 20 * MIN, '構造と PC が同じなら従来どおり');
  });
  await test('R2-2b: Codex 例 — 店舗側で Lv2 を新10分から再開始 → PC は全体10分・残り10分。直後の「経過時間を保持して適用」でも Lv2・残り10分のまま', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([20, 20, 20]));
    op.timer.startAtLevel(1); op.timer.advanceTimeBy(-5 * MIN); op.timer.pause();
    op.blinds.setStructure(struct([20, 10, 20]));                 // 構造のみ適用（旧20分で継続中）
    const r = buildRenderer(op, { extra: linkExtra(op, { schedulePersistRuntime: () => {} }) });
    r.applyDbToEngine({ status: 'paused', current_level_index: 1, paused_remaining_ms: 10 * MIN, pre_start_total_ms: 0 }, ORIGIN_A);
    let s = op.state.getState();
    assert.equal(s.currentLevelIndex, 1);
    assert.equal(s.remainingMs, 10 * MIN);
    assert.equal(s.totalMs, 10 * MIN, '再開始=新しい全体時間');
    const keep = struct([20, 10, 20]); keep.levels[1].sb = 999;   // SB だけ変更・時間は同じ
    await r.applyBlindsKeepProgress(keep);
    s = op.state.getState();
    assert.equal(s.currentLevelIndex, 1, '架空の経過時間で次レベルへ進まない');
    assert.equal(s.remainingMs, 10 * MIN);
  });
  await test('R2-2c: 再開始後の ← キー境界は新しい全体時間（10分）基準で前レベルへ', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([20, 20]));
    op.timer.startAtLevel(1); op.timer.advanceTimeBy(-5 * MIN); op.timer.pause();
    op.blinds.setStructure(struct([20, 10]));
    const r = buildRenderer(op, { extra: linkExtra(op, { schedulePersistRuntime: () => {} }) });
    r.applyDbToEngine({ status: 'paused', current_level_index: 1, paused_remaining_ms: 10 * MIN, pre_start_total_ms: 0 }, ORIGIN_A);
    op.timer.advanceTimeBy(+1 * MIN);
    assert.equal(op.state.getState().currentLevelIndex, 0, '満タン(10分)を超えて戻すと Lv1 へ');
    assert.equal(op.state.getState().remainingMs, 1 * MIN);
  });
  await test('R2-2d: 既知の限界 — 継続中の残りが偶然「新しい構造時間」の 1.5 秒以内（構造時間以下側）だと再開始と判定する（API に全体時間が無い限り判別不能）', async () => {
    const d = buildRenderer(await loadModules()).decideDbLevelStartTotalMs;
    // R3-1 で「構造時間を超える残り」は再開始扱いしない（前レベルへ戻る退行の修正）。限界は構造時間以下側のみ
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: 10 * MIN, remainingTargetMs: 10 * MIN - 1000 }), 0, '継続でも構造時間扱い（未解決事項 R3-2）');
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: 10 * MIN, remainingTargetMs: 10 * MIN + 1000 }), 20 * MIN, '構造時間超は継続扱い（R3-1）');
  });

  // ============================================================
  // R2-3: 競合 push の世代照合（実際の送信 → 409 → 取り直し → push 受信）
  // ============================================================
  async function conflictPush({ origin }) {
    const dbLink = require(path.join(ROOT, 'src', 'link', 'db-link.js'));
    const DB = 'DB-A';
    const data = { dbLink: { url: 'https://s.example.com', storeKey: 'k', links: { 'T-A': { id: DB, name: 'A', part_label: '' } } } };
    const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
    const responses = [
      { status: 409, json: { ok: false, code: 'clock_conflict', error: 'conflict' } },
      { status: 200, json: { ok: true, clock: rowA(Date.now()) } }
    ];
    const fetchImpl = async () => { const n = responses.shift(); return { ok: n.status < 300, status: n.status, json: async () => n.json }; };
    const events = [];
    dbLink.init(store, null, { fetchImpl, notify: (p) => events.push(p), delayFn: (fn) => setTimeout(fn, 0) });
    dbLink.publishRuntime('T-A', { players_initial: 10, players_remaining: 9, reentry_count: 0, addon_count: 0, special_count: 0, special_enabled: false }, origin);
    for (let i = 0; i < 50 && !events.some((e) => e.type === 'apply-db'); i++) await new Promise((res) => setTimeout(res, 5));
    return events.find((e) => e.type === 'apply-db');
  }
  await test('R2-3a: db-link は競合した送信の origin（PC 大会・世代）と DB 大会 id を push に載せる（外部送信 body には載せない）', async () => {
    const ev = await conflictPush({ origin: { pcId: 'T-A', dbId: 'DB-A', gen: 1 } });
    assert.ok(ev, 'apply-db が届く');
    assert.equal(ev.dbId, 'DB-A');
    assert.deepEqual(ev.origin, { pcId: 'T-A', gen: 1 });
  });
  for (const [label, cur, expectApplied] of [
    ['同じ世代（正しい応答）', { _dbLinkGen: 1 }, true],
    ['A→B→A（世代 3）', { _dbLinkGen: 3 }, false],
    ['連携 OFF→ON（世代 2）', { _dbLinkGen: 2 }, false],
    ['接続先変更（DB-X）', { _dbLinkSend: { active: true, pcId: 'T-A', dbId: 'DB-X' }, _dbLinkGen: 2 }, false]
  ]) {
    await test(`R2-3b(${label}): 送信→409→取り直し→push 受信の実経路で、${expectApplied ? '反映して保存' : '時計・人数・保存とも触れない'}`, async () => {
      const ev = await conflictPush({ origin: { pcId: 'T-A', dbId: 'DB-A', gen: 1 } });
      const op = await pausedAt20();
      let persisted = 0;
      const r = buildRenderer(op, { extra: linkExtra(op, { schedulePersistRuntime: () => { persisted++; }, ...cur }) });
      r.handleDbLinkEvent(ev);
      if (expectApplied) {
        near(op.state.getState().remainingMs, 3 * MIN, '', 2000);
        assert.equal(r.env.tournamentRuntime.playersRemaining, 40);
        assert.equal(persisted, 1);
      } else {
        assert.equal(op.state.getState().remainingMs, 20 * MIN);
        assert.equal(r.env.tournamentRuntime.playersRemaining, 8);
        assert.equal(persisted, 0);
      }
    });
  }
  await test('R2-3c: origin を持たない push（旧 main）は破棄', async () => {
    const op = await pausedAt20();
    let persisted = 0;
    const r = buildRenderer(op, { extra: linkExtra(op, { schedulePersistRuntime: () => { persisted++; } }) });
    r.handleDbLinkEvent({ type: 'apply-db', clock: rowA(Date.now()), dbId: 'DB-A' });
    assert.equal(op.state.getState().remainingMs, 20 * MIN);
    assert.equal(persisted, 0);
  });
  await test('R2-3d: renderer の送信は origin（現在の PC 大会・DB 大会・世代）を添える', () => {
    assert.match(RENDERER, /publishRecord\?\.\(\{ tournamentId: _dbLinkSend\.pcId, record: payload, origin: _dbLinkOriginNow\(\) \}\)/);
    assert.match(RENDERER, /publishRuntime\?\.\(\{ tournamentId: _dbLinkSend\.pcId, runtime: payload, origin: _dbLinkOriginNow\(\) \}\)/);
    assert.match(read('src', 'main.js'), /dbLink\.publishRecord\(p && p\.tournamentId, p && p\.record, p && p\.origin\)/);
  });

  // ============================================================
  // R2-4 / R2-5: 共有構造の保全と周期保存・保存失敗
  // ============================================================
  function preserveEnv(list, writes, opts = {}) {
    return {
      tournamentState: { id: 'T-A' }, _tournamentsListDedup: async () => JSON.parse(JSON.stringify(list)),
      loadPresetById: async () => struct(opts.oldMinutes || [20, 20]),
      getCachedLevels: async () => struct(opts.cacheMinutes || opts.oldMinutes || [20, 20]).levels,
      window: { appRole: 'operator-solo', api: { log: { write: () => {} }, tournaments: {
        setTimerState: async (id, ts) => {
          if (opts.beforeWrite) await opts.beforeWrite(id, ts);
          writes.push([id, JSON.parse(JSON.stringify(ts))]);
          const t = list.find((x) => x.id === id); if (t) t.timerState = ts;
          return opts.failWrite ? { ok: false, error: 'switching-mode' } : { ok: true };
        } } } }
    };
  }
  await test('R2-4a: 周期保存が古い一覧を読んだまま待機中に保全が走っても、古い一覧からの上書きで保全結果を消さない', async () => {
    const now = Date.now();
    const list = [
      { id: 'T-A', blindPresetId: 'P', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: 1 } },
      { id: 'T-C', blindPresetId: 'Q', timerState: { status: 'running', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: now, pausedAt: null } },
      { id: 'T-B', blindPresetId: 'P', timerState: { status: 'running', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: now, pausedAt: null } }
    ];
    const writes = [];
    let releaseC; const gate = new Promise((res) => { releaseC = res; });
    const op = await loadModules();
    const env = preserveEnv(list, writes, { beforeWrite: async (id) => { if (id === 'T-C' && writes.length === 0) await gate; } });
    env.captureCurrentTimerState = () => ({ status: 'paused' });
    const r = buildRenderer(op, { extra: env });
    const periodic = r.periodicPersistAllRunning();           // 一覧（B は override なし）を読んで C の保存で待機
    await new Promise((res) => setTimeout(res, 10));
    const pres = r.preserveSharedPresetTimers('P', struct([10, 20]).levels);   // 保全開始（周期保存の完了を待つ）
    await new Promise((res) => setTimeout(res, 10));
    releaseC();
    await periodic;
    assert.equal(await pres, true);
    r.endSharedPresetPreserve();
    const lastB = writes.filter((w) => w[0] === 'T-B').pop();
    assert.ok(lastB, 'B は保全で書かれる');
    assert.equal(lastB[1].levelTotalSeconds, 1200, '最後に残る B は保全結果（旧20分）');
    assert.ok(!writes.some((w, i) => w[0] === 'T-B' && !('levelTotalSeconds' in w[1]) && i > writes.findIndex((x) => x[0] === 'T-B' && x[1].levelTotalSeconds === 1200)),
      '保全の後に override 無しの B が書かれない');
  });
  await test('R2-4b: 保全中（構造保存が終わるまで）は周期保存を開始しない／解除後は再開', async () => {
    const list = [{ id: 'T-B', blindPresetId: 'P', timerState: { status: 'running', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: Date.now(), pausedAt: null } }];
    const writes = [];
    const op = await loadModules();
    const r = buildRenderer(op, { extra: preserveEnv(list, writes) });
    r.env._sharedPreserveBusy = true;
    await r.periodicPersistAllRunning();
    assert.equal(writes.length, 0);
    r.endSharedPresetPreserve();
    await r.periodicPersistAllRunning();
    assert.equal(writes.length, 1);
  });
  await test('R2-5a: 既存 override（実全体20分・構造10分）を、構造を20分へ戻す保全でも消さない → 構造保存が失敗しても旧構造で残り15分', async () => {
    const list = [
      { id: 'T-A', blindPresetId: 'P', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: 1 } },
      { id: 'T-B', blindPresetId: 'P', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: 1, levelTotalSeconds: 1200 } }
    ];
    const writes = [];
    const op = await loadModules();
    const r = buildRenderer(op, { extra: preserveEnv(list, writes, { oldMinutes: [10, 20] }) });
    assert.equal(await r.preserveSharedPresetTimers('P', struct([20, 20]).levels), true);
    r.endSharedPresetPreserve();
    assert.equal(list[1].timerState.levelTotalSeconds, 1200, 'override は残る（書込なし or 維持）');
    // 構造保存が失敗＝構造は旧 10 分のまま → B を復元
    const b = await loadModules();
    b.blinds.setStructure(struct([10, 20]));
    const rb = buildRenderer(b, { extra: { el: classRec().el } });
    rb.applyTimerStateToTimer(normalizeTimerState(list[1].timerState), struct([10, 20]).levels, { silent: true });
    assert.equal(b.state.getState().remainingMs, 15 * MIN);
  });
  await test('R2-5b: override なしの大会で保全成功→構造保存失敗でも、付けた値は旧構造時間と同じ＝復元は残り15分のまま', async () => {
    const list = [
      { id: 'T-A', blindPresetId: 'P', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: 1 } },
      { id: 'T-B', blindPresetId: 'P', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: 1 } }
    ];
    const writes = [];
    const op = await loadModules();
    const r = buildRenderer(op, { extra: preserveEnv(list, writes) });
    assert.equal(await r.preserveSharedPresetTimers('P', struct([10, 20]).levels), true);
    r.endSharedPresetPreserve();
    const b = await loadModules();
    b.blinds.setStructure(struct([20, 20]));                  // 構造は旧のまま（保存失敗）
    const rb = buildRenderer(b, { extra: { el: classRec().el } });
    rb.applyTimerStateToTimer(normalizeTimerState(list[1].timerState), struct([20, 20]).levels, { silent: true });
    assert.equal(b.state.getState().remainingMs, 15 * MIN);
  });
  await test('R2-5c: 保全の書込が { ok: false } なら false を返す（呼出側は構造を上書きしない）', async () => {
    const list = [{ id: 'T-B', blindPresetId: 'P', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: 1 } }];
    const r = buildRenderer(await loadModules(), { extra: preserveEnv(list, [], { failWrite: true }) });
    assert.equal(await r.preserveSharedPresetTimers('P', struct([10, 20]).levels), false);
    const body = src('_savePresetCore');
    assert.match(body, /if \(!preserved\) \{[\s\S]{0,300}?return false;/, '保全失敗で構造の保存に進まない');
    assert.match(body, /finally \{[\s\S]{0,200}?if \(preserveHeld\) endSharedPresetPreserve\(\);/, '構造保存の後で周期保存を再開');
  });

  // ============================================================
  // R3-1: DB 指定残りが構造時間をわずかに超える時、前レベルへ戻らない（実 planClockApply → applyDbToEngine → timer）
  // ============================================================
  // PC は Lv(runIdx) を旧20分で継続中（構造は10分へ構造のみ適用済）・RUNNING。DB から同レベルの行を受信。
  async function r3Apply({ runIdx = 1, breakIdx = -1, row }) {
    const op = await loadModules();
    const mk = (mins) => { const st = struct(mins); if (breakIdx >= 0) st.levels[breakIdx].isBreak = true; return st; };
    const base = [20, 20, 20];
    op.blinds.setStructure(mk(base));
    op.timer.startAtLevel(runIdx);
    op.timer.advanceTimeBy(-3 * MIN);                    // 旧20分で 3 分経過（残り17分）・RUNNING のまま
    const changed = base.slice(); changed[runIdx] = 10;
    op.blinds.setStructure(mk(changed));                 // 構造のみ適用
    const r = buildRenderer(op, { extra: linkExtra(op, { schedulePersistRuntime: () => {} }) });
    r.applyDbToEngine(row(Date.now()), ORIGIN_A);
    return { op, r, s: op.state.getState() };
  }
  const TEN = 10 * MIN;
  for (const delta of [1, 1000, 1500, 1501, 0, -1000, -1501]) {
    await test(`R3-1(paused・Lv2・構造+${delta}ms): Lv2 のまま・残り ${TEN + delta}ms・PAUSED（前レベルへ戻らない）`, async () => {
      const { s } = await r3Apply({ row: () => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: TEN + delta, pre_start_total_ms: 0 }) });
      assert.equal(s.currentLevelIndex, 1);
      assert.equal(s.remainingMs, TEN + delta);
      assert.equal(s.status, 'PAUSED');
      assert.ok(s.totalMs >= s.remainingMs, `全体 ${s.totalMs} ≥ 残り`);
    });
  }
  await test('R3-1 Codex 再現: DB=Lv2・残り10分01秒・一時停止 → Lv2・601000ms・PAUSED（修正前 Lv1・残り1秒）', async () => {
    const { s } = await r3Apply({ row: () => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: 601000, pre_start_total_ms: 0 }) });
    assert.equal(s.currentLevelIndex, 1);
    assert.equal(s.remainingMs, 601000);
    assert.equal(s.status, 'PAUSED');
    assert.equal(s.totalMs, 20 * MIN, '旧20分の継続として扱う');
  });
  for (const delta of [1000, 1501, 0]) {
    await test(`R3-1(running・Lv2・構造+${delta}ms): Lv2 のまま・残り約 ${TEN + delta}ms`, async () => {
      const { s } = await r3Apply({ row: (now) => ({ status: 'running', current_level_index: 1, end_at_ms: now + TEN + delta }) });
      assert.equal(s.currentLevelIndex, 1);
      near(s.remainingMs, TEN + delta);
      assert.equal(s.status, 'RUNNING');
      assert.ok(s.totalMs >= s.remainingMs, `全体 ${s.totalMs} ≥ 残り`);
    });
  }
  await test('R3-1(Lv1・構造+1000ms): Lv1 のまま（最初のレベルでも残りを切り詰めない）', async () => {
    const { s } = await r3Apply({ runIdx: 0, row: () => ({ status: 'paused', current_level_index: 0, paused_remaining_ms: TEN + 1000, pre_start_total_ms: 0 }) });
    assert.equal(s.currentLevelIndex, 0);
    assert.equal(s.remainingMs, TEN + 1000);
  });
  await test('R3-1(ブレイク・構造+1000ms): ブレイクのまま・残り10分01秒', async () => {
    const { s } = await r3Apply({ breakIdx: 1, row: (now) => ({ status: 'running', current_level_index: 1, end_at_ms: now + TEN + 1000 }) });
    assert.equal(s.currentLevelIndex, 1);
    assert.equal(s.status, 'BREAK');
    near(s.remainingMs, TEN + 1000);
  });
  await test('R3-1(Lv1・running・構造+1000ms / ブレイク・paused・構造+1000ms): レベルを保持し 全体 ≥ 残り【review 軽微で補強】', async () => {
    let { s } = await r3Apply({ runIdx: 0, row: (now) => ({ status: 'running', current_level_index: 0, end_at_ms: now + TEN + 1000 }) });
    assert.equal(s.currentLevelIndex, 0); near(s.remainingMs, TEN + 1000); assert.ok(s.totalMs >= s.remainingMs);
    ({ s } = await r3Apply({ breakIdx: 1, row: () => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: TEN + 1000, pre_start_total_ms: 0 }) }));
    assert.equal(s.currentLevelIndex, 1); assert.equal(s.remainingMs, TEN + 1000); assert.equal(s.status, 'PAUSED'); assert.ok(s.totalMs >= s.remainingMs);
  });
  await test('R3-1(保存・復元・会場): 反映後の保存値で再起動しても会場側でも Lv2・残り601秒（前レベルを記録・表示しない）', async () => {
    const { r } = await r3Apply({ row: () => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: 601000, pre_start_total_ms: 0 }) });
    const saved = normalizeTimerState(r.captureCurrentTimerState());
    assert.equal(saved.currentLevel, 2);
    assert.equal(saved.status, 'paused');
    const op2 = await loadModules();
    op2.blinds.setStructure(struct([20, 10, 20]));
    const r2 = buildRenderer(op2, { extra: { el: classRec().el } });
    r2.applyTimerStateToTimer(r2.computeLiveTimerState(saved, struct([20, 10, 20]).levels), struct([20, 10, 20]).levels, { silent: true });
    assert.equal(op2.state.getState().currentLevelIndex, 1);
    near(op2.state.getState().remainingMs, 601000, '', 1000);
    assert.ok(op2.state.getState().totalMs >= op2.state.getState().remainingMs, '復元後も 全体 ≥ 残り');
    const hall = await loadModules();
    hall.blinds.setStructure(struct([20, 10, 20]));
    buildRenderer(hall, { role: 'hall' }).applyTimerStateToTimer(saved, struct([20, 10, 20]).levels, { silent: true });
    assert.equal(hall.state.getState().currentLevelIndex, 1);
    near(hall.state.getState().remainingMs, 601000, '', 1000);
    assert.ok(hall.state.getState().totalMs >= hall.state.getState().remainingMs, '会場側も 全体 ≥ 残り');
  });
  await test('R3-1(維持): 正当な継続（旧20・新10・残り15分）/ 構造時間ちょうどからの再開始 / 別レベルへの反映 は従来どおり', async () => {
    let { s } = await r3Apply({ row: () => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: 15 * MIN, pre_start_total_ms: 0 }) });
    assert.equal(s.currentLevelIndex, 1); assert.equal(s.remainingMs, 15 * MIN); assert.equal(s.totalMs, 20 * MIN);
    ({ s } = await r3Apply({ row: () => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: TEN, pre_start_total_ms: 0 }) }));
    assert.equal(s.currentLevelIndex, 1); assert.equal(s.remainingMs, TEN); assert.equal(s.totalMs, TEN, '再開始=新しい全体時間');
    ({ s } = await r3Apply({ row: () => ({ status: 'paused', current_level_index: 2, paused_remaining_ms: 5 * MIN, pre_start_total_ms: 0 }) }));
    assert.equal(s.currentLevelIndex, 2); assert.equal(s.remainingMs, 5 * MIN); assert.equal(s.totalMs, 20 * MIN, '別レベルは構造時間');
  });
  await test('R3-1(←→キー): 汎用の advanceTimeBy のレベル越境は従来どおり（意図した越境は維持）', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 10]));
    op.timer.startAtLevel(1); op.timer.pause();
    op.timer.advanceTimeBy(+30 * 1000);
    assert.equal(op.state.getState().currentLevelIndex, 0);
    assert.equal(op.state.getState().remainingMs, 30 * 1000);
  });
  await test('R3-1(判定関数の不変条件): どの入力でも「開始する全体時間 ≥ 正の指定残り」', async () => {
    const d = buildRenderer(await loadModules()).decideDbLevelStartTotalMs;
    for (const sameLevel of [true, false]) for (const local of [0, 5 * MIN, 10 * MIN, 20 * MIN]) for (const st of [5 * MIN, 10 * MIN, 20 * MIN])
      for (const rem of [1, st - 1501, st - 1500, st - 1, st, st + 1, st + 1500, st + 1501, 25 * MIN]) {
        if (rem <= 0) continue;
        const t = d({ sameLevel, localTotalMs: local, structTotalMs: st, remainingTargetMs: rem });
        const eff = t || st;
        assert.ok(eff >= rem, JSON.stringify({ sameLevel, local, st, rem, t }));
      }
  });

  await test('N1: scripts.test に本テストが登録', () => {
    assert.match(JSON.parse(read('package.json')).scripts.test, /tests\/clock-sync-codex\.test\.js/);
  });

  completed = true;
  console.log(`\nclock-sync-codex.test.js: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
})();
