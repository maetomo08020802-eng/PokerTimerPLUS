/**
 * clock-sync-structure-only（2026-10-10）回帰テスト
 *
 *   「構造のみ適用」（③c: 進行中レベルは旧時間で継続）後に、会場側（hall）の再計算・操作側の復元・
 *   停電/スリープ復帰の再計算で時計がずれる既存不具合の根治を検証する。
 *   timerState に任意フィールド levelTotalSeconds（現レベルの実際の全体秒）を追加し、現レベルに限り優先。
 *
 *   実 timer.js / state.js / blinds.js を ESM で読み込み（tmp に .mjs 複製）、renderer.js の実関数
 *   （captureCurrentTimerState / computeLiveTimerState / applyTimerStateToTimer / applyBlindsKeepProgress /
 *    _refreshDisplayAfterStructureChange 等）を抽出して実際の状態遷移を通す。
 *
 *   実行: node tests/clock-sync-structure-only.test.js
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
const TIMER    = read('src', 'renderer', 'timer.js');

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
  // 引数リストの閉じ括弧の後の { から本体
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

// requestAnimationFrame 等（timer.js のループ）をスタブ
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
// 経過時間の実測誤差を排除するため performance.now を固定（timer.js は targetTime − now で残りを計算）
Object.defineProperty(globalThis, 'performance', { value: { now: () => 1000000 }, configurable: true, writable: true });

// 実 state/blinds/timer を独立インスタンスで読み込む（operator 用 / hall 用を分離）
let _seq = 0;
async function loadModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `clock-sync-${process.pid}-${_seq++}-`));
  const fix = (s) => s.replace(/'\.\/state\.js'/g, "'./state.mjs'").replace(/'\.\/blinds\.js'/g, "'./blinds.mjs'");
  for (const f of ['state', 'blinds', 'timer']) fs.writeFileSync(path.join(dir, `${f}.mjs`), fix(read('src', 'renderer', `${f}.js`)));
  const state  = await import(pathToFileURL(path.join(dir, 'state.mjs')).href);
  const blinds = await import(pathToFileURL(path.join(dir, 'blinds.mjs')).href);
  const timer  = await import(pathToFileURL(path.join(dir, 'timer.mjs')).href);
  timer.setHandlers({ onTick: () => {}, onLevelChange: () => {}, onLevelEnd: () => {} });
  return { state, blinds, timer };
}

// 未定義の識別子は「何もしない」スタブで埋める（ログ・DOM・hall rAF 等）。値を読むものは明示 env で渡す。
function makeStub() {
  const f = function () { return undefined; };
  return new Proxy(f, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : makeStub()), set: () => true, apply: () => undefined });
}
const GLOBAL_OK = new Set(['Math', 'Number', 'JSON', 'Date', 'Array', 'Object', 'String', 'Boolean', 'Infinity', 'NaN',
  'undefined', 'console', 'isNaN', 'parseInt', 'Error', 'Promise', 'Set', 'Map', 'WeakMap', 'performance', 'Symbol']);

// renderer.js の関数群を、実モジュール（state/blinds/timer）に結線して組み立てる
function buildRenderer(mods, { role = 'operator-solo', extra = {}, extraNames = [] } = {}) {
  const { state, blinds, timer } = mods;
  const env = {
    window: { appRole: role, api: { log: { write: () => {} } } },
    States: state.States, getState: state.getState, setState: state.setState,
    getLevel: blinds.getLevel, getLevelCount: blinds.getLevelCount, isBreakLevel: blinds.isBreakLevel,
    setStructure: blinds.setStructure, getStructure: blinds.getStructure, cloneStructure: blinds.cloneStructure,
    isPreStartActive: timer.isPreStartActive, timerStartAtLevel: timer.startAtLevel, timerAdvanceBy: timer.advanceTimeBy,
    timerPause: timer.pause, timerReset: timer.reset, timerRestorePreStart: timer.restorePreStart,
    hallTickState: { rafId: null }, blindPresetCache: new Map(),
    ...extra
  };
  const proxy = new Proxy(env, {
    has: (t, k) => typeof k === 'string' && !GLOBAL_OK.has(k),
    get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : makeStub()))
  });
  const names = ['mapStateToStorageStatus', 'captureCurrentTimerState', '_liveLevelTotalMs', 'computeLiveTimerState',
    'applyTimerStateToTimer', 'applyBlindsKeepProgress', '_refreshDisplayAfterStructureChange', 'resolveGaugeMinutes', 'computeGaugeRatio', ...extraNames];
  const body = `with (env) {\n${names.map((n) => src(n)).join('\n')}\nreturn { ${names.join(', ')} };\n}`;
  return new Function('env', body)(proxy);
}

const normalizeTimerState = new Function(`const VALID_TIMER_STATUS = ['idle','running','paused','finished'];\n${src('normalizeTimerState', MAIN_JS)}\nreturn normalizeTimerState;`)();

const MIN = 60 * 1000;
// DB 行の end_at_ms は Date.now() 基準のため、テスト側と適用側の数 ms 差を許容
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 100, `${msg || ''} ${a} ≉ ${b}`);
const struct = (mins) => ({ id: 'p', name: 'p', structureType: 'BLIND', levels: mins.map((m, i) => ({ level: i + 1, sb: 100 * (i + 1), bb: 200 * (i + 1), bbAnte: 0, durationMinutes: m, isBreak: false })) });

// 操作側: 20分 Lv1 を残り15分で一時停止 → 現レベルを10分に「構造のみ適用」
async function operatorAfterApplyOnly(newMinutes = 10) {
  const mods = await loadModules();
  mods.blinds.setStructure(struct([20, 20]));
  mods.timer.startAtLevel(0);
  mods.timer.advanceTimeBy(-5 * MIN);
  mods.timer.pause();
  mods.blinds.setStructure(struct([newMinutes, 20]));   // apply-only: timer に触らない
  return mods;
}

(async () => {
  // ============================================================
  // 再現経路（DoD: 数値で）
  // ============================================================
  let savedTs;
  await test('R1: 構造のみ適用後の操作側は残り15分・全体20分（③c）、保存 timerState に levelTotalSeconds=1200', async () => {
    const op = await operatorAfterApplyOnly(10);
    const s = op.state.getState();
    assert.equal(s.remainingMs, 15 * MIN);
    assert.equal(s.totalMs, 20 * MIN);
    const r = buildRenderer(op);
    savedTs = normalizeTimerState(r.captureCurrentTimerState());   // main の保存・配信経路と同じ正規化
    assert.equal(savedTs.status, 'paused');
    assert.equal(savedTs.elapsedSecondsInLevel, 300);
    assert.equal(savedTs.levelTotalSeconds, 1200);
  });
  await test('R2: ① hall 再計算 — 受信した timerState から 残り15分（修正前の式なら 10−5=5分）', async () => {
    const hall = await loadModules();
    hall.blinds.setStructure(struct([10, 20]));
    const r = buildRenderer(hall, { role: 'hall' });
    r.applyTimerStateToTimer(savedTs, hall.blinds.getStructure().levels, { silent: true });
    assert.equal(hall.state.getState().remainingMs, 15 * MIN, 'hall の残り時間');
    assert.equal(hall.state.getState().totalMs, 20 * MIN);
    assert.equal(hall.state.getState().status, 'PAUSED');
    // 対照: フィールドが無い（修正前の保存データ）と従来の式で 5 分
    const hall2 = await loadModules();
    hall2.blinds.setStructure(struct([10, 20]));
    const { levelTotalSeconds, ...legacy } = savedTs;
    buildRenderer(hall2, { role: 'hall' }).applyTimerStateToTimer(legacy, hall2.blinds.getStructure().levels, { silent: true });
    assert.equal(hall2.state.getState().remainingMs, 5 * MIN, '対照（旧データ）は従来どおり構造時間で計算');
  });
  await test('R3: ② operator 復元（再起動/大会切替）— 残り15分・Lv1 のまま・一時停止', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 20]));
    const r = buildRenderer(op);
    const live = r.computeLiveTimerState(savedTs, op.blinds.getStructure().levels);
    r.applyTimerStateToTimer(live, op.blinds.getStructure().levels, { silent: true });
    const s = op.state.getState();
    assert.equal(s.currentLevelIndex, 0, 'レベルが変わらない');
    assert.equal(s.remainingMs, 15 * MIN);
    assert.equal(s.totalMs, 20 * MIN);
    assert.equal(s.status, 'PAUSED');
  });
  await test('R4: 残り > 新レベル時間（20→10・残り18分）でも前レベルへ繰り越さない（Lv2 で検証）', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([5, 20, 20]));
    op.timer.startAtLevel(1);
    op.timer.advanceTimeBy(-2 * MIN);
    op.timer.pause();
    op.blinds.setStructure(struct([5, 10, 20]));
    const r = buildRenderer(op);
    const ts = normalizeTimerState(r.captureCurrentTimerState());
    const op2 = await loadModules();
    op2.blinds.setStructure(struct([5, 10, 20]));
    const r2 = buildRenderer(op2);
    r2.applyTimerStateToTimer(r2.computeLiveTimerState(ts, op2.blinds.getStructure().levels), op2.blinds.getStructure().levels, { silent: true });
    assert.equal(op2.state.getState().currentLevelIndex, 1, 'Lv2 のまま（前レベルへ戻らない）');
    assert.equal(op2.state.getState().remainingMs, 18 * MIN);
  });
  await test('R5: 20→30分（長くした場合）も hall/復元とも残り15分', async () => {
    const op = await operatorAfterApplyOnly(30);
    const ts = normalizeTimerState(buildRenderer(op).captureCurrentTimerState());
    assert.equal(ts.levelTotalSeconds, 1200);
    const hall = await loadModules();
    hall.blinds.setStructure(struct([30, 20]));
    buildRenderer(hall, { role: 'hall' }).applyTimerStateToTimer(ts, hall.blinds.getStructure().levels, { silent: true });
    assert.equal(hall.state.getState().remainingMs, 15 * MIN);
  });
  await test('R6: 再開後に次レベルへ進むと次レベルは新しい構造時間（levelTotalSeconds は付かない）', async () => {
    const op = await operatorAfterApplyOnly(10);
    op.timer.resume();
    op.timer.advanceTimeBy(-15 * MIN);           // 現レベル（旧20分）を使い切る → Lv2
    const s = op.state.getState();
    assert.equal(s.currentLevelIndex, 1);
    assert.equal(s.totalMs, 20 * MIN);           // Lv2 は構造どおり 20 分
    const ts = buildRenderer(op).captureCurrentTimerState();
    assert.equal('levelTotalSeconds' in ts, false);
  });

  // ============================================================
  // ③ computeLiveTimerState（停電/スリープ復帰）
  // ============================================================
  await test('L1: running・現レベル内（経過710秒 < 旧1200秒）→ 構造10分でも繰り上げない・field 維持', async () => {
    const r = buildRenderer(await loadModules());
    const ts = { status: 'running', currentLevel: 1, elapsedSecondsInLevel: 650, startedAt: Date.now() - 60000, pausedAt: null, levelTotalSeconds: 1200 };
    const live = r.computeLiveTimerState(ts, struct([10, 20]).levels);
    assert.equal(live.currentLevel, 1);
    assert.equal(live.elapsedSecondsInLevel, 710);
    assert.equal(live.levelTotalSeconds, 1200);
    const legacy = r.computeLiveTimerState({ ...ts, levelTotalSeconds: undefined }, struct([10, 20]).levels);
    assert.equal(legacy.currentLevel, 2, '対照: field 無しは従来どおり構造10分で繰り上げ');
  });
  await test('L2: 現レベル（旧1200秒）を跨いだら次レベルは構造時間・field 除去', async () => {
    const r = buildRenderer(await loadModules());
    const ts = { status: 'running', currentLevel: 1, elapsedSecondsInLevel: 1190, startedAt: Date.now() - 60000, pausedAt: null, levelTotalSeconds: 1200 };
    const live = r.computeLiveTimerState(ts, struct([10, 20]).levels);
    assert.equal(live.currentLevel, 2);
    assert.equal(live.elapsedSecondsInLevel, 50);
    assert.equal('levelTotalSeconds' in live, false);
  });
  await test('L3: レベル番号がクランプされたら field を使わない（W1: 古い値が別レベルに付かない）', async () => {
    const r = buildRenderer(await loadModules());
    const ts = { status: 'running', currentLevel: 5, elapsedSecondsInLevel: 100, startedAt: Date.now(), pausedAt: null, levelTotalSeconds: 3000 };
    const live = r.computeLiveTimerState(ts, struct([10, 20]).levels);
    assert.equal(live.currentLevel, 2);
    assert.equal('levelTotalSeconds' in live, false);
    // 一時停止中（computeLive 素通り）でも apply 側の判定で採用しない
    assert.equal(r._liveLevelTotalMs({ currentLevel: 5, levelTotalSeconds: 3000 }, 1), 0);
    assert.equal(r._liveLevelTotalMs({ currentLevel: 2, levelTotalSeconds: 3000 }, 1), 3000 * 1000);
  });

  // ============================================================
  // 後方互換・正規化（main.js normalizeTimerState）
  // ============================================================
  await test('C1: 既存データ（field 無し）の正規化出力は従来と同一の形（キーを増やさない）', () => {
    const old = { status: 'paused', currentLevel: 3, elapsedSecondsInLevel: 120, startedAt: null, pausedAt: 1700000000000 };
    assert.deepEqual(normalizeTimerState(old), old);
    assert.deepEqual(Object.keys(normalizeTimerState(undefined)), ['status', 'currentLevel', 'elapsedSecondsInLevel', 'startedAt', 'pausedAt']);
  });
  await test('C2: 不正値（0/負/NaN/文字列/巨大値/null）はキー自体を出さない・有効値は整数化して保持', () => {
    for (const bad of [0, -5, NaN, '1200', 604801, null, Infinity]) {
      assert.equal('levelTotalSeconds' in normalizeTimerState({ status: 'paused', levelTotalSeconds: bad }), false, String(bad));
    }
    assert.equal(normalizeTimerState({ status: 'paused', levelTotalSeconds: 1200.7 }).levelTotalSeconds, 1200);
  });
  await test('C3: hall/復元とも 不正な field・レベル0件の構造で従来の構造時間にフォールバック', async () => {
    const hall = await loadModules();
    hall.blinds.setStructure(struct([10, 20]));
    buildRenderer(hall, { role: 'hall' }).applyTimerStateToTimer({ status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 300, levelTotalSeconds: -1 }, hall.blinds.getStructure().levels, { silent: true });
    assert.equal(hall.state.getState().remainingMs, 5 * MIN);
    const empty = await loadModules();   // 構造未ロード＝レベル0件
    const r = buildRenderer(empty);
    assert.doesNotThrow(() => r.applyTimerStateToTimer({ status: 'paused', currentLevel: 1, elapsedSecondsInLevel: 300, levelTotalSeconds: 1200 }, [], { silent: true }));
  });
  await test('C4: 保存は構造と差がある時だけ（20分構造で20分走行中は field なし＝通常運用の保存データは不変）', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([20, 20]));
    op.timer.startAtLevel(0);
    op.timer.advanceTimeBy(-5 * MIN);
    op.timer.pause();
    assert.equal('levelTotalSeconds' in buildRenderer(op).captureCurrentTimerState(), false);
  });
  await test('C5: main.js の timerState 経路はすべて normalizeTimerState を通る（移行補完/取込/既定補完/一覧/setActive/setTimerState/取込後配信/snapshot）', () => {
    const calls = (MAIN_JS.match(/normalizeTimerState\(/g) || []).length;
    assert.equal(calls, 10, `定義1+呼出9 のはず（実際 ${calls}）`);
    assert.match(MAIN_JS, /const next = \{ \.\.\.list\[idx\], timerState: normalizeTimerState\(timerState\) \};/);
  });

  // ============================================================
  // timer.js の最小拡張・F1・apply-only 保存・ゲージ
  // ============================================================
  await test('T1: startAtLevel 引数なしは従来どおり構造時間、不正な override も構造時間', async () => {
    for (const opts of [undefined, {}, { totalMsOverride: 0 }, { totalMsOverride: -1 }, { totalMsOverride: NaN }, { totalMsOverride: '600000' }]) {
      const m = await loadModules();
      m.blinds.setStructure(struct([20]));
      m.timer.startAtLevel(0, opts);
      assert.equal(m.state.getState().totalMs, 20 * MIN, JSON.stringify(opts));
      assert.equal(m.state.getState().remainingMs, 20 * MIN);
    }
    const m = await loadModules();
    m.blinds.setStructure(struct([10]));
    m.timer.startAtLevel(0, { totalMsOverride: 20 * MIN });
    assert.equal(m.state.getState().totalMs, 20 * MIN);
  });
  await test('T2: timer.js 内の startAtLevel 既存呼出は第2引数なし（挙動不変）', () => {
    const calls = TIMER.match(/startAtLevel\([^)]*\)/g) || [];
    const internal = calls.filter((c) => !/index, opts/.test(c));
    assert.ok(internal.length >= 1);
    for (const c of internal) assert.doesNotMatch(c, /,/, c);
    assert.match(RENDERER, /if \(keepTotalMs > 0\) timerStartAtLevel\(idx, \{ totalMsOverride: keepTotalMs \}\);\r?\n\s*else timerStartAtLevel\(idx\);/, 'DB→engine は同一レベル時のみ override（前原指示で本案件に含む）');
  });
  await test('F1: 「経過時間を保持して適用」は新構造の時間で再計算（20→10分・経過5分 → 残り5分）', async () => {
    const op = await operatorAfterApplyOnly(20);   // 構造は 20 のまま一時停止（残り15）
    const r = buildRenderer(op);
    await r.applyBlindsKeepProgress(struct([10, 20]));
    const s = op.state.getState();
    assert.equal(s.currentLevelIndex, 0);
    assert.equal(s.remainingMs, 5 * MIN, '経過時間保持は従来どおり新構造基準');
    assert.equal(s.totalMs, 10 * MIN);
  });
  await test('F1b: 構造のみ適用で field が付いた後に「経過時間を保持して適用」しても新構造基準（旧時間を持ち越さない）', async () => {
    const op = await operatorAfterApplyOnly(10);   // 旧20分で継続中（field 付く状態）
    const r = buildRenderer(op);
    await r.applyBlindsKeepProgress(struct([10, 20]));
    assert.equal(op.state.getState().remainingMs, 5 * MIN);
  });
  await test('P1: 構造のみ適用（非 IDLE）で保存を予約し hall へ配信（一時停止中の hall 再生成でもずれない）。開始前由来は予約しない', async () => {
    let n = 0;
    const op = await operatorAfterApplyOnly(10);
    buildRenderer(op, { extra: { schedulePersistTimerState: () => { n++; } } })._refreshDisplayAfterStructureChange();
    assert.equal(n, 1);
    let m = 0;
    buildRenderer(op, { extra: { schedulePersistTimerState: () => { m++; }, isPreStartActive: () => true } })._refreshDisplayAfterStructureChange();
    assert.equal(m, 0);
  });
  await test('G1: ゲージ一致 — 復元後の state.totalMs（20分）基準で水位0.75・丸数字20（hall も同値）', async () => {
    const op = await loadModules();
    op.blinds.setStructure(struct([10, 20]));
    const r = buildRenderer(op);
    r.applyTimerStateToTimer(r.computeLiveTimerState(savedTs, op.blinds.getStructure().levels), op.blinds.getStructure().levels, { silent: true });
    const s = op.state.getState();
    const minutes = r.resolveGaugeMinutes(s.totalMs, 10);
    assert.equal(minutes, 20);
    assert.equal(r.computeGaugeRatio(s.remainingMs, minutes), 0.75);
  });

  // ============================================================
  // DB→engine 反映（店舗アプリ連携 ON・前原指示で本案件に含む）
  // ============================================================
  async function dbApplyScenario(lvIdx, dbRow) {
    const op = await loadModules();
    const mins = [20, 20, 20];
    op.blinds.setStructure(struct(mins));
    op.timer.startAtLevel(lvIdx);
    op.timer.advanceTimeBy(-5 * MIN);
    op.timer.pause();
    mins[lvIdx] = 10;
    op.blinds.setStructure(struct(mins));                   // 構造のみ適用
    const payload = await import(pathToFileURL(path.join(ROOT, 'src', 'link', 'clock-payload.mjs')).href);
    const r = buildRenderer(op, {
      extraNames: ['applyDbToEngine', 'isDbLinkOriginCurrent', 'decideDbLevelStartTotalMs'],
      extra: { _dbLinkSend: { active: true, pcId: 'T-A', dbId: 'DB-A' }, _dbLinkGen: 1, _dbLinkApplying: false, planClockApply: payload.planClockApply,
        planRuntimeApply: () => null, tournamentState: { id: 'T-A' }, tournamentRuntime: {}, timerCancelPreStart: op.timer.cancelPreStart }
    });
    r.applyDbToEngine(dbRow(Date.now()), { pcId: 'T-A', dbId: 'DB-A', gen: 1 });
    return op.state.getState();
  }
  await test('D1: 店舗アプリ側で再開（DB=Lv2・残り15分で進行）→ PC は Lv2・残り15分（修正前は Lv1・残り5分）', async () => {
    const s = await dbApplyScenario(1, (now) => ({ status: 'running', current_level_index: 1, end_at_ms: now + 15 * MIN }));
    assert.equal(s.currentLevelIndex, 1, '前レベルへ戻らない');
    near(s.remainingMs, 15 * MIN);
    assert.equal(s.totalMs, 20 * MIN);
    assert.equal(s.status, 'RUNNING');
  });
  await test('D2: Lv1 でも同様（修正前は Lv1・残り10分）、一時停止の DB 行（paused_remaining_ms）でも残り15分', async () => {
    const s1 = await dbApplyScenario(0, (now) => ({ status: 'running', current_level_index: 0, end_at_ms: now + 15 * MIN }));
    assert.equal(s1.currentLevelIndex, 0);
    near(s1.remainingMs, 15 * MIN);
    const s2 = await dbApplyScenario(1, () => ({ status: 'paused', current_level_index: 1, paused_remaining_ms: 14 * MIN }));
    assert.equal(s2.currentLevelIndex, 1);
    assert.equal(s2.remainingMs, 14 * MIN);
    assert.equal(s2.status, 'PAUSED');
  });
  await test('D3: DB が別レベル（次の Lv3）を指す時は従来どおり構造時間で開始', async () => {
    const s = await dbApplyScenario(1, (now) => ({ status: 'running', current_level_index: 2, end_at_ms: now + 7 * MIN }));
    assert.equal(s.currentLevelIndex, 2);
    assert.equal(s.totalMs, 20 * MIN, 'Lv3 は構造の 20 分');
    near(s.remainingMs, 7 * MIN);
  });
  await test('N1: 送信系・multi・remote・dual-sync に levelTotalSeconds の出現なし（送信項目不変）', () => {
    for (const p of [['src', 'link', 'clock-payload.mjs'], ['src', 'link', 'db-link.js'], ['src', 'renderer', 'dual-sync.js']]) {
      assert.doesNotMatch(read(...p), /levelTotalSeconds|totalMsOverride/, p.join('/'));
    }
  });
  await test('N2: scripts.test に本テストが登録', () => {
    assert.match(JSON.parse(read('package.json')).scripts.test, /tests\/clock-sync-structure-only\.test\.js/);
  });

  completed = true;
  console.log(`\nclock-sync-structure-only.test.js: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
})();
