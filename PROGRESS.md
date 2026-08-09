# PROGRESS — poker-clock(PokerTimerPLUS+)

> 前原が一目で全体進捗を見る1枚ダッシュボード。各行は1〜2行に保ち、詳細は各 `.cc-reports/...md`・`CHANGELOG.md`・`.cc-archive/` に委ねる。
> バージョン単位のリリース進行型(タイマーアプリのフリー配布ソフト)。
> ⚠️ 表内パスは CC 用参照(チャットではタップ不可・コピーしてエディタで開く)。

**最終更新: 2026-08-09** — **案件231 dblink-stale-idle-guard 実装完了(レビュー待ち)**。実店舗で発生した「進行中タイマーが勝手に未スタート状態へ巻き戻る」バグ(原因=DB連携のstale idle/finished追従)を根治: 追従せずPC状態をrepublish。テスト1880件全PASS(+16)・致命5件維持・既定OFF不変。feature ブランチのみ・main push/リリースは前原GO待ち。再開ポイントは末尾「## 直近の状態」。

---

## 🟡 現在のリリース作業 / オープン STEP

| 案件 | 状態 | 成果物 / 引継ぎ |
|------|------|--------|
| 案件231 dblink-stale-idle-guard | 🟡 実機確認待ち | 巻き戻り根治(stale idle/finished に追従せずrepublish)。完了review承認(dual・懐疑役OK)・feature/dblink-stale-idle-guard `ec5d9f7`・6-B 4件GO後に main push→リリース案件。report=`.cc-reports/2026-08-09_案件231_dblink-stale-idle-guard.md` |
> 凡例: `📝 brief起案中` / `🤔 Plan中` / `🟢 実装中` / `🔵 レビュー待ち` / `🟡 実機確認待ち` / `📦 配信準備中`

---

## ✅ リリース履歴(新しい順・詳細は report / CHANGELOG.md)

