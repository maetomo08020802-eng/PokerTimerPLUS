'use strict';

/**
 * 外部DB連携 STEP2-K2: engine 状態 → API payload の逐語マップ検査（純ロジック・実ネットワークなし）。
 *
 * 検査対象 = src/link/clock-payload.mjs（K2 plan §2 の表と 1:1）:
 *   - PC States 5値 → API status 5値（BREAK→running / finished は明示フック指定）
 *   - PRE_START の end_at_ms = スタート予定時刻（now + remaining）・pre_start_total_ms 必須
 *   - PAUSED の paused_remaining_ms（PRE_START 由来なら pre_start_total_ms も付く）
 *   - runtime の 0〜999 / remaining ≤ initial（範囲外はクランプせず null=送信スキップ）
 *   - structures の levels そのまま透過・name 100 文字切詰・structure_type 既定 BLIND
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let count = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  count++;
}
function eq(a, b, msg) {
  assert.deepStrictEqual(a, b, msg);
  count++;
}

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'link', 'clock-payload.mjs')).href);
  const { mapStatus, buildRecordPayload, buildRuntimePayload, buildStructurePayload,
          planClockApply, planRuntimeApply } = mod;

  const NOW = 1_800_000_000_000; // 固定 epoch ms（テスト決定性）

  // ---- mapStatus: 5値 + BREAK→running + finished 優先 + 未知値 null ----
  eq(mapStatus('IDLE'), 'idle', 'IDLE → idle');
  eq(mapStatus('PRE_START'), 'prestart', 'PRE_START → prestart');
  eq(mapStatus('RUNNING'), 'running', 'RUNNING → running');
  eq(mapStatus('BREAK'), 'running', 'BREAK → running（web 設計: break は isBreak 行で表現）');
  eq(mapStatus('PAUSED'), 'paused', 'PAUSED → paused');
  eq(mapStatus('RUNNING', { finished: true }), 'finished', 'finished 指定は最優先');
  eq(mapStatus('UNKNOWN'), null, '未知 status は null（送信しない）');

  // ---- record: IDLE ----
  eq(buildRecordPayload({ status: 'IDLE', currentLevelIndex: 3, remainingMs: 60000, isPreStart: false, preStartTotalMs: 0, nowMs: NOW }),
    { status: 'idle', current_level_index: 3, end_at_ms: null, paused_remaining_ms: null, pre_start_total_ms: null },
    'IDLE: 時刻系は全 null');

  // ---- record: PRE_START（end_at = スタート予定時刻・total 必須） ----
  eq(buildRecordPayload({ status: 'PRE_START', currentLevelIndex: 0, remainingMs: 90_000, isPreStart: true, preStartTotalMs: 600_000, nowMs: NOW }),
    { status: 'prestart', current_level_index: 0, end_at_ms: NOW + 90_000, paused_remaining_ms: null, pre_start_total_ms: 600_000 },
    'PRE_START: end_at_ms=now+remaining / pre_start_total_ms あり');
  ok(buildRecordPayload({ status: 'PRE_START', currentLevelIndex: 0, remainingMs: 90_000, isPreStart: true, preStartTotalMs: 0, nowMs: NOW }) === null,
    'PRE_START で total=0 は null（成立していない状態を送らない）');

  // ---- record: RUNNING / BREAK ----
  eq(buildRecordPayload({ status: 'RUNNING', currentLevelIndex: 5, remainingMs: 123_456, isPreStart: false, preStartTotalMs: 0, nowMs: NOW }),
    { status: 'running', current_level_index: 5, end_at_ms: NOW + 123_456, paused_remaining_ms: null, pre_start_total_ms: null },
    'RUNNING: end_at_ms=now+remaining');
  eq(buildRecordPayload({ status: 'BREAK', currentLevelIndex: 6, remainingMs: 300_000, isPreStart: false, preStartTotalMs: 0, nowMs: NOW }).status,
    'running', 'BREAK は running として送る（levels の isBreak 行が index 一致）');

  // ---- record: PAUSED（レベル由来 / PRE_START 由来） ----
  eq(buildRecordPayload({ status: 'PAUSED', currentLevelIndex: 2, remainingMs: 45_000, isPreStart: false, preStartTotalMs: 0, nowMs: NOW }),
    { status: 'paused', current_level_index: 2, end_at_ms: null, paused_remaining_ms: 45_000, pre_start_total_ms: null },
    'PAUSED(レベル由来): paused_remaining_ms のみ');
  eq(buildRecordPayload({ status: 'PAUSED', currentLevelIndex: 0, remainingMs: 30_000, isPreStart: true, preStartTotalMs: 600_000, nowMs: NOW }),
    { status: 'paused', current_level_index: 0, end_at_ms: null, paused_remaining_ms: 30_000, pre_start_total_ms: 600_000 },
    'PAUSED(PRE_START 由来): pre_start_total_ms も付く');

  // ---- record: finished（onTournamentComplete フック） ----
  eq(buildRecordPayload({ status: 'IDLE', currentLevelIndex: 29, remainingMs: 0, isPreStart: false, preStartTotalMs: 0, nowMs: NOW, finished: true }),
    { status: 'finished', current_level_index: 29, end_at_ms: null, paused_remaining_ms: null, pre_start_total_ms: null },
    'finished: 完走通知（時刻系は全 null）');

  // ---- record: 値域ガード ----
  eq(buildRecordPayload({ status: 'RUNNING', currentLevelIndex: -1, remainingMs: 1000, isPreStart: false, preStartTotalMs: 0, nowMs: NOW }).current_level_index,
    0, '負の levelIndex は 0 に補正（API は 0 以上整数のみ）');
  eq(buildRecordPayload({ status: 'PAUSED', currentLevelIndex: 1, remainingMs: -500, isPreStart: false, preStartTotalMs: 0, nowMs: NOW }).paused_remaining_ms,
    0, '負の remaining は 0 に床（API は 0 以上）');

  // ---- runtime: 写像 + special ----
  eq(buildRuntimePayload(
    { playersInitial: 12, playersRemaining: 9, reentryCount: 3, addOnCount: 2 },
    { enabled: true, appliedCount: 1 }),
    { players_initial: 12, players_remaining: 9, reentry_count: 3, addon_count: 2, special_count: 1, special_enabled: true },
    'runtime: publishRemoteState と同型の読取写像');
  eq(buildRuntimePayload(
    { playersInitial: 10, playersRemaining: 10, reentryCount: 0, addOnCount: 0 },
    { enabled: false, appliedCount: 7 }),
    { players_initial: 10, players_remaining: 10, reentry_count: 0, addon_count: 0, special_count: 0, special_enabled: false },
    'special 無効時は special_count=0（enabled と対）');

  // ---- runtime: 範囲外はスキップ（クランプせず null＝engine 値を細工しない） ----
  ok(buildRuntimePayload({ playersInitial: 1000, playersRemaining: 1, reentryCount: 0, addOnCount: 0 }, null) === null,
    '999 超は null（送信スキップ）');
  ok(buildRuntimePayload({ playersInitial: 5, playersRemaining: 6, reentryCount: 0, addOnCount: 0 }, null) === null,
    'remaining > initial は null（送信スキップ）');
  ok(buildRuntimePayload({ playersInitial: 5, playersRemaining: 2.5, reentryCount: 0, addOnCount: 0 }, null) === null,
    '非整数は null（送信スキップ）');

  // ---- structures: levels そのまま透過・name 切詰・type 既定 ----
  const levels = [
    { level: 1, sb: 100, bb: 200, bbAnte: 200, durationMinutes: 30, isBreak: false },
    { level: null, durationMinutes: 10, isBreak: true, label: '休憩' }
  ];
  const sp = buildStructurePayload({ structureType: 'BLIND', levels }, ' 大会A ');
  ok(sp.levels === levels, 'levels は同一参照でそのまま透過（ブレイク行込み・細工しない）');
  eq(sp.name, '大会A', 'name は trim');
  eq(sp.structure_type, 'BLIND', 'structure_type 透過');
  eq(buildStructurePayload({ structureType: 'ODD', levels }, 'x').structure_type, 'BLIND',
    '未知 structure_type は BLIND（web validate の既定と同じ）');
  eq(buildStructurePayload({ levels }, '').name, 'PokerTimerPLUS+ 構成', '空 name はフォールバック');
  eq(buildStructurePayload({ levels }, 'あ'.repeat(120)).name.length, 100, 'name は 100 文字切詰');
  ok(buildStructurePayload({ levels: [] }, 'x') === null, 'levels 0 件は null');
  ok(buildStructurePayload({ levels: new Array(301).fill(levels[0]) }, 'x') === null, 'levels 301 件は null');

  // ==== K3: planClockApply（DB→engine 適用プラン・仕様2「DB が正」） ====

  const L = (status, idx, rem, pre) => ({ status, currentLevelIndex: idx, remainingMs: rem, isPreStart: !!pre });

  // 許容差内 = 適用不要
  ok(planClockApply(L('RUNNING', 3, 60_000), { status: 'running', current_level_index: 3, end_at_ms: NOW + 61_000 }, NOW) === null,
    'running 同 level・差 <2 秒は null（不要な適用ゼロ）');
  ok(planClockApply(L('BREAK', 4, 30_000), { status: 'running', current_level_index: 4, end_at_ms: NOW + 30_500 }, NOW) === null,
    'BREAK も localRunning として扱う（running 同 level 許容差内 = null）');
  // running: 同 level 大差 / 別 level
  eq(planClockApply(L('RUNNING', 3, 60_000), { status: 'running', current_level_index: 3, end_at_ms: NOW + 10_000 }, NOW),
    { kind: 'level', levelIndex: 3, remainingTargetMs: 10_000, paused: false },
    'running 同 level でも差が大きければ合わせる');
  eq(planClockApply(L('RUNNING', 3, 60_000), { status: 'running', current_level_index: 5, end_at_ms: NOW + 90_000 }, NOW),
    { kind: 'level', levelIndex: 5, remainingTargetMs: 90_000, paused: false },
    'running 別 level は startAtLevel 系プラン');
  // end_at 過去 = 負 remaining（断中にレベル境界を跨いだ）→ advanceTimeBy の繰越に委譲
  eq(planClockApply(L('RUNNING', 2, 60_000), { status: 'running', current_level_index: 2, end_at_ms: NOW - 45_000 }, NOW),
    { kind: 'level', levelIndex: 2, remainingTargetMs: -45_000, paused: false },
    'end_at 過去は負 remainingTarget をそのまま返す（レベル繰越は engine 既存経路に委譲）');
  // paused（レベル由来）
  eq(planClockApply(L('RUNNING', 2, 60_000), { status: 'paused', current_level_index: 2, paused_remaining_ms: 45_000 }, NOW),
    { kind: 'level', levelIndex: 2, remainingTargetMs: 45_000, paused: true },
    'DB paused は paused プラン（web 側で一時停止された）');
  ok(planClockApply(L('PAUSED', 2, 45_500), { status: 'paused', current_level_index: 2, paused_remaining_ms: 45_000 }, NOW) === null,
    'paused 同 level 許容差内は null');
  // prestart
  eq(planClockApply(L('IDLE', 0, 0), { status: 'prestart', current_level_index: 0, end_at_ms: NOW + 300_000, pre_start_total_ms: 600_000 }, NOW),
    { kind: 'prestart', remainingMs: 300_000, totalMs: 600_000, paused: false },
    'DB prestart は restorePreStart 系プラン');
  ok(planClockApply(L('PRE_START', 0, 299_000, true), { status: 'prestart', current_level_index: 0, end_at_ms: NOW + 300_000, pre_start_total_ms: 600_000 }, NOW) === null,
    'PRE_START 同士で許容差内は null');
  eq(planClockApply(L('RUNNING', 1, 60_000), { status: 'paused', current_level_index: 0, paused_remaining_ms: 120_000, pre_start_total_ms: 600_000 }, NOW),
    { kind: 'prestart', remainingMs: 120_000, totalMs: 600_000, paused: true },
    'PRE_START 由来 paused は prestart(paused) プラン');
  ok(planClockApply(L('IDLE', 0, 0), { status: 'prestart', current_level_index: 0, end_at_ms: NOW + 1000, pre_start_total_ms: 0 }, NOW) === null,
    'total=0 の不整合 prestart 行は適用しない');
  // idle / finished
  eq(planClockApply(L('RUNNING', 3, 60_000), { status: 'idle' }, NOW), { kind: 'idle' }, 'DB idle は reset プラン');
  ok(planClockApply(L('IDLE', 0, 0), { status: 'idle' }, NOW) === null, '両方 idle は null');
  eq(planClockApply(L('PAUSED', 2, 10_000), { status: 'finished' }, NOW), { kind: 'finished' }, 'DB finished は reset プラン');
  ok(planClockApply(L('IDLE', 5, 0), { status: 'unknown' }, NOW) === null, '未知 DB status は適用しない');

  // ==== K3: planRuntimeApply（範囲外拒否・special_enabled 非採用） ====

  const LOCAL_RT = { playersInitial: 10, playersRemaining: 8, reentryCount: 1, addOnCount: 0 };
  eq(planRuntimeApply(
    { players_initial: 12, players_remaining: 7, reentry_count: 2, addon_count: 1, special_count: 3, special_enabled: false },
    LOCAL_RT, true, 0),
    { playersInitial: 12, playersRemaining: 7, reentryCount: 2, addOnCount: 1, specialCount: 3 },
    'DB runtime を採用（special はローカル enabled 時のみ・DB の special_enabled は見ない=設定非書込）');
  eq(planRuntimeApply(
    { players_initial: 12, players_remaining: 7, reentry_count: 2, addon_count: 1, special_count: 3, special_enabled: true },
    LOCAL_RT, false, 0).specialCount,
    null, 'ローカル special 無効なら specialCount は非採用（null=非接触）');
  ok(planRuntimeApply(
    { players_initial: 10, players_remaining: 8, reentry_count: 1, addon_count: 0, special_count: 0 },
    LOCAL_RT, false, 0) === null,
    '差分なしは null（不要な書込ゼロ）');
  ok(planRuntimeApply(
    { players_initial: 1000, players_remaining: 7, reentry_count: 2, addon_count: 1 }, LOCAL_RT, false, 0) === null,
    '999 超の DB 値は採用拒否（engine を汚さない）');
  ok(planRuntimeApply(
    { players_initial: 5, players_remaining: 7, reentry_count: 2, addon_count: 1 }, LOCAL_RT, false, 0) === null,
    'remaining > initial の DB 値は採用拒否');

  console.log(`db-link-payload.test.js: ${count} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
