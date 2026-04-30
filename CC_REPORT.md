# CC_REPORT — 2026-05-01 v2.0.0 STEP 5: HDMI 抜き差し追従【承認②対象】

## 1. サマリー

- `src/main.js` に `screen.on('display-added')` / `screen.on('display-removed')` のイベント駆動追従を実装（ポーリング禁止）
- `switchOperatorToSolo` / `switchSoloToOperator` でウィンドウ再生成方式の role 切替（`additionalArguments` は process.argv 注入のため reload では変更不可、再生成必須）
- `isWindowOnDisplay` ヘルパー追加（windowBounds.x/y vs display.bounds 矩形判定）
- `app.whenReady` 末尾で `setupDisplayChangeListeners()` を呼出して購読開始
- `src/renderer/renderer.js`: operator-solo 起動時に `ensureAudioReady()` 明示呼出（HDMI 抜き直後の音欠落防止、C.1.7 を踏襲・強化）
- `tests/v2-display-change.test.js`（新規、8 件）+ `package.json` 更新
- 既存 138 + STEP 2/3/4/5 新規 32 = **170 件すべて PASS**
- 致命バグ保護 5 件すべて影響なし、commit `3f584ca` push 済
- **承認②の PR 作成完了**: <https://github.com/maetomo08020802-eng/PokerTimerPLUS/pull/2>（STEP 3+4+5 まとめ）

---

## 2. 修正ファイル

| ファイル | 変更点（短く） |
| --- | --- |
| `src/main.js` | `isWindowOnDisplay` / `switchOperatorToSolo` / `switchSoloToOperator` / `setupDisplayChangeListeners` 追加、`app.whenReady` で購読開始 |
| `src/renderer/renderer.js` | operator-solo 経路に `ensureAudioReady()` 明示呼出追加 |
| `tests/v2-display-change.test.js`（新規） | 8 件の静的解析テスト |
| `package.json` | test スクリプトに `v2-display-change.test.js` 追加 |

---

## 3. 主要変更点

**main.js: イベント駆動追従（ポーリング不使用、screen API のみ）**

```js
function setupDisplayChangeListeners() {
  screen.on('display-removed', async (_event, removedDisplay) => {
    if (!hallWindow || hallWindow.isDestroyed()) return;
    const bounds = hallWindow.getBounds();
    if (isWindowOnDisplay(bounds, removedDisplay)) {
      hallWindow.close(); hallWindow = null;
      await switchOperatorToSolo();
    }
  });
  screen.on('display-added', async () => {
    const displays = screen.getAllDisplays();
    if (!displays || displays.length < 2) return;
    if (hallWindow && !hallWindow.isDestroyed()) return;
    const hallId = await chooseHallDisplayInteractive(displays);
    if (hallId == null) return;
    await switchSoloToOperator(displays.find((d) => d.id === hallId));
  });
}
```

**main.js: ウィンドウ再生成方式（reload では role 変更不可なため）**

```js
async function switchOperatorToSolo() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.close(); mainWindow = null;
  createOperatorWindow(screen.getPrimaryDisplay(), true);   // operator-solo で再生成
}
async function switchSoloToOperator(hallDisplay) {
  if (!mainWindow || mainWindow.isDestroyed() || !hallDisplay) return;
  mainWindow.close(); mainWindow = null;
  createOperatorWindow(screen.getPrimaryDisplay(), false);  // operator で再生成
  createHallWindow(hallDisplay);
}
```

**main.js: isWindowOnDisplay ヘルパー（左上座標で判定）**

```js
function isWindowOnDisplay(windowBounds, display) {
  if (!windowBounds || !display || !display.bounds) return false;
  const wb = windowBounds, db = display.bounds;
  return wb.x >= db.x && wb.x < db.x + db.width &&
         wb.y >= db.y && wb.y < db.y + db.height;
}
```

**renderer.js: operator-solo 経路で ensureAudioReady() 明示呼出**

```js
} else {
  // operator-solo（単画面、デフォルト）: v1.3.0 と完全同等。
  // v2.0.0 STEP 5: HDMI 抜き直後にウィンドウ再生成 → AudioContext suspend の可能性、
  //   C.1.7 の _play() 内 resume を待たずに起動直後の安全側として明示呼出（冪等）。
  initialize();
  ensureAudioReady();
}
```

---

## 4. 致命バグ保護への影響評価

