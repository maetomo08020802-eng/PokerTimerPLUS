# PROGRESS — poker-clock(PokerTimerPLUS+)

> このファイルは「前原が一目で全体進捗を把握する」ための1枚ダッシュボード。
> poker-clock は **バージョン単位のリリース進行型**(タイマーアプリのフリー配布ソフト)なので、PROGRESS.md も「現在のリリース作業 / リリース履歴 / 温存中の次期候補 / 累積統計」の4ブロック構成。
> CC は完了報告(`.cc-reports/...md`)を書くたびに、該当 STEP / バージョンの状態を更新する。
>
> ⚠️ **表内のファイルパスリンク表記は CC が読む参照用**(Markdown 仕様準拠)。Claude Code Desktop チャットでタップしても開きません。**人間が中身を見たい時はパスをコピーしてエディタで直接開いてください**(2026-05-28 注記追加)。

最終更新: 2026-05-30(v2.4.1 配信完了 + prestart-zero-stall 案件アーカイブ)

---

## 🟡 現在のリリース作業 / オープン STEP

| バージョン | STEP / 作業 | 状態 | brief | plan | report |
|------------|-------------|------|-------|------|--------|
| (なし) | — | ✅ オープン作業なし（**v2.5.0 配信完了 2026-06-06**） | — | — | — |

> 状態の凡例: `📝 brief 起案中` / `🤔 Plan 中` / `🟢 実装中` / `🔵 レビュー待ち` / `🟡 実機確認待ち` / `📦 配信準備中`
> ※ prestart-zero-stall 案件（STEP 1 調査 → STEP 2 実装 → 配信）は v2.4.1 として配信完了 + 案件クローズ済。関連 md 8 件は `.cc-archive/prestart-zero-stall/`（briefs 5 / plans 1 / reports 2）へ退避済（2026-05-30）。

---

## ✅ リリース履歴(新しい順)

| 配信日 | バージョン | 主要変更 | report |
|--------|-----------|---------|--------|
| 2026-06-06 | **v2.5.0** | トーナメント画像分離で保存激重を根治（背景画像・休憩スライドショーを別ファイル `tournament-images.json` へ分離、初回起動で自動移行＝backup→検証→strip 冪等）。実測: 部分保存 527ms→0.76ms / config 35.96MB→92KB。既存 1164 + 新規 16 = 1180 件全 PASS、致命バグ保護 5 件全維持。merge `e77fcce` / tag `v2.5.0` / GitHub Release（Latest・自動更新対応、アセット latest.yml+.exe+.blockmap） | アーカイブ済 `.cc-archive/tournament-bloat/`（reports/step2 + reports/step4_release 他） |
| 2026-05-30 | **v2.4.1**（hotfix） | 開始前カウントダウン 0 着地後のタイマー停止（症状①）根治。renderer 1 関数に RUNNING/BREAK stale-restore 破棄ガード追加。回帰テスト v252（10 件）追加、合計 1164 件全 PASS。merge `01626aa` / tag `v2.4.1` / GitHub Release（Latest、自動更新対応） | アーカイブ済 `.cc-archive/prestart-zero-stall/`（reports/release + reports/step2） |
| 2026-05-24 | **v2.4.0** | 賞金プール計算改修(フィー × 件数 × プール率、店舗デフォルト + トーナメント個別、🔒 readonly + 解除ダイアログ)、配信実績、main HEAD `ee78652` | [release_cleanup](.cc-reports/2026-05-24_v210-prize-pool-refactor_release_cleanup.md) + (アーカイブ済 `.cc-archive/v210-prize-pool-refactor/`) |
| 2026-05-01 | **v2.0.0** | HDMI 2 画面対応(ホール側モニター + PC 側操作 UI 分離、HDMI 抜き差し自動追従、起動時モニター選択)、合計 190 テスト全 PASS、致命バグ保護 5 件完全維持 | (履歴は古い形式の HANDOVER.md / CHANGELOG.md 参照) |
| 2026-04-?? | **v1.3.0** | (詳細は CHANGELOG.md 参照) | (同上) |
| 2026-04-30 | **v1.2.0** | 入力中保護 5 原則(isUserTypingInInput 統一)、editorEditable readonly 解除 4 重防御、tournamentRuntime 不変条件 | (同上) |

> 詳細な変更履歴は `CHANGELOG.md` 参照(178KB の累積記録)。本表はメジャー / 重要マイナーのみ。

---

## 📋 温存中の次期バージョン候補

