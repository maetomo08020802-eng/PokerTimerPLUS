# CLAUDE.md - PokerTimerPLUS+ 構築司令塔

## プロジェクト概要
全国のポーカールーム向けに無料配布するElectron製ポーカートーナメントクロック。
- プロダクト名: **PokerTimerPLUS+**
- 制作: Yu Shitamachi（PLUS2運営）
- 配布形態: フリー配布（全国のポーカールームでの汎用使用）
- PLUS2ブランドおよび作者の認知拡大を目的とした戦略的フリーソフト

## 参照ドキュメント
- 機能仕様: docs/specs.md
- パイプライン: PIPELINE.md
- UIトークン（色・タイポ・余白）: skills/ui-tokens.md
- UIレイアウト（グリッド・背景・安定性）: skills/ui-layout.md
- UIコンポーネント（カード・タイマー・マーキー等）: skills/ui-components.md
- UI状態（警告色・一時停止・ブレイク）: skills/ui-states.md
- タイマー実装: skills/timer-logic.md
- 音響システム: skills/audio-system.md
- ブランディング: skills/branding.md
- ※ skills/ui-design.md は廃止。上記4ファイルに分割済み

## STEP順序（必ず順番に実行）
- STEP 0: 既存アプリ調査（完了：docs/specs.md生成済）
- STEP 0.5: specs.md改訂（汎用化＋クレジット仕様追記）
- STEP 1: Electronプロジェクト初期化（package.json / main.js / index.html）
- STEP 2: コアタイマー実装【承認①】
- STEP 3: ブラインド構造管理
- STEP 4: 通知音システム
- STEP 5: スタートカウントダウン【承認②】
- STEP 6: プレイヤー・賞金管理
- STEP 7: 設定永続化
- STEP 8: 仕上げ・テスト・配布ビルド【承認③】

## 承認ポイント
各承認ポイントで作業を停止し、オーナーに動作確認とフィードバックを求める。
オーナーの「次へ」コメントなしに次STEPに進まないこと。

- 承認①（STEP 2完了時）: タイマーが正しくカウントダウンし、レベル進行・一時停止・リセットが動くか
- 承認②（STEP 5完了時）: 通知音とスタートカウントダウンが期待通りに動作するか
- 承認③（STEP 8完了時）: 全機能・全ショートカット・全画面表示が問題なく動くか

## 禁止事項（実装ルール）
- 承認ポイントを飛ばして次STEPに進まない
- 仕様にない機能を勝手に追加しない（提案はOK、実装は承認後）
- npm install以外の外部ネットワーク通信を実装しない
- ユーザーデータをアプリ外に送信しない（完全ローカル動作）
- UIの文言を英語のまま残さない（必ず日本語化、ただしアプリ名"PokerTimerPLUS+"は固定）
- console.errorやTODOコメントを未処理で残さない
- 既存のPokerStars Poker Clockのコード・素材を直接コピーしない（参考のみ）

## 禁止事項（ブランディング保護）
- アプリ名 `PokerTimerPLUS+` を設定で変更可能にしない
- ウィンドウタイトルバー `PokerTimerPLUS+ — presented by Yu Shitamachi` を編集可能にしない
- About画面のクレジット表記を非表示にする機能を実装しない
- インストーラの発行元 `Yu Shitamachi` を変更可能にしない
- assets/logo-yushitamachi.svg を設定画面から差し替え可能にしない
- 詳細は skills/branding.md を参照

## 汎用化ルール（全国配布対応）
- 初期値は「PLUS2固有の値」を避け、ジェネリックなデフォルトにする
- 例: イベント名のデフォルトは「ポーカートーナメント」（「PLUS2 トーナメント」ではない）
- ロゴ画像は設定で差し替え可能（初期値は同梱のPLUS2ロゴ）
- 通貨記号デフォルトは ¥ だが設定で変更可能

## ファイル構成ルール
- src/main.js: Electronメインプロセス
- src/renderer/: レンダラ（HTML/CSS/JS）
- src/audio/: 通知音mp3
- src/assets/: ロゴ・画像（logo-plus2-default.png, logo-yushitamachi.svg）
- src/presets/: ブラインド構造プリセットJSON
- 設定保存先: electron-store経由（OSのuserData配下）

## コード品質
詳細は skills/ 配下の各ファイルを参照。
共通ルール:
- バニラJS優先（必要時のみライブラリ追加）
- 関数は1機能1関数、50行以内
- 変数名・関数名は日本語コメント付き英語
- HTMLは意味のあるclass名、idはJS連携箇所のみ

## テスト
- STEP完了ごとに動作確認スクリプト or 手順書を出力する
- タイマー精度はsetTimeout単発ではなくperformance.now()基準のループで実装

