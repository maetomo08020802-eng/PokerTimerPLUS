/**
 * 段階B（codex R3-2・B-2=PC 側）回帰テスト: 時計行の「現レベルの全体時間」（level_total_ms）
 *
 *   店舗アプリ（customer-app 案件333・migration 0202）が時計行に level_total_ms を持つようになったので、
 *   PC は ①進行中・一時停止中は毎回その値を送り ②DB の値があれば推定（±1.5 秒）をやめてその長さで現レベルを再現する。
 *   値が無い（NULL=旧データ・旧 PC）時は従来の推定のまま（後方互換）。
 *
 *   実 timer.js / state.js / blinds.js / clock-payload.mjs / db-link.js と renderer.js の実関数を結線する
 *   （ハーネスは tests/stageA-r3-345-list-reset.test.js と同一方式）。
 *
 *   実行: node tests/stageB-r3-2-level-total.test.js
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `stageB-r3-2-${process.pid}-${_seq++}-`));
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

const NAMES = ['isEngineFinishedState', 'isDbLinkOriginCurrent', 'decideDbLevelStartTotalMs', 'applyDbToEngine',
  '_dbLinkSendTargetOk', 'publishDbLinkClock'];

function buildRenderer(mods, extra = {}) {
  const { state, blinds, timer } = mods;
  const env = {
    window: { appRole: 'operator-solo', api: { log: { write: () => {} } } },
    States: state.States, getState: state.getState, setState: state.setState,
    getLevel: blinds.getLevel, getLevelCount: blinds.getLevelCount, isBreakLevel: blinds.isBreakLevel,
    isPreStartActive: timer.isPreStartActive, getPreStartTotalMs: () => 0,
    timerStartAtLevel: timer.startAtLevel, timerAdvanceBy: timer.advanceTimeBy, timerPause: timer.pause,
    timerResume: timer.resume, timerReset: timer.reset, timerRestorePreStart: timer.restorePreStart,
    timerCancelPreStart: timer.cancelPreStart,
    _dbLinkSend: { active: true, pcId: 'T-A', dbId: 'DB-A' }, _dbLinkGen: 1, _dbLinkApplying: false,
    _dbLinkSwitchHoldId: '', _dbLinkInstanceId: 'INST', schedulePersistRuntime: () => {},
    tournamentState: { id: 'T-A', specialStack: { enabled: false } },
    tournamentRuntime: { playersInitial: 10, playersRemaining: 8, reentryCount: 0, addOnCount: 0 },
    ...extra
  };
  const proxy = new Proxy(env, {
    has: (t, k) => typeof k === 'string' && !GLOBAL_OK.has(k),
    get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : makeStub()))
  });
  const consts = (RENDERER.match(/^const DB_RESTART_TOLERANCE_MS = .*$/m) || [''])[0];
  const body = `with (env) {\n${consts}\n${NAMES.map((n) => src(n)).join('\n')}\nreturn { ${NAMES.join(', ')} };\n}`;
  return { ...new Function('env', body)(proxy), env };
}

const MIN = 60 * 1000;
const near = (a, b, msg, tol = 100) => assert.ok(Math.abs(a - b) < tol, `${msg || ''} ${a} ≉ ${b}`);
const struct = (mins) => ({ id: 'p', name: 'p', structureType: 'BLIND', levels: mins.map((m, i) => ({ level: i + 1, sb: 100 * (i + 1), bb: 200 * (i + 1), bbAnte: 0, durationMinutes: m, isBreak: false })) });

(async () => {
  const payload = await import(pathToFileURL(path.join(ROOT, 'src', 'link', 'clock-payload.mjs')).href);
  const NOW = 1_700_000_000_000;

  // 構造のみ適用で Lv2 を旧 20 分のまま継続中（構造は 10 分）の PC
  async function lv2Kept20(remainingMs, { paused = true } = {}) {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 10, 10]));
    op.timer.startAtLevel(1, { totalMsOverride: 20 * MIN });
    if (paused) op.timer.pause();
    op.timer.advanceTimeBy(remainingMs - op.state.getState().remainingMs);
    return op;
  }
  const withBox = (extra = {}) => {
    const box = { records: [] };
    return { box, extra: { ...extra, buildRecordPayload: payload.buildRecordPayload, planClockApply: payload.planClockApply, planRuntimeApply: payload.planRuntimeApply,
      window: { appRole: 'operator-solo', api: { log: { write: () => {} }, dblink: { publishRecord: (p) => box.records.push(p) } } } } };
  };

  // ============================================================
  // 送信（PC → 店舗）
  // ============================================================
  await test('B1: buildRecordPayload — 進行中・一時停止中は level_total_ms を付け、待機・開始前・完走・不明は付けない（省略=店舗側 NULL）', () => {
    const base = { currentLevelIndex: 1, remainingMs: 5 * MIN, preStartTotalMs: 0, nowMs: NOW };
    assert.equal(payload.buildRecordPayload({ ...base, status: 'RUNNING', isPreStart: false, levelTotalMs: 20 * MIN }).level_total_ms, 1_200_000);
    assert.equal(payload.buildRecordPayload({ ...base, status: 'BREAK', isPreStart: false, levelTotalMs: 10 * MIN }).level_total_ms, 600_000);
    assert.equal(payload.buildRecordPayload({ ...base, status: 'PAUSED', isPreStart: false, levelTotalMs: 20 * MIN }).level_total_ms, 1_200_000);
    for (const p of [
      { ...base, status: 'IDLE', isPreStart: false, levelTotalMs: 20 * MIN },
      { ...base, status: 'PRE_START', isPreStart: true, preStartTotalMs: 10 * MIN, levelTotalMs: 20 * MIN },
      { ...base, status: 'PAUSED', isPreStart: true, preStartTotalMs: 10 * MIN, levelTotalMs: 20 * MIN },
      { ...base, status: 'IDLE', isPreStart: false, finished: true, remainingMs: 0, levelTotalMs: 20 * MIN },
      { ...base, status: 'RUNNING', isPreStart: false, levelTotalMs: 0 },
      { ...base, status: 'RUNNING', isPreStart: false, levelTotalMs: NaN },
      { ...base, status: 'RUNNING', isPreStart: false }
    ]) {
      const out = payload.buildRecordPayload(p);
      assert.ok(out && !('level_total_ms' in out), JSON.stringify(p));
    }
    // 小数は切り捨てて整数（店舗側の検証は 1 以上の整数）
    assert.equal(payload.buildRecordPayload({ ...base, status: 'RUNNING', isPreStart: false, levelTotalMs: 600_000.7 }).level_total_ms, 600_000);
  });
  await test('B2: publishDbLinkClock（実関数）— 構造のみ適用で旧 20 分を保った Lv2 は、送るたびに毎回 1200000 を付ける', async () => {
    const op = await lv2Kept20(15 * MIN, { paused: false });
    const { box, extra } = withBox();
    const r = buildRenderer(op, extra);
    r.publishDbLinkClock();
    op.timer.pause();
    r.publishDbLinkClock();
    assert.equal(box.records.length, 2);
    assert.deepEqual(box.records.map((x) => x.record.status), ['running', 'paused']);
    assert.ok(box.records.every((x) => x.record.level_total_ms === 1_200_000), JSON.stringify(box.records.map((x) => x.record)));
  });
  await test('B3: db-link は level_total_ms をそのまま店舗アプリの受け口 body に載せる（加工・除去しない）', async () => {
    const dbLink = require(path.join(ROOT, 'src', 'link', 'db-link.js'));
    const data = { dbLink: { url: 'https://s.example.com', storeKey: 'k', links: { 'T-A': { id: 'DB-A', name: 'A', part_label: '' } } } };
    const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
    const bodies = [];
    const fetchImpl = async (url, opts) => { bodies.push({ url: String(url), body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, clock: { updated_at: 'x' } }) }; };
    dbLink.init(store, null, { fetchImpl, notify: () => {}, delayFn: (fn) => setTimeout(fn, 0) });
    dbLink.publishRecord('T-A', payload.buildRecordPayload({ status: 'PAUSED', currentLevelIndex: 1, remainingMs: 15 * MIN, isPreStart: false, preStartTotalMs: 0, nowMs: NOW, levelTotalMs: 20 * MIN }), { pcId: 'T-A', gen: 1, inst: 'INST' });
    for (let i = 0; i < 50 && bodies.length === 0; i++) await new Promise((res) => setTimeout(res, 5));
    const rec = bodies.find((b) => b.url.endsWith('/clock/record'));
    assert.ok(rec, JSON.stringify(bodies.map((b) => b.url)));
    assert.equal(rec.body.level_total_ms, 1_200_000);
    assert.equal(rec.body.tournament_id, 'DB-A');
  });

  // ============================================================
  // 受信（店舗 → PC）: 適用プラン
  // ============================================================
  await test('B4: planClockApply — DB の level_total_ms（正の整数）をプランに載せ、NULL・不正は載せない（従来の推定へ）', () => {
    const local = { status: 'RUNNING', currentLevelIndex: 0, remainingMs: 5 * MIN, totalMs: 10 * MIN, isPreStart: false };
    const row = (lt) => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: 9 * MIN, level_total_ms: lt });
    assert.equal(payload.planClockApply(local, row(1_200_000), NOW).levelTotalMs, 1_200_000);
    for (const bad of [null, undefined, 0, -1, 1.5, '1200000']) {
      const plan = payload.planClockApply(local, row(bad), NOW);
      assert.ok(plan && plan.kind === 'level' && !('levelTotalMs' in plan), String(bad));
    }
    const run = payload.planClockApply(local, { status: 'running', current_level_index: 1, end_at_ms: NOW + 9 * MIN, level_total_ms: 600_000 }, NOW);
    assert.equal(run.levelTotalMs, 600_000);
  });
  await test('B5: planClockApply — 残り時間が許容差内でも、現レベルの全体時間が 2 秒以上違えば適用し直す（DB が NULL・同じ全体時間なら従来どおり適用しない）', () => {
    const local = { status: 'PAUSED', currentLevelIndex: 1, remainingMs: 9 * MIN, totalMs: 10 * MIN, isPreStart: false };
    const row = (lt) => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: 9 * MIN, level_total_ms: lt });
    assert.equal(payload.planClockApply(local, row(1_200_000), NOW).kind, 'level');
    assert.equal(payload.planClockApply(local, row(600_000), NOW), null);
    assert.equal(payload.planClockApply(local, row(601_000), NOW), null, '2 秒未満の差は同じとみなす');
    assert.equal(payload.planClockApply(local, row(null), NOW), null);
    assert.equal(payload.planClockApply({ ...local, totalMs: undefined }, row(1_200_000), NOW), null, 'local の全体時間が不明なら比較しない（旧呼出）');
    // 不整合な行（残り 15 分 > 全体 10 分）では DB の全体時間は採用されないため、全体時間の差だけで再適用しない（取り込みのたびの空回り防止）
    const local15 = { status: 'PAUSED', currentLevelIndex: 1, remainingMs: 15 * MIN, totalMs: 20 * MIN, isPreStart: false };
    assert.equal(payload.planClockApply(local15, { status: 'paused', current_level_index: 1, paused_remaining_ms: 15 * MIN, level_total_ms: 10 * MIN }, NOW), null);
    const run15 = { status: 'RUNNING', currentLevelIndex: 1, remainingMs: 15 * MIN, totalMs: 20 * MIN, isPreStart: false };
    assert.equal(payload.planClockApply(run15, { status: 'running', current_level_index: 1, end_at_ms: NOW + 15 * MIN, level_total_ms: 10 * MIN }, NOW), null);
  });
  await test('B6: decideDbLevelStartTotalMs — DB の全体時間があればそれを使う（構造時間と同じなら 0）。残りが全体時間を超える不整合・NULL は従来の判定', () => {
    const r = buildRenderer({ state: { States: {}, getState: () => ({}), setState: () => {} }, blinds: {}, timer: {} });
    const d = r.decideDbLevelStartTotalMs;
    const S = 10 * MIN;
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: S, remainingTargetMs: S - 500, dbLevelTotalMs: 20 * MIN }), 20 * MIN, '継続（従来は再開始と誤判定）');
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: S, remainingTargetMs: S - 3000, dbLevelTotalMs: S }), 0, '再開始・受信 3 秒遅れ（従来は継続と誤判定）');
    assert.equal(d({ sameLevel: false, localTotalMs: 10 * MIN, structTotalMs: S, remainingTargetMs: 15 * MIN, dbLevelTotalMs: 20 * MIN }), 20 * MIN, '別レベルでも DB の全体時間');
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: S, remainingTargetMs: -2 * MIN, dbLevelTotalMs: 20 * MIN }), 20 * MIN, '負（境界越え）も DB の全体時間で開始し繰越');
    // 不整合（残り > 全体時間）は使わない＝R3-1: 開始する全体時間 < 残り にしない
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: S, remainingTargetMs: 15 * MIN, dbLevelTotalMs: S }), 20 * MIN);
    assert.equal(d({ sameLevel: false, localTotalMs: 0, structTotalMs: S, remainingTargetMs: 12 * MIN, dbLevelTotalMs: S }), 12 * MIN);
    // NULL は従来どおり（R3-2 の推定）
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: S, remainingTargetMs: S - 500, dbLevelTotalMs: null }), 0, '従来: 構造時間付近は再開始扱い');
    assert.equal(d({ sameLevel: true, localTotalMs: 20 * MIN, structTotalMs: S, remainingTargetMs: S - 3000 }), 20 * MIN, '従来: 1.5 秒超は継続扱い');
  });

  // ============================================================
  // 受信（店舗 → PC）: 実エンジンへの適用（R3-2 で判別できなかった場面）
  // ============================================================
  const apply = async (op, row) => {
    const { box, extra } = withBox();
    const r = buildRenderer(op, extra);
    r.applyDbToEngine(row, { pcId: 'T-A', dbId: 'DB-A', gen: 1 });
    return { r, box, s: op.state.getState() };
  };
  await test('B7-a: 継続で残りが構造時間の 1.5 秒以内（従来は再開始と誤判定）— DB の全体時間 20 分で Lv2 のまま続く', async () => {
    const op = await lv2Kept20(15 * MIN);
    const { s } = await apply(op, { status: 'paused', current_level_index: 1, paused_remaining_ms: 10 * MIN - 500, level_total_ms: 20 * MIN });
    assert.equal(s.currentLevelIndex, 1); assert.equal(s.status, op.state.States.PAUSED);
    near(s.remainingMs, 10 * MIN - 500, '残り'); assert.equal(s.totalMs, 20 * MIN, '全体時間（ゲージ基準）は 20 分のまま');
  });
  await test('B7-b: 店舗側で新しい長さ（10 分）で開始し直した行 — 全体 10 分で開始し直す', async () => {
    const op = await lv2Kept20(15 * MIN);
    const { s } = await apply(op, { status: 'paused', current_level_index: 1, paused_remaining_ms: 10 * MIN, level_total_ms: 10 * MIN });
    assert.equal(s.currentLevelIndex, 1); near(s.remainingMs, 10 * MIN, '残り'); assert.equal(s.totalMs, 10 * MIN);
  });
  await test('B7-c: 再開始の受信が 3 秒遅れた running 行（従来は継続と誤判定）— 全体 10 分で再現', async () => {
    const op = await lv2Kept20(15 * MIN);
    const { s } = await apply(op, { status: 'running', current_level_index: 1, end_at_ms: Date.now() + 10 * MIN - 3000, level_total_ms: 10 * MIN });
    assert.equal(s.currentLevelIndex, 1); assert.equal(s.totalMs, 10 * MIN); near(s.remainingMs, 10 * MIN - 3000, '残り', 1500);
  });
  await test('B7-d: 残りは同じで全体時間だけ違う行 — 適用し直して全体時間を DB に合わせる（残りは不変）', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 10, 10]));
    op.timer.startAtLevel(1); op.timer.pause();
    op.timer.advanceTimeBy(9 * MIN - op.state.getState().remainingMs);
    const { s } = await apply(op, { status: 'paused', current_level_index: 1, paused_remaining_ms: 9 * MIN, level_total_ms: 20 * MIN });
    assert.equal(s.totalMs, 20 * MIN); near(s.remainingMs, 9 * MIN, '残り'); assert.equal(s.currentLevelIndex, 1);
  });
  await test('B7-e: DB が NULL（旧データ・旧 PC）なら従来の推定のまま（R3-1/R3-2 の既存挙動を維持）', async () => {
    const op = await lv2Kept20(15 * MIN);
    const { s } = await apply(op, { status: 'paused', current_level_index: 1, paused_remaining_ms: 10 * MIN - 500, level_total_ms: null });
    assert.equal(s.totalMs, 10 * MIN, '従来: 構造時間付近は再開始扱い'); assert.equal(s.currentLevelIndex, 1);
    const op2 = await lv2Kept20(15 * MIN);
    const { s: s2 } = await apply(op2, { status: 'paused', current_level_index: 1, paused_remaining_ms: 10 * MIN + 1000 });
    assert.equal(s2.currentLevelIndex, 1, 'R3-1: 前レベルへ戻らない'); assert.equal(s2.totalMs, 20 * MIN); near(s2.remainingMs, 10 * MIN + 1000, '残り');
  });
  await test('B7-f: 不整合な行（残り 15 分・全体 10 分）でも前レベルへ戻らない（R3-1 の保証を維持）', async () => {
    const op = await lv2Kept20(15 * MIN);
    const { s } = await apply(op, { status: 'paused', current_level_index: 1, paused_remaining_ms: 15 * MIN, level_total_ms: 10 * MIN });
    assert.equal(s.currentLevelIndex, 1); near(s.remainingMs, 15 * MIN, '残り'); assert.ok(s.totalMs >= 15 * MIN);
  });
  await test('B7-g: 範囲外のレベル番号を最終レベルへ丸めた時は、DB の全体時間（別レベルの値）を使わない', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 10]));
    op.timer.startAtLevel(0); op.timer.pause();
    const { s } = await apply(op, { status: 'paused', current_level_index: 7, paused_remaining_ms: 5 * MIN, level_total_ms: 30 * MIN });
    assert.equal(s.currentLevelIndex, 1); assert.equal(s.totalMs, 10 * MIN);
  });

  // ============================================================
  // INVARIANT・登録
  // ============================================================
  await test('B8: CLAUDE.md の INVARIANT 例外②に「現レベルの全体時間」が前原承認の注記つきで追記されている', () => {
    const md = read('CLAUDE.md');
    assert.match(md, /時計の状態（レベル・時刻・人数・現レベルの全体時間【2026-10-10 前原承認・R3-2】）/);
    assert.match(md, /時計状態\(現レベルの全体時間を含む。2026-10-10 前原承認・R3-2\)/);
  });
  await test('B9: package.json の test に本ファイルが登録されている', () => {
    assert.match(JSON.parse(read('package.json')).scripts.test, /tests\/stageB-r3-2-level-total\.test\.js/);
  });

  completed = true;
  console.log(`\nstageB-r3-2-level-total.test.js: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
})();
