/**
 * 段階A（codex R3-3 / R3-4 / R3-5）+ 一覧リセット（2026-10-10 前原 GO）回帰テスト
 *
 *   R3-3 紐づけ応答待ちの大会往復（A→B→A）で古い時計・人数を採用しない（大会切替連番）
 *   R3-4 画面の作り直しで世代が 0 に戻っても、旧画面の送信の通知（apply-db）を弾く（画面固有 ID）
 *   R3-5 完走を復元した大会で、店舗側へ idle ではなく finished を送る
 *   一覧リセット: 時計に加えて人数・リエントリー・アドオン・特殊スタック適用人数も 0。
 *     保証プライズ等の設定は残す。連携 ON の裏の大会は「選んでからリセット」。店舗側へ送る内容を固定。
 *
 *   実 timer.js / state.js / blinds.js / clock-payload.mjs / db-link.js と renderer.js の実関数を結線する
 *   （ハーネスは tests/clock-sync-codex.test.js と同一方式）。
 *
 *   実行: node tests/stageA-r3-345-list-reset.test.js
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
const INDEX    = read('src', 'renderer', 'index.html');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `stageA-r3-${process.pid}-${_seq++}-`));
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

const NAMES = ['isEngineFinishedState', 'captureCurrentTimerState', 'mapStateToStorageStatus', 'applyTimerStateToTimer',
  'isDbLinkOriginCurrent', 'decideDbLevelStartTotalMs', 'applyDbToEngine', 'handleDbLinkEvent', '_dbLinkOriginNow',
  'publishDbLinkClock', 'publishDbLinkRuntime', 'resetTournamentRuntime', 'handleReset',
  'hasListResetableCounts', 'handleTournamentListReset'];

// env は外から書き換え可能
function buildRenderer(mods, { role = 'operator-solo', extra = {} } = {}) {
  const { state, blinds, timer } = mods;
  const env = {
    window: { appRole: role, api: { log: { write: () => {} } } },
    States: state.States, getState: state.getState, setState: state.setState, subscribe: state.subscribe,
    getLevel: blinds.getLevel, getLevelCount: blinds.getLevelCount, isBreakLevel: blinds.isBreakLevel,
    setStructure: blinds.setStructure, getStructure: blinds.getStructure,
    isPreStartActive: timer.isPreStartActive, getPreStartTotalMs: () => 0,
    timerStartAtLevel: timer.startAtLevel, timerAdvanceBy: timer.advanceTimeBy,
    timerPause: timer.pause, timerResume: timer.resume, timerReset: timer.reset, timerRestorePreStart: timer.restorePreStart,
    timerCancelPreStart: timer.cancelPreStart,
    hallTickState: { rafId: null }, blindPresetCache: new Map(),
    _tournamentSwitching: false,
    ...extra
  };
  const proxy = new Proxy(env, {
    has: (t, k) => typeof k === 'string' && !GLOBAL_OK.has(k),
    get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : makeStub()))
  });
  const consts = [
    (RENDERER.match(/^const DB_RESTART_TOLERANCE_MS = .*$/m) || [''])[0],
    (RENDERER.match(/^const LIST_RESET_LINKED_MESSAGE = .*$/m) || [''])[0],
    (RENDERER.match(/^const LIST_RESET_SAVE_FAILED_MESSAGE = .*$/m) || [''])[0]
  ].join('\n');
  const body = `with (env) {\n${consts}\n${NAMES.map((n) => src(n)).join('\n')}\nreturn { ${NAMES.join(', ')} };\n}`;
  const fns = new Function('env', body)(proxy);
  return { ...fns, env };
}

const MIN = 60 * 1000;
const near = (a, b, msg, tol = 100) => assert.ok(Math.abs(a - b) < tol, `${msg || ''} ${a} ≉ ${b}`);
const struct = (mins) => ({ id: 'p', name: 'p', structureType: 'BLIND', levels: mins.map((m, i) => ({ level: i + 1, sb: 100 * (i + 1), bb: 200 * (i + 1), bbAnte: 0, durationMinutes: m, isBreak: false })) });
const classRec = () => { const set = new Set(); return { set, el: { clock: { classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) }, dataset: {} } } }; };

(async () => {
  const payload = await import(pathToFileURL(path.join(ROOT, 'src', 'link', 'clock-payload.mjs')).href);

  const sends = () => ({ records: [], runtimes: [] });
  const linkExtra = (box, extra = {}) => ({
    _dbLinkSend: { active: true, pcId: 'T-A', dbId: 'DB-A' }, _dbLinkGen: 1, _dbLinkApplying: false, _dbLinkDown: false,
    _dbLinkInstanceId: 'INST-NEW', _dbLinkLastRuntimeJson: '',
    planClockApply: payload.planClockApply, planRuntimeApply: payload.planRuntimeApply,
    buildRecordPayload: payload.buildRecordPayload, buildRuntimePayload: payload.buildRuntimePayload,
    tournamentState: { id: 'T-A', guarantee: 50000, specialStack: { enabled: true, label: '早期着席特典', chips: 5000, appliedCount: 4 } },
    tournamentRuntime: { playersInitial: 10, playersRemaining: 8, reentryCount: 3, addOnCount: 2 },
    ...extra,
    window: { appRole: 'operator-solo', api: { log: { write: () => {} }, dblink: {
      publishRecord: (p) => box.records.push(p), publishRuntime: (p) => box.runtimes.push(p) } }, ...(extra.window || {}) }
  });
  const rowRunning = (now) => ({ status: 'running', current_level_index: 0, end_at_ms: now + 3 * MIN,
    players_initial: 50, players_remaining: 40, reentry_count: 7, addon_count: 3 });
  async function pausedAt20() {
    const op = await loadModules();
    op.blinds.setStructure(struct([20, 20]));
    op.timer.startAtLevel(0); op.timer.pause();
    return op;
  }
  async function finishedAt(mins) {
    const op = await loadModules();
    op.blinds.setStructure(struct(mins));
    const last = mins.length - 1;
    op.state.setState({ status: op.state.States.IDLE, currentLevelIndex: last, remainingMs: 0, totalMs: mins[last] * MIN });
    return op;
  }

  // ============================================================
  // R3-4: 画面固有 ID
  // ============================================================
  await test('R3-4a: apply-db の origin が旧画面の ID（世代は偶然一致）なら、時計・人数・保存に触れない', async () => {
    const op = await pausedAt20();
    let persisted = 0;
    const box = sends();
    const r = buildRenderer(op, { extra: linkExtra(box, { schedulePersistRuntime: () => { persisted++; } }) });
    r.handleDbLinkEvent({ type: 'apply-db', clock: rowRunning(Date.now()), dbId: 'DB-A', origin: { pcId: 'T-A', gen: 1, inst: 'INST-OLD' } });
    assert.equal(op.state.getState().remainingMs, 20 * MIN);
    assert.equal(r.env.tournamentRuntime.playersRemaining, 8);
    assert.equal(persisted, 0);
  });
  await test('R3-4b: apply-db の origin に画面 ID が無い（空）なら破棄（通知経路は必須）', async () => {
    const op = await pausedAt20();
    let persisted = 0;
    const r = buildRenderer(op, { extra: linkExtra(sends(), { schedulePersistRuntime: () => { persisted++; } }) });
    for (const inst of [undefined, '']) {
      r.handleDbLinkEvent({ type: 'apply-db', clock: rowRunning(Date.now()), dbId: 'DB-A', origin: { pcId: 'T-A', gen: 1, inst } });
    }
    assert.equal(op.state.getState().remainingMs, 20 * MIN);
    assert.equal(persisted, 0);
  });
  await test('R3-4c: 現在の画面 ID なら従来どおり DB に従う（時計・人数・保存）', async () => {
    const op = await pausedAt20();
    let persisted = 0;
    const r = buildRenderer(op, { extra: linkExtra(sends(), { schedulePersistRuntime: () => { persisted++; } }) });
    r.handleDbLinkEvent({ type: 'apply-db', clock: rowRunning(Date.now()), dbId: 'DB-A', origin: { pcId: 'T-A', gen: 1, inst: 'INST-NEW' } });
    near(op.state.getState().remainingMs, 3 * MIN, '', 2000);
    assert.equal(r.env.tournamentRuntime.playersRemaining, 40);
    assert.equal(persisted, 1);
  });
  await test('R3-4d: probe / 紐づけの応答（画面 ID なし）は従来どおり適用（呼び出した画面にしか返らないため）', async () => {
    const op = await pausedAt20();
    const r = buildRenderer(op, { extra: linkExtra(sends(), { schedulePersistRuntime: () => {} }) });
    r.applyDbToEngine(rowRunning(Date.now()), { pcId: 'T-A', dbId: 'DB-A', gen: 1 });
    near(op.state.getState().remainingMs, 3 * MIN, '', 2000);
  });
  await test('R3-4e: 送信の origin に画面 ID を添え、main は 64 文字以内の文字列だけ保持して push で返す（外部送信 body には載せない）', async () => {
    const r = buildRenderer(await loadModules(), { extra: linkExtra(sends()) });
    assert.deepEqual(r._dbLinkOriginNow(), { pcId: 'T-A', dbId: 'DB-A', gen: 1, inst: 'INST-NEW' });
    const dbLink = require(path.join(ROOT, 'src', 'link', 'db-link.js'));
    const data = { dbLink: { url: 'https://s.example.com', storeKey: 'k', links: { 'T-A': { id: 'DB-A', name: 'A', part_label: '' } } } };
    const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
    const bodies = [];
    const responses = [
      { status: 409, json: { ok: false, code: 'clock_conflict', error: 'conflict' } },
      { status: 200, json: { ok: true, clock: rowRunning(Date.now()) } }
    ];
    const fetchImpl = async (url, opts) => { if (opts && opts.body) bodies.push(String(opts.body)); const n = responses.shift(); return { ok: n.status < 300, status: n.status, json: async () => n.json }; };
    const events = [];
    dbLink.init(store, null, { fetchImpl, notify: (p) => events.push(p), delayFn: (fn) => setTimeout(fn, 0) });
    dbLink.publishRuntime('T-A', { players_initial: 10, players_remaining: 9, reentry_count: 0, addon_count: 0, special_count: 0, special_enabled: false },
      { pcId: 'T-A', dbId: 'DB-A', gen: 1, inst: 'INST-NEW' });
    for (let i = 0; i < 50 && !events.some((e) => e.type === 'apply-db'); i++) await new Promise((res) => setTimeout(res, 5));
    const ev = events.find((e) => e.type === 'apply-db');
    assert.ok(ev, 'apply-db が届く');
    assert.equal(ev.origin.inst, 'INST-NEW');
    assert.ok(bodies.length > 0 && bodies.every((b) => !b.includes('INST-NEW')), '外部送信 body に画面 ID が載らない');
    // _sanitizeOrigin: 文字列以外・65 文字以上は空に落とす
    const san = new Function(`${src('_sanitizeOrigin', read('src', 'link', 'db-link.js'))}\nreturn _sanitizeOrigin;`)();
    assert.equal(san({ pcId: 'T-A', gen: 1, inst: 'x'.repeat(65) }).inst, '');
    assert.equal(san({ pcId: 'T-A', gen: 1, inst: 123 }).inst, '');
    assert.equal(san({ pcId: 'T-A', gen: 1, inst: 'x'.repeat(64) }).inst, 'x'.repeat(64));
  });

  // ============================================================
  // R3-3: 大会切替連番
  // ============================================================
  await test('R3-3a: applyTournament が大会 id の変化を同期的に数え、未連携同士の A→B→A でも連番が進む', () => {
    const body = src('applyTournament');
    const m = body.match(/try \{\r?\n\s*const _seqId = [\s\S]*?\r?\n\s*\} catch \(_\) \{ \/\* ignore \*\/ \}/);
    assert.ok(m, '連番更新ブロックが applyTournament に無い');
    assert.ok(body.indexOf(m[0]) < body.indexOf('refreshDbLinkSendState()'), '連番更新は送信ゲート更新（async）より前');
    const env = { tournamentState: { id: 'T-A' }, _dbLinkSeqLastId: '', _dbLinkTournamentSeq: 0 };
    const bump = new Function('env', `with (env) { ${m[0]} }`);
    bump(env); const reqSeq = env._dbLinkTournamentSeq;           // A を開いた状態で紐づけ要求
    env.tournamentState = { id: 'T-B' }; bump(env);                // 応答待ちに B へ
    env.tournamentState = { id: 'T-A' }; bump(env);                // A へ戻る
    assert.notEqual(env._dbLinkTournamentSeq, reqSeq, '往復を検出できる');
    const same = env._dbLinkTournamentSeq; bump(env);
    assert.equal(env._dbLinkTournamentSeq, same, '同じ大会の再適用では進まない');
  });
  await test('R3-3b: 紐づけ確定は要求前に連番を控え、連番が同じ時だけ DB の時計・人数を適用（違えばログのみ）', () => {
    const i0 = RENDERER.indexOf("showLinkStatus('紐づけ中...');");
    const seg = RENDERER.slice(i0, RENDERER.indexOf('publishDbLinkDisplay(true);', i0));
    assert.ok(seg.indexOf('const reqSeq = _dbLinkTournamentSeq;') >= 0 && seg.indexOf('const reqSeq') < seg.indexOf('linkAndInit'), '要求前に控える');
    assert.match(seg, /if \(reqSeq === _dbLinkTournamentSeq\) \{\r?\n\s*applyDbToEngine\(res\.clock, \{ pcId: curId, dbId: db\.id \}\);\r?\n\s*\} else \{\r?\n\s*try \{ window\.api\?\.log\?\.write\?\.\('dblink:link-stale-skip'/);
  });

  // ============================================================
  // R3-5: 完走の送信
  // ============================================================
  await test('R3-5a: 完走判定は保存側（captureCurrentTimerState）の finished と一致', async () => {
    for (const [mins, idx, rem, want] of [[[20, 20], 1, 0, true], [[20, 20], 0, 0, false], [[20, 20], 1, 1000, false], [[20], 0, 0, true]]) {
      const op = await loadModules();
      op.blinds.setStructure(struct(mins));
      op.state.setState({ status: op.state.States.IDLE, currentLevelIndex: idx, remainingMs: rem, totalMs: mins[idx] * MIN });
      const r = buildRenderer(op, { extra: linkExtra(sends()) });
      assert.equal(r.isEngineFinishedState(op.state.getState()), want, `${mins}/${idx}/${rem}`);
      assert.equal(r.captureCurrentTimerState().status === 'finished', want, `capture ${mins}/${idx}/${rem}`);
    }
  });
  await test('R3-5b: 完走状態での送信は idle ではなく finished', async () => {
    const op = await finishedAt([20, 20]);
    const box = sends();
    const r = buildRenderer(op, { extra: linkExtra(box) });
    r.publishDbLinkClock();
    assert.equal(box.records.length, 1);
    assert.equal(box.records[0].record.status, 'finished');
  });
  await test('R3-5c: 完走を復元（applyTimerStateToTimer finished）すると、店舗側へ finished を送る', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([20, 20]));
    const box = sends();
    const cr = classRec();
    const r = buildRenderer(op, { extra: { ...linkExtra(box), el: cr.el } });
    r.applyTimerStateToTimer({ status: 'finished', currentLevel: 2, elapsedSecondsInLevel: 1200, startedAt: null, pausedAt: null });
    assert.ok(cr.set.has('clock--timer-finished'));
    assert.ok(box.records.length >= 1, '送信あり');
    assert.equal(box.records[box.records.length - 1].record.status, 'finished');
  });
  await test('R3-5d: 初回 probe で DB が idle・PC が完走なら追従せず完走を再送（PC の完走を保つ）', async () => {
    const op = await finishedAt([20, 20]);
    const box = sends();
    const r = buildRenderer(op, { extra: linkExtra(box, { schedulePersistRuntime: () => {} }) });
    r.applyDbToEngine({ status: 'idle', current_level_index: 0, end_at_ms: null, paused_remaining_ms: null,
      players_initial: 10, players_remaining: 8, reentry_count: 3, addon_count: 2 }, { pcId: 'T-A', dbId: 'DB-A', gen: 1 });
    const s = op.state.getState();
    assert.equal(s.currentLevelIndex, 1); assert.equal(s.remainingMs, 0);
    assert.equal(box.records.length, 1);
    assert.equal(box.records[0].record.status, 'finished');
  });
  await test('R3-5e: planClockApply の終端状態（DB finished・PC 非完走の待機は従来どおり null=逆方向は扱わない）', () => {
    const now = Date.now();
    const idleLocal = { status: 'IDLE', currentLevelIndex: 0, remainingMs: 20 * MIN, isPreStart: false };
    assert.deepEqual(payload.planClockApply({ ...idleLocal, finished: true }, { status: 'idle' }, now), { kind: 'republish', reason: 'stale-idle-finished' });
    assert.equal(payload.planClockApply(idleLocal, { status: 'idle' }, now), null);
    assert.equal(payload.planClockApply({ ...idleLocal, finished: false }, { status: 'idle' }, now), null);
    assert.equal(payload.planClockApply(idleLocal, { status: 'finished' }, now), null);
    assert.equal(payload.planClockApply({ ...idleLocal, finished: true }, { status: 'finished' }, now), null);
    assert.deepEqual(payload.planClockApply({ status: 'RUNNING', currentLevelIndex: 0, remainingMs: MIN, isPreStart: false }, { status: 'idle' }, now),
      { kind: 'republish', reason: 'stale-idle' }, '案件231 の分岐は不変');
  });

  // ============================================================
  // 一覧リセット
  // ============================================================
  function resetEnv(box, cr, over = {}) {
    const calls = { persist: 0, render: 0, tset: [], setTimerState: [], setRuntime: [], save: [], alerts: [], confirms: [], listRender: 0 };
    const base = linkExtra(box, {
      schedulePersistRuntime: () => { calls.persist++; },
      renderStaticInfo: () => { calls.render++; },
      updateOperatorPane: () => {},
      renderTournamentListWithDedup: async () => { calls.listRender++; },
      el: { ...cr.el, tournamentSpecialStackCount: { value: '4' } },
      ...over
    });
    base.window.api.tournament = { set: async (p) => { calls.tset.push(JSON.parse(JSON.stringify(p))); return { ok: true }; } };
    base.window.api.tournaments = {
      setTimerState: async (id, ts) => { calls.setTimerState.push([id, ts]); if (over._onSetTimerState) over._onSetTimerState(base); return { ok: true }; },
      setRuntime: async (id, rt) => { calls.setRuntime.push([id, rt]); return over._failRuntime ? { ok: false, error: 'switching-mode' } : { ok: true }; },
      save: async (t) => { calls.save.push(JSON.parse(JSON.stringify(t))); return { ok: true }; }
    };
    base.window.api.dblink.getStatus = async () => over._status || { configured: true, links: { 'T-A': { id: 'DB-A' } } };
    base.window.alert = (m) => calls.alerts.push(m);
    base.window.confirm = (m) => { calls.confirms.push(m); return over._confirm !== false; };
    return { env: base, calls };
  }

  await test('L1: resetTournamentRuntime は人数・リエントリー・アドオン・特殊スタック適用人数を 0 にして保存（有効/チップ/名称・保証プライズは残す）', async () => {
    const op = await pausedAt20();
    const box = sends(); const cr = classRec();
    const { env, calls } = resetEnv(box, cr);
    const r = buildRenderer(op, { extra: env });
    r.resetTournamentRuntime();
    assert.deepEqual(r.env.tournamentRuntime, { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 });
    assert.deepEqual(r.env.tournamentState.specialStack, { enabled: true, label: '早期着席特典', chips: 5000, appliedCount: 0 });
    assert.equal(r.env.tournamentState.guarantee, 50000);
    assert.deepEqual(calls.tset, [{ specialStack: { enabled: true, label: '早期着席特典', chips: 5000, appliedCount: 0 } }]);
    assert.equal(r.env.el.tournamentSpecialStackCount.value, '0');
    assert.equal(calls.persist, 1);
    assert.equal(calls.render, 1);
  });
  await test('L2: 画面下リセット（handleReset）の店舗連携送信を固定 — 時計 idle・人数 0（特殊スタック 0）', async () => {
    const op = await pausedAt20();
    const box = sends(); const cr = classRec();
    const { env } = resetEnv(box, cr);
    const r = buildRenderer(op, { extra: env });
    r.handleReset();
    r.publishDbLinkRuntime();   // 実画面では renderStaticInfo（集約点）から呼ばれる
    assert.equal(box.records.length, 1);
    assert.equal(box.records[0].record.status, 'idle');
    assert.equal(box.records[0].record.current_level_index, 0);
    assert.deepEqual(box.runtimes[0].runtime, { players_initial: 0, players_remaining: 0, reentry_count: 0, addon_count: 0, special_count: 0, special_enabled: true });
    // 集約点 renderStaticInfo が人数（runtime）と表示（プール/配当）の送信を含むこと
    const rsi = src('renderStaticInfo');
    assert.match(rsi, /publishDbLinkRuntime\(\);/); assert.match(rsi, /publishDbLinkDisplay\(\);/);
  });
  await test('L3: 1 レベル構成の完走からのリセットでも idle を明示送信（状態・レベルが変わらず購読が発火しない経路）', async () => {
    const op = await finishedAt([20]);
    const box = sends(); const cr = classRec();
    cr.set.add('clock--timer-finished');
    const { env } = resetEnv(box, cr);
    const r = buildRenderer(op, { extra: env });
    const before = op.state.getState();
    r.handleReset();
    const after = op.state.getState();
    assert.equal(before.status, after.status); assert.equal(before.currentLevelIndex, after.currentLevelIndex);
    assert.equal(box.records.length, 1);
    assert.equal(box.records[0].record.status, 'idle');
    assert.ok(!cr.set.has('clock--timer-finished'), '完走表示を解除');
  });
  await test('L4: 一覧リセット（作用中の大会）= 確認文に「0 に戻ります」・人数等 0・時計 idle・完走解除・idle 送信', async () => {
    const op = await finishedAt([20, 20]);
    const box = sends(); const cr = classRec();
    cr.set.add('clock--timer-finished');
    const { env, calls } = resetEnv(box, cr);
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-A', '大会A');
    assert.match(calls.confirms[0], /参加人数・リエントリー・アドオンの数も 0 に戻ります（保証プライズ・ブラインド・料金・配当の設定はそのままです）/);
    assert.deepEqual(calls.setTimerState[0], ['T-A', { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null }]);
    assert.deepEqual(r.env.tournamentRuntime, { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 });
    assert.equal(r.env.tournamentState.specialStack.appliedCount, 0);
    assert.equal(op.state.getState().status, op.state.States.IDLE);
    assert.equal(op.state.getState().currentLevelIndex, 0);
    assert.ok(!cr.set.has('clock--timer-finished'));
    assert.equal(box.records[box.records.length - 1].record.status, 'idle');
    assert.equal(calls.setRuntime.length, 0, '作用中は resetTournamentRuntime 経由（既存の debounce 保存）');
    assert.equal(calls.listRender, 1);
  });
  await test('L5: 一覧リセット（裏の大会・未連携）= 時計 idle・runtime 0・特殊スタック適用人数 0 のみを保存（他の項目は渡さない）', async () => {
    const op = await pausedAt20();
    const box = sends(); const cr = classRec();
    const { env, calls } = resetEnv(box, cr, { _status: { configured: true, links: { 'T-A': { id: 'DB-A' } } } });
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-B', '大会B');
    assert.equal(calls.setTimerState[0][0], 'T-B');
    assert.deepEqual(calls.setRuntime, [['T-B', { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 }]]);
    assert.deepEqual(calls.save, [{ id: 'T-B', specialStack: { appliedCount: 0 } }]);
    assert.equal(op.state.getState().remainingMs, 20 * MIN, '作用中の大会の時計には触れない');
    assert.equal(r.env.tournamentRuntime.playersRemaining, 8, '作用中の大会の人数には触れない');
    assert.equal(box.records.length, 0);
  });
  await test('L5b: 裏の大会の人数 0 保存が失敗したら（切替中の ok:false）利用者に知らせる', async () => {
    const op = await pausedAt20();
    const { env, calls } = resetEnv(sends(), classRec(), { _failRuntime: true, _status: { configured: true, links: {} } });
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-B', '大会B');
    assert.equal(calls.alerts.length, 1);
    assert.match(calls.alerts[0], /人数などを 0 に戻す保存に失敗しました/);
  });
  await test('L5c: 確認後の通信待ちの間に表示中の大会が切り替わったら、切替後の大会の人数には触れない', async () => {
    const op = await pausedAt20();
    const { env, calls } = resetEnv(sends(), classRec(), { _onSetTimerState: (e) => { e.tournamentState.id = 'T-OTHER'; } });
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-A', '大会A');   // 押した時点では表示中
    assert.equal(r.env.tournamentRuntime.playersRemaining, 8, '切替後の大会（表示中）の人数は残る');
    assert.deepEqual(calls.setRuntime, [['T-A', { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 }]], '押した大会は保存データ側で 0');
    assert.equal(op.state.getState().remainingMs, 20 * MIN, '切替後の大会の時計に触れない');
  });
  await test('L6: 一覧リセット（裏の大会・店舗連携 ON）= 案内のみで何も書き換えない（④）', async () => {
    const op = await pausedAt20();
    const box = sends(); const cr = classRec();
    const { env, calls } = resetEnv(box, cr, { _status: { configured: true, links: { 'T-B': { id: 'DB-B' } } } });
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-B', '大会B');
    assert.equal(calls.alerts.length, 1);
    assert.match(calls.alerts[0], /店舗連携中の大会は、先に一覧で「選択」してからリセットしてください/);
    assert.equal(calls.confirms.length, 0);
    assert.equal(calls.setTimerState.length + calls.setRuntime.length + calls.save.length, 0);
  });
  await test('L6b: 連携先が未設定（configured=false）なら連携なし扱いでリセットできる', async () => {
    const op = await pausedAt20();
    const { env, calls } = resetEnv(sends(), classRec(), { _status: { configured: false, links: { 'T-B': { id: 'DB-B' } } } });
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-B', '大会B');
    assert.equal(calls.alerts.length, 0);
    assert.equal(calls.setRuntime.length, 1);
  });
  await test('L7: 確認でキャンセルしたら何も書き換えない', async () => {
    const op = await pausedAt20();
    const { env, calls } = resetEnv(sends(), classRec(), { _confirm: false });
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-A', '大会A');
    assert.equal(calls.setTimerState.length + calls.setRuntime.length + calls.save.length + calls.tset.length, 0);
    assert.equal(r.env.tournamentRuntime.playersRemaining, 8);
  });
  await test('L8: ④ の根拠を実測 — 裏で戻しても、選んだ時の初回 probe で店舗側の古い進行中の行が時計・人数とも採用される', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([20, 20]));
    op.timer.reset();
    const plan = payload.planClockApply({ status: 'IDLE', currentLevelIndex: 0, remainingMs: 20 * MIN, isPreStart: false, finished: false },
      { status: 'running', current_level_index: 1, end_at_ms: Date.now() + 5 * MIN }, Date.now());
    assert.equal(plan.kind, 'level'); assert.equal(plan.levelIndex, 1);
    const rt = payload.planRuntimeApply({ players_initial: 30, players_remaining: 20, reentry_count: 4, addon_count: 1 },
      { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 }, false, 0);
    assert.ok(rt && rt.playersInitial === 30, '人数も DB 側が採用される');
  });
  await test('L9: 一覧のリセットボタンは進行中/一時停止中に加え、完走済み・数が残る待機中にも出す（③）', async () => {
    const r = buildRenderer(await loadModules(), { extra: linkExtra(sends()) });
    assert.equal(r.hasListResetableCounts({ runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 }, specialStack: { appliedCount: 0 } }), false);
    assert.equal(r.hasListResetableCounts({}), false);
    for (const t of [{ runtime: { playersInitial: 5 } }, { runtime: { playersRemaining: 1 } }, { runtime: { reentryCount: 1 } }, { runtime: { addOnCount: 1 } }, { specialStack: { appliedCount: 2 } }]) {
      assert.equal(r.hasListResetableCounts(t), true, JSON.stringify(t));
    }
    assert.match(RENDERER, /if \(ts\.status === 'running' \|\| ts\.status === 'paused' \|\| ts\.status === 'finished' \|\| hasListResetableCounts\(t\)\) \{\r?\n\s*const reset = document\.createElement\('button'\);/);
  });
  await test('L10: 画面下リセットの確認ダイアログ（と代替 confirm）にも 0 に戻る旨を明記（⑤）', () => {
    assert.match(INDEX, /<p class="confirm-dialog__message">タイマーをリセットしますか？<br>参加人数・リエントリー・アドオンの数も 0 に戻ります（保証プライズ・ブラインド・料金・配当の設定はそのままです）。<\/p>/);
    assert.match(src('openResetDialog'), /window\.confirm\('タイマーをリセットしますか？\\n参加人数・リエントリー・アドオンの数も 0 に戻ります/);
  });
  await test('L11: 裏の大会への部分保存 { id, specialStack:{appliedCount:0} } は、他の設定（保証プライズ・ブラインド・料金・配当・テロップ・表示）を現値のまま残す', () => {
    // main.js の実関数・実定数だけで normalizeTournament を組み立てる（stub なし。未定義の識別子があれば即失敗）
    const constSrc = (name) => {
      const i = MAIN_JS.search(new RegExp(`^const ${name}\\b`, 'm'));
      assert.ok(i >= 0, `${name} が見つからない`);
      let j = MAIN_JS.indexOf('=', i) + 1, dp = 0, db = 0, dk = 0;
      for (; j < MAIN_JS.length; j++) {
        const c = MAIN_JS[j];
        if (c === '(') dp++; else if (c === ')') dp--; else if (c === '{') db++; else if (c === '}') db--;
        else if (c === '[') dk++; else if (c === ']') dk--; else if (c === ';' && !dp && !db && !dk) return MAIN_JS.slice(i, j + 1);
      }
      return '';
    };
    const consts = ['VALID_MARQUEE_SPEEDS', 'MARQUEE_TEXT_MAX', 'VALID_TIMER_STATUS', 'VALID_GAUGE_MODES', 'VALID_PIP_SIZES', 'BREAK_IMAGES_MAX_COUNT', 'MAX_POT_AMOUNT', 'GAMES', 'TITLE_COLOR_RE',
      'VALID_PAYOUT_ROUNDINGS', 'VALID_BACKGROUNDS', 'VALID_TIMER_FONTS', 'VALID_BG_OVERLAYS', 'DEFAULT_TOURNAMENT_EXT'];
    const fns = ['toNonNegNumber', 'normalizeGameType', 'normalizePayouts', 'sanitizeRuntime', 'normalizeTimerState', 'sanitizeMarqueeSettings',
      'sanitizePoolRates', 'sanitizePotAmounts', 'getDefaultDisplaySettings', 'sanitizeBreakImageInterval', 'sanitizePipSize', 'sanitizeGaugeMode',
      'isValidBlindPresetId', 'isValidNewGameId', 'sanitizePoolRate', 'sanitizePotAmount', 'sanitizeBreakImages', 'sanitizeBackgroundOverlay', 'normalizeTournament'];
    const missing = [];
    // 同梱プリセット一覧はファイル読込のため、プリセット id 判定用の最小値だけ与える（他はすべて実物）
    const env = new Proxy({ store: { get: () => undefined }, BUILTIN_PRESETS: [{ id: 'demo-fast' }] }, {
      has: (t, k) => typeof k === 'string' && !(k in globalThis),
      get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined; missing.push(String(k)); return undefined; }
    });
    const normalize = new Function('env', `with (env) {\n${consts.map(constSrc).join('\n')}\n${fns.map((n) => src(n, MAIN_JS)).join('\n')}\nreturn normalizeTournament;\n}`)(env);
    // 保存済みの大会（store のレコードは常に正規化済み）を作る
    const cur = normalize({
      id: 'T-B', name: '大会B', subtitle: 'sub', guarantee: 300000, blindPresetId: 'demo-fast', gameType: 'nlh', stackModel: 'unified',
      buyIn: { fee: 5000, chips: 30000 }, reentry: { fee: 4000, chips: 30000 }, addOn: { fee: 2000, chips: 20000 },
      payouts: [{ rank: 1, percentage: 60, amount: 100000 }, { rank: 2, percentage: 40, amount: 50000 }], payoutMode: 'amount',
      potAmounts: { buyIn: 50, reentry: 40, addOn: 20 }, marqueeSettings: { enabled: true, text: 'テロップ', speed: 'normal' },
      displaySettings: { background: 'emerald', timerFont: 'roboto' }, specialStack: { enabled: true, label: '早期', chips: 7000, appliedCount: 6 },
      runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 }, timerState: { status: 'idle', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: null }
    }, { id: 'T-B' });
    assert.equal(cur.guarantee, 300000); assert.equal(cur.payoutMode, 'amount'); assert.equal(cur.marqueeSettings.text, 'テロップ');
    const out = normalize({ id: 'T-B', specialStack: { appliedCount: 0 } }, JSON.parse(JSON.stringify(cur)));
    assert.deepEqual(missing, [], '未定義の識別子なし');
    assert.deepEqual(out, { ...cur, specialStack: { ...cur.specialStack, appliedCount: 0 } });
  });
  await test('L12（INVARIANT）: resetTournamentRuntime の呼出元は handleReset と handleTournamentListReset の 2 つだけ', () => {
    const lines = RENDERER.split(/\r?\n/);
    const callers = [];
    let curFn = '';
    for (const line of lines) {
      const fm = line.match(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
      if (fm) curFn = fm[1];
      if (/\bresetTournamentRuntime\s*\(/.test(line) && !/^function\s+resetTournamentRuntime\s*\(/.test(line) && !/^\s*\/\//.test(line)) callers.push(curFn);
    }
    assert.deepEqual([...new Set(callers)].sort(), ['handleReset', 'handleTournamentListReset']);
    assert.equal(callers.length, 2, callers.join(','));
    // ブラインド適用系は従来どおり runtime を消さない
    assert.doesNotMatch(src('resetBlindProgressOnly'), /resetTournamentRuntime\s*\(/);
  });
  await test('L13: package.json の test に本ファイルが登録されている', () => {
    assert.match(JSON.parse(read('package.json')).scripts.test, /tests\/stageA-r3-345-list-reset\.test\.js/);
  });

  completed = true;
  console.log(`\nstageA-r3-345-list-reset.test.js: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
})();
