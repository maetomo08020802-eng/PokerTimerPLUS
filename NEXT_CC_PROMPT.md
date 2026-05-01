# v2.0.4-rc6 実装: HDMI 切替バグ 5 件統合修正 + 再ビルド

## 構築士判断（前原さん追認 2026-05-01）

| Fix | 採用 | 備考 |
|---|---|---|
| Fix 1 (A): HDMI 切替時の状態管理（再入ガード + debounce + 防御的 close）| **採用** | AC 残存 + 多重発火を同時解消 |
| Fix 2 (B): AC を minimize 化 + 復元時ポップアップ案内 | **採用** | 前原さん要望文言を尊重、operator-solo 動的切替を廃止 |
| Fix 3 (C): F11 を常に hall を toggle 化（hallWindow 不在時は mainWindow fallback）| **採用** | |
| Fix 4 (D): ESC ハンドラ追加（**案 i: hall 全画面解除**）+ 既存 dialog default 維持 | **採用** | 案 i 採用 |
| Fix 5 (E): M / H 双方向同期 | **採用** | H 部分は既存 `displaySettings.bottomBarHidden` で動いてる可能性、CC が事前確認 → 動いていれば H 部分は Fix 不要 |

---

## 重要前提

- **致命バグ保護 5 件への変更禁止**（特に C.1.7 AudioContext resume 系は Fix 5 で audio 経路に触れるため `ensureAudioReady().then(...)` 維持必須）
- **operator-solo モード（最初から HDMI なし起動）への影響なし維持**（v1.3.0 互換）
- Fix 2 で「2 画面起動 → HDMI 抜き → minimize」の挙動変更は許容（前原さん要望、operator role のまま、最初から単画面の操作には影響なし）
- スコープ厳守

---

## STEP A: 事前確認（コード変更なし）

### A-1. Fix 5 H 部分の既存実装確認

`toggleBottomBar()` の実装を Read tool で確認:
- `displaySettings.bottomBarHidden` の永続化 + main → renderer broadcast の経路があるか
- 既に hall 側にも反映されているなら **Fix 5 から H 部分のみ除外**
- 動いていない場合のみ Fix 5 で同期実装

### A-2. Fix 2 採用時の operator-solo / operator 表示分離確認

`src/renderer/style.css` の `[data-role="operator"]` セレクタで hall 専用要素が hidden 化されているものをリストアップ:
- minimize 復元時に operator role のまま単画面表示すると、これら hidden 要素が見えない
- 重大な見えない要素（タイマー本体や bottom-bar 等）があれば Fix 2 採用前に CC_REPORT で構築士判断仰ぐ
- 軽微な要素（hall 専用の装飾等）のみなら Fix 2 そのまま採用、最小化解除時にユーザーへの注意で対応可

---

## STEP B: 実装

### Fix 1: HDMI 切替時の状態管理（src/main.js）

#### Fix 1-A: switch 系再入ガード

```js
let _isSwitchingMode = false;

async function switchSoloToOperator(hallDisplay) {
  if (_isSwitchingMode) return;
  _isSwitchingMode = true;
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!hallDisplay) return;
    // orphan hallWindow 検出 + close
    if (hallWindow && !hallWindow.isDestroyed()) {
      try { hallWindow.close(); } catch (_) {}
      hallWindow = null;
    }
    const operatorDisplay = screen.getPrimaryDisplay();
    mainWindow._suppressCloseConfirm = true;
    try { mainWindow.close(); } catch (_) {}
    mainWindow = null;
    createOperatorWindow(operatorDisplay, false);
    createHallWindow(hallDisplay);
  } finally {
    _isSwitchingMode = false;
  }
}
```

`switchOperatorToSolo` も同パターン適用（Fix 2 と統合実装）。

#### Fix 1-B: display-added / display-removed の debounce ガード

```js
let _displayAddedPending = false;

screen.on('display-added', async () => {
  if (_displayAddedPending) return;
  if (hallWindow && !hallWindow.isDestroyed()) return;
  _displayAddedPending = true;
  try {
    /* 既存ロジック */
  } finally {
    _displayAddedPending = false;
  }
});
```

`display-removed` も同パターン。

#### Fix 1-C: createHallWindow / createOperatorWindow の防御的 close

```js
function createHallWindow(targetDisplay) {
  if (hallWindow && !hallWindow.isDestroyed()) {
    try { hallWindow.close(); } catch (_) {}
  }
  hallWindow = null;
  /* 既存コード */
}
```

`createOperatorWindow` も同パターン。

### Fix 2: AC ウィンドウの minimize 化 + 復元時ポップアップ案内

#### Fix 2-A: switchOperatorToSolo の minimize 化

```js
async function switchOperatorToSolo() {
  if (_isSwitchingMode) return;
  _isSwitchingMode = true;
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // hall 側だけ閉じる（operator は minimize、close しない）
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

#### Fix 2-B: 復元時のポップアップ案内（一回限り）

`createOperatorWindow` 内に追加:

```js
win.on('restore', () => {
  if (win._showRestoreNoticeOnce) {
    win._showRestoreNoticeOnce = false;
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['OK'],
      title: 'AC ウィンドウについて',
      message:
        'この画面は 2 画面表示用のフォーカス用ウィンドウです。\n' +
        '一度 2 画面用として立ち上げているため、この画面を閉じるとアプリも閉じます。\n' +
        'ご注意ください。\n\n' +
        '邪魔でしたら、アプリを閉じるまで、このウィンドウは最小化しておいてください。'
    });
  }
});
```

### Fix 3: F11 を常に hall を toggle 化（src/main.js）

```js
function toggleFullScreen() {
  // v2.0.4-rc6: 2 画面モードでは常に hall を toggle
  // 単画面モード（hallWindow 不在）では mainWindow を toggle（v1.3.0 互換）
  const target = (hallWindow && !hallWindow.isDestroyed()) ? hallWindow : mainWindow;
  if (!target || target.isDestroyed()) return;
  target.setFullScreen(!target.isFullScreen());
}
```

### Fix 4: ESC ハンドラ追加（renderer.js + preload + main.js）

#### Fix 4-A: dispatchClockShortcut に ESC case 追加

```js
case 'Escape':
  // dispatcher 到達時 dialog なし前提（dialog[open] ガードで弾かれる）
  // hall 全画面解除を IPC で main に通知
  event.preventDefault();
  if (window.appRole === 'operator' || window.appRole === 'operator-solo') {
    window.api?.dual?.requestExitFullScreen?.();
  }
  break;
