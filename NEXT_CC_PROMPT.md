# v2.0.4-rc17 実装 + 真因調査フェーズ（PAUSED 同期修正 + 常時 3 ラベル + 問題 ③④ 事前調査 + ビルド）

## 【最重要】このプロンプト実行前のお願い

**Claude Code で `/clear` コマンドを必ず実行してから本プロンプトを読み込むこと**。rc16 事前調査フェーズからの context 引きずり防止。

`/clear` 後は以下を順に Read してから本プロンプトに従うこと:
1. `poker-clock/HANDOVER.md`（**特に問題 ①②③④ の症状記述、TL;DR セクション必読**）
2. `poker-clock/CC_REPORT.md`（rc16 事前調査報告、本実装の根拠資料、§3.6 修正案 ②-1 / §4.3 計測ラベル設計参照）
3. `poker-clock/CLAUDE.md`
4. `poker-clock/skills/cc-operation-pitfalls.md`（特に §1 / §6 / §7）
5. `poker-clock/skills/root-cause-analysis.md`（**必読、思い込み判断禁止の標準手順、問題 ③④ 調査で重要**）
6. `poker-clock/skills/timer-logic.md`（subscribe ガード周辺の不変条件、致命バグ保護）
7. `poker-clock/skills/electron-multi-monitor-pitfalls.md`（hall/AC IPC 経路の罠）

## 推奨モデル

**Sonnet 4.6**

---

## ■ 構築士の判断（rc16 事前調査の 4 質問への回答）

CC からの 4 質問はすべて **CC 推奨案を採用**:

1. **rc17 で修正案 ②-1 直行 → 試験 → 問題 ① 残存なら計測** 段階アプローチ → 採用
2. **修正案 ②-1 のガード条件は PAUSED のみに限定**（RUNNING/BREAK/PRE_START は対象外）→ 採用
3. **既存テストへの影響事前 grep + 必要なら rc17 タスクに追従テストを含める** → 採用
4. **常時 3 ラベル**（`timer:state:send` / `timer:state:recv:hall` / `render:tick:hall`）+ 計測時 12 ラベル階層 → 採用、ただし rc17 では **常時 3 ラベルのみ実装**（計測 12 ラベルは問題 ① で必要となった場合に rc18-A 計測ビルドで投入）

---

## ■ 今回 やる範囲（ホワイトリスト）

5 タスク統合（実装 3 + 真因調査 2 + 仕上げ）:

- **タスク 1（実装）**: 問題 ② 修正 — `renderer.js:1579` の subscribe ガードに「PAUSED 中の remainingMs 変化」条件追加（修正案 ②-1、1 行）+ 既存テスト追従 + 新規回帰テスト
- **タスク 2（実装）**: 常時 3 ラベル rolling ログ追加 — `timer:state:send` / `timer:state:recv:hall` / `render:tick:hall`（rc16 CC_REPORT §4.3 ラベル #1 #2 #3）
- **タスク 3（実装ゼロ・真因調査）**: 問題 ③（トーナメント削除ダイアログが開かない）の真因調査
- **タスク 4（実装ゼロ・真因調査・🚨最優先）**: 問題 ④（新規トーナメント名が編集できない再発）の真因調査
- **タスク 5（実装）**: バージョン `2.0.4-rc17` バンプ + CHANGELOG + 全テスト PASS + ビルド + git コミット

## ■ 今回 触ってはいけない範囲（ブラックリスト）

- **致命バグ保護 5 件**（cc-operation-pitfalls.md §1.5）絶対不変
- rc7〜rc15 の確定 Fix すべて維持
- **タスク 3 / タスク 4 では実装ゼロ厳守**（真因仮説 + 修正案提示のみ、修正コード書かない）
- 「念のため」修正・hard-coded 値・特定入力 workaround 厳禁
- カード幅 54vw / 46vw / Barlow Condensed 700 / `<dialog>` flex 化禁止 等の不変ルール維持
- タスク 1 / タスク 2 で発見した別問題は CC_REPORT「構築士への質問」に提案として記載のみ

