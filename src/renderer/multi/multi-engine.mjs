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
//   { status: 'idle'|'prestart'|'running'|'paused'|'finished',
//     currentLevelIndex: number(0-based),
//     endAtMs: number|null,           // running 中: 現在レベルの終了予定時刻 / prestart 中: スタート予定時刻
//     pausedRemainingMs: number|null, // paused 中のみ: 残り時間
//     preStartTotalMs: number|null    // Phase 2: prestart（および prestart 由来の paused）中のみ非 null
//   }
//
// PRE_START（Phase 2）: 単一モード（timer.js startPreStart 系）の意味論を区画独立で写す。
//   - idle からのみ起動・レベル 0 固定・totalMs<=0 は即時 start と等価
//   - 0 着地で自動的にレベル 0 満了 duration を投入した running へ（computePaneNow が派生計算で
//     決定論的に遷移させるため、着地時の publish なしで grid が自走できる）
//   - 一時停止 / 再開 / キャンセル（idle へ）可。カウントダウン中のレベル操作は no-op（単一モード忠実）

export const ENGINE_STATUS = Object.freeze({
  IDLE: 'idle',
  PRESTART: 'prestart',
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

// running の派生計算コア（レベル繰上げ while = computeLiveTimerState と同義）。prestart 0 着地後の
// 「レベル 0 満了 duration を着地瞬間に投入した running」もこの同一経路で計算する。
function computeRunningNow(levels, startIndex, remainingSeed) {
  let levelIndex = startIndex;
  let remainingMs = remainingSeed;
  while (remainingMs <= 0) {
    if (levelIndex >= levels.length - 1) {
      return { status: ENGINE_STATUS.FINISHED, levelIndex: levels.length - 1, remainingMs: 0 };
    }
    levelIndex += 1;
    remainingMs += levelDurationMs(levels, levelIndex);
  }
  return { status: ENGINE_STATUS.RUNNING, levelIndex, remainingMs };
}

// 純粋計算のコア: record + levels + nowMs から「今この瞬間」の派生状態を返す。
// record を一切変更しない（grid 側は同期された record からこれだけで描画できる）。
// 戻り値: { status, levelIndex, remainingMs, preStart? }
//   - レベル跨ぎ（endAtMs 超過分の繰越）も内部で計算する＝ computeLiveTimerState の while 繰上げと同義
//   - 全レベル完走で status='finished'・remainingMs=0・levelIndex=最終
//   - preStart: true は「開始前カウントダウン由来」（prestart 進行中 / prestart 中の一時停止）＝表示側の
//     フォーマット・ラベル判定用（単一モードの isPreStartActive() 相当）
export function computePaneNow(record, levels, nowMs) {
  const hasLevels = Array.isArray(levels) && levels.length > 0;
  if (!record || typeof record !== 'object' || !hasLevels) {
    return { status: ENGINE_STATUS.IDLE, levelIndex: 0, remainingMs: hasLevels ? levelDurationMs(levels, 0) : 0 };
  }
  const idx = clampLevelIndex(levels, record.currentLevelIndex);
  const isPreStartRecord = Number.isFinite(record.preStartTotalMs) && record.preStartTotalMs > 0;
  if (record.status === ENGINE_STATUS.PAUSED) {
    const remainingMs = Math.max(0, Number(record.pausedRemainingMs) || 0);
    return isPreStartRecord
      ? { status: ENGINE_STATUS.PAUSED, levelIndex: 0, remainingMs, preStart: true }
      : { status: ENGINE_STATUS.PAUSED, levelIndex: idx, remainingMs };
  }
  if (record.status === ENGINE_STATUS.FINISHED) {
    return { status: ENGINE_STATUS.FINISHED, levelIndex: levels.length - 1, remainingMs: 0 };
  }
  if (record.status === ENGINE_STATUS.PRESTART) {
    if (!Number.isFinite(record.endAtMs)) {
      return { status: ENGINE_STATUS.IDLE, levelIndex: 0, remainingMs: levelDurationMs(levels, 0) };
    }
    const remainingMs = record.endAtMs - nowMs;
    if (remainingMs > 0) {
      return { status: ENGINE_STATUS.PRESTART, levelIndex: 0, remainingMs, preStart: true };
    }
    // 0 着地: 着地瞬間（endAtMs）にレベル 0 満了 duration を投入した running として派生
    //（単一モード preStartTick の 00:00 検出 → startAtLevel(0) と同義・決定論版）
    return computeRunningNow(levels, 0, remainingMs + levelDurationMs(levels, 0));
  }
  if (record.status !== ENGINE_STATUS.RUNNING || !Number.isFinite(record.endAtMs)) {
    // idle（または不正 status は idle 扱い＝安全側）
    return { status: ENGINE_STATUS.IDLE, levelIndex: idx, remainingMs: levelDurationMs(levels, idx) };
  }
  // running: 終了予定時刻からの逆算 + レベル繰上げ（境界 remaining<=0 で次レベルへ = elapsed>=dur と同義）
  return computeRunningNow(levels, idx, record.endAtMs - nowMs);
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
    pausedRemainingMs: null,
    preStartTotalMs: null
  };

  function isPreStartRecord() {
    return Number.isFinite(record.preStartTotalMs) && record.preStartTotalMs > 0;
  }

  // running / prestart 0 着地のレベル繰上げを record に確定させる
  //（pause / advanceLevel の基準を「今の派生状態」にするため）
  function commitNow(nowMs) {
    const now = computePaneNow(record, _levels, nowMs);
    if (record.status === ENGINE_STATUS.RUNNING ||
        (record.status === ENGINE_STATUS.PRESTART && now.status !== ENGINE_STATUS.PRESTART)) {
      if (now.status === ENGINE_STATUS.FINISHED) {
        record = { status: ENGINE_STATUS.FINISHED, currentLevelIndex: _levels.length - 1, endAtMs: null, pausedRemainingMs: null, preStartTotalMs: null };
      } else if (now.status === ENGINE_STATUS.RUNNING &&
                 (record.status === ENGINE_STATUS.PRESTART || now.levelIndex !== record.currentLevelIndex)) {
        // prestart 0 着地後の確定 / 通常のレベル繰上げ確定
        record = { status: ENGINE_STATUS.RUNNING, currentLevelIndex: now.levelIndex, endAtMs: nowMs + now.remainingMs, pausedRemainingMs: null, preStartTotalMs: null };
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
        pausedRemainingMs: null,
        preStartTotalMs: null
      };
    },
    // Phase 2: 開始前カウントダウン（単一モード startPreStart の意味論を区画独立で）。
    //   idle からのみ・レベル 0 固定・totalMs<=0/非有限は即時 start(レベル0) と等価。
    startPreStart(totalMs, nowMs) {
      if (record.status !== ENGINE_STATUS.IDLE || _levels.length === 0) return;
      const t = Number(totalMs);
      if (!Number.isFinite(t) || t <= 0) {
        // 単一モード: minutes<=0 → start()＝startAtLevel(0)。レベル 0 固定で即時 running
        record = {
          status: ENGINE_STATUS.RUNNING,
          currentLevelIndex: 0,
          endAtMs: nowMs + levelDurationMs(_levels, 0),
          pausedRemainingMs: null,
          preStartTotalMs: null
        };
        return;
      }
      const total = Math.floor(t);
      record = {
        status: ENGINE_STATUS.PRESTART,
        currentLevelIndex: 0,
        endAtMs: nowMs + total,
        pausedRemainingMs: null,
        preStartTotalMs: total
      };
    },
    // Phase 2: カウントダウンのキャンセル（prestart / prestart 由来 paused → idle。単一モード cancelPreStart 相当）
    cancelPreStart() {
      if (record.status !== ENGINE_STATUS.PRESTART &&
          !(record.status === ENGINE_STATUS.PAUSED && isPreStartRecord())) return;
      record = { status: ENGINE_STATUS.IDLE, currentLevelIndex: 0, endAtMs: null, pausedRemainingMs: null, preStartTotalMs: null };
    },
    pause(nowMs) {
      if (record.status === ENGINE_STATUS.PRESTART) {
        const now = commitNow(nowMs);   // 0 着地済なら running に確定してから通常 pause 経路へ
        if (record.status === ENGINE_STATUS.PRESTART) {
          // カウントダウン進行中の一時停止（単一モード: PRE_START → PAUSED・isPreStart 維持）
          record = {
            status: ENGINE_STATUS.PAUSED,
            currentLevelIndex: 0,
            endAtMs: null,
            pausedRemainingMs: Math.max(0, now.remainingMs),
            preStartTotalMs: record.preStartTotalMs
          };
          return;
        }
      }
      if (record.status !== ENGINE_STATUS.RUNNING) return;
      const now = commitNow(nowMs);
      if (record.status !== ENGINE_STATUS.RUNNING) return; // commit で finished に達した場合
      record = {
        status: ENGINE_STATUS.PAUSED,
        currentLevelIndex: now.levelIndex,
        endAtMs: null,
        pausedRemainingMs: now.remainingMs,
        preStartTotalMs: null
      };
    },
    resume(nowMs) {
      if (record.status !== ENGINE_STATUS.PAUSED) return;
      const remaining = Math.max(0, Number(record.pausedRemainingMs) || 0);
      if (isPreStartRecord()) {
        // カウントダウンへ復帰（単一モード: resume で PRE_START に戻る・残時間保存）
        record = {
          status: ENGINE_STATUS.PRESTART,
          currentLevelIndex: 0,
          endAtMs: nowMs + remaining,
          pausedRemainingMs: null,
          preStartTotalMs: record.preStartTotalMs
        };
        return;
      }
      record = {
        status: ENGINE_STATUS.RUNNING,
        currentLevelIndex: record.currentLevelIndex,
        endAtMs: nowMs + remaining,
        pausedRemainingMs: null,
        preStartTotalMs: null
      };
    },
    // レベル送り(+1)/戻し(-1)。移動先レベルは満了 duration から（単一モードの startAtLevel と同じ思想）
    advanceLevel(delta, nowMs) {
      if (_levels.length === 0 || !Number.isFinite(delta) || delta === 0) return;
      if (record.status === ENGINE_STATUS.PRESTART) {
        commitNow(nowMs);   // 0 着地済なら running に確定（着地前のカウントダウン中は下で no-op）
        if (record.status === ENGINE_STATUS.PRESTART) return; // カウントダウン中のレベル操作なし（単一モード忠実）
      }
      if (record.status === ENGINE_STATUS.PAUSED && isPreStartRecord()) return; // カウントダウン一時停止中も同様
      if (record.status === ENGINE_STATUS.FINISHED) {
        if (delta >= 0) return; // 完走後の送りは no-op
        const target = clampLevelIndex(_levels, _levels.length - 1 + delta);
        record = { status: ENGINE_STATUS.PAUSED, currentLevelIndex: target, endAtMs: null, pausedRemainingMs: levelDurationMs(_levels, target), preStartTotalMs: null };
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
    // Phase 2c: ±30 秒等の時間微調整（単一モード timer.js advanceTimeBy / advancePreStartBy の
    // 意味論を record モデルへ忠実移植）。deltaMs 負 = 進める（残り減）/ 正 = 戻す（残り増）。
    //   - RUNNING/PAUSED: 残り時間調整。≤0 → 次レベルへ超過分繰越・全レベル超過 → finished。
    //     現レベル初期長超 → 前レベルへ繰越・レベル 0 でクランプ（timer.js L342-372 と同型）
    //   - PRESTART: カウントダウン残に作用（0 未満クランプ・0 到達で自動レベル 0 running）
    //   - prestart 由来 PAUSED: クランプのみ・遷移しない（advancePreStartBy の paused 分岐に忠実）
    //   - IDLE / FINISHED: no-op（単一モードの早期 return に忠実）
    adjustTimeBy(deltaMs, nowMs) {
      if (_levels.length === 0 || !Number.isFinite(deltaMs) || deltaMs === 0) return;
      if (record.status === ENGINE_STATUS.PRESTART) {
        commitNow(nowMs);   // 0 着地済なら running に確定して下の通常経路へ
        if (record.status === ENGINE_STATUS.PRESTART) {
          const cur = Math.max(0, record.endAtMs - nowMs);
          const newRem = Math.max(0, cur + deltaMs);
          if (newRem <= 0) {
            // 0 到達 → 即レベル 0 running（単一モード advancePreStartBy の startAtLevel(0) と同義）
            record = {
              status: ENGINE_STATUS.RUNNING,
              currentLevelIndex: 0,
              endAtMs: nowMs + levelDurationMs(_levels, 0),
              pausedRemainingMs: null,
              preStartTotalMs: null
            };
          } else {
            record = { ...record, endAtMs: nowMs + newRem };
          }
          return;
        }
      }
      if (record.status === ENGINE_STATUS.PAUSED && isPreStartRecord()) {
        const newRem = Math.max(0, (Number(record.pausedRemainingMs) || 0) + deltaMs);
        record = { ...record, pausedRemainingMs: newRem };
        return;
      }
      if (record.status !== ENGINE_STATUS.RUNNING && record.status !== ENGINE_STATUS.PAUSED) return;
      if (record.status === ENGINE_STATUS.RUNNING) commitNow(nowMs);
      if (record.status === ENGINE_STATUS.FINISHED) return; // commit で完走に達していた場合
      const isPaused = record.status === ENGINE_STATUS.PAUSED;
      let levelIndex = clampLevelIndex(_levels, record.currentLevelIndex);
      let levelMs = levelDurationMs(_levels, levelIndex);
      const cur = isPaused
        ? Math.max(0, Number(record.pausedRemainingMs) || 0)
        : Math.max(0, record.endAtMs - nowMs);
      let newRemaining = cur + deltaMs;
      // ケース A: 進める方向（≤0）→ 次レベルへ繰越、全レベル超過で完走
      while (newRemaining <= 0) {
        if (levelIndex + 1 >= _levels.length) {
          record = { status: ENGINE_STATUS.FINISHED, currentLevelIndex: _levels.length - 1, endAtMs: null, pausedRemainingMs: null, preStartTotalMs: null };
          return;
        }
        levelIndex += 1;
        levelMs = levelDurationMs(_levels, levelIndex);
        newRemaining += levelMs;
      }
      // ケース B: 戻す方向（> 現レベル初期長）→ 前レベルへ繰越、レベル 0 でクランプ
      while (newRemaining > levelMs) {
        if (levelIndex === 0) {
          newRemaining = levelMs;
          break;
        }
        const overflow = newRemaining - levelMs;
        levelIndex -= 1;
        levelMs = levelDurationMs(_levels, levelIndex);
        newRemaining = overflow;
      }
      if (isPaused) {
        record = { ...record, currentLevelIndex: levelIndex, pausedRemainingMs: newRemaining };
      } else {
        record = { ...record, currentLevelIndex: levelIndex, endAtMs: nowMs + newRemaining };
      }
    },
    reset() {
      record = { status: ENGINE_STATUS.IDLE, currentLevelIndex: 0, endAtMs: null, pausedRemainingMs: null, preStartTotalMs: null };
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

// Phase 2: 「スタートまで」表示フォーマット（renderer.js formatPreStartTime と同値・同値検証テストで担保）。
//   残り 60 分以上なら HH:MM:SS（format 'hms'）、未満なら MM:SS（format 'ms'）。
//   format は grid の data-prestart-format（font-size 切替 = 単一モード style.css:812-822 のパリティ）に使う。
export function formatPreStartClock(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const useHMS = ms >= 60 * 60 * 1000;
  return {
    text: useHMS ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`,
    format: useHMS ? 'hms' : 'ms'
  };
}

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
// IDLE / PRESTART はトーナメント未開始なので 0（renderer.js:981 と同義）
export function computeTotalGameTimeMsFor(levels, levelIndex, remainingMs, status) {
  if (!Array.isArray(levels) || levels.length === 0) return 0;
  if (status === ENGINE_STATUS.IDLE || status === ENGINE_STATUS.PRESTART) return 0;
  let total = 0;
  for (let i = 0; i < levelIndex; i++) total += levelDurationMs(levels, i);
  total += Math.max(0, levelDurationMs(levels, levelIndex) - remainingMs);
  return total;
}
