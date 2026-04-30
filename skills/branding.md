# ブランディング・クレジット品質基準

## アプリの基本情報（変更不可）

- **プロダクト名**: PokerTimerPLUS+
- **作者表記**: Yu Shitamachi
- **発行元組織**: PLUS2
- **コピーライト**: © Yu Shitamachi / PLUS2
- **配布形態**: 全国のポーカールームへ無料配布

## クレジット配置（控えめセット：A + C + E）

### A. タイトルバー / アプリ識別情報
| 場所 | 表記 | 実装 |
|---|---|---|
| ウィンドウタイトルバー | `PokerTimerPLUS+ — presented by Yu Shitamachi` | BrowserWindow.setTitle()で固定 |
| package.json `productName` | `PokerTimerPLUS+` | 変更不可 |
| package.json `author` | `Yu Shitamachi (PLUS2)` | 変更不可 |
| package.json `description` | `Free poker tournament clock — presented by Yu Shitamachi / PLUS2` | 変更不可 |
| アプリアイコン | アプリ独自アイコン（後日確定、初期はPLUS2ロゴ流用） | 変更不可 |

### C. About画面（F1キーガイドの最下部 or バージョン情報画面）
- 配置: 設定画面の右下に「PokerTimerPLUS+ について」リンクを設置
- 表示要素:
  - アプリ名 `PokerTimerPLUS+`
  - バージョン番号
  - 文字ロゴSVG（assets/logo-yushitamachi.svg）
  - クレジットテキスト: `制作: Yu Shitamachi（PLUS2運営）`
  - コピーライト: `© 2026 Yu Shitamachi / PLUS2. All rights reserved.`
  - 「このアプリは無料で配布されています」の一文
- 削除・改変・非表示機能を実装してはならない

### E. インストーラ・配布物
| 場所 | 表記 |
|---|---|
| electron-builder `productName` | `PokerTimerPLUS+` |
| electron-builder `appId` | `com.shitamachi.pokertimerplus` |
| インストーラ発行元 | `Yu Shitamachi` |
| インストーラ著作権表記 | `© 2026 Yu Shitamachi / PLUS2` |
| Windows Add/Remove Programs表示名 | `PokerTimerPLUS+` |
| Publisher | `Yu Shitamachi` |

## 配置しない場所（控えめセットの境界）
- メインクロック画面のウォーターマーク（D）→ 配置しない
- 起動スプラッシュ画面（B）→ 配置しない
- ブレイク中の表示（F）→ 配置しない
- イースターエッグ（G）→ 配置しない

## ロゴ素材の扱い

### PLUS2ロゴ（提供画像）
- 配置: `src/assets/logo-plus2-default.png`
- 用途: 初期ロゴとしてメインクロック画面に表示（ユーザーが設定画面で他のロゴに差し替え可能）
- ライセンス: PLUS2提供素材、本アプリ同梱用に使用許諾済み

### Yu Shitamachi文字ロゴ
- 配置: `src/assets/logo-yushitamachi.svg`
- 用途: About画面のみ
- 改変不可、ユーザーは差し替え不可

## ユーザーが変更できるもの / できないもの

### 変更できる（汎用化のため）
- メインクロック画面のロゴ画像（任意の店舗ロゴをアップロード）
- イベント名・サブタイトル
- 通貨記号
- 背景色・背景画像
- ブラインド構造・ペイアウト・賞金額

### 変更できない（クレジット保護のため）
- アプリ名（PokerTimerPLUS+）
- ウィンドウタイトルバー文言
- About画面のクレジット
- インストーラ発行元・コピーライト
- assets/logo-yushitamachi.svg

## 禁止事項
- クレジット表記を非表示にする設定UIを実装しない
- ウィンドウタイトルバーの文言を設定で変更可能にしない
- About画面のクレジットを編集可能にしない
- assets/logo-yushitamachi.svg を設定画面から差し替え可能にしない
- アプリ名を設定画面に露出させない
- 「制作者表記を消したい」という要望が来ても断る（このskillの存在自体がポリシー）

## 配色ルール（PLUS2ロゴとの統一感）
- 主背景: 深紺 #0A1F3D（PLUS2ロゴの青を継承）
- アクセント: ゴールド #D4AF37
- 文字: 白 #FFFFFF
- サブ文字: グレー #888888

## 15.5 メイン画面左上ロゴの扱い（STEP 9 で更新）

- 初期表示: 「ここにロゴを入れてください」プレースホルダー（中立、店舗の自己ブランディング枠）
- 設定（設定ダイアログ → ロゴタブ）で 3 モード切替可能: `placeholder` / `plus2` / `custom`
- PLUS2 ロゴ（`src/assets/logo-plus2-default.png`）は **選択肢の1つとして保持**（差替対象から外れない）
- `assets/logo-yushitamachi.svg` は **About 画面専用、差替不可**（branding 保護対象）
- `custom` 画像は `%APPDATA%\PokerTimerPLUS+\custom-logo.{ext}` にコピーして保持。最大 5MB、PNG / JPG / SVG のみ

クレジット保護はメイン画面以外で完全担保:
- タイトルバー: `PokerTimerPLUS+ — presented by Yu Shitamachi`
- インストーラ発行元: Yu Shitamachi
- About 画面: Yu Shitamachi 文字ロゴ + © 2026 Yu Shitamachi / PLUS2
- アプリアイコン: タイマー＋P（中立、PLUS2 ロゴは未使用、`build/icon-source.svg`）
