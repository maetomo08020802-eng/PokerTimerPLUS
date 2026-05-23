# CLAUDE.md - PokerTimerPLUS+ 構築司令塔

## プロジェクト概要
全国のポーカールーム向けに無料配布するElectron製ポーカートーナメントクロック。
- プロダクト名: **PokerTimerPLUS+**
- 制作: Yu Shimomachi（PLUS2運営）
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
- **前原に直接作業を依頼しない**（2026-05-24 追加）。完了報告 md の冒頭やセクション内で「前原さんへの動作確認依頼」「○○してください」のような命令調で前原宛に直接書かない。前原実機確認が必要な項目は **`## 6. 構築士2 への確認事項` セクションに「前原実機確認候補」として整理**（手順・所要時間・チェック項目を箇条書き）。構築士2 がそれを `.cc-briefs/...review.md` で再構成して前原に渡す。前原は実装作業・実機確認の窓口を常に「構築士2 経由」で受け取る

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

**② `.cc-reports/YYYY-MM-DD_案件ID_短い作業名.md` に詳細**:
```
# CC作業完了報告 — YYYY-MM-DD 案件ID タイトル

## 1. サマリー
（1〜2行で何をしたか）

## 2. 触ったファイル一覧（衝突回避のため必須）
| ファイル | 変更点（短く） |

## 3. 検証結果
（テスト結果・動作確認）

## 4. 致命バグ保護 5 件への影響評価

## 5. 並列起動した sub-agent / Task 数

## 6. 構築士2 への確認事項（あれば）
（番号付きで、なければセクション省略）

### 6.x 前原実機確認候補（CC では検証不可能な項目があれば記載）
（前原向け命令調で書かない。手順・所要時間・チェック項目を箇条書きで整理。構築士2 が review md で再構成して前原に渡す）

## 7. 残作業 / 次にできそうなこと
（スコープ外で気づいたことは提案として記載のみ）
```

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

