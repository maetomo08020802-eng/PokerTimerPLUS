# HANDOVER.md — PokerTimerPLUS+ 作業引継ぎ書（v1.3.0 配布完了 + v2.0.0 STEP 1 完了時点）

> 本書は、新しい CC（Claude Code）エージェントおよび **CC 構築士（Cowork mode 構築士）** が現在の状況を即座に把握できるよう、これまでの作業履歴・確定事項・次のステップを集約したものです。
> 関連ファイル: `CLAUDE.md`（運用ルール + v2.0.0 セクション）、`docs/specs.md`（機能仕様）、`skills/timer-logic.md`（v1.x 不変条件）、`skills/v2-dual-screen.md`（v2.0.0 品質基準）、`docs/v2-design.md`（v2 設計調査結果）、`CHANGELOG.md`、`CC_REPORT.md`、`docs/RELEASE_GUIDE.md`（前原さん向けリリース手順）。

---

## 🎯 TL;DR（新セッション開始時にここを最初に読む）

| 項目 | 状態 |
| --- | --- |
| **v1.3.0 配布** | ✅ 完了。GitHub Releases で `.exe` 公開済（2026-04-30 / 05-01）|
| **GitHub repo** | <https://github.com/maetomo08020802-eng/PokerTimerPLUS> |
| **テスト数** | **138 件全 PASS**（15 ファイル）|
| **現在ブランチ** | `feature/v2.0.0`（v2 作業中、`main` は v1.3.0 配布版として不変）|
| **直近フェーズ** | v2.0.0 STEP 1 完了（commit `4951f9d`、push 済）|
| **次のステップ** | v2.0.0 STEP 2（2 画面間の状態同期）— **承認①対象** |
| **致命バグ保護** | 5 件すべて維持（C.2.7-A / C.2.7-D / C.1-A2 系 / C.1.7 / C.1.8）|
| **配布判定** | v1.3.0 配布クオリティ達成（C.1.5 で致命 0 / 高 0 確認）|

---

## 1. プロジェクト概要

- **製品名**: PokerTimerPLUS+
- **形態**: Electron 製 Windows/macOS デスクトップアプリ、完全ローカル動作
- **配布**: Yu Shitamachi（PLUS2 運営）制作の無料配布、全国のポーカールーム向け
- **配布先**: <https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases>
- **owner**: `maetomo08020802-eng`（GitHub）
- **作者表記**: Yu Shitamachi（インストーラ発行元・About 画面）
- **CSP**: `'self'` のみ（CDN 不使用、フォント・画像はすべて同梱、不変条件）
- **ライセンス**: アプリは UNLICENSED（無料配布）、フォント類は SIL OFL 1.1、効果音は効果音ラボ商用無料
- **現在 version**: **1.3.0**（次は v2.0.0、STEP 7 完了で bump 予定）
- **総テスト数**: **138 件**（15 ファイル）すべて静的解析ベース、`npm test` で 1 コマンド実行

---

## 2. 現在の機能セット（v1.3.0、v2 着手前）

### コア機能
- ブラインドタイマー（カウントダウン + レベル進行 + ブレイク）
- 14 ゲーム種、5 構造型、同梱プリセット 8 種
- 通知音 5 種類 + 音量・個別 ON/OFF
- スタートカウントダウン
- プレイヤー / 賞金管理（バイイン / リエントリー / アドオン / 特別スタック）+ **ランタイム永続化（C.1.8）**
- 設定永続化（electron-store）
- PC 間データ移行（JSON Export/Import）
- 複数トーナメントの並行進行
- 背景プリセット 8 種 + **9 種類目「カスタム画像」**（C.1.3）+ 数字フォント切替