## 致命級バグ発見時の例外

調査中に **別の致命級バグ**を発見した場合のみ、CC_REPORT 冒頭に **🚨警告** セクションを追加。実装はせず、構築士判断を仰ぐ。

---

## 1. タスク 1: 問題 ② 修正（修正案 ②-1）

### 1.1 修正方針（rc16 CC_REPORT §3.6 修正案 ②-1）

`src/renderer/renderer.js:1579` の subscribe ガード:

```javascript
// Before（rc15 まで）— PAUSED 中の remainingMs 単独変化を弾いている
if (state.status !== prev.status || state.currentLevelIndex !== prev.currentLevelIndex) {
  schedulePersistTimerState();
  ...
}

// After（rc17）— PAUSED 限定で remainingMs 変化も同期トリガに
if (
  state.status !== prev.status ||
  state.currentLevelIndex !== prev.currentLevelIndex ||
  (state.status === States.PAUSED && state.remainingMs !== prev.remainingMs)
) {
  schedulePersistTimerState();
  ...
}
```

### 1.2 制約

- 修正規模は **1 行追加のみ**、それ以上のリファクタ禁止
- `schedulePersistTimerState()` の 500ms debounce / `_publishDualState` 経路 / C.2.7-D timerState destructure 除外には一切触らない
- RUNNING / BREAK / PRE_START は対象外（既存ガード経路で十分）

### 1.3 テスト追加 + 既存テスト追従

新規テストファイル `tests/v204-rc17-paused-time-shift-sync.test.js` 作成:
- T1: PAUSED 中の `advance30Seconds` で `schedulePersistTimerState` が呼ばれる
- T2: PAUSED 中の `rewind30Seconds` で `schedulePersistTimerState` が呼ばれる
- T3: RUNNING 中の onTick 由来 remainingMs 変化では `schedulePersistTimerState` が呼ばれない（rc15 維持）
- T4: BREAK 中の time-shift では既存経路で同期される（rc15 維持）

**既存テスト影響事前 grep**: `tests/race-fixes.test.js` 等で `schedulePersistTimerState` 呼出回数検証がある場合、PAUSED 経路追加の影響を反映する形で追従更新。

---

## 2. タスク 2: 常時 3 ラベル rolling ログ追加

### 2.1 追加ラベル（rc16 CC_REPORT §4.3 #1 #2 #3）

| # | ラベル | 挿入位置 | 目的 |
|---|--------|---------|------|
| 1 | `timer:state:send` | `main.js` `_publishDualState('timerState', ts)` 直前 | main 送信 ts 記録 |
| 2 | `timer:state:recv:hall` | `dual-sync.js:32` 入口 | hall 側受信 ts 記録 |
| 3 | `render:tick:hall` | `renderer.js` hall renderTime 直前（onTick ハンドラ内） | hall 描画タイミング記録 |

### 2.2 制約

- **配布版にも常時記録**（計測ビルド限定ではない）
- 既存 rolling ログ機構（rc15）の `window.api.log.write` / `rollingLog` を流用、新規 IPC 追加なし
- すべて `try { ... } catch(_) {}`、never throw from logging
- C.1.7 AudioContext / C.1.8 runtime 永続化経路には介入しない

### 2.3 テスト追加

`tests/v204-rc17-paused-time-shift-sync.test.js` に追加:
- T5: `_publishDualState('timerState', ...)` 直前に `rollingLog('timer:state:send', ...)` が存在
- T6: `dual-sync.js` 入口に `window.api.log.write('timer:state:recv:hall', ...)` が存在
- T7: hall renderTime 直前に `window.api.log.write('render:tick:hall', ...)` が存在
- T8: タイマー 1 秒 tick 由来の高頻度ラベルが記録される（rolling 5 分上限維持の検証）

---

## 3. タスク 3: 問題 ③ 真因調査（削除ダイアログが開かない）

### 3.1 症状（前原さん rc15 試験で観察）