| バージョン | 概要 | ブランチ | 状態 |
|------------|------|---------|------|
| **v2.3.0** | PRE_START 永続化(`feature/v2.3.0-prestart-persistence`)| 温存ブランチ | 待機中、再開タイミングは前原判断 |

> v2.4.0 の前に着手していたが、v2.4.0 を先行配信したため温存。再開時は新ブランチ起こすか同ブランチ続行か要相談。
> ⚠️ **v2.3.0 再開時の調査項目（prestart-zero-stall 案件 §4 より引継ぎ）**: v2.3.0 の PRE_START 永続化復元経路 `applyTimerStateToTimer` にも、v2.4.1 で renderer `applyOperatorPreStartState` に入れたのと同種の「RUNNING/BREAK 中の stale 復元ガード」が必要か再評価すること（main 取り込み時の二重実装・巻き戻し再発防止）。
>
> 📌 **別案件・将来候補（緊急性なし）**: cross-generation cancel hardening — 古い `{isActive:false}` が新しい PRE_START を誤キャンセルする別経路（世代番号 / targetTime 比較で対処可能）。v2.4.1 症状①とは独立、実機未観測。次回 PRE_START 系を触る案件で関連検討。

---

## 📊 累積統計

| 指標 | 件数 |
|------|------|
| 配信済みリリース | 7 件(v1.0.0 / v1.2.0 / v1.3.0 / v2.0.0 / v2.4.0 / v2.4.1 / v2.5.0)|
| アーカイブ済 案件(`.cc-archive/`)| 3 件(v210-prize-pool-refactor / prestart-zero-stall / tournament-bloat)|
| オープン作業 | 0 件（v2.5.0 配信完了）|
| 最新テスト件数 | 1180 件 全 PASS(v2.5.0 配信時点、v253 で +16)|
| 致命バグ保護 件数 | 5 件 完全維持(resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所)|

> CC は完了報告のたびにこの表を Edit(リリース配信時はリリース履歴に新行追加、テスト件数更新)。
> 構築士2 が「これは案件完全クローズ」と判断したら、関連 md を `.cc-archive/{案件ID}/` に移動。

---

## 🎯 主要ワークストリーム(累積で見たい時の分類)

| ワークストリーム | 概要 | 直近の状態 |
|-----------------|------|-----------|
| **コア機能(タイマー)** | カウントダウン / ブラインド進行 / 一時停止 / リセット | v1.x で確立、v2.x で不変条件継承 |
| **2 画面対応** | HDMI ホール側モニター + PC 側操作 UI 分離 | v2.0.0 で完成 |
| **賞金プール計算** | フィー × 件数 × プール率(景品表示法対応)| v2.4.0 で完成 |
| **致命バグ保護** | 5 件の不変条件(resetBlindProgressOnly 等)| 全リリースで完全維持中 |
| **PRE_START 永続化** | 開始前カウントの保存 | v2.3.0 温存中 |

---

## 直近の状態

- **現在ブランチ**: main(`e77fcce` v2.5.0 マージ commit、origin/main 同期済 push 完了)
- **直前 commit**: `e77fcce Merge: v2.5.0 - トーナメント画像分離で保存激重を根治`（実装 commit `c81a3cd`）
- **直前作業**: **v2.5.0 配信完了**（merge `--no-ff` → tag `v2.5.0` → push → main から .exe 再ビルド → GitHub Release `v2.5.0` 公開[Latest・自動更新対応、アセット latest.yml+.exe+.blockmap]）。Release URL: https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases/tag/v2.5.0
- **2026-05-28**: ハイブリッド自動化 Phase 2 段階 2 フロー完全実証(plus2-homepage homepage-performance-audit 案件) + CLAUDE.md 整合改訂 5 点反映(plus2-homepage に追随):
  1. Phase 2 ON / Stop hook 検出対象拡張(`.cc-plans/*.md` + `.cc-briefs/*_brief.md` 追加)を冒頭セクションに反映
  2. 自走必須ルール明文化(AskUserQuestion / ExitPlanMode / 進行方針確認禁止、安全側に倒して自走、実機確認は 6-B 行き)を「禁止事項(実装ルール)」末尾に追記
  3. 「CC は brief を書かない」明示(暗黙的発生時は `cc-kouchikushi2` サブエージェント代行)をルール4-A 直下に追記
  4. investigation 型 review.md 分量目安(50〜120 行が現実的下限)を追記
  5. セクション E 段階 2 を Phase 2 ON 完全自動化前提に更新、`AskUserQuestion` 立ち止まり禁止を再強調
