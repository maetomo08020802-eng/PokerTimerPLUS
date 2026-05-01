# CC_REPORT — 2026-05-01 v2.0.4-rc3 試験版ビルド（× 保護 + キーフォワード）

## 1. サマリー

rc2 試験で確定した 2 件の問題を修正:
- **問題 1（致命的 UX）**: AC（operator window）を × で閉じると hall だけ残って操作不能 → 確認ダイアログ + OK で `app.quit()` 全体終了の保護を追加
- **問題 2（UX 不便）**: hall focused 時に Space 等の操作キーが効かない → 操作系キーを `before-input-event` で捕捉し `sendInputEvent` で operator に転送

新規テスト 11 件追加で **244 → 255 テスト全 PASS**、`.exe` 再ビルド成功。

## 2. ビルド成果物

| 項目 | 値 |
|---|---|
| **絶対パス** | `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc3.exe` |
| **ファイルサイズ** | 82,965,234 bytes（約 80 MB）|
| **version** | `2.0.4-rc3`（latest.yml で確認済）|
| **productName** | `PokerTimerPLUS+ (Test)`（rc1/rc2 と同じ）|
| **appId** | `com.shitamachi.pokertimerplus.test`（rc1/rc2 と同じ）|
| **推定 userData path** | `%APPDATA%\PokerTimerPLUS+ (Test)\` |
| **生成日時** | 2026-05-01T06:51:21.278Z |

## 3. 修正対象ファイルと変更箇所

| ファイル | 変更箇所 | 内容 |
|---|---|---|
| `src/main.js` | 新規定数 (~L909) | `FORWARD_KEYS_FROM_HALL` Set + `_toAcceleratorKey` ヘルパ追加 |
| `src/main.js` | `createOperatorWindow` (~L1011) | `win.on('close', ...)` で showMessageBoxSync 確認、`win._suppressCloseConfirm` で bypass 可能 |
| `src/main.js` | `createHallWindow` (~L1060) | `webContents.on('before-input-event', ...)` で操作系キーを `mainWindow.webContents.sendInputEvent` に転送 + preventDefault |
| `src/main.js` | `switchOperatorToSolo` / `switchSoloToOperator` | close 直前に `_suppressCloseConfirm = true` 設定（確認ダイアログ抑制）|
| `src/main.js` | `confirmQuit` | `app.quit()` 直前に `_suppressCloseConfirm = true` 設定（二重ダイアログ防止）|
| `package.json` | `version` | `2.0.4-rc2` → `2.0.4-rc3` |
| `package.json` | `scripts.test` | `tests/v204-window-protection.test.js` 追加 |
| `tests/v130-features.test.js` | T11 行 137 | version 期待値 → `2.0.4-rc3`（rc1 で構築士追認済の継続適用）|
| `tests/v204-window-protection.test.js` | 新規 | 11 件の静的解析（close ハンドラ / showMessageBoxSync / bypass 設定 3 経路 / before-input-event / sendInputEvent / FORWARD_KEYS / 既存挙動保護 / race ガード cross-check）|

## 4. 修正コード抜粋

### B-1: operator close 保護（main.js）
```js
win._suppressCloseConfirm = false;
win.on('close', (event) => {
  if (win._suppressCloseConfirm) return;
  event.preventDefault();
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: ['アプリを終了', 'キャンセル'],
    defaultId: 1, cancelId: 1,
    title: '操作画面を閉じますか？',
    message: '操作画面を閉じるとアプリ全体が終了します。よろしいですか？'
  });
  if (choice === 0) {
    win._suppressCloseConfirm = true;
    app.quit();
  }
});
```

bypass 経路（`mainWindow._suppressCloseConfirm = true` を close 前に設定）:
- `switchOperatorToSolo`（HDMI 抜き → solo モード切替）
- `switchSoloToOperator`（HDMI 接続 → 2 画面モード切替）
- `confirmQuit`（Ctrl+Q 経由の終了確認後）

### B-2: hall キーフォワード（main.js）
```js
win.webContents.on('before-input-event', (event, input) => {
  if (input.type !== 'keyDown') return;
  if (!FORWARD_KEYS_FROM_HALL.has(input.key)) return;
  event.preventDefault();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const modifiers = [];
  if (input.shift)   modifiers.push('shift');
  if (input.control) modifiers.push('control');
  if (input.alt)     modifiers.push('alt');
  if (input.meta)    modifiers.push('meta');
  try {
    mainWindow.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: _toAcceleratorKey(input.key),
      modifiers
    });
  } catch (_) { /* mainWindow transition 中は黙って無視 */ }
});
```

## 5. FORWARD_KEYS の確定リスト

### Forward 対象（操作系、計 18 キー）

| キー | 用途 | 備考 |
|---|---|---|
| `' '` (Space) | start/pause toggle | `keyCode: 'Space'` |
| `Enter` | ダイアログ確定 | そのまま |
| `Escape` | ダイアログキャンセル | `keyCode: 'Esc'` |
| `ArrowUp` | プレイヤー +1 / Shift+↑ で取消 | `keyCode: 'Up'` |
| `ArrowDown` | プレイヤー -1 / Shift+↓ で復活 | `keyCode: 'Down'` |
| `ArrowLeft` | 30 秒戻す | `keyCode: 'Left'` |
| `ArrowRight` | 30 秒進める | `keyCode: 'Right'` |
| `r` / `R` | reset / Ctrl+R reentry | letters そのまま |
| `a` / `A` | Ctrl+A addon | |
| `e` / `E` | Ctrl+E special stack | |
| `s` / `S` | settings dialog | |
| `m` / `M` | mute toggle | |
| `h` / `H` | bottom bar toggle | |
| `t` / `T` | Ctrl+T marquee | |

### Forward 対象外（理由を明記）

| キー | 理由 |
|---|---|
| `F11` | rc2 で `getFocusedWindow` ベースに改修済。hall focused 時は hall 自身の全画面切替が望ましい挙動のため forward しない |
| `F12` | DevTools はウィンドウごとに独立すべき。hall の DevTools は hall 用、operator の DevTools は operator 用 |
| その他のすべての文字キー / ファンクションキー | 既存ショートカットでない（誤転送防止）|

## 6. テスト結果

| 件数 | 結果 |
|---|---|
| **255** | **全 PASS（0 件 FAIL）** |

内訳:
- 既存 138 件（v1.x〜v2.0.0）→ 全 PASS
- v2 専用 7 ファイル 52 件 → 全 PASS
- v2-window-race 4 件 / v2-stabilization 27 件 / v2-cleanup 8 件 / v2-coverage 9 件 → 全 PASS
- v204-hall-fullscreen 6 件（rc2）→ 全 PASS
- **v204-window-protection 11 件（rc3 新規）→ 全 PASS**

## 7. 致命バグ保護 5 件への影響評価

すべて影響なし:
- C.2.7-A `resetBlindProgressOnly`: 影響なし（main.js のウィンドウ管理層のみ変更）
- C.2.7-D `setDisplaySettings` destructure: 影響なし
- C.1-A2 `ensureEditorEditableState`: 影響なし
- C.1.7 AudioContext resume: 影響なし
- C.1.8 runtime 永続化: 影響なし

cross-check テスト（v204-window-protection 内）で v2.0.1 race 防止パターンも維持確認。

## 8. operator-solo モード（v1.3.0 互換）への影響評価

**close 確認ダイアログは operator-solo でも適用**（プロンプト指示通り）:
- 単画面モードでも × ボタンで「アプリを終了？」ダイアログが表示される
- 操作ミス防止は普遍的価値（v1.3.0 ユーザーにも有益）
- `confirmQuit` / `switchOperatorToSolo` / `switchSoloToOperator` は bypass 設定済のため通常の終了経路は無音通過

**hall キーフォワード（before-input-event）は operator-solo に影響しない**:
- そもそも operator-solo モードでは hallWindow が生成されない（`createHallWindow` は呼ばれない）
- `mainWindow.webContents.sendInputEvent` の呼出元が存在しない

`createOperatorWindow` には `fullscreen: true` を**追加していない**（rc2 と同じ、v1.3.0 互換維持）。

## 9. 並列 sub-agent 数

0 体（プロンプト指示通り、修正範囲が明確で並列不要）

## 10. ブランチ状態

- 現在ブランチ: `feature/v2.0.4-rc1-test-build`（rc1/rc2/rc3 連続使用、プロンプト指示）
- main マージ: しない（プロンプト指示）
- リモート push: しない（プロンプト指示）
- ローカルコミット: 実施予定（rc1/rc2/rc3 の差分追跡可能に）

## 11. オーナー向け確認

1. **試験版 rc3 インストーラ生成完了**:
   `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc3.exe`（約 80MB）

2. **前原さん再試験手順**:
   - rc2 アンインストール（コントロールパネル → プログラムと機能）
   - rc3 .exe をダブルクリック → SmartScreen → 「詳細情報」→「実行」→ インストール先選択
   - 起動して 2 画面モードで動作確認

3. **試験項目（rc3 で新たに確認したい点）**:
   - **AC を × ボタンで閉じようとする** → 「操作画面を閉じますか？」ダイアログが表示されるか
   - **「キャンセル」を選ぶ** → ダイアログが閉じてアプリは継続
   - **「アプリを終了」を選ぶ** → AC と B 両方が閉じてアプリ全体が終了
   - **B（ホール画面）にフォーカスを当てた状態で Space を押す** → AC のタイマーが start/pause する
   - **B にフォーカスして R を押す** → AC のリセットダイアログが開く
   - **B にフォーカスして F11 を押す** → B（hall）の全画面が toggle される（AC ではなく hall が反応）

4. **既存挙動の維持確認**:
   - HDMI 抜き差し → solo / 2 画面切替時に「閉じますか？」が**出ない**
   - Ctrl+Q（または confirmQuit 経由の終了）→ 既存ダイアログのみ表示、二重ダイアログにならない
