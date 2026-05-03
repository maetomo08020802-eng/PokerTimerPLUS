# v2.0.4-rc18 第 1 弾実装フェーズ（問題 ②⑥ 連動解消 + 問題 ⑤ operator-pane + ログ機構刷新 + 4 ラベル + ビルド）

## 【最重要】このプロンプト実行前のお願い

**Claude Code で `/clear` コマンドを必ず実行してから本プロンプトを読み込むこと**。rc18 事前調査フェーズからの context 引きずり防止。

`/clear` 後は以下を順に Read してから本プロンプトに従うこと:
1. `poker-clock/HANDOVER.md`（**特に問題 ①②③④⑤⑥ の症状記述、TL;DR セクション必読**）
2. `poker-clock/CC_REPORT.md`（rc18 事前調査報告、本実装の根拠資料、特に §2.4 問題 ⑥ 真因 / §3 ログ機構刷新 / §4 観測ラベル設計）
3. `poker-clock/CLAUDE.md`
4. `poker-clock/skills/cc-operation-pitfalls.md`（特に §1 / §6 / §7）
5. `poker-clock/skills/electron-multi-monitor-pitfalls.md`（hall/AC IPC 経路の罠）
6. `poker-clock/skills/timer-logic.md`（subscribe ガード周辺の不変条件、致命バグ保護）

## 推奨モデル

**Sonnet 4.6**

---

## ■ 構築士の判断（rc18 事前調査の 6 質問への回答）

CC からの 6 質問への構築士判断:

1. **rc18 第 1 弾の範囲確定**: 一体投入 → **採用**
2. **問題 ⑤ の認識合わせ**: 前原さん確認完了 = **AC 画面左半分の数値エリア（operator-pane、rc4 で追加された AC ペイン）** が対象。**CC 推奨案 ⑤-2（renderTournamentList 即時呼出）は「リスト UI」想定だったため対象外。本実装で operator-pane の同期経路を追加調査 + 必要なら修正**
3. **修正案 ② IPC 順序入替**: 段階アプローチ → **採用**（rc18 第 1 弾では除外、第 2 弾以降で慎重判断）
4. **問題 ⑥ 修正案 ⑥-A vs ⑥-B**: ⑥-A 採用（最小変更）→ **採用**
5. **rc16 判断ミスの構造的弱点**: 「同期漏れ全パターン網羅調査」を今後の運用ルール化 → **採用**（feedback memory に後日記録）
6. **観測ラベル拡張の配布判断**: 配布版常時記録 → **採用**

---

## ■ 今回 やる範囲（ホワイトリスト）

5 タスク統合（実装 + ビルド）:

- **タスク 1（実装）**: 問題 ⑥ 修正案 ⑥-A — hall 側 `dual-sync` handler の `tournamentBasics` 受信時に `setStructure(loadPresetById(blindPresetId))` を追加（約 10 行）。**問題 ② も連動解消**（追加修正なし）
- **タスク 2（実装 + 追加調査）**: 問題 ⑤ operator-pane 同期 — **認識合わせ完了: 対象は AC 画面左半分の operator-pane（人数/スタック等の数値表示）**。CC が rc18 事前調査で想定していた「リスト UI」とは別経路。`updateOperatorPane` の呼出経路を Read で確認し、PAUSED 中の runtime 変化（addNewEntry 等）で AC 側の operator-pane が即時更新されているか実コード検証 → 必要なら呼出強化
- **タスク 3（実装）**: タスク 2 案 ① ログ機構刷新 — main.js の rolling ログを **in-memory ring buffer 化**（fire-and-forget appendFile の I/O 順序保証問題を解消、約 30 行）。CC_REPORT §3 タスク 2 案 ① 参照
- **タスク 4（実装）**: タスク 3 観測ラベル 4 個追加 — `runtime:state:send` / `runtime:state:recv:hall` / `blindPreset:state:send` / `blindPreset:state:recv:hall` を配布版常時記録（12〜20 行）
- **タスク 5（実装）**: バージョン `2.0.4-rc18` バンプ + CHANGELOG + 全テスト PASS + ビルド + git コミット

## ■ 今回 触ってはいけない範囲（ブラックリスト）

- **致命バグ保護 5 件**（cc-operation-pitfalls.md §1.5）絶対不変
- rc7〜rc17 の確定 Fix すべて維持
- **修正案 ② IPC 順序入替（store.set / `_publishDualState` 順序入替）は本フェーズでは実装しない**（C.1.8 整合性窓拡大リスク、第 2 弾以降で慎重判断）
- **問題 ④（presetName 編集不可）は本フェーズの対象外**（NEXT_CC_PROMPT_RC18_PHASE2.md で別途事前調査依頼予定）
- 「念のため」修正・hard-coded 値・特定入力 workaround 厳禁
- カード幅 54vw / 46vw / Barlow Condensed 700 / `<dialog>` flex 化禁止 等の不変ルール維持

---

