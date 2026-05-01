# CC_REPORT — 2026-05-01 v2.0.4-rc6 試験版ビルド（HDMI 切替バグ 5 件統合修正）

## 1. サマリー

rc5 試験で発覚した HDMI 切替時の 5 系統バグを構築士判断（前原さん追認）通り全件修正:

- **Fix 1**: HDMI 切替時の状態管理（再入ガード `_isSwitchingMode` + `display-added/-removed` debounce + 防御的 close）→ AC 残存・多重発火を一括解消
- **Fix 2**: 「AC を minimize 化 + 復元時ポップアップ案内」（前原さん要望文言尊重、operator-solo 動的切替廃止、close→新生成 race 原理的に消滅）
- **Fix 3**: F11 を「常に hall を toggle」化（rc2 の `getFocusedWindow` 前提崩れを撤回、hallWindow 不在時は mainWindow に fallback で v1.3.0 互換維持）
- **Fix 4**: ESC ハンドラを `dispatchClockShortcut` に追加（dialog 無し時に hall 全画面解除を IPC で main に通知、案 i 採用）
- **Fix 5**: M / H の双方向同期（operator (PC) で押下 → IPC で hall 側 audio / DOM にも反映、C.1.7 `ensureAudioReady().then(...)` ラップ維持）

新規テスト 27 件追加 + 既存 3 件更新で **302 → 329 全 PASS**、`.exe` 再ビルド成功。

## 2. ビルド成果物

| 項目 | 値 |
|---|---|
| **絶対パス** | `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc6.exe` |
| **ファイルサイズ** | 82,971,269 bytes（約 80 MB）|
| **version** | `2.0.4-rc6`（latest.yml で確認済）|
| **productName** | `PokerTimerPLUS+ (Test)`（rc1〜rc5 と同じ）|
| **appId** | `com.shitamachi.pokertimerplus.test`（rc1〜rc5 と同じ）|
| **生成日時** | 2026-05-01T09:26:41.992Z |

## 3. STEP A: 事前確認結果

### A-1: H 部分の既存実装確認 → **Fix 必要**

`toggleBottomBar()` (renderer.js:2719) は `window.api.settings.setDisplay({ bottomBarHidden })` で **永続化のみ**。`settings:setDisplay` ハンドラ（main.js:1304）は `_publishDualState` を呼ばないため、**hall 側に runtime 同期されていない**。
→ Fix 5-H を **実装必須**（M と同パターンで `dual:broadcast-bottombar-state` IPC 経路を追加）

### A-2: operator role の表示分離確認 → **Fix 2 採用 OK**

`[data-role="operator"]` で hidden 化される要素:
- `.clock` / `.marquee` / `.slideshow-stage` / `.pip-timer` / `.pip-action-btn` / `.bg-image-overlay`

これらは **すべて hall 側のお客様向け表示**。operator-status-bar（上部 36px、Level/Time/Status）と operator-pane（運用情報 + 操作一覧）が代替表示。
→ Fix 2 で minimize 解除しても重大な見えない要素なし、**採用 OK**。

## 4. 修正対象ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/main.js` | `_isSwitchingMode` / `_displayAddedPending` / `_displayRemovedPending` 宣言 / `switchOperatorToSolo` を minimize 化 + フラグ立て / `switchSoloToOperator` 再入ガード + orphan close / `display-added`/`-removed` debounce / `createHallWindow`/`createOperatorWindow` 防御的 close / `createOperatorWindow` に restore イベント + ポップアップ / `toggleFullScreen` を hall 優先化 / `ipcMain.on('dual:request-exit-fullscreen' / 'dual:broadcast-mute-state' / 'dual:broadcast-bottombar-state')` 3 ハンドラ追加 |
| `src/preload.js` | `dual.requestExitFullScreen` / `broadcastMuteState` / `onMuteStateChanged` / `broadcastBottomBarState` / `onBottomBarStateChanged` 5 メソッド追加 |
| `src/renderer/renderer.js` | `dispatchClockShortcut` に `case 'Escape'` 追加 / KeyM ケース末尾で operator なら `broadcastMuteState` / KeyH ケース末尾で operator なら `broadcastBottomBarState` / hall ブランチで `onMuteStateChanged` + `onBottomBarStateChanged` 受信ハンドラ登録 |
| `package.json` | `version`: `2.0.4-rc5` → `2.0.4-rc6` / `scripts.test` に新規 1 ファイル追加 |
| `tests/v130-features.test.js` | T11 version 期待値 → `2.0.4-rc6` |
| `tests/v2-display-change.test.js` | T4 を rc6 minimize 仕様に追従 |
| `tests/v204-hall-fullscreen.test.js` | T3 を rc6 hall 優先仕様に追従 |
| `tests/v204-window-protection.test.js` | B-1 cross-check を rc6 minimize 仕様に追従 |
| `tests/v204-rc6-hdmi-state.test.js` | 新規 27 件（Fix 1〜5 + 致命バグ保護 + operator-solo 互換）|