- トーナメント削除のゴミ箱ボタン押下 → ゴミ箱が赤くなるだけで「削除しますか？」確認ダイアログが開かない
- 違う操作をすると解消され、削除可能になる
- rolling ログには `focus` / `blur` 以外のイベント記録なし、エラー記録もなし = **無音失敗**

### 3.2 仮説検証ポイント

| 仮説 | 確認方法 |
|---|---|
| ③-1: 削除ボタン onClick で何かが throw → preload の try-catch で握り潰し（**rc12 真因と同じパターン**）| renderer.js の削除ボタンハンドラ + ダイアログ open 処理を Read、preload の try-catch を Grep |
| ③-2: ダイアログ要素が DOM 上で hidden / disabled 状態のまま | renderer.js のダイアログ open 関数、`<dialog>` 要素の状態管理を Grep |
| ③-3: 別ダイアログが裏で open 中で、二重 open がガードされている | `<dialog>` の open 状態チェックロジックを Grep |
| ③-4: 削除ボタンの hover/active 状態だけ CSS で反応、click ハンドラ未登録 | event listener 登録経路を Grep |

### 3.3 出力（CC_REPORT §タスク 3）

- 仮説 ③-1〜③-4 の検証結果（実コード根拠 + 反論プロセス）
- 真因確定 or 限界判断
- 修正案（rc18 で実装、本フェーズでは提示のみ）
- 致命バグ保護 5 件への影響予測

---

## 4. タスク 4: 問題 ④ 真因調査（新規トーナメント名が編集できない再発、🚨最優先）

### 4.1 症状（前原さん rc15 試験で観察）

- 新しいトーナメント作成直後、トーナメント名が編集できない（入力欄が反応しない）
- **「タイマー画面に戻ると編集可能状態に戻った」**（前原さん追加観察 2026-05-02）
- = **編集可能状態に戻す処理は存在するが、新規作成直後にはその処理が通っていない**
- **致命バグ保護 5 件のうち C.1-A2 / C.1.4-fix1 Fix 5 関連が壊れている可能性大**

### 4.2 重要な追加観察の解釈

「タイマー画面に戻ると治る」= 何らかの再同期経路（focus / role 切替 / subscribe 等）で `ensureEditorEditableState` 相当の処理が遅延発火している → 真因調査の決定的ヒント。

### 4.3 仮説検証ポイント

| 仮説 | 確認方法 |
|---|---|
| ④-1: `_handleTournamentNewImpl` 末尾の `ensureEditorEditableState` 呼出が rc7〜rc15 のどこかで欠落 / 経路変更 | `_handleTournamentNewImpl` を Read、git blame で C.1.4-fix1 Fix 5 当時のコードと現在を diff |
| ④-2: rc7 で導入した renderer 内 role 動的切替が `ensureEditorEditableState` の前提を破っている | `onRoleChanged` ハンドラ内で editor state リセット経路を Grep |
| ④-3: 新規作成のフォーム表示と editable state 設定の timing race | RAF / setTimeout / Promise チェーンを Grep、C.1.4-fix1 Fix 5 の 4 重防御の現在状態を確認 |
| ④-4: タイマー画面遷移時の subscribe / focus イベントで editable state がリストアされている | focus / blur ハンドラ内で editor state 操作を Grep |
| ④-5: rc12 と同じ preload try-catch 握り潰しパターン（`window.appXxx = ...` で TypeError 等）| ES module strict + contextBridge 凍結の組合せを Grep（feedback_rc12_truth.md のチェックリスト準拠）|

### 4.4 出力（CC_REPORT §タスク 4）

- 仮説 ④-1〜④-5 の検証結果（実コード根拠 + 反論プロセス + git blame 結果）
- **C.1.4-fix1 Fix 5 当時のコードと現在のコードの diff**（必須）
- 真因確定 or 限界判断
- 修正案（rc18 で実装、本フェーズでは提示のみ）
- 致命バグ保護 5 件への影響予測（特に C.1-A2 強化方向の評価）
- **過去 fix が壊れた経緯の説明**（rc7〜rc15 のどの commit で再発したか）

---

## 5. タスク 5: バージョンバンプ + CHANGELOG + ビルド + コミット

