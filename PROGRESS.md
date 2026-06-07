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
| (なし) | — | ✅ オープン作業なし（**v2.5.1 配信完了 2026-06-07**、settings-scope-clarity 全完了） | — | — | — |

> 状態の凡例: `📝 brief 起案中` / `🤔 Plan 中` / `🟢 実装中` / `🔵 レビュー待ち` / `🟡 実機確認待ち` / `📦 配信準備中`
> ※ prestart-zero-stall 案件（STEP 1 調査 → STEP 2 実装 → 配信）は v2.4.1 として配信完了 + 案件クローズ済。関連 md 8 件は `.cc-archive/prestart-zero-stall/`（briefs 5 / plans 1 / reports 2）へ退避済（2026-05-30）。

---

## ✅ リリース履歴(新しい順)

| 配信日 | バージョン | 主要変更 | report |
|--------|-----------|---------|--------|
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

---

## 📊 累積統計

| 指標 | 件数 |
|------|------|
| 配信済みリリース | 8 件(v1.0.0 / v1.2.0 / v1.3.0 / v2.0.0 / v2.4.0 / v2.4.1 / v2.5.0 / **v2.5.1**)|
| アーカイブ済 案件(`.cc-archive/`)| 3 件(v210-prize-pool-refactor / prestart-zero-stall / tournament-bloat)※ settings-scope-clarity は構築士2 クローズ判定後に追加予定|
| オープン作業 | 0 件（v2.5.1 配信完了）|
| 最新テスト件数 | 1261 件 全 PASS(v2.5.1 配信時点、settings-scope-clarity で +81＝v254〜v259)|
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

- **現在ブランチ**: `main`（`f804114` v2.5.1 マージ commit、origin/main 同期済 push 完了）
- **直前 commit**: `f804114 Merge: v2.5.1 - settings-scope-clarity（...）`（CHANGELOG 最終化 `33d2846` / 実装は `504e35c` まで feature 上）
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
- **配信状況**: **v2.5.1 配信済み（最新・公開中）**。GitHub Release v2.5.1 = Latest、自動更新有効。既存ユーザーは次回起動で v2.5.1 自動更新通知
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
