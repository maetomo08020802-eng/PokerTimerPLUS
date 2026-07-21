# CLAUDE.md - PokerTimerPLUS+ 構築司令塔

## プロジェクト概要
全国のポーカールーム向けに無料配布するElectron製ポーカートーナメントクロック。
- プロダクト名: **PokerTimerPLUS+**
- 制作: Yu Shimomachi（PLUS2運営）
- 配布形態: フリー配布（全国のポーカールームでの汎用使用）
- PLUS2ブランドおよび作者の認知拡大を目的とした戦略的フリーソフト

## ハイブリッド自動化(現行運用の要点)

- **現在 Phase 1(2026-06-11〜)**: Stop hook は通知(トースト)のみ・自動トリガーなし。主経路は CC が plan / report 書出直後に構築士2 を能動呼出。新案件・大方針相談は Cowork 版構築士2。写真可否・用語注釈の正典: `plus2-homepage/SKILL.md` §6/§9(旧 Skills は 2026-07-20 廃止)。詳細・トラブル対応: `~/.claude/HYBRID_AUTOMATION_README.md`。導入経緯・全文規約は docs/CLAUDE-archive.md 参照。
- **完了レビュー起動(2026-07-07 本採用・共通版 cc-review2 を scriptPath 優先)**: 完了 report 書出後、Workflow ツールで `{ scriptPath: "C:\\Users\\user\\.claude\\workflows\\cc-review2.js", args: { reportPath: "<report絶対パス>" } }` を実行(トラック体系に従う。通常= mode:"single"・重要= dual)(※ name 指定 `cc-review2` は解決されない=必ず scriptPath で。懐疑役の観点は当プロジェクトの `.claude/cc-review-verify.md` を実行時に読む。reportPath 省略時は最新 `.cc-reports/*.md` を自動探索)。失敗時のみプロジェクト版 `{ name: "cc-review" }`(または `.claude/workflows/cc-review.js`)→ それも不可なら従来の `cc-kouchikushi2` 単発呼出にフォールバックし、どれで動いたかをレビュー後のチャット報告に1行明記。
- **完了後の処理**: completion_review.md を Read → 「チャット丸展開ルール」(後述)を実行し、ワークフロー戻り値の二次チェック結果(懸念/escalate)を1行添える。Plan 軽量 review・brief 起案の `cc-kouchikushi2` 単発呼出は従来どおり。Stop hook 通知・INVARIANTS・DoD・6-A/6-B・並列 sub-agent 最大 3 体・push 前 review 等も不変。

### 完了フローのトラック体系(2026-07-21 改定・正典= 個人アシスタント/docs/review-rules.md §トラック体系)
- **調査**(git diff 空): review 不要。report は「結論3行+根拠」のみ+PROGRESS 1行。
- **fix**(UI/演出/文言のみ・5ファイル以内・DB/認証/INVARIANTS 非接触): brief/plan/report/completion_review 省略。push 前に lightweight_review 1枚+PROGRESS 1行。
- **通常**: brief(または直指示転記3行)→ plan → 実装 → report → cc-review2 を `args: { reportPath: "...", mode: "single" }` で実行(懐疑役方式の単段・独立実測)。
- **重要**(SQL/DB・認証/権限境界・金銭計算): cc-review2 を mode 未指定(=dual・2段)で実行。customer-app は Supabase の SQL/RLS/RPC・会計/ポイント計算が該当。
- 直指示: 前原のチャット直指示が1画面以内・DoD 3項目以内なら brief 不要(report 冒頭に指示転記3行)。
- 不変: 懐疑役の独立実測 / push 前レビュー必須 / 6-B / 迷ったら上位トラックへ。

## レビュー必読 INVARIANTS（致命ルール・サブエージェント必読）

> この節はサブエージェント版 構築士2 が**レビューのたびに必ず全文読む**短い致命ルール一覧（review-rules.md §0-4）。
> ここに違反する変更は DoD が全■でも承認しない。

### ★ 全プロジェクト共通・最優先ルール(2026-06-18 常設・全プロジェクト同一)

