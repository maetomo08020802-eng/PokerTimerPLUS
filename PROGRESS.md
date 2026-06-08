# PROGRESS — poker-clock(PokerTimerPLUS+)

> このファイルは「前原が一目で全体進捗を把握する」ための1枚ダッシュボード。
> poker-clock は **バージョン単位のリリース進行型**(タイマーアプリのフリー配布ソフト)なので、PROGRESS.md も「現在のリリース作業 / リリース履歴 / 温存中の次期候補 / 累積統計」の4ブロック構成。
> CC は完了報告(`.cc-reports/...md`)を書くたびに、該当 STEP / バージョンの状態を更新する。
>
> ⚠️ **表内のファイルパスリンク表記は CC が読む参照用**(Markdown 仕様準拠)。Claude Code Desktop チャットでタップしても開きません。**人間が中身を見たい時はパスをコピーしてエディタで直接開いてください**(2026-05-28 注記追加)。

最終更新: 2026-06-08（**v2.6.0 fee-pot-yen STEP1〜5 全完了・テストビルド済・前原 6-B → 配信 GO 待ち**。詳細は「直近の状態 › 🔖 引き継ぎサマリ」）

---

## 🟡 現在のリリース作業 / オープン STEP

| バージョン | STEP / 作業 | 状態 | brief | plan | report |
|------------|-------------|------|-------|------|--------|
| (内部整理・配信なし) | legacy-id-rename（`*-pool-rate`→`*-pot` 純粋リネーム） | 🟡 実装完了・1358件全PASS・orphan0/null参照0／**完了 review → main merge 待ち（Release なし）** | `.cc-briefs/2026-06-08_legacy-id-rename_brief.md` | `.cc-plans/2026-06-08_legacy-id-rename_plan.md` | `.cc-reports/2026-06-08_legacy-id-rename.md` |

> ※ v2.6.0 は配信完了（2026-06-08、Latest 公開中）・案件群クローズ済（md アーカイブ + feature ブランチ削除）。詳細は `.cc-archive/v260-release/`。

> 状態の凡例: `📝 brief 起案中` / `🤔 Plan 中` / `🟢 実装中` / `🔵 レビュー待ち` / `🟡 実機確認待ち` / `📦 配信準備中`
> ※ prestart-zero-stall 案件（STEP 1 調査 → STEP 2 実装 → 配信）は v2.4.1 として配信完了 + 案件クローズ済。関連 md 8 件は `.cc-archive/prestart-zero-stall/`（briefs 5 / plans 1 / reports 2）へ退避済（2026-05-30）。

---

## ✅ リリース履歴(新しい順)

| 配信日 | バージョン | 主要変更 | report |
|--------|-----------|---------|--------|
| 2026-06-08 | **v2.6.0** | 4ピース同梱: ① fee-pot-yen（賞金プールを店内通貨$・1件あたり拠出×件数モデルへ刷新／%全廃／配当は金額固定でドリフトなし／🔒・モーダル廃止）② perf-heaviness（背景 fixed→scroll／marquee will-change 撤去／operator のみ backgroundThrottling:true、hall 据置）③ stack-unify+preset-hint（初期スタックを buyIn.chips に統一・スタートスタック欄廃止／プリセット適用に説明）④ perf-dialog-backdrop（設定ダイアログ ::backdrop の blur 撤去で激重解消、暗幕維持）。**データ移行安全**（poolRate%→POT$ で TOTAL POOL 数値不変／¥→$ リテラル読替／AVG STACK は buyIn.chips:=startingStack で保全、実store13件 mismatch=0）。既存1261→**1358件全PASS**、致命バグ保護5件全維持。merge `a1bce57` / tag `v2.6.0` / GitHub Release v2.6.0（Latest・自動更新、アセット latest.yml+.exe+.blockmap）。前原実機6-B全OK + GO 後に配信 | `.cc-reports/2026-06-08_v260-release.md` |
| 2026-06-07 | **v2.5.1** | settings-scope-clarity: 設定タブを適用範囲で2グループ視覚分割 + 編集中トーナメント名常時表示(STEP1) / ブラインド編集を選択中卓に固定 + 共有時3択モーダル(copy-on-write)(STEP2) / レベル表縦拡張・フッタ常時可視(STEP3) / トーナメント選択を折りたたみ化(STEP4) / 大画面でブラインド表0段の退行を vh フロア+キャップで根治(実測検証) / 未保存編集中の卓切替に破棄確認(嘘ラベル+黙って再ポイント根治)。**データ構造・保存ロジック・migration 無変更**＝既存ユーザー破壊的影響なし。既存1180 + 新規81 = 1261件全PASS、致命バグ保護5件全維持。merge `f804114` / tag `v2.5.1` / GitHub Release v2.5.1（Latest・自動更新対応、アセット latest.yml+.exe+.blockmap）。テストビルド3回 + 前原実機6-B全OK後に配信 | `.cc-reports/2026-06-07_settings-scope-clarity_release.md` |
| 2026-06-06 | **v2.5.0** | トーナメント画像分離で保存激重を根治（背景画像・休憩スライドショーを別ファイル `tournament-images.json` へ分離、初回起動で自動移行＝backup→検証→strip 冪等）。実測: 部分保存 527ms→0.76ms / config 35.96MB→92KB。既存 1164 + 新規 16 = 1180 件全 PASS、致命バグ保護 5 件全維持。merge `e77fcce` / tag `v2.5.0` / GitHub Release（Latest・自動更新対応、アセット latest.yml+.exe+.blockmap） | アーカイブ済 `.cc-archive/tournament-bloat/`（reports/step2 + reports/step4_release 他） |
| 2026-05-30 | **v2.4.1**（hotfix） | 開始前カウントダウン 0 着地後のタイマー停止（症状①）根治。renderer 1 関数に RUNNING/BREAK stale-restore 破棄ガード追加。回帰テスト v252（10 件）追加、合計 1164 件全 PASS。merge `01626aa` / tag `v2.4.1` / GitHub Release（Latest、自動更新対応） | アーカイブ済 `.cc-archive/prestart-zero-stall/`（reports/release + reports/step2） |
| 2026-05-24 | **v2.4.0** | 賞金プール計算改修(フィー × 件数 × プール率、店舗デフォルト + トーナメント個別、🔒 readonly + 解除ダイアログ)、配信実績、main HEAD `ee78652` | アーカイブ済 `.cc-archive/v210-prize-pool-refactor/`（reports/release_cleanup 他） |
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
>
> 📌 **settings-scope-clarity 配信前監査の軽微5件（v2.5.1 配信後送り・緊急性なし、別 brief 化）**: ① copy-on-write の MAX_USER_PRESETS(100件) 上限時メッセージ改善 / ② hidden `js-preset-select` の到達不能 change リスナのデッドコード整理 / ③ トーナメント折りたたみサマリの IDLE 鮮度（毎秒更新範囲の見直し）/ ④ 「保存して適用」モーダルが稀に2連発する経路 / ⑤ 4K でブラインド表フッタが body スクロール側に出る体感（vh キャップの主観調整）。いずれも配信済 v2.5.1 の挙動を壊さない範囲の改善で、まとめて or 個別に別 brief 起案可。

