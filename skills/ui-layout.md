# UIレイアウト

## ビューポート全体レイアウト（最上位）

body 全体を **flex column** で組み、各行を明示的な高さで分割する。
**`position: fixed` は使わない**（コンテンツとの高さ計算が独立すると overlap が発生するため）。

```css
html, body {
  height: 100vh;
  margin: 0;
  overflow: hidden;
}
body {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.clock {
  flex: 1 1 auto;     /* 残りのスペース全部 */
  min-height: 0;       /* 子の overflow を抑制（flex child 必須） */
  overflow: hidden;    /* 中央コンテンツがはみ出さない */
}
.bottom-bar {
  flex: 0 0 6vh;       /* 6vh 固定（ボタン 4vh + 縦パディング 1vh + 余白 1vh） */
}
.marquee {
  flex: 0 0 5vh;       /* 5vh 固定、has-marquee の時のみ表示 */
}
body:not(.has-marquee) .marquee { display: none; }
```

DOM 順序:
```html
<body>
  <main class="clock">...</main>
  <div class="bottom-bar">...</div>
  <div class="marquee">...</div>  <!-- has-marquee の時のみ可視 -->
</body>
```

この構造により：
- `.clock` は常に `100vh - bottom-bar(6vh) - marquee(5vh) = 89vh` の領域に閉じ込められる
- `.bottom-bar` と `.marquee` は他要素と物理的に重ならない
- ウィンドウサイズが小さくなっても、各要素の境界は固定

---

## メインクロック画面のグリッド
12列 × 12行のCSS Grid。

| 領域 | 列 | 行 | 役割 |
|---|---|---|---|
| 左カラム | 1-3 | 全行 | 情報密度低、ラベル＋値の縦並び |
| 中央カラム | 4-9 | 全行 | タイマー支配領域 |
| 右カラム | 10-12 | 全行 | 情報密度低、ラベル＋値の縦並び |
| ヘッダ行 | 全列 | 1-2 | ロゴ・タイトル・次ブレイク |
| メイン行 | 全列 | 3-9 | タイマー |
| ブラインド行 | 全列 | 10-11 | BLINDSカード・NEXTカード |
| フッタ行 | 全列 | 12 | TOTAL PRIZE POOL |

## 左カラム配置ルール
- 上端: ロゴ
- ロゴ直下から: 賞金構造（1位・2位・3位…）
- 最下端: TOTAL PRIZE POOL
- ロゴと賞金構造の間、賞金構造とTOTAL PRIZE POOLの間に均等な余白

## 右カラムの均等配置ルール
右カラムは3つの「ステータス群」で構成され、画面高に対して**均等に縦分散**する。

| 群 | 位置 | 内容 |
|---|---|---|
| 群1 | 上 | NEXT BREAK IN |
| 群2 | 中央 | AVG STACK |
| 群3 | 下 | PLAYERS / REBUY / ADDON（3つで1単位） |

実装ルール:
- `display: flex; flex-direction: column; justify-content: space-between;`
- または `display: grid; grid-template-rows: 1fr 1fr 1fr; align-items: center;`
- 群1〜3 はそれぞれ独立した `<div class="stat-group">` で囲む
- 群3 は内部で PLAYERS をやや大きく、REBUY / ADDON を小さくして「主＋従」関係に
- 各群の上下は均等な余白を確保（上詰め禁止）

## 背景の統一ルール
- メインクロック画面の背景は `--bg-base` で**全画面均一**
- 部分的な「フッタ背景」「下部の色違いセクション」を作らない
- 例外:
  - マーキー領域（5vh、`--bg-card` 相当の濃紺）
  - 一時停止オーバーレイ（rgba(0,0,0,0.5) を absolute 配置）
- 操作ボタン群・ショートカットガイドは独立コンテナの背景を持たず、`--bg-base` 上に直接配置
- 下部にグラデーションを流す装飾は禁止（情報密度が高い画面で視覚ノイズになる）

## 背景プリセット（8種選択式）
ユーザーが設定画面の「表示」タブで以下8種から選択できる。すべてCSSのみ実装（画像不要、オフライン動作）。
**べた塗はblackのみ**、他はすべてグラデーションまたはパターン。

