# Object ID 対応表

**Presentation ID:** `1Gv1fYAyqt9AO2J2VHnIO5L9K1wnOQM-iEp8GFazGleo`  
**URL:** https://docs.google.com/presentation/d/1Gv1fYAyqt9AO2J2VHnIO5L9K1wnOQM-iEp8GFazGleo/edit

## スライド ID

| # | スライド名 | Slide ID |
|---|---|---|
| 01 | Title | `p` |
| 02 | SmartScreen Warning | `slide_02` |
| 03 | Features Overview | `slide_03` |
| 04 | Main Screen Guide | `slide_04` |
| 05 | Tournament Settings | `slide_05` |
| 06 | Blind Structure | `slide_06` |
| 07 | Background Settings | `slide_07` |
| 08 | Slideshow Setup | `slide_08` |
| 09 | Slideshow Active | `slide_09` |
| 10 | Shortcuts | `slide_10` |
| 11 | Credits | `slide_11` |

## 共通要素 ID 命名規則

各スライド prefix: `s01` 〜 `s11`

| 要素 | objectId 形式 | 例 |
|---|---|---|
| タイトル | `s{NN}_title` | `s05_title` |
| サブタイトル | `s{NN}_sub` | `s05_sub` |
| アクセント横線 | `s{NN}_acc` | `s05_acc` |
| オーバーレイ | `s{NN}_ovl` | `s05_ovl` |
| フッター区切り | `s{NN}_fdiv` | `s05_fdiv` |
| フッター左 | `s{NN}_fl` | `s05_fl` |
| フッター右ページ番号 | `s{NN}_fp` | `s05_fp` |
| PLUS TWO ロゴ | `plus2_logo_{NN}` | `plus2_logo_05` |
| 右画像 | `s{NN}_img` | `s05_img` |
| 画像フレーム | `s{NN}_imframe` | `s05_imframe` |
| 箇条書き縦バー (i 番目) | `s{NN}_b{i}_bar` | `s05_b0_bar` |
| 箇条書き見出し | `s{NN}_b{i}_h` | `s05_b0_h` |
| 箇条書き本文 | `s{NN}_b{i}_t` | `s05_b0_t` |

## 修正手順

1. `requests/slide_NN.json` を編集（座標・テキスト・色）
2. `python build_slides.py --slides NN` で当該スライドだけ再構築
3. もしくは Google Slides 上で直接編集して `objectId` を保ちながら API で再送信