- **2026-05-30**: prestart-zero-stall STEP 1（investigation 型・コード変更ゼロ）完了。症状①（PRE_START 0 着地後の巻き戻し stall）の原因を operator 自己ループ再ブロードキャスト（main.js:1212）→ 古い `{isActive:true}` tick が restorePreStart で RUNNING 上に PRE_START 再点火 → 続く `{isActive:false}` が cancelPreStart、とコード段階レベルで確定。最小修正案 = renderer `applyOperatorPreStartState` の isActive:true 分岐に status（RUNNING/BREAK）ガード 1 つ追加（[step1_plan](.cc-plans/2026-05-30_prestart-zero-stall_step1_plan.md)）。実装は次 STEP（前原承認後）
- **2026-05-30（配信）**: prestart-zero-stall STEP 2（実装）→ v2.4.1 配信完了。renderer `applyOperatorPreStartState` に RUNNING/BREAK stale-restore 破棄ガード追加、回帰テスト v252（10 件）追加で合計 1164 件全 PASS。GitHub Release v2.4.1（asset: latest.yml + .exe + .blockmap、Latest 表示）。既存ユーザーは起動時に自動更新通知
- **2026-06-06**: tournament-bloat STEP1（investigation・src 無変更）完了 + STEP2（実装）完了。根因 = **休憩スライドショー画像 base64（57 枚 33.7MB / config.json の 99.7%）が tournaments 配列に inline 格納**され毎秒 list と毎操作の全件書込（527ms）を重くしていた。前原 GO 後、**方式 A（画像を別ファイル `tournament-images.json` へ分離）で実装**。実データ end-to-end 検証で画像 58 枚 35.86MB 全保全 + runtime/timerState/marquee 全件保全を確認。AFTER 実測: config 92KB / list 8.3KB / 部分保存 0.76ms（697 倍）/ IPC 搬送 0.19ms（485 倍）。既存 1164 件全 PASS + 新規 16 件 = 1180 件全 PASS。致命バグ保護 5 件全維持。ブランチ `feature/v2.5.0-tournament-image-split`、commit `c81a3cd`（STEP1 chore は main `7d20ffd`）。**配信は前原実機 OK + GO 後**（[step2_plan](.cc-plans/2026-06-06_tournament-bloat_step2_plan.md) / [step2](.cc-reports/2026-06-06_tournament-bloat_step2.md)）
- **2026-06-06（STEP3 テストビルド → STEP4 配信）**: 前原実機 6-B ①〜④ 全 OK → 配信 GO 受領 → v2.5.0 公開配信完了。main merge（`e77fcce`）→ tag `v2.5.0` → push → main から .exe 再ビルド → GitHub Release `v2.5.0` 公開（Latest・自動更新有効）。既存ユーザーは次回起動で自動更新通知 → 初回起動で画像分離 migration（backup 自動生成）。tournament-bloat 案件クローズ（[step4_release](.cc-reports/2026-06-06_tournament-bloat_step4_release.md)）
- **配信状況**: **v2.5.0 配信済み（最新・公開中）**。GitHub Release 公開済、自動更新有効
- **次のアクション(想定)**:
  - tournament-bloat 案件クローズ済（md 14 件を `.cc-archive/tournament-bloat/` へ退避完了、merge 済 feature ブランチ削除完了）
  - v2.3.0(PRE_START 永続化)再開、または新規バージョン起案
  - poker-clock は安定運用フェーズ

---

## 更新ルール(CC 向け、CLAUDE.md ルール4 参照)

完了報告(`.cc-reports/...md`)を書いたら、**同じターンで** 本ファイルを Edit:

1. オープン STEP 表の該当行を削除(or 「(なし)」プレースホルダ復活)
2. リリース履歴に新行追加(配信日 / バージョン / 主要変更 / report リンク)
3. 累積統計のテスト件数 / リリース数を更新
4. 直近の状態ブロックを更新(ブランチ・直前 commit・配信状況・次のアクション)
5. 温存中候補に変更があれば反映

新作業着手時(brief 受領時)は **オープン STEP 表に行を追加**(状態 `📝 brief 起案中` → `🤔 Plan 中` → `🟢 実装中` → ...)。

更新後、チャット 5 行報告の末尾に「**PROGRESS.md 更新済**」と一言添える。

構築士2 は完了 review 発行時、CC が PROGRESS.md を更新したか必ず確認(未更新なら review でその場で指摘)。
