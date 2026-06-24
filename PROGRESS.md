# PROGRESS — poker-clock(PokerTimerPLUS+)

> 前原が一目で全体進捗を見る1枚ダッシュボード。各行は1〜2行に保ち、詳細は各 `.cc-reports/...md`・`CHANGELOG.md`・`.cc-archive/` に委ねる。
> バージョン単位のリリース進行型(タイマーアプリのフリー配布ソフト)。
> ⚠️ 表内パスは CC 用参照(チャットではタップ不可・コピーしてエディタで開く)。

**最終更新: 2026-06-24** — **v2.6.2 配信済(Latest 公開中)**。telop-dualscreen-ideas ①Tトグル ③テロップ部分色変え(②時差は温存)・オープン作業0件。再開ポイントは末尾「## 直近の状態」。

---

## 🟡 現在のリリース作業 / オープン STEP

| 案件 | 状態 | 成果物 / 引継ぎ |
|------|------|--------|
| ②2画面時差(dualscreen-latency・案A) | 📦 実装待ち(調査+案A設計+段階2review+影響網羅監査すべて完了・前原GO済方向→新セッションで実装) | brief `.cc-briefs/2026-06-24_dualscreen-latency_brief.md` / plan `.cc-plans/2026-06-24_dualscreen-latency_investigation.md` / review `.cc-briefs/2026-06-24_dualscreen-latency_review.md` |
> 凡例: `📝 brief起案中` / `🤔 Plan中` / `🟢 実装中` / `🔵 レビュー待ち` / `🟡 実機確認待ち` / `📦 配信準備中`
> ★引継ぎ(2026-06-24): ② は調査・案A設計・段階2 review・影響網羅監査(反証4レンズ全て副作用なし)まで完了。**新セッションは上記 brief を読んで即実装着手**(再 Plan/再 review 不要・完了 review のみ)。実装=renderer.js に `persistTimerStateNow()` 新設＋subscribe 遷移分岐(`isTransition && !involvesPreStart` で即時送信／他は従来500ms debounce)。timer.js/main.js/dual-sync.js 無改変。v2.6.3 配信。memory `[[dualsync-frequency]]` 参照。

---

## ✅ リリース履歴(新しい順・詳細は report / CHANGELOG.md)

| 配信日 | バージョン | 主要変更(1行) | report |
|--------|-----------|---------|--------|
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
| ②2画面時差 | telop-dualscreen-ideas ②(operator→hall 状態遷移の最大500ms debounce 短縮)| 前原方向GO待ち。案A=遷移時のみ即時flush(値変化は据置)。PRE_START近接でPlan+段階2review+`isPreStartActive()`ガード必須。investigation/report 8-1 参照 |
| v2.3.0 | PRE_START 永続化(`feature/v2.3.0-prestart-persistence`)| 温存・再開は前原判断。再開時は復元経路に RUNNING/BREAK stale-restore ガード要評価 |
| 軽微 | id `*-pool-rate`→`*-pot` リネーム / poolRates dormant除去 / 旧merge済ローカルブランチ整理 / settings軽微5件 | 別brief可・緊急性なし |

---

## 📊 累積統計

| 指標 | 値 |
|------|----|
| 配信済リリース | 11件(v1.0.0〜v2.6.2)|
| アーカイブ済案件 | 10件(`.cc-archive/`)|
| オープン作業 | 0件(安定運用フェーズ・②2画面時差は温存)|
| 最新テスト件数 | 1380件 全PASS(v269 +12) |
| 致命バグ保護 | 5件 完全維持(resetBlindProgressOnly / timerState destructure除外 / ensureEditorEditableState 4重防御 / AudioContext resume / runtime永続化8箇所)|

---

## 直近の状態(次セッション起点)

- **git**: `main`・version 2.6.2・テスト1380件全PASS。merge `f019f14`(`--no-ff`)・tag `v2.6.2`。
- **直前作業(2026-06-24)**: telop-dualscreen-ideas を調査(3項目)→ ①③を **v2.6.2 として配信**(前原「配信までGO」)。①単独Tでテロップ表示/非表示トグル(永続化＋hall同期)②(保留)③本文の部分色変え`[color]…[/color]`(marquee.jsにrenderMarqueeContentパーサ・innerHTML不使用でXSS構造防御・スキーマ/hall同期/migration無改修)。回帰テストv269 12件。致命バグ保護5件 全件影響なし。
- **次のアクション（最優先・引継ぎ）**: ② dualscreen-latency 実装。前原が /clear 後に新セッションで着手。**`.cc-briefs/2026-06-24_dualscreen-latency_brief.md` を読む → plan(`.cc-plans/2026-06-24_dualscreen-latency_investigation.md` §4実装/§7テスト)通りに実装 → 既存1380件PASS維持 + v270回帰テスト(PRE_START0着地非発火を直接テスト) → 完了report → cc-review 完了review → 前原GOで v2.6.3 配信**。調査/案A設計/段階2review/影響網羅監査は完了済=再Plan・再review不要。実装は renderer.js のみ(timer.js/main.js/dual-sync.js 無改変)。`[[dualsync-frequency]]`。
- **参考**: 前原実機確認(v2.6.2 report 7.1: ①Tトグル ③部分色変え)は配信版で随時。`src/audio/shuffle-up-and-deal-*.mp3` 8件は前原の将来機能(開始同時音声)用に未追跡温存。**推測着手禁止**。

---

## 更新ルール(CC 向け)

完了報告(`.cc-reports/...md`)を書いたら **同じターンで** 本ファイルを Edit:
1. オープン STEP 表を更新 / 配信時はリリース履歴に **1行** 追加
2. 累積統計(テスト件数・リリース数)を更新
3. 「直近の状態」を最新スナップショット1つに更新

**★★ 肥大厳禁(CLAUDE.md「全プロジェクト共通・最優先ルール ②」と同一・2026-06-08 反省→2026-06-18 スリム化)**: 各行1〜2行。リリース履歴の各セルも1行要約+report pointer。実装詳細narrative・テスト内訳・検証ログの全文は書かない(`.cc-reports/`・`CHANGELOG.md`・memory に委ねる)。「直近の状態」は最新スナップショット1つだけ(過去セッションのログを積み増さない=これが再肥大の主因)。
