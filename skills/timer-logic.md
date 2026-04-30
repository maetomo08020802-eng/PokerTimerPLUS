# タイマー実装品質基準

## 精度ルール
- setIntervalは使わない（ブラウザがバックグラウンド時にズレる）
- requestAnimationFrame + performance.now() で経過時間を毎フレーム計算
- タイマー本体は「終了予定時刻（targetTime）」を保持し、現在時刻との差分から残り秒数を算出

## 状態管理
状態は以下の5つのみ:
- IDLE（未開始）
- COUNTDOWN（スタートカウントダウン中）
- RUNNING（カウント進行中）
- PAUSED（一時停止）
- BREAK（休憩中）

状態遷移は1箇所（state.jsの遷移関数）に集約し、UIは状態を購読する形にする。

## レベル管理
- 現在レベル番号は配列インデックスで管理
- 自動進行（残り時間 0 で次レベルへ）と「指定レベルへジャンプ」の 2 操作のみ
- 手動の「次レベル」「前レベル」ショートカットは廃止。手動遷移はブラインド構造編集UIからのジャンプ操作で行う
- レベル変更時は必ず onLevelChange イベントを発火し、音響・UIが反応する

## 残り時間の手動調整
- **→ キーで「1分進める」（残り時間 -60秒、ゲーム時間が早送り）**
- **← キーで「1分戻す」（残り時間 +60秒、ゲーム時間が巻き戻し）**
- RUNNING / BREAK / PAUSED いずれの状態でも動作
- RUNNING/BREAK 時は targetTime を ±60秒、PAUSED 時は pausedRemainingMs を ±60秒

### 「1分進める」で残り時間が0以下になった場合の挙動（重要）
- **次のレベルへ進行する**（クランプして1秒で止めない）
- 超過分（例: 残り30秒で→を押した場合は -30秒の超過）を次レベルの残り時間から差し引く
- もしさらに次レベルでも0以下になる場合は、再帰的に次のレベルへ繰り越す（超過分を引き継ぐ）
- 全レベルを超えた場合はトーナメント終了状態に遷移
- 実装擬似コード:
  ```
  function advanceTimeBy(seconds) {  // seconds は負（減算）または正（加算）
    let remaining = currentRemaining + seconds;
    while (remaining <= 0 && hasNextLevel()) {
      const nextLevel = jumpToNextLevel();
      remaining += nextLevel.durationSeconds;
    }
    if (remaining <= 0) {
      finishTournament();
    } else {
      setRemaining(remaining);
    }
  }
  ```

### 「1分戻す」で残り時間がレベル時間を超える場合
- **前レベルへ繰り越して遡る**（残り時間が currentLevelDuration を超えた分を前レベルから差し引く）
- 例: Level 2 残り14:30の状態で←を押す
  - 新残り = 14:30 + 1:00 = 15:30
  - 15:30 > 15:00（Level 2のduration） → Level 1へ繰越
  - 超過分 = 15:30 - 15:00 = 0:30 → Level 1の残り時間を 0:30 に設定
- 第1レベル以前へは遡れない（残り時間がレベル初期時間を超える場合はクランプ）
- 実装擬似コード:
  ```javascript
  function adjustTimeBy(deltaSeconds) {
    // delta: -60 = 進める, +60 = 戻す
    let newRemaining = currentRemainingMs + deltaSeconds * 1000;

    // 進める方向: 残り <= 0 なら次レベルへ繰越
    while (newRemaining <= 0) {
      if (!hasNextLevel()) { finishTournament(); return; }
      jumpToNextLevel();
      newRemaining += currentLevelDurationMs;
    }

    // 戻す方向: 残り > レベル時間 なら前レベルへ繰越
    while (newRemaining > currentLevelDurationMs) {
      if (!hasPreviousLevel()) { newRemaining = currentLevelDurationMs; break; }
      const overflow = newRemaining - currentLevelDurationMs;
      jumpToPreviousLevel();
      newRemaining = overflow;
    }

    setRemainingMs(newRemaining);
  }
  ```
- レベル繰越の際は onLevelChange イベントを発火し、UIを更新

## 一時停止
- 一時停止時は targetTime を保存せず、残り秒数（remainingMs）を保持
- 再開時に新しい targetTime = now + remainingMs を計算

## 禁止事項
- グローバル変数でタイマー状態を持たない（必ずstate moduleに集約）
- DOM操作とタイマーロジックを同一関数に書かない
- 0.1秒未満の精度を追求しない（過剰）
- 1秒未満のsetTimeout連打をしない（CPU負荷）

## エラー時の振る舞い
- ブラインド構造が空の場合: タイマー開始ボタンをdisableにする
- ネガティブ時間が発生した場合: 即座に次レベルへ進行
- 想定外の状態に陥った場合: console.warnで記録しIDLEに戻す