## 5. 修正コード抜粋

### Fix 1-A + Fix 2-A: switchOperatorToSolo minimize 化（main.js）
```js
let _isSwitchingMode = false;

async function switchOperatorToSolo() {
  if (_isSwitchingMode) return;
  _isSwitchingMode = true;
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (hallWindow && !hallWindow.isDestroyed()) {
      try { hallWindow.close(); } catch (_) {}
      hallWindow = null;
    }
    try { mainWindow.minimize(); } catch (_) {}
    mainWindow._showRestoreNoticeOnce = true;
  } finally {
    _isSwitchingMode = false;
  }
}
```

### Fix 1-A + 1-C: switchSoloToOperator + orphan 防御（main.js）
```js
async function switchSoloToOperator(hallDisplay) {
  if (_isSwitchingMode) return;
  _isSwitchingMode = true;
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!hallDisplay) return;
    if (hallWindow && !hallWindow.isDestroyed()) {
      try { hallWindow.close(); } catch (_) {}
      hallWindow = null;
    }
    /* 既存 close + 再生成 */
  } finally {
    _isSwitchingMode = false;
  }
}
```

### Fix 1-B: display-added debounce（main.js）
```js
let _displayAddedPending = false;
screen.on('display-added', async () => {
  if (_displayAddedPending) return;
  if (hallWindow && !hallWindow.isDestroyed()) return;
  _displayAddedPending = true;
  try { /* 既存ロジック */ } finally { _displayAddedPending = false; }
});
```

### Fix 2-B: 復元時ポップアップ案内（main.js createOperatorWindow 内）
```js
win._showRestoreNoticeOnce = false;
win.on('restore', () => {
  if (!win._showRestoreNoticeOnce) return;
  win._showRestoreNoticeOnce = false;
  dialog.showMessageBox(win, {
    type: 'info', buttons: ['OK'], defaultId: 0,
    title: 'AC ウィンドウについて',
    message:
      'この画面は 2 画面表示用のフォーカス用ウィンドウです。\n' +
      '一度 2 画面用として立ち上げているため、この画面を閉じるとアプリも閉じます。\n' +
      'ご注意ください。\n\n' +
      '邪魔でしたら、アプリを閉じるまで、このウィンドウは最小化しておいてください。'
  }).catch(() => {});
});
```

### Fix 3: toggleFullScreen hall 優先（main.js）
```js
function toggleFullScreen() {
  const target = (hallWindow && !hallWindow.isDestroyed()) ? hallWindow : mainWindow;
  if (!target || target.isDestroyed()) return;
  target.setFullScreen(!target.isFullScreen());
}
```

### Fix 4: ESC ハンドラ（renderer.js + main.js）
```js
// renderer.js dispatchClockShortcut
case 'Escape':
  event.preventDefault();
  window.api?.dual?.requestExitFullScreen?.();
  break;

// main.js
ipcMain.on('dual:request-exit-fullscreen', () => {
  if (hallWindow && !hallWindow.isDestroyed() && hallWindow.isFullScreen()) {
    try { hallWindow.setFullScreen(false); } catch (_) {}
  }
});
```

### Fix 5-M: ミュート双方向同期（renderer.js + main.js）
```js
// renderer.js dispatchClockShortcut case 'KeyM' 内
ensureAudioReady().then(() => {                       // ← C.1.7 ラップ維持
  const nowMuted = audioToggleMute();
  updateMuteIndicator();
  if (window.appRole === 'operator') {
    window.api?.dual?.broadcastMuteState?.(nowMuted);
  }
});

// renderer.js hall ブランチ
window.api?.dual?.onMuteStateChanged?.((muted) => {
  ensureAudioReady().then(() => {                     // ← C.1.7 ラップ維持
    if (audioIsMuted() !== !!muted) audioToggleMute();
    updateMuteIndicator();
  });
});

// main.js
ipcMain.on('dual:broadcast-mute-state', (_event, muted) => {
  if (hallWindow && !hallWindow.isDestroyed()) {
    try { hallWindow.webContents.send('dual:mute-state-changed', !!muted); } catch (_) {}
  }
});
```