> CC(Code)が最初に読む位置に常設。court 生成ループ〔同じ語を延々繰り返すモデル側の暴走〕と PROGRESS 再肥大は、ルールを脚注に書くだけでは防げないと実証されたため致命ルールに格上げした。

- **① ツール作業中は前置きゼロ**: ツール(Read/Edit/Bash 等)を呼ぶ前に文章を一切書かない(「〜します:」等の前置きの断片が court ループの引き金)。説明は全ツール完了後に普通の完全な文で 1 回だけ。区切り線・絵文字や記号の連打・意味のない短語も書かない。同じ語/記号が連続し始めたら、その応答を即座に打ち切る(自己検知・自己停止)。
- **② PROGRESS.md 肥大厳禁**: 各行は 1〜2 行。`## 直近の状態`は **最新スナップショット 1 つだけ**(完了報告のたびに古い記載を消して上書き=過去セッションのログを積み増さない。これが再肥大の主因)。実装の詳細 narrative・migration 検証ログ(VERIFY/SMOKE)・恒久知見の全文は書かず `.cc-reports/...md` と memory に委ねる。完了/アーカイブは「日付+案件+一言+commit」の 1 行のみ。サブエージェントは review 時、PROGRESS が肥大していれば指摘する。
- **③ 前原が「クリアします」と言ったら(2026-07-07 常設・2026-07-12 範囲明確化・全プロジェクト同一)**: 長文のチャット引継ぎ文を書かない・別話題の回答や新規提案をしない。やることは1つだけ=PROGRESS.md が最新か確認し、未反映(進行中の中断地点/完了の移し忘れ)があれば「直近の状態」を更新して push→「クリアOK(PROGRESS 最新化済)」と短く返す。**触ってよいのは PROGRESS の「直近の状態」更新と完了行の移動だけ**。日付・INVARIANTS 本文・ファイル名・CLAUDE.md・他リポジトリには一切触れない(記録上の過去日付を「今日に統一」するのは履歴改変=禁止。2026-07-09 に実事故→7-12 巻き戻し済)。

- **致命バグ保護 5 件は全件維持**: resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所。1 件でも壊す変更は禁止。report に全件「影響なし or 影響あり+対処」を明記。【標準制約 / DoD / 段階1 条件4】
- **既存テスト全 PASS 維持**: skip / コメントアウト / 無効化は禁止。件数・PASS 状況に変化があれば構築士2 review 必須。【DoD「既存テスト全 PASS 維持」】
- **tournamentRuntime は消さない**: 完全リセットは `handleReset()`（タイマーリセットボタン経由のみ）、ブラインド適用系は `resetBlindProgressOnly()`。runtime（人数・リエントリー・アドオン）消失は致命バグ。
- **入力中保護**: DOM 再構築は `isUserTypingInInput()` でガード（打鍵中の値消失・フォーカス喪失の再発禁止）。
- **編集モード readonly 解除**: 複製/新規作成は `ensureEditorEditableState()` を同期＋RAF 内で 2 回呼ぶ。
- **ブランディング保護**: アプリ名 `PokerTimerPLUS+`・`presented by Yu Shimomachi`・About クレジット・発行元・`logo-yushitamachi.svg` を設定で変更/非表示/差し替え可能にしない。【禁止事項（ブランディング保護）】
- **レイアウトシフト撲滅**: `__autoCheck()` drift 0、`transform: scale` 禁止、bottom-bar/marquee は flex column（position: fixed 禁止）、カード幅固定。【標準制約 / ui-layout.md】
- **完全ローカル動作**: npm install 以外の外部ネットワーク通信を実装しない。ユーザーデータをアプリ外に送信しない。ただし**同一 LAN 内に閉じた遠隔操作サーバ**（インターネットに接続しない・外部送信しない・LAN 内の端末とのみ通信）は例外として許容する。【2026-07-08 前原承認・remote-control Phase 1a】
  - **例外②【2026-07-17 前原承認・案件229(customer-app 側採番)・外部DB連携／同日改定=店舗キー方式／2026-07-18 前原承認・案件230 K4=表示メタ追加】**: **ユーザーが設定画面で明示的に連携を ON にした大会に限り**、ユーザーが設定画面で入力した連携先（**店舗アプリのサーバー**。旧記述の Supabase 直結はログイン方式廃止に伴い店舗キー+サーバー経由へ転換）との通信を許容する。送信するのは**時計の状態（レベル・時刻・人数）とブラインド構成、および表示メタ（イベント名・サブタイトル・ゲーム種・賞金区分・賞金プール額と配当額=金銭の表示情報・平均スタック・テロップ・背景テーマ・ロゴ画像）のみ**（金銭の表示情報は 2026-07-18 前原チャット承認「金銭情報は送信してOK」により明示許容）。個人情報（氏名等の PII）・PC 内の他の大会データ・スライドショー/背景画像は送信しない。**連携 OFF の大会と連携先未設定時は従来どおり完全ローカル動作**（既定 OFF・後方互換）。連携先の URL/キーはコードに埋め込まない（汎用機能・設定画面入力方式）。上記以外のクラウド/インターネット経由の通信・外部サーバへのデータ送信は引き続き禁止。
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
- パス限定ルール(該当パス編集時のみ自動読込・2026-07-12 分割): `.claude/rules/branding-protection.md` / `src-conventions.md` / `renderer-ui-rules.md`