---

## STEP 10 で確定した不変条件 (v1.2.0)

### A. tournamentRuntime 保護（致命バグ 8-8 修正、C.2.7-A）

**不変条件**: 「ブラインド構造を変えても tournamentRuntime（playersInitial / playersRemaining / reentryCount / addOnCount）は絶対に消えない」

**責任分離**:
- `handleReset()`: 明示的な「タイマーリセット」ボタン経由のみ。`resetTournamentRuntime()` + `timerReset()` を実行（runtime 含む完全リセット）
- `resetBlindProgressOnly()`: ブラインド構造のリセット専用。`timerReset()` のみ実行、tournamentRuntime は**保護**

**呼出経路**:
| 経路 | 関数 |
| --- | --- |
| btnReset / 確認ダイアログ OK | `handleReset()` |
| 「保存して適用」→「リセットして開始」 | `resetBlindProgressOnly()` |
| 「適用」（reset モード）| `resetBlindProgressOnly()` |

**回帰テスト**: `tests/runtime-preservation.test.js` で静的解析により担保。

### B. timerState 上書き race の防御（C.2.7-D Fix 3）

**問題**: `tournaments:save` IPC は normalizeTournament 経由で部分更新されるが、入力 payload に `timerState` が含まれていれば上書きされる。`persistActiveTournamentBlindPresetId` で `getActive` → `save` 間に `setTimerState` 経由の新 timerState が書き込まれていた場合、save が古い snapshot で上書きしてタイマーが巻き戻る。

**解決**: payload から timerState を destructure 除外し、main 側 `'timerState' in t === false` 経路で既存値を維持。
```js
const { timerState, ...rest } = active;
const updated = { ...rest, blindPresetId: newPresetId };
await window.api.tournaments.save(updated);
```

**他の呼出経路への影響**: `readTournamentForm()` 経由の save（handleTournamentSave / SaveApply / SelectChange）は元から timerState を含まない設計のため無影響。`handleTournamentNew` / `handleTournamentDuplicate` は `timerState: { status: 'idle', ... }` を**明示的に** payload に含める（意図的な idle 初期化）。

### C. powerSaveBlocker（C.2.7-audit-fix）

**目的**: 営業中（タイマー進行中）にディスプレイがスリープしてタイマーが見えなくなる事故を防ぐ。

**動作**:
- RUNNING / PRE_START / BREAK 中 → `powerSaveBlocker.start('prevent-display-sleep')`
- PAUSED / IDLE / DONE → `powerSaveBlocker.stop()`（電気代節約）

**IPC**: `power:preventDisplaySleep` / `power:allowDisplaySleep`（preload で `window.api.power` に公開）

**実装**: renderer.js の `subscribe((state, prev) => { ... syncPowerSaveBlocker(state.status); ... })`

### D. PAUSED 3 択モーダル（C.2.7-B）

PAUSED 中の「適用」「保存して適用」で表示される 3 択 + キャンセルダイアログ:

| 選択肢 | 動作 |
| --- | --- |
| **タイマーをリセットして適用** | 構造保存 + `resetBlindProgressOnly()`（runtime 保護）|
| **経過時間を保持して適用** | 構造保存 + `applyBlindsKeepProgress()`（pausedRemainingMs 整合性チェック）|
| **構造のみ適用（一時停止維持）** | 構造保存のみ、`status` / `pausedRemainingMs` / `currentLevelIndex` すべて維持 |
| キャンセル | 何もしない |

「構造のみ適用」ボタンは PAUSED 状態でのみ表示（`showApplyOnly: status === States.PAUSED`）。RUNNING/BREAK では非表示で 2 択モーダルになる。

**実装**: `showBlindsApplyModal({ showApplyOnly })` / `openApplyModeDialog(ctx, { showApplyOnly })` で UI 連動。

### E. 入力中保護（fix9 → C.1-A2 拡張）

`isUserTypingInInput()` 統一ヘルパで、DOM 再構築時のフォーカス喪失を防ぐ:
```js
function isUserTypingInInput() {
  const ae = document.activeElement;
  if (ae?.isContentEditable) return true;
  if (ae?.tagName === 'TEXTAREA') return true;
  if (ae?.tagName === 'INPUT') {
    const NON_TYPING = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'range', 'image']);
    return !NON_TYPING.has((ae.type || '').toLowerCase());
  }
  return false;
}
```

**ガード適用箇所**:
- `renderTournamentList` / `renderBlindsTable`
- `syncTournamentFormFromState` / `loadTournamentIntoForm`
- `populateTournamentBlindPresets` / `syncMarqueeTabFormFromCurrent`
- `renderPayoutsEditor` / `applyTournament`（フォーム書込部のみ）

