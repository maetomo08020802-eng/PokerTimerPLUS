# HANDOVER.md — PokerTimerPLUS+ 作業引継ぎ書（v2.0.4-rc14 事前調査依頼済 / 2026-05-02）

> 本書は、新しい CC（Claude Code）エージェント および CC 構築士（Cowork mode 構築士）が現在の状況を即座に把握できるよう、作業履歴・確定事項・次のステップを集約したもの。
> 関連ファイル: `CLAUDE.md`、`docs/specs.md`、`skills/v2-dual-screen.md`、`skills/cc-operation-pitfalls.md`、`skills/root-cause-analysis.md`、`skills/electron-multi-monitor-pitfalls.md`、`CC_REPORT.md`、`NEXT_CC_PROMPT.md`。

---

## 🎯 TL;DR（新セッション開始時にここを最初に読む）

| 項目 | 状態 |
|---|---|
| **v1.3.0 配布** | ✅ 完了（GitHub Releases 公開済）|
| **v2.0.0〜v2.0.3** | ✅ main マージ済（PR #4 / #5 / #6 / #7）|
| **v2.0.4 試験版** | 🟡 **rc1〜rc13 完了、rc14 事前調査依頼済（CC 作業中 or 未着手）**|
| **GitHub repo** | <https://github.com/maetomo08020802-eng/PokerTimerPLUS> |
| **テスト数** | rc13 時点 491 件全 PASS（rc14 は調査のみで追加なし、rc15 で約 15〜20 件追加見込み）|
| **現在ブランチ** | `feature/v2.0.4-rc1-test-build`（rc7〜rc13 はすべて未コミット、rc14 事前調査も実装ゼロ）|
| **直近 .exe** | `dist/PokerTimerPLUS+ (Test) Setup 2.0.4-rc13.exe`（rc14 はビルドなし、rc15 で更新予定）|
| **致命バグ保護** | **5 件すべて維持**（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）|
| **累計致命級発見・修正** | **4 件**（hall 差分購読 / hall 逆書込 / PC 間データ移行 / **rc12 onRoleChanged window.appRole throw 握り潰し** - ES module strict mode + contextBridge 凍結の合わせ技）|

### 直近の確定事項（2026-05-02）

- **rc12 完璧根治**: rc6〜rc10 で 5 連続失敗していた「HDMI 抜きでタイマー画面消失」の真因を確定 → 根治。詳細は `feedback_rc12_truth.md`（構築士 memory）参照。
- **rc13 試験結果**:
  - ✅ トーナメント複製 readonly 修正 OK
  - ✅ ブレイク中 10 秒前 / 5 秒前カウント音 OK
  - ❌ **break-end（ブレイク終了音）が鳴らない**（パターン B 確定 = break-end 単独固有の真因、rc14 事前調査で確定予定）
- **追加依頼（rc15 で対応）**:
  - **依頼 A**: H ショートカット説明を AC 画面の操作一覧から **行ごと完全削除**（H キー機能は維持）
  - **依頼 B**: **5 分 rolling ログ機構**（rc11 計測ビルド相当の最大ログ、5 分超は自動上書き、約 1 MB 以下、容量負荷ほぼゼロ）→ バグ発見支援目的

### 新セッション最初のアクション

1. memory 全部読む（特に `feedback_rc12_truth.md`、`feedback_cc_pitfalls.md`、`feedback_design_judgement_v2.md`、`feedback_role_and_language.md`）
2. `CC_REPORT.md` を Read（rc14 事前調査結果が記載されているはず、未報告なら前原さんに「CC 作業終わった？」確認）
3. `NEXT_CC_PROMPT.md` を Read（rc14 事前調査依頼書）
4. 完了後: CC_REPORT 採点 → 前原さんに翻訳説明 → rc15 実装フェーズの NEXT_CC_PROMPT 作成

### 進行マップ（v2.0.4 final 完成まで）