## 過去バージョンの経緯・詳細
過去バージョンの経緯・詳細(v1 初期構築 STEP順序・承認ポイント / v2.0.0 2画面対応 / v2.4.0 賞金プール計算改修)は docs/CLAUDE-archive.md を参照(逐語移設・2026-07-12)。

## 禁止事項（実装ルール）
- 承認ポイントを飛ばして次STEPに進まない
- 仕様にない機能を勝手に追加しない（提案はOK、実装は承認後）
- npm install以外の外部ネットワーク通信を実装しない（例外①: **同一 LAN 内に閉じた遠隔操作サーバ**＝インターネット非接続・外部送信なし・LAN 内端末とのみ通信は許容。remote-control Phase 1a・2026-07-08 前原承認／例外②: **連携ON の大会に限る設定画面入力先(店舗アプリのサーバー)との通信**＝時計状態・ブラインド構成+表示メタ(賞金額/配当額の表示情報・テロップ・テーマ・ロゴ含む。2026-07-18 前原承認・案件230 K4)のみ送信・PII/他大会データ非送信・既定OFF。2026-07-17 前原承認・外部DB連携。詳細は上記 INVARIANTS）
- ユーザーデータをアプリ外に送信しない（完全ローカル動作。上記 例外①②の範囲のみ許容。それ以外のクラウド/インターネット経由の送信・外部サーバへのデータ送信は引き続き禁止）
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
本節は `.claude/rules/branding-protection.md` へ逐語移設(2026-07-12。paths: src/** / package.json / build/** 編集時に自動読込)。詳細は skills/branding.md を参照。

## 汎用化ルール・ファイル構成ルール・コード品質・テスト
各節は `.claude/rules/src-conventions.md` へ逐語移設(2026-07-12。paths: src/** / tests/** 編集時に自動読込)。

## 報告形式
各STEP完了時に以下を出力する: 実装した機能のリスト / 変更したファイル一覧 / 動作確認手順（手動チェックリスト） / 次STEPの予告

---

## CC作業フロー（運用ルール、2026-05-23 改定: md 経由ハンドオフ、2026-05-23 追加: brief 経由指示）

### CC ⇄ CC構築士2 標準作業フロー（brief 経由）

CC が新規 STEP / 新規タスクに着手するとき、前原（オーナー）からは超短い指示が来る(例: 「`.cc-briefs/YYYY-MM-DD_案件ID_短い作業名_brief.md を読んで Plan Mode で進めて`」「`.cc-briefs/...の通り実装フェーズに進んで`」)。
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
フォーマット(状況 / やること / 触るファイル一覧 / 致命バグ保護 5 件影響評価 / 並列 sub-agent / Task 数 / 追加制約 / 期待結果)は `.cc-plans/README.md` 参照。

### 作業完了報告ルール
作業完了時、必ず以下の両方を出す:

**① チャット（5 行以内の簡潔報告）**: やったこと / 確認 / 次の選択肢

#### チャット丸展開ルール(★2026-05-28 朝 常設。導入経緯・全文は docs/CLAUDE-archive.md)

- CC は `.cc-briefs/...completion_review.md`(構築士2 書出)を Read したら、前原向け情報(**6-B 実機シナリオ表 / 0. まずアクション / 次案件選択肢**)を**チャットに Markdown 表として丸コピペ展開**する(md 参照指示で済ませない)。
- 5 行サマリ構成: 1〜2 行目=やったこと / 3 行目=DoD 達成状況+完了 review 判定 / 4 行目=PROGRESS.md 更新済 / 5 行目=詳細パス+「↓ 実機確認シナリオ ↓」。直下に 6-B 表を丸コピペ展開し、致命バグ保護 5 件への影響評価の判定結果も併記する。
- 目的: 前原は md ファイルを一切開かず、チャットだけで実機確認 → push 承認 → 次案件判断まで完結できる状態を担保する。前原向けに「○○.md 参照」指示は使わない(md 参照は CC ↔ 構築士2 内部参照のみ許容)。poker-clock は実機系 6-B 項目が多いため特に重要。

#### 完了 review の能動起動(★2026-05-28 朝 常設・stop_hook_active 罠回避。導入経緯・呼出 prompt テンプレ全文は docs/CLAUDE-archive.md)

- CC が `.cc-reports/...md` を Write した直後、必ず完了 review を起動する(トラック体系に従う。通常= mode:"single"・重要= dual。現行は cc-review2 ワークフロー優先+フォールバック=冒頭「ハイブリッド自動化」参照)。緊急 hotfix で構築士2 不在運用が明示承認された場合のみ例外(PROGRESS.md「直近の状態」に明示)。
- review 起動時は report / brief / plan / Plan 軽量 review(あれば)の絶対パスを渡し、6-B 表は Markdown 表形式で書かせる(チャット展開前提)。
- Stop hook は保険(能動起動忘れ時のフォールバック)。一次経路は CC の能動起動。
- **絶対起動条件**: 致命バグ保護 5 件の影響範囲 / 既存テストの件数・PASS 状況の変化 / ブランディング保護 §15 / レイアウトシフト撲滅 5 原則、のいずれかに触れた report は review なしで完了とみなすこと禁止。
- 本呼出は並列 sub-agent 最大 3 体カウントに含めない(Plan / report で報告する並列数にも計上しない)。

**② `.cc-reports/YYYY-MM-DD_案件ID_短い作業名.md` に詳細**: 報告フォーマット(サマリー / 触ったファイル一覧 / 検証結果 / 致命バグ保護 5 件影響評価 / 並列 sub-agent / Task 数 / DoD チェック結果 / 構築士2 への確認事項+前原実機確認候補 / 残作業、の 8 セクション。2026-05-27 改定)は `.cc-reports/README.md` 参照。

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

### 標準制約・入力中保護・編集モード readonly 解除・tournamentRuntime 不変条件
各節は `.claude/rules/renderer-ui-rules.md` へ逐語移設(2026-07-12。paths: src/renderer/** 編集時に自動読込。「標準制約(毎回適用、明記不要)」の適用義務は不変)。

### スコープ管理（最重要）
- **`.cc-plans/` 配下の Plan に明示された項目以外は実装しない**
- 調査・監査中に他に修正したい項目を発見した場合、**`.cc-reports/` の「7. 残作業 / 次にできそうなこと」セクションに提案として記載のみ**。実装は構築士2 の承認を得て次フェーズで行う
- 「ユーザー要望に最善を尽くして対処」と読んでも、勝手に実装範囲を広げない（CC は実行する存在、設計判断は構築士2 の役割）
- 致命級バグ発見時は `.cc-reports/` 冒頭に明示し、構築士2 判断を仰ぐ（自動修正禁止）
- スコープ越えは構築士2 フレームワーク違反として採点減点対象（指示忠実性 30 点項目）

### ルール4: 4 つの md ハンドオフ書類の役割・DoD・PROGRESS 更新義務・6.x 振り分け・軽量 review 3 段階フロー
詳細は `.claude/rules/workflow-handoff.md`(常時適用・2026-07-21 に CLAUDE.md から逐語移設。ルール4 A〜F 全文+CC 自走の徹底+Markdown link 使い分け)。
