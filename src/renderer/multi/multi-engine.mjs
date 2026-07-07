// PokerTimerPLUS+ multi-tournament-4up Phase 1 — 独立時計エンジン
//
// 4分割マルチトーナメント表示モード専用の軽量時計エンジン。
// 設計原則（Phase 0 plan §5.2 / Phase 1 brief C）:
//   - 純粋 JS・DOM / IPC / electron-store 非依存（既存 timer.js / state.js / blinds.js は import しない）
//   - 算術は「終了予定時刻（endAtMs）ベース」＝既存 computeLiveTimerState / hallTickState と同型
//   - エンジンインスタンス間で共有する可変状態ゼロ（区画独立性の核）
//   - 時刻は全 API で nowMs 引数注入（Date.now() を内部で直接呼ばない＝テスト容易性）
//
// 状態モデル（record）:
//   { status: 'idle'|'running'|'paused'|'finished',
//     currentLevelIndex: number(0-based),
//     endAtMs: number|null,          // running 中のみ: 現在レベルの終了予定時刻
//     pausedRemainingMs: number|null // paused 中のみ: 残り時間
//   }

export const ENGINE_STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  FINISHED: 'finished'
});

// レベル長を ms で返す（durationSeconds 優先、なければ durationMinutes。既存 computeLiveTimerState と同順）
export function levelDurationMs(levels, index) {
  const lv = Array.isArray(levels) ? levels[index] : null;
  if (!lv) return 0;
  if (typeof lv.durationSeconds === 'number') return Math.max(0, lv.durationSeconds * 1000);
  if (typeof lv.durationMinutes === 'number') return Math.max(0, lv.durationMinutes * 60 * 1000);
  return 0;
}

function clampLevelIndex(levels, index) {
  const max = Array.isArray(levels) && levels.length > 0 ? levels.length - 1 : 0;
  return Math.max(0, Math.min(max, Number.isFinite(index) ? Math.floor(index) : 0));
}

// 純粋計算のコア: record + levels + nowMs から「今この瞬間」の派生状態を返す。
// record を一切変更しない（grid 側は同期された record からこれだけで描画できる）。
// 戻り値: { status, levelIndex, remainingMs }
//   - レベル跨ぎ（endAtMs 超過分の繰越）も内部で計算する＝ computeLiveTimerState の while 繰上げと同義
//   - 全レベル完走で status='finished'・remainingMs=0・levelIndex=最終
export function computePaneNow(record, levels, nowMs) {
  const hasLevels = Array.isArray(levels) && levels.length > 0;
  if (!record || typeof record !== 'object' || !hasLevels) {
    return { status: ENGINE_STATUS.IDLE, levelIndex: 0, remainingMs: hasLevels ? levelDurationMs(levels, 0) : 0 };
  }
  const idx = clampLevelIndex(levels, record.currentLevelIndex);
  if (record.status === ENGINE_STATUS.PAUSED) {
    return { status: ENGINE_STATUS.PAUSED, levelIndex: idx, remainingMs: Math.max(0, Number(record.pausedRemainingMs) || 0) };
  }
  if (record.status === ENGINE_STATUS.FINISHED) {
    return { status: ENGINE_STATUS.FINISHED, levelIndex: levels.length - 1, remainingMs: 0 };
  }
  if (record.status !== ENGINE_STATUS.RUNNING || !Number.isFinite(record.endAtMs)) {
    // idle（または不正 status は idle 扱い＝安全側）
    return { status: ENGINE_STATUS.IDLE, levelIndex: idx, remainingMs: levelDurationMs(levels, idx) };
  }
  // running: 終了予定時刻からの逆算 + レベル繰上げ（境界 remaining<=0 で次レベルへ = elapsed>=dur と同義）
  let levelIndex = idx;
  let remainingMs = record.endAtMs - nowMs;
  while (remainingMs <= 0) {
    if (levelIndex >= levels.length - 1) {
      return { status: ENGINE_STATUS.FINISHED, levelIndex: levels.length - 1, remainingMs: 0 };
    }
    levelIndex += 1;
    remainingMs += levelDurationMs(levels, levelIndex);
  }
  return { status: ENGINE_STATUS.RUNNING, levelIndex, remainingMs };
}