| フェーズ | 状態 |
|---|---|
| ~~rc1〜rc11 試験~~ | 完了 |
| ~~rc12 タイマー画面消失根治~~ | 完了（前原さん「完璧」評価）|
| ~~rc13 実装（① 複製 + ② BREAK 中音）~~ | 完了 |
| ~~rc13 試験（パターン B 確定、依頼 A・B 追加）~~ | 完了 |
| **rc14 事前調査**（break-end 真因 + 5 分 rolling ログ設計 + H 行削除）| **進行中 or 未着手** |
| rc15 実装フェーズ | 待機 |
| rc15 試験（前原さん）| 待機 |
| **v2.0.4 final 本配布**（main マージ + GitHub Release タグ + .exe 公開）| 最終ゴール |

---

## 1. プロジェクト概要

- **製品名**: PokerTimerPLUS+
- **形態**: Electron 製 Windows/macOS デスクトップアプリ、完全ローカル動作
- **配布**: Yu Shitamachi（PLUS2 運営）制作、無料配布、全国のポーカールーム向け
- **戦略目的**: 「下町優」「PLUS2 ブランド」の全国認知拡大
- **配布先**: <https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases>
- **作者表記**: Yu Shitamachi（インストーラ発行元・About 画面）

---

## 2. v2.0.4-rc1〜rc7 の試験フェーズ進捗

### rc1: 試験版インストーラ初版
- v2.0.0〜v2.0.3 完成版 + appId / productName 分離（v1.3.0 と並列共存）
- 試験版用バージョン表記 `2.0.4-rc1`

### rc2: ホール側自動全画面化
- HDMI 接続時に hall window が自動で全画面化
- F11 を `getFocusedWindow` ベースに改修

### rc3: AC × 確認ダイアログ + 操作キー forward 初版
- AC × 押下時に「アプリ全体終了」確認ダイアログ追加
- hall フォーカス時の Space / R / Ctrl+E などを AC に forward する IPC 経路追加

### rc4: キーフォワード IPC 化
- rc3 の `sendInputEvent` 方式が Electron 31 で letter キーの `event.code` を空文字にする問題を解消
- IPC `hall:forwarded-key` で論理キーを直接送る方式に切替
- AC ペイン（フォーカス案内 + 運用情報 + 25 件操作一覧）追加
- 「写真」（body 背景画像）を operator role で消去

### rc5: M/H/F2/F12 整理 + テロップ表記 + 操作一覧再構成 + ミュート視覚
- KeyM / KeyH を forward 対象に追加
- F2 / F12 削除（実装無し / 開発者向け）
- 「マーキー」→「テロップ」表記変更
- 操作一覧 5 カテゴリに再構成
- ミュート視覚フィードバック（全 role 適用、🔇 ミュート中表示）

### rc6: HDMI 切替バグ 5 件統合修正
- AC 残存（HDMI 抜き → AC を minimize 化）
- 多重発火（display-added debounce + 再入ガード）
- F11 を hall 優先化
- ESC ハンドラ追加（hall 全画面解除）
- M/H 双方向同期

### rc7: 案 B（renderer 内 role 動的切替）+ Ctrl+E 補完 + H 文言明確化
- HDMI 切替時に main → renderer に IPC で role 変更通知
- AC ペインに「特別スタック」項目追加
- H 操作一覧文言を明確化

---

## 3. 🚨 rc7 試験で発覚した重大課題（2026-05-01）

前原さん rc7 試験で 5 症状が依然として残存:

| # | 症状 | 真因（CC rc8 事前調査で確定）|
|---|---|---|
| 1 | 左右矢印が hall フォーカス時に効かない | 実コード上は問題なし、Electron 31 系の謎挙動 |
| 4 | AC 復元時に設定タブが AC レイアウトで出る | **`[data-role="operator-solo"]` の CSS が 1 行も無かった**（v1.3.0 互換のため意図的に空欄）+ rc7 ハンドラで `updateOperatorPane` 呼出漏れ |
| 5 | Ctrl+E が AC 復元時に画面反映なし | 症状 #4 の連鎖（メイン画面が見えていない）|
| 6 | H 押すとテロップ縦幅変化 | 意図的設計（v1.3.0 STEP 6.7 で「ボトムバー消したらテロップ拡大」決定済）|
| 8 | 1 画面 H でも UI 出ない | 仕様通り。**H は「出すボタン」ではなく「消すボタン」**（前原さん期待と逆）|