| 配信日 | バージョン | 主要変更(1行) | report |
|--------|-----------|---------|--------|
| 2026-07-18 | **v2.10.0** | **案件230 K4=PC表示メタ・ロゴ送信**(連携ON大会のみ イベント名/賞金/配当/テロップ/テーマ/アベスタック+ロゴを `/api/pc-timer/display`・`/logo` へ)。coalescer 4種別化+global gap 1.1s(≤54回/分)・6値テーマ丸め・テロップ平文化・ロゴ≤300KB(nativeImage縮小/SVGスキップ)。INVARIANT例外②改定=金銭表示情報の送信を前原承認で明示許容。既定OFF不変。tag v2.10.0(Latest・自動更新) | `.cc-reports/2026-07-18_案件230_K4_PC表示データ送信.md` |
| 2026-07-18 | **v2.9.0** | **外部DB連携(店舗キー方式・案件229 STEP2=K1接続基盤+紐づけ/K2状態送信・楽観ロック/K3切断表示・OFF停止・DB追従アダプタ)**。設定=URL+店舗キーの2入力・既定OFF=完全ローカル不変・supabase-js不使用(plain fetch)・送信は時計状態+ブラインド構成のみ。tag v2.9.0(自動更新) | `.cc-reports/2026-07-18_案件229_PC店舗キー連携_STEP2-K{1,2,3}.md` |
| 2026-07-08 | **v2.8.0** | **スマホ遠隔操作(実験的機能・単一モードのみ)**。同一LAN内スマホから全操作(PIN+セッショントークン+Origin+Host厳格アンカー+レート制限・状態SSE=fetch streaming・危険操作confirm・卓名・QR=依存ゼロ自作)。既定OFFで現行完全同一・完全ローカル文言をLAN例外込みに改訂・追加ライブラリゼロ・CSP無改変。merge `c8eb931`/tag v2.8.0(Latest・自動更新) | `.cc-reports/2026-07-08_remote-control_phase1{a-core,b-core,b-qr,c-release-prep}.md` |
| 2026-07-08 | **v2.7.0** | **マルチトーナメント4分割表示モード**(2×2独立時計・操作盤+キーボード・フィラー・停電復帰=復元方式選択+経過時間表示・開始/終了確認モーダル・HDMI追従・走行中差し替えガード)。単一モード完全非接触・store書込ゼロ。tag v2.7.0(Latest・自動更新) | `.cc-reports/2026-07-08_multi-tournament-4up_phase3b-release-prep.md`(+3c report) |
| 2026-06-24 | v2.6.6 | テロップ色プレビュー枠に「プレビュー(表示見本・編集不可)」ラベル明示(v2.6.5 で枠を編集領域と誤認した件の fix)。UI/文言のみ・2箇所整合・致命5件非接触。merge直push `df919b9`/tag v2.6.6(Latest・自動更新)。軽量トラック | `.cc-briefs/2026-06-24_telop-preview-label_lightweight_review.md` |
| 2026-06-24 | **v2.6.5** | テロップ色変えを「文字を選択→色ボタン」方式に作り直し(手打ち記法不要・9色+任意色+色を消す+編集中プレビュー・設定タブ/Ctrl+T 2箇所)。保存形式/marquee.js安全パーサ無改変=旧データ100%互換・XSS後退ゼロ。致命5件非接触。merge `e680436`/tag v2.6.5(Latest・自動更新) | `.cc-reports/2026-06-24_telop-color-ux-simplify.md` |
| 2026-06-24 | **v2.6.4** | トーナメント開始ボイス選択(音タブ・なし+女性4+男性4=9・グローバル共通)。開始時(即時/0着地両方)に選択ボイス1回・start.mp3置換。8ボイス前原自作。致命5件(特にAudioContext resume)非接触。merge `ee16648`/tag v2.6.4(Latest) | `.cc-reports/2026-06-24_tournament-start-voice.md` |
| 2026-06-24 | **v2.6.3** | ② 2画面 operator→hall 状態遷移の時差を案A(遷移時のみ即時送信)で最大500ms→約20〜60msに短縮。renderer.jsのみ・致命5件+PRE_START0着地ガード非接触。merge `184a25e`/tag v2.6.3 | `.cc-reports/2026-06-24_dualscreen-latency.md` |
| 2026-06-24 | **v2.6.2** | テロップ ①単独Tで表示/非表示トグル ③本文の部分色変え`[color]…[/color]`(innerHTML不使用でXSS安全)。merge `f019f14`/tag v2.6.2 | `.cc-reports/2026-06-24_telop-dualscreen-ideas.md` |
| 2026-06-23 | **v2.6.1** | PRE_START中のNEXT BREAK IN誤表示根治(基準をLv0満了durationに)+参加人数初期値10→3。merge `4427af7`/tag v2.6.1 | `.cc-reports/2026-06-23_prestart-display-fixes.md` |
| 2026-06-08 | **v2.6.0** | 賞金プールを店内通貨$・1件あたり拠出×件数モデルへ刷新(%全廃・配当金額固定)+ 重さ改善3種。merge `a1bce57`/tag v2.6.0(Latest) | `.cc-reports/2026-06-08_v260-release.md` |
| 2026-06-07 | v2.5.1 | 設定タブをスコープ別2分割 + ブラインド編集の卓固定 + 各種UX。merge `f804114` | `.cc-reports/2026-06-07_settings-scope-clarity_release.md` |
| 2026-06-06 | v2.5.0 | トーナメント画像分離で保存激重を根治(config 35MB→92KB)。merge `e77fcce` | `.cc-archive/tournament-bloat/` |
| 2026-05-30 | v2.4.1 | 開始前カウントダウン0着地後の停止を根治(hotfix)。merge `01626aa` | `.cc-archive/prestart-zero-stall/` |
| 2026-05-24 | v2.4.0 | 賞金プール計算改修(フィー×件数×プール率)。HEAD `ee78652` | `.cc-archive/v210-prize-pool-refactor/` |
| それ以前 | v2.0.0 / v1.3.0 / v1.2.0 | HDMI2画面対応 / 入力中保護5原則 等 | `CHANGELOG.md` / `HANDOVER.md` |

