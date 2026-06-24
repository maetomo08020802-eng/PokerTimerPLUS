# PROGRESS — poker-clock(PokerTimerPLUS+)

> 前原が一目で全体進捗を見る1枚ダッシュボード。各行は1〜2行に保ち、詳細は各 `.cc-reports/...md`・`CHANGELOG.md`・`.cc-archive/` に委ねる。
> バージョン単位のリリース進行型(タイマーアプリのフリー配布ソフト)。
> ⚠️ 表内パスは CC 用参照(チャットではタップ不可・コピーしてエディタで開く)。

**最終更新: 2026-06-24** — **v2.6.4 配信済(Latest 公開中・自動更新有効)**。tournament-start-voice=音タブで開始ボイス(なし+女性4+男性4=9)選択・グローバル永続化・開始時にstart.mp3置換(二重再生なし)。テスト1418件全PASS・オープン作業0件。再開ポイントは末尾「## 直近の状態」。

---

## 🟡 現在のリリース作業 / オープン STEP

| 案件 | 状態 | 成果物 / 引継ぎ |
|------|------|--------|
| telop-color-ux-simplify | 🟡 実機確認待ち（実装完了・GO 待ち） | テロップ色変えを「選択→色ボタン＋編集中プレビュー」方式に（記法手打ち不要・保存形式/安全パーサ無改変・旧データ互換）。v272 15件追加・1433件全PASS・致命5件非接触。feature ブランチに 1 コミット。配信は前原 GO 後（v2.6.5 想定）。`.cc-reports/2026-06-24_telop-color-ux-simplify.md` |
> 凡例: `📝 brief起案中` / `🤔 Plan中` / `🟢 実装中` / `🔵 レビュー待ち` / `🟡 実機確認待ち` / `📦 配信準備中`

---

## ✅ リリース履歴(新しい順・詳細は report / CHANGELOG.md)

| 配信日 | バージョン | 主要変更(1行) | report |
|--------|-----------|---------|--------|
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
| 軽微 | id `*-pool-rate`→`*-pot` リネーム / poolRates dormant除去 / 旧merge済ローカルブランチ整理 / settings軽微5件 | 別brief可・緊急性なし |

---

## 📊 累積統計

| 指標 | 値 |
|------|----|
| 配信済リリース | 13件(v1.0.0〜v2.6.4)|
| アーカイブ済案件 | 10件(`.cc-archive/`)|
| オープン作業 | 1件(telop-color-ux-simplify 実装完了・GO 待ち)|
| 最新テスト件数 | 1433件 全PASS(v272 +15) |
| 致命バグ保護 | 5件 完全維持(resetBlindProgressOnly / timerState destructure除外 / ensureEditorEditableState 4重防御 / AudioContext resume / runtime永続化8箇所)|

---

## 直近の状態(次セッション起点)

- **git**: `main` HEAD `0eb2690`・version 2.6.4・origin 同期済。telop-color-ux-simplify は **feature ブランチに 1 コミット(実装完了・未 merge)**。配信時は merge `--no-ff`+version bump(v2.6.5 想定)+tag/push/.exe/Release が前原 GO 後。直近配信 v2.6.4=merge `ee16648`/tag `v2.6.4`(Latest 公開中)。
- **直前作業(2026-06-24)**: telop-color-ux-simplify=**テロップ色変えを「文字を選択→色ボタン」方式に作り直し**(前原「手打ち記法が難しすぎる」→方式A 採用)。9 色スウォッチ+任意色 picker+「色を消す」+編集中インラインプレビューを設定タブ版/Ctrl+T ダイアログ版の 2 箇所に。記法 `[color]…[/color]` は内部で自動生成/除去(ネスト防止・後勝ち)。**保存フォーマット・marquee.js 安全パーサ(innerHTML 不使用・色ホワイトリスト)は無改変=export 追加のみ**で旧データ 100% 互換・XSS 後退ゼロ。致命5件全件非接触(入力 UI のみ)。v272 回帰15件・1433件全PASS・v269互換維持。Plan 段階2 review 承認(提案3点 self-fix 済)。report `.cc-reports/2026-06-24_telop-color-ux-simplify.md`。
- **次のアクション**: 完了 review(cc-review)→ 前原実機確認(6-B ①〜⑥)→ GO で配信(v2.6.5)。温存候補は下表。
- **参考**: 本日 v2.6.2→2.6.3→2.6.4 連続配信。本案件は v2.6.2 の手打ち記法 UX を改善。**推測着手禁止**。

---

## 更新ルール(CC 向け)

完了報告(`.cc-reports/...md`)を書いたら **同じターンで** 本ファイルを Edit:
1. オープン STEP 表を更新 / 配信時はリリース履歴に **1行** 追加
2. 累積統計(テスト件数・リリース数)を更新
3. 「直近の状態」を最新スナップショット1つに更新

**★★ 肥大厳禁(CLAUDE.md「全プロジェクト共通・最優先ルール ②」と同一・2026-06-08 反省→2026-06-18 スリム化)**: 各行1〜2行。リリース履歴の各セルも1行要約+report pointer。実装詳細narrative・テスト内訳・検証ログの全文は書かない(`.cc-reports/`・`CHANGELOG.md`・memory に委ねる)。「直近の状態」は最新スナップショット1つだけ(過去セッションのログを積み増さない=これが再肥大の主因)。