## 報告形式
各STEP完了時に以下を出力する:
- 実装した機能のリスト
- 変更したファイル一覧
- 動作確認手順（手動チェックリスト）
- 次STEPの予告

---

## CC作業フロー（運用ルール）

### 応答先・形式
- すべての応答は **CC構築士宛て**、技術詳細OK
- 応答は **`CC_REPORT.md`** に保存（既存上書き）
- 末尾に「オーナー向け確認依頼」を平易な日本語で簡潔に（3〜5項目）

### 標準制約（毎回適用、明記不要）
- skills/ui-design.md は廃止、参照禁止（ui-tokens.md / ui-layout.md / ui-components.md / ui-states.md を参照）
- レイアウトシフト撲滅 5原則維持（ui-layout.md）
- 既存実装を破壊しない
- 自動測定 `__autoCheck()` で drift 0 維持
- transform: scale 禁止（layout計算外で overlap の元）
- branding.md §15 ブランディング保護を遵守
- bottom-bar / marquee は flex column 配置（position: fixed 禁止）
- カード幅 42vw / 32vw 固定維持

### 入力中保護（2026-04-29 確定、v1.2.0）
- DOM 再構築（`renderBlindsTable` / `applyTournament` / `renderTournamentList` / `renderPayoutsEditor` 等）時は必ず `isUserTypingInInput()` 統一ヘルパでガード
- ガード対象: text / number / textarea / contentEditable 等の typing 系入力フィールド（checkbox / radio / button は除外）
- ガード適用箇所: 1 秒ごと再描画されるリスト系、フォーム同期系、テーブル再構築系
- 違反すると入力中のフォーカス喪失・打鍵中の値消失の重大 UX バグになる（fix9 で確立、再発禁止）

### 編集モード readonly 解除（2026-04-30 追加、v1.2.0）
- 「複製して編集」「新規作成」ハンドラでは `ensureEditorEditableState()` を**同期 + RAF 内で 2 回**呼ぶ
- 防御的多重化により readonly 残存バグの再発防止（C.1-A2 で確立）
- `setBlindsTableReadonly(false)` 経路で `readonly` 属性も明示クリア（CSS との整合）

### tournamentRuntime 不変条件（2026-04-30 確定、v1.2.0）
- 「ブラインド構造を変えても tournamentRuntime（プレイヤー人数・リエントリー・アドオン）は絶対に消えない」
- `handleReset()` は明示的「タイマーリセット」ボタン経由のみ（runtime 含む完全リセット）
- ブラインド適用系（保存して適用→リセット / handlePresetApply の reset）は `resetBlindProgressOnly()` を使う
- `tests/runtime-preservation.test.js` で静的解析により担保（C.2.7-A 致命バグ 8-8 修正）

### スコープ管理（最重要、2026-04-30 追加）
- **NEXT_CC_PROMPT.md に明示された Fix 項目以外は実装しない**
- 調査・監査フェーズで他に修正したい項目を発見した場合、**CC_REPORT.md の「構築士への質問」セクションに提案として記載のみ**。実装は構築士の承認を得て次フェーズで行う
- 「ユーザー要望に最善を尽くして対処」と読んでも、勝手に実装範囲を広げない（CC は実行する存在、設計判断は構築士の役割）
- 致命級バグ発見時は CC_REPORT 冒頭に明示し、構築士判断を仰ぐ（自動修正禁止）
- スコープ越えは構築士フレームワーク違反として採点減点対象（指示忠実性 30 点項目）

### 報告フォーマット（CC_REPORT.md、簡潔版）
```
# CC_REPORT — YYYY-MM-DD タイトル

## 1. サマリー
（1〜2行で何をしたか）

## 2. 修正ファイル
| ファイル | 変更点（短く） |

## 3. 主要変更点
（コード抜粋は必要な箇所のみ、5行以内/件、要点だけ）

## 4. 構築士への質問（あれば）
（番号付きで、なければセクション省略）

## 5. オーナー向け確認
（3〜5項目、平易な日本語）
```

**簡素化方針**:
- 詳細コード抜粋は 5行以内/箇所、要点のみ
- 「制約」「自動測定影響」「STEP移行準備」などのセクションは**変更や懸念があるときのみ**記載
- 構築士への質問がない場合はセクション自体を省略
- ファイル名・行番号への深いリンクは原則不要（git diff で見れば足りる）

### NEXT_CC_PROMPT.md フォーマット（簡潔版）
構築士は以下の最小構成でプロンプトを書く:
```
# (タイトル)

## 状況（必要なら1〜2行）

## 修正内容
1. 〜
2. 〜

## 追加制約（標準制約以外で必要なもののみ）
- 〜

## 期待結果
- 〜
```

挨拶・運用ルール再掲・標準制約・報告フォーマット指定はすべて省略（このCLAUDE.md記載で十分）。

