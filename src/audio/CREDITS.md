# Audio Credits

本アプリ **PokerTimerPLUS+** で再生される通知音のソース・ライセンス・帰属表記を以下に確定記録します。

## 配置済みファイル

| ファイル | ソース | ライセンス | 表記 |
| --- | --- | --- | --- |
| level-end.mp3       | 効果音ラボ (https://soundeffect-lab.info/) | 商用無料・再配布可 | 任意 |
| level-end2.mp3      | 効果音ラボ (https://soundeffect-lab.info/) | 商用無料・再配布可 | 任意 |
| warning-1min.mp3    | 効果音ラボ (https://soundeffect-lab.info/) | 商用無料・再配布可 | 任意 |
| warning-10sec.mp3   | 効果音ラボ (https://soundeffect-lab.info/) | 商用無料・再配布可 | 任意 |
| countdown-tick.mp3  | 効果音ラボ (https://soundeffect-lab.info/) | 商用無料・再配布可 | 任意 |
| countdown-tick2.mp3 | 効果音ラボ (https://soundeffect-lab.info/) | 商用無料・再配布可 | 任意 |
| break-end.mp3       | 効果音ラボ (https://soundeffect-lab.info/) | 商用無料・再配布可 | 任意 |

## バリアント構成

`level-end` / `countdown-tick` の2サウンドは音色2バリアント切替に対応:

| soundId | default | variant2 |
| --- | --- | --- |
| level-end      | level-end.mp3      | level-end2.mp3      |
| countdown-tick | countdown-tick.mp3 | countdown-tick2.mp3 |

設定 → 音タブ「レベル終了の音色 / 5秒カウントの音色」で切替（`electron-store` に永続化）。

## ライセンス詳細

すべてのサンプルは **効果音ラボ** (https://soundeffect-lab.info/) からダウンロードしたものです。
効果音ラボの利用規約に基づき:

- **商用利用無料・許可不要**
- **表記任意**（必須ではない）
- **アプリへの同梱配布可**
- **改変可**

→ 本アプリの配布形態（Yu Shitamachi による無料配布、NSIS / DMG インストーラへの埋込）は完全に許諾範囲内。

## 禁止事項（効果音ラボ利用規約より）

以下は不可:

- 効果音ラボのコンテンツそのものを集めて公開・販売する
- 元データの再配布サイトを作成する

本アプリは**「アプリの一部として」音源を同梱**しているため、上記禁止事項には該当しません。

## ハウス情報タブへの表記

オーナー判断により、効果音ラボのライセンス上は表記**任意**ですが、**信頼性向上のため任意表記をハウス情報タブに静的に追加**しています:

- 表記場所: `src/renderer/index.html` の `<section data-tab="about">`
- 表記文言: 「効果音: 効果音ラボ」（リンク付き）
- `branding.md §15.5` に従い**設定で隠せない静的表記**として実装

## バリアント構成

`level-end` / `countdown-tick` の2サウンドは音色2バリアント切替に対応しています。詳細は `src/renderer/audio.js` の `SOUND_FILES` および `variantState` を参照。

## フォールバック合成

`src/audio/` に該当 mp3 ファイルが存在しない soundId は、起動時に `OfflineAudioContext` で内蔵合成（FM ベル + 非調和倍音 + コンボリューションリバーブ）を AudioBuffer にレンダして再生します。
合成レシピは `src/renderer/audio.js` の `SYNTH_DEFS` を参照。合成音は本プロジェクトの生成物のため attribution 不要です。

現状（STEP 4 仕上げ④時点）、**全7音とも mp3 ファイルから再生**されます。フォールバック合成は STEP 5 で予約された `start.mp3` のみ未配置です。
