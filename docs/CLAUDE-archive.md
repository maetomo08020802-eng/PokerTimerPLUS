# CLAUDE.md アーカイブ — 過去バージョンの経緯・詳細

> CLAUDE.md スリム化(公式推奨構成への分割・2026-07-12 GO#7)に伴い、完了済みバージョンの章を CLAUDE.md から逐語で移設したもの。現行の致命ルール・運用ルールは CLAUDE.md 本体(INVARIANTS ほか)を参照。

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

---

# 運用ルールの導入経緯アーカイブ(2026-07-16 追加スリム化 GO#8 で CLAUDE.md から逐語移設)

> 現行運用の要点は CLAUDE.md 本体(「ハイブリッド自動化(現行運用の要点)」「作業完了報告ルール」)を参照。以下は移設時点の全文(逐語)。

## ハイブリッド自動化（2026-05-28 導入 / ★現在 Phase 1 = 通知のみ・auto-trigger は 2026-06-11 に無効化）

> **★2026-06-22 更新(全プロジェクト共通・customer-app 検証済→本採用): 完了レビューの起動を「cc-review ワークフロー」に一本化**
>
> 完了レポート(`.cc-reports/...md`)を書き終えたら、従来の「Agent ツールで `cc-kouchikushi2` を単発呼出」ではなく、**Workflow〔ワークフロー=複数エージェントを台本どおり自動で回す純正の仕組み〕ツールで `cc-review` を実行**してください。Stop hook での強制起動(旧 Phase 2)が mid-turn でハングした問題を、決定論的・バックグラウンド・再開可能なワークフローで置き換えるのが狙いです。
> - **実行方法**: Workflow ツールに `{ name: "cc-review", args: { reportPath: "<完了reportの絶対パス>" } }` を渡す。`name` で解決できない時は `{ scriptPath: "C:\\Users\\user\\Documents\\Claude\\Projects\\個人アシスタント\\poker-clock\\.claude\\workflows\\cc-review.js", args: { reportPath: "<絶対パス>" } }`。reportPath を省略すると最新の `.cc-reports/*.md` を自動探索。
> - **★2026-07-07 本採用(全プロジェクト共通): 共通版 cc-review2 を優先**: 上記の代わりに、まず `{ scriptPath: "C:\\Users\\user\\.claude\\workflows\\cc-review2.js", args: { reportPath: "<絶対パス>" } }` を実行する(1箇所管理の共通版。※ name 指定 `cc-review2` は解決されない=必ず scriptPath で。懐疑役の観点は当プロジェクトの `.claude/cc-review-verify.md` を実行時に読む)。失敗した時のみ従来の `cc-review`(上記)へフォールバックし、どちらで動いたかをレビュー後のチャット報告に1行明記する(完了報告 md はレビュー前に書くため md には書けない)。Phase 0 で初回実走成功をログ確認済。
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


## 軽量 review 段階 2 の当時補足(Phase 2 auto-trigger ON 時代の記述・逐語)

**2026-05-28 補足**: Phase 2（auto-trigger）ON 状態のため、CC が plan を書き出した時点でも Stop hook が発火し、サブエージェント版構築士2 が自動 review に入る経路がある（明示的な Agent 呼出と並列に走る場合あり）。plus2-homepage で 3 段階フロー（plan 書出 → 自動 review → 実装 → report 書出 → 自動 completion review）が完全実証成功。CC 側の責務は「plan / report を確実に書き出すこと」、自動 review 起動は Stop hook が担保する。