### v1.3.0 リリース版で追加済の主要機能
- **背景画像（C.1.3）**: PNG/JPEG/WebP、5MB 以下、暗くする overlay 強度 3 段階
- **休憩中スライドショー + PIP タイマー（C.1.4 系）**: 最大 20 枚、切替間隔 3〜60 秒、PIP サイズ 3 段階。BREAK 開始 30 秒遅延、再開 1 分前に自動復帰、初回フェードイン
- **設定ダイアログ縦リサイズ追従（C.1.6）**: form-dialog__shell wrapper で flex column 化（`<dialog>` 自体は flex 化しない不変条件遵守）
- **NEXT BREAK IN ↔ TOTAL GAME TIME 自動切替（C.1.6）**: 残ブレイクなしで累積時間表示
- **AudioContext suspend 防御（C.1.7）**: PAUSED 復帰後の音欠落バグ修正
- **ランタイム永続化（C.1.8）**: アプリ終了 → 再起動でプレイヤー人数 / リエントリー / アドオンが消失する重大バグ修正
- **自動更新準備**: electron-updater 統合済（GitHub Releases から自動取得、v1.3.1 以降で動作）
- **DONE 状態 'finished'**: 全レベル完走で「トーナメント終了」緑系オーバーレイ表示
- **Ctrl+Q 状態別メッセージ**: タイマー進行中なら警告

---

## 3. 配布完了後 → 現在までのフェーズ履歴（v1.3.0 配布判定後）

| フェーズ | 主成果 | 結果 |
| --- | --- | --- |
| **v2.0.0 STEP 1**（最新）| ホール側ウィンドウ追加（最小骨格）+ ブランチ運用導入 | feature/v2.0.0 ブランチ作成、commit `4951f9d` push 済 |
| **v2.0.0 STEP 0** | 設計調査（コード変更ゼロ）| `docs/v2-design.md` 作成、`scripts/_probes/v2-probe.js` 動作確認 |
| **C.3-B** | 配布リポから不要ファイル除外（push 前クリーンアップ）| `docs/slides_artifacts/` + `.claude/settings.local.json` 除外、commit `57298f4` |
| **C.3-A** | 配布準備（GitHub リポジトリ初回プッシュ + ビルド検証）| 138 テスト PASS、`dist/PokerTimerPLUS+ Setup 1.3.0.exe` 80MB 生成、git init + 2 コミット、`docs/RELEASE_GUIDE.md` 作成 |
| **C.1.5** | 配布前 最終品質確認（実装ゼロ、検証のみ）| 4 並列 Agent で 10 カテゴリ検証 → 致命 0 / 高 0 / 中 1 / 低 12、配布クオリティ達成判定 |
| **C.1.8** | 重大バグ: トーナメント途中の再起動でランタイム消失 | runtime 永続化（main schema 追加 + `tournaments:setRuntime` IPC + 8 箇所フック）、新規 6 テスト |
| **C.1.7** | 音まわり調査 + バグ修正（PAUSED 復帰後の音欠落）| AudioContext suspend を真因特定、`_play()` 冒頭で resume 防御、新規 6 テスト |
| **C.1.6** | 設定ダイアログ中身追従 + TOTAL GAME TIME 切替 | form-dialog__shell wrapper 化、`computeTotalGameTimeMs` 新規、新規 8 テスト |
| **C.1.4-fix3** | フォント拡大 + 注意書き + 画像サイズ警告 | level-display 5.8vw / stat-value 4.55vw / 150MB 警告 + ⚠ アイコン、新規 6 テスト |
| **C.1.4-fix2** | スライドショー 30 秒遅延 + 初回フェードイン | breakStartedAt 状態管理、新規 4 テスト |
| **C.1.4-fix1** | 背景画像 / スライドショー実機修正 5 件 | bottom-bar overlay 保護 / warning-1min 復活 / autoEndedAt リセット / PIP ボタン左下 / readonly RAF 再呼出、新規 5 テスト |
| **C.1.4** | 休憩中スライドショー + PIP タイマー（大規模新機能）| breakImages / pipSize / 切替ボタン / 60 秒自動復帰、新規 12 テスト |
| **C.1.3-fix1** | 背景画像実機修正 3 件 | preview 16:9、_userBgChoice 初回反映、設定ダイアログ flex（rollback 後に C.1.6 で wrapper 化）、新規 3 テスト |
| **C.1.3** | 背景にカスタム画像（9 種類目）| breakgroundImage / Overlay sanitize、新規 12 テスト |
| **C.1.2-followup** | 自動更新の publish 設定を保留（後に C.3-A で再有効化）| package.json publish 削除、`hasPublishConfig` ガード |
| **C.1.2** | v1.3.0 仕上げ（5 件）| Ctrl+Q 状態別 / DONE 'finished' / electron-updater / DevTools 注記 / version bump、新規 12 テスト |