```

既存の `<dialog>` の ESC default close 動作はそのまま維持（変更不要）。

#### Fix 4-B: preload.js に新 IPC 経路

```js
dual: {
  // ... 既存 ...
  requestExitFullScreen: () => ipcRenderer.send('dual:request-exit-fullscreen'),
}
```

#### Fix 4-C: main.js に ESC handler

```js
ipcMain.on('dual:request-exit-fullscreen', () => {
  if (hallWindow && !hallWindow.isDestroyed() && hallWindow.isFullScreen()) {
    hallWindow.setFullScreen(false);
  }
});
```

### Fix 5: M / H 双方向同期

#### Fix 5-M: ミュート状態を hall に同期

`src/renderer/renderer.js` の `case 'KeyM'`:

```js
case 'KeyM':
  if (!event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    ensureAudioReady().then(() => {
      const nowMuted = audioToggleMute();
      if (window.appRole === 'operator') {
        window.api?.dual?.broadcastMuteState?.(nowMuted);
      }
      updateMuteIndicator();
    });
  }
  break;
```

`preload.js` に `broadcastMuteState`, `onMuteStateChanged` 追加。
`main.js` に `ipcMain.on('dual:broadcast-mute-state', (e, muted) => { hallWindow?.webContents.send('dual:mute-state-changed', muted); })`。
`renderer.js` で hall role 時に IPC 受信 → audio API でミュート状態を反映 + updateMuteIndicator 呼出。

**致命バグ保護 C.1.7 維持**: `ensureAudioReady().then(...)` の包みは絶対変更しない。

#### Fix 5-H: 既存実装確認後に判断

STEP A-1 で確認 → 既存で動いていれば Fix 5-H は実装しない。動いていなければ Fix 5-M と同パターンで実装。

### STEP C: テスト追加

新規 `tests/v204-rc6-hdmi-state.test.js`:
- `_isSwitchingMode` 再入ガード確認
- `_displayAddedPending` debounce 確認
- `createHallWindow` / `createOperatorWindow` 防御的 close 確認
- `switchOperatorToSolo` の minimize 動作確認
- `_showRestoreNoticeOnce` フラグ + restore イベント案内確認
- `toggleFullScreen` の hall 優先確認
- `dispatchClockShortcut` の `case 'Escape'` 存在確認
- `dual:request-exit-fullscreen` IPC 経路確認
- M 双方向同期 IPC 確認
- 致命バグ保護 5 件 cross-check（特に C.1.7 AudioContext resume）
- operator-solo モードへの不影響確認

### STEP D: バージョン rc5 → rc6

- `package.json`: `2.0.4-rc5` → `2.0.4-rc6`
- `tests/v130-features.test.js` T11 同期更新

### STEP E: ビルド + 静的検証

- `npm run build:win`
- `dist/latest.yml` に `version: 2.0.4-rc6` 確認

### STEP F: CC_REPORT.md を完成版で上書き

---

## 報告必須項目

- 並列 sub-agent 数（0 体予定）
- 致命バグ保護 5 件への影響評価（特に C.1.7）
- 修正対象ファイル一覧と各変更箇所
- 修正コード抜粋（Fix 1〜5 すべて）
- STEP A-1 (H 既存実装確認) の結果
- STEP A-2 (operator-solo / operator 表示分離) の結果 + 重大要素の有無
- ビルド成果物 path / size / version
- operator-solo モードへの影響評価（minimize 化挙動の妥当性、最初から単画面の場合は影響なし確認）

---

## 禁止事項

- 致命バグ保護 5 件への変更（特に C.1.7 ensureAudioReady ラップ維持必須）
- スコープ外の追加実装
- main マージ / push
- 並列 sub-agent 起動（修正範囲明確で並列不要）
- ESC 案 ii / iii の動作変更（案 i のみ採用）
- operator-solo（最初から単画面起動）の挙動変更

---

## ブランチ

- 現在ブランチ: `feature/v2.0.4-rc1-test-build` 継続使用
- ローカルコミット可（rc5 → rc6 差分追跡）
- main マージ・push なし

---

## 完了後の流れ

1. 構築士: CC_REPORT 採点 → 前原さんに rc6 の `.exe` 場所と再試験依頼
2. 前原さん: rc5 アンインストール → rc6 インストール → 再試験
   - 単一モニターで起動して全操作確認
   - HDMI 接続 → ホールに映る → F11 / ESC / H / M すべて反応するか
   - HDMI 抜き → AC が自動で最小化されるか + 大きくしたらポップアップが出るか
   - 再 HDMI 接続 → 多重発火が起きないか
   - 既存挙動（× 確認 / Space / 矢印 / R / Ctrl+E など）が崩れていないか