```css
/* 各背景はbody（または最上位コンテナ）に適用 */

/* 1. ピュアブラック（唯一のソリッド） */
:root[data-bg="black"] body {
  background: #050505;
}

/* 2. ネイビー（放射グラデーション） */
:root[data-bg="navy"] body {
  background:
    radial-gradient(ellipse 70% 50% at 50% 0%, rgba(79, 195, 247, 0.18) 0%, transparent 55%),
    radial-gradient(ellipse at center, #154080 0%, #0A1F3D 35%, #030814 100%);
}

/* 3. カーボン（チャコール+グリッド、より明確な格子） */
:root[data-bg="carbon"] body {
  background-color: #1F2024;
  background-image:
    radial-gradient(ellipse at center, rgba(255,255,255,0.05) 0%, transparent 70%),
    linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
  background-size: auto, 32px 32px, 32px 32px;
}

/* 4. フェルトグリーン（深緑+斜め織り目+中央スポットライト） */
:root[data-bg="felt"] body {
  background-color: #0F4D38;
  background-image:
    radial-gradient(ellipse at center, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.45) 80%),
    repeating-linear-gradient(45deg, transparent 0 6px, rgba(0,0,0,0.14) 6px 7px),
    repeating-linear-gradient(-45deg, transparent 0 6px, rgba(255,255,255,0.03) 6px 7px);
}

/* 5. バーガンディ（多段グラデ+ゴールドの淡い天井光） */
:root[data-bg="burgundy"] body {
  background:
    radial-gradient(ellipse 60% 40% at 50% 25%, rgba(212, 175, 55, 0.12) 0%, transparent 60%),
    linear-gradient(135deg, #5A1A2E 0%, #3A0E1A 30%, #1A0508 70%, #0A0204 100%);
}

/* 6. ミッドナイト（強い紫→青→黒、上部スポット） */
:root[data-bg="midnight"] body {
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, #4A24A0 0%, transparent 50%),
    radial-gradient(ellipse at center, #1A0838 0%, #0A0420 50%, #03010A 100%);
}

/* 7. エメラルド（深緑グラデ+トロピカルなハイライト） */
:root[data-bg="emerald"] body {
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(80, 200, 180, 0.12) 0%, transparent 50%),
    linear-gradient(180deg, #0F4848 0%, #0A2F2F 40%, #051818 70%, #020909 100%);
}

/* 8. オブシディアン（強いヴィネット） */
:root[data-bg="obsidian"] body {
  background: radial-gradient(ellipse 50% 50% at center, #353841 0%, #1A1C22 40%, #050609 80%);
}
```

設定永続化:
- electron-store key: `display.background`
- 値: `"black"|"navy"|"carbon"|"felt"|"burgundy"|"midnight"|"emerald"|"obsidian"`
- default: `"navy"`
- HTML root要素の `data-bg` 属性を切り替えるだけで全体が変わる

設定画面UI:
- 8種類のサムネイル（4列x2段または8列x1段の小四角プレビュー）
- 各サムネイルは実際の背景CSSを縮小再現
- クリックで選択、選択中は枠にゴールドボーダー
- 即時プレビュー反映

注意:
- カードのコントラストが取れる暗さを維持
- felt や carbon などの細かいパターンの透明度は0.05以下推奨

## レイアウト安定性ルール（必達）
メインクロック画面では、レベル変化やブレイク切替で**レイアウトシフトを絶対に発生させない**。

### 5原則
1. **要素は出し入れしない、出しっぱなしにする**
   - ANTE行は値0でも `display: none` ではなく `visibility: hidden` で常時占有
   - 「ブレイク中」「一時停止中」表示は absolute オーバーレイ
2. **カードは固定サイズ（3行分のコンテンツが必ず収まる高さ）**
   - .card-blinds: `min-height: 18vh; max-height: 18vh;` （ラベル+値+ANTE 全部収める）
   - .card-next: `min-height: 13vh; max-height: 13vh;`
   - カード内 overflow が起きないこと（ANTEが枠外に出ない）
3. **数値フィールドは固定幅**
   - SB/BB の数字部分に `min-width: 14vw; text-align: center;`
4. **左右カラムは絶対配置 or 独立Grid**
   - メインGridを `grid-template-columns: 22vw 1fr 22vw` で完全固定
5. **タイマー要素も固定枠**
   - タイマーコンテナに `min-height: 36vh;`（22vw→26vw拡大に伴い 30→36vh）

### CSS実装例
```css
.card-blinds {
  min-height: 14vh;
  max-height: 14vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.card-next {
  min-height: 9vh;
  max-height: 9vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.card-value {
  min-width: 14vw;
  text-align: center;
}
.card-ante.is-zero {
  visibility: hidden; /* 値0でも占有を維持 */
}
.main-grid {
  display: grid;
  grid-template-columns: 22vw 1fr 22vw;
  height: 100vh;
}
```

### 検証
レベル1（ANTE 0）→ レベル3（ANTE 25）→ レベル4（ANTE 50）→ ブレイク と切り替えて、左右カラムの全要素・操作ボタンの位置が**1pxも動かない**こと。動いたら即修正。
