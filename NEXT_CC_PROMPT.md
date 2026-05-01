# v2.0.4-rc5 実装: M/H/F2/F12 整理 + テロップ表記 + 操作一覧再構成 + ミュート視覚フィードバック（全 role 適用）

## 構築士判断（前原さん追認 2026-05-01）

| 項目 | 判断 |
|---|---|
| M キーフォワード | **追加**（KeyM）|
| H キーフォワード | **追加**（KeyH、前回判断撤回）|
| F2 | **削除**（operator-pane 操作一覧 + docs/specs.md §7 から、実装無し）|
| F12 | operator-pane 操作一覧から **削除**（既存コードは維持、specs §7 表記も維持）|
| 「マーキー」表記 | **「テロップ」に変更**（UI 表記のみ、コード内部の `marquee*` 変数名は維持）|
| 操作一覧 | **5 カテゴリに再構成**（タイマー/プレイヤー/エントリー/ダイアログ表示/アプリ）|
| ミュート視覚フィードバック | **全 role に適用**（operator / hall / operator-solo すべて、v1.3.0 互換例外）|

---

## 重要な方針変更: v1.3.0 互換からの「便利機能例外」

**ミュート視覚フィードバックは operator-solo モードにも適用** = v1.3.0 配布版にはない機能を v2.0.4 で追加する。

前原さん指示「便利機能はどっちのモードにも適用したい」に従い、戦略的に:
- v2.0.4 の `.exe` を全国配布する将来構想に向け、単画面ユーザーにも便利機能改善を提供
- 既存挙動の破壊ではなく純粋な追加（UX 改善）
- 致命バグ保護 5 件には影響なし

---

## STEP A: 修正実装

### A-1. キーフォワード追加（main.js）

`FORWARD_KEYS_FROM_HALL` に `'KeyM'`, `'KeyH'` 追加:

```js
const FORWARD_KEYS_FROM_HALL = new Set([
  'Space', 'Enter', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyR', 'KeyA', 'KeyE', 'KeyS', 'KeyM', 'KeyT', 'KeyH'
]);
```

### A-2. F2 削除

- operator-pane 操作一覧から F2 行を削除
- `docs/specs.md §7` から F2 行を削除（rc4 で F1 削除した要領）
- F2 に対応する renderer.js / main.js のハンドラがあれば削除（無ければ no-op）

### A-3. F12 削除（操作一覧のみ）

- operator-pane 操作一覧から F12 行を削除
- 既存の F12 ショートカット（DevTools 開閉）コード自体は **維持**
- `docs/specs.md §7` の F12 表記は **維持**（開発者向け）

### A-4. 「マーキー」→「テロップ」表記変更

UI に出てくる「マーキー」をすべて「テロップ」に置換:

- operator-pane 操作一覧「Ctrl+T マーキー編集」→「Ctrl+T テロップ編集」
- マーキーダイアログのタイトル / ボタン / ラベル等の UI 文字列
- 設定タブ内の「マーキー」タブ名 / 説明文
- `docs/specs.md §7` の関連記述

**コード内部の変数名（`marqueeDialog` / `el.marqueeTitle` 等）は維持**（リスク回避、変数名変更は別フェーズ）。

### A-5. 操作一覧をカテゴリ別 5 セクションに再構成

`src/renderer/index.html` の operator-pane 操作一覧 ul を以下に置換:

```html
<div class="shortcut-section">
  <h3>タイマー操作</h3>
  <ul>
    <li><kbd>Space</kbd> 一時停止 / 再開</li>
    <li><kbd>Enter</kbd> スタート（開始前）</li>
    <li><kbd>→</kbd> 残り時間 -30 秒（早送り）</li>
    <li><kbd>←</kbd> 残り時間 +30 秒（巻き戻し）</li>
    <li><kbd>R</kbd> リセットダイアログ</li>
  </ul>
</div>

<div class="shortcut-section">
  <h3>プレイヤー操作</h3>
  <ul>
    <li><kbd>↑</kbd> 新規エントリー追加</li>
    <li><kbd>Shift</kbd>+<kbd>↑</kbd> 新規エントリー取消</li>
    <li><kbd>↓</kbd> プレイヤー脱落</li>
    <li><kbd>Shift</kbd>+<kbd>↓</kbd> 脱落取消（復活）</li>
  </ul>
</div>

<div class="shortcut-section">
  <h3>エントリー操作</h3>
  <ul>
    <li><kbd>Ctrl</kbd>+<kbd>R</kbd> リエントリー +1</li>
    <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> リエントリー -1</li>
    <li><kbd>Ctrl</kbd>+<kbd>A</kbd> アドオン +1</li>
    <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> アドオン -1</li>
    <li><kbd>Ctrl</kbd>+<kbd>E</kbd> 特別スタック +1</li>
    <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> 特別スタック -1</li>
  </ul>
</div>

<div class="shortcut-section">
  <h3>ダイアログ / 表示</h3>
  <ul>
    <li><kbd>S</kbd> 設定ダイアログ</li>
    <li><kbd>Ctrl</kbd>+<kbd>T</kbd> テロップ編集</li>
    <li><kbd>M</kbd> ミュート切替</li>
    <li><kbd>H</kbd> ボトムバー非表示</li>
  </ul>
</div>

<div class="shortcut-section">
  <h3>アプリ</h3>
  <ul>
    <li><kbd>F11</kbd> フルスクリーン切替</li>
    <li><kbd>Ctrl</kbd>+<kbd>Q</kbd> アプリ終了</li>
    <li><kbd>Esc</kbd> ダイアログを閉じる</li>
  </ul>
</div>
```

