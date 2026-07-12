---
paths:
  - "src/**"
  - "tests/**"
---

<!-- CLAUDE.md から逐語移設(2026-07-12 GO#7)。本文は移設時点の逐語 -->

## 汎用化ルール（全国配布対応）
- 初期値は「PLUS2固有の値」を避け、ジェネリックなデフォルトにする
- 例: イベント名のデフォルトは「ポーカートーナメント」（「PLUS2 トーナメント」ではない）
- ロゴ画像は設定で差し替え可能（初期値は同梱のPLUS2ロゴ）
- 通貨記号デフォルトは ¥ だが設定で変更可能

## ファイル構成ルール
- src/main.js: Electronメインプロセス
- src/renderer/: レンダラ（HTML/CSS/JS）
- src/audio/: 通知音mp3
- src/assets/: ロゴ・画像（logo-plus2-default.png, logo-yushitamachi.svg）
- src/presets/: ブラインド構造プリセットJSON
- 設定保存先: electron-store経由（OSのuserData配下）

## コード品質
詳細は skills/ 配下の各ファイルを参照。
共通ルール:
- バニラJS優先（必要時のみライブラリ追加）
- 関数は1機能1関数、50行以内
- 変数名・関数名は日本語コメント付き英語
- HTMLは意味のあるclass名、idはJS連携箇所のみ

## テスト
- STEP完了ごとに動作確認スクリプト or 手順書を出力する
- タイマー精度はsetTimeout単発ではなくperformance.now()基準のループで実装