### 5.1 バージョン更新
- `package.json`: `2.0.4-rc15` → `2.0.4-rc17`（rc16 は事前調査のみで実装ゼロ、版番号スキップ）
- `package.json` `scripts.test` 末尾に `&& node tests/v204-rc17-paused-time-shift-sync.test.js` 追加

### 5.2 CHANGELOG.md 更新
- 先頭に `## [2.0.4-rc17] - 2026-05-02` セクション追加（Fixed / Added / Investigated / Tests のサブセクションで構造化、タスク 3/4 は Investigated に「rc18 で修正予定」と明記）

### 5.3 ビルド検証
- `npm test` exit code **0**、全テスト PASS（rc15 524 件 + 新規 8 件想定）
- `npm run build:win` 成功、`dist/PokerTimerPLUS+ (Test) Setup 2.0.4-rc17.exe` 生成

### 5.4 git コミット
- `feature/v2.0.4-rc1-test-build` ブランチに rc17 コミット作成（push なし）
- コミットメッセージ例: `feat(v2.0.4): rc17 - PAUSED time-shift sync fix + always-on 3 labels + ③④ investigation`

---

## 6. 並列 sub-agent

- **3 体並列推奨**（公式 Agent Teams 上限 3 体準拠）
  - Sub-agent 1: タスク 4（問題 ④ 真因調査、最優先、git blame + ensureEditorEditableState 経路 deep read）
  - Sub-agent 2: タスク 3（問題 ③ 真因調査、削除ボタン経路 + preload try-catch deep read）
  - Sub-agent 3: タスク 1+2 実装（renderer.js + main.js + dual-sync.js）
- タスク 5（バージョン / ビルド）: CC 直接対応（軽量、順次）
- 各 sub-agent への prompt にはファイルパス / 関数名 / 既存 Fix 確定事項を必ず include（親 context は子に見えない）

**ファイル競合の注意**: タスク 1 と タスク 2 はどちらも renderer.js を触る。同一 sub-agent に統合 or 順次実装で競合回避。

---

## 7. CC_REPORT.md 必須セクション

- §1 サマリ（実装結果 + テスト数 + ビルド成功可否 + 各タスクの真因確定状況）
- §2 タスク 1（問題 ② 修正）変更箇所 + 差分要約 + テスト T1〜T4 結果
- §3 タスク 2（常時 3 ラベル）変更箇所 + テスト T5〜T8 結果
- §4 タスク 3（問題 ③ 真因調査）仮説検証 + 真因確定 or 限界判断 + 修正案
- §5 タスク 4（問題 ④ 真因調査）仮説検証 + git blame 結果 + 真因確定 + 修正案 + **再発経緯の説明**
- §6 タスク 5（バージョン / CHANGELOG / ビルド / コミット）成果物
- §7 致命バグ保護 5 件への影響評価（個別検証）
- §8 並列 sub-agent / Task 起動数の報告
- §9 構築士への質問
- §10 一時計測ログ挿入の確認
- §11 スコープ管理の自己申告（タスク 3/4 で実装ゼロを厳守したことの明示）

---

## 8. 完了報告

CC は実装 + 真因調査 + ビルド完了後、構築士に「**rc17 実装 + 真因調査完了**」と返す。
構築士は CC_REPORT を採点 → 前原さんに翻訳説明 → 前原さん rc17 試験（問題 ② 解決確認 + 問題 ① 体感再評価 + 問題 ③④ は症状継続観察のみ）→ 結果次第で:

- 問題 ② 解決 + 問題 ① 解消 + 問題 ③④ 真因確定 → **rc18 で問題 ③④ 修正 → 試験 OK → v2.0.4 final 本配布**
- 問題 ② 解決 + 問題 ① 残存 + 問題 ③④ 真因確定 → **rc18-A 計測ビルド（問題 ① 計測）→ rc18 で問題 ①③④ 修正 → 試験 → 本配布**

**v2.0.4 final 配布判断は問題 ①②③④ 全解決まで保留**。前原さんの実機体感を最優先する。