## 1. タスク 1: 問題 ⑥ 修正案 ⑥-A（hall 側 setStructure 追加）

### 1.1 修正方針（rc18 CC_REPORT §2.4 修正案 ⑥-A）

`src/renderer/dual-sync.js` の `_applyDiffToState` で `kind === 'tournamentBasics'` を受信した時、現在 `applyTournament(value)` を呼んで `tournamentState.blindPresetId` をメモリ更新するが、**`setStructure(loadPresetById(blindPresetId))` を呼んでいない**設計欠陥を修正。

CC_REPORT §2.4 推奨実装（参考）:
```javascript
if (kind === 'tournamentBasics') {
  applyTournament(value);
  // rc18 第 1 弾: hall 側で blindPresetId 更新時に structure も同期
  if (value?.blindPresetId) {
    const preset = loadPresetById(value.blindPresetId);
    if (preset) setStructure(preset);
  }
}
```

### 1.2 制約

- 修正規模 **約 10 行**、それ以上のリファクタ禁止
- main 側の broadcast 経路には触らない（C.1.8 runtime / C.2.7-D timerState 経路は無変更）
- 問題 ② は追加修正なし（⑥-A の連動効果で解消想定）

### 1.3 テスト追加

新規テストファイル `tests/v204-rc18-structure-sync.test.js`:
- T1: dual-sync.js `_applyDiffToState` 内の `tournamentBasics` 経路で `setStructure` 呼出が存在
- T2: blindPresetId が空の場合は `setStructure` を呼ばない（null guard）
- T3: 問題 ② 連動解消 — PAUSED 中 time-shift で hall 側の structure が同期された状態で applyTimerStateToTimer の level=6 が正しく投影される

---

## 2. タスク 2: 問題 ⑤ operator-pane 同期（認識合わせ完了版）

### 2.1 認識合わせ結果

前原さん rc17 試験証言の「PAUSED 中エントリー追加で AC は変わらず会場モニターだけ変わる」の **AC 側「変わらない」場所 = AC 画面左半分の operator-pane（人数/スタック等の数値表示エリア、rc4 追加）**。

CC が rc18 事前調査で想定した修正案 ⑤-2（`renderTournamentList` 即時呼出 6 箇所）は **リスト UI 対象**で、operator-pane とは別経路。

### 2.2 調査 + 実装

1. `renderer.js` の `updateOperatorPane` 関数を Read、現在の呼出元 / 受信 state / 描画対象 DOM を完全把握
2. operator window（AC 側）が `tournamentRuntime` 変化を受信した時 `updateOperatorPane` が即時呼出されるか確認
3. 呼出されていない場合: `addNewEntry` / `eliminatePlayer` / `revivePlayer` 等の runtime ミューテーション関数経路で `updateOperatorPane` の即時呼出を追加
4. 呼出されているが描画が遅延している場合: subscribe 経路の debounce / RAF タイミングを確認

**規模見積**: 調査結果次第で 5〜30 行（調査ゼロでコード変更不要も含む）。発見した真因に応じて「実装ゼロで完了」も許容。

### 2.3 致命バグ保護への影響

- C.1.8 runtime 永続化: `schedulePersistRuntime` の 500ms debounce には触らない、`updateOperatorPane` の呼出経路強化のみ
- 他 4 件: 影響なし

### 2.4 テスト追加

- T4: operator role 時、`tournamentRuntime` 変化で `updateOperatorPane` が即時呼出される（jsdom）
- T5: PAUSED 中の `addNewEntry` で operator-pane の数値が更新される

---

## 3. タスク 3: ログ機構刷新（in-memory ring buffer 化）

### 3.1 修正方針（rc18 CC_REPORT §3 タスク 2 案 ①）

現状の `fs.promises.appendFile` 一発打ちは I/O 順序を保証しないため ts が信用できない。**メモリ上のリング状バッファ（最大 N 件保持）**に切替、定期 flush（または app:before-quit 時 flush）でファイル書出。

### 3.2 制約

- ring buffer サイズ: rc15 5 分保持仕様に合わせて目安 **約 5,000 行**（5 分 × 60 sec × 約 17 ラベル/秒余裕）
- flush タイミング: 30 秒定期 + app:before-quit + ログフォルダ open 時
- **既存 IPC（`rolling-log:write` / `logs:openFolder`）は維持**、preload bridge / renderer 側経路は無変更
- C.1.7 AudioContext / C.1.8 runtime 永続化経路には介入なし

### 3.3 テスト追加

- T6: rolling ログが in-memory ring buffer に書き込まれる
- T7: ring buffer サイズ上限で古いエントリが自動削除される
- T8: 30 秒定期 flush でディスク書出される
- T9: app:before-quit で ring buffer がディスク flush される

---

## 4. タスク 4: 観測ラベル 4 個追加（配布版常時記録）

### 4.1 追加ラベル（rc18 CC_REPORT §4）