---

## 4. 重要な不変条件（破ってはいけない、v2.0.0 でも継承）

### A. tournamentRuntime 保護（C.2.7-A 致命バグ 8-8 修正）
- 「ブラインド構造を変えても tournamentRuntime（プレイヤー人数 / リエントリー / アドオン / バイイン）は**絶対に消えない**」
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
- `meta.builtin === true` 時は no-op（builtin 保護内蔵化）
- 回帰テスト: `tests/editable-state.test.js`（7 件）+ `tests/new-tournament-edit.test.js`（8 件）

### E. AudioContext suspend 防御（C.1.7）
- `_play()` 冒頭で `audioContext.state === 'suspended'` 検出 → `resume()` fire-and-forget
- 全音発火パス（warning-1min / -10sec / countdown-tick / level-end / break-end / start）で防御
- 回帰テスト: `tests/c17-audio-resume.test.js`（6 件）

### F. ランタイム永続化（C.1.8）
- `tournaments` スキーマに `runtime` フィールド追加 + `tournaments:setRuntime` IPC
- 8 箇所のミューテーション関数で `schedulePersistRuntime()` フック
- `resetBlindProgressOnly` には**意図的に永続化フックなし**（runtime に触らない設計を維持）
- 回帰テスト: `tests/c18-runtime-persistence.test.js`（6 件）

### G. PAUSED 3 択モーダル（C.2.7-B）
- リセット / 経過保持で適用 / 構造のみ適用（一時停止維持）の 3 ボタン

### H. レイアウトシフト 5 原則
- transform: scale 禁止、bottom-bar / marquee は flex column、カード幅 54vw / 46vw 固定、Barlow Condensed 700

### I. `<dialog>` flex 化禁止
- `feedback_dialog_no_flex`（C.1.3-fix1-rollback 教訓）
- 設定ダイアログは内側 `.form-dialog__shell` wrapper を flex 化（C.1.6）

---

## 5. ファイル構成

### コード（v1.3.0 + v2 STEP 1）
```
src/
├── main.js              # Electron main process（v2.0.0 STEP 1: createOperatorWindow / createHallWindow 分離）
├── preload.js           # contextBridge + role 抽出（v2.0.0 STEP 1）
├── presets/             # 同梱プリセット 8 種 (.json)
├── audio/               # 通知音 5 種 (.mp3) + CREDITS.md
├── assets/
│   ├── fonts/           # 同梱フォント 7 種 + licenses/
│   └── logo-*.svg
└── renderer/
    ├── index.html
    ├── style.css        # ~3700 行（v2 STEP 1: [data-role] バッジ追加）
    ├── renderer.js      # ~6100 行（v1.3.0、v2 STEP 3 で役割ガード追加予定）
    ├── timer.js         # 334 行
    ├── state.js         # 67 行（v2 で同期基盤として流用）
    ├── blinds.js        # 174 行
    ├── audio.js         # 546 行（C.1.7 修正済）
    └── marquee.js       # 108 行
```

### v2.0.0 関連ファイル
```
docs/v2-design.md            # STEP 0 設計調査結果（§1〜§7）
scripts/_probes/v2-probe.js  # 2 ウィンドウ動作検証用（配布物除外、削除しない）
skills/v2-dual-screen.md     # v2 品質基準（§1 アーキ / §2 同期精度 / §3 HDMI / §5 禁止事項）
```

### ビルド・配布
```
build/
├── generate-icon.js     # SVG → PNG/ICO 生成
├── icon-source.svg      # 黒背景 + 白「20:40」7-segment
├── icon.png             # 512x512
└── icon.ico             # マルチサイズ

dist/                    # gitignore（ビルド成果物）
├── PokerTimerPLUS+ Setup 1.3.0.exe   # 80MB、v1.3.0 配布版
├── PokerTimerPLUS+ Setup 1.3.0.exe.blockmap
└── latest.yml           # 自動更新マニフェスト

package.json             # version: 1.3.0 / build.publish: github / build.files に !scripts/**/*
```

