// 外部DB連携 STEP2-K2: engine 状態 → 受け口 API payload の逐語マップ（純関数・依存ゼロ）。
//
// ★写像の正は K2 plan §2 の表（web customer-app の types.ts / pc-validate.ts と突合済）。
//   - PC States 5値(IDLE/PRE_START/RUNNING/PAUSED/BREAK) → API status 5値(idle/prestart/running/paused/finished)
//   - BREAK は API では `running`（web 設計「break は status に持たせない=レベル配列の isBreak で表現」と 1:1。
//     PC の levels 配列はブレイク行込みで index が一致するため current_level_index がそのまま通じる）
//   - PRE_START の end_at_ms は「スタート予定時刻」（web ClockRecord.endAtMs の意味論と同一）
//   - finished は PC に常駐 status が無い（完走後 IDLE に戻る）ため、onTournamentComplete フックから
//     `finished: true` を指定して送る
// ★このモジュールは engine の出力を読むだけ（engine/timer/state.js の意味論に一切触れない）。
//   multi-engine.mjs と同じ流儀で node --test 可能（tests/db-link-payload.test.js）。

/** PC States 文字列 → API status（finished 指定時はそれを優先）。未知値は null（送信しない）。 */
export function mapStatus(pcStatus, { isPreStart = false, finished = false } = {}) {
  if (finished) return 'finished';
  switch (pcStatus) {
    case 'IDLE': return 'idle';
    case 'PRE_START': return 'prestart';
    case 'RUNNING': return 'running';
    case 'BREAK': return 'running'; // ブレイクは running + isBreak 行（web 設計と 1:1）
    case 'PAUSED': return 'paused';
    default: return null;
  }
}

/**
 * record payload（POST /clock/record の body・expected_updated_at を除く）を組む。
 * 返り値 null = 送信すべきでない状態（未知 status / 値域外）。
 *
 * @param {object} p
 * @param {string} p.status            PC States 文字列
 * @param {number} p.currentLevelIndex 0 始まり
 * @param {number} p.remainingMs       現在の残り ms（PAUSED 中は固定値）
 * @param {boolean} p.isPreStart       timer.js isPreStartActive()（PAUSED が PRE_START 由来かの判別）
 * @param {number} p.preStartTotalMs   timer.js getPreStartTotalMs()（PRE_START 系以外は 0）
 * @param {number} p.nowMs             Date.now()（注入可能=テスト決定性）
 * @param {boolean} [p.finished]       onTournamentComplete フックからの完走通知
 */
export function buildRecordPayload(p) {
  const status = mapStatus(p.status, { isPreStart: p.isPreStart, finished: p.finished });
  if (status === null) return null;
  const levelIndex = Number.isSafeInteger(p.currentLevelIndex) && p.currentLevelIndex >= 0
    ? p.currentLevelIndex : 0;
  const remaining = Math.max(0, Math.floor(Number(p.remainingMs) || 0));
  const payload = {
    status,
    current_level_index: levelIndex,
    end_at_ms: null,
    paused_remaining_ms: null,
    pre_start_total_ms: null
  };
  if (status === 'running' || status === 'prestart') {
    // 同期の心臓 = 絶対時刻。coalescer の送信遅延があっても値はズレない
    const endAt = Math.floor(p.nowMs + remaining);
    if (!Number.isSafeInteger(endAt) || endAt <= 0) return null;
    payload.end_at_ms = endAt;
  }
  if (status === 'paused') {
    payload.paused_remaining_ms = remaining;
  }
  if (status === 'prestart' || (status === 'paused' && p.isPreStart)) {
    // pre_start_total_ms は 1 以上（0 なら PRE_START 自体が成立していない）
    const total = Math.floor(Number(p.preStartTotalMs) || 0);
    if (total <= 0) return null;
    payload.pre_start_total_ms = total;
  }
  return payload;
}

