/**
 * glass-tube-gauge Codex 査定対応（2026-10-10）回帰テスト
 *
 *   ① 構造のみ適用でも水位・丸数字は「時計が使う現レベル全体時間（state.totalMs）」基準
 *   ② 完走表示中はゲージを隠す（復元経路は無改変）
 *   ③ 大会複製で複製元の gaugeMode を引き継ぐ
 *   ④ 開始前カウントダウンの一時停止中もゲージを隠す（data-prestart-format 共通判定）
 *   ⑤ 小数分の丸数字
 *   ⑥ 気泡は transform: translateX（scale 不使用）
 *
 *   実ソースの関数（renderTime / renderTimeGauge / _handleTournamentDuplicateImpl 等）を抽出し、
 *   実 state.js（getState / setState）と依存スタブで状態遷移を実際に通す。
 *
 *   実行: node tests/glass-tube-gauge-codex.test.js
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
const CSS      = read('src', 'renderer', 'style.css');
const CSS_BLOCK = CSS.slice(CSS.indexOf('/* ===== glass-tube-gauge'));

let pass = 0, fail = 0;
// 非同期テストが途中で止まったまま終了すると exit 0 で偽 PASS になるため、最後まで到達しなければ失敗にする
let completed = false;
process.on('exit', () => { if (!completed) { console.log('FAIL: テストが最後まで実行されなかった'); process.exitCode = 1; } });
const results = [];
async function test(name, fn) {
  try { await fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionSource(source, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = source.match(re);
  if (!m) return null;
  const braceStart = source.indexOf('{', m.index + m[0].length - 1 + source.slice(m.index + m[0].length - 1).indexOf(')'));
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(m.index, i + 1); }
  }
  return null;
}
function src(name) {
  const s = extractFunctionSource(RENDERER, name);
  assert.ok(s, `${name} が見つからない`);
  return s;
}

// 実 state.js を ESM として読み込む（package.json に type 指定が無いため .mjs に複製して import）
async function loadStateModule() {
  const tmp = path.join(os.tmpdir(), `gauge-state-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, read('src', 'renderer', 'state.js'));
  const mod = await import(pathToFileURL(tmp).href);
  return mod;
}

// renderTime + renderTimeGauge を実ソースから組み立てる（DOM は最小スタブ）
function buildRenderer(stateMod, levels, opts = {}) {
  const gaugeProps = {};
  const el = {
    time: { textContent: '' },
    clock: { dataset: {} },
    timeGauge: { dataset: {}, style: { setProperty: (k, v) => { gaugeProps[k] = v; } } },
    timeGaugeMinutes: { textContent: '' }
  };
  const env = {
    el, States: stateMod.States, getState: stateMod.getState,
    getLevel: (i) => levels[i] || null,
    isPreStartActive: opts.isPreStartActive || (() => false),
    formatTime: (ms) => String(Math.ceil(ms / 1000)),
    DANGER_THRESHOLD_MS: 10000, WARN_THRESHOLD_MS: 60000
  };
  const body = [
    src('classifyTimerState'), src('formatPreStartTime'), src('computeGaugeRatio'), src('formatGaugeMinutes'),
    src('resolveGaugeMinutes'), 'const _gaugeCache = { ratio: null, minutes: null, ended: null };', src('renderTimeGauge'), src('renderTime'),
    'return { renderTime };'
  ].join('\n');
  const fn = new Function(...Object.keys(env), body);
  const api = fn(...Object.values(env));
  return { ...api, el, gaugeProps };
}

const MIN = 60 * 1000;

(async () => {
  const S = await loadStateModule();

  // ============================================================
  // ① 構造のみ適用: state.totalMs 基準
  // ============================================================
  await test('①-1: 20分レベル残り15分で一時停止 → 現レベルを10分に構造変更（③c で totalMs 不変）→ 水位0.75・丸数字20（時計と一致）', () => {
    const levels = [{ durationMinutes: 20 }, { durationMinutes: 20 }];
    const r = buildRenderer(S, levels);
    S.setState({ status: S.States.PAUSED, currentLevelIndex: 0, totalMs: 20 * MIN, remainingMs: 15 * MIN });
    levels[0] = { durationMinutes: 10 };                // 構造のみ適用（_refreshDisplayAfterStructureChange 非 IDLE は state に触らない）
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.gaugeProps['--gauge-ratio'], '0.75');
    assert.equal(r.el.timeGaugeMinutes.textContent, '20');
    assert.equal(r.el.time.textContent, String(15 * 60));
  });
  await test('①-2: 20→30分の構造変更でも同様（水位0.75・丸数字20）→ 再開後も現レベルは旧時間基準', () => {
    const levels = [{ durationMinutes: 30 }, { durationMinutes: 30 }];
    const r = buildRenderer(S, levels);
    S.setState({ status: S.States.PAUSED, currentLevelIndex: 0, totalMs: 20 * MIN, remainingMs: 15 * MIN });
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.gaugeProps['--gauge-ratio'], '0.75');
    assert.equal(r.el.timeGaugeMinutes.textContent, '20');
    S.setState({ status: S.States.RUNNING, remainingMs: 12 * MIN });   // 再開して 3 分経過
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.gaugeProps['--gauge-ratio'], '0.6');
    assert.equal(r.el.timeGaugeMinutes.textContent, '20');
  });
  await test('①-3: 次レベル移行（timer.js が新 duration で totalMs を set）→ 新しい分数・満タン', () => {
    const levels = [{ durationMinutes: 20 }, { durationMinutes: 10 }];
    const r = buildRenderer(S, levels);
    S.setState({ status: S.States.RUNNING, currentLevelIndex: 1, totalMs: 10 * MIN, remainingMs: 10 * MIN });
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.gaugeProps['--gauge-ratio'], '1');
    assert.equal(r.el.timeGaugeMinutes.textContent, '10');
  });
  await test('①-4: 「経過時間を保持して適用」等で totalMs が更新された場合はそれに追随（10分・残り5分 → 0.5・10）', () => {
    const levels = [{ durationMinutes: 10 }];
    const r = buildRenderer(S, levels);
    S.setState({ status: S.States.PAUSED, currentLevelIndex: 0, totalMs: 10 * MIN, remainingMs: 5 * MIN });
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.gaugeProps['--gauge-ratio'], '0.5');
    assert.equal(r.el.timeGaugeMinutes.textContent, '10');
  });
  await test('①-5: ブレイク（BREAK・totalMs 15分・残り3分）→ 0.2・15', () => {
    const levels = [{ durationMinutes: 20 }, { durationMinutes: 15, isBreak: true }];
    const r = buildRenderer(S, levels);
    S.setState({ status: S.States.BREAK, currentLevelIndex: 1, totalMs: 15 * MIN, remainingMs: 3 * MIN });
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.gaugeProps['--gauge-ratio'], '0.2');
    assert.equal(r.el.timeGaugeMinutes.textContent, '15');
  });
  await test('①-6: totalMs 未設定（0）の時だけ構造のレベル時間にフォールバック', () => {
    const levels = [{ durationMinutes: 20 }];
    const r = buildRenderer(S, levels);
    S.setState({ status: S.States.IDLE, currentLevelIndex: 0, totalMs: 0, remainingMs: 20 * MIN });
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.gaugeProps['--gauge-ratio'], '1');
    assert.equal(r.el.timeGaugeMinutes.textContent, '20');
  });
  await test('①-7: operator（timer.js）・hall（applyTimerStateToTimer）とも state.totalMs を現レベル時間で set している', () => {
    const TIMER = read('src', 'renderer', 'timer.js');
    assert.match(TIMER, /remainingMs: totalMs,\s*\n?\s*totalMs/);                       // startAtLevel / reset
    assert.match(TIMER, /totalMs: levelMs/);                                            // advanceTimeBy
    assert.match(RENDERER, /setState\(\{ currentLevelIndex: idx, remainingMs, totalMs, status \}\)/);   // hall
    assert.match(src('renderTimeGauge'), /resolveGaugeMinutes\(totalMs,/);
  });


  // ============================================================
  // ② 完走（→キー全レベル超過 = IDLE + 残り0）
  // ============================================================
  await test('②-1: 全レベル超過（IDLE・残り0）→ data-ended 付与=非表示、明示リセット（IDLE・Lv1 満タン）で解除', () => {
    const r = buildRenderer(S, [{ durationMinutes: 1 }, { durationMinutes: 2 }]);
    S.setState({ status: S.States.RUNNING, currentLevelIndex: 1, totalMs: 2 * MIN, remainingMs: 30000 });
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.el.timeGauge.dataset.ended, undefined);
    S.setState({ status: S.States.IDLE, currentLevelIndex: 1, remainingMs: 0 });      // advanceTimeBy ケース A と同じ state
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.el.timeGauge.dataset.ended, 'true');
    S.setState({ status: S.States.IDLE, currentLevelIndex: 0, totalMs: 1 * MIN, remainingMs: 1 * MIN });   // timerReset 相当
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.el.timeGauge.dataset.ended, undefined);
    assert.equal(r.gaugeProps['--gauge-ratio'], '1');
    assert.equal(r.el.timeGaugeMinutes.textContent, '1', '第1レベルの分数に戻る');
  });
  await test('②-2: 一時停止で残り0付近（PAUSED・残り0）は完走扱いにしない', () => {
    const r = buildRenderer(S, [{ durationMinutes: 1 }]);
    S.setState({ status: S.States.PAUSED, currentLevelIndex: 0, totalMs: 1 * MIN, remainingMs: 0 });
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.el.timeGauge.dataset.ended, undefined);
  });
  // ============================================================
  // ④ 開始前の一時停止
  // ============================================================
  await test('④-1: PRE_START → 開始前由来の PAUSED → 本編 RUNNING で data-prestart-format が 付与→付与→削除、ゲージ更新は本編のみ', () => {
    let pre = true;
    const levels = [{ durationMinutes: 20 }];
    const r = buildRenderer(S, levels, { isPreStartActive: () => pre });
    S.setState({ status: S.States.PRE_START, currentLevelIndex: 0, totalMs: 5 * MIN, remainingMs: 4 * MIN });
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.el.clock.dataset.prestartFormat, 'ms');
    assert.equal(r.gaugeProps['--gauge-ratio'], undefined, '開始前にゲージを書き換えない');
    S.setState({ status: S.States.PAUSED });
    r.renderTime(S.getState().remainingMs);
    assert.equal(r.el.clock.dataset.prestartFormat, 'ms', '開始前の一時停止中も属性維持=CSS で非表示');
    pre = false;
    S.setState({ status: S.States.RUNNING, totalMs: 20 * MIN, remainingMs: 20 * MIN });
    r.renderTime(S.getState().remainingMs);
    assert.equal('prestartFormat' in r.el.clock.dataset, false, '本編開始で属性削除=ゲージ表示');
    assert.equal(r.gaugeProps['--gauge-ratio'], '1');
  });
  await test('④-2: 通常レベルの一時停止（開始前由来でない）は属性なし=ゲージ表示', () => {
    const r = buildRenderer(S, [{ durationMinutes: 20 }], { isPreStartActive: () => false });
    S.setState({ status: S.States.PAUSED, currentLevelIndex: 0, totalMs: 20 * MIN, remainingMs: 10 * MIN });
    r.renderTime(S.getState().remainingMs);
    assert.equal('prestartFormat' in r.el.clock.dataset, false);
    assert.equal(r.gaugeProps['--gauge-ratio'], '0.5');
  });
  await test('④-3: CSS — data-prestart-format / 完走（clock--timer-finished）で visibility: hidden、hall も同属性を開始前中に付与', () => {
    assert.match(CSS_BLOCK, /\.clock\[data-prestart-format\] \.time-gauge,\s*\.clock--timer-finished \.time-gauge,\s*\.time-gauge\[data-ended\] \{\s*visibility: hidden;/);
    assert.match(RENDERER, /el\.clock\.dataset\.prestartFormat = hallPreStartState\.remainingMs/);   // hall 一時停止
    assert.match(RENDERER, /delete el\.clock\.dataset\.prestartFormat;/);                              // hall 解除
  });

  // ============================================================
  // ③ 複製
  // ============================================================
  async function runDuplicate({ srcMode, savedMode, failSetDisplay } = {}) {
    const calls = [];
    const list = [{ id: 'src-1', displaySettings: srcMode === undefined ? {} : { gaugeMode: srcMode } }];
    const api = {
      tournaments: {
        save: async (t) => { calls.push(['save', t.id]); return { ok: true, tournament: { id: t.id, displaySettings: { gaugeMode: savedMode ?? 'tube', background: 'navy' } } }; },
        setDisplaySettings: async (id, ds) => { calls.push(['setDisplaySettings', id, ds]); if (failSetDisplay) throw new Error('x'); return { ok: true, displaySettings: { gaugeMode: ds.gaugeMode, background: 'navy' } }; },
        setActive: async (id) => { calls.push(['setActive', id]); }
      },
      log: { write: () => {} }
    };
    let applied = null;
    const env = {
      window: { api, alert: () => {}, appRole: 'operator-solo' },
      _tournamentsListDedup: async () => list, MAX_TOURNAMENTS: 100, setTournamentHint: () => {},
      cancelPendingTimerStatePersist: () => {}, readTournamentForm: () => ({ id: 'src-1', name: '元大会' }),
      generateUniqueId: () => 'clone-1', applyTournament: (t) => { applied = t; calls.push(['applyTournament']); },
      getState: () => ({ status: 'IDLE' }), isPreStartActive: () => false, timerReset: () => {},
      populateTournamentList: async () => {}, el: { tournamentSelect: {}, tournamentTitle: null },
      loadTournamentIntoForm: async () => {}, setTimeout: () => {}, ensureEditorEditableState: () => {},
      _wrappedRAF: () => {}, _RafLabel: {}, VALID_GAUGE_MODES: ['tube', 'gameType']
    };
    const body = `${src('_resolveSavedGaugeMode')}\n${src('_handleTournamentDuplicateImpl')}\nreturn _handleTournamentDuplicateImpl;`;
    const impl = new Function(...Object.keys(env), body)(...Object.values(env));
    await impl();
    return { calls, applied };
  }
  await test('③-1: 複製元 gameType・グローバル既定 tube → 複製先も gameType（setActive より前に部分更新、反映値で applyTournament）', async () => {
    const { calls, applied } = await runDuplicate({ srcMode: 'gameType' });
    const names = calls.map((c) => c[0]);
    assert.deepEqual(names, ['save', 'setDisplaySettings', 'setActive', 'applyTournament']);
    assert.deepEqual(calls[1], ['setDisplaySettings', 'clone-1', { gaugeMode: 'gameType' }]);
    assert.equal(applied.displaySettings.gaugeMode, 'gameType');
    assert.equal(applied.displaySettings.background, 'navy', '他の表示設定は既存どおり');
  });
  await test('③-2: 複製元 tube（保存結果も tube）→ 追加呼出なし', async () => {
    const { calls } = await runDuplicate({ srcMode: 'tube' });
    assert.equal(calls.some((c) => c[0] === 'setDisplaySettings'), false);
  });
  await test('③-3: 複製元のキー欠落・不正値 → 引継ぎなし（既定補完に任せる）', async () => {
    assert.equal((await runDuplicate({ srcMode: undefined })).calls.some((c) => c[0] === 'setDisplaySettings'), false);
    assert.equal((await runDuplicate({ srcMode: 'xxx' })).calls.some((c) => c[0] === 'setDisplaySettings'), false);
  });
  await test('③-4: 部分更新が失敗しても複製自体は完了（setActive / applyTournament まで進む）', async () => {
    const { calls } = await runDuplicate({ srcMode: 'gameType', failSetDisplay: true });
    assert.deepEqual(calls.map((c) => c[0]), ['save', 'setDisplaySettings', 'setActive', 'applyTournament']);
  });
  await test('③-5: main.js tournaments:setDisplaySettings は未指定フィールドを現値で保持（gaugeMode 単独更新で他設定が消えない）', () => {
    const MAIN = read('src', 'main.js');
    const i = MAIN.indexOf("ipcMain.handle('tournaments:setDisplaySettings'");
    const body = MAIN.slice(i, i + 4000);
    assert.match(body, /background: VALID_BACKGROUNDS\.includes\(ds\.background\) \? ds\.background : \(cur\.background \|\| 'navy'\)/);
    assert.match(body, /timerFont:  VALID_TIMER_FONTS\.includes\(ds\.timerFont\)   \? ds\.timerFont  : \(cur\.timerFont  \|\| 'jetbrains'\)/);
  });

  // ============================================================
  // ⑤ 小数分 / ⑥ 気泡
  // ============================================================
  await test('⑤: 丸数字は整数そのまま・小数は第1位（1.5→"1.5"、0.25→"0.3"、20→"20"）', () => {
    const f = new Function(`${src('formatGaugeMinutes')}\nreturn formatGaugeMinutes;`)();
    assert.equal(f(1.5), '1.5');
    assert.equal(f(0.25), '0.3');
    assert.equal(f(20), '20');
    assert.equal(f(19.99), '20');
  });
  await test('⑥: 気泡は transform: translateX（background-position アニメ・scale なし）', () => {
    const code = CSS_BLOCK.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(code, /@keyframes time-gauge-bubbles \{\s*to \{ transform: translateX\(-18vw\); \}/);
    assert.doesNotMatch(code, /background-position:\s*-18vw/);
    assert.doesNotMatch(code, /transform\s*:[^;]*\bscale/);
  });

  completed = true;
  console.log(`\nglass-tube-gauge-codex.test.js: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
})();