---

## 📊 累積統計

| 指標 | 件数 |
|------|------|
| 配信済みリリース | 9 件(v1.0.0 / v1.2.0 / v1.3.0 / v2.0.0 / v2.4.0 / v2.4.1 / v2.5.0 / v2.5.1 / **v2.6.0**)|
| アーカイブ済 案件(`.cc-archive/`)| 10 件(v210-prize-pool-refactor / prestart-zero-stall / tournament-bloat / settings-scope-clarity / payout-amount-default / fee-pot-yen / perf-heaviness / stack-unify-preset-hint / perf-dialog-backdrop / v260-release)|
| オープン作業 | 0 件（**v2.6.0 配信完了・公開中、案件群クローズ済**。安定運用フェーズ）|
| 最新テスト件数 | **1358 件 全 PASS**(v2.6.0: payout-amount-default v260 / fee-pot-yen v261〜264 / perf-heaviness v265 / stack-unify v266 / perf-dialog-backdrop v267)|
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

### 🔖 引き継ぎサマリ（2026-06-08 v2.6.0 配信完了時点）
- **v2.6.0 を全国配信完了（2026-06-08、GitHub Release Latest・公開中）**。前原実機 6-B 全 OK + GO → CHANGELOG 最終化 → feature/payout-amount-default → main merge（`--no-ff` `a1bce57`）→ tag `v2.6.0` → push → main から本番 .exe 再ビルド → GitHub Release `v2.6.0` 公開（Latest・自動更新、アセット latest.yml+setup.exe+.blockmap）。GitHub 独立確認済（API Latest=v2.6.0 / tag=main HEAD=a1bce57 / アセット3点 / 公開 latest.yml version=2.6.0・sha512 一致 / repo PUBLIC）。**1358件全PASS**、致命バグ保護5件全維持。**データ移行安全（実store13件検証済）**。Release URL: https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases/tag/v2.6.0
- **案件群クローズ完了（2026-06-08）**: 構築士2 クローズ承認 → 関連 md 41 件を案件別 `.cc-archive/{payout-amount-default,fee-pot-yen,perf-heaviness,stack-unify-preset-hint,perf-dialog-backdrop,v260-release}/{briefs,plans,reports}/` へ退避 + merge 済 `feature/payout-amount-default` をローカル削除（origin 未push のため remote 不要）。
- **現在ブランチ**: `main`（origin 同期済）。**オープン作業 0 件・安定運用フェーズ**。
- **（参考・配信済の旧最優先）v2.6.0 fee-pot-yen（賞金を店内通貨$・1件あたり拠出モデルへ刷新／%全廃）**: STEP1〜5 全完了 → 上記 v2.6.0 として配信済。
- **2026-06-08 追加（perf-dialog-backdrop、同 v2.6.0 に同梱）**: 設定ダイアログ（S キー）激重の主因＝ダイアログ `::backdrop` の `backdrop-filter: blur(4px)`（中央のみ覆い外周は backdrop 下で動く 60fps メイン画面が透け→全画面ぼかし毎フレーム再計算）を撤去（`.confirm-dialog::backdrop` / `.form-dialog::backdrop` の2規則）。暗幕 rgba(0,0,0,0.7) 維持＝見た目ほぼ不変・レイアウト不変。`.card` blur 撤去（v2.1.0）と同轍。致命バグ保護5件・payout/pool 非接触。**1358件全PASS**（v267 +5）。version 据置。軽量フロー（段階1スキップ4条件 met）。
- **2026-06-08 追加（stack-unify + preset-hint、同 v2.6.0 に同梱）**: バイインの初期スタックを `buyIn.chips` に統一し独立「スタートスタック」欄を UI 撤去（B）+ 配当プリセット適用に説明 hint 追加（③）。`computeAvgStack` を buyIn.chips ベース化、migration（per-tournament marker `stackModel:'unified'`）で `buyIn.chips := startingStack`（AVG STACK 数値保全・startingStack dormant 温存）。**実 store 13 トーナメントで AVG 移行前後 mismatch=0**（既に buyIn.chips===startingStack で実質 no-op）。致命バグ保護5件・payout/pool 非接触。**1353件全PASS**（v266 +12）。version 据置。**perf-heaviness と renderer.js 別領域で非衝突**。
- **2026-06-08 追加（perf-heaviness、同 v2.6.0 に同梱）**: アプリ激重・他アプリ巻き込みの安全な軽量化を実装完了＋構築士2 完了承認。背景 `background-attachment: fixed→scroll`／marquee `will-change` 撤去／operator のみ `backgroundThrottling:true`（hall・operator-solo は false 据置）＋ PERF_METRICS env ゲートの計測ハーネス（本番無害）。**視覚・タイマー精度・2画面同期・音声・致命保護5件すべて不変**。CC 自走 IDLE 実測（GPU≈2.5%常駐／rAF=0 自己停止裏取り）、**定量 GPU 比較・体感は前原 6-B 委譲**（単画面 PC・実 GPU の制約）。**1341件全PASS**（v265 +13）。version 2.6.0 据置。commit `f593ad1`。**perf 反映版の統合 testbuild 再生成済**（下記）。
- **現在ブランチ**: `feature/payout-amount-default`（**main 未merge**）。**直前 commit `f593ad1`**（perf-heaviness）。チェーン: `f593ad1`(perf) → `ec16e7f`(STEP5) → `80dab52`(STEP4 fee E-1) → `03a2b08`(STEP3 配当%撤去+§5解消) → `470da37`(STEP2 $UI+通貨$) → `83d59ff`(STEP1 potAmounts基盤) → `994d3eb`(payout-amount-default ①〜④)。土台は main `f804114`(v2.5.1)。
- **テスト**: 1358件全PASS（version 2.6.0、perf +13 / stack-unify +12 / dialog-backdrop +5）。**統合テストインストーラ生成済（fee-pot-yen + perf + stack-unify + dialog-backdrop 全部焼込）**: `dist\pokertimerplus-setup-2.6.0.exe`（≈83MB、--publish never、HEAD `8759b2c`）。asar 焼込確認（stackModel=6 / preset-hint=1 / bg-scroll=1 / potAmounts=42 / backdrop-filter 実宣言=0[出現3はコメントのみ]）＋ packaged 起動スモーク OK（8秒生存・クラッシュなし）。**main 非merge / tag 無し / GitHub Release 非接触（最新 Release は v2.5.1 のまま）**。
- **配信ガード**: **main 非merge / tag 無し / GitHub Release 非接触**（最新 Release は v2.5.1 のまま）。配信は前原 6-B OK + GO 後。
- **次にやること（GO 受領後、CC 自走）**: feature/payout-amount-default → main merge（`--no-ff`）→ tag `v2.6.0` → push → main から .exe 再ビルド → GitHub Release `v2.6.0` 公開（Latest・自動更新、アセット latest.yml+setup.exe+.blockmap）→ 案件クローズ + md を `.cc-archive/fee-pot-yen/` へ退避 + feature ブランチ整理。
- **前原 6-B（テストビルド `dist\pokertimerplus-setup-2.6.0.exe`）**: ①店内通貨$表示 / ②1件あたり$拠出×件数でプール / ③配当金額固定（ドリフトなし）/ ④%がどこにも無い / ⑤既存トーナメント移行（TOTAL POOL 数値不変・$表示、起動ログで中間%0/13 runtime 確認済）/ ⑥🔒・モーダル無し・¥フィー自由編集 / 追：2画面・音声・タイマー（v2.5.1 同等）。
- **重要な前提・既確認事項**:
  - 実データ検証（CC 自走済）: 前原 store 13トーナメントで old pool===new pool（mismatch 0・中間%0件）→ v2.4.0 不変条件（TOTAL POOL 数値不変）を実データ＋起動ログで証明。通貨は既に $×12/P$×1・¥0件 → ¥→$ 移行は実質 no-op・カスタム P$ 保全。
  - §5（旧 payout-amount-default の前原 escalate 中だった「金額固定×プール食い違い」）は **v2.6.0 円POTモデルで自然解消済**（pool が具体$ → 法令判断不要）。別途の §5 単独実装は不要。
  - 致命バグ保護5件 全件影響なし（特に E-1 で撤去したのは fee-lock のみ＝`feeLockState`/`setFeeReadonly`、`ensureEditorEditableState`/`setBlindsTableReadonly` は不可侵維持を grep 裏取り済）。
  - 各 STEP の完了 review は `.cc-briefs/2026-06-07_fee-pot-yen_step{1..5}_completion_review.md`、report は `.cc-reports/2026-06-07_fee-pot-yen_step{1..5}*.md`、plan は `.cc-plans/2026-06-07_fee-pot-yen_plan.md`。実装 brief は `.cc-briefs/2026-06-07_fee-pot-yen_impl_brief.md`。
