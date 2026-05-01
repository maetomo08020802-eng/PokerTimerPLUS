# v2.0.4-rc4 実装: キーフォワード IPC 化 + AC ウィンドウ中身刷新 + ビルド

## 構築士判断（前原さん追認 2026-05-01）

| 項目 | 採用 |
|---|---|
| キーフォワード修正方針 | **オプション A（IPC 化）** |
| AC フォーカス案内文言 | **C-1**（行動 + 理由補足）|
| AC 追加表示項目 | **D-1 の 7 件** |
| 操作一覧表の内容 | **実コード優先**（specs.md §7 とは別） |
| F1 キーガイド | **仕様削除**（AC 操作一覧で代替）|

---

## 重要前提（厳守）

- **operator-solo モード（v1.3.0 互換）の見た目は完全同等を維持**（3 重防御で実装）
- AC ウィンドウ中身刷新は **operator role 限定**、operator-solo / hall には適用しない
- 既存 138 + 244 = 既に通っている全テスト維持
- 致命バグ保護 5 件への変更禁止

---

## 修正項目（合計 5 つ）

### 修正 1: キーフォワード IPC 化（オプション A）

#### 1-1. `src/main.js` 改修

- 既存 `FORWARD_KEYS_FROM_HALL` Set を `input.code` ベースに置換:
  ```js
  const FORWARD_KEYS_FROM_HALL = new Set([
    'Space', 'Enter', 'Escape',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'KeyR', 'KeyA', 'KeyE', 'KeyS', 'KeyM', 'KeyT'
    // KeyH は前原さん判断で forward 対象外維持
  ]);
  ```
- `before-input-event` 内を IPC 送信に置換:
  ```js
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!FORWARD_KEYS_FROM_HALL.has(input.code)) return;
    event.preventDefault();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('hall:forwarded-key', {
      code: input.code,
      key: input.key,
      shift: input.shift,
      control: input.control,
      alt: input.alt,
      meta: input.meta,
    });
  });
  ```
- 既存 `_toAcceleratorKey` ヘルパは削除（不要）

#### 1-2. `src/preload.js` 改修

- 新 IPC 経路 `onHallForwardedKey(callback)` を contextBridge で公開
- 既存の他 API は触らない

#### 1-3. `src/renderer/renderer.js` 改修

- 既存 document keydown ハンドラの switch 本体を関数化（`dispatchClockShortcut(eventLike)`）
- 既存 keydown ハンドラはこの関数を呼出すだけに refactor（**挙動完全維持**）
- IPC 受信で同じ関数を呼出:
  ```js
  window.electronAPI?.onHallForwardedKey?.((data) => {
    dispatchClockShortcut({
      code: data.code,
      key: data.key,
      ctrlKey: data.control,
      shiftKey: data.shift,
      altKey: data.alt,
      metaKey: data.meta,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  });
  ```

### 修正 2: 写真消去（CSS only）

`src/renderer/style.css` 末尾に追加:

```css
/* v2.0.4-rc4: operator role でのみ body 背景画像を打ち消す */
[data-role="operator"][data-bg="image"] body {
  background-image: none !important;
  background-color: #0A1F3D !important;
}
```

operator-solo / hall には影響なし（attribute selector で `operator` のみマッチ）。

### 修正 3: AC ウィンドウ中身刷新（operator-pane 追加）

#### 3-1. `src/renderer/index.html`

`.operator-status-bar` 閉じタグ直後（行 32 付近）に新規 section 追加:

