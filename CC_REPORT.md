# CC_REPORT — 2026-05-01 v2.0.4-rc4 試験版ビルド（キーフォワード IPC 化 + AC 中身刷新）

## 1. サマリー

rc3 試験で確定した 2 件の致命的問題を構築士追認の方針通り修正:

- **問題 1（R / Ctrl+E 等 13 キー無反応）**: `sendInputEvent` 方式（letter キーで `event.code` が空文字になる Electron 31 系の構造的制約）から **IPC 化** に切替。`hall:forwarded-key` チャネルで論理キーオブジェクトを直接 operator に送り、`dispatchClockShortcut(eventLike)` 共通関数で同じ分岐を流用
- **問題 2（写真表示 + 操作不能 UI）**: AC（operator role）ウィンドウから body 背景画像を CSS で打ち消し、フォーカス案内 + 7 件運用情報 + 25 件操作一覧を含む `.operator-pane` を新規追加
- F1 キーガイドは specs.md §7 から削除（AC 操作一覧で代替）

新規テスト 27 件追加（rc4-keyforward 12 件 + rc4-operator-pane 15 件）+ 既存テスト 2 件更新で **255 → 282 全 PASS**、`.exe` 再ビルド成功。

## 2. ビルド成果物

| 項目 | 値 |
|---|---|
| **絶対パス** | `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc4.exe` |
| **ファイルサイズ** | 82,967,873 bytes（約 80 MB）|
| **version** | `2.0.4-rc4`（latest.yml で確認済）|
| **productName** | `PokerTimerPLUS+ (Test)`（rc1〜rc3 と同じ）|
| **appId** | `com.shitamachi.pokertimerplus.test`（rc1〜rc3 と同じ）|
| **生成日時** | 2026-05-01T07:54:55.776Z |

## 3. 修正対象ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/main.js` | `FORWARD_KEYS_FROM_HALL` を input.code ベース（`'KeyR'` 等）に置換 / `_toAcceleratorKey` ヘルパ削除 / `before-input-event` で `mainWindow.webContents.send('hall:forwarded-key', ...)` IPC 送信 |
| `src/preload.js` | `dual.onHallForwardedKey(callback)` 公開、`ipcRenderer.on('hall:forwarded-key', ...)` で listen |
| `src/renderer/renderer.js` | keydown 本体を `dispatchClockShortcut(eventLike)` に関数化 / IPC 受信ハンドラ追加（operator 限定）/ `updateOperatorPane(state)` 新規 + `subscribe` 末尾で呼出 |
| `src/renderer/index.html` | `<section class="operator-pane" id="js-operator-pane" hidden>` 追加（フォーカス案内 + 運用情報 dl + 操作一覧 ul）|
| `src/renderer/style.css` | `[data-role="operator"][data-bg="image"] body { background-image: none }` 写真消去 / `[data-role="operator"] .operator-pane` 一式追加 |
| `docs/specs.md` | §7 から F1 行削除 + 「AC 操作一覧で代替」追記 |
| `package.json` | `version`: `2.0.4-rc3` → `2.0.4-rc4` / `scripts.test` に新規 2 ファイル追加 |
| `tests/v130-features.test.js` | T11 version 期待値 → `2.0.4-rc4` |
| `tests/v2-coverage.test.js` | B-1 を rc4 refactor に追従（`dispatchClockShortcut` 内のガード検証）|
| `tests/v204-window-protection.test.js` | rc3 の sendInputEvent / `_toAcceleratorKey` 検証を rc4 IPC 化検証に更新 |
| `tests/v204-rc4-keyforward.test.js` | 新規 12 件（FORWARD_KEYS / IPC 経路 / dispatcher / 致命バグ保護）|
| `tests/v204-rc4-operator-pane.test.js` | 新規 15 件（HTML 構造 / CSS 3 重防御 / JS role guard / read only / 致命バグ保護）|