### テスト（15 ファイル、合計 138 件）
| ファイル | 件数 | 用途 |
| --- | --- | --- |
| `tests/data-transfer.test.js` | 7 | PC 間データ移行 |
| `tests/runtime-preservation.test.js` | 6 | **致命バグ 8-8 リグレッション防止** |
| `tests/audit-fix.test.js` | 9 | UI 監査修正 |
| `tests/paused-flow.test.js` | 9 | PAUSED 3 択モーダル |
| `tests/race-fixes.test.js` | 5 | timerState race（C.2.7-D）|
| `tests/light-todos.test.js` | 4 | preset name sanitize 等 |
| `tests/editable-state.test.js` | 7 | ensureEditorEditableState |
| `tests/audit-residuals.test.js` | 8 | switching ガード等 |
| `tests/new-tournament-edit.test.js` | 8 | 新規 readonly 残存対策 |
| `tests/v130-features.test.js` | 12 | v1.3.0 機能 |
| `tests/c13-bg-image.test.js` | 19 | 背景画像 + フォント拡大 |
| `tests/c14-slideshow.test.js` | 24 | スライドショー + PIP + 注意書き + サイズ警告 |
| `tests/c16-features.test.js` | 8 | 設定ダイアログ wrapper + TOTAL GAME TIME |
| `tests/c17-audio-resume.test.js` | 6 | AudioContext suspend 防御 |
| `tests/c18-runtime-persistence.test.js` | 6 | runtime 永続化 |

実行: `npm test`（順次、すべて静的解析、Electron 起動なし）

### ドキュメント
- `CLAUDE.md`: 運用ルール + v2.0.0 セクション
- `docs/specs.md`: 機能仕様書
- `docs/v2-design.md`: v2.0.0 設計調査結果（STEP 0）
- `docs/RELEASE_GUIDE.md`: 前原さん向けリリース手順書（PAT 発行 / push / Releases 公開 / トラブルシューティング）
- `skills/timer-logic.md`: タイマー実装品質基準 + 6 不変条件
- `skills/v2-dual-screen.md`: v2.0.0 品質基準
- `skills/ui-tokens.md` / `ui-layout.md` / `ui-components.md` / `ui-states.md` / `branding.md` / `audio-system.md`
- `CHANGELOG.md`: Keep a Changelog 形式、v1.3.0 / v1.2.0 / v1.1.0 / v1.0.0
- `CREDITS.md`: フォント・音声ライセンス
- `CC_REPORT.md`: 直近完了タスクの報告（毎フェーズ上書き）
- `NEXT_CC_PROMPT.md`: 次フェーズの指示書（構築士が用意）
- `PIPELINE.md`: 開発パイプライン

---

## 6. CC 開発フロー（運用ルール、不変）

### 役割
- **オーナー**: Yu Shitamachi（PLUS2 運営）/ 前原さん（実機検証）
- **CC 構築士**: NEXT_CC_PROMPT.md を書き、CC_REPORT.md を読んで判断
- **CC（このエージェント）**: NEXT_CC_PROMPT.md を読んで実装、CC_REPORT.md を書く

### 標準サイクル
```
構築士 → NEXT_CC_PROMPT.md 作成
       ↓
CC → 読む → 実装 → テスト → CC_REPORT.md 作成
       ↓
構築士 → 採点 + 次フェーズ判断
```

### 標準制約（毎回適用、明記不要）
- skills/ui-design.md は廃止、参照禁止
- レイアウトシフト撲滅 5 原則維持
- 既存実装を破壊しない
- transform: scale 禁止
- branding.md §15 ブランディング保護
- `<dialog>` に display: flex 禁止
- 致命バグ保護 5 件すべて維持

### スコープ管理（最重要）
- **NEXT_CC_PROMPT.md に明示された Fix 項目以外は実装しない**
- 調査中に発見した別問題は **CC_REPORT.md「構築士への質問」に提案として記載のみ**
- 致命級バグ発見時は CC_REPORT 冒頭に明示し構築士判断を仰ぐ（自動修正禁止）

---

