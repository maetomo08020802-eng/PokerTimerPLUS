# PROGRESS — poker-clock(PokerTimerPLUS+)

> 前原が一目で全体進捗を見る1枚ダッシュボード。各行は1〜2行に保ち、詳細は各 `.cc-reports/...md`・`CHANGELOG.md`・`.cc-archive/` に委ねる。
> バージョン単位のリリース進行型(タイマーアプリのフリー配布ソフト)。
> ⚠️ 表内パスは CC 用参照(チャットではタップ不可・コピーしてエディタで開く)。

**最終更新: 2026-07-08** — **remote-control Phase 1 全実装完了・📦配信準備完了**(feature/remote-control-phase1・未merge/未push)。1a(認証コア)+1b(トークン/SSE/confirm/卓名/QR)+1c(案内文言/CHANGELOG v2.8.0/配信手順/.exeビルド成功)。**あとは前原の6-B実機OK+最終GOで配信のみ**(main merge/tag/push/Release/spike除去/v2.8.0 bump)。テスト1589件全PASS・致命5件維持・追加ライブラリゼロ・CSP無改変。直前=v2.7.0配信。再開ポイントは末尾「## 直近の状態」。

---

## 🟡 現在のリリース作業 / オープン STEP

| 案件 | 状態 | 成果物 / 引継ぎ |
|------|------|--------|
| remote-control(スマホ遠隔操作・LANシンクライアント) Phase 1 | 📦 配信準備完了(1a/1b/1c 全実装完・cc-review2 1c待ち・**前原6-B+最終GOで配信**) | 1c `.cc-reports/2026-07-08_remote-control_phase1c-release-prep.md`(案内文言/CHANGELOG v2.8.0/配信手順roadmap§9/.exeビルド成功) / 配信手順=`docs/remote-control_roadmap.md` §9 / 前原確認=①版番v2.8.0 ②spike除去 ③〜⑥6-B実機 ⑦配信GO |
> 凡例: `📝 brief起案中` / `🤔 Plan中` / `🟢 実装中` / `🔵 レビュー待ち` / `🟡 実機確認待ち` / `📦 配信準備中`

---

## ✅ リリース履歴(新しい順・詳細は report / CHANGELOG.md)

| 配信日 | バージョン | 主要変更(1行) | report |
|--------|-----------|---------|--------|
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
| 配信済リリース | 16件(v1.0.0〜v2.7.0)|
| アーカイブ済案件 | 10件(`.cc-archive/`)|
| オープン作業 | 1件(remote-control Phase 1a・実装完了→cc-review2待ち)|
| 最新テスト件数 | 1589件 全PASS(既存1519 + remote-control 1a +35 + 1b +24 + 1b-qr +11) |
| 致命バグ保護 | 5件 完全維持(resetBlindProgressOnly / timerState destructure除外 / ensureEditorEditableState 4重防御 / AudioContext resume / runtime永続化8箇所)|

---

## 直近の状態(次セッション起点)

