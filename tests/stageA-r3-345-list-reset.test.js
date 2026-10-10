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
// codex 段階A r2 F2: 時計の復元（restoreActiveTimerStateFromStore）は例外を内部で握って console.warn するため、
//   テストが PASS でも復元が失敗していることがあった。復元・適用系の警告を捕まえ、出たテストは FAIL にする。
// 復元ラッパ（restoreActiveTimerStateFromStore）と構造切替の警告文だけを対象にする（無関係な警告で FAIL にしない）
const RESTORE_WARN_RE = /timerState 復元失敗|構造切替失敗/;
const _restoreWarnings = [];
const _origWarn = console.warn;
console.warn = (...args) => {
  const msg = args.map((a) => (a && a.stack) ? a.stack : String(a)).join(' ');
  if (RESTORE_WARN_RE.test(msg)) _restoreWarnings.push(msg);
  _origWarn(...args);
};
async function test(name, fn) {
  const warnBefore = _restoreWarnings.length;
  try {
    await fn();
    if (_restoreWarnings.length > warnBefore) {
      throw new Error(`復元・適用の警告が出た（復元が失敗している）: ${_restoreWarnings.slice(warnBefore).join(' | ').slice(0, 300)}`);
    }
    console.log('PASS:', name); pass++;
  }
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
  'hasListResetableCounts', 'handleTournamentListReset',
  // codex 段階A A-1/A-2（大会切替の実順序まで結線）
  '_dbLinkSendTargetOk', 'isTournamentSwitchBusy', 'applyTournament', 'renderStaticInfo', 'refreshDbLinkSendState',
  'applyDbLinkSendGate', 'runDbLinkActivation', 'runDbLinkProbe', 'finishDbLinkSwitch', 'handleTournamentSelectChange',
  'restoreActiveTimerStateFromStore',
  // codex 段階A r2 F2: 実復元に必要な関数（未登録だと何もしない代用になり、復元が例外で終わっても気付けなかった）
  'computeLiveTimerState', '_liveLevelTotalMs'];

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
    setTimeout: (fn, ms) => setTimeout(fn, ms),   // 送信ゲートの同期予約（applyDbLinkSendGate）を実際に走らせる
    _tournamentSwitching: false, _tournamentDeleteInFlight: false, _listResetInFlight: false, _dbLinkSwitchHoldId: '', _dbLinkActivationScheduledFor: '', _tournamentSelectInFlight: false,
    _dbLinkTournamentSeq: 0, _dbLinkSeqLastId: '', _dbLinkLastDisplayJson: '',
    ...extra
  };
  const proxy = new Proxy(env, {
    has: (t, k) => typeof k === 'string' && !GLOBAL_OK.has(k),
    get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : makeStub()))
  });
  const consts = [
    (RENDERER.match(/^const DB_RESTART_TOLERANCE_MS = .*$/m) || [''])[0],
    (RENDERER.match(/^const LIST_RESET_LINKED_MESSAGE = .*$/m) || [''])[0],
    (RENDERER.match(/^const LIST_RESET_SAVE_FAILED_MESSAGE = .*$/m) || [''])[0],
    (RENDERER.match(/^const LIST_RESET_BUSY_MESSAGE = .*$/m) || [''])[0],
    (RENDERER.match(/^const LIST_RESET_IN_PROGRESS_MESSAGE = .*$/m) || [''])[0],
    (RENDERER.match(/^const TOURNAMENT_SWITCH_BUSY_MESSAGE = .*$/m) || [''])[0]
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
    // 実 renderStaticInfo（集約点）経由で人数 0 が店舗側（この大会宛て）へ送られる
    assert.equal(box.runtimes.length, 1);
    assert.equal(box.runtimes[0].tournamentId, 'T-A');
    assert.equal(box.runtimes[0].runtime.players_initial, 0);
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
  await test('L5c（codex A-2）: 表示中の連携大会 A のリセットは待たずに一度で行い、A の値と A 宛ての送信が一致（途中で B へ切り替わってもずれない）', async () => {
    const op = await pausedAt20();
    const box = sends();
    // T-A は連携 ON（resetEnv の既定 getStatus）。保存の待ちの間に表示中が T-B へ切り替わる
    const { env, calls } = resetEnv(box, classRec(), { _onSetTimerState: (e) => { e.tournamentState.id = 'T-B'; } });
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-A', '大会A');
    // A のリセットは切替前に完了: 人数 0・時計 idle・店舗側 A へ idle と人数 0
    assert.deepEqual(r.env.tournamentRuntime, { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 });
    assert.equal(op.state.getState().status, op.state.States.IDLE);
    assert.ok(box.records.length >= 1 && box.records.every((x) => x.tournamentId === 'T-A' && x.record.status === 'idle'), JSON.stringify(box.records));
    assert.ok(box.runtimes.length === 1 && box.runtimes[0].tournamentId === 'T-A' && box.runtimes[0].runtime.players_remaining === 0);
    // 裏の大会としてのローカルだけの保存（setRuntime / save）は行わない
    assert.equal(calls.setRuntime.length + calls.save.length, 0);
    assert.deepEqual(calls.setTimerState.map((c) => c[0]), ['T-A']);
  });
  await test('L5d（codex A-2）: 押した時は表示中の連携大会 A でも、連携確認の待ちの間に A が裏へ回ったら何も書き換えない', async () => {
    const op = await pausedAt20();
    const box = sends();
    const { env, calls } = resetEnv(box, classRec());
    env.window.api.dblink.getStatus = async () => { env.tournamentState.id = 'T-B'; return { configured: true, links: { 'T-A': { id: 'DB-A' } } }; };
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-A', '大会A');
    assert.equal(calls.alerts.length, 1);
    assert.match(calls.alerts[0], /店舗連携中の大会は/);
    assert.equal(calls.setTimerState.length + calls.setRuntime.length + calls.save.length + calls.tset.length, 0);
    assert.equal(box.records.length + box.runtimes.length, 0);
    assert.equal(r.env.tournamentRuntime.playersRemaining, 8);
  });
  await test('L5e（codex A-2）: 大会切替中はリセットを受け付けない／裏の大会のリセット保存中は切替・新規・複製・削除を受け付けない', async () => {
    const op = await pausedAt20();
    for (const busy of [{ _dbLinkSwitchHoldId: 'T-B' }, { _tournamentSwitching: true }, { _tournamentDeleteInFlight: true }]) {
      const { env, calls } = resetEnv(sends(), classRec(), busy);
      const r = buildRenderer(op, { extra: env });
      await r.handleTournamentListReset('T-A', '大会A');
      assert.equal(calls.alerts.length, 1, JSON.stringify(busy));
      assert.match(calls.alerts[0], /切り替え中です/);
      assert.equal(calls.confirms.length, 0, '確認ダイアログより前に断る');
      assert.equal(calls.setTimerState.length + calls.setRuntime.length + calls.save.length, 0);
    }
    // 確認ダイアログの間に切替が始まった場合も、書き換えずに断る（確認後の再判定）
    {
      const { env, calls } = resetEnv(sends(), classRec());
      const r0 = buildRenderer(op, { extra: env });
      r0.env.window.confirm = (m) => { calls.confirms.push(m); r0.env._tournamentSwitching = true; return true; };
      await r0.handleTournamentListReset('T-A', '大会A');
      assert.equal(calls.alerts.length, 1); assert.match(calls.alerts[0], /切り替え中です/);
      assert.equal(calls.setTimerState.length + calls.setRuntime.length + calls.save.length + calls.tset.length, 0);
      assert.equal(r0.env.tournamentRuntime.playersRemaining, 8);
    }
    // 確認ダイアログの間に連携大会 A が裏へ回った場合も、書き換えずに断る
    {
      const { env, calls } = resetEnv(sends(), classRec());
      const r0 = buildRenderer(op, { extra: env });
      r0.env.window.confirm = (m) => { calls.confirms.push(m); r0.env.tournamentState.id = 'T-B'; return true; };
      await r0.handleTournamentListReset('T-A', '大会A');
      assert.equal(calls.alerts.length, 1); assert.match(calls.alerts[0], /店舗連携中の大会は/);
      assert.equal(calls.setTimerState.length + calls.setRuntime.length + calls.save.length + calls.tset.length, 0);
    }
    // 裏の大会の保存中は切替を受け付けない（実 handleTournamentSelectChange・プルダウンは現在の大会に戻す）
    let release;
    const gate = new Promise((res) => { release = res; });
    const { env, calls } = resetEnv(sends(), classRec(), { _status: { configured: true, links: {} } });
    env.window.api.tournaments.setTimerState = async (id, ts) => { calls.setTimerState.push([id, ts]); await gate; return { ok: true }; };
    let setActiveCalls = 0;
    env.window.api.tournaments.setActive = async () => { setActiveCalls++; return null; };
    env.el.tournamentSelect = { value: 'T-B' };
    env.confirmDiscardBlindsDirtyIfNeeded = async () => true;   // 切替の前段は素通しにして、一覧リセット中の拒否だけを見る
    env.isPayoutsValid = () => true;
    env.readTournamentForm = () => ({});
    const r = buildRenderer(op, { extra: env });
    const p = r.handleTournamentListReset('T-B', '大会B');
    await new Promise((res) => setTimeout(res, 5));
    assert.equal(r.env._listResetInFlight, true);
    await r.handleTournamentSelectChange();
    assert.equal(setActiveCalls, 0, '切替しない');
    assert.equal(r.env.el.tournamentSelect.value, 'T-A', 'プルダウンを現在の大会へ戻す');
    assert.match(calls.alerts[calls.alerts.length - 1], /大会のリセットを保存中です/, '黙って無視せず案内');
    for (const n of ['handleTournamentNew', 'handleTournamentDuplicate', 'handleTournamentRowDelete']) {
      assert.match(src(n), /if \(_listResetInFlight\) \{ window\.alert\(LIST_RESET_IN_PROGRESS_MESSAGE\); return; \}/, `${n} が一覧リセット中を案内つきで拒否`);
    }
    release(); await p;
    assert.equal(r.env._listResetInFlight, false);
    assert.equal(calls.setRuntime.length, 1);
  });
  await test('L5f（codex A-2 是正）: 切替の前段の待ち（未保存確認）の間に一覧リセットが始まったら、active 切替の直前で止める', async () => {
    const op = await pausedAt20();
    const { env, calls } = resetEnv(sends(), classRec());
    let setActiveCalls = 0;
    env.window.api.tournaments.setActive = async () => { setActiveCalls++; return null; };
    env.el.tournamentSelect = { value: 'T-B' };
    env.isPayoutsValid = () => true;
    env.readTournamentForm = () => ({});
    const r = buildRenderer(op, { extra: env });
    r.env.confirmDiscardBlindsDirtyIfNeeded = async () => { r.env._listResetInFlight = true; return true; };   // 待ちの間に一覧リセットが始まる
    await r.handleTournamentSelectChange();
    assert.equal(setActiveCalls, 0);
    assert.equal(r.env.el.tournamentSelect.value, 'T-A');
    assert.match(calls.alerts[0], /大会のリセットを保存中です/);
  });
  await test('L5g（codex A-2 是正）: 未連携の表示中の大会 A のリセット中に B へ切り替わっても、B の人数・時計には触れない', async () => {
    const op = await pausedAt20();
    const box = sends();
    const bRuntime = { playersInitial: 7, playersRemaining: 6, reentryCount: 1, addOnCount: 0 };
    const { env, calls } = resetEnv(box, classRec(), {
      _status: { configured: true, links: {} },
      // A の時計保存（表示中のリセットの最後）を待つ間に B へ切替: 表示中の id と人数を B の値に入れ替える
      _onSetTimerState: (e) => { e.tournamentState.id = 'T-B'; Object.assign(e.tournamentRuntime, bRuntime); }
    });
    const r = buildRenderer(op, { extra: env });
    await r.handleTournamentListReset('T-A', '大会A');
    assert.deepEqual(r.env.tournamentRuntime, bRuntime, '切替後の B の人数はそのまま');
    assert.equal(calls.setRuntime.length + calls.save.length, 0, 'A を裏の大会として保存し直さない');
    assert.deepEqual(calls.setTimerState.map((c) => c[0]), ['T-A']);
    const persistBefore = calls.persist;
    await new Promise((res) => setTimeout(res, 5));
    assert.equal(calls.persist, persistBefore, 'リセット完了後に B の人数を保存し直さない');
  });
  await test('A1-g（codex A-1 是正）: 切替完了時、送信ゲートが同じ宛先の同期を予約済みなら重ねて同期しない（probe 1 回）', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    const env = switchEnv(box, { linkedB: true, opsLog: ops });
    const r = buildRenderer(op, { extra: env });
    env.__applyTournament = r.applyTournament;
    // 切替中の印を外した直後に、applyTournament が出したゲート更新が先に完了する順序を再現（印なしで宛先変更→予約）
    r.env.loadTournamentIntoForm = async (id) => { ops.push('loadForm'); r.applyTournament({ id, name: 'B', runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 } }); };
    const origFinish = r.finishDbLinkSwitch;
    r.env.tournamentState.id = 'T-A';
    // ゲートを先に B へ（印なし）→ 予約、その後 finishDbLinkSwitch を呼ぶ
    r.env.tournamentState.id = 'T-B';
    r.applyDbLinkSendGate({ configured: true, links: { 'T-A': { id: 'DB-A' }, 'T-B': { id: 'DB-B' } } });
    assert.equal(r.env._dbLinkActivationScheduledFor, 'T-B');
    await origFinish('T-B');
    await new Promise((res) => setTimeout(res, 5));
    assert.deepEqual(ops.filter((o) => o.startsWith('probe')), ['probe:T-B'], JSON.stringify(ops));
  });

  // ============================================================
  // codex 段階A A-1: 大会切替の実順序（applyTournament → renderStaticInfo → 送信）で宛先が値の持ち主と一致
  // ============================================================
  function switchEnv(box, { linkedB, opsLog, lastSentZero = false, probeGate = null, presetGate = null }) {
    const store = {
      'T-A': { id: 'T-A', name: 'A', blindPresetId: 'P', runtime: { playersInitial: 10, playersRemaining: 8, reentryCount: 3, addOnCount: 2 },
        timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: 1 } },
      'T-B': { id: 'T-B', name: 'B', blindPresetId: 'P', runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 },
        timerState: { status: 'paused', currentLevel: 2, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: 1 } }
    };
    const links = { 'T-A': { id: 'DB-A' } };
    if (linkedB) links['T-B'] = { id: 'DB-B' };
    const env = linkExtra(box, {
      schedulePersistRuntime: () => {}, updateOperatorPane: () => {}, renderTournamentListWithDedup: async () => {},
      isUserTypingInInput: () => false, isPayoutsValid: () => true, confirmDiscardBlindsDirtyIfNeeded: async () => true,
      readTournamentForm: () => ({}), _tournamentsListDedup: async () => JSON.parse(JSON.stringify(Object.values(store))),
      loadPresetById: async (pid) => { if (presetGate) await presetGate(pid); return struct([20, 20]); }, blindPresetCache: new Map(),
      el: { ...classRec().el, tournamentSelect: { value: 'T-B' } },
      // A で最後に送った人数（codex の再現条件）。lastSentZero=true は「B と同じ値の控え」で初回送信落ちを見る用
      _dbLinkLastRuntimeJson: lastSentZero
        ? JSON.stringify({ players_initial: 0, players_remaining: 0, reentry_count: 0, addon_count: 0, special_count: 0, special_enabled: false })
        : JSON.stringify({ players_initial: 10, players_remaining: 8, reentry_count: 3, addon_count: 2, special_count: 0, special_enabled: false })
    });
    env.tournamentState = { id: 'T-A', specialStack: { enabled: false } };
    env.tournamentRuntime = { ...store['T-A'].runtime };
    env.window.api.tournaments = {
      setTimerState: async () => ({ ok: true }), save: async () => ({ ok: true }),
      setActive: async (id) => { opsLog.push('setActive'); return JSON.parse(JSON.stringify(store[id])); }
    };
    env.loadTournamentIntoForm = async (id) => { opsLog.push('loadForm'); env.__applyTournament(JSON.parse(JSON.stringify(store[id]))); };
    env.window.api.dblink.getStatus = async () => ({ configured: true, links });
    env.window.api.dblink.probe = async ({ tournamentId }) => {
      opsLog.push(`probe:${tournamentId}`);
      if (probeGate) await probeGate;
      // 保存値（B: Lv2・残り 15 分）と区別できるよう、DB 側は残り 12 分
      return { ok: true, clock: { status: 'paused', current_level_index: 1, paused_remaining_ms: 12 * MIN, end_at_ms: null,
        players_initial: 30, players_remaining: 25, reentry_count: 4, addon_count: 1 } };
    };
    return env;
  }
  // 送信の宛先と内容の持ち主を照合: A 宛てに B の人数(0)が載っていないこと
  const sentRuntimeTo = (box, id) => box.runtimes.filter((x) => x.tournamentId === id).map((x) => x.runtime);

  await test('A1-a（codex A-1）: 連携 A（人数あり）→ 未連携 B（人数 0）の切替で、B の人数・時計を A 宛てに送らない（実 applyTournament→renderStaticInfo→送信）', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    const env = switchEnv(box, { linkedB: false, opsLog: ops });
    const r = buildRenderer(op, { extra: env });
    env.__applyTournament = r.applyTournament;
    await r.handleTournamentSelectChange();
    await new Promise((res) => setTimeout(res, 5));
    assert.equal(r.env.tournamentState.id, 'T-B');
    assert.equal(r.env._dbLinkSend.active, false, 'B は未連携');
    assert.deepEqual(sentRuntimeTo(box, 'T-A'), [], `A 宛ての人数送信なし: ${JSON.stringify(box.runtimes)}`);
    assert.deepEqual(box.records.filter((x) => x.tournamentId === 'T-A'), [], 'A 宛ての時計送信なし');
    assert.ok(!ops.some((o) => o.startsWith('probe')), '未連携 B では同期しない');
    // codex r2 F2: 同期で隠せない条件で、時計が B の保存値（Lv2・残り 15 分・一時停止）へ実際に復元されている
    const s = op.state.getState();
    assert.equal(s.status, op.state.States.PAUSED);
    assert.equal(s.currentLevelIndex, 1); near(s.remainingMs, 15 * MIN, 'B の保存値', 2000);
  });
  await test('A1-b（codex A-1）: 連携 A → 連携 B の切替で、切替中は送らず、時計の復元後に B を DB に同期し、以後の送信は B 宛て（初回送信が重複扱いで落ちない）', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    let releaseProbe; const probeGate = new Promise((res) => { releaseProbe = res; });
    const env = switchEnv(box, { linkedB: true, opsLog: ops, lastSentZero: true, probeGate });
    const r = buildRenderer(op, { extra: env });
    env.__applyTournament = r.applyTournament;
    await r.handleTournamentSelectChange();
    // codex r2 F2: DB の応答を適用する前に、B の保存値（Lv2・残り 15 分・一時停止）へ実際に復元済み
    assert.deepEqual(ops.filter((o) => o.startsWith('probe')), ['probe:T-B'], '同期は開始済み（応答待ち）');
    const restored = op.state.getState();
    assert.equal(restored.status, op.state.States.PAUSED);
    assert.equal(restored.currentLevelIndex, 1); near(restored.remainingMs, 15 * MIN, '復元済み（DB 適用前）', 2000);
    releaseProbe();
    await new Promise((res) => setTimeout(res, 5));
    assert.deepEqual(sentRuntimeTo(box, 'T-A'), [], 'A 宛てに B の人数を送らない');
    assert.deepEqual(box.records.filter((x) => x.tournamentId === 'T-A'), [], 'A 宛てに時計を送らない');
    assert.equal(r.env._dbLinkSend.pcId, 'T-B');
    assert.equal(r.env._dbLinkSwitchHoldId, '', '切替中の印は解除');
    // 同期（probe）は時計の復元（loadForm の後）より後に 1 回だけ
    assert.deepEqual(ops.filter((o) => o.startsWith('probe')), ['probe:T-B']);
    assert.ok(ops.indexOf('probe:T-B') > ops.indexOf('loadForm'));
    // DB（B の行）に従う: Lv2・残り 12 分（保存値 15 分から追従）・一時停止、人数は DB の値
    const s = op.state.getState();
    assert.equal(s.currentLevelIndex, 1); near(s.remainingMs, 12 * MIN, 'DB へ追従', 2000);
    assert.equal(r.env.tournamentRuntime.playersRemaining, 25);
    // 以後の人数変更は B 宛て。直前の A の送信控えと同じ値でも落ちない
    const before = box.runtimes.length;
    r.env.tournamentRuntime.playersInitial = 0; r.env.tournamentRuntime.playersRemaining = 0;
    r.env.tournamentRuntime.reentryCount = 0; r.env.tournamentRuntime.addOnCount = 0;
    r.publishDbLinkRuntime();
    const after = box.runtimes.slice(before);
    assert.equal(after.length, 1, '初回送信が重複扱いで落ちない');
    assert.equal(after[0].tournamentId, 'T-B');
  });
  await test('F1-a（codex r2）: A→B の切替の途中（B の復元待ち）で A を選び直しても、2 つ目の切替は始めず、B の切替が最後まで保護される', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    let releasePreset; const presetBlock = new Promise((res) => { releasePreset = res; });
    const env = switchEnv(box, { linkedB: true, opsLog: ops, presetGate: () => presetBlock });
    const r = buildRenderer(op, { extra: env });
    env.__applyTournament = r.applyTournament;
    const alerts = []; r.env.window.alert = (m) => alerts.push(m);
    const writes = [];
    r.env.window.api.tournaments.setTimerState = async (id) => { writes.push(['setTimerState', id]); return { ok: true }; };
    r.env.window.api.tournaments.save = async (t) => { writes.push(['save', t && t.id]); return { ok: true }; };
    const s1 = r.handleTournamentSelectChange();               // A → B（B の復元のプリセット取得で止まる）
    await new Promise((res) => setTimeout(res, 5));
    assert.equal(r.env.tournamentState.id, 'T-B'); assert.equal(r.env._dbLinkSwitchHoldId, 'T-B');
    r.env.el.tournamentSelect.value = 'T-A';
    await r.handleTournamentSelectChange();                    // 途中で A を選び直す
    assert.equal(ops.filter((o) => o === 'setActive').length, 1, '2 つ目の切替は始めない');
    assert.match(alerts[0], /大会の切り替え中です/);
    assert.equal(r.env.el.tournamentSelect.value, 'T-B', 'プルダウンは表示中の大会（B）へ戻す');
    assert.equal(r.env._dbLinkSwitchHoldId, 'T-B', 'B の切替中の印は保たれる');
    // 復元途中は一覧リセットも割り込まない
    const before = { st: JSON.stringify(op.state.getState()) };
    await r.handleTournamentListReset('T-B', '大会B');
    assert.match(alerts[alerts.length - 1], /大会の切り替え中です/);
    assert.equal(JSON.stringify(op.state.getState()), before.st);
    releasePreset(); await s1;
    await new Promise((res) => setTimeout(res, 5));
    // B の切替が完了: 表示中 B・時計は DB(B) へ追従・送信は B 宛てのみ・印は解除・次の切替を受け付ける
    assert.equal(r.env.tournamentState.id, 'T-B');
    assert.equal(r.env._dbLinkSwitchHoldId, ''); assert.equal(r.env._tournamentSelectInFlight, false);
    const s = op.state.getState();
    assert.equal(s.currentLevelIndex, 1); near(s.remainingMs, 12 * MIN, '', 2000);
    assert.ok([...box.records, ...box.runtimes].every((x) => x.tournamentId === 'T-B'), JSON.stringify([...box.records, ...box.runtimes]));
    assert.deepEqual(ops.filter((o) => o.startsWith('probe')), ['probe:T-B']);
    // 保存先: 切替前の A の時計・フォームの保存だけ（2 つ目の切替・一覧リセットは何も書かない）
    assert.deepEqual(writes, [['setTimerState', 'T-A'], ['save', 'T-A']], JSON.stringify(writes));
  });
  await test('F1-b（codex r2）: 完了順が逆転しても古い復元は当てない — 遅れて終わった A の復元（スリープ復帰の再同期など）は、表示中が B なら構造・時計とも適用しない', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    let releaseA; const blockA = new Promise((res) => { releaseA = res; });
    const env = switchEnv(box, { linkedB: true, opsLog: ops });
    const r = buildRenderer(op, { extra: env });
    env.__applyTournament = r.applyTournament;
    // A は 30 分構造（プリセット PA）、B は 20 分構造（P）。A のプリセット取得だけを待たせる
    const list = [
      { id: 'T-A', name: 'A', blindPresetId: 'PA', timerState: { status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: null, pausedAt: 1 } },
      { id: 'T-B', name: 'B', blindPresetId: 'P', runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 },
        timerState: { status: 'paused', currentLevel: 2, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: 1 } }
    ];
    r.env._tournamentsListDedup = async () => JSON.parse(JSON.stringify(list));
    r.env.loadPresetById = async (pid) => { if (pid === 'PA') { await blockA; return struct([30, 30]); } return struct([20, 20]); };
    r.applyTournament({ id: 'T-A', name: 'A' });               // 表示中 A（連番を A に合わせる）
    const logs = []; r.env.window.api.log.write = (k, v) => logs.push(k);
    const restoreA = r.restoreActiveTimerStateFromStore('T-A', { silent: true });   // A の復元（プリセット取得で待つ）
    await new Promise((res) => setTimeout(res, 5));
    await r.handleTournamentSelectChange();                    // その間に B への切替が完了（B の復元が先に終わる）
    await new Promise((res) => setTimeout(res, 5));
    const afterB = JSON.stringify(op.state.getState());
    releaseA(); await restoreA;                                  // A の復元が後から終わる
    assert.equal(op.blinds.getLevel(0).durationMinutes, 20, '構造は B のまま（A の 30 分構造を当てない）');
    assert.equal(JSON.stringify(op.state.getState()), afterB, '時計は B のまま（A の保存値を当てない）');
    assert.ok(logs.includes('timer:restore:stale-skip'));
    assert.equal(r.env.tournamentState.id, 'T-B');
  });
  await test('F1-b2（codex r2）: ブラインド構造の指定が無い大会でも、遅れて終わった古い復元は時計を当てない（時計適用直前の照合）', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    let releaseA; const blockA = new Promise((res) => { releaseA = res; });
    const env = switchEnv(box, { linkedB: true, opsLog: ops });
    const r = buildRenderer(op, { extra: env });
    env.__applyTournament = r.applyTournament;
    const list = [
      { id: 'T-A', name: 'A', timerState: { status: 'running', currentLevel: 1, elapsedSecondsInLevel: 0, startedAt: Date.now(), pausedAt: null } },
      { id: 'T-B', name: 'B', blindPresetId: 'P', runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 },
        timerState: { status: 'paused', currentLevel: 2, elapsedSecondsInLevel: 300, startedAt: null, pausedAt: 1 } }
    ];
    let blockNextList = true;
    r.env._tournamentsListDedup = async () => { if (blockNextList) { blockNextList = false; await blockA; } return JSON.parse(JSON.stringify(list)); };
    r.applyTournament({ id: 'T-A', name: 'A' });
    const logs = []; r.env.window.api.log.write = (k, v) => logs.push(k);
    const restoreA = r.restoreActiveTimerStateFromStore('T-A', { silent: true });   // A の復元（一覧の取得で待つ・構造指定なし）
    await new Promise((res) => setTimeout(res, 5));
    await r.handleTournamentSelectChange();
    await new Promise((res) => setTimeout(res, 5));
    const afterB = JSON.stringify(op.state.getState());
    releaseA(); await restoreA;
    assert.equal(JSON.stringify(op.state.getState()), afterB, '時計は B のまま（A の running を当てない）');
    assert.ok(logs.includes('timer:restore:stale-skip'));
  });
  await test('F1-d（codex r2）: 切替の前段（未保存確認の待ち＝切替中の印を立てる前）でも、次の切替・一覧リセットは始めない', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    const env = switchEnv(box, { linkedB: true, opsLog: ops });
    let releaseConfirm; const confirmBlock = new Promise((res) => { releaseConfirm = res; });
    env.confirmDiscardBlindsDirtyIfNeeded = async () => { ops.push('confirm'); await confirmBlock; return true; };
    const r = buildRenderer(op, { extra: env });
    env.__applyTournament = r.applyTournament;
    const alerts = []; r.env.window.alert = (m) => alerts.push(m);
    const s1 = r.handleTournamentSelectChange();               // A → B（未保存確認で待つ）
    await new Promise((res) => setTimeout(res, 5));
    assert.equal(r.env._dbLinkSwitchHoldId, '', 'まだ切替中の印は立っていない区間');
    assert.equal(r.env.tournamentState.id, 'T-A', '表示中はまだ A');
    r.env.el.tournamentSelect.value = 'T-C';                    // 別の大会を選ぶ（A の選び直しは「同じ大会」として何もしない）
    await r.handleTournamentSelectChange();
    assert.equal(ops.filter((o) => o === 'confirm').length, 1, '2 つ目の切替は確認にも進まない');
    assert.match(alerts[0], /大会の切り替え中です/);
    await r.handleTournamentListReset('T-A', '大会A');
    assert.match(alerts[alerts.length - 1], /大会の切り替え中です/);
    r.env.el.tournamentSelect.value = 'T-B';
    releaseConfirm(); await s1;
    await new Promise((res) => setTimeout(res, 5));
    assert.equal(r.env.tournamentState.id, 'T-B');
    assert.equal(ops.filter((o) => o === 'setActive').length, 1);
    assert.equal(r.env._tournamentSelectInFlight, false);
  });
  await test('F1-c（codex r2）: 切替の実行中は新規・複製・削除を始めない（案内つき）', () => {
    for (const n of ['handleTournamentNew', 'handleTournamentDuplicate', 'handleTournamentRowDelete']) {
      assert.match(src(n), /if \(isTournamentSwitchBusy\(\)\) \{ window\.alert\(TOURNAMENT_SWITCH_BUSY_MESSAGE\); return; \}/, n);
    }
    assert.match(src('isTournamentSwitchBusy'), /_tournamentSelectInFlight \|\| _dbLinkSwitchHoldId/);
  });
  await test('A1-c（codex A-1）: 切替中（表示中は B・時計エンジンは A の状態）に A の時計がレベル変化しても、B 宛てにも A 宛てにも送らない', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([20, 20]));
    op.timer.startAtLevel(0); op.timer.pause();
    const box = sends(); const ops = [];
    const env = switchEnv(box, { linkedB: true, opsLog: ops });
    const r = buildRenderer(op, { extra: env });
    env.__applyTournament = r.applyTournament;
    env.loadTournamentIntoForm = async (id) => {
      env.__applyTournament(JSON.parse(JSON.stringify({ id, name: 'B', runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 } })));
      await r.refreshDbLinkSendState();      // ゲートは B に更新済み
      op.timer.startAtLevel(1);               // エンジン（A の状態）が切替中にレベル変化 → 購読経路の送信相当
      r.publishDbLinkClock();
    };
    await r.handleTournamentSelectChange();
    assert.deepEqual(box.records.filter((x) => x.tournamentId === 'T-A'), []);
    const toB = box.records.filter((x) => x.tournamentId === 'T-B');
    assert.ok(toB.every((x) => ops.indexOf('probe:T-B') >= 0), '切替中の B 宛て送信なし（同期後のみ）');
    assert.equal(toB.length, 0, JSON.stringify(toB));
  });
  await test('A1-e（codex A-1）: 切替中の印が無い経路（新規・複製・削除・起動）でも、表示中の大会と送信先が違えば時計・人数を送らない', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    const env = switchEnv(box, { linkedB: false, opsLog: ops });
    const r = buildRenderer(op, { extra: env });
    // 新規・複製の流れ: applyTournament(新しい大会・人数 0) → timerReset（ゲート更新は非同期で後から）
    r.applyTournament({ id: 'T-NEW', name: 'N', runtime: { playersInitial: 0, playersRemaining: 0, reentryCount: 0, addOnCount: 0 } });
    op.timer.reset();
    r.publishDbLinkClock();
    r.publishDbLinkRuntime(true);
    assert.equal(r.env._dbLinkSend.pcId, 'T-A', 'この時点ではゲートはまだ A');
    assert.deepEqual(box.records, [], JSON.stringify(box.records));
    assert.deepEqual(box.runtimes, [], JSON.stringify(box.runtimes));
  });
  await test('A1-f（codex A-1）: 連携 ON の大会どうしでゲートの宛先が変わったら、送信控えを捨てて同期を予約（切替中の印が無い経路）', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    const env = switchEnv(box, { linkedB: true, opsLog: ops });
    const r = buildRenderer(op, { extra: env });
    r.env._dbLinkLastRuntimeJson = 'A の控え'; r.env._dbLinkLastDisplayJson = 'A の控え';
    r.env.tournamentState.id = 'T-B';
    r.applyDbLinkSendGate({ configured: true, links: { 'T-A': { id: 'DB-A' }, 'T-B': { id: 'DB-B' } } });
    assert.equal(r.env._dbLinkSend.pcId, 'T-B');
    assert.equal(r.env._dbLinkLastRuntimeJson, '');
    assert.equal(r.env._dbLinkLastDisplayJson, '');
    await new Promise((res) => setTimeout(res, 5));
    assert.deepEqual(ops.filter((o) => o.startsWith('probe')), ['probe:T-B'], '同期を予約して実行');
    // 切替中の印がある間は予約しない（切替処理が復元後に呼ぶ）
    const ops2 = [];
    const env2 = switchEnv(sends(), { linkedB: true, opsLog: ops2 });
    const r2 = buildRenderer(op, { extra: { ...env2, _dbLinkSwitchHoldId: 'T-B' } });
    r2.env.tournamentState.id = 'T-B';
    r2.applyDbLinkSendGate({ configured: true, links: { 'T-A': { id: 'DB-A' }, 'T-B': { id: 'DB-B' } } });
    await new Promise((res) => setTimeout(res, 5));
    assert.deepEqual(ops2.filter((o) => o.startsWith('probe')), []);
  });
  await test('A1-d（codex A-1）: R3-5 は維持 — 完走状態の B へ切替後の同期で、DB が idle なら完走を B 宛てに再送', async () => {
    const op = await pausedAt20();
    const box = sends(); const ops = [];
    const env = switchEnv(box, { linkedB: true, opsLog: ops });
    env.window.api.dblink.probe = async () => { ops.push('probe'); return { ok: true, clock: { status: 'idle', current_level_index: 0, end_at_ms: null, paused_remaining_ms: null,
      players_initial: 0, players_remaining: 0, reentry_count: 0, addon_count: 0 } }; };
    const r = buildRenderer(op, { extra: env });
    env.__applyTournament = r.applyTournament;
    r.env._tournamentsListDedup = async () => [{ id: 'T-B', blindPresetId: 'P', timerState: { status: 'finished', currentLevel: 2, elapsedSecondsInLevel: 1200, startedAt: null, pausedAt: null } }];
    await r.handleTournamentSelectChange();
    await new Promise((res) => setTimeout(res, 5));
    const toB = box.records.filter((x) => x.tournamentId === 'T-B');
    assert.equal(toB.length, 1, JSON.stringify(box.records));
    assert.equal(toB[0].record.status, 'finished');
    assert.deepEqual(box.records.filter((x) => x.tournamentId === 'T-A'), []);
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