### Fix 5-H: ボトムバー双方向同期（renderer.js + main.js、M と同パターン）
省略（同構造、`broadcastBottomBarState` / `onBottomBarStateChanged` / `dual:broadcast-bottombar-state` / `dual:bottombar-state-changed` の 4 チャネル名）

## 6. テスト結果

| 件数 | 結果 |
|---|---|
| **329** | **全 PASS（0 件 FAIL）** |

内訳:
- 既存 138 件（v1.x〜v2.0.0）→ 全 PASS
- v2 専用 7 ファイル 52 件 → 全 PASS（v2-display-change T4 更新）
- v2-window-race 4 件 / v2-stabilization 27 件 / v2-cleanup 8 件 / v2-coverage 9 件 → 全 PASS
- v204-hall-fullscreen 6 件（T3 更新）→ 全 PASS
- v204-window-protection 11 件（B-1 cross-check 更新）→ 全 PASS
- v204-rc4-keyforward 12 件 / v204-rc4-operator-pane 17 件 / v204-rc5-mute-indicator 18 件 → 全 PASS
- **v204-rc6-hdmi-state 27 件（新規）→ 全 PASS**

## 7. 致命バグ保護 5 件への影響評価

| 保護項目 | 影響 |
|---|---|
| C.2.7-A `resetBlindProgressOnly` | **影響なし**（cross-check テストで確認）|
| C.2.7-D `setDisplaySettings` destructure | **影響なし**（settings:setDisplay は触れていない）|
| C.1-A2 `ensureEditorEditableState` | **影響なし**（エディタ系は触れていない）|
| **C.1.7 AudioContext resume** | **影響なし、明示的に維持**（KeyM ケース + hall onMuteStateChanged 共に `ensureAudioReady().then(...)` ラップを維持、cross-check テスト 2 件で確認）|
| C.1.8 runtime 永続化 8 箇所 | **影響なし**（cross-check で 6 箇所以上維持確認）|

## 8. operator-solo モード（v1.3.0 互換）への影響評価

**最初から HDMI なしで起動する単画面ユーザーには影響なし**:
- 起動経路 `createMainWindow → createOperatorWindow(_, true)` は変更なし
- `toggleFullScreen` は hallWindow 不在時に mainWindow に fallback（cross-check テストで確認）
- Fix 4 / 5 は appRole === 'operator' ガード付きのため operator-solo は従来通り

**HDMI あり起動 → 抜き経路の挙動変更**（前原さん要望、許容済）:
- 旧: HDMI 抜き → operator-solo に動的切替（close → 再生成）
- 新: HDMI 抜き → operator は minimize（role='operator' のまま）
- ユーザー視点: AC ウィンドウが消えずに最小化、邪魔なら最小化のままに

## 9. 並列 sub-agent 数

**0 体**（プロンプト指示通り、修正範囲が明確で並列不要）

## 10. ブランチ状態

- 現在ブランチ: `feature/v2.0.4-rc1-test-build`（rc1 → rc2 → rc3 → rc4 → rc5 → rc6 連続使用）
- main マージ: しない
- リモート push: しない
- ローカルコミット: 実施予定（rc5 → rc6 差分追跡）

## 11. オーナー向け確認

1. **試験版 rc6 インストーラ生成完了**:
   `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc6.exe`（約 80MB）

2. **前原さん再試験項目（最重要）**:
   - **単一モニターで起動**: 全操作（Space / 矢印 / R / Ctrl+E / S / M / H / Ctrl+T / × 確認等）が rc5 と同じく動くか
   - **HDMI 接続 → 2 画面に**:
     - F11 → **hall（ホール側モニター）が全画面切替**（rc5 では AC 全画面化していた）
     - ESC → **hall が全画面なら窓化**（dispatcher 経由）
     - M → AC でも hall でも音響がミュート（双方向同期）
     - H → AC でも hall でもボトムバー切替
   - **HDMI 抜き → 単画面に**:
     - **AC ウィンドウが自動で最小化される**（rc5 では残存していた）
     - 邪魔なら最小化のまま放置可能
     - 大きくしたら **「AC ウィンドウについて」ポップアップが 1 回表示される**
   - **再 HDMI 接続 → 2 画面に戻す**:
     - **多重発火しない**（rc5 では AC でも hall でも操作が効いていた）
     - フォーカスが正しく機能（AC で操作 → 1 回だけ反応）

3. **既存挙動の維持確認**:
   - × ボタン → 確認ダイアログ（rc3 維持）
   - HDMI 抜き → 確認ダイアログ出ない（minimize なので close ハンドラ未発火、確認ダイアログ無し）
   - Ctrl+Q → 既存ダイアログ（rc3 維持）
   - ミュート視覚フィードバック（rc5 維持、全 role）
