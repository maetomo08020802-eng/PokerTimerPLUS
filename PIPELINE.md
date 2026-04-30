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