## 7. v2.0.0 進行状況

### v2.0.0 概要
- 既存 v1.3.0 を**全機能維持**したまま、HDMI 拡張モニターでの 2 画面表示に対応
- ホール側モニター（お客向け）: タイマー / スライドショー等、現状の見た目すべて
- PC 側（前原さん操作）: 操作 UI のみ
- HDMI 抜き差しに自動追従、起動時にホール側モニターを毎回手動選択
- 配布タイミング: 「完璧に動くまで配布しない」（前原さん指示、急がない）

### v2.0.0 STEP 順序
- ✅ **STEP 0**: 設計調査（コード変更ゼロ）→ 完了
- ✅ **STEP 1**: ホール側ウィンドウ追加（最小骨格）→ 完了、commit `4951f9d` 済
- ⏳ **STEP 2**: 2 画面間の状態同期【承認①】← **次のステップ**
- STEP 3: PC 側 UI の分離（操作専用、ホール側は表示専用）
- STEP 4: 起動時のモニター選択ダイアログ
- STEP 5: HDMI 抜き差し追従【承認②】
- STEP 6: 既存 138 テスト維持 + v2 専用テスト追加
- STEP 7: 最終検証 + ドキュメント更新 + version 2.0.0【承認③】

### v2.0.0 不変条件（既存 v1.3.0 不変条件に追加）
- **既存 138 テスト全 PASS 維持**: v2 実装中に 1 件でも壊れたら即停止
- **致命バグ保護を全て継承**
- **単画面モード後方互換**: HDMI なし PC で v1.3.0 と完全同等動作
- **画面間データ通信は最小化**: 状態同期は差分のみ、ポーリング禁止
- **ホール側にお客様視点で不要な UI を出さない**

### STEP 1 で確立した役割識別の仕組み（STEP 2 以降で利用）
- `BrowserWindow.webPreferences.additionalArguments: ['--role=...']` で role 渡し
- 値は `operator-solo`（単画面）/ `operator`（PC 側）/ `hall`（ホール側）
- preload.js が `process.argv` から抽出 → `documentElement` に `data-role` 属性付与
- renderer 側で `window.appRole` から参照可能（read-only）
- CSS `[data-role="..."]` セレクタで表示制御（STEP 1 ではバッジのみ）

### STEP 0 で特定された v2 リスク（STEP 2 以降で対処）
1. **【高】renderer.js 6100 行の役割分離が機械的に困難** → 役割フラグでイベントリスナ登録 skip 方式
2. **【中】ホール側 ↔ PC 側の同期遅延** → ホール側ローカル時刻計算、main からは「基準時刻 + 状態フラグ」のみ送信
3. **【中】HDMI 抜き差し時の AudioContext suspend / resume** → `_play()` 内 resume 防御で自動対応の見込み
4. **【低】Windows 環境では `display.label` が空** → fallback ラベル生成
5. **【低】data-role 注入タイミング** → `additionalArguments` 経由で対応済（STEP 1）

---

## 8. 配布関連の現状

### v1.3.0 配布
- ✅ git push 済、リモートに `main` ブランチあり
- ✅ GitHub Releases で `.exe` 公開済
- ✅ 自動更新マニフェスト `latest.yml` 添付済
- ✅ 全国のポーカールームに案内可能

### `.gitignore` で除外済（配布リポに含まない）
- `node_modules/`, `dist/`, `out/`
- `*token.json`, `*credentials.json`, `__pycache__/`, `*.pyc`
- `docs/slides_artifacts/`（PLUS2 月次レポート関係、C.3-B で除外）
- `.claude/settings.local.json`（C.3-B で除外）

### 自動更新
- electron-updater 統合済、`build.publish` に GitHub provider + owner/repo 設定済
- v1.3.1 以降の Release 公開で既存ユーザーに自動通知 → ダウンロード → 再起動確認
- 詳細手順: `docs/RELEASE_GUIDE.md`

---

## 9. 既知の TODO / 残課題