| # | ラベル | 挿入位置 | ガード |
|---|--------|---------|-------|
| 1 | `runtime:state:send` | main.js `_publishDualState` 内、`kind === 'tournamentRuntime'` 時 | kind フィルタ |
| 2 | `runtime:state:recv:hall` | dual-sync.js `_applyDiffToState` 入口、`kind === 'tournamentRuntime'` 時 | kind フィルタ |
| 3 | `blindPreset:state:send` | main.js `_publishDualState` 内、`kind === 'tournamentBasics'` 時の blindPresetId 送信時 | kind フィルタ |
| 4 | `blindPreset:state:recv:hall` | dual-sync.js `_applyDiffToState` 入口、`kind === 'tournamentBasics'` 時の blindPresetId 受信時 | kind フィルタ |

### 4.2 制約

- すべて `try { ... } catch (_) {}` で wrap、never throw from logging
- 配布版にも常時記録（計測ビルド限定ではない）
- C.1.7 / C.1.8 経路には介入なし

### 4.3 テスト追加

- T10〜T13: 4 ラベルそれぞれの挿入位置 + try-catch wrap 検証

---

## 5. タスク 5: バージョン / CHANGELOG / ビルド / コミット

### 5.1 バージョン更新
- `package.json`: `2.0.4-rc17` → `2.0.4-rc18`
- `package.json` `scripts.test` 末尾に `&& node tests/v204-rc18-structure-sync.test.js` 追加
- 各 rc 追従用 version assertion テストを `2.0.4-rc17` → `2.0.4-rc18` 値更新

### 5.2 CHANGELOG.md 更新
- 先頭に `## [2.0.4-rc18] - 2026-05-02` セクション追加
- Fixed / Added / Investigated / Compatibility / Tests のサブセクションで構造化

### 5.3 ビルド検証
- `npm test` exit code **0**、全テスト PASS（rc17 540 件 + 新規 13 件想定 = 約 553 件）
- `npm run build:win` 成功、`dist/PokerTimerPLUS+ (Test) Setup 2.0.4-rc18.exe` 生成

### 5.4 git コミット
- `feature/v2.0.4-rc1-test-build` ブランチに rc18 コミット作成（push なし）
- コミットメッセージ例: `feat(v2.0.4): rc18-phase1 - structure sync ⑥-A + operator-pane ⑤ + ring buffer + 4 labels`

---

## 6. 並列 sub-agent

- **3 体並列推奨**（公式 Agent Teams 上限 3 体準拠）
  - Sub-agent 1: タスク 1+4 実装（dual-sync.js + main.js 観測ラベル、構造同期コア）
  - Sub-agent 2: タスク 2 調査+実装（renderer.js operator-pane 経路 deep read + 必要なら修正）
  - Sub-agent 3: タスク 3 実装（main.js ring buffer 化）
- タスク 5（バージョン / ビルド / コミット）: CC 直接対応
- ファイル競合の注意点（タスク 1+4 が main.js を触り、タスク 3 も main.js を触る）→ Sub-agent 1 と 3 を順次実行 or 同 sub-agent に統合
- cc-operation-pitfalls.md §1.1 / §2.2 準拠

---

## 7. CC_REPORT.md 必須セクション

- §1 サマリ（実装結果 + テスト数 + ビルド成功可否 + 各タスク状況）
- §2 タスク 1（問題 ⑥ ⑥-A 修正）変更箇所 + 差分要約 + テスト T1〜T3 結果
- §3 タスク 2（問題 ⑤ operator-pane）調査結果 + 修正箇所（あれば）+ テスト T4〜T5 結果
- §4 タスク 3（ログ機構刷新）変更箇所 + テスト T6〜T9 結果
- §5 タスク 4（4 ラベル追加）変更箇所 + テスト T10〜T13 結果
- §6 タスク 5（バージョン / CHANGELOG / ビルド / コミット）成果物
- §7 致命バグ保護 5 件への影響評価（個別検証）
- §8 並列 sub-agent / Task 起動数の報告
- §9 構築士への質問
- §10 一時計測ログ挿入の確認
- §11 スコープ管理の自己申告

---

## 8. 完了報告

CC は実装 + ビルド完了後、構築士に「**rc18 第 1 弾実装完了**」と返す。
構築士は CC_REPORT を採点 → 前原さんに翻訳説明 → 前原さん rc18 試験（問題 ②⑤⑥ 解決確認 + 問題 ① 体感再評価 + 問題 ④ 継続観察 + ログ採取）→ 結果次第:

- 問題 ②⑤⑥ 解決 + 問題 ① 解消 → **問題 ④ 第 2 弾事前調査 → rc19 で問題 ④ 修正 → v2.0.4 final 本配布**
- 問題 ②⑤⑥ 解決 + 問題 ① 残存 → ログ刷新後の正確なレイテンシ実測 → rc19 で IPC 順序入替（修正案 ②）+ 問題 ④ 統合修正

**v2.0.4 final 配布判断は問題 ①②③④⑤⑥ 全解決まで保留**。前原さんの実機体感を最優先する。
