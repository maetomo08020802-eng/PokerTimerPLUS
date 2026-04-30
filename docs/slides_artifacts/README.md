# PokerTimerPLUS+ 取扱説明書 — Slides Artifacts

PokerTimerPLUS+ v1.3.0 の Google Slides 取扱説明書（全 11 枚）の生成スクリプトと修正用アーティファクト一式。

## ファイル構成

```
slides_artifacts/
├── build_slides.py        # メインスクリプト（再実行可能）
├── presentation_info.json # プレゼンID + 各スライドID（自動生成）
├── image_urls.json        # 画像 Drive ID + 公開 URL（キャッシュ）
├── image_urls.md          # 画像 URL 対応表（人間用）
├── object_id_map.md       # 全 objectId 対応表
├── requests/
│   ├── slide_01.json      # スライド 1 の batchUpdate リクエスト
│   ├── slide_02.json
│   ├── ...
│   └── slide_11.json
└── README.md              # この文書
```

## 認証

- 認証情報: `C:\Users\user\google-slides-mcp\credentials.json` (OAuth クライアント)
- トークン: `C:\Users\user\Desktop\PLUS2\plus2_token.json` (再利用される)
- スコープ: `drive`, `presentations`

トークンが期限切れで refresh も失敗した場合、`run_local_server` が起動してブラウザで再認証フローが立ち上がる。`maetomo08020802@gmail.com` でサインインすること。

## 使い方

### 全スライド再構築（プレゼン新規作成）

`presentation_info.json` を削除してから実行すると新しいプレゼンを作成する：

```bash
cd "C:\Users\user\Documents\Claude\Projects\個人アシスタント\poker-clock\docs\slides_artifacts"
rm presentation_info.json
python build_slides.py
```

### 既存プレゼンの特定スライドだけ再構築

`presentation_info.json` を残したまま、対象スライドの要素を Slides 上で全削除してから実行：

```bash
python build_slides.py --slides 5         # スライド 5 だけ
python build_slides.py --slides 3,7,9     # 複数
python build_slides.py --slides all       # 全部 (1〜11)
```

> **注意:** スクリプトは `createShape`/`createImage` を使うので、再実行前に Slides 上で
> 該当 objectId の要素を **手動で削除** してから走らせる。
> （objectId が重複するとエラー）

### JSON だけ生成（API 送信なし）

```bash
python build_slides.py --dry
```

### 画像アップロードをスキップ（image_urls.json 再利用）

```bash
python build_slides.py --skip-upload
```

## スライド構成

| # | スライド名 | 主要素材 |
|---|---|---|
| 01 | タイトル | グロー楕円 + 縦アクセント + メインタイトル |
| 02 | はじめに：起動時の警告 | 2 カラム + `attention.png` |
| 03 | このアプリでできること | 5 項目箇条書き + `01-main.png` |
| 04 | メイン画面の見方 | 中央画像 + 周囲注釈 6 箇所 |
| 05 | トーナメント設定 | 2 カラム + `02-tournament.png` |
| 06 | ブラインド構造 | 2 カラム + `03-blinds.png` |
| 07 | 背景・色の設定 | 2 カラム + `04a-bg-presets.png` |
| 08 | 休憩中スライドショー（設定） | 2 カラム + `04b-slideshow.png` |
| 09 | 休憩中スライドショー（実行画面） | 中央画像 + 周囲注釈 6 箇所 |
| 10 | ショートカットキー一覧 | 3 カラム表 |
| 11 | クレジット / お問い合わせ | 3 セクション + `06-about.png` |

## デザイン仕様

- **ベース背景:** Midnight `#0C1829`（solidFill）
- **アクセント:** Gold `#D4A843` / Light `#F0C060` / Dark `#9A7520`
- **フォント:** Noto Sans JP（タイトル）/ BIZ UDPGothic（本文）/ Roboto（数値）
- **ロゴ:** 全 11 枚に PLUS TWO ロゴを `createImage` で挿入
  - スライド 1, 11: 75 × 52 pt
  - スライド 2〜10: 50 × 35 pt（位置 X:640, Y:340）
- **フッター:** 全 11 枚に「PokerTimerPLUS+ v1.3.0 / NN / 11」を Dusk `#5A7A94` で配置

## API 制約（厳守）

スクリプト内で以下を遵守：
- `gradientFill` 不使用 → `solidFill` のみ
- `roundedRectangle` 不使用 → `RECTANGLE` のみ
- `outline` は `propertyState: "NOT_RENDERED"` で非表示
- フォントは Noto Sans JP / BIZ UDPGothic / Roboto のみ

## トラブル時

| 症状 | 対処 |
|---|---|
| `invalid_grant: Token has been expired` | スクリプトが自動的にブラウザ再認証フローへフォールバック |
| `objectId already exists` | 該当スライドの要素を Slides 上で全削除してから再実行 |
| 画像が表示されない | `image_urls.md` の URL をブラウザで直接開いて確認。権限不足なら Drive で再度公開設定 |
| `Unknown name "gradientFill"` | スクリプトが gradientFill を使っているはずがない。差分を確認 |
| API レートリミット | 1 スライドずつ間隔を空けて実行 |

## ID 対応表

詳細は [object_id_map.md](object_id_map.md) を参照。

各スライド要素の objectId は `s{NN}_{種別}` 形式（例: `s05_title`, `s05_b0_h`）。
PLUS TWO ロゴは `plus2_logo_{NN}` 形式。