| 致命バグ保護 | 影響評価 | 根拠 |
| --- | --- | --- |
| `resetBlindProgressOnly`（C.2.7-A）| **影響なし** | renderer 側のリセット経路は無変更。STEP 5 は main 側のウィンドウ管理のみ |
| `timerState` destructure 除外（C.2.7-D Fix 3）| **影響なし** | IPC payload 構造に変更なし。`_publishDualState('timerState', ...)` は STEP 2 から維持 |
| `ensureEditorEditableState` 4 重防御（C.1-A2 系）| **影響なし** | renderer エディタ系経路に変更なし |
| **AudioContext resume（C.1.7）**| **強化** | operator-solo 起動時に `ensureAudioReady()` 明示呼出を追加。`_play()` 内 resume はそのまま、最初の音発火を待たずに resume を試みる経路を追加（T6 で静的担保）。HDMI 抜き直後のウィンドウ再生成シナリオで音欠落リスクを最小化 |
| runtime 永続化 8 箇所（C.1.8）| **影響なし** | renderer 側の `schedulePersistRuntime` 経路は無変更。`_dualStateCache` の `tournamentRuntime` 保持も STEP 2 から維持 |

**結論**: 5 件すべて完全継承、AudioContext は強化方向。STEP 5 で破壊的変更なし。

`_broadcastDualState` の hall 不在 no-op ガード（STEP 2 実装）も T8 で再確認、HDMI 抜きで `hallWindow = null` になった瞬間から自動的に broadcast が止まる設計が機能。

---

## 5. 並列起動した sub-agent / Task 数

**0 体**（直接実行、`skills/cc-operation-pitfalls.md` §1.1 公式推奨遵守）

調査・実装すべて main session で順次実行。

---

## 6. テスト結果

```
=== Summary: 7 + 6 + 9 + 9 + 5 + 4 + 7 + 8 + 8 + 12 + 19 + 24 + 8 + 6 + 6 + 8 + 8 + 8 + 8 = 170 passed / 0 failed ===
```

- 既存 138 件: すべて PASS
- STEP 2 新規 8 (v2-dual-sync): すべて PASS
- STEP 3 新規 8 (v2-role-guard): すべて PASS
- STEP 4 新規 8 (v2-display-picker): すべて PASS
- STEP 5 新規 8 (v2-display-change): すべて PASS
  - T1: `setupDisplayChangeListeners` 関数定義 + `screen.on('display-added' / 'display-removed')` 両方
  - T2: `display-removed` ハンドラで `hallWindow.close` + `switchOperatorToSolo` 呼出
  - T3: `display-added` ハンドラで `displays.length < 2` 早期 return + `chooseHallDisplayInteractive` 再呼出
  - T4: `switchOperatorToSolo` / `switchSoloToOperator` がウィンドウ再生成方式（`webContents.reload` 不使用）
  - T5: `isWindowOnDisplay` が `windowBounds.x/y` と `display.bounds` で重なり判定
  - T6: renderer.js の operator-solo 経路で `ensureAudioReady()` 明示呼出（**AudioContext 再初期化対策**）
  - T7: ポーリング不使用（`setInterval` で displays 監視なし）
  - T8: `_broadcastDualState` の hall 不在 no-op ガードが維持されている

---

## 7. オーナー向け確認

1. **単画面 PC（HDMI なし）で起動**: v1.3.0 配布版と完全同じ動作になるか（変化なし、operator-solo モード）
2. **2 画面環境（HDMI モニターあり）で起動**: 起動時にモニター選択ダイアログが表示され、選択した側がホール側になり、PC 側 ↔ ホール側で状態が同期するか
3. **営業中に HDMI を抜く**（**承認②の判定軸**）: ホール側ウィンドウが閉じ、PC 側が単画面モード（operator-solo、v1.3.0 同等の見た目）に自動復帰すること。タイマー進行が中断されない、音が継続する
4. **抜いた後に HDMI を再接続**（**承認②の判定軸**）: モニター選択ダイアログが自動表示され、選択 → 2 画面モードに復帰、状態が自動復元される
5. **PR**: <https://github.com/maetomo08020802-eng/PokerTimerPLUS/pull/2> をブラウザで開いて中身を確認 → マージ判断（前原さんがマージ操作）。承認①の PR #1 は既に main マージ済み、本 PR が STEP 3+4+5 の集約マージ