CSS でセクション見出し（`<h3>`）とリストの装飾を追加（既存 dark テーマと整合）。

### A-6. ミュート視覚フィードバック実装（全 role 適用）

#### A-6-1. mute-indicator 要素追加

`src/renderer/index.html` に共通要素:
```html
<div class="mute-indicator" id="js-mute-indicator" hidden>🔇 ミュート中</div>
```

#### A-6-2. CSS

`src/renderer/style.css`:
```css
.mute-indicator {
  position: fixed;
  bottom: 16px; right: 16px;
  background: rgba(180, 30, 30, 0.85);
  color: #fff;
  font-weight: 700;
  font-size: 1.2em;
  padding: 8px 14px;
  border-radius: 8px;
  z-index: 95;
  pointer-events: none;
}

/* operator role (AC) には表示しない、運用情報で代替 */
[data-role="operator"] .mute-indicator { display: none !important; }
/* hall / operator-solo は通常通り（hidden 属性削除時に表示）*/
```

#### A-6-3. JS（renderer.js）

- ミュート状態が変わったら `js-mute-indicator` の `hidden` 属性を toggle
- 既存のミュート切替ロジック（M キー / 設定タブ等）に hook 追加
- 起動時にも初期反映

#### A-6-4. operator role の AC 側「音」項目追加

operator-pane の運用情報 dl に追加（既存 7 項目 → 8 項目に）:
```html
<dt>音</dt><dd id="op-pane-mute-status">通常</dd>
```

`updateOperatorPane()` でミュート状態を読み取って「通常」or「ミュート中」をセット（赤系の色で強調）。

#### A-6-5. 3 role での表示制御まとめ

| role | mute-indicator (画面右下) | operator-pane の「音」項目 |
|---|---|---|
| operator (AC) | 非表示（CSS で打ち消し） | **「ミュート中」表示**（運用情報で代替）|
| hall (B) | **表示** | なし（pane 自体が hall に存在しない）|
| operator-solo (単画面) | **表示** | なし（pane 自体が operator-solo に存在しない）|

### A-7. 網羅再点検

operator-pane の操作一覧に載っている全キーが以下の動作をするか CC が実コード根拠で確認:

1. AC（operator）でキーを押した時に正しく動作する
2. B（hall）でキーを押した時に AC に forward されて正しく動作する（M / H 含む）
3. 単画面モード（operator-solo）でキーを押した時に正しく動作する

不具合があれば修正、または操作一覧から削除（修正不可なものは CC_REPORT で構築士判断仰ぐ）。

### A-8. テスト追加 / 更新

- rc4 で追加した「操作一覧 25 件」テストを **22 件 + カテゴリ構造**に更新
- 「マーキー」表記の検索テストを「テロップ」に更新（UI 表記のみ、コード内部 `marquee` は変更なし）
- M / H forward の追加テスト
- ミュート視覚フィードバックの 3 role 動作テスト（operator では非表示、hall / operator-solo では表示）
- 致命バグ保護 5 件 cross-check

### A-9. バージョン rc4 → rc5

- `package.json`: `2.0.4-rc4` → `2.0.4-rc5`
- `tests/v130-features.test.js` T11 同期更新

### A-10. ビルド + 静的検証

- `npm run build:win`
- `dist/latest.yml` に `version: 2.0.4-rc5` 確認

### A-11. CC_REPORT.md を完成版で上書き

---

## 報告必須項目

- 並列 sub-agent 数（0 体予定）
- 致命バグ保護 5 件への影響評価
- 修正対象ファイル一覧と各変更箇所
- 修正コード抜粋（FORWARD_KEYS / mute-indicator / operator-pane 「音」項目）
- 網羅再点検結果（22 キーの動作確認結果）
- ミュート視覚フィードバックの 3 role 動作確認
- v1.3.0 互換からの「ミュート視覚」例外の妥当性評価
- ビルド成果物 path / size / version

---

## 禁止事項

- 致命バグ保護 5 件への変更
- スコープ外の追加実装（specs §7 の F2 削除のみ許可、他差分は touch しない）
- main マージ / push
- 並列 sub-agent 起動
- コード内部の `marquee*` 変数名変更（UI 表記のみ）
- ミュート視覚フィードバック以外の v1.3.0 互換例外追加

---

## ブランチ

- `feature/v2.0.4-rc1-test-build` 継続使用
- ローカルコミット可（rc4 → rc5 差分追跡）
- main マージ・push なし

---

## 完了後の流れ

1. 構築士: CC_REPORT 採点 → 前原さんに rc5 の `.exe` 場所と再試験依頼
2. 前原さん: rc4 アンインストール → rc5 インストール → 再試験
   - 操作一覧が 5 カテゴリに分かれているか
   - 「マーキー」が「テロップ」になっているか
   - F2 / F12 が操作一覧から消えているか
   - B フォーカス時に M / H が反応するか
   - ミュート時に B の右下に「🔇 ミュート中」が出るか
   - AC の運用情報に「音」項目が出るか
   - 単画面モードでも（手元 PC のみで起動した時に）右下に「🔇 ミュート中」が出るか
   - 既存挙動が崩れていないか
