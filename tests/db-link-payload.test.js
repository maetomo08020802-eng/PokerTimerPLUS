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
  const { mapStatus, buildRecordPayload, buildRuntimePayload, buildStructurePayload } = mod;

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

  console.log(`db-link-payload.test.js: ${count} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
