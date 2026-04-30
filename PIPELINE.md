# PIPELINE.md - 構築フロー

## 全体フロー
入力（オーナー要件＋既存アプリ調査）→ STEP 0-8順次実行 → 最終配布物（.exe / .app）

## STEP依存関係
STEP 0 → 1 → 2 → [承認①] → 3 → 4 → 5 → [承認②] → 6 → 7 → 8 → [承認③] → 完成

## 承認区間と自動進行区間
- 自動進行: STEP 0→1→2 / STEP 3→4→5 / STEP 6→7→8
- 人間承認必須: STEP 2完了時 / STEP 5完了時 / STEP 8完了時

## 各STEPの入出力

### STEP 0: 既存アプリ調査
- 入力: C:\Users\user\Desktop\PokerStars_Poker_Clock 配下のファイル
- 出力: docs/specs.md（機能リスト＋画面遷移）

### STEP 1: プロジェクト初期化
- 入力: docs/specs.md
- 出力: package.json / src/main.js / src/renderer/index.html
- 確認: npm start でウィンドウが開くこと

### STEP 2: コアタイマー
- 入力: skills/timer-logic.md
- 出力: src/renderer/timer.js / state.js
- 確認: ブラインドプリセット1つで開始→進行→一時停止→リセット動作

### STEP 3: ブラインド構造管理
- 入力: なし
- 出力: src/renderer/blinds.js / src/presets/*.json
- 確認: プリセット切替・レベル編集UIが動作

### STEP 4: 通知音システム
- 入力: skills/audio-system.md / src/audio/*.mp3
- 出力: src/renderer/audio.js
- 確認: 10秒前・5秒前カウント・レベル変更音が鳴る

### STEP 5: スタートカウントダウン
- 入力: STEP 4の音響システム
- 出力: src/renderer/start-countdown.js
- 確認: 「スタート」押下後3-2-1カウントしてからタイマー開始

### STEP 6: プレイヤー・賞金管理
- 入力: なし
- 出力: src/renderer/players.js / payouts.js
- 確認: 人数・スタック入力で平均スタック・M値が自動計算

### STEP 7: 設定永続化
- 入力: 全モジュール
- 出力: src/storage.js（electron-store）
- 確認: アプリ再起動後も最終設定・プリセットが復元

### STEP 8: 仕上げ
- 入力: 全実装
- 出力: ビルド済み.exe（electron-builder）
- 確認: 全機能チェックリスト通過

## エラー時の振る舞い
- STEP実行中のエラー: 即座に作業中断、エラー内容＋影響範囲を報告
- 想定外の仕様矛盾発見: 一時停止し、オーナーに判断を仰ぐ
- 既存アプリの仕様読み取り不能: ベストエフォートで仕様推定し、推定根拠を明示

## 配布
- Windows向け .exe（NSIS installer）
- 必要に応じて macOS .app / Linux AppImage
- electron-builder設定はSTEP 8で確定

---

# v2.0.0 構築フロー（2026-05-01 開始、進行中）

## v2.0.0 全体フロー
入力（v1.3.0 完成品 + v2 構想）→ STEP 0-7 順次実行 → v2.0.0 配布物（.exe / .app）

## v2.0.0 STEP 依存関係
STEP 0 → 1 → 2 → [承認①] → 3 → 4 → 5 → [承認②] → 6 → 7 → [承認③] → v2.0.0 完成

## v2.0.0 承認区間と自動進行区間
- 自動進行: STEP 0→1→2 / STEP 3→4→5 / STEP 6→7
- 人間承認必須: STEP 2 完了時 / STEP 5 完了時 / STEP 7 完了時

## v2.0.0 各 STEP の入出力

### STEP 0: 設計調査
- 入力: v1.3.0 ソース（main.js / renderer.js / state.js / store / preload.js）+ v2 構想（CLAUDE.md「v2.0.0」セクション）
- 出力: docs/v2-design.md（影響範囲一覧、Electron 2 ウィンドウ動作確認結果）
- 確認: コード変更ゼロ、調査文書のみ生成

### STEP 1: ホール側ウィンドウ追加
- 入力: STEP 0 の docs/v2-design.md
- 出力: src/main.js（ウィンドウ生成関数の分離）+ src/renderer/hall.html（最小骨格）
- 確認: ホール側ウィンドウが開く、表示が空でも構わない

### STEP 2: 2 画面間の状態同期 【承認①】
- 入力: skills/v2-dual-screen.md「§2 状態同期の精度基準」
- 出力: src/main.js（IPC ハンドラ）+ src/renderer/dual-sync.js（同期ロジック）
- 確認: PC 側でタイマー操作 → ホール側が ±100ms 以内に反映

### STEP 3: PC 側 UI の分離
- 入力: 既存 src/renderer/index.html / renderer.js
- 出力: src/renderer/operator.html（操作専用）/ src/renderer/hall.html（表示専用）
- 確認: PC 側に表示が残らない、ホール側に操作 UI が残らない

### STEP 4: 起動時のモニター選択ダイアログ
- 入力: Electron screen モジュール
- 出力: src/main.js（起動時ダイアログ）+ src/renderer/display-picker.html
- 確認: 2 モニター環境で起動時にダイアログ表示、選択でホール側決定

### STEP 5: HDMI 抜き差し追従 【承認②】
- 入力: skills/v2-dual-screen.md「§3 HDMI 抜き差し追従」
- 出力: src/main.js（display-added / display-removed ハンドラ）
- 確認: 営業中に HDMI 抜き → 単画面復帰、再接続 → 2 画面復帰

### STEP 6: テスト維持 + 追加
- 入力: 既存 tests/ + skills/v2-dual-screen.md「§6 テスト方針」
- 出力: tests/v2-dual-screen.test.js（新規）
- 確認: 既存 138 + 新規テスト全 PASS

### STEP 7: 最終検証 + リリース準備 【承認③】
- 入力: 全実装
- 出力: docs/specs.md 更新 / CHANGELOG.md / package.json version bump (1.3.0 → 2.0.0)
- 確認: 動作確認チェックリスト全項目通過

## v2.0.0 エラー時の振る舞い
- 既存 138 テストが 1 件でも FAIL → 即作業中断、原因報告
- v1.3.0 単画面モードでの動作異常 → 即停止、致命バグ保護への影響確認
- 想定外の Electron 仕様矛盾 → 構築士判断を仰ぐ

## v2.0.0 配布
- 配布タイミング: 「完璧に動くまで配布しない」（前原さん指示、急がない）
- v2.0.0 完成後の配布判断は承認③で別途決定
- 配布形態: v1.3.0 と同じ GitHub Releases + electron-updater
