# PokerTimerPLUS+ ビルド手順

## 前提
- Node.js がインストール済（既に開発で使っている環境）
- プロジェクトディレクトリ: `C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\`
- インターネット接続あり（electron-builder 初回実行時に必要なリソースをダウンロードするため）

## 手順

### 1. プロジェクトディレクトリへ移動

PowerShell またはコマンドプロンプトで:
```powershell
cd "C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock"
```

### 2. 依存関係を最新に
```powershell
npm install
```
※ STEP 8 で `sharp`（アイコン生成用）が devDependencies に追加されています。

### 3. （任意）アイコン再生成
PLUS2 ロゴ（`src/assets/logo-plus2-default.png`）から `build/icon.png` と `build/icon.ico` を再生成したい場合:
```powershell
npm run build:icon
```
実行で `build/icon.png`（512×512、アプリ本体用）と `build/icon.ico`（16/24/32/48/64/128/256 マルチサイズ、NSIS インストーラ用）の両方が生成されます。
※ 既に両ファイル配置済。ロゴを差し替えた場合のみ再実行。

### 4. （任意）事前テスト
```powershell
npm test
```
→ `tests/data-transfer.test.js` が 7/7 PASS することを確認。

### 5. ビルド実行
```powershell
npm run build:win
```

初回実行時、electron-builder が必要なリソース（Electron バイナリ、winCodeSign 等、約 100MB）をダウンロードします。完了まで数分。

### 6. 生成物の確認

ビルド成功時、`dist/` フォルダに以下が生成されます:

| ファイル | 用途 |
| --- | --- |
| `PokerTimerPLUS+ Setup 1.0.0.exe` | **NSIS インストーラ（配布用）** |
| `win-unpacked/` | 展開済みファイル（開発確認用、起動して即動作テストできる） |
| `latest.yml` | electron-builder の自動更新メタデータ（今回は使わない） |
| `*.blockmap` | 差分更新用バイナリマップ（今回は使わない） |

→ **配布するのは `PokerTimerPLUS+ Setup 1.0.0.exe` のみ**。

## トラブルシューティング

### よくある問題

**`Error: Cannot find module 'sharp'`** などのモジュール不在エラー
```powershell
npm install
```
で再インストール。

**`electron-builder` で「symbolic link」関連のエラー**
管理者権限の PowerShell で実行する、または Windows の「開発者モード」を有効化（設定 > 更新とセキュリティ > 開発者向け）。

**ビルドは成功したが .exe を起動するとエラー**
`dist/win-unpacked/PokerTimerPLUS+.exe` を直接起動して動作確認。エラー内容によっては DevTools（F12）でコンソールログを取得して構築士に共有。

**それ以外のエラー**
エラーメッセージ全文（`npm run build:win` の出力末尾 30〜50 行）を CC か CC構築士に共有してください。

## 配布前チェック
ビルド完了後、必ず `INSTALL_TEST.md` のチェックリストを実施してください。

---

**ビルドコマンドは前原さん側の Windows 環境で実行**してください。CC のサンドボックス環境では実行できません。
