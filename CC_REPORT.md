# CC_REPORT — 2026-05-01 v2.0.0 STEP 4: 起動時のモニター選択ダイアログ

## 1. サマリー

- `src/renderer/display-picker.html` + `display-picker.js`（新規）でモニター選択 UI を実装。CSP `script-src 'self'` 維持、inline script なし、独自スタイルを `<style>` ブロックで内包
- `src/main.js` に `chooseHallDisplayInteractive(displays)` 関数を新規追加（async）。`createMainWindow()` を async 化、`app.whenReady().then(async () => ...)` + activate ハンドラも async 化
- 新規 IPC: `display-picker:fetch`（invoke、displays + lastSelected を返却）/ `dual:select-hall-monitor`（send、選択結果通知）
- `preload.js` に `dual.fetchDisplays` / `dual.selectHallMonitor` を追加
- 前回選択は `store.set('preferredHallDisplayId', ...)` で参考保存、次回ダイアログの「前回選択」バッジ表示にのみ使用（自動選択はしない、毎回手動の前原さん要望）。キャンセル経路では保存しない
- 単画面（モニター 1 枚）: ダイアログ出ない、`operator-solo` で v1.3.0 完全同等
- `tests/v2-display-picker.test.js`（新規、8 件）+ `package.json` 更新
- 既存 138 + STEP 2 新規 8 + STEP 3 新規 8 + STEP 4 新規 8 = **162 件すべて PASS**
- 致命バグ保護 5 件すべて影響なし、commit `c61c0b8` push 済（**PR は未作成**、承認②で STEP 3+4+5 まとめて作成方針）

---

## 2. 修正ファイル

| ファイル | 変更点（短く） |
| --- | --- |
| `src/renderer/display-picker.html`（新規） | モニター選択 UI、独自 `<style>` 内包、CSP 厳格 |
| `src/renderer/display-picker.js`（新規） | fetchDisplays → カード生成 → selectHallMonitor / cancel → window.close |
| `src/main.js` | `chooseHallDisplayInteractive` 関数追加、`createMainWindow` async 化、`display-picker:fetch` IPC ハンドラ、`app.whenReady` + `activate` を async 化 |
| `src/preload.js` | `dual.fetchDisplays` (invoke) / `dual.selectHallMonitor` (send) 追加 |
| `tests/v2-display-picker.test.js`（新規） | 8 件の静的解析テスト |
| `package.json` | test スクリプトに `v2-display-picker.test.js` 追加 |

---

## 3. 主要変更点

**main.js: chooseHallDisplayInteractive（毎回手動選択 + 「前回選択」参考保存）**

```js
async function chooseHallDisplayInteractive(displays) {
  if (!displays || displays.length < 2) return null;   // 単画面 early return
  const lastSelected = store.get('preferredHallDisplayId') || null;
  return new Promise((resolve) => {
    const pickerWin = new BrowserWindow({ ... additionalArguments: ['--role=picker'] ... });
    let resolved = false;
    const handler = (_event, displayId) => {
      if (resolved) return; resolved = true;
      ipcMain.removeListener('dual:select-hall-monitor', handler);
      if (typeof displayId === 'number' || typeof displayId === 'string') {
        store.set('preferredHallDisplayId', displayId);
        resolve(displayId);
      } else { resolve(null); }
      if (!pickerWin.isDestroyed()) pickerWin.close();
    };
    ipcMain.on('dual:select-hall-monitor', handler);
    pickerWin.on('closed', () => { /* キャンセル: store.set を呼ばない */ });
    pickerWin.loadFile(...);
  });
}
```

**main.js: createMainWindow async 化**

```js
async function createMainWindow() {
  const displays = screen.getAllDisplays();
  if (!displays || displays.length < 2) {
    return createOperatorWindow(displays && displays[0], true);   // operator-solo
  }
  const hallId = await chooseHallDisplayInteractive(displays);
  if (hallId == null) return createOperatorWindow(screen.getPrimaryDisplay(), true);  // キャンセル
  const hallDisplay = displays.find((d) => d.id === hallId);
  const operatorDisplay = displays.find((d) => d.id !== hallId) || screen.getPrimaryDisplay();
  createOperatorWindow(operatorDisplay, false);
  createHallWindow(hallDisplay);
  return mainWindow;
}
```

**main.js: display-picker:fetch ハンドラ**

```js
ipcMain.handle('display-picker:fetch', () => {
  const all = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  return {
    displays: all.map((d) => ({ id: d.id, label: d.label || '', bounds: { width, height }, isPrimary: d.id === primaryId })),
    lastSelected: store.get('preferredHallDisplayId') || null
  };
});
```

**preload.js: dual グループに追加**