### 前原さん本質要望

> 「会場モニターにフォーカスして使う操作は完全に無効にして、手元の AC にフォーカスしないと動かない方がわかりやすい」

→ rc8 で「方向 C（A: キーフォワード Set 空化 + B: hall window を focusable: false）」を採用。

---

## 4. v2.0.4-rc8 実装方針（前原さん追認 2026-05-01）

| 項目 | 方針 |
|---|---|
| キーフォワード処理 | **案 X**: `FORWARD_KEYS_FROM_HALL` を空 Set に（最小変更、IPC コード残置）|
| hall フォーカス制御 | **方向 B**: `hallWindow` を `focusable: false`（クリックしても AC にフォーカス残る）|
| 案 B 不発の対策 | **対策 A + B**: operator-solo 用 CSS 追加 + `onRoleChanged` で `updateOperatorPane` 呼出補完 |
| H キー | **案 H-1**: 文言明確化のみ（CSS 副作用は意図的設計のため維持）|

詳細は `NEXT_CC_PROMPT.md` 参照。修正規模: 約 50〜100 行 / 5〜7 ファイル。

---

## 5. 重要な不変条件（破ってはいけない、v2.0.0 でも継承）

### A. tournamentRuntime 保護（C.2.7-A 致命バグ 8-8 修正）
- `handleReset()`: 明示「タイマーリセット」ボタン経由のみ
- `resetBlindProgressOnly()`: ブラインド構造リセット専用、runtime 保護
- 回帰テスト: `tests/runtime-preservation.test.js`（6 件）

### B. timerState 上書き race の防御（C.2.7-D Fix 3）
- `tournaments:setDisplaySettings` payload から `timerState` destructure 除外
- 回帰テスト: `tests/race-fixes.test.js`（5 件）

### C. 入力中保護（fix9 確立）
- DOM 再構築時は必ず `isUserTypingInInput()` 統一ヘルパでガード

### D. 編集モード readonly 解除（C.1-A2 + C.1.2-bugfix + C.1.4-fix1 Fix 5）
- `_handleTournamentNewImpl` 末尾で `ensureEditorEditableState()` 呼出、RAF 内でも再保証
- `meta.builtin === true` 時は no-op

### E. AudioContext suspend 防御（C.1.7）
- `_play()` 冒頭で `audioContext.state === 'suspended'` 検出 → `resume()` fire-and-forget

### F. ランタイム永続化（C.1.8）
- `tournaments` スキーマに `runtime` フィールド追加 + `tournaments:setRuntime` IPC
- 8 箇所のミューテーション関数で `schedulePersistRuntime()` フック
- `resetBlindProgressOnly` には**意図的に永続化フックなし**

### G. PAUSED 3 択モーダル（C.2.7-B）
- リセット / 経過保持で適用 / 構造のみ適用（一時停止維持）の 3 ボタン

### H. レイアウトシフト 5 原則
- transform: scale 禁止、bottom-bar / marquee は flex column、カード幅 54vw / 46vw 固定、Barlow Condensed 700

### I. `<dialog>` flex 化禁止（feedback_dialog_no_flex）

### J. 表示踏襲問題の対策（rc8 で確立予定）
- HDMI 切替時 = AC は minimize（rc6 動作維持）+ role を動的切替（rc7 IPC 維持）
- **必須**: `[data-role="operator-solo"]` の CSS が空欄では機能しない（rc8 で追加必須）
- **必須**: role 切替時に `updateOperatorPane` も呼出（rc8 で追加）