## 4. 修正コード抜粋

### IPC 経路（main.js）
```js
const FORWARD_KEYS_FROM_HALL = new Set([
  'Space', 'Enter', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyR', 'KeyA', 'KeyE', 'KeyS', 'KeyM', 'KeyT'
]);

win.webContents.on('before-input-event', (event, input) => {
  if (input.type !== 'keyDown') return;
  if (!FORWARD_KEYS_FROM_HALL.has(input.code)) return;
  event.preventDefault();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('hall:forwarded-key', {
      code: input.code, key: input.key,
      shift: input.shift, control: input.control,
      alt: input.alt, meta: input.meta
    });
  } catch (_) { /* mainWindow transition 中は黙って無視 */ }
});
```

### dispatchClockShortcut（renderer.js）
```js
function dispatchClockShortcut(event) {
  if (el.resetDialog?.open) return;
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyT') {
    event.preventDefault(); openMarqueeDialog(); return;
  }
  if (document.querySelector('dialog[open]')) return;
  switch (event.code) { /* 既存と同じ 11 case + default */ }
}

window.addEventListener('keydown', (event) => {
  // 入力フィールドガードはローカル keydown 専用
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
                 target.tagName === 'SELECT' || target.isContentEditable)) return;
  dispatchClockShortcut(event);
});

if (typeof window !== 'undefined' && window.appRole === 'operator') {
  window.api?.dual?.onHallForwardedKey?.((data) => {
    if (!data || typeof data.code !== 'string') return;
    dispatchClockShortcut({
      code: data.code, key: data.key,
      ctrlKey: !!data.control, shiftKey: !!data.shift,
      altKey: !!data.alt, metaKey: !!data.meta,
      preventDefault: () => {}, stopPropagation: () => {}
    });
  });
}
```

### updateOperatorPane（renderer.js、要点のみ）
```js
const _STATUS_JP_MAP = {
  idle: '開始前', 'pre-start': 'カウントダウン中', prestart: 'カウントダウン中',
  running: '進行中', paused: '一時停止', break: 'ブレイク中', finished: '終了'
};
function updateOperatorPane(state) {
  if (typeof window === 'undefined' || window.appRole !== 'operator') return;
  const pane = document.getElementById('js-operator-pane');
  if (!pane) return;
  if (pane.hasAttribute('hidden')) pane.removeAttribute('hidden');
  // イベント名 / 状態 / 現/次ブラインド / プレイヤー / 平均スタック / リエントリー / アドオン を read のみで反映
}
```

## 5. テスト結果

| 件数 | 結果 |
|---|---|
| **282** | **全 PASS（0 件 FAIL）** |

内訳:
- 既存 138 件（v1.x〜v2.0.0）→ 全 PASS
- v2 専用 7 ファイル 52 件 → 全 PASS
- v2-window-race 4 件 / v2-stabilization 27 件 / v2-cleanup 8 件 / v2-coverage 9 件 → 全 PASS
- v204-hall-fullscreen 6 件（rc2）→ 全 PASS
- v204-window-protection 11 件（rc3）→ 全 PASS（rc4 で 2 件更新）
- **v204-rc4-keyforward 12 件（新規）→ 全 PASS**
- **v204-rc4-operator-pane 15 件（新規）→ 全 PASS**

## 6. 致命バグ保護 5 件への影響評価

すべて影響なし:
- C.2.7-A `resetBlindProgressOnly`: 影響なし（リセット系は rc4 で touch しない）
- C.2.7-D `setDisplaySettings` destructure: 影響なし（main.js の display IPC は変更なし）
- C.1-A2 `ensureEditorEditableState`: 影響なし
- C.1.7 AudioContext resume: 影響なし
- C.1.8 runtime 永続化 8 箇所: 影響なし（dispatchClockShortcut の case で adjustReentry / adjustAddOn 等 8 関数すべて維持、cross-check テスト T11 で確認）