// 区画1つぶんの独立時計エンジンを生成する。
// levels は生成時に固定（区画への割当 = エンジン再生成。途中差し替えはしない設計）。
// record はクロージャ内に閉じ、外部へは getRecord() のコピー経由でのみ公開（共有可変状態ゼロ）。
export function createClockEngine(levels) {
  const _levels = Array.isArray(levels) ? levels.slice() : [];
  let record = {
    status: ENGINE_STATUS.IDLE,
    currentLevelIndex: 0,
    endAtMs: null,
    pausedRemainingMs: null
  };

  // running 中のレベル繰上げを record に確定させる（pause / advanceLevel の基準を「今の派生状態」にするため）
  function commitNow(nowMs) {
    const now = computePaneNow(record, _levels, nowMs);
    if (record.status === ENGINE_STATUS.RUNNING) {
      if (now.status === ENGINE_STATUS.FINISHED) {
        record = { status: ENGINE_STATUS.FINISHED, currentLevelIndex: _levels.length - 1, endAtMs: null, pausedRemainingMs: null };
      } else if (now.levelIndex !== record.currentLevelIndex) {
        record = { ...record, currentLevelIndex: now.levelIndex, endAtMs: nowMs + now.remainingMs };
      }
    }
    return now;
  }

  return {
    // idle からのみ開始（現在レベルの満了 duration を投入して running へ）
    start(nowMs) {
      if (record.status !== ENGINE_STATUS.IDLE || _levels.length === 0) return;
      const idx = clampLevelIndex(_levels, record.currentLevelIndex);
      record = {
        status: ENGINE_STATUS.RUNNING,
        currentLevelIndex: idx,
        endAtMs: nowMs + levelDurationMs(_levels, idx),
        pausedRemainingMs: null
      };
    },
    pause(nowMs) {
      if (record.status !== ENGINE_STATUS.RUNNING) return;
      const now = commitNow(nowMs);
      if (record.status !== ENGINE_STATUS.RUNNING) return; // commit で finished に達した場合
      record = {
        status: ENGINE_STATUS.PAUSED,
        currentLevelIndex: now.levelIndex,
        endAtMs: null,
        pausedRemainingMs: now.remainingMs
      };
    },
    resume(nowMs) {
      if (record.status !== ENGINE_STATUS.PAUSED) return;
      record = {
        status: ENGINE_STATUS.RUNNING,
        currentLevelIndex: record.currentLevelIndex,
        endAtMs: nowMs + Math.max(0, Number(record.pausedRemainingMs) || 0),
        pausedRemainingMs: null
      };
    },
    // レベル送り(+1)/戻し(-1)。移動先レベルは満了 duration から（単一モードの startAtLevel と同じ思想）
    advanceLevel(delta, nowMs) {
      if (_levels.length === 0 || !Number.isFinite(delta) || delta === 0) return;
      if (record.status === ENGINE_STATUS.FINISHED) {
        if (delta >= 0) return; // 完走後の送りは no-op
        const target = clampLevelIndex(_levels, _levels.length - 1 + delta);
        record = { status: ENGINE_STATUS.PAUSED, currentLevelIndex: target, endAtMs: null, pausedRemainingMs: levelDurationMs(_levels, target) };
        return;
      }
      if (record.status === ENGINE_STATUS.RUNNING) commitNow(nowMs);
      if (record.status === ENGINE_STATUS.FINISHED) return; // commit で完走に達していたら送り不可（戻しは次回操作で）
      const target = clampLevelIndex(_levels, record.currentLevelIndex + delta);
      if (record.status === ENGINE_STATUS.RUNNING) {
        record = { ...record, currentLevelIndex: target, endAtMs: nowMs + levelDurationMs(_levels, target) };
      } else if (record.status === ENGINE_STATUS.PAUSED) {
        record = { ...record, currentLevelIndex: target, pausedRemainingMs: levelDurationMs(_levels, target) };
      } else {
        record = { ...record, currentLevelIndex: target }; // idle: 表示位置のみ移動
      }
    },
    reset() {
      record = { status: ENGINE_STATUS.IDLE, currentLevelIndex: 0, endAtMs: null, pausedRemainingMs: null };
    },
    computeNow(nowMs) {
      return computePaneNow(record, _levels, nowMs);
    },
    getRecord() {
      return { ...record };
    },
    getLevels() {
      return _levels;
    }
  };
}

// ===== 表示用の派生計算（renderer.js の同名ロジックの移植・引数化版） =====
// ※ 二重管理リスクは tests/multi-engine.test.js の同値検証で担保（Phase 0 plan §3 の対処）

// NEXT BREAK IN: 現在レベルがブレイクなら 0、以降にブレイクが無ければ null（renderer.js computeNextBreakMs と同ロジック）
export function computeNextBreakMsFor(levels, levelIndex, remainingMs) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  if (levels[levelIndex]?.isBreak) return 0;
  let total = remainingMs;
  for (let i = levelIndex + 1; i < levels.length; i++) {
    if (levels[i].isBreak) return total;
    total += levelDurationMs(levels, i);
  }
  return null;
}

// TOTAL GAME TIME: 完了レベルの duration 合計 + 現在レベルの経過分（renderer.js computeTotalGameTimeMs と同ロジック）
export function computeTotalGameTimeMsFor(levels, levelIndex, remainingMs, status) {
  if (!Array.isArray(levels) || levels.length === 0) return 0;
  if (status === ENGINE_STATUS.IDLE) return 0;
  let total = 0;
  for (let i = 0; i < levelIndex; i++) total += levelDurationMs(levels, i);
  total += Math.max(0, levelDurationMs(levels, levelIndex) - remainingMs);
  return total;
}