### 9-1. C.1.5 配布前審査の中・低優先度（次マイナー版で段階対応）
- フォント拡大の調整余地（`stat-value--md` / `--xl` の比率）
- ⚠ アイコン配置位置（チップ未選択時の可視性）
- 画像エラー時の i18n（現在英語のみ）
- console.log 整理（54 箇所、`if (isDev)` で wrap 候補）
- README に SmartScreen 警告対応手順
- audio.js のデバッグ log 削除（TODO STEP 8 仕上げ）

### 9-2. v1.3.0 マイグレーション
- v1.3.0 → v1.3.1 アップグレード時、過去のランタイムデータは復旧不可（旧バージョン時点で永続化されていなかったため）
- 最初のトーナメント開始時に通常通り人数入力 → 以降は永続化される
- CHANGELOG への記載が必要であれば追記推奨

### 9-3. 設定ダイアログの widening
- C.1.6 で wrapper 化により縦リサイズ追従。実機で 7 タブすべての挙動確認は前原さん側で要確認

### 9-4. v2 開発中に出るべき新規問題
- AudioContext suspend / resume の HDMI 抜き差し対応（STEP 5 で要確認）
- ホール側 / PC 側の同期遅延（v2-dual-screen.md §2.1: ±100ms 以内）
- モニター選択ダイアログでの label 空対応（STEP 4）

---

## 10. CC へのアドバイス（次のエージェント向け）

1. **NEXT_CC_PROMPT.md が来たらまず一気に読む**。スコープ制限を厳格に守る
2. **v2.0.0 中はすべて `feature/v2.0.0` ブランチで作業**。`main` には触らない
3. **既存 138 テストが壊れていないか毎回確認**。`npm test` で 1 件でも FAIL したら即停止
4. **致命バグ保護 5 件**: 触らないのが原則。触る必要があれば事前に CC_REPORT で警告
5. **CC_REPORT.md は構築士採点用**、技術詳細 OK、末尾にオーナー向け平易確認 3〜5 項目
6. **CC は「実行する存在」**、設計判断は構築士の役割。判断に迷うことは構築士に質問
7. **`<dialog>` 要素自体に display: flex を絶対に当てない**（feedback_dialog_no_flex 不可侵）
8. **v2.0.0 各 STEP で「この致命バグ保護への影響なし」を確認してから次へ進む**

---

## 11. 連絡・参照ポイント

- 仕様書: `docs/specs.md`
- v1.x 不変条件: `skills/timer-logic.md`「STEP 10 不変条件」セクション
- v2.0.0 品質基準: `skills/v2-dual-screen.md`
- v2 設計調査: `docs/v2-design.md`
- 直近完了タスク: `CC_REPORT.md`（毎フェーズ上書き）
- 次タスク指示: `NEXT_CC_PROMPT.md`（構築士が更新）
- リリース履歴: `CHANGELOG.md`
- リリース手順: `docs/RELEASE_GUIDE.md`
- ライセンス情報: `CREDITS.md` + `src/audio/CREDITS.md` + `src/assets/fonts/licenses/`
- ブランディング: `skills/branding.md`

---

## 12. git ブランチ・コミット状態（2026-05-01 時点）

### ブランチ
- `main`（v1.3.0 配布版、不変）
- `feature/v2.0.0`（v2 作業中、現在のブランチ）

### `feature/v2.0.0` の最新コミット
```
4951f9d v2.0.0 STEP 1: ホール側ウィンドウ追加（最小骨格）
57298f4 Remove non-distribution files from tracking
48fc35a Add RELEASE_GUIDE.md (C.3-A 配布手順書)
b47fb14 Initial commit: PokerTimerPLUS+ v1.3.0
```

### リモート
- origin: <https://github.com/maetomo08020802-eng/PokerTimerPLUS.git>
- `feature/v2.0.0` も push 済

### 承認①対象（STEP 2 完了時）
- STEP 2 完了時に PR を `main` 向けに作成予定（NEXT_CC_PROMPT.md 指示）

---

**作成日**: 2026-05-01
**作成時 version**: 1.3.0（配布版）+ v2.0.0 STEP 1 進行中
**作成時テスト数**: 138 件（15 ファイル、すべて PASS）
**最終フェーズ**: v2.0.0 STEP 1（commit `4951f9d` push 済、PR は STEP 2 完了時にまとめて作成）