### K. v1.3.0 STEP 6.7 の意図的設計（変更禁止）
- `body.bottom-bar-hidden { --marquee-height: 9vh; }` でテロップ拡大
- H 押下でボトムバー非表示 + テロップ拡大は意図的、削除しない

---

## 6. ファイル構成（v2.0.4-rc7 時点）

### コード
```
src/
├── main.js              # Electron main process（rc6 で _isSwitchingMode / debounce 等追加）
├── preload.js           # contextBridge + dual API（rc4-7 で IPC 経路拡張）
├── presets/             # 同梱プリセット 8 種
├── audio/               # 通知音 5 種
├── assets/              # フォント / アイコン
└── renderer/
    ├── index.html       # rc4 で operator-pane 追加、rc5 で 5 カテゴリ + mute-indicator、rc7 で特別スタック追加
    ├── style.css        # ~3800 行（rc4 で operator-pane scope、rc5 mute-indicator、rc7 role-changed CSS 追加）
    ├── renderer.js      # ~6500 行（rc4 で dispatchClockShortcut 関数化、rc7 で onRoleChanged ハンドラ）
    ├── timer.js / state.js / blinds.js / audio.js / marquee.js
    └── ...
```

### 配布物
```
dist/
├── PokerTimerPLUS+ Setup 1.3.0.exe                    # 本配布版（GitHub Releases 公開済）
├── PokerTimerPLUS+ (Test) Setup 2.0.4-rc1.exe〜rc7.exe # 試験版（前原さん試験用）
└── win-unpacked/                                       # ビルド作業用
```

### テスト（rc7 時点で全 PASS）
- 既存 138 件（v1.x〜v2.0.0）
- v2 系: window-race / stabilization / cleanup / coverage
- rc4-keyforward / rc4-operator-pane / rc5-mute-indicator / rc6-hdmi-state / rc7-role-switch

### ドキュメント
- `CLAUDE.md`: 運用ルール
- `docs/specs.md`: 機能仕様（rc4 で F1 削除、rc5 で F2 削除）
- `docs/v2-design.md`: v2.0.0 設計調査結果
- `docs/RELEASE_GUIDE.md`: 前原さん向けリリース手順書
- `skills/timer-logic.md`: v1.x 不変条件
- `skills/v2-dual-screen.md`: v2.0.0 品質基準
- `skills/cc-operation-pitfalls.md`: CC 運用ガイド
- `CHANGELOG.md`: Keep a Changelog 形式

---

## 7. CC 開発フロー（運用ルール、不変）

### 役割
- **オーナー**: Yu Shitamachi（PLUS2 運営）/ 前原さん（実機検証）
- **CC 構築士**: NEXT_CC_PROMPT.md を書き、CC_REPORT.md を読んで判断
- **CC**: NEXT_CC_PROMPT.md を読んで実装、CC_REPORT.md を書く

### 標準サイクル
```
構築士 → NEXT_CC_PROMPT.md 作成
       ↓
CC → /clear → 各種ドキュメント Read → 実装 → テスト → CC_REPORT.md
       ↓
構築士 → 採点 → 前原さんへ翻訳説明 → 次フェーズ判断
```

### スコープ管理（最重要）
- NEXT_CC_PROMPT.md 明示の Fix 項目以外は実装しない
- 発見した別問題は CC_REPORT「構築士への質問」に提案として記載のみ
- 致命級バグ発見時は CC_REPORT 冒頭に明示

### CC 運用ルール（feedback_cc_pitfalls 参照）
- 並列 sub-agent ≤ 3 体（公式 Agent Teams 推奨）
- 同じバグで 2 回修正試行する前に `/clear` 検討
- CLAUDE.md は 200 行以下、SKILL.md は 500 行以下
- **NEXT_CC_PROMPT 作成時は `skills/cc-operation-pitfalls.md §6` の禁止事項テンプレを必ず使用**（v2.0.4-rc8 以降）
- **モデル切替判断は `skills/cc-operation-pitfalls.md §7` の 5 行チェックリストに従う**（v2.0.4-rc8 以降）