- **git**: `main` = v2.7.0 配信済(tag v2.7.0・Latest)。作業中ブランチ **`feature/remote-control-phase1`**(spike tip から分岐=src は v2.7.0 と diff 空で同一・roadmap/spike参照/PROGRESS継続を保持)。**main 未 merge・未 push**(1a は配信しない)。
- **直前作業(2026-07-08)**: remote-control **Phase 1a 本実装 完了**。①完全ローカル文言を LAN 例外込みに実改訂(CLAUDE.md INVARIANTS+禁止事項/specs.md §13+§13.1)②`src/remote/`(op-map 全17操作+DANGEROUS / server 認証7層 / discover / phone.html)昇格 ③main lifecycle(トグル default OFF・enabled時のみ起動・port自動リトライ・配線点① `remote:op` send・IPC getStatus/setEnabled・PIN=crypto.randomInt 6桁定数時間比較)④preload `remote` ブリッジ(既存 dual 無改変)⑤renderer 配線点②(operator-solo でも受信→dispatchClockShortcut のみ・既存 hall:forwarded-key 無改変)⑥設定に「スマホ操作」タブ+PIN/URL 表示(CSP 無改変)。**認証=PIN+Origin+Host厳格アンカー+Content-Type必須+レート制限+未知op破棄**(plan_review 追加条件: ACAO非返却テスト/サブドメイン偽装403テスト を実装済)。**Plan 軽量review(cc-kouchikushi2・フルフロー)承認・escalate不要判定**。npm test **1554件全PASS**(既存1519+新規35)。致命5件全件非接触・追加ライブラリゼロ。
- **1a 完了・1b Plan 承認済(2026-07-08 前原GO後)**: 1a=cc-review2 承認・懐疑役 懸念ゼロでクローズ。1b=brief起案(cc-kouchikushi2)→Plan書出→Plan軽量review 承認(**escalate不要**)。認証境界の核=SSEトークン渡しは**案A(EventSourceではなくfetch streaming+`Authorization: Bearer`=トークンをURLに出さない)**で解決確認済(案BのURLクエリより構造的に安全・CSRF三重ブロック・7層維持・致命⑤非接触)。
- **1b-core 実装完了(2026-07-08)**: server.js=共通ゲート抽出+トークン層(`/api/auth`発行256bit・`/api/op`/`/api/events`はAuthorizationヘッダ検証でPIN撤去・失効=OFF/PIN再生成/idle・**失効時は開いてるSSE即close**・失敗もレート制限)。SSE=**案A fetch streaming+Authorization**(トークンをURLに出さない)。main=状態の読み取り橋渡し(`_remoteState`/`remote:state` IPC・**store書込ゼロ**)。preload=`publishState`。renderer=`publishRemoteState`(`_remoteEnabled`ゲートでOFF時完全no-op・setRuntime非呼出)。phone.html=トークン取得+SSE表示+危険操作confirm+卓名。1a認証7層は無改変で上載せ。Plan review 実装時確認4点(共通ゲート抽出後1a35件全PASSで挙動不変証明/層7ロック3エンドポイント最前段/失効時SSE即close/events認可テスト)全充足。テスト1578件全PASS。
- **QRは1b-qrへ意図的分離**: vendored MIT単一ファイルをオフラインで確実に同梱できず自作は非スキャンリスク大のため切出(1aテキストURL稼働ゆえ接続は可能)。roadmap §4.5/specs §13.1明記。
- **1c 配信準備完了(2026-07-08)**: ①設定「スマホ操作」タブに FW/運用の折りたたみ案内(FW初回許可/同一Wi-Fi必須/APアイソレーション不可を正直明記/実験的)②CHANGELOG v2.8.0節(**完全ローカル→ON時のみLAN内通信・外部送信なしのポリシー改訂を利用者向けに明示告知**+従来動作不変)③配信手順書 roadmap §9(前原GO+6-B前提・spike除去step0・bump/tag/push/Release)④**.exeビルド CC自走で成功**(`npm run build:win` exit=0・NSISインストーラ生成・dist gitignore済非コミット)。CSP無改変・依存ゼロ・段階1スキップ運用。**version bumpとspike除去は配信時(前原GO)に回す=1cでは実施せず**。テスト1589件維持。
- **次のアクション**: **cc-review2(1c完了review)実行** report `.cc-reports/2026-07-08_remote-control_phase1c-release-prep.md`。承認後は **前原の6-B実機OK+最終GO待ち**→GOで roadmap §9 手順を一度だけ実行(spike除去→main merge→v2.8.0 bump→tag→push→署名ビルド→GitHub Release→Latest)=案件クローズ。前原確認=①版番v2.8.0 ②spike除去 ③〜⑥6-B(会場Wi-Fi/クリーンPC FW/APアイソレーション/QRスキャン・トークン接続・状態追従・失効) ⑦配信GO。CCの1c自走はここまで(配信操作は前原GO必須)。

---

## 更新ルール(CC 向け)

完了報告(`.cc-reports/...md`)を書いたら **同じターンで** 本ファイルを Edit:
1. オープン STEP 表を更新 / 配信時はリリース履歴に **1行** 追加
2. 累積統計(テスト件数・リリース数)を更新
3. 「直近の状態」を最新スナップショット1つに更新

**★★ 肥大厳禁(CLAUDE.md「全プロジェクト共通・最優先ルール ②」と同一・2026-06-08 反省→2026-06-18 スリム化)**: 各行1〜2行。リリース履歴の各セルも1行要約+report pointer。実装詳細narrative・テスト内訳・検証ログの全文は書かない(`.cc-reports/`・`CHANGELOG.md`・memory に委ねる)。「直近の状態」は最新スナップショット1つだけ(過去セッションのログを積み増さない=これが再肥大の主因)。
