# PokerTimerPLUS+

全国のポーカールーム向けに無料配布する Electron 製ポーカートーナメントクロック。

- **プロダクト名**: PokerTimerPLUS+
- **制作**: Yu Shitamachi（PLUS2運営）
- **配布形態**: 無料配布
- **動作環境**: Windows 10/11、macOS 12 以降
- **公開リポジトリ**: https://github.com/maetomo08020802-eng/PokerTimerPLUS
- **最新版ダウンロード**: [Releases ページ](https://github.com/maetomo08020802-eng/PokerTimerPLUS/releases)

## 機能（実装予定）

- ブラインド構造に従ったレベル別カウントダウンタイマー
- 通知音（レベル終了 / 1分前 / 10秒前 / 5秒カウント / スタートカウントダウン）
- プレイヤー数・リバイ・アドオン管理
- 賞金プール自動計算と順位別ペイアウト表示
- 任意の店舗ロゴ・背景画像の差し替え
- 完全日本語UI、フルスクリーン対応

詳細仕様は [docs/specs.md](docs/specs.md) を参照。

## 起動方法

```bash
npm install
npm start
```

開発モード（DevTools 起動）:

```bash
npm run start:dev
```

配布ビルド:

```bash
npm run build       # OS自動判定
npm run build:win   # Windows .exe
npm run build:mac   # macOS .dmg
```

## ショートカットキー（STEP 1 時点）

| キー | 動作 |
|------|------|
| F11 | フルスクリーン切替 |
| Ctrl+Q (macOS: Cmd+Q) | 終了確認ダイアログ |
| F12 | DevTools 開閉（開発モード時のみ） |

タイマー操作・設定画面切替などは後続STEPで実装。

## 配布版の起動について（Windows SmartScreen 警告）

本アプリはコード署名（コードサイニング証明書）を行っていないため、Windows 10 / 11 で配布版（インストーラまたは exe）を初めて起動した際に **Microsoft Defender SmartScreen 警告** が表示されることがあります。これは未署名アプリ全般で表示される標準的な警告で、本アプリ自体に問題はありません。

**起動手順:**
1. SmartScreen 警告画面で「**詳細情報**」をクリック
2. 表示される「**実行**」ボタンをクリック
3. 通常通りアプリが起動

警告内容は「WindowsによってPCが保護されました」という見出しで、初回起動時のみ出現します。一度「実行」を選択すれば次回以降は表示されません。

なお、このアプリは外部通信を一切行わず、位置情報・カメラ・マイクなどのデバイス権限も使用しません。すべてオフラインで動作します。

## ライセンスとクレジット

© 2026 Yu Shitamachi / PLUS2. All rights reserved.

このアプリは無料で配布されています。

## PokerStars Poker Clock との関係

本アプリは **PokerStars Poker Clock とは無関係です**。Adobe AIR 製の旧アプリ「PokerStars Poker Clock」を機能リファレンスとして参考にしましたが、コード・素材は一切再利用していません。商標・著作物はすべて各権利者に帰属します。

## ファイル構成

```
poker-clock/
├── package.json
├── src/
│   ├── main.js          # Electronメインプロセス
│   ├── preload.js       # プリロード（IPCブリッジ用）
│   ├── renderer/        # HTML/CSS/JS
│   ├── audio/           # 通知音mp3（後続STEPで追加）
│   ├── assets/          # ロゴ・画像
│   └── presets/         # ブラインド構造プリセットJSON（後続STEPで追加）
├── docs/
│   └── specs.md         # 機能仕様書
└── skills/              # 実装ガイド（branding / ui-design / timer-logic / audio-system）
```