- **旧 v2.5.1 配信状態（参考・配信済み）**: main `f804114` v2.5.1 マージ commit、origin/main 同期済、GitHub Release `v2.5.1` = Latest。
- **2026-06-07（v2.5.1 配信完了）**: settings-scope-clarity（STEP1〜4 + ブラインド表0段修正 + 未保存切替ガード）を **v2.5.1 として全国配信完了**。前原実機 6-B 全 OK + GO 受領 → feature → main merge（`--no-ff` `f804114`）→ tag `v2.5.1`（`250a134`）→ push → main から本番 .exe 再ビルド → GitHub Release `v2.5.1` 公開（Latest・自動更新有効、アセット latest.yml+setup.exe+.blockmap の3点）。GitHub 独立確認済（Latest 切替 / tag / merge / アセット / repo public）。**データ構造・保存ロジック・migration 無変更**＝既存 v2.5.0 ユーザーは次回起動の自動更新で破壊的影響なし。Release URL: https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases/tag/v2.5.1。配信 brief は cc-kouchikushi2 代行起案（ルール4-A）（[release report](.cc-reports/2026-06-07_settings-scope-clarity_release.md)）。**案件クローズ + md アーカイブ + feature ブランチ削除は構築士2 のクローズ判定後**
- **2026-06-07（配信前修正・切替ガード）**: 配信前監査で出た中バグ「ブラインド表 dirty 編集中に別トーナメント切替→ラベル嘘ペア+保存で黙って再ポイント」を方針A（破棄/やめる確認）で根治。切替全経路（handleTournamentSelectChange[選択/hidden 集約] / New / Duplicate / RowDelete[active 卓削除時のみ]）に共通ガード confirmDiscardBlindsDirtyIfNeeded を挿入。破棄=blinds draft/meta/dirty/initialized クリア（tournamentRuntime/timerState 非接触）→新卓構造に追従ロード、やめる=切替中止+編集保持+select 値復元。updateBlindsEditingTargetLabel は meta.id===blindPresetId 時のみペア表示（嘘ラベル解消）。**_savePresetCore 本体・applyTournament の timerState/runtime 復元・main.js 無変更**。確認は confirm-dialog 流用（hall 自動非表示）。致命バグ保護5件全件影響なし。version 2.5.1 据え置き。**既存1246 + 新規v259 15 = 1261件全PASS**。Plan 軽量 review（段階2）承認済（[plan](.cc-plans/2026-06-07_settings-scope-clarity_dirty-switch-guard_plan.md) / [report](.cc-reports/2026-06-07_settings-scope-clarity_dirty-switch-guard.md)）
- **2026-06-07（実機バグ修正）**: 一括テストビルド実機で発覚した致命バグ「ブラインド表が大画面で0段（STEP3退行）」を CSS のみで根治。根因＝固定px/vh ダイアログ高 vs vw chrome ＋ table-wrap フロア無し（min-height:0）で唯一の収縮要素が0に潰れた。修正＝table-wrap を **vh フロア(min-height:42vh)+vh キャップ(max-height:66vh)** で bound（16:9 で段数一定・内側スクロール/sticky thead 維持）、blinds タブ rigid height:100%→min-height:100%（body スクロール経路復活）、editor flex:1 0 auto、ダイアログ既定高 920→1100px。**Preview/Chromium で FHD/1440p/4K/極端短の実 clientHeight を実測**（FHD 711px/10段・1440p 933px/10段・4K 1409px/10段・極端短 368px/5段＝**0段に絶対ならず**、フッタ到達可）＝机上+実測の二重ゲート。バグ②(A)＝機能変更なし（自分の構造直接編集可・同梱は複製、新ボタンなし）。致命バグ保護5件全件影響なし、index.html/renderer.js/main.js 無変更。version 2.5.1 据え置き。c13 T15/v256 T1-2 を本修正値に追従。**既存1235 + 新規v258 11 = 1246件全PASS**。Plan 軽量 review（段階2）承認済（[blinds-table-fix plan](.cc-plans/2026-06-07_settings-scope-clarity_blinds-table-fix_plan.md) / [report](.cc-reports/2026-06-07_settings-scope-clarity_blinds-table-fix.md)）
- **2026-06-07（STEP4）**: settings-scope-clarity STEP4 実装完了。設定トーナメントタブの一覧（毎秒 innerHTML='' で再構築される `<ul>`）を**折りたたみドロップダウン化**。既定＝選択中1件サマリ（名前＋ライブ badge＋「他に実行中◯件」）＋▼、トグルで全件展開。サマリ・トグルを `<ul>` 外の安定要素（`#js-tournament-picker[data-expanded]`）に置き、module 変数 `_tournamentListExpanded`＋冪等再適用で**毎秒再描画をまたいで開閉保持**（勝手に畳まれない）。委譲 install-once 非破壊、入力中保護維持、行アクション本体（timerState/runtime/rebase）無変更、hidden `js-tournament-select` 温存。`<dialog>` flex 非追加・position:fixed/scale 不使用・chevron は文字差替。致命バグ保護5件全件影響なし。**main.js 無変更**。version **2.5.1 据え置き**。**既存1219 + 新規 v257 16 = 1235件全PASS**。Plan 軽量 review（段階2）承認済。**settings-scope-clarity STEP1〜4 全完了**、配信・実機 6-B は最終一括まで保留（[step4_plan](.cc-plans/2026-06-07_settings-scope-clarity_step4_plan.md) / [step4](.cc-reports/2026-06-07_settings-scope-clarity_step4.md)）
- **2026-06-07（STEP3）**: settings-scope-clarity STEP3 実装完了。ブラインド構造タブのレベル表が約6段しか見えない問題を **CSS のみ**で解消。`.blinds-editor__table-wrap` の `max-height:36vh`（約6段固定）を撤廃し、blinds タブにスコープした flex 連動（`.settings-tab[data-tab="blinds"].is-active` を flex column 化、属性セレクタで他タブ非破壊）で table-wrap が余剰高を吸収・内側スクロール。footer/add-row は flex-shrink:0 で常時可視。既定ダイアログ高 700→920px で通常表示 10〜12 段。sticky thead 維持・`<dialog>` flex 非追加・position:fixed/scale 不使用。**index.html/renderer.js/main.js 無変更**。致命バグ保護5件全件影響なし。version **2.5.1 据え置き**。c13 T15 の既定高 pin を 700→920px 追従。**既存1208 + 新規 v256 11 = 1219件全PASS**。Plan 軽量 review（段階2）承認済。**配信・実機 6-B は STEP1〜3 最終一括まで保留**（前原方針）（[step3_plan](.cc-plans/2026-06-07_settings-scope-clarity_step3_plan.md) / [step3](.cc-reports/2026-06-07_settings-scope-clarity_step3.md)）
- **2026-06-07（STEP2）**: settings-scope-clarity STEP2 実装完了。ブラインド構造タブの編集対象を選択中トーナメント構造に固定（任意プリセット選択 `js-preset-select` を hidden 化 + 編集対象ラベル）+ 共有構造保存時の3択モーダル（すべてに反映=同ID上書き / このトーナメントだけ変更=copy-on-write 新ID付替 / やめる=保存中止で編集保持）。共有なしは従来どおりモーダルなし保存。**main.js スキーマ・presets:saveUser 無変更（参照方式維持）**、`_savePresetCore` に共有分岐。timerState 除外（巻き戻り防止）を copy 経路含め維持。致命バグ保護5件全件影響なし。version **2.5.1 据え置き**（bump せず、package.json は scripts.test 1行追記のみ＝git diff で version 行 unchanged 確認）。**既存1193 + 新規 v255 15 = 1208件全PASS**。Plan 軽量 review（段階2）承認済。配信は前原 6-B ①〜⑦ OK + GO 後（[step2_plan](.cc-plans/2026-06-07_settings-scope-clarity_step2_plan.md) / [step2](.cc-reports/2026-06-07_settings-scope-clarity_step2.md)）
- **2026-06-07**: settings-scope-clarity STEP1（設定タブのスコープ可視化 + 現在トーナメント名常時表示）実装完了。設定ダイアログ7タブを「このトーナメント専用[トーナメント/ブラインド構造/背景・時計フォント/テロップ] / アプリ全体で共通[ロゴ/音/ハウス情報]」の2グループに視覚分割、ダイアログ上部に「編集中：◯◯」常時表示（切替即更新・無名フォールバック）、ブラインドタブに共有テンプレート注記。**データ構造・保存ロジック・各タブ中身・`data-tab` 識別子は無変更**＝UI/CSS/ラベル/現在名表示のみ。致命バグ保護5件全件影響なし。v2.5.0→2.5.1 bump + version-pin カスケード追従（全58ファイル）+ 新規 v254 テスト13件。**既存1180 + 新規13 = 1193件全PASS**。Plan 軽量 review（段階2 サブエージェント）承認済。**配信は前原実機 6-B ①〜⑤ OK + GO 後**（[step1_plan](.cc-plans/2026-06-07_settings-scope-clarity_step1_plan.md) / [step1](.cc-reports/2026-06-07_settings-scope-clarity_step1.md)）
- **2026-06-07（テストビルド）**: settings-scope-clarity STEP1 テストビルド完了。feature ブランチ（コード凍結 `da6516e`）から `npx electron-builder --win --publish never` で v2.5.1 インストーラを1本生成（exit 0）。成果物 `dist\pokertimerplus-setup-2.5.1.exe`（≈83MB、ProductVersion 2.5.1.0）。asar に本実装（settings-tab-group / 現在名ヘッダ / 注記）焼き込み確認済。**main 非merge / tag 無し / GitHub Release 非公開（最新 Release は v2.5.0 のまま）**。前原実機 6-B ①〜⑥ 用。CC 自走でビルドまで実施（BUILD_INSTRUCTIONS 旧前提「CC 環境では不可」を customer-app 同様に覆した）（[testbuild report](.cc-reports/2026-06-07_settings-scope-clarity_step1_testbuild.md)）
- **旧 v2.5.0 配信状態（参考）**: main `e77fcce` v2.5.0 マージ commit、origin/main 同期済。GitHub Release `v2.5.0` 公開済（Latest・自動更新有効）
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
- **2026-06-07（再テストビルド3・配信前最終）**: dirty-switch-guard 反映版の v2.5.1 再テストビルド完了（HEAD `a3abb69`＝実装 `504e35c` 含む）。事前確認で v2.5.0 画像分離を土台に含むこと再確認。`npx electron-builder --win --publish never`（exit 0）。成果物 `dist\pokertimerplus-setup-2.5.1.exe`（83,042,018 bytes、ProductVersion 2.5.1.0）。asar に dirty-switch-guard（confirmDiscardBlindsDirtyIfNeeded ×5 / js-blinds-dirty-switch-dialog ×2 / showBlindsDirtySwitchModal ×2）+ バグ①修正（42vh/66vh）+ STEP1〜4 全マーカー焼き込み確認。起動スモーク OK（致命エラーなし・自動更新誤作動なし）。**main 非merge / tag 無し / GitHub Release 非接触**。**配信前 最終テストビルド**。前原 6-B（切替ガード①〜⑥ + STEP1〜4 退行⑦〜⑩、約15分）用（[testbuild3 report](.cc-reports/2026-06-07_settings-scope-clarity_testbuild3.md)）
- **2026-06-07（再テストビルド・2回目）**: ブラインド表0段修正反映版の v2.5.1 再テストビルド完了（commit `1d9850f`＝旧 px420 コメント整理[値無変更]含む HEAD）。事前確認で v2.5.0 画像分離を土台に含むこと再確認。`npx electron-builder --win --publish never`（exit 0）。成果物 `dist\pokertimerplus-setup-2.5.1.exe`（83,040,140 bytes、ProductVersion 2.5.1.0）。asar にバグ①修正（min-height:42vh / max-height:66vh / min(1100px）+ STEP1〜4 全マーカー焼き込み確認。起動スモーク OK（致命エラーなし・自動更新誤作動なし）。**main 非merge / tag 無し / GitHub Release 非接触**。前原実機 6-B（STEP1〜4＋バグ①修正 合算 0〜10、約20分）用（[testbuild2 report](.cc-reports/2026-06-07_settings-scope-clarity_testbuild2.md)）
- **2026-06-07（一括テストビルド・初回）**: settings-scope-clarity STEP1〜4 合算の v2.5.1 テストビルド完了。事前確認で feature ブランチが v2.5.0（画像分離 `e77fcce`）を土台に含むことを確認（祖先＋main.js マーカー12件）。`npx electron-builder --win --publish never`（exit 0）。成果物 `dist\pokertimerplus-setup-2.5.1.exe`（83,039,604 bytes ≈83MB、ProductVersion 2.5.1.0）。asar に STEP1〜4 全マーカー焼き込み確認。起動スモークテスト OK（Electron 5プロセス生存・致命エラーなし、`Update for 2.5.1 not available (latest 2.5.0, downgrade disallowed)` ＝自動更新誤作動なし）。**main 非merge / tag 無し / GitHub Release 非接触（最新は v2.5.0 のまま）**。前原実機 6-B（STEP1〜4 合算 0〜8、約20分）用（[testbuild report](.cc-reports/2026-06-07_settings-scope-clarity_testbuild.md)）
- **2026-06-07（settings-scope-clarity 案件クローズ）**: v2.5.1 配信完了を受けて案件クローズ。関連 md（reports 11 / plans 6 / briefs 28 = 計45件）を `.cc-archive/settings-scope-clarity/`（briefs/plans/reports）へ退避完了。merge 済 `feature/settings-scope-clarity`（33d2846）をローカル削除完了（origin は未push のため remote 削除不要）。軽微5件は「温存中の次期候補」へ記載済（配信後 別 brief 化）
- **配信状況**: **公開中の最新は v2.5.1**（GitHub Release Latest・自動更新有効）。**v2.6.0 はテストビルド完了・前原 6-B → 配信 GO 待ち**（main 未merge、Release 未公開）。
- **2026-06-08（fee-pot-yen STEP 5・配信フェーズ／version 2.6.0 bump + テストビルド）**: version **2.5.1→2.6.0 bump** + version-pin cascade（テスト69ファイル `'2.5.1'`→`'2.6.0'` 機械置換、全PASS）。CHANGELOG.md v2.6.0 セクション + docs/specs.md §3.4.2（店内通貨$・1件あたり拠出モデル）追加。`npx electron-builder --win --publish never`（exit 0）で `dist\pokertimerplus-setup-2.6.0.exe`（≈79MB）生成。**asar 焼込確認**（potAmounts 42 / 1件あたり拠出 23 / setPotDefaults 2、fee-lock/payout-mode は comment のみ）。**起動スモーク（CC 自走）で migration 数値安全を runtime 確認**＝起動ログ `[v2.6.0] poolRate→POT 変換: 中間% 0/13件`（実store13件で TOTAL POOL 数値厳密一致）+ 自動更新誤作動なし（Release は 2.5.1 のまま）+ クラッシュなし・5プロセス生存。**main 非merge / tag 無し / GitHub Release 非接触**。**1328件全PASS**。**v2.6.0 実装＋テストビルド全完了 → 前原 6-B ①〜⑥+追(2画面/音声/タイマー) → 配信 GO 待ち**。Plan 軽量 review（段階2）承認済（[step5_testbuild](.cc-reports/2026-06-07_fee-pot-yen_step5_testbuild.md)）
- **2026-06-08（fee-pot-yen STEP 4 実装・¥フィー E-1/🔒撤去 + 統合検証）**: v2.4.0 の **🔒fee-lock 機構を完全撤去（E-1）**。本モデルで ¥フィーは pool 無関係（pool=Σ POT×件数）になり 🔒 の景表法保護根拠が消滅・解除ダイアログ文言も虚偽化のため。撤去＝feeLockState/setFeeReadonly/lockAllFees/_resolveFeeElements/openFeeUnlockDialog/🔒ボタン×3/解除ダイアログ/fee-lock CSS/自動再ロック呼出。¥フィーは **readonly 撤去＝買込（店売上）記録として自由編集可**、ラベル「フィー（買込¥）」。**★ ensureEditorEditableState/setBlindsTableReadonly（致命保護・別 namespace）は不可侵維持**（v264 E4 担保、editable-state/new-tournament-edit 既存テスト PASS）。統合検証で 店内通貨$/プール=Σ(POT×件数)/配当=金額固定/%消滅/¥フィー独立 の成立確認。致命バグ保護5件 影響なし、並列0体、version 2.5.1 据置。**STEP3後 1318＋新規 v264 10件＝1328件全PASS**（v210 T6/T7/T9/T14・v262/v263 S1 更新）。commit はこの後。**STEP1〜4（実装）全完了**＝残るは STEP5（CHANGELOG/specs・version 2.6.0 bump・テストビルド）＝前原 GO 待ち。Plan 軽量 review（段階2）承認済（[step4](.cc-reports/2026-06-07_fee-pot-yen_step4.md)）
- **2026-06-08（fee-pot-yen STEP 3 実装・配当%撤去+§5解消）**: 配当の **payout-mode toggle（%/金額切替）を撤去**＝配当は常に金額（店内通貨$）固定。payoutInputMode 常時 'amount'、updatePayoutsSum/renderPayoutsEditor/readPayoutsFromForm/readPayoutsFromFormAsPercent/isPayoutsValid から **% 分岐撤去**、デッド CSS（.payouts-mode-*）除去、el マップ tournamentPayoutMode 撤去、保存メッセージ「100%」→「プール額に合わせて」。**§5 自然解消**＝TOTAL POOL=max(Σ POT×件数, GTD) を無改造流用・isPayoutsValid は合計≒pool 流用（pool が具体$ になり法令判断不要、payout-amount-default で escalate 中だった §5 は円POTモデルへの畳み込みで決着）。**computeRoundedAmounts の % 分岐は既存%トーナメント後方表示用に残置**。アプリから％が完全消滅。致命バグ保護5件 影響なし（🔒fee-lock 未接触＝E-1 は STEP4）、並列0体、version 2.5.1 据置。**STEP2後 1308＋新規 v263 10件＝1318件全PASS**（v216 T2・v260 S3 更新、light-todos PASS＝デッドコード/未処理コメントなし）。commit はこの後。Plan 軽量 review（段階2）承認済（[step3](.cc-reports/2026-06-07_fee-pot-yen_step3.md)）。次: STEP4（¥フィー欄 E-1 + 統合検証）
- **2026-06-08（fee-pot-yen STEP 2 実装・$拠出UI+通貨$）**: フィー隣「反映率%」入力→**「1件あたり拠出 $」入力**（label/属性 min0 step100 max撤廃/単位を通貨記号同期 js-pot-unit）、ハウス既定 %→$（potDefaults + settings:setPotDefaults + preload 公開）、通貨既定 **¥→$（店内通貨）**（新規 + 既存 '¥' リテラル読み替え migration、カスタム記号不可侵）。computeTotalPoolFromForm/保存ビルド/フォーム同期/ハウス既定保存を **$ 直読み**化（_readPoolRateFromInput→_readPotFromInput、STEP1 経過措置撤去）。要素 id は legacy（*-pool-rate）維持で churn 最小。**実データ検証: 前原 store の通貨は既に $×12/P$×1・¥ 0件 → ¥→$ 移行は実質 no-op、カスタム P$ 保全**。致命バグ保護5件 影響なし（🔒fee-lock は STEP2 未接触＝E-1 撤去は STEP4、ensureEditorEditableState と非混同）、並列0体、version 2.5.1 据置。**STEP1後 1294＋新規 v262 14件＝1308件全PASS**（v210 T5/T8・v261 S7 更新）。commit はこの後。Plan 軽量 review（段階2）承認済（[step2](.cc-reports/2026-06-07_fee-pot-yen_step2.md)）。次: STEP3（配当%撤去+§5解消）
- **2026-06-08（fee-pot-yen STEP 1 実装・基盤/数値中立）**: 賞金プール計算を poolRates%（`Σfee×件数×rate/100`）→ **potAmounts$（`ΣPOT×件数`、¥フィー独立、$整数で端数ゼロ）** に切替。新スキーマ potAmounts/sanitize/DEFAULT/potDefaults + migration（poolRate%→POT$=round(fee×rate/100)、poolRates dormant 温存、中間%件数ログ）+ computeCalculatedPool 切替。**UI・通貨は STEP1 では不変（数値中立）**。**前原 store の実データ13トーナメントを CC が直接読み、old pool===new pool を全件証明（mismatch 0、中間% 0件）→ v2.4.0 不変条件を実データで厳密維持・escalate 不発**。致命バグ保護5件非接触（🔒fee-lock は STEP1 未接触、E-1 撤去は STEP2/3）、並列0体、version 2.5.1 据置。**既存1280＋新規 v261 14件＝1294件全PASS**（v210 を新モデルへ更新・件数同）。commit はこの後。ブランチ `feature/payout-amount-default` 上に積載。Plan 軽量 review（段階2）承認済（STEP1〜3 先行実装可・¥フィーE-1採用）（[plan](.cc-plans/2026-06-07_fee-pot-yen_plan.md) / [review](.cc-briefs/2026-06-07_fee-pot-yen_review.md) / [step1](.cc-reports/2026-06-07_fee-pot-yen_step1.md)）。次: STEP2（プール$UI+通貨$+¥フィーE-1）
- **2026-06-08（fee-pot-yen 設計調査）**: フィー「反映率%」（poolRates、`Σフィー×件数×rate/100`）を「円POT」（`potAmounts`¥、`Σ POT×件数`、店取り=フィー−POT 自動）へ完全置換する設計を investigation 型で調査（**コード変更ゼロ**）。現状%全経路を file:line 地図化。**移行は支配的ケース 100%（→POT=フィー）/0%（→POT=0）で TOTAL POOL 厳密一致＝v2.4.0 不変条件を保てる**、中間%（実運用ほぼ皆無）のみ ¥端数で≤数円ズレうる点を要前原明記。**円POTモデルは payout ①〜④（金額固定）と統合すると旧§5 を構造的に解消**（pool=max(Σ POT×件数, GTD) に金額賞金を配分、§5 の法令判断を不要化）。順位%は比例オプションとして残す(a)/全廃(b) は前原確認。規模 v2.4.0 並み＝**v2.6.0・feature/payout-amount-default の上に載せて統合**推奨（①〜④を§5ギャップ付き単独配信せず畳む）。景表法/風営法は断定せず論点提示。前原判断点8件を整理（[investigation report](.cc-reports/2026-06-07_fee-pot-yen_investigation.md)）
- **2026-06-08（payout-amount-default 実装・確定部分1〜4）**: ％プライズ端数ズレを根治。**①金額モード＝入力額固定**（tournament に `payoutMode` 永続化＋`computeRoundedAmounts` を「amount をそのまま返す」分岐に。pool 変動・¥1丸めでもドリフトなし。`amountSum===pool` 厳密一致条件を撤廃）**②初期値＝金額**（新規 `newT` に `payoutMode:'amount'`、編集開きは保存モード同期、旧 percent 固定リセット撤廃）**③％モード＝従来どおり比例**（computeCalculatedPool/poolRates 無改造）**④％端数根治＝最大剰余法**（per-rank 綺麗着地・合計=pool 厳密維持・既存%も移行不要で綺麗。¥1 は%精度ロス残＝金額モードで回避）。永続化は P1（schema＋migration 推論[amount有→amount/無→percent]＋normalize＋list 同梱、total 不変）。**TOTAL POOL 表示・computeTotalPool・isPayoutsValid は無改造（§5 のため温存）→ v2.4.0 不変条件維持**。致命バグ保護5件全件影響なし、並列0体、version 2.5.1 据え置き。**既存1261＋新規 v260 19件＝1280件全PASS**（v216 は新挙動へ期待値更新）。Plan 軽量 review（段階2）承認済。**§5（金額固定×poolRate>0 併用の TOTAL POOL/validation/法令）は構築士2 が段階3 escalate→前原 Cowork 確定待ち**。ブランチ `feature/payout-amount-default`（[plan](.cc-plans/2026-06-07_payout-amount-default_plan.md) / [review](.cc-briefs/2026-06-07_payout-amount-default_review.md) / [report](.cc-reports/2026-06-07_payout-amount-default.md)）
- **2026-06-07（payout-amount-default 調査）**: ％プライズが開き直しで端数ズレ（100000→100005 / 50000→49995）する真因を investigation 型で確定（**コード変更ゼロ**）。真因＝表示金額を毎回「保存％ × 現在プール」で逆算する `computeRoundedAmounts()`（renderer.js:1069-1097）の％フォールバック。保存値が `toFixed(2)` 丸めの％（66.67 等）なので `150000×66.67%=100005` と round number に着地しない。再現 A（pool=150000 / [66.67%,33.33%] / 丸め¥1）で症状値完全一致。v2.1.4 の amount 絶対値保持は「amount 合計===プール 厳密一致」時のみ効き、①％モードは amount 非保存 ②金額モードもライブ人数でプールが動くと即フォールバックでズレ再発。結論：**金額デフォルト化は新規・プール固定なら有効、既存％トーナメント＋プール変動ケースは未解決**。対応案 (A) デフォルト金額化（最小・新規のみ・低リスク）/ (B) ％丸め根治（根本だが敏感経路・v2.4.0 不変条件と緊張・要承認）/ (C) 既存は据え置き推奨。致命バグ保護5件影響なし、並列0体。**方針判断（A最小 or B根治）は構築士2 / 前原**（[investigation report](.cc-reports/2026-06-07_payout-amount-default_investigation.md)）
- **次のアクション(想定)**:
  - **【最優先】v2.6.0 fee-pot-yen: 前原 6-B 実機確認（テストビルド `dist\pokertimerplus-setup-2.6.0.exe`）→ 配信 GO 受領 → CC 自走で配信**（feature/payout-amount-default → main merge `--no-ff` → tag `v2.6.0` → push → main から .exe 再ビルド → GitHub Release v2.6.0 公開[Latest・自動更新]）→ 案件クローズ + md を `.cc-archive/fee-pot-yen/`（+ payout-amount-default 関連）へ退避 + feature ブランチ整理
  - payout-amount-default（①〜④）は v2.6.0 feature ブランチに内包済（§5 は v2.6.0 で自然解消）。単独配信はしない＝v2.6.0 にまとめて配信
  - settings-scope-clarity 案件クローズ済（md 45 件 `.cc-archive/settings-scope-clarity/` 退避 + feature ブランチ削除完了）
  - 温存: v2.3.0(PRE_START 永続化) / 軽微（入力欄 id legacy `*-pool-rate`→`*-pot` リネーム整理、機能影響なし）

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