**新規 DOM 操作 / フォーム書込関数を追加する場合、必ずこのヘルパでガードすること**（CLAUDE.md にも明記）。

### F. ensureEditorEditableState（C.1-A2、複製 readonly 残存対策）

「複製して編集」「新規作成」直後の readonly 残存を 4 重保証で根本解決:
```js
function ensureEditorEditableState() {
  if (el.presetName) {
    el.presetName.readOnly = false;
    el.presetName.disabled = false;
    el.presetName.classList.remove('is-readonly');
  }
  setBlindsTableReadonly(false);
  const editorRoot = document.querySelector('.blinds-editor');
  if (editorRoot) editorRoot.dataset.builtin = 'false';
}
```

**呼出パターン**: 各ハンドラで `renderBlindsTable` + `updatePresetActions` 後に同期で 1 回 + RAF 内で 1 回（合計 4 重: render内 + update内 + 同期 ensure + RAF ensure）。

---

## v2.0.0 で追加した不変条件（2 画面対応、2026-05-01）

### G. ホール側ウィンドウは purely consumer

ホール側（`window.appRole === 'hall'`）は表示専用、main への操作リクエスト送信を一切行わない。
- renderer.js の主要操作 handler 14 箇所の冒頭に `if (window.appRole === 'hall') return;` ガード（`v2-role-guard.test.js T2` で 5 箇所以上を静的担保）
- preload.js の `window.api.dual.notifyOperatorAction` は送信側（operator）のみが呼ぶ。`notifyOperatorActionIfNeeded` ヘルパで `role !== 'operator'` 早期 return
- ホール側 → main の経路は `dual:state-sync-init`（初期同期 1 回）と `dual:state-sync` 受信のみ

### H. main プロセスを単一の真実源とする状態同期

- `_dualStateCache`（9 種類: timerState / structure / displaySettings / marqueeSettings / tournamentRuntime / tournamentBasics / audioSettings / logoUrl / venueName）を main で保持
- 既存 IPC ハンドラ末尾で `_publishDualState(kind, value)` 呼出 → `_broadcastDualState` 経由でホール側に差分配信
- ホール側不在時は `!hallWindow || hallWindow.isDestroyed()` 早期 return で no-op（operator-solo モードの後方互換を担保）
- ウィンドウ間直接通信禁止、すべて main 経由 IPC に集約
- 1 秒ごとの全データ転送禁止、差分のみ送信（`v2-dual-screen.md §1.3`）

### I. 単画面モード（operator-solo）は v1.3.0 完全同等

- HDMI なし環境では自動的に `operator-solo` で起動（`createOperatorWindow(_, isSolo=true)`）
- `[data-role="operator-solo"]` の CSS ルールは「何も hidden 化しない」（`v2-backward-compat.test.js T2` で静的担保）
- `notifyOperatorActionIfNeeded` / `initDualSyncForHall` ともに role ガードで早期 return → broadcast を起こさない
- store スキーマ変更なし（v1.3.0 → v2.0.0 のデータ移行不要）
- 既存 138 テストすべて PASS 維持

### J. ウィンドウ役割切替は再生成方式（reload 禁止）

- `additionalArguments: ['--role=...']` は `process.argv` に乗るため、`webContents.reload()` では role 変更不可
- HDMI 抜き → operator-solo に切替: `mainWindow.close()` → `createOperatorWindow(_, true)` で再生成
- HDMI 再接続 → 2 画面に切替: `mainWindow.close()` → `createOperatorWindow(_, false)` + `createHallWindow(_)`
- タイマー進行は main プロセスで持続、新ウィンドウ起動時に既存 subscribe 経路で state 復元（ユーザーから見て中断ゼロ）

### K. AudioContext 再初期化対応（C.1.7 強化）

- HDMI 抜きでウィンドウ再生成 → AudioContext suspend のリスクに対する多重防御
- `audio.js _play()` 内の suspend resume（C.1.7）はそのまま維持
- 加えて renderer.js の operator-solo 経路で起動直後に `ensureAudioReady()` を明示呼出（最初の音発火を待たず）
- `v2-display-change.test.js T6` で operator-solo 経路の `ensureAudioReady` 呼出を静的担保

### L. ポーリング禁止、イベント駆動

- HDMI 抜き差し追従は `screen.on('display-added' / 'display-removed')` のイベント駆動のみ（`v2-display-change.test.js T7` で `setInterval` 不使用を静的担保）
- 状態同期は IPC イベント駆動、ホール側で `setInterval` による全状態取得は禁止（`v2-dual-sync.test.js T6` で dual-sync.js 内の `setInterval` 不使用を静的担保）
