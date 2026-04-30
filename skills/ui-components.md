# UIコンポーネント仕様

## カード（BLINDS / NEXT LEVEL）
**配置**: タイマー直下に**縦2段**で配置（BLINDS が上、NEXT LEVEL が下）。横並びにしない。

```css
.card {
  background: var(--bg-card);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 2px solid var(--border-gold);
  border-radius: var(--radius-md);
  padding: var(--space-md) var(--space-lg);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  white-space: nowrap;
  min-width: max-content;
}

/* カード本体はクリック対象ではないので hover 効果を付けない（誤クリック誘導の防止） */
.card,
.card:hover,
.card:focus,
.card:active {
  background: var(--bg-card) !important;
  cursor: default !important;
  transition: none;
}

/* BLINDS（上段）: やや大きく強調、3行（ラベル+値+ANTE）すべて収める */
.card-blinds {
  padding: var(--space-sm) var(--space-xl);
  min-height: 18vh;
  max-height: 18vh;
  /* ラベル(1.4vw≈1.5vh) + 値(5.6vw≈6.5vh) + ANTE(2.4vw≈3vh) + 余白 = 約16vh、安全マージン2vh含む */
}

/* NEXT LEVEL（下段）: BLINDSの約75%サイズ、縦コンパクト */
/* 重要: transform: scale は使わない（layout計算外で overlap の原因になる） */
.card-next {
  padding: var(--space-xs) var(--space-lg);
  /* margin-top は付けない。card-stack の gap で十分（二重スペーシング防止） */
  min-height: 13vh;
  max-height: 13vh;
  /* ラベル(1.1vw≈1.2vh) + 値(3.4vw≈4vh) + ANTE(1.8vw≈2vh) + 余白 = 約10vh、安全マージン3vh含む */
}
.card-next .card-label      { font-size: 1.1vw; }
.card-next .card-value      { font-size: 3.4vw; }
.card-next .card-ante       { margin-top: 0.3vh; }
.card-next .card-ante-label { font-size: 1.1vw; }
.card-next .card-ante-value { font-size: 1.8vw; }

/* カード行全体の縦専有を抑える */
.card-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  align-items: center;
}

/* テキストはみ出し防止 */
.card-value {
  white-space: nowrap;
  overflow: visible;
}
```

### カード内レイアウト（ANTE配置）
```html
<div class="card card-blinds">
  <div class="card-label">BLINDS</div>
  <div class="card-value">25 / 50</div>
  <div class="card-ante">ANTE 5</div>
</div>
```

ルール:
- ラベル（BLINDS / NEXT LEVEL）: 上、小、UPPERCASE、グレー
- 主値（SB / BB）: 中央、大、白
- アンティ: 主値の**下**、小サイズ（1.8vw）、薄色
- ANTE = 0 の時は `visibility: hidden`（`display: none` 禁止、レイアウトシフト防止）
- 横一列配置は採用しない（縦2段で読みやすさ優先）
- カード内テキストは絶対にはみ出させない（white-space: nowrap + min-width: max-content）

## ボトムバー（ショートカット表示＋操作ボタン）
画面下部・マーキー直上に配置される操作領域。**重なりを起こさない**ためにGridで明示的に2分割する。

**配置方針（重要・更新）**:
- `position: fixed` を**使わない**（コンテンツとの高さ計算が独立し overlap の原因になるため）
- body 全体を flex column で組み、bottom-bar はその一行として配置する
- 詳細は ui-layout.md「ビューポート全体レイアウト」を参照

```css
.bottom-bar {
  display: grid;
  grid-template-columns: 1fr auto;  /* 左: ショートカット、右: 操作ボタン */
  align-items: center;
  gap: var(--space-md);
  padding: 0.5vh var(--space-lg);   /* 縦パディングは 0.5vh のみ（ボタン 4vh + 余白で 6vh に収まるよう） */
  flex: 0 0 6vh;                    /* body flex column 内で固定高さ。5vh だとボタン (4vh) が下にはみ出してマーキーを侵食 */
  height: 6vh;
  background: rgba(6, 14, 28, 0.4); /* 控えめに領域分離 */
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}
.bottom-bar__shortcut {
  font-family: var(--font-label);
  font-size: 1vw;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bottom-bar__buttons {
  display: flex;
  gap: var(--space-sm);
  flex-shrink: 0;
}
.bottom-bar__buttons button {
  height: 4vh;
  padding: 0 var(--space-md);
  background: transparent;
  border: 1px solid var(--border-gold);
  color: var(--text-primary);
  font-family: var(--font-label);
  font-weight: 600;
  font-size: 1.1vw;
}
.bottom-bar__buttons button.is-primary { background: var(--gold); color: #000; }
.bottom-bar__buttons button:hover { background: rgba(212, 175, 55, 0.15); }
```

