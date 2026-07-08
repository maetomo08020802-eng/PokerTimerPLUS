# PROGRESS — poker-clock(PokerTimerPLUS+)

> 前原が一目で全体進捗を見る1枚ダッシュボード。各行は1〜2行に保ち、詳細は各 `.cc-reports/...md`・`CHANGELOG.md`・`.cc-archive/` に委ねる。
> バージョン単位のリリース進行型(タイマーアプリのフリー配布ソフト)。
> ⚠️ 表内パスは CC 用参照(チャットではタップ不可・コピーしてエディタで開く)。

**最終更新: 2026-07-08** — multi-tournament-4up **Phase 2〜2e 前原実機確認OK** + **Phase 2f(復元方式の選択)+追補(ダイアログに経過時間表示)実装完了・前原GO受領**。配信中は **v2.6.6(Latest・自動更新有効)**のまま(マルチモードは未配信機能・単一モード非接触)・テスト**1514件**全PASS。再開ポイントは末尾「## 直近の状態」。

---

## 🟡 現在のリリース作業 / オープン STEP

| 案件 | 状態 | 成果物 / 引継ぎ |
|------|------|--------|
| multi-tournament-4up Phase 2〜2e(独立PRE_START+キーボード保険+フィラー+実機FB 4弾対応=停電復帰まで) | ✅ 前原実機確認OK(2026-07-08)・GO待ち(2f と合わせて merge 判断) | report 5本 `.cc-reports/2026-07-07_multi-tournament-4up_phase2*.md` / branch `feature/multi-tournament-4up-phase2`(2d=`e7a8de6`/2e=`cf74a96`) |
| multi-tournament-4up Phase 2f(復元方式の選択=そこから再開/経過を反映・実機FB第5弾)+追補(経過時間表示) | 🟡 GO受領・main merge 作業中 | report 2本 `.cc-reports/2026-07-08_multi-tournament-4up_phase2f-*.md` / 同 branch(2f=`f07f84d`/追補=`babafbb`) |
> 凡例: `📝 brief起案中` / `🤔 Plan中` / `🟢 実装中` / `🔵 レビュー待ち` / `🟡 実機確認待ち` / `📦 配信準備中`

---

## ✅ リリース履歴(新しい順・詳細は report / CHANGELOG.md)

| 配信日 | バージョン | 主要変更(1行) | report |
|--------|-----------|---------|--------|
| 2026-06-24 | **v2.6.6** | テロップ色プレビュー枠に「プレビュー(表示見本・編集不可)」ラベル明示(v2.6.5 で枠を編集領域と誤認した件の fix)。UI/文言のみ・2箇所整合・致命5件非接触。merge直push `df919b9`/tag v2.6.6(Latest・自動更新)。軽量トラック | `.cc-briefs/2026-06-24_telop-preview-label_lightweight_review.md` |
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
| 配信済リリース | 15件(v1.0.0〜v2.6.6)|
| アーカイブ済案件 | 10件(`.cc-archive/`)|
| オープン作業 | 0件(安定運用フェーズ)|
| 最新テスト件数 | 1514件 全PASS(multi Phase1 +23・1b +2・Phase2 +19・2b +3・2c +10・2d +8・2e +7・2f +8・追補 +1) |
| 致命バグ保護 | 5件 完全維持(resetBlindProgressOnly / timerState destructure除外 / ensureEditorEditableState 4重防御 / AudioContext resume / runtime永続化8箇所)|

---

## 直近の状態(次セッション起点)

- **git**: `feature/multi-tournament-4up-phase2`(2f=`f07f84d`/追補=`babafbb`)。**前原 GO 受領済(2026-07-08)= main merge + push 実施中**(tag/.exe/Release は Phase 3 の配信判断まで行わない)。配信は tag `v2.6.6`(Latest・自動更新有効)のまま(マルチモードは未配信機能)。
- **直前作業(2026-07-08)**: Phase 2〜2f 前原実機確認OK+GO受領。**Phase 2f=復元方式の選択制**(4ボタンダイアログ・`toPowerLossElapsedRecord`・どちらも復元直後は一時停止・schema=1無改変)+**追補=ダイアログに「終了から約N分」動的表示**(`_formatMultiSessionAge`)。完了review: 2f=承認・追補=条件付き承認(PROGRESS未更新指摘→本編集で是正)。テスト1514件全PASS・致命5件非接触・store書込ゼロ維持。report 2本 `.cc-reports/2026-07-08_multi-tournament-4up_phase2f-*.md`。
- **次のアクション**: main merge + push 完了確認→Phase 3(仕上げ・堅牢化・配信/roadmap §5)の brief 起案。実機軽確認(経過時間表示の実値)は 2f シナリオ#1 に相乗り。

---

## 更新ルール(CC 向け)

完了報告(`.cc-reports/...md`)を書いたら **同じターンで** 本ファイルを Edit:
1. オープン STEP 表を更新 / 配信時はリリース履歴に **1行** 追加
2. 累積統計(テスト件数・リリース数)を更新
3. 「直近の状態」を最新スナップショット1つに更新

**★★ 肥大厳禁(CLAUDE.md「全プロジェクト共通・最優先ルール ②」と同一・2026-06-08 反省→2026-06-18 スリム化)**: 各行1〜2行。リリース履歴の各セルも1行要約+report pointer。実装詳細narrative・テスト内訳・検証ログの全文は書かない(`.cc-reports/`・`CHANGELOG.md`・memory に委ねる)。「直近の状態」は最新スナップショット1つだけ(過去セッションのログを積み増さない=これが再肥大の主因)。
