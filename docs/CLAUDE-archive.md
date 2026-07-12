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