ルール:
- ショートカットテキストと操作ボタンは**同じ行で重ならない**（Grid の 1fr auto で確実に分離）
- ショートカットが長すぎる場合は ellipsis で切る（ボタン領域を絶対に侵さない）
- マーキー領域（5vh、最下段）の直上に配置
- 全画面でも 1280×720 でも同じ挙動

## スタットブロック（ラベル＋値の縦並び）
```html
<div class="stat">
  <div class="stat-label">AVG STACK</div>
  <div class="stat-value">233,249</div>
</div>
```
- ラベル: 上、小、薄グレー、UPPERCASE
- 値: 下、大、白、Oswald

## タイマー本体
- **font-family: var(--font-timer)**（等幅モノスペース、JetBrains Mono Bold）
- font-size: 22vw
- font-weight: 700
- color: var(--text-primary)
- text-shadow: `0 0 40px rgba(212, 175, 55, 0.25)`（ゴールドの淡いグロー）
- text-align: center
- letter-spacing: -0.04em（モノスペースは詰め気味で映える）
- 各桁の幅が常に同じため、桁変動による位置ズレが発生しない
- **per-digit span方式は使わない**（HTMLが複雑になりバグの温床）
- 1要素 1テキストノードでシンプルに保つ：`<div class="timer">01:23</div>`

## イベントタイトル
- フォント: Playfair Display Bold（`--font-display`）
- color: var(--text-primary)
- text-shadow: 控えめな金ドロップシャドウ
- 中央上配置
- 直下に**サブタイトル**（任意、空文字なら非表示）
  - フォント: var(--font-body)、400、1.4vw、letter-spacing 0.02em
  - 色: var(--text-secondary)
  - 設定画面で編集可（tournament.subtitle）

## NEXT BREAK IN 値表示
- フォント: **var(--font-timer)**（モノスペース、桁ズレ防止）
- 形式: HH:MM:SS（残り時間がカウントダウン）
- 色: var(--cyan)（ライブ感）
- font-weight: 700

## マーキー（テロップ）
画面最下段に配置される横スクロールテキスト領域。

**配置方針（重要）**:
- `position: fixed` を**使わない**（bottom-bar と同じ理由：通常フローと独立すると重なりが起こる）
- body 全体を flex column で組み、marquee はその最終行として配置する
- 詳細は ui-layout.md「ビューポート全体レイアウト」を参照
- 表示制御は `body.has-marquee` クラスの ON/OFF 一本に統一する（`hidden` 属性は使わない）

```css
.marquee {
  flex: 0 0 5vh;          /* body flex column 内で固定高さ */
  width: 100%;
  height: 5vh;
  background: rgba(6, 14, 28, 0.92);
  border-top: 1px solid var(--gold);
  overflow: hidden;
  white-space: nowrap;
  z-index: 50;
}
body:not(.has-marquee) .marquee { display: none; }

.marquee-content {
  display: inline-block;
  padding-left: 100%;
  line-height: 5vh;
  font-family: var(--font-label);
  font-weight: 600;
  font-size: 1.6vw;
  color: var(--text-primary);
  letter-spacing: 0.05em;
  animation: marquee-scroll var(--marquee-duration, 20s) linear infinite;
  will-change: transform;
}
@keyframes marquee-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-100%); }
}
```

仕様:
- 高さ: 5vh
- 背景: 半透明濃紺（rgba(10, 31, 61, 0.85)）+ 上端ゴールド細線
- テキスト: 白、Inter 600、1.6vw、letter-spacing 0.05em
- 動き: 右→左の横スクロール、無限ループ
- 速度: slow=30秒/周, normal=20秒/周, fast=12秒/周
- 空文字 / OFF時: 領域ごと `display: none`（ショートカットガイドが最下段に上がる）
- 改行は半角スペース3つで連結して1行表示

編集UI:
- 設定画面に「マーキー」タブ
- ON/OFF切替、テキスト入力、速度3段階選択、プレビューボタン
- ショートカット Ctrl+T で編集ダイアログを直接開く（運用中の即時編集）

永続化（electron-store）:
- `marquee.enabled` (boolean, default true)
- `marquee.text` (string, default "")
- `marquee.speed` ("slow"|"normal"|"fast", default "normal")

## 操作ボタン（スタート / 一時停止 / リセット）
- 配置: 画面右下のフッタ領域（マーキー直上、ショートカットガイドの右隣）
- 高さ: 4vh以内（カード領域に被らない）
- ボタン間スペース: var(--space-sm)
- スタイル: 背景透明、ゴールド極細ボーダー、文字白、Inter 600 1.2vw
- ホバー: 背景にゴールド淡色 (`rgba(212,175,55,0.15)`)、ボーダー明るく
- スタートボタンのみアクティブ時はゴールド充填（運用開始の一押しを目立たせる）
- カードと操作ボタンは絶対に重ならないこと