/**
 * runtime payload（POST /clock/runtime の body・expected_updated_at を除く）を組む。
 * 返り値 null = 範囲外（0〜999 / remaining ≤ initial を満たさない）＝送信スキップ
 * （engine 側の値を細工して送らない=クランプではなくスキップ）。
 *
 * @param {object} runtime      tournamentRuntime（playersInitial/playersRemaining/reentryCount/addOnCount）
 * @param {object} specialStack tournamentState.specialStack（{enabled, appliedCount} or null）
 */
export function buildRuntimePayload(runtime, specialStack) {
  const r = runtime || {};
  const enabled = !!(specialStack && specialStack.enabled);
  const payload = {
    players_initial: Number(r.playersInitial),
    players_remaining: Number(r.playersRemaining),
    reentry_count: Number(r.reentryCount),
    addon_count: Number(r.addOnCount),
    special_count: enabled ? (Number(specialStack.appliedCount) || 0) : 0,
    special_enabled: enabled
  };
  for (const key of ['players_initial', 'players_remaining', 'reentry_count', 'addon_count', 'special_count']) {
    const v = payload[key];
    if (!Number.isSafeInteger(v) || v < 0 || v > 999) return null;
  }
  if (payload.players_remaining > payload.players_initial) return null;
  return payload;
}

// ===== K3: DB→engine 反映アダプタの「適用プラン」（純関数・engine 非依存） =====
// 復帰 / conflict / 接続時に GET /clock の DB 状態へ PC を従わせる（仕様2「DB が正」）。
// engine 本体は無改変 — ここは「どの公開 API をどう呼ぶか」の宣言を返すだけで、
// 実行は renderer 側の小さな実行器（timer.js 公開 API のみ使用）が行う。

/** 適用の許容差（ms）。同 status・同 level でこれ未満の残り時間差なら適用しない。 */
export const APPLY_TOLERANCE_MS = 2000;

function _clampIdx(v) {
  return Number.isSafeInteger(v) && v >= 0 ? v : 0;
}

/**
 * DB clock 行 → 適用プラン。
 * @param {object} local {status(PC States 文字列), currentLevelIndex, remainingMs, isPreStart}
 * @param {object} db    {status(API 5値), current_level_index, end_at_ms, paused_remaining_ms, pre_start_total_ms}
 * @param {number} nowMs Date.now()（注入可能）
 * @returns null（適用不要）|
 *   {kind:'idle'} | {kind:'finished'}                       → timerReset({force:true})
 *   {kind:'prestart', remainingMs, totalMs, paused}          → restorePreStart 系
 *   {kind:'level', levelIndex, remainingTargetMs, paused}    → startAtLevel→(pause)→advanceTimeBy
 *   ※ remainingTargetMs は負も可 = advanceTimeBy の既存レベル繰越に委譲
 *     （断中にレベル境界を跨いだ DB 状態も正しく着地する）
 */