---

## 8. 前原さんへの言葉遣い（feedback_role_and_language 参照）

- 専門用語禁止、初心者向け日本語
- 言い換え例:
  - 「リポジトリ」→「保管場所」
  - 「コミット」→「保存」
  - 「PAT」→「専用の鍵」
  - 「IPC」→「アプリ内のやりとり」
  - 「dead code」→「使われなくなる古いコード」
  - 「focusable: false」→「フォーカスを当てられない設定」

### 役割分担
- 前原さん: 目視確認のみ
- 構築士+CC: コード検証 / テスト / 設計 / 実装すべて担当

---

## 9. 構築士の判断ミス記録（rc6 / rc7、再発防止）

### rc6 判断ミス
- 「AC を最小化」と判断したが、**単画面用 CSS が 1 行も無いことを見落とした**
- 結果: minimize しても見た目が「2 画面用」のまま残る

### rc7 判断ミス
- 「役割を動的切替すれば CSS が自動追従」と判断したが、**operator-solo 用 CSS が空欄であることを見落とした**
- 加えて、`updateOperatorPane` 呼出漏れも見落とした
- 結果: 役割切替しても表示が変わらない

### 教訓（feedback_design_judgement_v2.md に記録）
- 設計判断の前に、関連 CSS / DOM の現状を実コードで確認
- 「自動で追従するはず」は危険、必ず実コード根拠で検証
- 案を立てたら CC に「事前調査」させて根拠を集めてから実装に進む

---

## 10. 配布関連

### v1.3.0 配布
- ✅ git push 済、GitHub Releases で `.exe` 公開済
- ✅ 自動更新マニフェスト `latest.yml` 添付済

### v2.0.4 配布判断
- 試験版 rc1〜rc7 完了、rc8 実装中
- rc8 で前原さん試験 OK → main マージ → タグ作成 → 本配布ビルド
- v2.0.4 配布時には v1.3.0 を v2.0.4 で置き換える形で再配布
- HDMI 環境ある店 = 自動 2 画面 / HDMI なし店 = 自動単画面（v1.3.0 互換 + 改善）

---

## 11. git ブランチ・コミット状態

### ブランチ
- `main`（v1.3.0 + v2.0.0〜2.0.3 マージ済）
- `feature/v2.0.4-rc1-test-build`（rc1〜rc7 連続コミット、rc8 進行予定）

### push 状態
- main は GitHub に push 済
- `feature/v2.0.4-rc1-test-build` は **ローカルのみ、push なし**

---

## 12. 連絡・参照ポイント

- 仕様書: `docs/specs.md`
- v1.x 不変条件: `skills/timer-logic.md`「STEP 10 不変条件」
- v2.0.0 品質基準: `skills/v2-dual-screen.md`
- v2 設計調査: `docs/v2-design.md`
- CC 運用ガイド: `skills/cc-operation-pitfalls.md`
- 真因調査の標準手順: `skills/root-cause-analysis.md`（事前調査フェーズで必読）
- Electron 2 モニター / HDMI 抜き差しの罠: `skills/electron-multi-monitor-pitfalls.md`（HDMI / multi-monitor 系問題で必読、rc11 計測フェーズの計測スクリプト含む）
- 直近完了タスク: `CC_REPORT.md`
- 次タスク指示: `NEXT_CC_PROMPT.md`
- リリース履歴: `CHANGELOG.md`
- リリース手順: `docs/RELEASE_GUIDE.md`
- ライセンス: `CREDITS.md` + `src/audio/CREDITS.md` + `src/assets/fonts/licenses/`
- ブランディング: `skills/branding.md`

---

**最終更新**: 2026-05-01（rc8 実装指示書作成済、CC 作業未着手）
**最新 .exe**: rc7（rc8 で更新予定）
**致命バグ保護**: 5 件すべて維持
**次のアクション**: CC `/clear` → rc8 実装 → 構築士採点 → 前原さん rc8 試験