## 7. operator-solo モード（v1.3.0 互換）への影響評価（3 重防御の確認）

| 防御層 | 実装 | 検証 |
|---|---|---|
| HTML hidden | `<section class="operator-pane" hidden>` 初期非表示 | rc4-operator-pane.test.js HTML-1 で確認 |
| CSS `[data-role]` | `[data-role="operator"] .operator-pane { display: flex }` のみで打ち消し | CSS-1, CSS-2 で確認（operator-solo / hall に display 上書きルールなし）|
| JS guard | `updateOperatorPane()` 冒頭 `if (window.appRole !== 'operator') return;` | JS-2 で確認 |

写真消去ルール `[data-role="operator"][data-bg="image"] body` も attribute selector の完全一致仕様により `operator-solo` には絶対マッチしない（CSS-4 で確認）。

キーフォワード IPC 化も `createHallWindow` 内部のロジックのみ。`operator-solo` モードでは `hallWindow === null` のため `before-input-event` ハンドラ自体が登録されない → **operator-solo に一切影響なし**。

## 8. specs.md §7 F1 削除の差分

```diff
 | Space | 一時停止 / 再開 |
 | Enter | スタート (待機状態のとき) |
-| F1 | キーガイド表示 |
 | F2 | メインクロック ⇄ 設定画面 切替 |
```

末尾に注記追加:
```
> v2.0.4-rc4 以降: F1 キーガイドは削除。AC（operator role、2 画面 PC 側）ウィンドウに常時操作一覧が表示されるため不要。
> ※ 上表のキーは仕様時点の表記であり、実装側の挙動と一部乖離があります（例: ←/→ は実装では 30 秒単位、↑/↓ は新規エントリー追加 / 脱落）。配布前の仕様書再整備は別フェーズで実施予定。
```

specs.md の他の差分（←/→/↑/↓ の意味差、Ctrl+H/Ctrl+M/Ctrl+Z）は今回 touch せず（プロンプト指示「F1 削除のみ許可」に厳守）。

## 9. 並列 sub-agent 数

**0 体**（プロンプト指示通り、修正範囲が明確で並列不要）

## 10. ブランチ状態

- 現在ブランチ: `feature/v2.0.4-rc1-test-build`（rc1 → rc2 → rc3 → rc4 連続使用）
- main マージ: しない（プロンプト指示）
- リモート push: しない（プロンプト指示）
- ローカルコミット: 実施予定（rc3 → rc4 差分追跡）

## 11. オーナー向け確認

1. **試験版 rc4 インストーラ生成完了**:
   `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\dist\PokerTimerPLUS+ (Test) Setup 2.0.4-rc4.exe`（約 80MB）

2. **前原さん再試験手順**:
   - rc3 アンインストール → rc4 インストール
   - 起動して 2 画面モードで動作確認

3. **rc4 で確認していただきたい点**:
   - **AC ウィンドウから写真が消えている**こと
   - AC ウィンドウに**フォーカス案内文言**「このウィンドウをクリックすると、会場モニターを操作できます」が表示されている
   - AC ウィンドウに**運用情報 7 項目**（イベント名 / 状態 / 現ブラインド / 次ブラインド / プレイヤー / 平均スタック / リエントリー・アドオン）が表示されている
   - AC ウィンドウに**操作一覧 25 件**が表示されている
   - **B（hall）にフォーカスを合わせて R を押す** → AC のリセットダイアログが開く（rc3 で無反応だった）
   - **B にフォーカスして Ctrl+E** → AC で特殊スタックが +1（rc3 で無反応だった）
   - **B にフォーカスして S / M / Ctrl+T** など他の letter 系キー → AC で正常動作
   - **B にフォーカスして H** → AC では反応しない（前原さん判断、PC 側のみで動作）
   - 既存挙動（HDMI 抜き差し / × ボタン確認 / Space / 矢印 / F11 など）が崩れていないこと
