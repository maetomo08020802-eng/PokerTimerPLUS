# UIトークン定義

## デザイン方向性
**カジノ・ラグジュアリー × WPTブロードキャスト風ハイブリッド**
- 深紺ベース＋ゴールド／シアンの2色アクセント
- TV中継級の情報密度と視認性
- 等幅モノスペースで支配的なタイマー演出
- 半透明カードで情報をグルーピング

## 言語
- 全UIテキストは日本語
- ラベルのみ英大文字許容（BLINDS / ANTE / AVG STACK / PLAYERS など放送風表記）
- アプリ名 `PokerTimerPLUS+` は固定
- 専門用語は日本ポーカーシーンの表記（SB/BB/アンティ/リバイ/アドオン）

## カラートークン

```css
:root {
  /* 背景 */
  --bg-base: #0A1F3D;
  --bg-deep: #061224;
  --bg-elevated: #1A2B4A;
  --bg-card: rgba(6, 14, 28, 0.92);
  --bg-card-hover: rgba(6, 14, 28, 0.96);
  --bg-card-soft: rgba(10, 31, 61, 0.65);

  /* アクセント */
  --gold: #D4AF37;
  --gold-bright: #F0CB66;
  --gold-dim: #8A6F25;
  --cyan: #4FC3F7;
  --cyan-bright: #82DCFF;

  /* 警告 */
  --warn: #FFC107;
  --danger: #E53935;

  /* テキスト */
  --text-primary: #FFFFFF;
  --text-secondary: #B0BEC5;
  --text-muted: #607D8B;

  /* ボーダー */
  --border-gold: rgba(212, 175, 55, 0.35);
  --border-subtle: rgba(255, 255, 255, 0.08);
}
```

### 色の使い分け
- `--gold`: 賞金、PLUS2関連、見出しアクセント
- `--cyan`: ライブ感、強調値（次ブレイクまでの時間など）
- `--text-primary`: 数値・主要情報
- `--text-secondary`: ラベル・補助情報
- `--warn`: 残り60秒以下のタイマー
- `--danger`: 残り10秒以下のタイマー＋点滅

## タイポグラフィ

### フォント定義
```css
:root {
  --font-numeric: 'Oswald', 'Barlow', 'BIZ UDPGothic', sans-serif;
  --font-timer: 'JetBrains Mono', 'Roboto Mono', 'Consolas', monospace;
  --font-label: 'Inter', 'Helvetica Neue', 'Noto Sans JP', sans-serif;
  --font-body: 'Noto Sans JP', 'BIZ UDPGothic', sans-serif;
  --font-display: 'Noto Sans JP', 'Inter', 'BIZ UDPGothic', sans-serif;
}
```

- Google Fonts から `Oswald` (300/500/700) / `JetBrains Mono` (700/800) / `Inter` (400/600/700/900) / `Noto Sans JP` (400/700/900) を読み込む
- `Playfair Display` は廃止（イベントタイトルをゴシック調に統一したため）
- ローカルキャッシュ用にwoff2を `src/assets/fonts/` に同梱（オフライン動作のため）
- **タイマーは等幅モノスペース `--font-timer`**（桁ズレ防止）
- それ以外の数字は Oswald `--font-numeric` を使う

### タイプスケール

| 要素 | サイズ | フォント | 太さ | letter-spacing |
|---|---|---|---|---|
| タイマー | 26vw | timer | 700 | -0.04em |
| ブラインド主表示 | 5.6vw | numeric | 700 | 0 |
| ネクスト表示 | 3.4vw | numeric | 600 | 0 |
| アンティラベル | 1.4vw | label | 700 | 0.15em |
| アンティ値 | 2.4vw | numeric | 700 | 0 |
| 次ブレイク値 | 2.6vw | timer | 700 | 0 |
| レベル番号 | 4vw | numeric | 700 | 0 |
| 大ステータス | 3.5vw | numeric | 700 | 0 |
| 中ステータス | 2.8vw | numeric | 600 | 0 |
| 小ステータス | 2.2vw | numeric | 600 | 0 |
| イベントタイトル | 3vw | display | 900 | 0.04em |
| サブタイトル | 1.6vw | body | 500 | 0 |
| ラベル（大） | 1.4vw | label | 700 | 0.15em |
| ラベル（小） | 1.1vw | label | 600 | 0.18em |

### ラベル基本ルール
- `text-transform: uppercase`
- `letter-spacing: 0.15em` 以上
- 色: `--text-secondary`
- 値の数字とは行を分ける（ラベル上、値下）

## スペーシング

```css
:root {
  --space-xs: 0.5vw;
  --space-sm: 1vw;
  --space-md: 1.5vw;
  --space-lg: 2.5vw;
  --space-xl: 4vw;
  --space-2xl: 6vw;
}
```

## ボーダー半径
- `--radius-sm: 6px`（小要素）
- `--radius-md: 12px`（カード）
- `--radius-lg: 20px`（大型カード）

## 禁止事項
- 固定px指定（vw/vh/remで可変対応、ボーダー半径を除く）
- カラートークン以外の色を直接記述
- フォントの直接指定（必ずCSS変数経由）

## 参考イメージ
- WPT TOKYO 2023 のディスプレイUI（情報レイアウト・タイマー存在感）
- PokerStars Live ブロードキャストグラフィック（カラートーン）
- 高級カジノのスコアボード（ゴールドアクセント、装飾的な見出し）
