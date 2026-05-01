# v2.0.4-rc3 実装: AC × ボタン保護 + 操作キーのフォーカス無依存化

## 背景

v2.0.4-rc2 試験 + 状況再整理（2026-05-01）で以下が確定:

| 項目 | 状態 | 評価 |
|---|---|---|
| 全画面化 | OK | 維持（rc2 で実装済）|
| レイアウトはみ出し解消 | OK | 維持 |
| AC（operator window）= 全操作可能 | **設計通り** | 維持 |
| B（hall window）= 操作キー無反応 | **設計通り** | 維持 |
| B にボタン非表示 | **設計通り** | 維持 |
| **AC を × で閉じると操作不能** | **致命的 UX バグ** | 修正必要 |
| **B にフォーカス時 Space 等が効かない** | UX 不便 | 修正必要 |

前原さん判断（2026-05-01）:
- **問題 1（AC × ボタン）: 案 A 採用** = 確認ダイアログ「閉じるとアプリ全体が終了します」+ OK で全体終了
- **問題 2（フォーカス時のキー不能）: 案 D 採用** = Space / R / Enter 等の操作系ショートカットは hall にフォーカスがあっても operator に届く

---

## 目的

上記 2 件を最小実装で修正し、v2.0.4-rc3 として再ビルドする。

---

## スコープ厳守

### 修正範囲（厳格に 2 点に限定）

1. **operator window の close 保護**: 閉じる操作時に確認ダイアログ → OK で `app.quit()` 全体終了 / キャンセルで閉じない
2. **hall window のキーフォワード**: hall 内のキーボード入力のうち **操作系キー**（Space / R / Enter / Esc / その他既存ショートカット）を operator window にフォワード、hall 自身では消化しない

### operator-solo モード（v1.3.0 互換）の扱い

**operator-solo モードでも close 確認ダイアログを適用する**。理由:
- 操作ミス防止は普遍的価値（v1.3.0 ユーザーにも有益な UX 改善）
- 軽微な挙動追加であり、既存機能の破壊ではない
- 致命バグ保護 5 件には影響なし

### 禁止事項

- 致命バグ保護 5 件への変更
- スコープ外の追加実装
- main へのマージ / push
- ボタン UI の追加・削除（B にスタート/一時停止ボタンを復活させない、設計通り）
- F11 ショートカットの挙動変更（rc2 で getFocusedWindow ベースに改修済、不変）
- 並列 sub-agent 4 体以上

---

## 手順

### STEP A: 現状調査

- `src/main.js` の `createOperatorWindow` / `createHallWindow` / `app.on('before-quit'|'will-quit')` 関連コード Read
- 現状の close ハンドラ登録状況を把握（rc2 までで何が登録されているか）
- `src/renderer/renderer.js` の document.keydown / window.keydown ハンドラから **既存ショートカットキー一覧を抽出**
  - 操作系キー（タイマー操作 / 編集系）と表示系キー（F11 等）を分類
  - フォワード対象キーリスト（`FORWARD_KEYS`）を確定
- `src/preload.js` のキーイベント関連処理確認

### STEP B: 実装

#### B-1: operator window の close 保護

`createOperatorWindow` で win に close ハンドラ追加:

```js
let _confirmedQuit = false;
win.on('close', (event) => {
  if (_confirmedQuit) return;
  event.preventDefault();
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: ['アプリを終了', 'キャンセル'],
    defaultId: 1,
    cancelId: 1,
    title: '操作画面を閉じますか？',
    message: '操作画面を閉じるとアプリ全体が終了します。よろしいですか？',
  });
  if (choice === 0) {
    _confirmedQuit = true;
    app.quit();
  }
});
```

備考:
- `app.quit()` で hall window も自動で閉じる
- `_confirmedQuit` フラグで `app.quit()` 経由の close は無限ループしない
- メッセージは平易な日本語（前原さん向け）

#### B-2: hall window のキーフォワード

`createHallWindow` で hallWin の `webContents.on('before-input-event', ...)` で実装:

```js
hallWin.webContents.on('before-input-event', (event, input) => {
  if (input.type !== 'keyDown') return;
  if (!FORWARD_KEYS.has(input.key)) return;
  event.preventDefault();
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: input.key,
      modifiers: buildModifiers(input),  // shift / control / alt / meta
    });
  }
});
```

実装方式の判断: **案 i（sendInputEvent）採用**。
理由:
- 既存の operator 側 keydown handler を変更せず最小変更で済む
- IPC チャネル新設不要
- 案 ii（forward-shortcut IPC）は変更範囲が広いため不採用

`FORWARD_KEYS` は STEP A の調査結果から確定（既存ショートカットの操作系のみ、F11 は除外）。

#### B-3: テスト追加

`tests/v204-window-protection.test.js` 新規 で以下を静的検証:
- operator window の close ハンドラが showMessageBoxSync を使う（dialog 確認ダイアログを呼び出している）
- hall window の before-input-event ハンドラが登録されている
- FORWARD_KEYS にタイマー基本操作キーが含まれる
- F11 が FORWARD_KEYS に含まれていない（rc2 改修との整合）
- 致命バグ保護 5 件への影響なし（cross-check）

### STEP C: テスト全 PASS 確認

- `npm test`
- 既存 244 件全 PASS 維持
- 新規 N 件追加（B-3 テスト群）

### STEP D: バージョン rc2 → rc3 にバンプ

- `package.json`: `2.0.4-rc2` → `2.0.4-rc3`
- `tests/v130-features.test.js` T11 同期更新（rc1 で追認した範囲を継続適用）

### STEP E: ビルド実行

- `npm run build:win`
- 生成 `.exe` の絶対パス・サイズ・ファイル名を記録

### STEP F: 静的検証

- `dist/latest.yml` に `version: 2.0.4-rc3` 記載確認

### STEP G: CC_REPORT.md を完成版で上書き

---

## 報告必須項目（CC_REPORT.md）

- 並列 sub-agent 数（STEP A 調査のみ最大 3 体可、STEP B 以降は 0 体）
- 致命バグ保護 5 件への影響評価
- 修正対象ファイルと変更箇所
- 修正コード抜粋（B-1 close 保護 / B-2 キーフォワード）
- **FORWARD_KEYS の確定リスト**（採用したキーと、フォワード対象外にしたキーの理由）
- ビルド成果物の path / size / version
- operator-solo モードへの影響評価（close 確認ダイアログの適用方針）

---

## ブランチ

- 現在ブランチ: `feature/v2.0.4-rc1-test-build` 継続使用
- main マージなし、リモート push なし
- ローカルコミット可（rc1/rc2/rc3 の差分追跡可能に）

## 並列 sub-agent

- STEP A 調査: 最大 3 体まで可（公式 Agent Teams 推奨上限準拠）、不要なら 0 体
- STEP B 以降: 0 体（修正範囲が小さく並列不要）

---

## 完了後の流れ（CC は関与しない）

1. 構築士: CC_REPORT 採点 → 前原さんに rc3 の `.exe` 場所と再試験依頼
2. 前原さん: rc2 アンインストール → rc3 インストール → 再試験
   - AC を × で閉じようとした時、確認ダイアログが出るか
   - キャンセルで閉じない / OK で全体終了するか
   - B にフォーカスがある状態で Space を押した時、operator のタイマーがスタートするか
3. OK → 次の問題へ進む or 配布判断
4. NG → 追加修正