export function planClockApply(local, db, nowMs) {
  if (!db || typeof db !== 'object' || !local || typeof local !== 'object') return null;
  switch (db.status) {
    case 'idle':
      return (local.status === 'IDLE' && !local.isPreStart) ? null : { kind: 'idle' };
    case 'finished':
      return (local.status === 'IDLE' && !local.isPreStart) ? null : { kind: 'finished' };
    case 'prestart': {
      const total = Math.floor(Number(db.pre_start_total_ms) || 0);
      if (total <= 0) return null; // 不整合な DB 行は適用しない
      const remaining = Math.max(0, Math.floor(Number(db.end_at_ms) || 0) - nowMs);
      if (local.status === 'PRE_START' && Math.abs(local.remainingMs - remaining) < APPLY_TOLERANCE_MS) return null;
      return { kind: 'prestart', remainingMs: remaining, totalMs: total, paused: false };
    }
    case 'paused': {
      const paused = Math.max(0, Math.floor(Number(db.paused_remaining_ms) || 0));
      const preTotal = Math.floor(Number(db.pre_start_total_ms) || 0);
      if (preTotal > 0) {
        // PRE_START 由来の一時停止
        if (local.status === 'PAUSED' && local.isPreStart &&
            Math.abs(local.remainingMs - paused) < APPLY_TOLERANCE_MS) return null;
        return { kind: 'prestart', remainingMs: paused, totalMs: preTotal, paused: true };
      }
      const idx = _clampIdx(db.current_level_index);
      if (local.status === 'PAUSED' && !local.isPreStart && local.currentLevelIndex === idx &&
          Math.abs(local.remainingMs - paused) < APPLY_TOLERANCE_MS) return null;
      return { kind: 'level', levelIndex: idx, remainingTargetMs: paused, paused: true };
    }
    case 'running': {
      const idx = _clampIdx(db.current_level_index);
      const target = Math.floor(Number(db.end_at_ms) || 0) - nowMs; // 負も可（繰越委譲）
      const localRunning = local.status === 'RUNNING' || local.status === 'BREAK';
      if (localRunning && local.currentLevelIndex === idx &&
          Math.abs(local.remainingMs - target) < APPLY_TOLERANCE_MS) return null;
      return { kind: 'level', levelIndex: idx, remainingTargetMs: target, paused: false };
    }
    default:
      return null;
  }
}

/**
 * DB clock 行 → runtime 採用値。差分なし / 範囲外 DB 値（0〜999・remaining≤initial 違反）は null。
 * ★special_enabled は**採用しない**（specialStack.enabled は PC 側の大会設定 = 仕様3「PC 設定に非書込」）。
 *   specialCount はローカルで有効な時のみ採用（無効なら null=非接触）。
 */
export function planRuntimeApply(db, localRuntime, localSpecialEnabled, localSpecialCount) {
  if (!db || typeof db !== 'object' || !localRuntime || typeof localRuntime !== 'object') return null;
  const vals = {
    playersInitial: db.players_initial,
    playersRemaining: db.players_remaining,
    reentryCount: db.reentry_count,
    addOnCount: db.addon_count
  };
  for (const v of Object.values(vals)) {
    if (!Number.isSafeInteger(v) || v < 0 || v > 999) return null; // 採用拒否（engine を汚さない）
  }
  if (vals.playersRemaining > vals.playersInitial) return null;
  let specialCount = null;
  if (localSpecialEnabled && Number.isSafeInteger(db.special_count) &&
      db.special_count >= 0 && db.special_count <= 999) {
    specialCount = db.special_count;
  }
  const same = vals.playersInitial === localRuntime.playersInitial &&
    vals.playersRemaining === localRuntime.playersRemaining &&
    vals.reentryCount === localRuntime.reentryCount &&
    vals.addOnCount === localRuntime.addOnCount &&
    (specialCount === null || specialCount === (Number(localSpecialCount) || 0));
  if (same) return null;
  return { ...vals, specialCount };
}

/**
 * structures payload（POST /structures の body）を組む。
 * levels は PC の構成配列を**そのまま**渡す（preset 由来の {level, sb, bb, bbAnte, durationMinutes,
 * isBreak, label, ...} = web ClockLevel と 1:1・ブレイク行込み）。
 *
 * @param {object} structure getStructure() のスナップショット
 * @param {string} tournamentName PC 大会名（構成名に使う）
 */
export function buildStructurePayload(structure, tournamentName) {
  const s = structure || {};
  const levels = Array.isArray(s.levels) ? s.levels : [];
  if (levels.length === 0 || levels.length > 300) return null;
  const rawName = typeof tournamentName === 'string' && tournamentName.trim()
    ? tournamentName.trim()
    : 'PokerTimerPLUS+ 構成';
  const KNOWN_TYPES = ['BLIND', 'LIMIT_BLIND', 'SHORT_DECK', 'STUD', 'MIX'];
  return {
    name: rawName.slice(0, 100),
    structure_type: KNOWN_TYPES.includes(s.structureType) ? s.structureType : 'BLIND',
    levels
  };
}