```html
<section class="operator-pane" id="js-operator-pane" hidden>
  <div class="operator-pane__notice">
    このウィンドウをクリックすると、会場モニターを操作できます。<br>
    （キーボードのショートカットがすべて反応する状態になります）
  </div>
  <div class="operator-pane__body">
    <div class="operator-pane__col operator-pane__col--info">
      <h2 class="operator-pane__heading">運用情報</h2>
      <dl class="operator-pane__info-list">
        <dt>イベント名</dt><dd id="op-pane-event-name">-</dd>
        <dt>状態</dt><dd id="op-pane-status">-</dd>
        <dt>現ブラインド</dt><dd id="op-pane-current-blind">-</dd>
        <dt>次ブラインド</dt><dd id="op-pane-next-blind">-</dd>
        <dt>プレイヤー</dt><dd id="op-pane-players">-</dd>
        <dt>平均スタック</dt><dd id="op-pane-avg-stack">-</dd>
        <dt>リエントリー / アドオン</dt><dd id="op-pane-reentry-addon">-</dd>
      </dl>
    </div>
    <div class="operator-pane__col operator-pane__col--shortcuts">
      <h2 class="operator-pane__heading">操作一覧</h2>
      <ul class="operator-pane__shortcut-list">
        <!-- ★★★ よく使う -->
        <li><kbd>Space</kbd> 一時停止 / 再開</li>
        <li><kbd>Enter</kbd> スタート（開始前）</li>
        <li><kbd>→</kbd> 残り時間 -30 秒（早送り）</li>
        <li><kbd>←</kbd> 残り時間 +30 秒（巻き戻し）</li>
        <li><kbd>↑</kbd> 新規エントリー追加</li>
        <li><kbd>↓</kbd> プレイヤー脱落</li>
        <li><kbd>Ctrl</kbd>+<kbd>R</kbd> リエントリー +1</li>
        <li><kbd>Ctrl</kbd>+<kbd>A</kbd> アドオン +1</li>
        <li><kbd>S</kbd> 設定ダイアログ</li>
        <!-- ★★ -->
        <li><kbd>Shift</kbd>+<kbd>↑</kbd> 新規エントリー取消</li>
        <li><kbd>Shift</kbd>+<kbd>↓</kbd> 脱落取消（復活）</li>
        <li><kbd>R</kbd> リセットダイアログ</li>
        <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> リエントリー -1</li>
        <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> アドオン -1</li>
        <li><kbd>Ctrl</kbd>+<kbd>E</kbd> 特別スタック +1</li>
        <li><kbd>Ctrl</kbd>+<kbd>T</kbd> マーキー編集</li>
        <!-- ★ -->
        <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> 特別スタック -1</li>
        <li><kbd>M</kbd> ミュート切替</li>
        <li><kbd>H</kbd> ボトムバー非表示</li>
        <li><kbd>F2</kbd> メイン⇄設定切替</li>
        <li><kbd>F11</kbd> フルスクリーン切替</li>
        <li><kbd>Ctrl</kbd>+<kbd>Q</kbd> アプリ終了</li>
        <li><kbd>F12</kbd> 開発者ツール</li>
        <li><kbd>Esc</kbd> ダイアログを閉じる</li>
      </ul>
    </div>
  </div>
</section>
```

#### 3-2. `src/renderer/style.css`

operator-pane 用 CSS を追加（雛形は CC 判断で実装、要件:）:
- `[data-role="operator"] .operator-pane { display: flex !important; ... }` で operator のみ表示
- `position: fixed; top: 36px; bottom: 0; left: 0; right: 0; z-index: 90`（既存 status bar 36px の下）
- 2 カラムレイアウト（左 = 運用情報 35%、右 = 操作一覧 65%、レスポンシブ調整可）
- ★★★ / ★★ / ★ の優先度を視覚的に区別（CSS color や背景色で軽く差別化、操作一覧の見やすさ重視）
- `<kbd>` タグはモノスペースっぽい見た目（既存フォント `JetBrains Mono` を流用可）
- 配色は既存の dark 系（`#0A1F3D` 系）と整合

#### 3-3. `src/renderer/renderer.js`

- 新規 `updateOperatorPane(state)` 関数を `updateOperatorStatusBar` の隣に追加
- 関数冒頭で `if (window.appRole !== 'operator') return;` の early return（3 重防御の JS 層）
- state から 7 項目の値を抽出して各 `<dd>` に textContent 設定
- 状態の日本語化マップ:
  - `idle` → 「開始前」
  - `pre-start` → 「カウントダウン中」
  - `running` → 「進行中」
  - `paused` → 「一時停止」
  - `break` → 「ブレイク中」
  - `finished` → 「終了」