---

## 📋 温存中の次期バージョン候補

| 候補 | 概要 | 状態 |
|------|------|------|
| v2.3.0 | PRE_START 永続化(`feature/v2.3.0-prestart-persistence`)| 温存・再開は前原判断。再開時は復元経路に RUNNING/BREAK stale-restore ガード要評価 |
| 軽微 | id `*-pool-rate`→`*-pot` リネーム / poolRates dormant除去 / settings軽微5件 | 別brief可・緊急性なし。旧merge済ローカルブランチは2026-07-07に60本削除済(残=main+未merge2本: v2.0.10-investigation / v2.3.0-prestart-persistence〔温存〕) |

---

## 📊 累積統計

| 指標 | 値 |
|------|----|
| 配信済リリース | 19件(v1.0.0〜v2.10.0)|
| アーカイブ済案件 | 10件(`.cc-archive/`)|
| オープン作業 | 1件(案件231 dblink-stale-idle-guard=レビュー待ち)|
| 最新テスト件数 | 1880件 全PASS(db-link 173 / db-link-payload 118 含む) |
| 致命バグ保護 | 5件 完全維持(resetBlindProgressOnly / timerState destructure除外 / ensureEditorEditableState 4重防御 / AudioContext resume / runtime永続化8箇所)|

---

## 直近の状態(次セッション起点)

- **git**: `main` = v2.10.0 配信済(tag v2.10.0・Latest・自動更新有効)。作業中 = **`feature/dblink-stale-idle-guard`(案件231・main 未push)**。
- **現在地(2026-08-09)**: 実店舗報告「進行中タイマーが勝手に未スタート状態へ巻き戻る」を調査→原因特定(連携ON大会でDBのstale idle/finished行へ追従=前原「連携ONでした」で確定)→**案件231 として修正実装完了**(planClockApply が republish を返しPC状態を再送・観測ログ2種追加)。テスト1880件全PASS(+16)・完了レビュー(cc-review2 dual)実行中/待ち。**次のアクション=完了レビュー→前原実機確認(6-B)→GO後に main merge+リリース案件(version assertion 74ファイル bump 含む)**。②通貨「P$」はコード外=大会毎設定(前原PCは「+2 LUCKY HUNT」1件のみ・設定画面で変更)。
- **★リリース時の教訓**: 「main merge = 配信」ではない。実機は GitHub Release(Latest tag)の自動更新で動く。機能を実機に届けるには **tag+Release 公開が必須**(`git merge-base --is-ancestor <commit> <tag>` で確認)。
- 参照: 調査=`.cc-reports/2026-08-09_調査_カウントダウン巻き戻り+通貨単位.md` / 実装report=`.cc-reports/2026-08-09_案件231_dblink-stale-idle-guard.md`。温存候補=v2.3.0 PRE_START永続化(前原判断)。

---

## 更新ルール(CC 向け)

完了報告(`.cc-reports/...md`)を書いたら **同じターンで** 本ファイルを Edit:
1. オープン STEP 表を更新 / 配信時はリリース履歴に **1行** 追加
2. 累積統計(テスト件数・リリース数)を更新
3. 「直近の状態」を最新スナップショット1つに更新

**★★ 肥大厳禁(CLAUDE.md「全プロジェクト共通・最優先ルール ②」と同一・2026-06-08 反省→2026-06-18 スリム化)**: 各行1〜2行。リリース履歴の各セルも1行要約+report pointer。実装詳細narrative・テスト内訳・検証ログの全文は書かない(`.cc-reports/`・`CHANGELOG.md`・memory に委ねる)。「直近の状態」は最新スナップショット1つだけ(過去セッションのログを積み増さない=これが再肥大の主因)。
