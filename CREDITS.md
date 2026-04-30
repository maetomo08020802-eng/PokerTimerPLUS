# PokerTimerPLUS+ Credits

## Audio

通知音の出典・ライセンス詳細は `src/audio/CREDITS.md` を参照（効果音ラボ／商用無料・再配布可）。

## Fonts

PokerTimerPLUS+ ships bundled with the following fonts under SIL Open Font License 1.1:

- **Oswald** © Vernon Adams, Kalapi Gajjar, Cyreal — https://fonts.google.com/specimen/Oswald
- **Barlow Condensed** © The Barlow Project Authors (Jeremy Tribby) — https://fonts.google.com/specimen/Barlow+Condensed
- **JetBrains Mono** © JetBrains — https://www.jetbrains.com/lp/mono/
- **Roboto Mono** © Christian Robertson — https://fonts.google.com/specimen/Roboto+Mono
- **Space Mono** © Colophon Foundry — https://fonts.google.com/specimen/Space+Mono
- **Inter** © Rasmus Andersson — https://rsms.me/inter/
- **Noto Sans JP** © Google — https://fonts.google.com/noto/specimen/Noto+Sans+JP

Full license texts are bundled in `src/assets/fonts/licenses/`.

## App Icon

The application icon (build/icon.ico, build/icon.png) is an original work by Yu Shitamachi.
Design: black square with rounded corners + white "20:40" rendered as 7-segment LCD style
geometric primitives (SVG `<rect>` shapes). No external font dependency — the digital clock
look is built from manually-crafted vector segments for portability and consistent rendering
across all platforms and build environments.

Source: `build/icon-source.svg`
Generator: `build/generate-icon.js` (sharp + png-to-ico)
