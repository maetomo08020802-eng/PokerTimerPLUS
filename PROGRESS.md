# PROGRESS — poker-clock(PokerTimerPLUS+)

> 前原が一目で全体進捗を見る1枚ダッシュボード。各行は1〜2行に保ち、詳細は各 `.cc-reports/...md`・`CHANGELOG.md`・`.cc-archive/` に委ねる。
> バージョン単位のリリース進行型(タイマーアプリのフリー配布ソフト)。
> ⚠️ 表内パスは CC 用参照(チャットではタップ不可・コピーしてエディタで開く)。

**最終更新: 2026-06-24** — **v2.6.3 配信済(Latest)**。+ **tournament-start-voice(開始ボイス選択)実装完了・🟡前原6-B/CREDITS確定待ち**(v2.6.4 想定)。音タブで開始ボイス9状態選択・グローバル永続化・開始時にstart.mp3置換。テスト1418件全PASS。再開ポイントは末尾「## 直近の状態」。

---

## 🟡 現在のリリース作業 / オープン STEP

| 案件 | 状態 | 成果物 / 引継ぎ |
|------|------|--------|
| tournament-start-voice(開始ボイス選択・全体共通) | 🟡 実機確認待ち(実装+v271回帰14件+完了report+完了review承認。CREDITS確定済) | report `.cc-reports/2026-06-24_tournament-start-voice.md` / ブランチ `feature/v2.6.4-tournament-start-voice`。残=前原6-B(音再生体感①〜④)+配信GO→ v2.6.4 配信。CREDITS=前原自作・帰属不要(2026-06-24確定) |
> 凡例: `📝 brief起案中` / `🤔 Plan中` / `🟢 実装中` / `🔵 レビュー待ち` / `🟡 実機確認待ち` / `📦 配信準備中`

---

## ✅ リリース履歴(新しい順・詳細は report / CHANGELOG.md)

| 配信日 | バージョン | 主要変更(1行) | report |
|--------|-----------|---------|--------|
| 2026-06-24 | **v2.6.3** | ② 2画面 operator→hall 状態遷移の時差を案A(遷移時のみ即時送信)で最大500ms→約20〜60msに短縮。renderer.jsのみ・致命5件+PRE_START0着地ガード非接触。merge `184a25e`/tag v2.6.3(Latest) | `.cc-reports/2026-06-24_dualscreen-latency.md` |
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
| 軽微 | id `*-pool-rate`→`*-pot` リネーム / poolRates dormant除去 / 旧merge済ローカルブランチ整理 / settings軽微5件 | 別brief可・緊急性なし |

---

## 📊 累積統計

| 指標 | 値 |
|------|----|
| 配信済リリース | 12件(v1.0.0〜v2.6.3)|
| アーカイブ済案件 | 10件(`.cc-archive/`)|
| オープン作業 | 1件(tournament-start-voice・実装完了→前原6-B/CREDITS確定待ち)|
| 最新テスト件数 | 1418件 全PASS(v271 +14) |
| 致命バグ保護 | 5件 完全維持(resetBlindProgressOnly / timerState destructure除外 / ensureEditorEditableState 4重防御 / AudioContext resume / runtime永続化8箇所)|

---

## 直近の状態(次セッション起点)

- **git**: ブランチ `feature/v2.6.4-tournament-start-voice`・commit `e79ac13`・version 2.6.3 据置・テスト1418件全PASS。main は v2.6.3(`184a25e`/tag `v2.6.3`)Latest 公開・自動更新有効。
- **直前作業(2026-06-24)**: tournament-start-voice(開始ボイス選択)を**実装完了**。音タブに開始ボイス select(なし+女性4+男性4=9状態)新設、グローバル store `startVoice` 永続化、開始時(即時/PRE_START0着地 両方)に選択ボイスを1回再生し start.mp3 を置換(二重再生なし)。OFF は各経路で従来動作の厳密保存。audio.js の `_play`/`ensureAudioReady`/`playSound` 無改変(AudioContext resume・hall ガード継承)＝致命5件全件非接触。8ボイスmp3を追跡化。段階2 review 承認(致命0/警告0)。v271回帰14件。report `.cc-reports/2026-06-24_tournament-start-voice.md`。
- **次のアクション(最優先)**: 完了 review(cc-review ワークフロー)→ 前原6-B(音再生体感: report 7.1 ①〜④)+ **CREDITS ライセンス確定(8ボイスの出典/ライセンス・配信前必須)** → GO で **v2.6.4 配信**(version bump + CHANGELOG + docs/specs + merge `--no-ff` + tag + push + .exe + Release)。
- **参考**: 開始ボイス8ファイル(shuffle-up-and-deal-*)は本案件で追跡化・コミット済(従来未追跡を解消)。CREDITS.md はライセンス前原確認待ちプレースホルダ。**推測着手禁止**。

---

## 更新ルール(CC 向け)

完了報告(`.cc-reports/...md`)を書いたら **同じターンで** 本ファイルを Edit:
1. オープン STEP 表を更新 / 配信時はリリース履歴に **1行** 追加
2. 累積統計(テスト件数・リリース数)を更新
3. 「直近の状態」を最新スナップショット1つに更新

**★★ 肥大厳禁(CLAUDE.md「全プロジェクト共通・最優先ルール ②」と同一・2026-06-08 反省→2026-06-18 スリム化)**: 各行1〜2行。リリース履歴の各セルも1行要約+report pointer。実装詳細narrative・テスト内訳・検証ログの全文は書かない(`.cc-reports/`・`CHANGELOG.md`・memory に委ねる)。「直近の状態」は最新スナップショット1つだけ(過去セッションのログを積み増さない=これが再肥大の主因)。
