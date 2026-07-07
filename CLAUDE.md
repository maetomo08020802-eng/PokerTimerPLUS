# CLAUDE.md - PokerTimerPLUS+ 構築司令塔

## プロジェクト概要
全国のポーカールーム向けに無料配布するElectron製ポーカートーナメントクロック。
- プロダクト名: **PokerTimerPLUS+**
- 制作: Yu Shimomachi（PLUS2運営）
- 配布形態: フリー配布（全国のポーカールームでの汎用使用）
- PLUS2ブランドおよび作者の認知拡大を目的とした戦略的フリーソフト

## ハイブリッド自動化（2026-05-28 導入 / ★現在 Phase 1 = 通知のみ・auto-trigger は 2026-06-11 に無効化）

> **★2026-06-22 更新(全プロジェクト共通・customer-app 検証済→本採用): 完了レビューの起動を「cc-review ワークフロー」に一本化**
>
> 完了レポート(`.cc-reports/...md`)を書き終えたら、従来の「Agent ツールで `cc-kouchikushi2` を単発呼出」ではなく、**Workflow〔ワークフロー=複数エージェントを台本どおり自動で回す純正の仕組み〕ツールで `cc-review` を実行**してください。Stop hook での強制起動(旧 Phase 2)が mid-turn でハングした問題を、決定論的・バックグラウンド・再開可能なワークフローで置き換えるのが狙いです。
> - **実行方法**: Workflow ツールに `{ name: "cc-review", args: { reportPath: "<完了reportの絶対パス>" } }` を渡す。`name` で解決できない時は `{ scriptPath: "C:\\Users\\user\\Documents\\Claude\\Projects\\個人アシスタント\\poker-clock\\.claude\\workflows\\cc-review.js", args: { reportPath: "<絶対パス>" } }`。reportPath を省略すると最新の `.cc-reports/*.md` を自動探索。
> - **★実験(2026-07-07〜・このプロジェクトのみ)**: 完了レビュー実行時、まず `{ name: "cc-review2", args: {同上} }` を試す(ユーザーレベル共通版 `C:\Users\user\.claude\workflows\cc-review2.js`。懐疑役の観点は当プロジェクトの `.claude/cc-review-verify.md` を実行時に読む)。name 解決に失敗したら従来の `cc-review` にフォールバックし、**どちらで動いたかを完了報告に1行明記**する(cc-review 1箇所管理化の実験・結果次第で全プロジェクト移行判断)。
> - **cc-review がやること**: ①構築士2(cc-kouchikushi2)が**従来どおり**完了reviewを実施し `.cc-briefs/...completion_review.md` を Write(DoD/INVARIANTS/スコープ判定。poker-clock は致命バグ保護5件も照合)②独立した懐疑役が SQL/DB・認証/認可境界・スコープを「反証する気で」二次チェックし、懸念/escalate の有無を返す。
> - **完了後の処理は従来どおり**: CC は completion_review.md を Read → 既存の「チャット丸展開ルール」を実行 + ワークフロー戻り値の二次チェック結果(懸念/escalate)を1行添える。
> - **読み替え規約**: 本ファイル内で「完了report 書出後に `cc-kouchikushi2` を能動呼出/単発呼出」とある箇所は、**完了reviewに限り**「`cc-review` ワークフローを実行」と読み替える。使えない・失敗時のみ従来の単発呼出にフォールバック。**Plan 軽量review・brief 起案の単発呼出は従来どおり**。
> - **他ルールは全て従来どおり**: Stop hook 通知・INVARIANTS・DoD・6-A/6-B・並列sub-agent最大3体・push前review 等は不変。変わるのは「完了reviewの起動方法だけ」。

> **現在の運用(2026-06-11〜)**: Phase 1 = **Stop hook は通知(トースト)のみ**。`~/.claude/hybrid-automation.auto-trigger.enabled` は削除済=サブエージェントの**自動**呼出はしない。主経路は **CC が report 書出直後に `cc-kouchikushi2` を能動呼出**する。Phase 2(自動トリガー)再有効化は手順最適化後に判断。