```js
fetchDisplays: () => ipcRenderer.invoke('display-picker:fetch'),
selectHallMonitor: (displayId) => ipcRenderer.send('dual:select-hall-monitor', displayId)
```

**display-picker.js: カード生成 + 選択 / キャンセル**

```js
const data = await dual.fetchDisplays();
data.displays.forEach((d, i) => {
  const card = document.createElement('div');
  if (data.lastSelected != null && d.id === data.lastSelected) card.classList.add('is-last-selected');
  // ... ラベル fallback（Windows で空ラベルの場合「モニター N」）, 解像度, バッジ ...
  btn.addEventListener('click', () => dual.selectHallMonitor(d.id));
  list.appendChild(card);
});
cancelBtn.addEventListener('click', () => window.close());
```

---

## 4. 致命バグ保護への影響評価

| 致命バグ保護 | 影響評価 | 根拠 |
| --- | --- | --- |
| `resetBlindProgressOnly`（C.2.7-A）| **影響なし** | 本 STEP は起動時シーケンスとモニター選択 UI のみ。renderer.js / `handleReset` / `resetBlindProgressOnly` 経路には一切触らない |
| `timerState` destructure 除外（C.2.7-D Fix 3）| **影響なし** | IPC payload 構造に変更なし。新規 IPC は `display-picker:fetch` / `dual:select-hall-monitor` のみで `timerState` を扱わない |
| `ensureEditorEditableState` 4 重防御（C.1-A2 系）| **影響なし** | renderer.js のエディタ系経路は完全無変更 |
| AudioContext resume（C.1.7）| **影響なし** | `audio.js` / `_play()` は無変更。picker 起動中は audio 関連処理は走らない |
| runtime 永続化 8 箇所（C.1.8）| **影響なし** | runtime 永続化フックは無変更。新規 store キーは `preferredHallDisplayId`（参考情報のみ）で `tournamentRuntime` とは別系統 |

**結論**: 5 件すべて完全継承。STEP 4 で破壊的変更なし。

---

## 5. 並列起動した sub-agent / Task 数

**0 体**（直接実行、`skills/cc-operation-pitfalls.md` §1.1 公式推奨遵守）

調査・実装すべて main session で順次実行。

---

## 6. テスト結果

```
=== Summary: 7 + 6 + 9 + 9 + 5 + 4 + 7 + 8 + 8 + 12 + 19 + 24 + 8 + 6 + 6 + 8 + 8 + 8 = 162 passed / 0 failed ===
```

- 既存 138 件: すべて PASS
- STEP 2 新規 8 件 (v2-dual-sync): すべて PASS
- STEP 3 新規 8 件 (v2-role-guard): すべて PASS
- STEP 4 新規 8 件 (v2-display-picker): すべて PASS
  - T1: `display-picker.html` 存在 + CSP `script-src 'self'` + `data-role="picker"`
  - T2: inline script なし（外部 `display-picker.js` のみ）
  - T3: `display-picker.js` が `fetchDisplays` / `selectHallMonitor` / `window.close` を呼ぶ
  - T4: `chooseHallDisplayInteractive` は `displays.length < 2` で `null` 早期 return
  - T5: `display-picker:fetch` ハンドラ + `dual:select-hall-monitor` リスナの登録
  - T6: preload.js の `fetchDisplays` (invoke) / `selectHallMonitor` (send) 紐付け
  - T7: `createMainWindow` async 化、`hallId == null` 経路で `createOperatorWindow(_, true)`
  - T8: `store.set('preferredHallDisplayId')` は選択時のみ、`closed` コールバックでは呼ばれない

---

## 7. オーナー向け確認

1. **単画面 PC（HDMI なし）で起動**: モニター選択ダイアログは出ず、v1.3.0 と完全同じ画面が即座に表示されること
2. **2 画面環境（HDMI モニターあり）で起動**: 起動時に「ホール側のモニターを選択」ダイアログが表示され、検出されたモニターがカード形式で表示されること
   - 各カードに「ラベル / 解像度 / プライマリ表示の有無 / 前回選択バッジ」
   - 「このモニターをホール側にする」ボタンで該当モニターがホール側に、もう一方が PC 側に
   - 2 回目以降の起動では前回選択モニターに金色の「前回選択」バッジが表示される
3. **キャンセル**: ダイアログ下部の「キャンセル（単画面モードで起動）」を押す or ウィンドウを閉じると、操作 PC 側のみで `operator-solo` 起動（v1.3.0 同等）。前回選択は保存されない
4. **本フェーズで PR は未作成**（承認②で STEP 3+4+5 を 1 PR にまとめる方針）。承認①の PR #1 は main マージ済み