- subscribe 末尾で `updateOperatorPane(state)` を呼出（既存 `updateOperatorStatusBar` の隣に追加）
- 「次ブラインド」は現 level の次レベルを `tournament.blinds[currentLevelIndex + 1]` で取得（無ければ「-」）
- 「リエントリー / アドオン」は `tournamentRuntime` から `reentryCount` / `addOnCount` を読む

### 修正 4: docs/specs.md §7 から F1 削除

- §7 にある「F1: キーガイド表示」の記述を削除
- 代わりに「AC ウィンドウ（operator）に常時操作一覧が表示される」の旨追記
- specs.md の他の箇所（実装と乖離している ←→ や ↑↓ の記述）は今回触らない（別フェーズ）

### 修正 5: バージョン rc3 → rc4

- `package.json`: `2.0.4-rc3` → `2.0.4-rc4`
- `tests/v130-features.test.js` T11 同期更新（rc1 で追認済の継続適用）

---

## 手順

### STEP A: 修正実装（修正 1〜5 を順次）

### STEP B: テスト追加

新規 `tests/v204-rc4-keyforward.test.js`:
- IPC 経路 `hall:forwarded-key` の登録確認
- FORWARD_KEYS_FROM_HALL に KeyR / KeyE / KeyS / KeyM / KeyT が含まれる
- KeyH が含まれない（前原さん判断維持）
- F11 / F12 が含まれない（rc2 改修との整合）

新規 `tests/v204-rc4-operator-pane.test.js`:
- index.html に `.operator-pane` セクションが存在
- 7 項目の `<dd>` が存在（id 確認）
- CSS で `[data-role="operator"]` のみ display 有効化
- `updateOperatorPane` 関数の role guard 確認
- operator-solo モードへの不影響確認（attribute selector の特定性検証）

致命バグ保護 5 件の cross-check も含める。

### STEP C: テスト全 PASS 確認

- `npm test`
- 既存 255 件 + 新規 N 件すべて PASS
- 1 件でも FAIL → 停止して CC_REPORT に詳細

### STEP D: ビルド実行

- `npm run build:win`
- 生成 `.exe` の絶対パス + サイズ + ファイル名記録

### STEP E: 静的検証

- `dist/latest.yml` に `version: 2.0.4-rc4` 確認

### STEP F: CC_REPORT.md を完成版で上書き

---

## 報告必須項目

- 並列 sub-agent 数（0 体予定）
- 致命バグ保護 5 件への影響評価
- 修正対象ファイル一覧と各ファイルの変更箇所
- 修正コード抜粋（IPC 経路 / dispatchClockShortcut / updateOperatorPane）
- ビルド成果物 path / size / version
- operator-solo モード（v1.3.0 互換）への影響評価（3 重防御の確認）
- specs.md §7 F1 削除の差分

---

## 禁止事項

- 致命バグ保護 5 件への変更
- スコープ外の追加実装（specs.md の他の差分修正含む、F1 削除のみ許可）
- main マージ / push
- ボタン UI の追加（B 側にスタート/一時停止を復活させない）
- operator-solo モード（v1.3.0 互換）の見た目変更
- 並列 sub-agent 起動（修正範囲が明確で並列不要）

---

## ブランチ

- 現在ブランチ: `feature/v2.0.4-rc1-test-build` 継続使用
- ローカルコミット可（rc3 → rc4 の差分追跡）
- main マージ・push なし

---

## 完了後の流れ

1. 構築士: CC_REPORT 採点 → 前原さんに rc4 の `.exe` 場所と再試験依頼
2. 前原さん: rc3 アンインストール → rc4 インストール → 再試験
   - AC ウィンドウから写真が消えているか
   - 案内文言と操作一覧が表示されているか
   - 7 項目の運用情報が出ているか
   - B フォーカス時に R / Ctrl+E / S / M / Ctrl+T などが反応するか
   - 既存挙動（HDMI 抜き差し / × 確認 / Space / 矢印など）が崩れていないか