- **日常運用(主経路)**: CC が plan / report を書く → **CC 自身が Agent ツールで `cc-kouchikushi2` を能動呼出**（`subagent_type: "cc-kouchikushi2"`、対象 md を絶対パスで渡す）→ review.md / completion_review.md / 次 brief を生成 → CC が読んで実装 / 報告。
- **新案件 / 大方針相談**: Cowork 版 構築士2（現状維持）
- **自動参照される Skills**: `plus2-photo-policy`（写真使用可否マップ）、`plus2-terminology`（文言ポリシー）
- **poker-clock 固有の DoD 観点**（致命バグ保護 5 件 / 既存テスト全 PASS / 並列 sub-agent 最大 3 / レイアウトシフト撲滅 5 原則 / ブランディング保護）はサブエージェントも認識（CLAUDE.md ルール4-B 経由で参照）
- **詳細・トラブル時の対応**: [`~/.claude/HYBRID_AUTOMATION_README.md`](file:///C:/Users/user/.claude/HYBRID_AUTOMATION_README.md)
- **Stop hook 通知対象**（`~/.claude/scripts/relay-to-kouchikushi.ps1`、allow-list に登録済）: `.cc-reports/*.md` + `.cc-plans/*.md` + `.cc-briefs/*_brief.md`（除外: `README.md` / `_template*.md` / `*_review.md` / `*_completion_review.md`）。Phase 1 では通知のみ(自動 review は走らない)。

## レビュー必読 INVARIANTS（致命ルール・サブエージェント必読）

> この節はサブエージェント版 構築士2 が**レビューのたびに必ず全文読む**短い致命ルール一覧（review-rules.md §0-4）。
> ここに違反する変更は DoD が全■でも承認しない。

### ★ 全プロジェクト共通・最優先ルール(2026-06-18 常設・全プロジェクト同一)

> CC(Code)が最初に読む位置に常設。court 生成ループ〔同じ語を延々繰り返すモデル側の暴走〕と PROGRESS 再肥大は、ルールを脚注に書くだけでは防げないと実証されたため致命ルールに格上げした。

- **① ツール作業中は前置きゼロ**: ツール(Read/Edit/Bash 等)を呼ぶ前に文章を一切書かない(「〜します:」等の前置きの断片が court ループの引き金)。説明は全ツール完了後に普通の完全な文で 1 回だけ。区切り線・絵文字や記号の連打・意味のない短語も書かない。同じ語/記号が連続し始めたら、その応答を即座に打ち切る(自己検知・自己停止)。
- **② PROGRESS.md 肥大厳禁**: 各行は 1〜2 行。`## 直近の状態`は **最新スナップショット 1 つだけ**(完了報告のたびに古い記載を消して上書き=過去セッションのログを積み増さない。これが再肥大の主因)。実装の詳細 narrative・migration 検証ログ(VERIFY/SMOKE)・恒久知見の全文は書かず `.cc-reports/...md` と memory に委ねる。完了/アーカイブは「日付+案件+一言+commit」の 1 行のみ。サブエージェントは review 時、PROGRESS が肥大していれば指摘する。

- **致命バグ保護 5 件は全件維持**: resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所。1 件でも壊す変更は禁止。report に全件「影響なし or 影響あり+対処」を明記。【標準制約 / DoD / 段階1 条件4】
- **既存テスト全 PASS 維持**: skip / コメントアウト / 無効化は禁止。件数・PASS 状況に変化があれば構築士2 review 必須。【DoD「既存テスト全 PASS 維持」】
- **tournamentRuntime は消さない**: 完全リセットは `handleReset()`（タイマーリセットボタン経由のみ）、ブラインド適用系は `resetBlindProgressOnly()`。runtime（人数・リエントリー・アドオン）消失は致命バグ。
- **入力中保護**: DOM 再構築は `isUserTypingInInput()` でガード（打鍵中の値消失・フォーカス喪失の再発禁止）。
- **編集モード readonly 解除**: 複製/新規作成は `ensureEditorEditableState()` を同期＋RAF 内で 2 回呼ぶ。
- **ブランディング保護**: アプリ名 `PokerTimerPLUS+`・`presented by Yu Shimomachi`・About クレジット・発行元・`logo-yushitamachi.svg` を設定で変更/非表示/差し替え可能にしない。【禁止事項（ブランディング保護）】
- **レイアウトシフト撲滅**: `__autoCheck()` drift 0、`transform: scale` 禁止、bottom-bar/marquee は flex column（position: fixed 禁止）、カード幅固定。【標準制約 / ui-layout.md】
- **完全ローカル動作**: npm install 以外の外部ネットワーク通信を実装しない。ユーザーデータをアプリ外に送信しない。
- **スコープ厳守**: `.cc-plans/` の Plan に明示された項目以外は実装しない。別問題は report「残作業」に提案記載のみ（自動修正禁止）。
- **ライブラリ追加・既存破壊は承認制**（バニラ JS 優先）。**並列 sub-agent / Task は最大 3 体**（review 呼出は除外）。
- **単画面後方互換（v2.x）**: HDMI 非接続 PC で v1.3.0 と完全同一動作。ホール側に設定/ボタン類を絶対表示しない。【v2.0.0 不変条件】
- **賞金プール 既存ユーザー保護（v2.4.x）**: 既存トーナメントを開いた瞬間に TOTAL POOL が変わるのは禁止（migration 補完 100%、新規のみ 0%）。【v2.4.0 不変条件】
- **リリースは前原 GO 後のみ**: main merge / tag / push / .exe ビルド / Release は前原 GO 前提。実機検証（HDMI・2 画面同期・音声・タイマー精度・ブランド主観）は 6-B 行きで自走を止めない。

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
- **前原に直接作業を依頼しない**（2026-05-24 追加）。完了報告 md の冒頭やセクション内で「前原さんへの動作確認依頼」「○○してください」のような命令調で前原宛に直接書かない。前原実機確認が必要な項目は **`## 6. 構築士2 への確認事項` セクションに「前原実機確認候補」として整理**（手順・所要時間・チェック項目を箇条書き）。構築士2 がそれを `.cc-briefs/...review.md` で再構成して前原に渡す。前原は実装作業・実機確認の窓口を常に「構築士2 経由」で受け取る
- **CC は自走を止めない（2026-05-28 追加）**。サブエージェント版構築士2 の review(現 Phase 1 では CC が report/plan 書出直後に能動呼出)が回る体制のため、CC が進行方針で立ち止まることは禁止である。具体的には:
  - セクション E 段階 1 のスキップ 4 条件すべて met なら、確認なしで即実装着手（チャットに「軽量 review スキップ運用で実装に進みます」を 1 行明記すれば足る）
  - 4 条件のいずれか not met なら、確認なしで即サブエージェント自動呼出（段階 2）に進む
  - **`AskUserQuestion` / `ExitPlanMode` / 進行方針確認質問（「このまま進めて良いか」「Plan のどれを採用するか」等）は全面禁止**。plus2-homepage で 2026-05-28 に「CC が AskUserQuestion で止まる」事案発生済、本プロジェクトでも再発させない
  - 判断に迷ったら**最も安全側に倒して自走**する。安全側の定義:
    - 致命バグ保護 5 件（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所）に影響しうる兆候 → 段階 2 強制（段階 1 スキップ不可）
    - 既存テスト全 PASS 維持を優先（skip / コメントアウトで通すぐらいなら未達 □ で正直に報告）
    - ブランディング保護 §15・レイアウトシフト撲滅 5 原則違反疑い → 段階 2 強制
  - **実機モニター / HDMI 抜き差し / 音声出力確認等の物理検証は完了報告 6-B（前原実機確認候補）行きで処理し、自走を止めない**。CC 側で完結可能な静的解析・`npm test`・ビルド確認は最後まで実施した上で 6-B に振り分ける

## 禁止事項（ブランディング保護）
- アプリ名 `PokerTimerPLUS+` を設定で変更可能にしない
- ウィンドウタイトルバー `PokerTimerPLUS+ — presented by Yu Shimomachi` を編集可能にしない
- About画面のクレジット表記を非表示にする機能を実装しない
- インストーラの発行元 `Yu Shimomachi` を変更可能にしない
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

## CC作業フロー（運用ルール、2026-05-23 改定: md 経由ハンドオフ、2026-05-23 追加: brief 経由指示）

### CC ⇄ CC構築士2 標準作業フロー（brief 経由）

CC が新規 STEP / 新規タスクに着手するとき、前原（オーナー）からは超短い指示が来る:

```
.cc-briefs/YYYY-MM-DD_案件ID_短い作業名_brief.md を読んで Plan Mode で進めて
```

または

```
.cc-briefs/...の通り実装フェーズに進んで
```

CC は brief を Read して、案件固有の指示を取り込む。共通ルール（運用フロー・標準制約・禁止事項・致命バグ保護評価・完了報告フォーマット・commit 方針・並行セッション衝突回避）は **本 CLAUDE.md にすべて書いてあるので brief には書かない**。重複させない。

### CC が brief を読んだら必ずやること
1. brief 冒頭の「直近状態」を確認（ブランチ・直前 commit・直前 STEP の `.cc-reports/...md`）
2. **本 CLAUDE.md の「CC 作業フロー(運用ルール)」+ 該当案件セクション（例: 「v2.4.0 賞金プール計算改修」）を必ず先に読む**
3. 必要に応じて該当案件の `.cc-plans/...plan.md`（過去 STEP）を読む
4. brief の指示に従って Plan Mode → `.cc-plans/` に書き出し → 構築士2 / 前原承認待ち → 実装 → `.cc-reports/` に書き出し

### 3 つのハンドオフフォルダ（責任分担）
| フォルダ | 書き手 → 読み手 | 用途 |
|---|---|---|
| `.cc-briefs/` | CC構築士2 → CC | 各 STEP / タスクの作業指示（案件固有のみ） |
| `.cc-plans/` | CC → CC構築士2 | Plan Mode で書く実装プラン |
| `.cc-reports/` | CC → CC構築士2 | 作業完了報告 |

ファイル名規則は各フォルダの README.md 参照。

### Plan Mode の使い方（必須）
以下は必ず Plan Mode（ファイルに触らず計画のみ立てるモード）で計画 → md 書き出し → 構築士2 判定 → オーナー承認の流れを踏む:
- 複数ファイルを触る作業
- 3手順以上の作業
- 新機能の追加
- 既存構造の変更
- 致命バグ保護 5 件（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所）に影響しうる変更

以下は直接実装で OK:
- 1ファイル・1〜2手順の小修正
- タイプミス修正・コメント追加
- オーナーが「Plan Mode なしで」と明示したとき

### Plan 書き出しルール
`ExitPlanMode` と同時に **`.cc-plans/YYYY-MM-DD_案件ID_短い作業名_plan.md`** に Plan 本文を書き出す。
チャットには「Plan 書き出し済、パス: .cc-plans/...」とパスのみ一言。

Plan 書き出し時のフォーマット:
```
# Plan — YYYY-MM-DD 案件ID タイトル

## 状況（必要なら1〜2行）

## やること
1. 〜
2. 〜

## 触るファイル一覧（衝突回避のため必須）
- src/...
- tests/...

## 致命バグ保護 5 件への影響評価
- (影響あり/なし、ありの場合は具体的に)

## 並列起動予定の sub-agent / Task 数
- (0 or 数値)

## 追加制約（標準制約以外で必要なもののみ）

## 期待結果
```

### 作業完了報告ルール
作業完了時、必ず以下の両方を出す:

**① チャット（5 行以内の簡潔報告）**: やったこと / 確認 / 次の選択肢

#### ★ 2026-05-28 朝 追加: CC は完了 review の前原向け情報をチャットに丸展開

2026-05-28 朝、案件34 STEP 1（customer-app）完了時に前原から「`completion_review.md` を開きに行くのが無駄、CC のチャットだけで実機確認 → push 承認 → 次案件判断が完結すべき」との恒久指示が出た。サブエージェント版構築士2 が自動書出する `.cc-briefs/...completion_review.md` は本来「構築士2 ↔ CC の内部ハンドオフ md」であり、前原は読まない想定である。それにもかかわらず 6-B 実機シナリオ表等の前原必要情報がそこにしか存在せず、結果として前原に md ファイル参照を強いる運用になっていた問題を恒久解消するためのルールである。

poker-clock は実機モニター / HDMI 抜き差し / 音声出力 / 配信版 .exe 起動確認等、ルール4-D「前原実機確認トリガー条件」に該当する実機操作が他 2 プロジェクトに比べて多い特性を持つ。そのため 6-B（前原実機確認候補）系のチャット丸展開は特に重要である。

**運用ルール**:

1. CC は `.cc-briefs/...completion_review.md`（サブエージェント自動書出）を Read したら、前原向け情報（**6-B 実機シナリオ表 / 0. まずアクション / 次案件選択肢**）を **チャットに Markdown 表として丸コピペ展開**する（md 参照指示で済ませない）
2. 5 行サマリ構造を以下のとおり更新する:
   - 1〜2 行目: やったこと（簡潔に）
   - 3 行目: DoD 達成状況 + 完了 review 判定（✅ 完了承認 / ⚠️ 要追加対応 等）
   - 4 行目: PROGRESS.md 更新済
   - 5 行目: 詳細パス（`.cc-reports/...md`）+ 末尾に「↓ 実機確認シナリオ ↓」と一言添える
3. 5 行サマリ直下に completion_review.md の **6-B 表を丸コピペ展開**する（実機操作手順 / 所要時間 / 確認ポイント / 期待結果の Markdown 表をそのまま貼る）
4. **目的**: 前原は md ファイルを一切開かなくとも、チャットを読むだけで実機確認 → push 承認 → 次案件方針判断まで完結できる状態を担保する
5. **規範**: 「`○○.md` 中段の表参照」「`completion_review.md` の 6-B を見て」のような md 参照指示は **前原向けには使わない**。md 参照指示は CC ↔ 構築士2 内部参照（review 起案時の根拠引用等）のみ許容する
6. **poker-clock 固有の重要性**: 実機モニター / HDMI 抜き差し / 音声出力 / .exe 起動確認等の 6-B 系項目は実機操作が多く所要時間も長いため、前原がチャットの段階で全項目を見渡せる状態が他プロジェクト以上に効くである

**致命バグ保護 5 件への影響**: 本ルールは報告レイヤーの規範であり、resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所のいずれにも影響しない。チャット展開時に致命バグ保護 5 件への影響評価（DoD 項目）の判定結果も併記すれば前原が安心して push 承認できる状態となる。

#### ★ 2026-05-28 朝 追加 #3: CC は report 書出直後、cc-kouchikushi2 サブエージェントを能動的に呼出（stop_hook_active 罠回避）

2026-05-28 朝、plus2-homepage の homepage-jp-typography 案件で **設計バグ発見**である。Plan stage で auto-trigger ON 発火後、同セッション内では `stop_hook_active=true` が継続し、report 書出時の Stop hook が「loop 防止」目的で no-op になる挙動である。結果としてサブエージェント自動完了 review が走らず CC 待機状態に陥る事象が確認された。Stop hook を loop 防止挙動として残したまま、CC 側で能動的にサブエージェントを呼出する規範を恒久対策として poker-clock にも展開する規範である。本プロジェクトは致命バグ保護 5 件（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所）の影響評価が他 2 プロジェクトより重い特性を持つため、構築士2 review なしで完了とみなす状態を絶対に作らないことを目的とする。

**運用ルール**:

1. **発火条件**: CC が `.cc-reports/...md` を Write した直後、必ず Agent ツールで `cc-kouchikushi2` サブエージェントを呼出する（緊急 hotfix で構築士2 不在運用が明示的に承認された場合のみ例外、PROGRESS.md の「直近の状態」に例外運用中である旨を明示する）
2. **呼出 prompt 標準テンプレ**:
   ```
   Agent ツール:
   - subagent_type: "cc-kouchikushi2"
   - description: "<案件ID> 完了 review"
   - prompt: |
       完了 review を実施してください。
       対象 report: .cc-reports/...md（絶対パス）
       対象 brief: .cc-briefs/...brief.md（絶対パス）
       対象 plan: .cc-plans/...plan.md（絶対パス）
       対象 Plan 軽量 review: .cc-briefs/...review.md（あれば）

       通常通り DoD 判定 + 6-A/6-B 整理 + .cc-briefs/...completion_review.md 書出してください。
       6-B 表は Markdown 表形式で書いてください（チャット展開前提）。
   ```
3. **呼出後**: サブエージェントが書出した `.cc-briefs/...completion_review.md` を Read で確認 → 直上「★ 2026-05-28 朝 追加: CC は完了 review の前原向け情報をチャットに丸展開」の規範に従い、6-B 実機シナリオ表 / 0. まずアクション / 次案件選択肢をチャットに Markdown 表として丸コピペ展開する
4. **Stop hook の位置付け変更**: Stop hook は loop 防止の都合上 `stop_hook_active=true` 状況下で no-op になるため、本ルールの **保険（CC が能動的呼出を忘れた場合のフォールバック）** に位置付け直す。一次的な完了 review 起動経路は CC の能動的呼出側である
5. **poker-clock 固有の絶対呼出条件**: 以下のいずれかに該当する report は **絶対に能動的呼出**である。構築士2 review なしで完了とみなすことを禁止する:
   - 致命バグ保護 5 件（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所）の影響範囲に触れた report
   - 既存テスト全 PASS（v2.4.0 時点 1154 件）の件数 / PASS 状況に変化があった report
   - ブランディング保護 §15（branding.md）に関わる変更を含む report
   - レイアウトシフト撲滅 5 原則（ui-layout.md）に関わる変更を含む report
6. **並列 sub-agent 最大 3 体ルールとの整合**: 本規範による `cc-kouchikushi2` サブエージェント呼出は **最大 3 体カウントに含めない**。構築士2 review は実装作業の並列処理軸とは別軸の運用レイヤーであり、Plan / report で報告する「並列起動した sub-agent / Task 数」にも計上しない

**致命バグ保護 5 件への影響**: 本規範は report 書出後の review 起動経路に関する運用規範であり、resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所のコード経路には影響しない。むしろ「致命バグ保護 5 件に影響しうる report が review されないまま完了扱いになる」最悪ケースを構造的に防ぐ規範であり、5 件保護をより強固にする位置付けである。

**② `.cc-reports/YYYY-MM-DD_案件ID_短い作業名.md` に詳細**（2026-05-27 改定: DoD チェック結果セクション追加、後続 renumber）:
```
# CC作業完了報告 — YYYY-MM-DD 案件ID タイトル

## 1. サマリー
（1〜2行で何をしたか）

## 2. 触ったファイル一覧（衝突回避のため必須）
| ファイル | 変更点（短く） |

## 3. 検証結果
（テスト結果・動作確認、npm test 件数 / PASS / FAIL）

## 4. 致命バグ保護 5 件への影響評価
（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所、全件「影響なし」or「影響あり + 対処」）

## 5. 並列起動した sub-agent / Task 数
（最大 3 体ルール遵守確認、TaskCreate 使用時は Task 番号も）

## 6. DoD チェック結果（2026-05-27 追加、ルール4-B）
brief の DoD 各項目を ■（達成）/ □（未達成、理由必須）で塗り潰し:
- [x] DoD 項目 1 ← ✅ 達成、検証方法: ...
- [x] DoD 項目 2 ← ✅
- [ ] DoD 項目 3 ← ⚠️ 未達成、理由: 実機モニター必要、7.x で前原確認候補
- [x] PROGRESS.md 更新 ← ✅（リリース履歴 + 累積統計 + 直近の状態）

## 7. 構築士2 への確認事項（あれば）
（番号付きで、なければセクション省略）

### 7.x 前原実機確認候補（CC では検証不可能な項目があれば記載、振り分け基準はルール4-D）
（前原向け命令調で書かない。手順・所要時間・チェック項目を箇条書きで整理。構築士2 が review md で再構成して前原に渡す）

## 8. 残作業 / 次にできそうなこと
（スコープ外で気づいたことは提案として記載のみ）
```

完了報告書き出し後、**同じターンで** [PROGRESS.md](PROGRESS.md) を Edit（ルール4-C）。
チャット 5 行報告の末尾に「**PROGRESS.md 更新済**」と一言添える。

### 並行 CC セッション衝突回避（必読）
- 作業開始前に `.cc-plans/` と `.cc-reports/` の最新を必ず確認すること
- 同じ案件 ID で別セッションが動いている可能性があれば、編集前にオーナーに確認
- 自分が触ったファイルは必ず `.cc-reports/` md の「2. 触ったファイル一覧」に明記すること（他 CC との衝突回避）

### 旧運用ファイル（廃止、参照禁止）
以下は旧運用の名残。新しい作業で書き出さない・読まない。履歴としてのみ参照可。
- `CC_REPORT.md`
- `NEXT_CC_PROMPT.md`
- `NEXT_CC_PROMPT_RC18_PHASE2.md`
- `HANDOFF.md`
- `HANDOVER.md`

### 標準制約（毎回適用、明記不要）
- skills/ui-design.md は廃止、参照禁止（ui-tokens.md / ui-layout.md / ui-components.md / ui-states.md を参照）
- レイアウトシフト撲滅 5原則維持（ui-layout.md）
- 既存実装を破壊しない
- 自動測定 `__autoCheck()` で drift 0 維持
- transform: scale 禁止（layout計算外で overlap の元）
- branding.md §15 ブランディング保護を遵守
- bottom-bar / marquee は flex column 配置（position: fixed 禁止）
- カード幅 v1.x は 42vw / 32vw、v2.x は 54vw / 46vw 固定維持

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

### スコープ管理（最重要）
- **`.cc-plans/` 配下の Plan に明示された項目以外は実装しない**
- 調査・監査中に他に修正したい項目を発見した場合、**`.cc-reports/` の「7. 残作業 / 次にできそうなこと」セクションに提案として記載のみ**。実装は構築士2 の承認を得て次フェーズで行う
- 「ユーザー要望に最善を尽くして対処」と読んでも、勝手に実装範囲を広げない（CC は実行する存在、設計判断は構築士2 の役割）
- 致命級バグ発見時は `.cc-reports/` 冒頭に明示し、構築士2 判断を仰ぐ（自動修正禁止）
- スコープ越えは構築士2 フレームワーク違反として採点減点対象（指示忠実性 30 点項目）

### ルール4: 4 つの md ハンドオフ書類の役割を厳密に守る（2026-05-27 追加、3 プロジェクト統一）

plus2-homepage で **review が brief の倍以上発行される事態**（brief 9 / review 22）が起きた事案を受けて、3 プロジェクト統一の review 削減ルールを poker-clock にも展開。

#### A. 各ファイルの役割境界（重複禁止）

| ファイル | 書き手 | 中身（これだけ書く） | 書かないこと |
|---------|-------|-------------------|-------------|
| `.cc-briefs/...brief.md` | 構築士2 | **WHAT** = 役割 / 確定仕様 / 触るファイル / **DoD（完了条件チェックリスト）** / 前原実機確認候補 | 実装手順詳細（plan の領域）、CLAUDE.md 既出ルール |
| `.cc-plans/...plan.md` | CC | **HOW** = 実装手順 / 触るファイル一覧 / 致命バグ保護 5 件影響評価 / 並列 sub-agent / Task 数 / リスク | brief の指示の再記述 |
| `.cc-briefs/...review.md` | 構築士2 | **判定** = DoD 各項目への ✅/❌ 判定と理由 / 追加指示（あれば）/ 前原実機確認候補の依頼形再構成 | 既出指示の再記述 |
| `.cc-reports/...md` | CC | **結果** = サマリー / 触ったファイル / 検証結果 / 致命バグ保護評価 / 並列数 / **DoD チェック結果**（■/□）/ 構築士2 への確認 | 計画の再掲 |

review は「DoD 項目への ✅/❌ + 追加指示のみ」に絞る。既出再記述を見つけたら構築士2 自身が削る。

**review.md 分量目安（2026-05-28 追加）**:
- **通常型 brief（実装タスク）の軽量 review = 5 行程度**（DoD 各項目への ✅/❌ + 追加指示のみ、全 ✅ なら「完了承認」短文で済む）
- **investigation 型 brief（調査・監査・設計探索系）の review = 50〜120 行が現実的下限**。調査結果の事実整理 + 判定根拠 + 次フェーズ方針が含まれるため 5 行では収まらない。「分量が膨らんだ = 異常」とは判定しない（plus2-homepage homepage-performance-audit 案件の事例で確立）

**brief 書き手の厳守事項（2026-05-28 追加、ルール4-A 補足）**:
- **brief 起案は構築士2（Cowork 版 or サブエージェント版 `cc-kouchikushi2`）の専任業務**。CC は brief を書かない
- 暗黙的に「CC が brief を書く」運用パターンが発生したら異例事態。CC は **必ず `Agent` ツールで `subagent_type: "cc-kouchikushi2"` を呼出し、サブエージェントに brief 起案を代行させる**（CC 自身は WHAT を確定する権限を持たない、ルール4-A 役割境界の趣旨）
- 緊急小修正 brief（1〜2 行）であっても CC が直接書き出さず、サブエージェント呼出経由で書き出す

#### B. DoD（Definition of Done）= brief 必須セクション

すべての brief は末尾に「## ✅ DoD（完了条件チェックリスト）」を必ず含める（構築士2 起案、CC が報告書で塗り潰し）。poker-clock 標準 DoD 項目例:

```markdown
## ✅ DoD（完了条件チェックリスト）

- [ ] 機能 / 仕様反映 1（brief 確定仕様の各項目）
- [ ] 機能 / 仕様反映 2
- [ ] **致命バグ保護 5 件への影響評価明記**（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所、全件「影響なし」or「影響あり + 対処」明記）
- [ ] **既存テスト全 PASS 維持**（v2.4.0 時点 1154 件、skip / コメントアウト禁止）
- [ ] v2 専用テスト追加（該当時）
- [ ] **並列起動した sub-agent / Task 数を report 明記**（最大 3 体ルール遵守）
- [ ] レイアウトシフト撲滅 5 原則維持（ui-layout.md）
- [ ] ブランディング保護遵守（branding.md §15）
- [ ] atomic commit（または brief 規定数）
- [ ] PROGRESS.md 更新（オープン STEP / リリース履歴 / 累積統計 / 直近の状態）
```

CC は完了報告の **新セクション「## DoD チェック結果」** を必ず追加し、各項目を ■（達成）/ □（未達 + 理由必須）で塗り潰す。

**全項目 ■ になるまで構築士2 は完了 review を発行しない**。全部 ■ なら review は「✅ 完了承認、リリース判断可、前原実機確認手順は次の通り…」の短文で済む（review 数削減の核）。

#### C. PROGRESS.md（`poker-clock/PROGRESS.md`）更新義務

完了報告（`.cc-reports/...md`）を書いたら、**同じターンで** [PROGRESS.md](PROGRESS.md) を Edit:

1. オープン STEP 表から該当行を削除（or 「(なし)」復活）
2. リリース実施時はリリース履歴に新行追加（配信日 / バージョン / 主要変更 / report）
3. 累積統計（テスト件数 / リリース数）を更新
4. 直近の状態ブロック（ブランチ・直前 commit・配信状況・次のアクション）を更新

新作業着手時（brief 受領時）は逆に **オープン STEP 表に行を追加**（状態 `📝 brief 起案中` → `🤔 Plan 中` → `🟢 実装中` → `📦 配信準備中` → ...）。

完了報告書き出し後、チャット 5 行サマリの末尾に「**PROGRESS.md 更新済**」と一言添える。構築士2 は完了 review 発行時、CC が PROGRESS.md を更新したか必ず確認。

#### D. 前原実機確認トリガー条件（6.x の振り分け基準）

完了報告 6. に「前原実機確認候補」を入れる前に、本基準で振り分ける。

**前原実機確認に置くべきもの**:
- HDMI 抜き差し時の自動追従挙動の実機確認
- 実機モニターでの 2 画面同期の目視確認
- 音声出力の実機確認（AudioContext / 通知音）
- タイマー精度の体感確認（長時間トーナメント時のドリフト）
- 配信版 .exe の起動 / インストール挙動
- ブランド保護違反の主観評価（ロゴ / クレジット / タイトルバー）

**構築士2 だけで判断可能なもの**:
- `npm test` 1154 件全 PASS 確認
- 致命バグ保護 5 件の静的解析（`runtime-preservation.test.js` 等）
- レイアウトシフト撲滅 5 原則遵守確認
- スコープ越え有無確認
- 並列 sub-agent / Task 数 = 最大 3 ルール遵守確認
- CHANGELOG.md / docs/specs.md 更新整合性確認

CC が判断に迷ったら構築士2 判定可側に置く。構築士2 が「これは実機確認必要」と判断すれば review で実機確認候補に振り分け直す。

##### ★ 2026-06-03 追加: CC 自走の徹底 + 実機確認の機械部分前倒し

**1.「CC 環境ではできない」決めつけ禁止**: 前原に手作業を振る前に、まず CC が自分の環境(ターミナル / `npm test` / ビルド / git / 画面操作=computer-use / ブラウザ操作=Claude in Chrome)で**実際に試す**。前原に振ってよいのは「物理的に不可能(実機モニター / HDMI / 音声出力等)/ 本人の味・ビジネス判断・最終 GO が要る / 実際に試して失敗した」時のみ。
- 例(2026-06-03 案件52 STEP1-b、customer-app での実証): 「CC 環境ではビルド不可・前原が GUI」という旧前提を、CC がターミナルで署名済みビルドまで自走して覆した。poker-clock でも `.exe` ビルド等の CLI 作業はまず CC が試す。
- ※ 致命バグ保護 5 件 / 既存テスト全 PASS は従来どおり厳守(自走しても品質ゲートは緩めない)。

**2. 実機確認の“機械的部分”は CC が自動で前倒し**: CC は画面操作(computer-use)が使える環境では、前原実機確認候補の機械的部分(アプリ起動確認・画面表示確認・スクショ取得)を**自分で実行して証拠を添付**する。前原に残すのは**実機モニター / HDMI 抜き差し / 音声出力 / タイマー精度の体感・ブランド主観評価・最終 GO** など物理 / 主観が要る項目のみ。CC の自動確認は前原判断の置き換えではなく**下準備**。

詳細は `CC構築士2_手順書.md`(2026-06-03 改定)参照。

#### E. 軽量 review 3 段階フロー（2026-05-28 拡張、コワーク報告は escalate 時のみ）

Plan 提示時、以下の 3 段階で処理。詳細は `CC構築士2_手順書.md` セクション E 参照。

**段階 1: スキップ可否判定**

以下 4 条件すべて満たせば軽量 review スキップ、即実装着手:
1. agent 精査(or 同等の品質保証)で **致命指摘ゼロ**
2. agent 精査の **警告すべて反映済**（または見送り理由が技術スタイルレベル）
3. ブランディング保護（branding.md §15）/ レイアウトシフト撲滅 5 原則に **新規判断要素ゼロ**
4. **致命バグ保護 5 件**（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所）に影響がある場合は **適用不可**（poker-clock 固有制約、必ず段階 2 or 3 へ）

スキップ時、構築士2 は完了 review で「事後妥当性検証」セクション必須。

**段階 2: サブエージェント呼出**（2026-05-28 拡張。現 Phase 1 では CC が report/plan 書出直後に能動呼出）

4 条件 not met の場合、CC は Cowork に投げずに `cc-kouchikushi2` サブエージェントを自動呼出（Agent ツール、`subagent_type: "cc-kouchikushi2"`）。Plan + brief パスを渡してサブエージェントが軽量 review → `.cc-briefs/...review.md` 自動書出。CC が読んで実装着手。

**2026-05-28 補足**: Phase 2（auto-trigger）ON 状態のため、CC が plan を書き出した時点でも Stop hook が発火し、サブエージェント版構築士2 が自動 review に入る経路がある（明示的な Agent 呼出と並列に走る場合あり）。plus2-homepage で 3 段階フロー（plan 書出 → 自動 review → 実装 → report 書出 → 自動 completion review）が完全実証成功。CC 側の責務は「plan / report を確実に書き出すこと」、自動 review 起動は Stop hook が担保する。

**段階 3: escalate**（コワーク必要）

サブエージェント自身が「致命バグ保護違反疑い / 真の新規判断 / 大方針変更（v2.x 不変条件への影響等）」を検出した場合のみ stopReason 付き Stop で escalate。前原が Cowork 構築士2 と対話して方針決定 → 修正 brief 起案 → 段階 1 から再実行。

**判断に迷ったら**: 段階 2（サブエージェント呼出）側に倒す。escalate が必要かは構築士2 自身が判断する設計。CC が `AskUserQuestion` / `ExitPlanMode` で立ち止まることは禁止（自走必須ルール、「禁止事項（実装ルール）」末尾参照）。

#### F. Markdown link の使い分け（2026-05-28 追加）

`[text](Windows絶対パス)` 形式は Claude Code Desktop チャットでタップ不可。**人間が見る部分（実機確認候補、チャット返答）はプレーンパス + バッククォート**、CC が読む参照部分は Markdown link 仕様 OK。詳細は `CC構築士2_手順書.md` セクション F 参照。

---

## v2.0.0 大改修（2 画面対応、2026-05-01 着手）

**v2.0.0 状態（2026-05-01 時点）**: STEP 0〜7 すべて完了 → **v2.0.0 完成**。
合計 190 テスト全 PASS、致命バグ保護 5 件すべて完全維持。
配布判断は前原さん次第（GitHub Releases タグ作成 + .exe ビルド + アップロードで配布開始）。

### v2.0.0 概要
- 既存 v1.3.0 を**全機能維持**したまま、HDMI 拡張モニターでの 2 画面表示に対応
- ホール側モニター（お客向け）: タイマー / スライドショー / テロップ等、現状の見た目すべて
- PC 側（前原さん操作）: 操作 UI のみ（ブラインド設定 / トーナメント設定 / 各種ボタン）
- HDMI 抜き差しに自動追従（単画面 ↔ 2 画面）
- 起動時にホール側モニターを毎回手動選択
- 配布タイミング: 「完璧に動くまで配布しない」（前原さん指示、急がない）

### v2.0.0 STEP 順序
- STEP 0: 設計調査（既存コード影響範囲 + 2 画面動作検証、コード変更ゼロ）
- STEP 1: ホール側ウィンドウ追加（最小骨格）
- STEP 2: 2 画面間の状態同期【承認①】（タイマー・構造・設定の同期）
- STEP 3: PC 側 UI の分離（操作専用、ホール側は表示専用）
- STEP 4: 起動時のモニター選択ダイアログ
- STEP 5: HDMI 抜き差し追従【承認②】（自動で単画面 ↔ 2 画面）
- STEP 6: 既存 138 テスト維持 + v2 専用テスト追加
- STEP 7: 最終検証 + ドキュメント更新 + バージョン bump【承認③】

### v2.0.0 承認ポイント
- **承認①（STEP 2 完了時）**: 2 画面間の状態同期というコア技術が動くか目視確認
- **承認②（STEP 5 完了時）**: HDMI 抜き差し追従が想定通りに動くか実機確認
- **承認③（STEP 7 完了時）**: 全機能・全画面が問題なく動くか最終検証 → 配布判断

### v2.0.0 不変条件（既存 v1.3.0 不変条件に追加）
- **既存 138 テスト全 PASS 維持**: v2 実装中に 1 件でも壊れたら即停止
- **致命バグ保護を全て継承**: resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所すべて維持
- **デザイン不変条件継承**: カード幅 54vw / 46vw、Barlow Condensed 700、`<dialog>` に flex 禁止
- **単画面モード後方互換**: HDMI が繋がっていない PC でも v1.3.0 と完全同じ動作をする
- **画面間データ通信は最小化**: 状態同期は差分のみ、ポーリング禁止、無駄に全データ転送しない
- **ホール側にお客様視点で不要な UI を出さない**: 設定ダイアログ・ボタン類はホール側に絶対表示しない

### v2.0.0 スコープ制限（v1.x スコープ管理に上乗せ）
- **`.cc-plans/` 配下の Plan に明示された STEP の範囲のみ実装**
- 「ついでに既存機能改善」禁止、発見した別問題は `.cc-reports/` の「残作業 / 次にできそうなこと」に提案として記載のみ
- v1.x で確立した不変条件・致命バグ修正に影響を与える変更は**事前承認必須**
- 既存 138 テストの skip / コメントアウト / 無効化は禁止

### v2.0.0 参照ドキュメント
- v2 品質基準: skills/v2-dual-screen.md
- v2 パイプライン: PIPELINE.md「v2.0.0 構築フロー」セクション
- **CC 運用アンチパターン（公式ドキュメント準拠、全 STEP 共通絶対遵守）: skills/cc-operation-pitfalls.md** ★毎フェーズ開始時に必読

### v2.0.0 公式ドキュメント準拠の絶対遵守事項（2026-05-01 追加、2026-05-23 改定）
詳細は skills/cc-operation-pitfalls.md を参照。要点だけ:
- **並列 sub-agent / Task は最大 3 体まで**（4 体以上は公式 Agent Teams 推奨違反）
- **「念のため」のコード追加禁止**（特定入力 workaround / hard-coded 値）
- **同じバグで 2 回修正試行する前に context 肥大化を疑う**
- **Plan 指示外の追加実装は `.cc-reports/` の「残作業 / 次にできそうなこと」に記載のみ**
- **Plan Mode 活用**（3 ファイル以上変更時は実装前に plan、`.cc-plans/` に書き出し）
- **`.cc-reports/` に致命バグ保護 5 件への影響評価を必ず明記**
- **`.cc-reports/` に並列起動した sub-agent / Task 数を必ず報告**

---

## v2.4.0 賞金プール計算改修（2026-05-23 着手、STEP 1〜5 全完了 ✅ 配信可能状態）

### 背景
日本国内利用前提のため、エントリー数連動でプライズ（賞金）が上がる現状ロジックは景品表示法・風営法上のリスクがある。フィー入力をデフォルト編集不可にし、`フィー × 件数 × プール率（店ごと設定可）` でプライズを算出する仕組みに改修する。

### 確定仕様（2026-05-23 STEP 1 承認後の最終版）
- **フィー入力欄**（バイイン / リエントリー / アドオン）はデフォルト readonly、🔒アイコン表示
- 🔒クリック → 確認ダイアログ「フィーを入力するとプライズプールが変動します」→ 該当トーナメント編集セッション中のみ解除
- **再ロックトリガー**: 保存・トーナメント切替・アプリ再起動の **すべて** で自動再ロック（解除フローのスコープ §11.5 (D)）
- **プール率設定**（0〜100% **整数のみ、step=1**、各フィー個別）: 店舗デフォルト `appConfig.poolRatesDefault` + トーナメント個別上書き `tournamentState.poolRates`
- **初期値（既存トーナメント保護方針、§11.2 解釈 B 採用）**:
  - **migration 補完値（既存トーナメントに poolRates 不在の場合）= 100%**（既存挙動完全維持）
  - **新規トーナメント作成時のデフォルト = 0%**（appConfig.poolRatesDefault 初期値、安全側）
  - 店舗デフォルト変更 → 既存トーナメントの個別値は変えない
- **計算式**: `prize = Σ(各フィー × 件数 × 該当プール率 / 100)`。既存 GTD ロジック（`max(計算プール, GTD)`）は維持
- **プール率 0% 時の見た目**: 特別な注記なし（自然に PRIZE 計算から外れるだけ）
- **案内文言**: フィー欄真下に「フィー入力時はプライズに反映されます（反映率設定可）」+ 解除ダイアログ内にも同文を表示
- **店舗デフォルト編集 UI**: 既存「設定」ダイアログに追加（音声・背景等と並列、§11.6 (A) 採用）
- **export/import JSON フォーマット**: `EXPORT_VERSION = 2` のまま optional フィールド扱い（旧版 import 時は `appConfig.poolRatesDefault` から補完、§11.3）
- **配信状態**: STEP 5 完了で v2.4.0 として **配信可能状態**（前原 GO 後に push + .exe ビルド + GitHub Release）

### v2.4.0 STEP 順序
- **STEP 1**: 設計調査 + 実装プラン書き出し（コード変更ゼロ） **— ✅完了 2026-05-23**
- **STEP 2**: state スキーマ拡張 + migration **— ✅完了 2026-05-23**（commit `ddba720`）
- **STEP 3**: 計算ロジックをプール率対応に書き換え **— ✅完了 2026-05-23**（commit `9a7ebc4`）
- **STEP 4**: UI 追加（readonly + 🔒 + 解除ダイアログ + プール率欄 + 案内文言 + 店舗デフォルト編集）**— ✅完了 2026-05-23**（commit `0b592e0` + `65e6e6f` STEP 4 fix）
- **STEP 5**: 統合検証 + テスト 14 件追加 + ドキュメント更新 + バージョン bump **v2.4.0** **— ✅完了 2026-05-23**（前原 GO 後に main merge + tag + push + .exe + GitHub Release）

### v2.4.0 不変条件（v1.x / v2.0.0 不変条件に上乗せ）
- **既存テスト全 PASS 維持**: skip / コメントアウト / 無効化は禁止
- **致命バグ保護 5 件すべて維持**: resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所
- **STEP 4 のフィー readonly 制御は別 namespace**: `setFeeReadonly()` / `feeLockState` 等を使用（既存 `ensureEditorEditableState()` / `setBlindsTableReadonly()` とは混同しない）
- **段階リリース可能性の担保**: 各 STEP は単独で挙動破壊しないこと
  - **STEP 2 完了時点** → 既存トーナメントは migration で `poolRates: { buyIn: 100, reentry: 100, addOn: 100 }` 補完、UI 未変更で挙動完全維持。新規作成のみ 0%
  - **STEP 3 完了時点** → 計算式が新ロジックになるが、既存トーナメントは 100% 補完なので結果値は STEP 2 前と完全一致
  - **STEP 4 で初めて目に見える変化** → readonly + 🔒 + プール率入力欄
- **既存ユーザー保護優先**: 「既存トーナメント開いた瞬間に TOTAL POOL が変わる」は絶対に発生させない

### v2.4.0 スコープ制限
- `.cc-plans/2026-05-23_v210-prize-pool-refactor_plan.md` および各 STEP 着手前に書き出される `.cc-plans/...step{N}_plan.md` に明示された範囲のみ実装
- 「ついでに既存機能改善」禁止、発見した別問題は `.cc-reports/` の「残作業 / 次にできそうなこと」に提案として記載のみ
- v1.x / v2.0.0 の不変条件・致命バグ修正に影響を与える変更は事前承認必須

### v2.4.0 参照ドキュメント
- **設計調査・実装プラン（STEP 1 成果物）**: `.cc-plans/2026-05-23_v210-prize-pool-refactor_plan.md`
- **STEP 2〜5 Plan**: `.cc-plans/2026-05-23_v210-prize-pool-refactor_step{2,3,4,5}_plan.md`
- **STEP 2〜5 完了報告**: `.cc-reports/2026-05-23_v210-prize-pool-refactor_step{2,3,4,5}.md`
- 旧計算ロジック: `computeCalculatedPool()`（src/renderer/renderer.js:973-980）
- 旧入力 UI: `js-tournament-buyin-fee` / `js-tournament-reentry-fee` / `js-tournament-addon-fee`（src/renderer/index.html:736-755）
- 既存 store defaults / migration: `src/main.js` L438-481（DEFAULT_TOURNAMENT_EXT）, L619-710（store.defaults）, L734-913（migrateTournamentSchema）
- 仕様詳細: `docs/specs.md` §2.4 + §3.4.1（v2.4.0 で追加）
- リリースノート: `CHANGELOG.md` v2.4.0 セクション
- 競合注意: feature/v2.3.0-prestart-persistence（PRE_START 永続化、v2.3.0 として温存）→ 本案件は **v2.4.0** として独立、`feature/v2.4.0-prize-pool-refactor` ブランチで作業（前原 GO 後に main merge）

