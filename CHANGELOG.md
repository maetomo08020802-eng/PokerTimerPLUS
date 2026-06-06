# Changelog

All notable changes to PokerTimerPLUS+ will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## v2.5.0 — 2026-06-06

PokerTimerPLUS+ v2.5.0 をリリースします。保存トーナメントが増えると動作が激重になる問題を根治しました（背景画像・休憩スライドショーをトーナメント本体データから分離）。**見た目・操作感は従来と完全に同一**で、内部の画像の保存場所だけが変わります。

### ⚡ 改善：保存トーナメント激重問題の根治（画像分離）

**背景**:
- 各トーナメントの背景画像・休憩スライドショー画像（base64）が、毎秒読み書きされる `tournaments` データに直接埋め込まれており、保存件数が増えるほど一覧取得・保存が重くなっていた（実測: 設定ファイル 35.96MB の 99.7% が画像、毎操作の保存に約 527ms のブロッキングが発生）。

**対策（方式 A: 画像専用ファイルへ分離）**:
- 画像を専用ファイル `tournament-images.json` に分離し、`tournaments` データからは外した。
- 毎秒の一覧取得（`tournaments:list`）と毎操作の保存から画像が外れ、大幅に軽量化（実測: 一覧取得 8.3KB / 部分保存 0.76ms / IPC 搬送 0.19ms に短縮、設定ファイルは約 92KB に）。
- 画像が必要な表示経路は `tournaments:getImages(id)` で取得、または `getActive` / `setActive` / `save` の戻り値・hall への配信で再マージ。**背景画像・休憩スライドショー・設定プレビュー・左ペイン一覧・2 画面同期の見た目／挙動は現状と完全同一**。

**エクスポート簡素化**:
- エクスポート `.json` から背景画像・休憩スライドショーを除外（テロップを含む他の設定はすべて引き継ぐ）。USB 移動が大幅に軽量化。画像はローカル専用（PC 間で引き継がない）。
- 旧形式（画像入り）の `.json` を import しても画像を無視して正常に取り込む（後方互換）。`EXPORT_VERSION` は 2 据置。

**既存データの自動移行（安全・冪等）**:
- 初回起動時に、既存トーナメントの画像を自動で `tournament-images.json` へ移行（`config.pre-image-split.backup.json` にバックアップ → 移行 → 枚数・バイト一致を検証 → 一致した時だけ元データから除去）。検証不一致時は元データを変更せず次回再試行。
- 移行時もプレイヤー人数・リエントリー・アドオン（runtime 永続化）等は完全保持。ロールバック手順は `docs/specs.md` §3.6 参照。

### 🛡 既存機構の完全保持

- 致命バグ保護 5 件（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所）すべて維持。
- 既存テスト全 PASS 維持（1164 件）+ 画像分離の新規テスト 16 件追加（合計 1180 件）。

---

## v2.4.1 — 2026-05-30

PokerTimerPLUS+ v2.4.1（hotfix）をリリースします。開始前カウントダウンが 0 に着地した「後」にタイマーが動かず手動起動が必要になる不具合（症状①）を根治しました。

### 🐞 修正：開始前カウントダウン 0 着地後のタイマー停止（症状①）

**症状**:
- 開始前カウントダウンを設定して放置 → カウントが 0 になったがタイマーが動かず、手動で起動する必要があった

**真因（PRE_START 0 着地レース）**:
- operator（手元 PC）が送信した PRE_START の進行同期メッセージ（`{isActive:true}`）を main プロセスが自分自身に再送する経路があり、0 着地でタイマーが本始動（PRE_START → RUNNING）した「後」に、遅れて届いた古い同期メッセージがタイマーを PRE_START に巻き戻し、続く終了メッセージ（`{isActive:false}`）が `cancelPreStart` を呼んで IDLE まで戻していた（RUNNING → PRE_START → IDLE）

**修正**:
- `applyOperatorPreStartState` の復元分岐に、タイマーが既に本始動している（status が RUNNING / BREAK）ときは遅れて届いた古い PRE_START 同期 payload を破棄して巻き戻さないガードを追加（renderer 1 関数のみ）
- 正当な復元（HDMI 抜き差し後 / 再起動後の PRE_START 復元）は必ず初期化直後の IDLE 状態から行われるため影響なし
- 破棄を観測できる rolling-log ラベル `operator:applyPreStartState:discard-stale-restore` を追加

### 🛡 既存機構の完全保持

- 致命バグ保護 5 件（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所）すべて無変更
- `cancelPreStart` 経路・main.js の送信ロジック・timer.js・IPC は無変更（誤発火の抑止のみ）
- 回帰テスト v252（10 件）を追加。既存テスト全 PASS 維持（合計 1164 件）

---

## v2.4.0 — 2026-05-23

PokerTimerPLUS+ v2.4.0 をリリースします。日本国内利用前提として、フィー入力をデフォルト編集不可にし、店舗ごとに設定可能なプール率（初期値 0%）で賞金プールを算出する仕組みに改修しました（景品表示法・風営法対応）。

### 🎯 賞金プール計算改修（プール率対応）

**背景**:
- エントリー数連動でプライズ（賞金）が自動的に上がる旧ロジックは、景品表示法・風営法上のリスクがある
- v2.4.0 ではフィー入力をデフォルト readonly + 🔒 にし、店舗デフォルト プール率（初期値 0%）× フィー × 件数で賞金プールを算出する仕組みに変更

**新仕様**:
- **計算式**: `prize = Σ(各フィー × 件数 × 該当プール率 / 100)`、GTD ロジック `max(計算プール, GTD)` は維持
- **フィー編集**: デフォルト readonly + 🔒 表示。🔒クリックで解除確認ダイアログ → 編集可能 + 🔓 切替。保存・トーナメント切替・アプリ再起動で自動再ロック。クリック反転式（🔓 → 再クリックで即時ロック）
- **プール率**: 0〜100% 整数、各フィー個別（バイイン / リエントリー / アドオン）
- **店舗デフォルト**: 設定ダイアログ「ハウス情報」タブで編集、新規トーナメント作成時の初期値となる
- **案内文言**: フィー欄真下と解除ダイアログ内に「フィー入力時はプライズに反映されます（反映率設定可）」を表示

**既存ユーザー保護**:
- migration 補完で既存トーナメントは `poolRates: { buyIn: 100, reentry: 100, addOn: 100 }`（旧式と完全一致、TOTAL POOL 不変）
- 新規トーナメントのみ `appConfig.poolRatesDefault: { 0, 0, 0 }` で安全側初期化
- 「既存トーナメント開いた瞬間に TOTAL POOL が変わる」事象を構造的に防止

### 🛠 STEP 4 実装中のバグ修正経緯（透明性開示）

- STEP 4（UI 実装）で動的キー組立て `el[\`tournament${_capitalizeFeeTarget(target)}FeeLockBtn\`]` パターンによる「バイイン / アドオン 🔒 が無反応」バグが 2 回発生（前原実機検証で発見）
- 2 段目修正で `_capitalizeFeeTarget` 関数を撤廃、`_resolveFeeElements(target)` switch case 関数 + 直接 listener 登録に変更し構造的根治
- 再発防止テスト v210-T14 を追加（DOM ID と JS 参照キーの完全一致 + 動的キー組立て撤廃の静的検証 5 段）

### 🛡 既存機構の完全保持

- 致命バグ保護 5 件（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）
- v2.2.2 仮説 F 二段防御（PRE_START prevent-app-suspension + setTimeout フォールバック）+ 観測機構
- v1.x / v2.0.x で確立した全 fix（runtime 永続化 / dual-sync / PRE_START 機構等）

### ✅ テスト

- **1154 件全 PASS**（v2.2.2 比 +14 件、新規 `tests/v210-prize-pool-refactor.test.js` で v2.4.0 機構検証）
- 既存 55 ファイルの version assertion を `2.4.0` に一括更新

### 🔄 互換性

- v2.2.2 と完全互換、データ移行不要（migration で既存トーナメントに poolRates: 100% 補完）
- export/import JSON フォーマット `EXPORT_VERSION = 2` のまま optional フィールド扱い
- 自動更新で配信、ユーザー操作不要

---

配布元: Yu Shimomachi（PLUS2 運営）

---

## v2.2.2 — 2026-05-17

PokerTimerPLUS+ v2.2.2 をリリースします。v2.2.1 で発見された致命バグ（「スタートまで 30 分後」radio 選択時のカウントダウン停止）を二段防御で根治しました。

### 🚨 致命バグ修正（仮説 F: Windows OS レベルのプロセス suspension 二段防御）

**症状**（v2.2.1 で発生）:
- 「スタートまで 30 分後」のラジオボタンでカウントダウン開始 → 30 分後に Level 1 が 25:00 表示で停止する
- 発生条件: 長時間（30 分以上）のアイドル状態 + ノート PC 環境などで Windows が裏でアプリを一時停止した場合

**根本原因の構造的特定**:
- Electron の `backgroundThrottling: false` 設定は Chromium 内部の rAF throttling のみ抑制、Windows OS レベルの Modern Standby / プロセス suspension は対象外
- 30 分間 PRE_START 中に OS がアプリプロセスを suspend → rAF chain が discard → カウントダウン 0:00 検出経路の `startAtLevel(0)` は走るが、続く tick の rAF chain が動かず Level 1 表示で frozen

**二段防御**:

1. **第 1 防御線**: `prevent-app-suspension` powerSaveBlocker を PRE_START 中のみ並行発火
   - `main.js` の IPC ハンドラ `power:preventAppSuspension` / `power:allowAppSuspension` 追加
   - `renderer.js` の `syncPowerSaveBlocker` で PRE_START 中のみ blocker 起動
   - Windows / macOS で動作（Linux は no-op）、既存 `preventDisplaySleep` 経路とは独立した blocker ID で管理

2. **第 2 防御線**: setTimeout フォールバック追加
   - 万一第 1 防御で OS suspend が抑止しきれなくても、目標時刻 + 1 秒のバッファ経過で setTimeout callback が強制発動 → Level 1 を必ず開始
   - 仕掛け 3 経路（startPreStart / restorePreStart 非 paused / resume）、解除 3 経路（cancelPreStart / pause / preStartTick 0:00 検出）
   - 観測ラベル `prestart:fallback:fired` が本番ログで発火 = 仮説 F が現実に発生した決定的証拠

### 🔍 観測機構（仮説 F の確証 + 将来の本番監視）

- 観測ラベル 28+3 種類（`prestart:tick` / `timer:startLoop` / `timer:tick:raf-gap` / `prestart:fallback:scheduled` / `prestart:fallback:cleared` / `prestart:fallback:fired` 等）を `PRIORITY_LOG_LABELS` に追加
- 本番ログ（`priority-events.log` + `rolling-current.log`）に確実記録、ユーザー環境での再現解析を容易化

### 🛡 既存機構の完全保持

- 致命バグ保護 5 件（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）
- rc1〜rc10.1 機構（applyTimerStateToTimer 4 経路ガード + race 観測）
- v2.1.6〜v2.1.18 機構 + v2.1.19 重さ根治機構（setInterval 撤廃 + Promise dedup）

### ✅ テスト

- 1140 件全 PASS（v2.2.1 比 +14 件、新規 `tests/v251-prestart-fallback.test.js` で setTimeout フォールバック検証）

### 🔄 互換性

- v2.2.1 と完全互換、データ移行不要
- 自動更新で配信、ユーザー操作不要

---

配布元: Yu Shimomachi（PLUS2 運営）

---

## v2.2.1 — 2026-05-12

PokerTimerPLUS+ v2.2.1 を全国リリースします。v2.1.19（重さ根治版）に加え、HDMI ケーブル抜き差し時の安定性を大幅に向上させました。

### 🛠 修正

- **HDMI ケーブル抜き差し時のタイマー消失問題を根治**
  会場モニターを途中で抜き差ししたとき、まれにタイマー（特に開始前カウントダウン）が消えてしまう問題を修正しました。HDMI を挿し直した後も、設定したトーナメントとカウントダウンがそのまま継続します。

- **会場モニターの切り替えが安定**
  USB-HDMI アダプタ使用時の多重検知や、PC スリープ復帰直後の HDMI 再接続でのモード切替が、より確実に動作するようになりました。

- **手元 PC のタイマー操作（スペースキー一時停止、リセットなど）の信頼性向上**
  HDMI 抜き差し直後でも、手元 PC からの操作（スペースキーでの一時停止、リセットボタンなど）が確実に効くようになりました。

### 📦 v2.1.19 からの継承（変更なしで維持）

- アプリ全体の動作軽量化（タイマー一覧の更新頻度を 90% 削減）
- BREAK 終了演出、PRE_START 一時停止表示など、v2.1.18 までの全機能

### 🔍 内部改善（一般運用には影響なし）

- 万が一の不具合発生時に原因解析できるよう、軽量な動作ログを内部で記録する仕組みを追加（個人情報や店舗情報は記録されません）
- 動作ログはアプリ内「ログフォルダを開く」ボタンから確認可能、トラブル時に開発者へ送付できます

### ⚠️ アップグレード時の注意

- 自動更新で適用される場合、インストール完了まで **30〜60 秒** かかります。アプリを閉じてからすぐ再起動せず、少し待ってから起動してください
- 既存のトーナメント設定・ブラインド構造・各種設定はすべて引き継がれます

### 📝 詳細（技術者向け）

- HDMI 抜き差し時の競合状態を構造的に根治（timer.js の reset 関数に「PRE_START 保護フラグ」を追加、多層防御アーキテクチャ）
- ログ保管容量を最適化（本番版は 5 分、開発者向け計測ビルドは 30 分）
- 致命級競合の早期検出ラベル 3 種を低頻度監視ラベルとして配置

配布: GitHub Releases から自動更新（または手動ダウンロード可）
配布元: Yu Shimomachi（PLUS2 運営）

---

## [2.1.20-rc10.1] - 2026-05-12

PokerTimerPLUS+ v2.1.20-rc10.1 試験ビルド（前原さん実機専用、配布なし）。rc10-audit リリース前監査で検出された致命級 race 2 件 + 多層防御論理的死角の観測ラベル 3 個を追加（rc10-audit §4 §5 高優先 #1 / #2 / #10）。配信後の本番運用で race 発生頻度を事実ベース計測する基盤を確立。

### Added (観測強化)
- **`hdmi:display-removed:dual-sync-stale`**: display-removed 検出時、preStartState cache が 500ms 以上古い場合に警告ラベル発火。PRE_START 消失の早期発見用
- **`hdmi:dialog-blocked:switchOperatorToSolo`**: switchOperatorToSolo の所要時間が 50ms 超の場合に警告ラベル発火。autoUpdater ダイアログ等による Win32 メッセージループ遮断の race 検出用
- **`timer:reset:race-window-entry`**: rc8/rc9/rc10 ガード 5 経路の race window が 1ms 以上の場合に警告ラベル発火。多層防御 race の論理的死角を観測

### Infrastructure
- `_preStartStateCacheUpdatedAt` 変数追加（main.js）+ `_publishDualState` 内で preStartState cache 更新時刻記録
- `_switchStartTimeMs` 計測（main.js switchOperatorToSolo 関数内）
- `_raceEntryMs` / `_raceExitMs` 計測（renderer.js 5 経路、`performance.now()` ベース）
- PRIORITY_LOG_LABELS Set に新規 3 ラベル追加（priority-events.log に記録、配信後監視で活用）

### Maintained
- v2.1.20-rc10 (timer.js reset force フラグ + 5 経路 + 多層防御) 完全保持
- v2.1.20-rc9 (4 経路 ガード + trigger 4 種別) 完全保持
- v2.1.20-rc8 / rc7 / rc6-meas3 / rc5 / rc4 / rc3 / rc2 / rc1 機構 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持

### Notes
- 致命級 race 2 件は実機影響度低（rc10-audit §7 評価）、本 rc10.1 では**観測のみ**追加。構造的対処は v2.2.2 以降で事実ベース計測後に判断
- 試験範囲は標準セット（rc10-audit §5 試験 1〜6、所要 3〜4 時間）
- 試験合格後、rc11 で計測機構撤去 → v2.2.1 として全国配信予定

---

## [2.1.20-rc10] - 2026-05-12

PokerTimerPLUS+ v2.1.20-rc10 試験ビルド（前原さん実機専用、配布なし）。rc4〜rc9 で 5 連続失敗中の HDMI 抜き差し問題に対し、**構造的根本対策**を実施。並列 sub-agent 3 体で「PRE_START を消す全経路」を網羅特定 → timer.js `reset()` 関数本体に `force` フラグ引数を追加し、意図せぬ reset 経路 5 箇所を一括ガード。

### Fixed
- **timer.js `reset()` に `force` フラグ引数追加**（デフォルト `true`、後方互換完全）: `force: false` 指定 + `isPreStart === true` の場合は no-op で `false` 返却、PRE_START 状態を保護
- **意図せぬ reset 経路 5 箇所に `{ force: false }` を適用**: applyTimerStateToTimer 4 経路（invalid-ts / idle / finished / no-levels）+ initialize 復元失敗 fallback（L7603）
- **多層防御**: rc8/rc9 既存ガード（`isPreStartActive()` チェック）は保持、ガード抜けが起きても timer.js 内 `force` 引数で確実に塞ぐ
- 新規確証ラベル `timer:reset:skip-during-prestart`（5 ctx 値: 'applyTimerStateToTimer:invalid-ts' / ':idle' / ':finished' / ':no-levels' / 'initialize:restoredFromTimerState-false'）

### Maintained
- v2.1.20-rc9 (applyTimerStateToTimer 4 経路 PRE_START ガード) 完全保持、撤去せず多層防御として維持
- v2.1.20-rc8 (idle 経路ガード) 完全保持
- v2.1.20-rc7 / rc6-meas3 / rc5 / rc4 / rc3 / rc2 / rc1 機構 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持
- 意図的リセット経路 6 箇所（handleReset / resetBlindProgressOnly / handleTournamentListReset / 新規 / 複製 / applyOperatorPreStartState）は `force: true` デフォルトで従来動作維持

### Notes
- 案 D（timer.js state ↔ isPreStart 乖離防御）は本フェーズ範囲外（HDMI 問題と独立した潜在欠陥、別フェーズで対処）
- 案 E（main.js 観測強化）は本フェーズ範囲外（案 A 単独で根治見込み）
- timer.js `reset()` 関数本体は `window.api?.log?.write?` を呼ばない設計を維持（依存ゼロ、テスト性維持）。観測ラベルは呼出側 renderer.js から発火（rc6-meas3 で追加された `perf:raf:fire` は別関数 `_emitRafFire` 内で対象外）

---

## [2.1.20-rc9] - 2026-05-12

PokerTimerPLUS+ v2.1.20-rc9 試験ビルド（前原さん実機専用、配布なし）。rc8 試験で `state:transition` IDLE→PRE_START 復元成功確認 + 1.6 秒後に別経路 reset で PRE_START→IDLE に戻る race 発覚 → applyTimerStateToTimer の残り 3 経路にも同じスキップガードを追加して reset 経路を完全網羅。HDMI 抜き差し問題 真因根治 第 3 弾・網羅版。

### Fixed
- **applyTimerStateToTimer の残り 3 経路にも PRE_START 中スキップガード追加**: rc8 で idle 経路のみガードしていたが、rc8 試験で `state:transition` PRE_START→IDLE が `skip-reset-during-prestart` ラベル発火なしで起きていることを観測 → 残り 3 経路（invalid-ts / finished / levelCount===0）が真因と推定。3 経路すべてに同じ `isPreStartActive()` ガードを追加して PRE_START 復元直後の reset 経路を完全網羅
- **`trigger` フィールド追加でどの経路が発火したかを実機ログで識別可能化**（'idle' / 'invalid-ts' / 'finished' / 'no-levels' の 4 種別）

### Maintained
- v2.1.20-rc8 (applyTimerStateToTimer idle 経路ガード) 完全保持、trigger フィールド追加のみ
- v2.1.20-rc7 (preStartState cache merge + priority log 初期化漏れ修正) 完全保持
- v2.1.20-rc6-meas3 観測機構 完全保持
- v2.1.20-rc5 / rc4 / rc3 / rc2 / rc1 機構 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持
- meas1 / meas2 計測機構 + 症状確証 4 ラベル + rc2 / rc4 / rc5 / meas3 / rc7 / rc8 ラベル 完全保持

### Notes
- 修正は `applyTimerStateToTimer` の 4 経路すべて operator 側のみ、hall 側 else ブロック（rc2 hallTickState reset マーカー含む）は完全保持
- `handleTournamentListReset` 経由のリセットボタンは別経路で動作（`timerReset()` 直接呼出、`applyTimerStateToTimer` を介さない）= 影響なし
- 通常のトーナメント終了（finished）は PRE_START 中に発生し得ない（設計上）
- 不正値（invalid-ts）/ 構造未取得（levelCount===0）は一時的状態のため reset スキップしても preStartState 経路で正常管理

---

## [2.1.20-rc8] - 2026-05-12

PokerTimerPLUS+ v2.1.20-rc8 試験ビルド（前原さん実機専用、配布なし）。rc7 試験で発覚した「PRE_START 復元直後に勝手にキャンセルされる」新真因を根治。HDMI 抜き差し問題 真因根治 第 2 弾。

### Fixed
- **HDMI 抜き差し後の自動 PRE_START キャンセル race を根治**: rc6-meas3 観測でログから真因確定 = operator 起動時の `tournaments:getActive` → `applyTimerStateToTimer({status: 'idle'})` → `timerReset()` → `reset()` 内 `wasPreStart=true` で `handlers.onPreStartCancel()` 発火 → `publishPreStartIfOperator({isActive:false})` で main cache を破壊し PRE_START が全画面で消える race を解消。`applyTimerStateToTimer` の operator 経路で `isPreStartActive()` ガードを追加、PRE_START 中なら reset をスキップ
- 新規確証ラベル `operator:applyTimerStateToTimer:skip-reset-during-prestart`

### Maintained
- v2.1.20-rc7 (preStartState cache merge + priority log 初期化漏れ修正) 完全保持
- v2.1.20-rc6-meas3 観測機構（HDMI 自動採取 + 高頻度ラベル集約 + buffer 拡張 + 優先バッファ）完全保持
- v2.1.20-rc5 (preStartState operator 配信経路) 完全保持
- v2.1.20-rc4 (operator 側 PRE_START 復元 API) 完全保持
- v2.1.20-rc3 / rc2 / rc1 機構 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持
- meas1 / meas2 計測機構 + 症状確証 4 ラベル + rc2 / rc4 / rc5 / meas3 / rc7 ラベル 完全保持

### Notes
- 修正は `applyTimerStateToTimer` の `'idle'` 経路 operator 側のみ、他 status 経路（`'finished'` / `invalid-ts` / `levelCount === 0`）の `timerReset()` 呼出は **touch なし**（PRE_START 中の意図的リセットは別経路で動作する設計と整合）
- hall 側の処理は完全保持（v2.1.20-rc2 hallTickState reset 3 マーカー含む）
- 通常のリセットボタン（handleReset 経由 → `cancelPreStart()` 直接呼出）は **touch なし**で従来動作

---

## [2.1.20-rc7] - 2026-05-12

PokerTimerPLUS+ v2.1.20-rc7 試験ビルド（前原さん実機専用、配布なし）。rc6-meas3 観測強化で確定した HDMI 抜き差し問題の真因を構造的根治 + priority-events.log 初期化漏れ修正。

### Fixed
- **HDMI 抜き差し後の operator 復元失敗を根治**: rc6-meas3 ログ解析で真因確定 = main.js sanitization が tick / pause / resume / adjust 経由 publish 時の totalMs 欠落で `_dualStateCache.preStartState.totalMs` を失い、HDMI 挿し直し時の resync で operator の `restorePreStart` が早期 return していた問題を解消。`dual:publish-pre-start-state` ハンドラに field cache merge ロジックを追加し、欠落フィールドは前回 cache 値を維持
- **priority-events.log が生成されない問題を修正**: rc6-meas3 Fix C の `_initPriorityLogFile()` が誰からも呼ばれていなかった構造的不備を解消。`_appendPriorityLog` 冒頭に lazy init 呼出追加
- 新規確証ラベル `preStart:cache:merge`

### Maintained
- v2.1.20-rc6-meas3 観測機構（HDMI 自動採取 + 高頻度ラベル集約 + buffer 拡張 + 優先バッファ）完全保持
- v2.1.20-rc5 (preStartState operator 配信経路) 完全保持
- v2.1.20-rc4 (operator 側 PRE_START 復元 API) 完全保持
- v2.1.20-rc3 / rc2 / rc1 機構 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持
- meas1 / meas2 計測機構 + 症状確証 4 ラベル + rc2 / rc4 / rc5 / meas3 ラベル 完全保持

### Notes
- timer.js `restorePreStart` 関数本体は touch なし（rc4 で実装、totalMs ガードは健全な防御として維持）
- renderer.js `applyOperatorPreStartState` / `publishPreStartIfOperator` は touch なし（送信側の tick で totalMs を含めない設計も維持、main 側 merge で吸収）

---

## [2.1.20-rc6-meas3] - 2026-05-12

PokerTimerPLUS+ v2.1.20-rc6-meas3 観測強化版（前原さん実機専用、配布なし）。rc4/rc5 で実証された「修正が動作しているか観測すらできない」構造的問題への対処。HDMI 抜き差し問題の修正コードは触らず、観測機構そのものを強化。

### Added (観測強化)
- **HDMI 検出時の自動採取**: `display-removed` / `display-added` 検出時に過去 buffer 全内容を別ファイル `hdmi-snapshot-{ISO}-{suffix}.log` に fire-and-forget で保存。前原さんの Ctrl+Shift+L 押下タイミングに依存しない
- **高頻度ラベルの 1 秒集約**: `perf:render:duration`（124Hz）/ `hall:updatePipTimer:set`（60Hz）/ `perf:state:notify` を `perf:highfreq:summary` に集約、5 分 buffer が 20 秒で埋まる問題を解消
- **buffer 容量の計測ビルド時拡張**: 5 分 → 30 分、5000 行 → 50000 行（本番版は従来通り 5 分 / 5000 行）
- **優先バッファ**: HDMI 系・PRE_START 配信系・error 系ラベルは別ファイル `priority-events.log` に append（10000 行で循環）
- **新規ラベル**: `perf:highfreq:summary` / `meas3:hdmi-snapshot:written`

### Maintained
- v2.1.20-rc5 (preStartState operator 配信経路) 完全保持
- v2.1.20-rc4 (operator 側 PRE_START 復元 API) 完全保持
- v2.1.20-rc3 / rc2 / rc1 機構 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持
- meas1 / meas2 計測機構 + 症状確証 4 ラベル + rc2 hall:hallTickState:reset + rc4 operator:applyPreStartState:apply + rc5 preStart:operator:send + operator:preStartResync:sent 完全保持

### Performance Notes
- buffer 拡張により計測ビルド時のメモリ使用量が +20MB 程度増加（50000 行 × 平均 440B）
- `_flushLogsToFile` は fire-and-forget でファイル I/O が HDMI 切替を遅延させない設計
- 高頻度ラベル集約により 5 分 buffer 内に 5 分分の情報を収納可能に

---

## [2.1.20-rc5] - 2026-05-11

PokerTimerPLUS+ v2.1.20-rc5 試験ビルド（前原さん実機専用、配布なし）。rc4 で実装した operator 側 preStartState 受信機構が hall ブロック内の dead code 化していた構造的問題を根治。

### Fixed
- **operator 側 preStartState 配信経路を構造的に修復**: rc4 で追加した受信機構（`applyOperatorPreStartState` / `restorePreStart` / `handleStartPauseToggle` PRE_START 分岐）はそのまま生かし、配信側（main.js）と購読側（renderer.js operator/operator-solo ブロック）を新規追加することで動作可能化。HDMI 抜き差し後の operator 再生成時に PRE_START カウントダウンが消失して Space キーが「タイマースタートダイアログ」を開く症状を根治
- main.js `_publishDualState` で `kind === 'preStartState'` のときに operator (mainWindow) にも `dual:state-sync` を送信する経路追加
- main.js `switchSoloToOperator` で新 operator window load 完了後に cache から preStartState を 1 回送信する経路追加（broadcast race の二重保険）
- renderer.js operator / operator-solo ブロックに `subscribeStateSync` 経路追加（preStartState だけ拾って `applyOperatorPreStartState` 呼出）
- 新規ラベル `preStart:operator:send` / `operator:preStartResync:sent`

### Maintained
- v2.1.20-rc4 (operator 側 PRE_START 復元 API: `restorePreStart` + `applyOperatorPreStartState` + `handleStartPauseToggle` PRE_START 分岐) 完全保持
- v2.1.20-rc3 (スライドショー始動復活 + renderTournamentList Promise dedup) 完全保持
- v2.1.20-rc2 (hallTickState reset 3 経路) 完全保持
- v2.1.20-rc1 (重さ根治 4 件) 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持
- v2.1.20-meas1 計測機構 完全保持（次フェーズで撤去 → v2.2.1 本番リリース予定）

---

## [2.1.20-rc4] - 2026-05-11

PokerTimerPLUS+ v2.1.20-rc4 試験ビルド（前原さん実機専用、配布なし）。rc3 試験で発覚した「HDMI 抜き差し後 operator 操作不可」の構造的問題を根治。

### Fixed
- **operator 側 preStartState 受信機構を追加**: HDMI 抜き差し後 operator renderer 再生成時に PRE_START 状態が消失して操作不可になる構造的問題を根治。timer.js に `restorePreStart(payload)` API 新規追加 + renderer.js の dual-sync ハンドラに operator 経路追加 + handleStartPauseToggle に PRE_START 分岐追加。これにより HDMI 抜き差し以外の operator 再起動シナリオでも PRE_START 復帰が可能に
- 新規確証ラベル `operator:applyPreStartState:apply`

### Maintained
- v2.1.20-rc3 (スライドショー始動復活 + renderTournamentList Promise dedup) 完全保持
- v2.1.20-rc2 (hallTickState reset 3 経路) 完全保持
- v2.1.20-rc1 (重さ根治 4 件: setState 撤廃 + DocumentFragment + memo + CSS 統一) 完全保持
- v2.1.19 重さ根治機構 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構 完全保持
- v2.1.20-meas1 計測機構 完全保持（次フェーズで撤去 → v2.2.1 本番リリース予定）

---

## [2.1.20-rc3] - 2026-05-11

PokerTimerPLUS+ v2.1.20-rc3 試験ビルド（前原さん実機専用、配布なし）。rc2 試験で発覚した退行 2 件を最小修正で対処。本番 v2.2.1 リリース直前の最終形態。

### Fixed
- **PRE_START 中のスライドショー始動復活**: rc1 Fix 3 で追加した `syncSlideshowFromState` の hall PRE_START active ガードを撤去。rc1 Fix 1 で `renderHallTickFrame` の 60Hz setState 連鎖が消えたため、流れ込み防止のガードは不要だった。ガードが過剰防御でスライドショー始動経路自体を止めていた退行を解消
- **新規/複製ボタン押下時の 2 倍表示根治**: `renderTournamentList` を Promise dedup ラッパ `renderTournamentListWithDedup` で包み、非同期描画中の並行呼出を 1 本化。既存 `_tournamentsListDedup` (tournaments.list IPC 1 本化) と同パターンで、innerHTML='' と appendChild の race による fragment 二重 append を根絶

### Maintained
- v2.1.20-rc2 hallTickState defensive 初期化 3 経路 完全保持
- v2.1.20-rc1 軽量化機構（setState 撤廃 + DocumentFragment + memo + 症状 1 修正）完全保持
- v2.1.19 重さ根治機構（setInterval 撤廃 + Promise dedup）完全保持
- 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構すべて完全保持
- v2.1.20-meas1 計測機構完全保持（次フェーズで撤去 → 本番 v2.2.1 リリース予定）

---

## [2.1.20-rc2] - 2026-05-11

PokerTimerPLUS+ v2.1.20-rc2 試験ビルド（前原さん実機専用、配布なし）。rc1 試験で発覚した「HDMI 抜き差し時の hall タイマー止まらず」退行を defensive 初期化 3 箇所で根治。rc1 の軽量化機構（setInterval 撤廃 / Promise dedup / setState 撤廃 / DocumentFragment / memo 化 / 症状 1/2 修正）はすべて完全保持。

### Fixed
- **HDMI 抜き差し時の hall タイマー止まらず退行**: `applyTimerStateToTimer` hall 経路 / `applyHallPreStartState` isActive=false 経路 / hall window 起動経路 の 3 箇所で `hallTickState` の defensive 初期化を追加、HDMI 再生成シーンで前トーナメントの seed が残存する race を防ぐ

### Maintained
- v2.1.20-rc1 軽量化機構（setState 撤廃 + DocumentFragment + memo + 症状 1/2 修正）完全保持
- v2.1.19 重さ根治機構（setInterval 撤廃 + Promise dedup）完全保持
- 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構すべて完全保持
- v2.1.20-meas1 計測機構完全保持（次フェーズで撤去予定）

### Known Issues（v2.1.21 以降で対処予定）
- Op 8 で 1952ms（約 2 秒）のメインスレッドブロック が 1 回観測（再現性低、再起動で復旧）。本 rc2 の defensive 初期化で「hall タイマー止まらず」症状は防げるが、根本原因は計装ラベル不足で確定不可。v2.1.21 で計装追加 + 再観測予定
- `state:transition` ログが operator + hall の両方で記録される二重出力（無害、ログ汚染のみ）。v2.1.21 で role 区別ガード追加予定

---

## [2.1.20-rc1] - 2026-05-11

PokerTimerPLUS+ v2.1.20-rc1 試験ビルド（前原さん実機専用、配布なし）。v2.1.20-meas1 計測ビルドで真因 100% 確定 → 重さの主犯（renderHallTickFrame の 60Hz setState 連鎖）+ renderTournamentList 1 回 500ms + 症状 1/2 を最小修正で一気に対処。計測機構は完全保持（効果計測のため、次フェーズで撤去）。

### Performance
- **重さの真の主犯撤廃**: `renderHallTickFrame` の `setState({remainingMs})` 60Hz 呼出を削除、DOM 直接書込に変更（subscribe 連鎖 50〜60Hz → 0、renderTime 120Hz → 60Hz、renderHallPreStartTick と同設計に統一）
- **renderTournamentList 軽量化**: `DocumentFragment` 経由で reflow 回数を N → 1 に削減 + `computeLiveTimerState` を秒粒度でメモ化（1 回 500ms → 200ms 程度の見込み）

### Fixed
- **症状 1**: 会場モニター PRE_START 一時停止時の「一時停止中」テロップが左下小さく表示される問題を、通常 PAUSED と同じ「真ん中大きく枠付き」表示に統一
- **症状 2**: 会場モニター PRE_START 一時停止時の右下カウントダウン枠に「01:00」が一瞬表示される問題を、主犯撤廃 + subscribe gate 二重防御で根治

### Compatibility
- v2.1.6〜v2.1.19 機構完全互換、致命バグ保護 5 件無傷
- v2.1.20-meas1 計測機構完全保持（次フェーズで撤去予定）
- 単画面モード完全同一

---

## [2.1.20-meas1] - 2026-05-10

PokerTimerPLUS+ v2.1.20-meas1 計測ビルド（前原さん実機専用、配布なし）。v2.1.19 本番リリース後の残り重さ網羅観測 + 症状 1/2 真因確証用。

### Added (meas2 新規 6 カテゴリ)
- カテゴリ A: setInterval 経路網羅（`_wrappedSetInterval` + `perf:interval:fire`）
- カテゴリ B: requestAnimationFrame 経路網羅（`_wrappedRAF` + `perf:raf:summary` 1 秒集計 + `perf:raf:fire` 単発）
- カテゴリ C: IPC channel 別カウント（`perf:ipc:summary` 30 秒集計）
- カテゴリ D: DOM 書き換え頻度サマリ（`perf:dom:summary` 30 秒集計）
- カテゴリ E: Long Task 検出（PerformanceObserver で 50ms 超ブロッキング検出、`perf:long-task`）
- カテゴリ F: subscribe 通知頻度サマリ（`perf:subscribe:summary` 30 秒集計、`subscribeNamed` API 追加）
- カテゴリ G: 症状 1/2 真因確証 4 ラベル（`hall:syncSlideshowFromState:call` / `hall:updatePipTimer:set` / `hall:applyHallPreStartState:apply` / `hall:clock-pause-label:visibility`）

### Restored (meas1 機構を完全復活)
- 計測バッジ + Ctrl+Shift+L 拡張 + 5 分 rolling + preload `_measuredInvoke` ラッパ
- meas1 既存 15 ラベル（perf 系 6 + バグ発見系 9）

### Maintained
- v2.1.19 重さ根治機構（setInterval 撤廃 + Promise dedup）完全保持
- 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構すべて完全保持
- 単画面モード完全互換

---

## [2.1.19] - 2026-05-10

PokerTimerPLUS+ v2.1.19 本番リリース。「アプリが重い」体感の主犯（`tournaments:list` IPC の常時暴走発火 1.5〜28.8 回/秒）を、計測ビルド観測 → 真因確定 → 最小修正の 3 段階で根治。設定タブ表示中 90% 減 / 編集モード 80% 減 / 通常進行 80% 減を達成。前原さん実機試験 OK、退行なし、致命バグ保護 5 件・v2.1.6〜v2.1.18 機構すべて完全保持。

### Performance
- **重さの主犯撤廃**: `setInterval(renderTournamentList, 1000)` を撤去し subscribe 経由 + 1 秒 throttle のイベント駆動に置換、ベース 1 Hz の強制 fetch を廃止
- **Promise dedup**: `tournaments.list` の 12 箇所呼出を in-flight 1 本化ラッパ `_tournamentsListDedup()` で統一、4ms 差の重複発火を根絶

### Compatibility
- v2.1.6〜v2.1.18 機構完全互換、致命バグ保護 5 件無傷
- 単画面モード完全同一
- v2.1.18-meas1 計測機構（バッジ + 15 ラベル + Ctrl+Shift+L 拡張）は本番版から完全撤去、Ctrl+Shift+L の基本ログ保存機能は維持

### Known Issues
- 会場モニター（hall）側の PRE_START 一時停止時に「一時停止中」オレンジテロップが出ない既存症状あり（v2.1.18 以前から存在、優先度低、v2.1.20 で対処予定）

---

## [2.1.19-rc2] - 2026-05-10

PokerTimerPLUS+ v2.1.19-rc2 試験ビルド（前原さん実機確認用、配布なし）。v2.1.19-rc1 の重さ根治機構を完全保持しつつ、v2.1.18-meas1 で追加した計測機構（バッジ + 15 ラベル + Ctrl+Shift+L 拡張）を全撤去。本番 v2.1.19 リリース直前の最終形態。

### Removed
- 計測ビルド黄色バッジ（HTML + CSS + 表示分岐）
- 計測ラベル 15 個（perf:* / state:transition / dual-sync:apply / meas:session:start / meas:capture / error:caught:* / ui:keypress / ui:click:major のうち meas1 追加分）
- Ctrl+Shift+L 拡張（op 連番 + フォルダ自動表示）
- preload.js の `_measuredInvoke` ラッパ（perf:ipc:roundtrip 計測用）
- main.js の 30 秒間隔 `perf:memory:rss` setInterval

### Maintained
- v2.1.19-rc1 重さ根治機構（setInterval 撤廃 + Promise dedup）完全保持
- 致命バグ保護 5 件 + v2.1.6〜v2.1.18 機構すべて完全保持
- Ctrl+Shift+L の基本ログ保存機能（v2.0 系基本機能）維持
- 単画面モード完全互換

---

## [2.1.19-rc1] - 2026-05-09

PokerTimerPLUS+ v2.1.19-rc1 試験ビルド（前原さん実機専用、配布なし）。v2.1.18-meas1 計測ビルドで Op 1〜6 観測 → tournaments:list IPC 暴走（1.5〜28.8 回/秒）の真因特定 → setInterval 主犯撤廃 + Promise dedup の最小修正で 90% 改善見込みを実装。計測機構 (バッジ + 15 ラベル + Ctrl+Shift+L 保存) は効果計測のため完全保持。

### Performance
- **重さの主犯撤廃**: `setInterval(renderTournamentList, 1000)` を削除し subscribe 経由 + 1 秒 throttle のイベント駆動に置換、ベース 1 Hz の強制 fetch を廃止
- **Promise dedup**: `tournaments.list` の 12 箇所呼出を in-flight 1 本化ラッパ `_tournamentsListDedup()` で統一、4ms 差の重複発火を根絶

### Compatibility
- v2.1.6〜v2.1.18 機構完全互換、致命バグ保護 5 件無傷
- v2.1.18-meas1 計測機構完全保持（次フェーズで撤去予定）
- 計測バッジは `-meas\d*$` に加えて `-rc\d+$` にも反応するよう拡張（試験ビルド可視識別目的、本番版 `2.1.19` 等は影響なし）
- 単画面モード完全同一
- 配布なし、前原さん PC 専用、main / tag / Release 未実施

---

## [2.1.18-meas1] - 2026-05-09

PokerTimerPLUS+ v2.1.18-meas1 計測ビルド（前原さん実機 1 日集中観測専用、配布なし）。v2.1.18 本番ベースにパフォーマンス系 6 ラベル + バグ発見系 9 ラベル合計 15 個の計測ログを追加、Ctrl+Shift+L で操作ごとのログを別ファイル保存する機構を整備。画面右下に「計測ビルド」識別バッジ常時表示。1 日集中運用後、v2.1.19 改善版を別途構築士が設計予定。

### Added
- 計測ビルド識別バッジ（画面右下、本番版では非表示）
- パフォーマンス系 6 ラベル（perf:render:duration / perf:ipc:roundtrip / perf:tick:fps / perf:memory:rss / perf:state:notify / perf:dom:rebuild）
- バグ発見系新規 4 ラベル + 既存 try/catch 主要 10 箇所の error:caught:* + ui:keypress / ui:click:major
- Ctrl+Shift+L で `op-{NN}-{timestamp}.log` 形式の操作別ログ保存機構（既存「ログフォルダを開く」動作に追加で操作別スナップショット保存を実装）

### Compatibility
- v2.1.18 本番機構完全保持、致命バグ保護 5 件無傷
- 単画面モード完全同一
- すべての rollingLog 呼出は try/catch で握り潰し、本体動作に副作用なし
- 配布なし、前原さん PC 専用、main / tag / Release 未実施

---

## [2.1.18] - 2026-05-09

PokerTimerPLUS+ v2.1.18 PRE_START 一時停止時の hall 表示破綻を真の根治 + トーナメント終了演出新規実装。v2.1.17 / v2.1.18-rc1 で 2 連続失敗していた hall 側 dual-sync `setState({dual_*})` が subscribe を無条件 notify する経路を、subscribe 内 gate 4 行追加で根治。最終レベル時間切れ時に「トーナメント終了 / TOURNAMENT COMPLETE」オレンジ枠永続表示を新規追加。

### Fixed
- **PRE_START 一時停止時の hall 表示破綻（v2.1.17 / v2.1.18-rc1 で 2 連続失敗の真因確定）**: hall 側 subscribe (`renderer.js`) で `renderTime(state.remainingMs)` が `dual-sync._applyDiffToState` の `setState({dual_timerState})` 経路で無条件発火し、hall 起動時 `applyTimerStateToTimer` idle 経路でセットされた `state.remainingMs`（= Lv1 duration）が PRE_START 表示を上書きしていた真因を、subscribe 内で `if (!(window.appRole === 'hall' && hallPreStartState.isActive))` gate を 4 行追加することで根治
- **二重防御保持**: rc1 で投入した A+B 二重防御（hall 受信側 `applyTimerStateToTimer` gate + 送信側 `captureCurrentTimerState` の `isPreStartActive()` 拡張）も完全保持、将来の経路追加時の防御として有効

### Added
- **トーナメント終了オーバーレイ**: 最終レベル時間切れ時に hall 中央へ「トーナメント終了 / TOURNAMENT COMPLETE」をオレンジ枠（#FF8C1A、一時停止表示と同等）で永続表示。リセット / 新規トーナメント / `resetBlindProgressOnly` で解除。`timer.js` `advanceToNextLevel` の最終レベル完走検知 → `onTournamentComplete` handler 経由で hall + operator 同時に `clock--timer-finished` クラス付与、既存 `normalizeTimerState` の `'finished'` 経路を再利用（新規 IPC 追加なし）

### Internal
- v2.1.18-rc2 で投入した計測ログ 4 個（hall:subscribe:fire / hall:renderTime:enter / hall:setState:dual / hall:dataset:status:write）を完全撤去
- 既存テスト 2 件（audit-fix T4 / v204-rc8 Fix 4）を robust 化済（balanced-brace 抽出 + 1500 文字ウィンドウ拡大、本質意図維持）

### Compatibility
- v2.1.6〜v2.1.17 機構完全互換、致命バグ保護 5 件無傷
- 単画面モード完全同一
- 自動更新で v2.1.16 / v2.1.17 / v2.1.18-rc1 / rc2 端末から取得可能

---

## [2.1.17] - 2026-05-09

PokerTimerPLUS+ v2.1.17 ① PRE_START 一時停止 hall 同期の真の根治リリース。v2.1.15/v2.1.16 で 2 連続失敗していた真因を rc1/rc2 観測ビルドで完全特定（main.js sanitization で isPaused フィールドがフィルタアウトされていた）→ 本リリースで 1 行修正により完全根治。

### Fixed
- **① PRE_START 一時停止が hall に届かない（v2.1.15/v2.1.16 で 2 連続失敗の真因確定）**: `main.js` の `dual:publish-pre-start-state` IPC ハンドラの payload sanitization で `isPaused` フィールドが転送されておらず（v2.1.6 ハンドラ新設時に v2.1.15 で追加された機構を見落とし）、operator 側で `{isActive:true, isPaused:true}` を送信しても hall 側で常に `isPaused` が undefined → false 化していた真因を、`if (typeof payload.isPaused === 'boolean') sanitized.isPaused = payload.isPaused;` 1 行追加で根治
- **試験 5 修正継続**: rc1 で追加した `handlePipShowSlideshow` 内の `slideshowState.breakStartedAt = null` リセットは引き続き有効

### Internal
- v2.1.17-rc1 / v2.1.17-rc2 で追加した計測ログ 12 ラベル（meas:pause:preStartCheck / meas:pause:onPreStartPause:call / :skipped / meas:onPreStartPause:invoked / meas:publishPreStart:enter / :exit:ok / :exit:err / meas:hall:applyPreStart:detail / :pausedBranch / :activeBranch / meas:hall:renderPreStartTick:enter / meas:hall:applyTimerState:hallPreStartConflict）を完全撤去
- v2.1.17-rc1/rc2 計測モードバッジを完全撤去
- v2.1.15 / v2.1.16 で実装した onPreStartPause / onPreStartResume / hallPreStartState.isPaused / dataset.prestartPaused / Object.prototype.hasOwnProperty.call defensive はすべて完全保持（main.js 真因とは独立した防御として有効）

### Compatibility
- v2.1.14 / v2.1.15 / v2.1.16 機能完全互換、致命バグ保護 5 件無傷
- v2.1.6〜v2.1.16 機構すべて完全保持
- 単画面モード完全同一

---

## [2.1.16] - 2026-05-09

PokerTimerPLUS+ v2.1.16 v2.1.15 残課題根治リリース。① PRE_START 一時停止 hall 同期の不完全根治（time-adjust で isPaused 上書きされる設計ミス）+ ③ 根治で顕在化した試験 4 既存潜伏バグ（PAUSED 中スライドショー復帰不可）を一括根治。

### Fixed
- **① PRE_START 一時停止が hall に届かない（v2.1.15 では time-adjust で上書きされていた残課題）**: `onPreStartAdjust` / `onPreStartTick` で `isPaused` 現状値を維持して送信、hall 側 `applyHallPreStartState` で `isPaused` フィールド未指定時は現状値維持の防御二重化
- **試験 4 退行根治: BREAK / PRE_START 中の PAUSED 状態でスライドショー復帰ボタンが効かない**: `isSlideshowEligibleStatus` を拡張し、PAUSED 中でも BREAK 行 / PRE_START active ならスライドショー継続を許可（v2.1.15 の ③ 根治で BREAK 検出が機能して初めて顕在化した既存潜伏バグ）

### Internal
- 修正 1 ファイル（renderer.js）+ package.json + CHANGELOG + 新規テスト v228（10 件）
- v2.1.15 で実装した onPreStartPause / onPreStartResume / hallPreStartState.isPaused / dataset.prestartPaused 機構はそのまま完全保持

### Compatibility
- v2.1.14 / v2.1.15 機能完全互換、致命バグ保護 5 件無傷
- v2.1.6〜v2.1.15 機構すべて完全保持
- 単画面モード完全同一

---

## [2.1.15] - 2026-05-09

PokerTimerPLUS+ v2.1.15 ①②③ 統合根治リリース。2 画面運用初日 (2026-05-09) に発覚した未解決 3 件を rc1 観測ビルド経由で真因確定し、本リリースで一括根治。

### Fixed
- **③ BREAK 中スライドショー自動起動しない**: renderer.js の import 文に `isBreakLevel` が含まれていなかったため `typeof isBreakLevel === 'function'` ガードで silent fail し、BREAK 検出が常に false を返していた潜伏バグを根治。import 追加 1 行で根治、副作用なし
- **② BREAK 中 operator ヘッダー「レベル：N」表示異常**: ③ と同じ `isBreakLevel` 未 import + `updateOperatorStatusBar` のヘッダー表示ロジックが BREAK 行を考慮していなかった問題を根治。新規ヘルパー `computeHeaderLevelText` で BREAK 行は「次のレベル: Lv N」表示、通常レベルは BREAK 行を除いた連番表示に変更
- **① PRE_START 中の一時停止が hall に届かない**: timer.js `pause()` / `resume()` 関数に `handlers.onPreStartPause` / `onPreStartResume` 通知を追加。preStartState broadcast に `isPaused` フィールドを拡張、hall 側で受信時に rAF 停止 + 「一時停止中」ラベル表示

### Internal
- v2.1.15-rc1 観測ビルドで追加した計測ログ 6 か所（meas:〜 ラベル）を完全撤去
- v2.1.15-rc1 計測モードバッジ（赤背景表示）を撤去
- 既存テスト 918 件 + v227 新規テスト（①②③ 根治確認）追加

### Compatibility
- v2.1.14 機能完全互換、致命バグ保護 5 件無傷
- v2.1.6〜v2.1.14 機構すべて完全保持
- 単画面モード完全同一

---

## [2.1.14] - 2026-05-09

PokerTimerPLUS+ v2.1.14 BREAK 中スライドショー不発の構造同期 2 穴 + ログ過剰の根治リリース（3 ファイル / 約 30 行）。

### Fixed

- **BREAK 中スライドショー自動起動が不発する退行を根治**（前原さん発見、v2.1.13 配布後 2 画面実機）。症状 = BREAK 10 分設定、開始 30 秒以上経過してもスライドショーが起動しない。真因 = hall 側 `isBreakLevel(idx) === false` 確定の構造同期 2 穴。穴 1（起動時）= `_dualStateCache.structure` の初期値 null、`dual:state-sync-init` ハンドラ (main.js) は timerState / displaySettings / marqueeSettings / tournamentRuntime / tournamentBasics / audioSettings / venueName / logoUrl は active から補完するが **structure だけ補完がない** → hall 起動時 snapshot.structure === null → setStructure(null) → currentStructure = null → isBreakLevel(idx) === false 確定。穴 2（切替時）= `tournaments:setActive` ハンドラが **structure broadcast なし** → tournamentBasics 受信 → hall 側 loadPresetById async fallback (renderer.js:7137-7146) の遅延の間 structure 更新が遅延。修正 = `tournaments:setActive` で `_publishDualState('structure', preset)` 追加、`dual:state-sync-init` snapshot に structure 補完追加（active.blindPresetId 経由 userPresets / BUILTIN_PRESETS 二段検索 + Array.isArray(preset.levels) 型ガード）。
- **hall 側 `render:tick:hall` ログ過剰発火による IPC 負荷を削減**（前原さんログ 1412 件 / 20 秒 ≒ 70Hz 観測、副次真因 = 「アプリ重い」体感の一因）。真因 = v2.1.11 hall 自前 60fps tick (`renderHallTickFrame`) が毎フレーム `setState({remainingMs})` を発火する設計の副作用で、subscribe → 当ログが 60Hz 近く発火 → IPC 経由で main に流れて hall ウィンドウ重さの一因。修正 = `state.status !== prev.status || state.currentLevelIndex !== prev.currentLevelIndex` の条件付き発火に変更、frequency を数 Hz に圧縮、IPC 負荷削減 + アプリ重さ改善。

### Internal

- `src/main.js` `tournaments:setActive` ハンドラに `_publishDualState('structure', preset)` 追加（穴 2 根治、約 11 行）
- `src/main.js` `dual:state-sync-init` ハンドラに `snapshot.structure === null` ガード付きの structure 補完追加（穴 1 根治、約 13 行）
- `src/renderer/renderer.js` `render:tick:hall` ログを `state.status !== prev.status || state.currentLevelIndex !== prev.currentLevelIndex` の条件付き発火に変更（副次真因削減、appRole === 'hall' ガードの内側に追加 if ネスト）
- 既存 fallback 経路（renderer.js:7137-7146 の loadPresetById）は無傷で残置（保険）
- timer.js / dual-sync.js / state.js / preload.js / audio.js すべて完全無変更
- v2.1.6〜v2.1.13 機構（PRE_START broadcast / hall atomic update / hall 60fps tick / userOverride リセット / `data-status` セット）はすべて完全保持
- 致命バグ保護 5 件すべて完全無傷

### Tests

- 新規テスト 10 件 (v226): T1〜T3（Fix 1 = tournaments:setActive structure broadcast 経路 + userPresets/BUILTIN_PRESETS or フォールバック + Array.isArray 型ガード）/ T4〜T5（Fix 2 = dual:state-sync-init snapshot.structure null ガード + 二段検索 + 型ガード）/ T6〜T7（Fix 3 = status/level 変化時の条件付き発火 + appRole='hall' ガード内ネスト）/ T8（package.json version 2.1.14）/ T9（致命バグ保護 5 件 cross-check）/ T10（v2.1.6〜v2.1.13 機構 touch なし）
- 既存テスト 908 件（v2.1.13 時点）+ 新規 v226 10 件 = 想定 918 件全 PASS 維持
- 既存 36 ファイルの version assertion を `2.1.13` → `2.1.14` に更新

### Compatibility (v2.1.14)

- 単画面モード（hall window なし）は完全同一の挙動（hall 専用経路 + IPC ハンドラ修正のみ、operator-solo モードでは `dual:state-sync-init` が呼ばれない）
- v2.1.13 で確立した hall PRE_START data-status セット経路は完全保持
- v2.1.6〜v2.1.13 機構すべて維持
- 致命バグ保護 5 件すべて完全無傷
- 既存 fallback 経路（renderer.js:7137-7146 の loadPresetById）は保険として残置（structure broadcast と二重実行になるが setStructure は冪等で副作用なし）
- v2.1.13 → v2.1.14 自動更新で配信

### Known Limitations

- B3 ブレイク終了 pauseAfterBreak 反映漏れは引き続き v2.1.15 以降候補
- 計測機構は本リリースでも保険として保持（render:tick:hall の頻度減で hall ウィンドウのログ採取が読みやすくなる）

---

## [2.1.13] - 2026-05-09

PokerTimerPLUS+ v2.1.13 hall 側 PRE_START の `data-status` セット漏れ根治リリース（4 行修正）。

### Fixed

- **hall 側 PRE_START 中の「トーナメントスタートまで」ラベル + 時間フォーマット切替の不発火を根治**（前原さん発見、v2.1.12 配布後実機）。症状 = 「タイマー開始前のカウントダウンなのに『タイマースタートまで』という文字が無くなっており、なにかもうトーナメントが始まったかのような表示になっている」。真因 = CSS の `.clock[data-status="PRE_START"] .clock__pre-start-label` 表示と `.clock[data-status="PRE_START"][data-prestart-format="hms|ms"] .clock__time` フォーマット切替が `el.clock` 要素に `data-status="PRE_START"` 属性が付いた時のみ発火する設計だが、v2.0.3「PRE_START は永続化しない」設計のため hall 側 `state.status` は IDLE のまま → subscribe 経由の `renderControls(IDLE)` しか呼ばれず `el.clock.dataset.status = 'IDLE'` で固定 → CSS の表示制御が**全部発火しない**（v2.1.6 から潜伏）。修正 = `renderHallPreStartTick` 内で毎フレーム `el.clock.dataset.status = 'PRE_START'` を idempotent にセット、`applyHallPreStartState` の解除経路で `el.clock.dataset.status = 'IDLE'` + `delete el.clock.dataset.prestartFormat` で復元。

### Internal

- `src/renderer/renderer.js` `renderHallPreStartTick` の `el.time` 書込ブロック内、`el.clock.dataset.prestartFormat` セット直前に `el.clock.dataset.status = 'PRE_START'` の 1 行追加（毎フレーム idempotent 書込、CSS 副作用なし）
- `src/renderer/renderer.js` `applyHallPreStartState` の `isActive=false` 解除経路に `el.clock.dataset.status = 'IDLE'` + `delete el.clock.dataset.prestartFormat` の 3 行追加（解除明示、subscribe → renderControls との race 排除）
- timer.js / dual-sync.js / state.js / main.js / audio.js すべて完全無変更
- v2.1.11 hallTickState / renderHallTickFrame / renderHallPreStartTick rAF 自己再帰経路は完全保持
- v2.1.12 で確立した `el.time.textContent = formatPreStartTime(...)` 経路 + subscribe 内 `userOverride='auto'` リセット経路は完全保持
- 致命バグ保護 5 件すべて完全無傷

### Tests

- 新規テスト 7 件 (v225): renderHallPreStartTick 内の data-status="PRE_START" セット存在 / セット位置（el.time 書込同ブロック内 + prestartFormat 直前隣接）/ applyHallPreStartState 解除経路の data-status="IDLE" 復元 / 同経路の delete prestartFormat / package.json version 2.1.13 / 致命バグ保護 5 件 cross-check / v2.1.11 機構（hallPreStartState・hallTickState・renderHallTickFrame）touch なし
- 既存テスト 901 件（v2.1.12 時点）+ 新規 v225 7 件 = 想定 908 件全 PASS 維持
- 既存 36 ファイルの version assertion を `2.1.12` → `2.1.13` に更新

### Compatibility (v2.1.13)

- 単画面モード（hall window なし）は完全同一の挙動（hall 専用関数の修正のみ、operator-solo / operator では実行されない）
- v2.1.12 で typo 修正された hall PRE_START 時間表示は本リリースでも完全動作（Fix 1 は同ブロック内の隣接追加で経路非破壊）
- v2.1.6 / v2.1.7 / v2.1.8 / v2.1.9 / v2.1.10 / v2.1.11 / v2.1.12 機構すべて維持
- 致命バグ保護 5 件すべて完全無傷
- v2.1.12 → v2.1.13 自動更新で配信

### Known Limitations

- B3 ブレイク終了 pauseAfterBreak 反映漏れは引き続き v2.1.14 以降候補
- 計測機構は本リリースでも保険として保持

---

## [2.1.12] - 2026-05-09

PokerTimerPLUS+ v2.1.12 退行 2 件のピンポイント根治リリース。

### Fixed

- **症状 B 根治**: BREAK 中のスライドショーが起動しなくなる退行（前原さん発見、v2.1.11 試験中）。真因 = `handlePipShowTimer`（「タイマー画面にもどす」ボタン）が `slideshowState.userOverride = 'force-timer'` をセット → リセット経路が `syncSlideshowFromState` 内の `!eligibleStatus` 経路（status RUNNING 等）のみで、BREAK 突入後も hall 側で毎フレーム `setState({remainingMs})` 経由で subscribe → syncSlideshowFromState が発火 → `userOverride === 'force-timer'` early return が継続発火 → BREAK 中も activateSlideshow が呼ばれない。修正 = subscribe コールバック内で status 変化時に `slideshowState.userOverride = 'auto'` を自動リセット（autoEndedAt クリアと同位置）。
- **症状 A 根治（ケース δ）**: PRE_START 中スライドショー → 「タイマー画面にもどす」押下後、会場モニターのタイマーが Level 1 表示のまま固まる退行。真因 = `renderHallPreStartTick` が参照する `el.clockTime` プロパティが **`el` オブジェクトに定義されていない**（HTML の id は `js-time`、`el.time` としてのみ定義済、`el.clockTime` は undefined）→ if 条件 false で DOM 書込ブロックが**常にスキップ**されており v2.1.6 から hall 側の PRE_START メイン画面更新は無効化されていた。スライドショーが画面上に乗っている間は気付かれず、解除で IDLE 起動時の Lv1 duration が露見。修正 = `el.clockTime` を `el.time` に変更（typo 修正）。

### Internal

- `src/renderer/renderer.js` subscribe コールバック内で `state.status !== prev.status` 分岐に `slideshowState.userOverride = 'auto'` の 1 行追加（autoEndedAt クリア直後）
- `src/renderer/renderer.js` `renderHallPreStartTick` 内 1 箇所の `el.clockTime` を `el.time` に修正（プロパティ名 typo）
- `slideshowState.userOverride = 'force-timer'` を `handlePipShowTimer` でセットする経路は維持（即時効果は変わらない、status 変化で自動リセットされる）
- timer.js / dual-sync.js / state.js / main.js / audio.js すべて完全無変更
- v2.1.11 hallTickState / renderHallTickFrame / renderHallPreStartTick rAF 自己再帰経路は完全保持
- 致命バグ保護 5 件すべて完全無傷

### Tests

- 新規テスト 8 件 (v224): subscribe 内の userOverride='auto' リセットコード存在 / リセット位置（autoEndedAt 直後）/ status 変化時のリセットトリガ / handlePipShowTimer の force-timer セットは維持 / renderHallPreStartTick の el.time 書込（el.clockTime 不在確認）/ package.json version / 致命バグ保護 5 件 cross-check / hallPreStartState・hallTickState 共存
- 既存テスト 893 件（v2.1.11 時点）+ 新規 v224 8 件 = 想定 901 件全 PASS 維持
- 既存 33 ファイルの version assertion を `2.1.11` → `2.1.12` に更新

### Compatibility (v2.1.12)

- 単画面モード（hall window なし）は完全同一の挙動
- v2.1.6 で追加された hall PRE_START カウントダウン経路が **本リリースで初めて実際に DOM に反映**される（typo 修正の効果）
- v2.1.7 / v2.1.8 / v2.1.9 / v2.1.10 / v2.1.11 機構すべて維持
- 致命バグ保護 5 件すべて完全無傷
- v2.1.11 → v2.1.12 自動更新で配信

### Known Limitations

- B3 ブレイク終了 pauseAfterBreak 反映漏れは引き続き v2.1.13 候補
- 計測機構は本リリースでも保険として保持
- 「BREAK 中もタイマーのまま見続けたい」場合は BREAK 進入後に再度「タイマー画面にもどす」ボタン押下で対応（status 変化での自動リセットを許容、UX 設計判断）

---

## [2.1.11] - 2026-05-09

PokerTimerPLUS+ v2.1.11 hall 自前 60fps tick 再導入リリース（v2.1.10 設計ミスの構造的根治）。

### Fixed

- **2 画面モードで会場モニターのカウントダウンが進まない / BREAK 中のタイマーがカクカク症状を根治**（前原さん発見、v2.1.10 試験中）。真因 = v2.1.10 で hall 側の自前 60fps 描画ループを全停止した結果、表示更新が「operator から 1 秒間引きで送ってくる broadcast」に 100% 依存。RUNNING/BREAK の broadcast は実質 5 秒粒度（`periodicPersistAllRunning`）でしか走らないため、BREAK 中はカクカク、PRE_START は事実上進まなくなった。修正 = hall 側に **時刻計算ベース 60fps 自前 tick を再導入**。`applyTimerStateToTimer` の hall 経路で `hallTickState` の seed（startedAtMs / status / totalMs）を更新し、`renderHallTickFrame` の自己再帰 rAF が毎フレーム `Date.now()` から remainingMs を計算 → `setState({ remainingMs })` → subscribe → `renderTime` が DOM 更新する経路に変更。PRE_START 側も `renderHallPreStartTick` の rAF 自己再帰を v2.1.6 同等に復活。

### Internal

- `src/renderer/renderer.js` `hallTickState` 状態オブジェクト + `stopHallTickFrame()` 新規追加（RUNNING / BREAK 専用、isActive / status / currentLevelIndex / totalMs / startedAtMs / rafId）
- `src/renderer/renderer.js` `renderHallTickFrame()` 関数新規追加（自己再帰 rAF、毎フレーム Date.now() から remainingMs 計算 → setState 経由で DOM 更新）
- `src/renderer/renderer.js` `applyTimerStateToTimer` の hall 経路で setState 1 回呼出 + hallTickState seed 更新 + renderHallTickFrame 起動。PAUSED は rAF 停止（静止表示）、RUNNING / BREAK は rAF 起動
- `src/renderer/renderer.js` IDLE / FINISHED / `levelCount === 0` / `!ts` の各経路で `stopHallTickFrame()` を呼出（rAF cleanup 網羅）
- `src/renderer/renderer.js` `renderHallPreStartTick` の rAF 自己再帰（`hallPreStartState.rafId = requestAnimationFrame(renderHallPreStartTick)`）を v2.1.6 同等に復活、v2.1.10 で削除した部分を撤回
- v2.1.10 Fix 1（timer.js 関数呼出の hall ガード `!isHallApply`）は **完全保持**（hall は独立 timer loop を持たない設計の中核）
- v2.1.10 Fix 3（計測機構 `hall:dualSync:*` ログ）は **完全保持**（保険、operator では計測しない）
- operator 側 broadcast の `_preStartTickLastSentAt >= 1000` 1 秒間引き throttle は **変更なし**（hall が自前計算するため IPC 負荷削減で十分）
- timer.js / dual-sync.js / main.js / audio.js すべて完全無変更
- 致命バグ保護 5 件すべて完全無傷

### Tests

- 新規テスト 12 件 (v223): hallTickState 定義 / applyTimerStateToTimer の hall 経路 seed 更新 + renderHallTickFrame 起動 / renderHallTickFrame 関数定義 + 自己再帰 / Date.now ベース remainingMs 計算 / PRE_START 経路（renderHallPreStartTick rAF 自己再帰復活）/ stopHallTickFrame 関数 / IDLE/FINISHED/PAUSED 経路で stopHallTickFrame 呼出 / timer.js 関数呼出の hall ガード保持 / operator throttle 保持 / package.json version / 致命バグ保護 / hallPreStartState と hallTickState 共存
- v222 T4（v2.1.10 で「rAF 駆動部分削除」を検証していた assertion）は v2.1.11 で撤回したためコメント化（履歴保持）
- 既存テスト 875 件（v2.1.10 時点 882 - v222 7 件含む = 875 + v222 7 件）+ 新規 v223 12 件 = 想定 894 件全 PASS 維持
- 既存 33 ファイルの version assertion を `2.1.10` → `2.1.11` に更新

### Compatibility (v2.1.11)

- 単画面モード（hall window なし）は完全同一の挙動（hallTickState は appRole !== 'hall' で `renderHallTickFrame` 早期 return）
- v2.1.6 で根治した PRE_START hall 同期は 60fps 駆動に復帰
- v2.1.7 で根治した B 系 6 件は引き続き維持
- v2.1.8 で根治した PRE_START 関連 2 件は引き続き維持
- v2.1.9 で根治した 0.2 秒遅延 + ボタン表示 2 件は引き続き維持
- v2.1.10 設計ミスは v2.1.11 で構造的根治（Fix 1 の hall ガード + Fix 3 計測機構は保持、Fix 2 の rAF 廃止のみ撤回）
- 致命バグ保護 5 件すべて完全無傷
- v2.1.10 → v2.1.11 自動更新で配信
- hall window の同時 rAF 数: PRE_START 中 2 個（renderHallPreStartTick + dual-sync flush）、RUNNING/BREAK 中 2 個（renderHallTickFrame + dual-sync flush）= v2.1.10 設計目標「同時 2 個」を達成

### Known Limitations

- B3 ブレイク終了 pauseAfterBreak 反映漏れは引き続き v2.1.12 候補
- 計測機構は本リリースでも保険として同梱、試験で問題なければ次バージョンで削除判断
- hall 側の startedAtMs は IPC 受信時の Date.now() ベース → operator との時刻ドリフトは IPC レイテンシ（数十 ms）+ periodicPersistAllRunning の 5 秒粒度補正で許容範囲

---

## [2.1.10] - 2026-05-08

PokerTimerPLUS+ v2.1.10 hall 表示遅延 1 秒の根治 + 計測機構同梱リリース。

### Fixed

- **2 画面モードで会場モニターの表示が音より約 1 秒遅れる + アプリ全体が重く感じる症状を根治**（前原さん発見、v2.1.9 試験中）。真因 = hall window で 3〜4 個の独立 rAF ループ（timer.js tick / timer.js preStartTick / renderHallPreStartTick / dual-sync flush）が同時回転し、1 フレーム予算（16.7ms）を超過 → frame skip → 累積遅延 1 秒。修正 = (1) `applyTimerStateToTimer` で hall の場合 timer.js 関数呼出のみ skip（DOM 描画は維持、案 3 細分化）、(2) hall 専用 `renderHallPreStartTick` 独立 rAF 廃止、broadcast 受信時の即時 DOM 更新で代替（案 6）。PRE_START 中の同時 rAF: 4 → 1、RUNNING 中: 2 → 1 に削減。

### Internal

- `src/renderer/renderer.js` `applyTimerStateToTimer` 内の timer.js 関数呼出（startAtLevel / pause / advanceBy / reset）を hall ガードで囲み、hall では skip
- DOM 更新（renderTime / renderNextBreak / renderCurrentLevel / setState）は hall でも続行（hall の表示は dual-sync 経由で更新される）
- hall 経路では timer.js を介さず `setState` を直接呼出 → subscribe 経由で `renderTime` / `renderNextBreak` / `renderCurrentLevel` が発火 → 独立 rAF を起動せず DOM 更新のみ実施
- `src/renderer/renderer.js` `renderHallPreStartTick` 独立 rAF 廃止、`renderHallPreStartFrame` に renamed（broadcast 受信時に 1 回限りの DOM 更新、再帰 rAF なし）
- `applyHallPreStartState` で broadcast 受信時に即時 DOM 更新（operator は 1 秒間引き broadcast → hall は 1 秒粒度で更新、PRE_START 表示単位 = 分:秒なので十分滑らか）
- `src/renderer/dual-sync.js` の v2.1.9 で導入した `requestAnimationFrame` flush は変更なし（hall 単独で動く環境になり、frame skip 解消想定）
- 計測機構を hall window に同梱: IPC 受信タイミング / dual-sync flush 所要時間 + 適用件数 / frame skip 検出（25ms 超）/ DOM 更新タイミング（applyTimerStateToTimer / applyHallPreStartState 入口）を rolling-log に記録（保険、operator では計測しない）
- `src/renderer/state.js` `setState` を renderer.js から import（既存の export を利用、新規エクスポート追加なし）
- 致命バグ保護 5 件すべて完全無傷

### Tests

- 新規テスト 7 件 (v222): `applyTimerStateToTimer` の timer.js 関数呼出 hall ガード網羅 / DOM 更新コードに hall ガードがない（RUNNING/PAUSED/IDLE すべての経路で setState は続く）/ `renderHallPreStartTick` の rAF 駆動部分削除 / `applyHallPreStartState` での broadcast 即時 DOM 更新ロジック / 計測機構の hall ガード / package.json version
- 既存テスト 875 件全 PASS 維持

### Compatibility (v2.1.10)

- 単画面モード（hall window なし）は完全同一の挙動
- v2.1.6 で根治した PRE_START hall 同期の機能は維持（broadcast 経路で即時 DOM 更新、表示は秒粒度で十分）
- v2.1.7 で根治した B 系 6 件は引き続き維持
- v2.1.8 で根治した PRE_START 関連 2 件は引き続き維持
- v2.1.9 で根治した 2 件（hall 表示遅延 0.2 秒 + ボタン表示）は引き続き維持
- 致命バグ保護 5 件すべて完全無傷
- v2.1.9 → v2.1.10 自動更新で配信

### Known Limitations

- B3 ブレイク終了 pauseAfterBreak 反映漏れは引き続き v2.1.11 候補
- 計測機構は本リリースで保険として同梱、試験で問題なければ次バージョンで削除判断

---

## [2.1.9] - 2026-05-08

PokerTimerPLUS+ v2.1.9 hall 表示遅延 0.2 秒の根治 + 会場モニターのスライドショー切替ボタン表示根治リリース。

### Fixed

- **2 画面モードで会場モニターの表示が音より約 0.2 秒遅れる症状を根治**（前原さん発見、v2.1.8 試験中）。真因 = v2.1.7 で導入した dual-sync buffer の flush 予約が `setTimeout(0)` で macrotask boundary に予約され、Electron renderer 仕様で 50〜200ms の遅延が発生していた。修正 = `setTimeout(0)` を `requestAnimationFrame` に変更。次フレーム（16〜50ms）で flush され、描画パイプと自然に同期。人間の知覚閾値内（60fps 1 フレーム = 16.7ms）に収まり「ほぼ同時」感を実現。
- **2 画面モードのブレイク中スライドショー時、会場モニターに「タイマー画面に戻す」「スライドショーに戻る」ボタンが消えていた症状を根治**（前原さん発見、緊急差し込み）。真因 = `style.css:3791-3793` の `[data-role="hall"] .pip-action-btn { display: none !important; }` ルールが hall window で強制非表示にしていた。1 画面モード（`data-role="operator-solo"`）では本セレクタが当たらないためボタン表示、2 画面モードの hall でのみ非表示という挙動だった。修正 = 当該 CSS ルールを削除。前原さん運用上、会場モニターはマウス操作可能で、1 画面モードと同等の操作性を実現。

### Internal

- `src/renderer/dual-sync.js` `_bufferDiff` の flush 予約を `setTimeout(0)` → `requestAnimationFrame` に変更
- beforeunload cleanup を `clearTimeout` → `cancelAnimationFrame` に変更
- `src/renderer/style.css` の hall pip-action-btn 強制非表示ルールを削除
- クリックハンドラ `handlePipShowTimer` / `handlePipShowSlideshow` は appRole ガードなしで hall でも素直に動作（既存実装、touch なし）
- `slideshowState` は hall window 内 local 変数のため hall ローカルで完結（broadcast 不要）
- v2.1.7 hall atomic update 機構の atomic update 効果（同一 kind dedup + 異なる kind 受信順保持）は完全維持
- 致命バグ保護 5 件すべて完全無傷

### Tests

- 既存 v219 テストの assertion を `setTimeout` → `requestAnimationFrame` に追従更新（vm context に rAF/cAF stub 追加）
- 新規テスト 8 件 (v221): rAF 登録 / setTimeout regression / cancelAnimationFrame / rAF callback 内 _flushTimer = null / hall pip-action-btn ルール削除 / operator pip-action-btn 維持 / クリックハンドラ appRole ガードなし / version
- 既存テスト 867 件全 PASS 維持

### Compatibility (v2.1.9)

- v2.1.8 以前の通常運用（単画面 / 2 画面 / PRE_START 非使用）は完全同一の挙動
- 単画面モード（hall window なし）では subscribeStateSync が登録されないため影響なし
- 単画面モード（`data-role="operator-solo"`）でのスライドショー切替ボタンは既存通り表示
- 2 画面モード手元 PC（`data-role="operator"`）でのスライドショー切替ボタンは既存通り非表示（操作画面なので不要）
- v2.1.7 で根治した B 系 6 件（B1 / B2 / B4 / B7 ⑤⑥②）は引き続き根治状態を維持
- v2.1.8 で根治した PRE_START 関連 2 件は引き続き根治状態を維持
- 致命バグ保護 5 件すべて完全無傷
- v2.1.8 → v2.1.9 自動更新で配信

### Known Limitations

- フレームスキップ（hall window CPU 高負荷時）で遅延が一時的に 50ms 超になる可能性。前原さん試験で頻発するようなら v2.1.10 で案 1（queueMicrotask、1〜5ms）or 案 4（main 側 atomic snapshot）への切替を検討
- hall 側で timer loop が独立に rAF 回転する CPU 無駄は引き続きスコープ外（applyTimerStateToTimer の hall ガードは副作用リスク高、v2.1.10 以降）
- B3 ブレイク終了 pauseAfterBreak 反映漏れは引き続き v2.1.10 候補

---

## [2.1.8] - 2026-05-08

PokerTimerPLUS+ v2.1.8 PRE_START 関連 2 件のバグ根治リリース。

### Fixed

- **2 画面モードで 5 秒前カウントダウン音が「ポンポン」と 2 重に聞こえる症状を根治**（前原さん発見）。真因 = operator window と hall window が同じ renderer.js を実行し、両方で timer loop が独立に rAF 回転して `playSound` が発火していた（appRole ガード欠落）。v2.1.7 で導入した dual-sync buffer の setTimeout(0) macrotask 遅延（約 50〜200ms）が、それまで重なって 1 音に聞こえていたのを「0.2 秒ズレた 2 音」に分離して顕在化させた。修正 = `handleAudioOnTick` / `handleAudioOnPreStartTick` / `playSound` の 3 箇所に `appRole === 'hall'` ガードを追加し、音発火経路を二重防御で確実に塞ぐ。
- **PRE_START 中、開始 1 分前にスライドショーが終了した際、会場ディスプレイのメインタイマー領域に PRE_START カウントダウンが表示されない症状を根治**（前原さん発見）。真因 = `style.css` の `:root[data-slideshow="active"] .clock { display: none }` で `display: none` → `display: block` 切替時の reflow タイミングずれ。修正 = `.clock` のみ `opacity: 0; pointer-events: none` に変更し、DOM レイアウトを維持したまま視覚的に隠す（reflow 待ちなしで即時表示復帰）。`.bottom-bar` / `.marquee` / `.event-header` は既存挙動維持のため `display: none` のまま。

### Internal

- `src/renderer/renderer.js` `handleAudioOnTick` / `handleAudioOnPreStartTick` 冒頭に hall ガード追加
- `src/renderer/audio.js` `playSound` 冒頭に hall ガード追加（多層防御）
- `src/renderer/style.css` `:root[data-slideshow="active"] .clock` を opacity / pointer-events 制御に分離（他のセレクタは既存維持）
- 致命バグ保護 5 件すべて完全無傷
- v2.1.7 hall atomic update 機構（diff buffer）と完全両立

### Tests

- 新規テスト 8 件 (v220): hall ガード 3 箇所 / CSS rule opacity 切替 / display: none regression / 致命バグ保護 / v2.1.7 機構維持 / version
- 既存テスト 859 件全 PASS 維持

### Compatibility (v2.1.8)

- v2.1.7 以前の通常運用（単画面 / 2 画面 / PRE_START 非使用）は完全同一の挙動
- 致命バグ保護 5 件すべて完全無傷
- v2.1.7 → v2.1.8 自動更新で配信

### Known Limitations

- hall 側で timer loop が独立に rAF 回転し続ける CPU 無駄は本リリースのスコープ外（applyTimerStateToTimer の hall ガードは副作用リスクがあるため見送り）。将来の最適化として v2.1.9 以降で別途検討
- B3 ブレイク終了 pauseAfterBreak 反映漏れは引き続き v2.1.9 候補（追加調査必要、確度低）

---

## [2.1.7] - 2026-05-08

PokerTimerPLUS+ v2.1.7 hall 側 atomic update 実装リリース（B 系構造的根治）。

### Fixed

- **2 画面モードで複数の状態変更が短時間に発生した際、会場ディスプレイで kind ごとの受信順がバラバラになり中間状態が表示される race condition を構造的に根治**。真因 = (1) main 側で複数 broadcast kind を逐次送信時の IPC 順序保証欠如、(2) hall 側 receiver の atomic update 不在。修正方針 = hall 側で diff を microbuffer に溜めて setTimeout(0) で一括 apply、同一 kind は最後の値で dedup、異なる kind は受信順保持。
- 解決した B 系バグ群:
  - B1 PAUSED 中の人数変更・時間 shift が hall に届かない症状（一部、debounce 遅延残課題は v2.1.8 候補）
  - B2 トーナメント切替時に hall が古い tournament のまま固まる症状
  - B4 「30 秒進める」+「人数変更」同時実行時の hall 一瞬の古い状態
  - B7 ⑤ PAUSED 中エントリー追加で hall に反映されず restart で一気に更新される症状
  - B7 ⑥ 新規トーナメント保存時、operator 側「レギュラー」だが hall は違うブラインド構造表示
  - B7 ② 2 画面で何かが遅れる系の既存認知バグ（v2.1.6 副次効果と合わせて構造的根治）

### Internal

- `src/renderer/dual-sync.js` に `_diffBuffer` + `_flushTimer` + `_flushDiffBuffer` 機構を新設
- 同一 kind dedup（最後の値）+ 異なる kind 受信順保持
- buffer サイズ上限 100 件 + hall window destroy 時 cleanup（beforeunload で clearTimeout + 配列クリア）
- 個別 apply の例外は try-catch で握り潰し、他の diff の apply を継続
- 初期同期は即時 apply 経路維持（startup race なし、initialize() 順序保護）、ランタイム broadcast のみ buffer 経由
- operator / operator-solo は subscribeStateSync を登録しない経路設計のため buffer 機構を一切通らない（即時 apply 経路維持）
- 致命バグ保護 5 件すべて完全無傷

### Tests

- 新規テスト 9 件 (v219): buffer 動作 / dedup / flush / 例外耐性 / cleanup / operator バイパス / preStartState 両立 / 上限暴走防止
- 既存テスト 850 件全 PASS 維持

### Known Limitations (v2.1.7)

- B1 / B7 ⑤ の `schedulePersistTimerState` / `setRuntime` の debounce 500ms による broadcast 遅延は本リリースのスコープ外（v2.1.7 試験で残存有無を判定 → 必要なら v2.1.8 で対応）
- B3 ブレイク終了時の pauseAfterBreak 反映漏れは追加調査が必要（v2.1.8 候補）

### Compatibility (v2.1.7)

- v2.1.6 以前の通常運用は完全同一の挙動（hall への atomic update が透過的に効く）
- operator 側の挙動は完全不変
- 致命バグ保護 5 件すべて完全無傷
- v2.1.6 → v2.1.7 自動更新で配信

---

## [2.1.6] - 2026-05-08

PokerTimerPLUS+ v2.1.6 PRE_START 2 画面同期根治リリース。

### Fixed

- **2 画面モードで開始時刻を未来に設定（PRE_START）した際、会場ディスプレイがスライドショー表示にならず、level 1 ブラインドが表示されたまま固まる症状を根治**。真因は PRE_START 状態が hall window に届いていないこと（5 層の断絶: capture → normalize → init sync → applyTimerState → 駆動ループ）。修正方針: 専用 broadcast kind `preStartState` を新設し、operator から hall へ session state として通知。v2.0.3 Fix L（PRE_START を永続化しない設計）との整合性は維持。
- PRE_START 関連の同期漏れを網羅修正: cancelPreStart / ±1 分操作 / PRE_START → PAUSED 復帰 / reset 経路すべてで hall 側通知を追加（B6 系）。
- 既存 broadcast kind の hall 側受信ハンドラに残存していた `marqueeSettings` value 内フィールド null guard 不備を修正（B5 系）。

### Internal

- `src/main.js` に新 broadcast kind `preStartState` 追加 + 専用 IPC ハンドラ `dual:publish-pre-start-state`（VALID_TIMER_STATUS は変更せず）
- `src/preload.js` に `dual.publishPreStartState(payload)` API 公開
- `src/renderer/timer.js` に新 handler `onPreStartStart` / `onPreStartCancel` / `onPreStartAdjust` 追加（既存 handler と後方互換）、PRE_START 経路 5 箇所（startPreStart / cancelPreStart / reset / advancePreStartBy / preStartTick 自動遷移）に handler 発火を配置
- `src/renderer/renderer.js` に hall 側 `preStartState` receiver + カウントダウン rAF 駆動 + スライドショー連動ロジック追加（rAF tick は 1 秒間引きで IPC flood 防止）
- 致命バグ保護 5 件すべて完全無傷

### Tests

- 新規テスト 13 件 (v218): preStartState kind 定義 / IPC handler / timer.js handlers 拡張 / operator broadcast 呼出 / hall receiver / スライドショー活性化条件 / B5 marqueeSettings null guard
- 既存テスト 837 件全 PASS 維持

### Compatibility (v2.1.6)

- v2.1.5 以前の % モード / 通常タイマー駆動は挙動完全同一
- PRE_START を使わない運用は影響なし
- 致命バグ保護 5 件すべて完全無傷
- v2.1.5 → v2.1.6 自動更新で配信

---

## [2.1.5] - 2026-05-06

PokerTimerPLUS+ v2.1.5 自動更新ダイアログ文言改善リリース（v2.1.4 PRIZE 金額モード誤差修正を同梱）。

### Changed

- 自動更新ダイアログの文言を改善: 「次回起動時に自動更新」→「**アプリを閉じてから2分以上待って再起動すると、自動的に最新版に切り替わります**」に変更。v2.1.2 配布運用中に「閉じてすぐ再起動」が頻発し、NSIS installer 処理（30〜60 秒）完了前に新プロセスが起動して installer が失敗するケースが多発したため、明示的に待機時間を案内する文言へ。安全余裕として実測時間の 2 倍（2 分）を提示。

### Fixed (v2.1.4 同梱)

- 金額モードで賞金構造を保存した際、表示金額が「端数（payoutRounding）の幅だけズレる」誤差を根治。真因は `% 換算時の小数点 2 桁丸め` による精度損失。修正は `payouts` 配列に `amount` フィールドを追加し、金額モード保存時に絶対金額を保持。再表示時、保存 amount の合計が現在のプール額と完全一致する場合は amount を直接使用、それ以外は従来の % 計算にフォールバック（後方互換）。

### Internal

- `src/main.js` 自動更新ダイアログ message 文言更新（v2.1.5 新規）
- `src/main.js` `normalizePayouts()` を `amount` フィールド対応に拡張（v2.1.4 由来）
- `src/renderer/renderer.js` 金額モード経路 4 箇所更新（v2.1.4 由来）

### Tests

- 既存テスト 828 件全 PASS 維持（v2.1.4 + 13 件含む）
- 新規テスト: 自動更新ダイアログ message に「2分」「閉じて」「再起動」が含まれること（文言 regression 防止）

### Compatibility (v2.1.5)

- v2.1.4 と機能完全同一 + ダイアログ文言のみ変更
- v2.1.3 以前で % モードのみで運用していたトーナメントは挙動完全同一
- 致命バグ保護 5 件すべて完全無傷
- v2.1.4 は GitHub Releases へ未公開のため、ユーザーは v2.1.3 → v2.1.5 への自動更新となる

---

## [2.1.4] - 2026-05-06

PokerTimerPLUS+ v2.1.4 PRIZE 金額モード誤差修正リリース。

### Fixed

- 金額モードで賞金構造を保存した際、表示金額が「端数（payoutRounding）の幅だけズレる」誤差を根治。真因は `% 換算時の小数点 2 桁丸め` による精度損失。修正は `payouts` 配列に `amount` フィールドを追加し、金額モード保存時に絶対金額を保持。再表示時、保存 amount の合計が現在のプール額と完全一致する場合は amount を直接使用、それ以外は従来の % 計算にフォールバック（後方互換）。

### Internal

- `src/main.js` `normalizePayouts()` を `amount` フィールド対応に拡張
- `src/renderer/renderer.js` 金額モード経路 4 箇所更新（保存 / 再描画 / 計算 / トーナメント読込）
- 既存 % モードのみのトーナメントは挙動完全不変（amount 不在時は既存ロジックでフォールバック）

### Tests

- 新規テスト: 金額モードで `pool=150000 / 1位=100000 / 2位=50000 / payoutRounding=1000` 設定時、表示金額が誤差ゼロで `[100000, 50000]` を返すこと
- 新規テスト: amount フィールドが欠損したレガシー payouts では既存 % 計算が走ること（後方互換）
- 新規テスト: amount 合計と pool が不一致（pool 変動後）の場合、% 計算にフォールバックすること
- 既存テスト 815 件全 PASS 維持

### Compatibility (v2.1.4)

- v2.1.3 以前で % モードのみで運用していたトーナメントは挙動完全同一
- 金額モードで保存した既存トーナメントは、次回保存時に amount フィールドが付与され誤差消失
- 致命バグ保護 5 件すべて完全無傷

---

## [2.1.3] - 2026-05-05

PokerTimerPLUS+ v2.1.3 自動更新新 UX 検証ビルド。**機能変更ゼロ、コード変更ゼロ、バージョン番号のみ bump**。v2.1.2 で実装した方針 Z（autoInstallOnAppQuit: true + OK 1 ボタン化 + 次回起動時更新）が実機で機能するかを検証する目的で公開。

### Changed

- `package.json` の `version` を `2.1.2` → `2.1.3` に bump（version assertion 追従テストのみ追従更新）
- アプリの動作・UI・配布インフラすべて v2.1.2 と完全同一

### Tests

- 既存 27 ファイルの version assertion を `2.1.2` → `2.1.3` に追従更新

### Compatibility (v2.1.3)

- v2.1.2 と完全同一の動作（src/ 配下に一切の変更なし）
- 致命バグ保護 5 件すべて完全無傷
- v2.1.2 → v2.1.3 の自動更新で新 UX（OK 1 ボタン + 次回起動時更新）が動作する想定（v2.1.2 方針 Z の実機検証）

### 検証手順（前原さん向け）

1. v2.1.2 がインストール済の PC を起動 → 1〜5 分待つ
2. 「更新の準備ができました」ダイアログが出る → **「OK」を 1 回押す**
3. アプリを通常通り使い続けてよい（更新は次回起動時）
4. アプリを閉じる（× ボタン or Alt+F4）→ 次回起動時に自動的に v2.1.3 に切替
5. バージョン確認: 設定 → ハウス情報タブ → `2.1.3`
6. 「アプリが終了できません」エラーや NSIS UI（「次へ」「インストール」「完了」）が**出ない**ことを確認 → 出れば v2.1.2 方針 Z の実機検証 NG → 構築士に報告

---

## [2.1.2] - 2026-05-05

PokerTimerPLUS+ v2.1.2 自動更新の操作簡素化（方針 Z 採用）。**v2.1.1 の `quitAndInstall(true, true)` で発生した「アプリが終了できません」エラー + NSIS インストーラ UI 表示問題を、`autoInstallOnAppQuit: true` 化で根本解決**。

### Changed

- **自動更新の動作モデルを「次回起動時更新」に変更**: 自動更新通知の OK ボタンを押した時点では更新は走らず、次回アプリを通常終了 → 次回起動時に installer がサイレントで自動実行されるようになりました。ユーザー操作は **OK を 1 回押すだけ**で、以降の操作（「次へ」「インストール」「完了」等）は一切不要です。
- **ダイアログ文言更新**: 「再起動して更新」「後で」の 2 ボタンから「OK」1 ボタンに簡素化、メッセージも「次回起動時に自動更新される」旨に変更
- **`autoInstallOnAppQuit: true`**: electron-updater の公式標準パターンに変更（v2.0.10 で意図的に false にしていた設定を戻す形、当時の運用想定が変化したため）

### Notes

- v2.1.1 で発生した「アプリが終了できません」エラー + NSIS UI 表示は、`quitAndInstall(true, true)` 経由を使わない設計に変更したことで**根本的に発生しなくなりました**
- `quitAndInstall` の呼出は削除、`app.quit` 経由で installer が自動実行される設計
- v2.0.11 の自動更新根治設定（artifactName / verifyUpdateCodeSignature / publisherName 削除）は完全維持

### Compatibility (v2.1.2)

- 致命バグ保護 5 件すべて完全無傷（C.1.8 含む、will-quit 同期処理は通常終了パスを通るため C.1.8 / rolling log / powerSaveBlocker すべて正常完走）
- v2.0.10 観測機構 + v2.0.11 自動更新根治 + v2.0.13 表示改善 + v2.0.14 audit 修正 + v2.0.15 ガード網羅 + v2.1.0 audit 消化すべて完全維持
- アプリの動作・既存機能（タイマー / スライドショー / トーナメント編集 / リセット / 通知音）に影響なし
- v2.1.1 ユーザーは自動更新で本リリースが配信される（**この更新からダイアログ操作が「OK」1 回のみになる**）

---

## [2.1.1] - 2026-05-04

PokerTimerPLUS+ v2.1.1 自動更新サイレントインストール対応版。

### Changed

- **自動更新時の操作ステップを大幅短縮**: 「再起動して更新」を押した後、NSIS インストーラ UI で「次へ」「インストール」「完了」を押す手間を解消
  - `autoUpdater.quitAndInstall(isSilent: true, isForceRunAfter: true)` 変更で NSIS インストーラがサイレント動作 + アプリ自動再起動
  - ユーザー操作は「再起動して更新」のクリック 1 回のみ → アプリが自動的に新バージョンで再起動
  - 初回インストール（手動 DL）の挙動は変更なし、`oneClick: false` のカスタム UI を維持

### Compatibility (v2.1.1)

- 致命バグ保護 5 件すべて完全無傷
- v2.0.10 観測機構 + v2.0.11 自動更新根治 + v2.0.13 表示改善 + v2.0.14 audit 修正 + v2.0.15 ガード網羅 + v2.1.0 audit 消化すべて完全維持
- アプリの動作・既存機能（タイマー / スライドショー / トーナメント編集 / リセット / 通知音）に影響なし
- v2.1.0 ユーザーは自動更新で本リリースが配信される（**この更新からサイレントインストールが有効化される**）

---

## [2.1.0] - 2026-05-04

PokerTimerPLUS+ v2.1.0 = audit 消化版 minor bump。**v2.0.15 audit で列挙された中重要度 13 件のうち、HDMI なし環境で動作確認可能な 5 件 + コメント 1 件を一括消化**。番号の見た目を整える minor bump も兼ねる。

### Changed

- **トーナメント一覧の毎秒再描画を最適化**: イベント委譲化で 100 トーナメント環境でも毎秒の click listener 登録ゼロ、長時間営業 + 古い PC でのファン回り軽減（M4 Perf-3）
- **カードの常時 GPU 負荷を軽減**: `backdrop-filter: blur` を半透明背景に置換、古い内蔵 GPU 環境のグラフィック負荷大幅減（M6 Perf-8）

### Fixed

- **インポート時の OOM 予防**: ファイル読込前に size 上限（50MB）チェック追加（M8 Edge-3）
- **プレイヤー数の整合性検証**: `playersRemaining > playersInitial` の異常状態を Math.min で正規化（M10 Edge-6）
- **import 検証の整合性**: main 側 `isValidPreset` と renderer 側 `validateStructure` の検証ロジックを統一（M11 Edge-8）

### Notes

- `migrateTournamentSchema` の `JSON.stringify` 比較に将来の displaySettings 拡張時の注意喚起コメント追加（M9 Edge-4）

### Compatibility (v2.1.0)

- 致命バグ保護 5 件すべて完全無傷（v2.0.15 で C.1.8 ガード網羅修正済の状態を維持）
- v2.0.10 観測機構 + v2.0.11 自動更新根治 + v2.0.13 表示改善 + v2.0.14 audit 修正 + v2.0.15 ガード網羅すべて完全維持
- アプリの動作・既存機能（タイマー / スライドショー / トーナメント編集 / リセット / 通知音）に影響なし
- v2.0.15 ユーザーは自動更新で本リリースが配信される

---

## [2.0.15] - 2026-05-04

PokerTimerPLUS+ v2.0.15 = v2.0.15 audit Pattern A+α 実装版。**致命バグ保護 C.1.8 ガード漏れ修正 + 運用面 2 件改善**。

### Fixed

- **HDMI 切替直後のプレイヤー人数操作消失予防（最重要）**: v2.0.14 Fix 1 で `tournaments:setActive` に追加した `_isSwitchingMode` ガードが、同種の `setRuntime` および同類書き込みハンドラに積み残されていた問題を修正。HDMI 抜き差し直前 0.5 秒以内のプレイヤー人数追加 / リエントリー / アドオン操作が直前値に戻る race を完全根治（致命バグ保護 C.1.8 整合修復）。

### Changed

- **electron-log のローテーション設定追加**: 長期運用でのログファイル肥大化を防止（5MB ローテ + 1 世代 archive）
- **rolling-log の店舗識別情報をハッシュ化**: 万一ログを共有する場合の PII 配慮として `presetName` 等を SHA-256 短縮ハッシュで記録

### Compatibility (v2.0.15)

- 致命バグ保護 5 件すべて完全無傷（C.1.8 は本フェーズで「ガード漏れ修正」として整合修復、既存 8 箇所 + resetBlindProgressOnly フックなし設計は維持）
- v2.0.10 観測機構 + v2.0.11 自動更新根治 + v2.0.13 表示改善 + v2.0.14 audit 修正すべて完全維持
- アプリの動作・既存機能（タイマー・スライドショー・トーナメント編集）に影響なし、品質改善のみ
- v2.0.14 ユーザーは自動更新で本リリースが配信される

---

## [2.0.14] - 2026-05-04

PokerTimerPLUS+ v2.0.14 audit 結果反映版。**v2.0.14 audit フェーズで列挙された中重要度 11 件のうち、配布後対応推奨の 7 項目 + B-6（60 分跨ぎ なめらかアニメ）を一括修正**。

### Changed

- **HDMI 切替 + トーナメント切替の race 予防**: `tournaments:setActive` ハンドラに `_isSwitchingMode` ガード追加（既存 `setTimerState` 同様の保護）
- **PIP タイマー 60 分跨ぎ切替対応**: 60 分以上の長尺プレスタート + スライドショー併用時の PIP 横あふれを解消、メインタイマーと同じ動的桁切替対応
- **ブラインド構造段数減少時の残時間計算保護**: `currentLevelIndex` クランプ追加で「経過時間継続」適用時の予期せぬ finished 化を防止
- **Alt+F4 / プロセスクラッシュ直前 0.5 秒の runtime 操作消失予防**: `schedulePersistRuntime` の beforeunload flush 経路追加（C.1.8 拡張）
- **操作者画面の数字幅固定**: `.operator-pane__info-list dd` / `.operator-status-bar__item` に `font-variant-numeric: tabular-nums` 追加（PIP / メインタイマーと同等品質）
- **休憩切替間隔の打鍵中値消失予防**: `renderBreakImagesList` 内で打鍵中の `breakImageInterval` 上書きをスキップ
- **自動更新失敗時のダイアログ通知**: silent fail を解消、初回失敗時にダイアログで通知 + 再試行ボタン
- **60 分跨ぎ font-size 切替のなめらか化**: メインタイマー / PIP タイマーの `transition` に `font-size 0.2s ease-out` 追加、layout shift 違和感を緩和

### Tests

- 新規 `tests/v214-audit-fixes.test.js` 追加
- 既存 23 ファイルの version assertion を `2.0.13` → `2.0.14` に追従更新

### Compatibility (v2.0.14)

- 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8 のうち、C.1.8 は本フェーズで「拡張保護」として強化）
- v2.0.10 観測機構 + v2.0.11 自動更新根治 + v2.0.13 表示改善すべて完全維持
- アプリの動作・既存機能（タイマー・スライドショー・トーナメント編集）に影響なし、品質改善のみ
- v2.0.13 ユーザーは自動更新で本リリースが配信される

---

## [2.0.13] - 2026-05-04

PokerTimerPLUS+ v2.0.13 表示まわり改善版。**v2.0.12 はスキップ**（GitHub Releases 未公開の検証ビルド）し、v2.0.13 で機能修正 + 自動更新検証を兼ねる。

### Changed

- **PRE_START カウントダウン表示の桁数自動切替**: 60 分以上で開始しても、残り時間が 60 分未満になったら自動的に 4 桁表示（MM:SS）に切替えるよう変更
  - 旧: 60 分以上で開始すると最後まで HH:MM:SS のまま（layout shift 防止のための意図設計）
  - 新: 残り時間で動的判定、60 分跨ぎ瞬間に layout shift が発生（前原さん承認済の仕様変更）
  - 影響: メインタイマー画面 + スライドショー時 PIP タイマー両方
- **スライドショー時 PIP タイマーの幅変動を解消**: 数字が変わるたびに幅が動く現象（Barlow Condensed のプロポーショナル数字幅が原因）を `font-variant-numeric: tabular-nums` 追加で解消。メインタイマー `.clock__time` で既に採用済の対策を PIP にも反映

### Tests

- 新規 `tests/v213-prestart-and-pip-format.test.js` 追加
- 既存 22 ファイルの version assertion を `2.0.12` → `2.0.13` に追従更新

### Compatibility (v2.0.13)

- 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）
- v2.0.10 観測機構（electron-log + rollingLog）+ v2.0.11 自動更新根治（artifactName / verifyUpdateCodeSignature / publisherName 削除）すべて完全維持
- アプリの動作・既存機能（タイマー・スライドショー・トーナメント編集）に影響なし、表示まわりの改善のみ

### 自動更新検証兼用

- v2.0.11 → v2.0.13 の自動更新通知が両 PC（自宅・会社）で出るかを実機検証
- 出れば → v2.0.11 根治修正の正常動作を確認 → ブランド戦略の本配布告知に進める段階

---

## [2.0.12] - 2026-05-04

PokerTimerPLUS+ v2.0.12 自動更新検証ビルド。**機能変更ゼロ、コード変更ゼロ、バージョン番号のみ bump**。v2.0.11 で実装した自動更新の根治修正（真因 2 件: ファイル名 404 + 署名検証失敗）が実機で機能するかを検証する目的で公開。

### Changed

- `package.json` の `version` を `2.0.11` → `2.0.12` に bump（version assertion 追従テストのみ追従更新）
- アプリの動作・UI・配布インフラ（artifactName / verifyUpdateCodeSignature / publisherName 削除）すべて v2.0.11 と完全同一

### Tests

- 既存 22 ファイルの version assertion を `2.0.11` → `2.0.12` に追従更新

### Compatibility (v2.0.12)

- v2.0.11 と完全同一の動作（src/ 配下に一切の変更なし）
- 致命バグ保護 5 件すべて完全無傷
- v2.0.11 → v2.0.12 の自動更新が動作する想定（v2.0.11 の根治修正の検証）

### 検証手順

1. v2.0.11 がインストール済の PC を起動 → 1〜5 分待つ
2. 「更新の準備ができました」ダイアログが自動で出れば → 真因 2 件根治確定
3. 出なければ → `Ctrl+Shift+L` でログ取得 → 構築士に送付 → 別の真因調査

---

## [2.0.11] - 2026-05-04

PokerTimerPLUS+ v2.0.11 自動更新根治版。**v2.0.10 観測ビルドで取得した実機ログから真因 2 件を確定 → 根治**。コード変更ゼロ、`package.json` の `build.win` 設定 3 項目変更のみで配布インフラ周りを修正。

### Fixed

- **自動更新（autoUpdater）が一度も動作していなかった真因を根治**:
  - **真因 1（ファイル名 404）**: ビルド成果物 `PokerTimerPLUS+ Setup ${version}.exe` を GitHub Releases に手動アップロードすると、GitHub がスペースを `.` に置換して `PokerTimerPLUS+.Setup.${version}.exe` になり、`latest.yml` が要求する `pokertimerplus-setup-${version}.exe` と不一致 → 404 エラーで silent fail。**修正**: `build.win.artifactName` を `pokertimerplus-setup-${version}.${ext}` に固定し、ビルド時から `latest.yml` と一致する正規化名で出力するようにした（GitHub アップロード時のリネーム作業も不要になる）。
  - **真因 2（署名検証失敗）**: 未署名 NSIS インストーラに対して `app-update.yml` の `publisherName: ['Yu Shimomachi']` で publisher 検証が走り、`New version 2.0.X is not signed by the application owner: publisherNames: Yu Shimomachi` で reject → silent fail。**修正**: `build.win.publisherName` 設定を完全削除し（`app-update.yml` から `publisherName` 行が消える）、`build.win.verifyUpdateCodeSignature: false` を追加して未署名インストーラに対する署名検証を無効化。
- **影響範囲**: v2.0.4 / v2.0.5 / v2.0.6 / v2.0.7 / v2.0.8 / v2.0.9 / v2.0.10 すべてのバージョンから v2.0.11 への自動更新は**動作しません**（手動 DL → 上書きインストールが必要）。**v2.0.11 以降のバージョン間（v2.0.12 以降）の自動更新は動作する想定**。

### Tests

- 新規 `tests/v211-autoupdater-fix.test.js` 追加（artifactName / verifyUpdateCodeSignature / publisherName 削除 / version の assertion）
- 既存 21 ファイルの version assertion を `2.0.10` → `2.0.11` に追従更新

### Compatibility (v2.0.11)

- 既存設定・トーナメントデータ・ランタイム永続化データはすべて保持（`appId: com.shitamachi.pokertimerplus` 継続、`deleteAppDataOnUninstall: false` 維持）
- アプリの動作・UI には変更なし（src/ 配下に一切の変更なし）、配布インフラ周りの修正のみ
- 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）
- rc12 / rc18 / rc22 / rc23 / C.1.4-fix1 / v2.0.6 修正(c)(d) / v2.0.7 修正 / v2.0.8 修正 / v2.0.10 観測機構（electron-log + rollingLog）すべて完全維持
- autoUpdater イベントハンドラ・ダイアログ文言（「更新の準備ができました」「再起動して更新」「後で」）・`quitAndInstall` ロジック・`autoInstallOnAppQuit: false` 設定すべて完全維持

### アップグレード手順

1. v2.0.4〜v2.0.10 が起動中なら閉じる
2. GitHub Releases から `pokertimerplus-setup-2.0.11.exe` を手動 DL
3. ダウンロードした .exe をダブルクリック → 既存版に上書きインストール（設定・トーナメントデータ保持）
4. **v2.0.11 以降の更新は自動で動作する想定**（v2.0.12 リリース時に起動時通知が出るか観察）

---

## [2.0.10] - 2026-05-04

PokerTimerPLUS+ v2.0.10 観測ビルド。**機能変更なし、autoUpdater 経路のログ機構強化のみ**。v2.0.4〜v2.0.9 で「自動更新通知が出ない」真因を実機ログで確定するための観測リリース。

### Changed

- **自動更新（autoUpdater）の挙動観測のため、main プロセスにログ機構を追加**:
  - `electron-log ^5.0.0` を `dependencies` に追加し、`autoUpdater.logger = log` を設定（公式推奨パターン）。`%APPDATA%/PokerTimerPLUS+/logs/main.log` に internal な debug 情報が記録される。
  - autoUpdater のすべてのイベント（`checking-for-update` / `update-available` / `update-not-available` / `download-progress` / `update-downloaded` / `error`）と setup フェーズ（`setup-enter` / `logger-attached` / `check-call` / `check-rejected` / `setup-error`）を `rollingLog`（rc18 第 1 弾、`Ctrl+Shift+L` で取得可能）にも記録。
  - 既存の `console.log` / `console.warn` 出力は完全維持（後方互換）。autoUpdater のダイアログ文言・`quitAndInstall` ロジック・起動条件 `app.isPackaged` も完全維持。
  - **機能変更なし、観測手段の追加のみ**。Phase 2（v2.0.11）でログ取得結果に基づき真因に対する根治修正を実装予定。

### Tests

- 新規 `tests/v210-autoupdater-logging.test.js` 追加（rollingLog ラベル件数 + electron-log 統合 + 既存ハンドラ破壊なし + 既存 console 出力維持の assertion）
- 既存 20 ファイルの version assertion を `2.0.9` → `2.0.10` に追従更新
- 既存 `tests/v208-auto-updater-fix.test.js` は引き続き PASS（autoUpdater イベントハンドラ・ダイアログ文言・quitAndInstall すべて完全維持）

### Compatibility (v2.0.10)

- 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）
- rc12 / rc18 / rc22 / rc23 / C.1.4-fix1 / v2.0.6 修正(c)(d) / v2.0.7 修正 / v2.0.8 修正 すべて完全維持
- autoUpdater イベントハンドラ・ダイアログ文言（「更新の準備ができました」「再起動して更新」「後で」）・`quitAndInstall` ロジック・`autoInstallOnAppQuit: false` 設定すべて完全維持
- `verifyUpdateCodeSignature` / `publisherName` / `app-update.yml` には触らず（v2.0.11 の Phase 2 用）
- src/ への変更は main.js の autoUpdater ブロックのみ（約 30 行追加、削除なし）

### アップグレード手順 / 検証手順（前原さん向け）

1. v2.0.9 が起動中なら閉じる
2. `PokerTimerPLUS+ Setup 2.0.10.exe` を実行（手動 DL、自動更新は依然として未動作の想定）
3. インストーラの指示に従う（既存設定・トーナメントデータは保持）
4. アプリを起動 → **5 分以上待つ**（autoUpdater が動く時間を確保）
5. `Ctrl+Shift+L` でログフォルダを開く → `rolling-current.log` の中身を構築士に送付
6. `%APPDATA%/PokerTimerPLUS+/logs/main.log`（electron-log の出力先、新規ファイル）の中身も併せて構築士に送付
7. 既存機能（タイマー / スライドショー / トーナメント編集）が壊れていないことを目視確認

---

## [2.0.9] - 2026-05-04

PokerTimerPLUS+ v2.0.9 自動更新動作検証ビルド。**コード変更ゼロ、`package.json` のバージョン番号のみ `2.0.8 → 2.0.9` に上げたリリース**。v2.0.8 で根治した「自動更新の真因修正（hasPublishConfig 削除）」が実機で本当に機能しているかを検証する目的のリリースです。

### Verification

- **自動更新動作検証ビルド（コード変更ゼロ）**: v2.0.8 で根治した「自動更新の真因修正（hasPublishConfig 削除）」が実機で本当に機能しているかを検証するためのビルドです。コードには一切変更を加えず、`package.json` のバージョン番号のみを `2.0.8 → 2.0.9` に上げています。v2.0.8 をインストール済のユーザーは、本リリース公開後にアプリを起動して数十秒〜数分待つと、「更新の準備ができました」ダイアログが**自動で出る想定**です。

### 検証手順（前原さん向け）

1. v2.0.8 がインストール済のローカル PC または会社 PC でアプリを起動
2. 1〜3 分待つ
3. 「更新の準備ができました（新しいバージョン 2.0.9 のダウンロードが完了しました）」ダイアログが表示されれば **検証成功** = 自動更新の真因修正が確証された
4. 表示されなければ別の真因がある可能性 → 構築士に連絡

### Tests

- 既存 `tests/v208-auto-updater-fix.test.js` および 19 ファイルの version assertion を `2.0.8 → 2.0.9` に追従更新（コード本体の検証内容は v2.0.8 と完全同じ）
- src/ への変更なしのため、新規テストは追加しない

### Compatibility (v2.0.9)

- **コード変更ゼロ**: `git diff main..feature/v2.0.9-update-verification -- src/` の出力が空であることを確認（src/ 配下に一切の差分なし）
- 致命バグ保護 5 件 + rc12 / rc18 / rc22 / rc23 + C.1.4-fix1 + v2.0.6 修正(c)(d) + v2.0.7 修正 loadAppVersion + v2.0.8 修正 hasPublishConfig 削除 すべて完全無傷（コード変更ゼロのため自動的に維持）
- autoUpdater イベントハンドラ・ダイアログ文言・`app.isPackaged` 条件すべて維持（コード変更ゼロのため自動的に維持）

### アップグレード手順

1. v2.0.8 が起動中なら閉じる（または起動時に**自動更新通知が出るのを待つ ← これが本リリースの検証ポイント**）
2. 通知が出たら「再起動して更新」をクリック
3. 通知が出なければ手動で `PokerTimerPLUS+ Setup 2.0.9.exe` をダウンロード → 実行（この場合は構築士に検証失敗を報告）

---

## [2.0.8] - 2026-05-04

PokerTimerPLUS+ v2.0.8 マイナーリリース。**【重大】v2.0.4 以降一度も機能していなかった自動更新機能の真因を根治**。v2.0.7 以前のユーザーは本バージョンを手動 DL してインストールしてください。**v2.0.8 以降は次回リリースから自動更新通知が出ます**。

### Fixed

- **【重大】自動更新機能の真因バグ修正**: v2.0.4 以降、設計上は自動更新が有効だったはずだが、**実際には一度も機能していなかった**ことが判明。原因は `src/main.js` の `hasPublishConfig` チェックで、electron-builder がビルド時に asar 内の package.json から `build` フィールドを削除する標準挙動のため、`pkg.build.publish` が常に `undefined` → 起動条件 `!isDev && autoUpdater && hasPublishConfig` が常に `false` で autoUpdater のセットアップが一度も呼ばれていなかった。autoUpdater は `app-update.yml`（electron-builder がビルド時に `dist/win-unpacked/resources/app-update.yml` として正しく生成）を内部で読むため、package.json の build.publish チェックは元々不要 + 害だった。修正後は **アプリ起動時に GitHub Releases から最新版を確認 → 通知ダイアログが正しく表示**されるようになります。
- **影響範囲**: v2.0.4 / v2.0.5 / v2.0.6 / v2.0.7 すべてのユーザーに該当。v2.0.8 をインストールしたユーザーは、それ以降の v2.0.9 / v2.1.0 等で自動更新通知を受け取れるようになります（v2.0.7 以前は GitHub Releases ページから手動 DL が必要でした）。

### Tests

- 新規テストファイル `tests/v208-auto-updater-fix.test.js` 追加（T1〜T6 + 致命バグ保護 cross-check + version assertion 2 件、合計 9 件 PASS）
- 既存 19 ファイルの version assertion を `2.0.7` → `2.0.8` に追従更新（v130-features / rc7 / rc8 / rc9 / rc10 / rc12 / rc13 / rc15 / rc19 系列 3 / rc20 / rc21 / rc22 / rc23 / v206 系列 3 / v207）

### Compatibility (v2.0.8)

- 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）
- **rc12 修正コード保護**: onRoleChanged ハンドラの setAttribute + window.appRole 代入の try-catch 順序を完全維持
- **rc18 第 1 弾 ring buffer 設計保護**: `_flushRollingLog` の `fs.promises.writeFile` 維持
- **rc22 維持**: ⑨-A subscribe 持続条件 / ⑩-A `Ctrl+Shift+L` globalShortcut / ⑩-D 起動時 `fs.readFileSync` 復元すべて維持
- **rc23 display-removed 無条件 solo 経路保護**: HDMI 抜き時の hallWindow alive → close + switchOperatorToSolo 経路維持
- **C.1.4-fix1 PIP ボタン位置保護**: `#js-pip-show-timer` の `left: 2vw / bottom: 2vw` 配置を完全維持
- **autoUpdater イベントハンドラ完全維持**: `error` / `update-available` / `update-downloaded` の 3 ハンドラ + `dialog.showMessageBox` ダイアログ文言（「更新の準備ができました」「再起動して更新」「後で」）+ `quitAndInstall` ロジックすべて変更なし
- **`<dialog>` flex 化禁止 / カード幅 54vw / 46vw / Barlow Condensed 700** 等の不変ルール維持
- src/ への変更は main.js のみ（`hasPublishConfig` 変数定義 6 行削除 + `else if` 警告ブロック 4 行削除 + 起動条件 1 行変更 + 説明コメント 6 行追加）。renderer.js / preload.js / index.html / CSS 変更なし

### アップグレード手順

1. v2.0.7 が起動中なら閉じる
2. `PokerTimerPLUS+ Setup 2.0.8.exe` を実行（GitHub Releases から手動 DL、または前原さんが直接送付）
3. インストーラの指示に従う（既存設定・トーナメントデータは保持される）

※ **v2.0.8 以降は自動更新が機能する**ので、次回以降のリリースは起動時に通知が出ます。v2.0.7 以前のユーザーが「自動更新が来ない」と感じていたのは本バグが真因でした。

---

## [2.0.7] - 2026-05-04

PokerTimerPLUS+ v2.0.7 マイナーリリース。v2.0.4 以降のユーザーは新インストーラを実行するだけで自動アップグレード（同 `appId: com.shitamachi.pokertimerplus`、設定・トーナメントデータは保持）。

### Fixed

- **ハウス情報タブの「バージョン」表示が「—」のままだったバグを修正**: 設定ダイアログの「ハウス情報」タブで現在のアプリバージョンが表示されない症状を解消。原因は renderer 側のコードで `loadInitialSettings()` 内の `return false;` の後にバージョン取得コードが置かれていたため、永遠に実行されない状態（unreachable code）でした。修正は **独立関数 `loadAppVersion()` として切り出し、`initialize()` の末尾から fire-and-forget で呼出**。preload.js（`getVersion: () => ipcRenderer.invoke('app:getVersion')`）と main.js（`ipcMain.handle('app:getVersion', () => app.getVersion())`）は既に正常実装済のため、renderer 側のコード配置ミスのみが真因。修正後は **設定ダイアログを開くたびに最新バージョン（2.0.7 等）が正しく表示**されます。

### Tests

- 新規テストファイル `tests/v207-app-version-display.test.js` 追加（T1〜T5 + version assertion 2 件、合計 9 件 PASS）
- 既存 18 ファイルの version assertion を `2.0.6` → `2.0.7` に追従更新（v130-features / rc7 / rc8 / rc9 / rc10 / rc12 / rc13 / rc15 / rc19 系列 3 / rc20 / rc21 / rc22 / rc23 / v206 系列 3）

### Compatibility (v2.0.7)

- 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）
- **rc12 修正コード保護**: onRoleChanged ハンドラの setAttribute + window.appRole 代入の try-catch 順序を完全維持
- **rc18 第 1 弾 ring buffer 設計保護**: `_flushRollingLog` の `fs.promises.writeFile` 維持
- **rc22 維持**: ⑨-A subscribe 持続条件 / ⑩-A `Ctrl+Shift+L` globalShortcut / ⑩-D 起動時 `fs.readFileSync` 復元すべて維持
- **rc23 display-removed 無条件 solo 経路保護**: HDMI 抜き時の hallWindow alive → close + switchOperatorToSolo 経路維持
- **C.1.4-fix1 PIP ボタン位置保護**: `#js-pip-show-timer` の `left: 2vw / bottom: 2vw` 配置を完全維持
- **`<dialog>` flex 化禁止 / カード幅 54vw / 46vw / Barlow Condensed 700** 等の不変ルール維持
- src/ への変更は renderer.js のみ（`loadInitialSettings()` から unreachable code 12 行削除 + 独立関数 `loadAppVersion()` 14 行追加 + `initialize()` 末尾に `loadAppVersion();` 1 行呼出）。preload.js / main.js / index.html / CSS 変更なし

### アップグレード手順

1. v2.0.6 が起動中なら閉じる
2. `PokerTimerPLUS+ Setup 2.0.7.exe` を実行
3. インストーラの指示に従う（既存設定・トーナメントデータは保持される）

※ v2.0.4 以降のユーザーは起動時に自動更新通知が出ます

---

## [2.0.6] - 2026-05-03

PokerTimerPLUS+ v2.0.6 マイナーリリース。v2.0.5 ユーザーは新インストーラを実行するだけで自動アップグレード（同 `appId: com.shitamachi.pokertimerplus`、設定・トーナメントデータは保持）。

### Fixed

- **「スライドショーに戻る」ボタンの位置調整**: スライドショーからタイマー画面に戻したとき、H 押下後（テロップ縦幅が太い 9vh 状態）でボタンが完全に隠れる + 通常時（テロップ細い 6vh 状態）でも下に半分見切れる症状を解消。**画面左の縦中央付近（top: 50vh + transform: translateY(-50%)）に移動**したことで、テロップの太さに依存せずボタン全体が常に見える設計に変更。ロゴ画像（最大幅 14vw / 最大高さ 18vh）+ presented-by 表記の領域は画面上端から最大 約 20vh に収まるため、新位置（50vh）とは完全非干渉。**PIP ボタン（タイマーサイズ切替 = `#js-pip-show-timer`、左下 `bottom: 2vw` 配置）には触らず**（C.1.4-fix1 Fix 4 不変保護維持）。
- **スライドショーの画像が 1 枚しかない場合は静止表示に変更**: 同じ画像が繰り返しフェードイン / フェードアウトを繰り返す挙動を解消。1 枚のときは setInterval を起動せず、1 枚目を静止表示するだけにします。1 枚→2 枚以上に追加した場合は自動的に setInterval 循環モードに切り替わります（`persistBreakImagesField` 内で active 中の枚数変化を検知し deactivate→activate で再評価）。
- **スライドショー実行中に切替間隔（秒）を変更したら、その変更が即時反映されるように修正**: これまでは新しい間隔は次回スライドショー開始時にしか反映されず、実行中は古い間隔（10 秒など）が継続していました。修正後は数値変更後にフォーカスを外す or Enter キーを押すと、実行中のスライドショーも新しい間隔で再起動されます（`handleBreakImageIntervalChange` 内で active 中なら deactivate→activate 経路で setInterval を新間隔で張り直し）。1 枚静止モード時は再起動不要（修正と整合）。

### Added

- **`.gitattributes` 追加（Source code zip からの開発用ファイル除外）**: GitHub Release で自動生成される Source code zip / tar.gz から、CC（Claude Code）開発フロー用の作業ノート（`HANDOVER.md` / `CC_REPORT.md` / `NEXT_CC_PROMPT.md` / `NEXT_CC_PROMPT_*.md`）+ v1.3.0 配布時のインストールテスト手順書（`INSTALL_TEST.md`）を `export-ignore` 属性で除外。**git 履歴には残るがダウンロード時の zip からは除外される**ため、配布時に開発者向けノートが混入しない。アプリ動作には一切影響なし。

### Tests

- 新規 `tests/v206-slideshow-return-button-position.test.js`（T1〜T3 + PIP ボタン不変保護 + ロゴ領域非干渉 + version assertion、合計 7 件）
- 新規 `tests/v206-slideshow-single-image.test.js` 追加（T1〜T3 + 1↔N 再評価 + 既存ガード保護 + deactivate 不変 + version assertion、合計 7 件）
- 新規 `tests/v206-slideshow-interval-live-update.test.js` 追加（T1〜T3 + 既存ガード保護 + change イベント仕様維持 + intervalSec 再評価証明 + version assertion、合計 7 件）
- 既存 version assertion ファイル（v130-features / rc7 / rc8 / rc9 / rc10 / rc12 / rc13 / rc15 / rc19 系列 3 / rc20 / rc21 / rc22 / rc23）を `2.0.5` → `2.0.6` に追従更新

### Compatibility (v2.0.6)

- 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）
- **rc12 修正コード保護**: onRoleChanged ハンドラの setAttribute + window.appRole 代入の try-catch 順序を完全維持
- **rc18 第 1 弾 ring buffer 設計保護**: `_flushRollingLog` の `fs.promises.writeFile` 維持、`appendFile` 不在
- **rc22 維持**: ⑨-A subscribe 持続条件 IDLE OR 句 / ⑩-A `Ctrl+Shift+L` globalShortcut / ⑩-D 起動時 `fs.readFileSync` 復元すべて維持
- **rc23 display-removed 無条件 solo 経路保護**: HDMI 抜き時の hallWindow alive → close + switchOperatorToSolo 経路維持
- **PIP ボタン不変保護**: `#js-pip-show-timer` の `left: 2vw / bottom: 2vw` 配置を完全維持（C.1.4-fix1 Fix 4 と整合）
- **`<dialog>` flex 化禁止 / カード幅 54vw / 46vw / Barlow Condensed 700** 等の不変ルール維持
- **スライドショー基本機能保護**: フェード切替（opacity 0/1）/ PIP / 自動復帰（残り 60 秒以下）/ BREAK 30 秒遅延（fix2 Fix 1）/ autoEndedAt 解除（fix1 Fix 3）すべて完全維持
- src/ への変更内訳: CSS の `#js-pip-show-slideshow` ルール（ボタン位置）+ renderer.js の `activateSlideshow` / `persistBreakImagesField` / `handleBreakImageIntervalChange` 3 関数のみ。HTML / preload.js / main.js / 設定ファイル変更なし

### アップグレード手順

1. v2.0.5 が起動中なら閉じる
2. `PokerTimerPLUS+ Setup 2.0.6.exe` を実行
3. インストーラの指示に従う（既存設定・トーナメントデータは保持される）

---

## [2.0.5] - 2026-05-03

PokerTimerPLUS+ v2.0.5 マイナーリリース。v2.0.4 ユーザーは新インストーラを実行するだけで自動アップグレード（同 `appId: com.shitamachi.pokertimerplus`、設定・トーナメントデータは保持）。

### Changed

- **同梱基本ブラインド「ターボ」「レギュラー」「ディープ」の level 9 以降の値を業界標準値に更新**: v2.0.4 までの level 9〜27 系列（1200/2400/3200/4000/5000/6000/8000/10000/12000/16000/20000/25000/30000/40000/50000/60000/80000）を、業界標準的な刻み（1500/2000/2500/3000/4000/5000/6000/8000/10000/15000/20000/25000/30000/40000/50000/60000/80000/100000）に置換。level 13 と level 14 の間に 5 分の休憩を 1 つ追加（元の level 27 は最大値が 100000 まで届いたため削除）。**level 1〜8 と既存ブレイク 2 箇所（4-5 間 / 8-9 間、いずれも 10 分）は変更なし**。
  - 適用範囲: **新規トーナメント作成時 + プリセット未編集ユーザーのみ**反映。既存トーナメントの保存値・カスタマイズ済プリセット（ユーザー編集分）は影響なし。

### Removed

- **未使用関数 `isWindowOnDisplay` の削除**（dead code 整理）: rc23 で `display-removed` ハンドラから呼出を削除済のため、`src/main.js` から関数定義 + 直前の説明コメント計約 15 行を削除。`tests/v2-display-change.test.js` の T5（関数存在チェック）も同時削除。**動作変更なし**（呼出ゼロ確認済、致命バグ保護 5 件 + rc12 / rc18 / rc22 / rc23 すべて完全無傷）。

### Tests

- 既存 version assertion ファイル（v130-features / rc7 / rc8 / rc9 / rc10 / rc12 / rc13 / rc15 / rc19 系列 3 / rc20 / rc21 / rc22 / rc23）を `2.0.4` → `2.0.5` に追従更新
- `tests/v2-display-change.test.js` から T5 削除（テスト総数 1 件減）

### アップグレード手順

1. v2.0.4 が起動中なら閉じる
2. `PokerTimerPLUS+ Setup 2.0.5.exe` を実行
3. インストーラの指示に従う（既存設定・トーナメントデータは保持される）

---

## [2.0.4] - 2026-05-03

PokerTimerPLUS+ v2.0.4 公式リリース。v1.3.0 → v2.0.4 へのアップグレードでは、新インストーラを実行するだけで自動的に置き換えられます（同じ `appId: com.shitamachi.pokertimerplus`、同じ `productName: PokerTimerPLUS+`）。

### 主な変更

- **HDMI 自動 2 画面対応**: HDMI 接続検知 → モニター選択ダイアログ → 会場モニター（フルスクリーン表示）と手元 PC（操作 UI）の自動振り分け
- **HDMI 抜き差し時の自動レイアウト切替**: 2 画面 ↔ 単画面の自動追従、タイマー表示は途切れず継続（rc23 真因根治済）
- **ブラインド構造変更の即時 hall 同期**: IDLE 時は新 Lv1 duration を hall に即時反映、PAUSED / RUNNING 時は進行中レベルの残り時間を保護（③ c 厳守）
- **停止中エントリー追加 / Ctrl+E specialStack 変更の AC 即時反映**: hall への反映と AC 表示の同期遅延を解消
- **AC「イベント名」表示修正**: tournamentTitle が AC に正しく表示されるよう同期経路を確立
- **`Ctrl + Shift + L` ショートカット追加**: タイマー画面消失時にも UI 操作不要でログフォルダを開ける救済策（globalShortcut、webContents focus 不要）
- **アプリ再起動後もログ保持**: 起動時に前回セッションの `rolling-current.log` を読み込んで in-memory ring buffer を復元（SIGKILL 等の異常終了でもログを失わない）

### 致命級バグ修正

- **rc12: `onRoleChanged` window.appRole TypeError 握り潰し**: ES module strict mode + contextBridge 凍結の合わせ技でコールバックが TypeError を throw → 後続 UI 更新が走らずタイマー画面消失していた症状を、`setAttribute('data-role', newRole)` を最優先実行 + `window.appRole` 代入を try-catch で握り潰す順序に変更で根治（rc6〜rc10 で 5 連続失敗後、rc11 計測ビルドで真因確定 → rc12 で根治）
- **rc23: `display-removed` の `isWindowOnDisplay` 左上座標判定漏れ**: HDMI 抜き直後に Windows OS が hall ウィンドウを新 primary display に瞬時移動するため、旧判定が必ず false を返却 → solo モード切替不発火 → タイマー画面消失していた症状を、hallWindow alive なら**無条件**で `close()` + `switchOperatorToSolo()` を実行する経路に変更で根治（前原さん運用方針 A: PC + HDMI 1 本のみ確定により安全）

### 既存機能との互換性

- **単画面動作は v1.3.0 と完全互換**（HDMI 未接続環境では v1.3.0 と同じレイアウト・同じ操作）
- **致命バグ保護 5 件すべて維持**（C.2.7-A `resetBlindProgressOnly` / C.2.7-D `timerState` destructure 除外 / C.1-A2 `ensureEditorEditableState` 4 重防御 / C.1.7 AudioContext resume / C.1.8 runtime 永続化 8 箇所）
- 自動テスト全件 PASS（138 件 v1.x + 約 540 件 v2.x = 計約 670 件超）

### アップグレード手順

1. v1.3.0 が動作中なら閉じる
2. `PokerTimerPLUS+ Setup 2.0.4.exe` を実行
3. インストーラの指示に従う（既存設定・トーナメントデータは保持される）

### 開発履歴

詳細な変更履歴は本ファイル下部の `[2.0.4-rc1]` 〜 `[2.0.4-rc23]` 各セクション参照（試験版開発の段階的修正記録）。

---

## [2.0.4-rc23] - 2026-05-03

### Fixed
- **問題 ⑩ 真因根治（タスク 1）**: rc22 計測ビルド実機ログ（`rolling-current.log` line 4717-4724）で**真因 100% 確定**。HDMI 抜き直後 Windows OS が hallWindow を新 primary display に瞬時移動 → 旧 `display-removed` ハンドラの `isWindowOnDisplay(bounds, removedDisplay)` 左上座標判定が必ず false を返却 → `switchOperatorToSolo()` 不発火 → hallWindow close なし、operator role 切替なし → AC 画面が `[data-role="operator"]` のままで `[data-role="operator"] .clock { display: none !important }` (style.css:3771-3781) が効いて**タイマー画面消失**症状が再現。前原さん運用方針 A（PC + HDMI 1 本のみ）確定により `display-removed` = 会場モニター消失と同義で扱える。修正: `src/main.js:setupDisplayChangeListeners` の `display-removed` ハンドラ内の `isWindowOnDisplay(bounds, removedDisplay)` 判定経路を削除し、`hallWindow` alive なら**無条件**で `hallWindow.close()` + `hallWindow = null` + `await switchOperatorToSolo()` を実行する経路に変更。`_displayRemovedPending` / `hallWindow.isDestroyed()` ガード + `rollingLog('display-removed', ...)` 配布版常時記録は維持。

### Removed
- **rc22 第 2 弾投入の観測ラベル 8 件全削除（タスク 2）**: rc22 計測ビルドで真因確定済のため。
  - `src/renderer/renderer.js` から 6 件削除（`renderer:onRoleChanged:before-setAttribute` / `:after-setAttribute` / `:after-appRole-assign` / `:after-updateMuteIndicator` / `:after-updateOperatorPane` / `:after-updateFocusBanner`）
  - `src/preload.js` から 2 件削除（`preload:onRoleChanged:enter` / `:catch`）
  - **rc12 修正コード（`setAttribute('data-role', newRole)` + `window.appRole = newRole` の try-catch 順序）は完全維持**
  - **preload.js の握り潰し try-catch パターン自体は rc12 真因防御として維持**（`try { callback(newRole); } catch (_) {}` を残置、コールバック throw 吸収機構は失わない）

### Tests
- `tests/v204-rc23-display-removed-fix.test.js` 新規追加（T1〜T14 + 致命バグ保護 5 件 cross-check + rc18 ring buffer 設計 cross-check + rc22（⑨-A / ⑩-A / ⑩-D）維持確認 + version assertion、合計 22 件）
- 既存 rc21 / rc22 テストファイルの観測ラベル assertion を**「ラベル不在確認」に反転**（assertion 名と本体を rc23 削除確認用に書き換え）
- 既存 version assertion ファイル 14 件を `2.0.4-rc22` → `2.0.4-rc23` に追従更新

### Compatibility (rc23)
- 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）
- **rc12 修正コード保護**: onRoleChanged ハンドラ内 `setAttribute('data-role', newRole)` + `window.appRole = newRole` の try-catch 順序を完全維持（テスト T14 で順序の前後関係を `setAttrIdx < appRoleIdx` で静的確認 + try ブロック存在を `assert.match` で確認）
- **rc18 第 1 弾 ring buffer 設計保護**: `_flushRollingLog` の `fs.promises.writeFile` 維持、`appendFile` 不在
- **rc22 維持**: ⑨-A subscribe 持続条件 IDLE OR 句、⑩-A `Ctrl+Shift+L` globalShortcut、⑩-D 起動時 `fs.readFileSync` 復元経路すべて存在確認
- `isWindowOnDisplay` 関数自体は dead code 化させず一旦残置（他経路使用あれば残置、なければ rc24 以降で削除判断、本フェーズスコープ外）
- rc7〜rc22 までの確定 Fix すべて維持

---

## [2.0.4-rc22] - 2026-05-02

### Fixed
- **問題 ⑨ 残部 根治（タスク 1、案 ⑨-A）**: rc21 試験で残存していた「タイマー未開始（IDLE）でブラインド構造を保存・適用しても会場モニター（hall）の表示が古い Lv1 duration のまま、タイマースタート時にようやく切替わる」現象を根治。**真因 = `src/renderer/renderer.js:1591-1595` の subscribe 持続条件（`schedulePersistTimerState` 発火 trigger）が `status 変化 / currentLevelIndex 変化 / (PAUSED && remainingMs 変化)` の 3 句のみで、IDLE 中に `_refreshDisplayAfterStructureChange` が `setState({ remainingMs, totalMs })` を呼んでも 3 句どれにもヒットせず → `tournaments:setTimerState` IPC 不発火 → main `_publishDualState('timerState', …)` 不発火 → hall 不到達**（rc22 第 1 弾事前調査で 3 体並列 sub-agent が独立に同根に到達）。修正: 既存 if 条件式に IDLE 限定 OR 句を 1 行追加（`(state.status === States.IDLE && (state.remainingMs !== prev.remainingMs || state.totalMs !== prev.totalMs))`）。③ c（PAUSED 進行中据置）と非干渉、致命バグ保護 5 件すべて影響なし。

### Added
- **`Ctrl + Shift + L` ショートカット（タスク 2、案 ⑩-A）**: タイマー画面消失時にも UI 不要でログフォルダを開ける救済策。`src/main.js:registerShortcuts()` に `globalShortcut.register('CommandOrControl+Shift+L', …)` 追加、ハンドラ内で `await _flushRollingLog()` → `_resolveLogsDir()` → `shell.openPath(dir)` の順で実行（rc18 第 1 弾の I/O 順序保証維持のため `await` 必須）。globalShortcut は webContents focus 不要のためタイマー画面が CSS / DOM / bounds / show のいずれの理由で消失しても発火する。
- **起動時 rolling-current.log 復元（タスク 3、案 ⑩-D）**: SIGKILL 等で `app:will-quit` が走らずプロセス終了した場合の前回ログを継続使用可能に。`src/main.js:_initRollingLog()` 内 `mkdirSync` 直後で `fs.readFileSync(_rollingLogFilePath, 'utf8')` → `split('\n').filter(Boolean).forEach((line) => { JSON.parse(line); _rollingLogBuffer.push(...) })` で in-memory buffer に復元。**同期 `readFileSync` 維持厳守**（`_initRollingLog` 全体が同期コンテキスト、rc18 設計遵守、`appendFile` 復活なし）。5 分 retention は次回 `_flushRollingLog` 発火時に既存ロジックで適用される。

### Tests
- `tests/v204-rc22-subscribe-and-log.test.js` 新規追加（T1〜T9 + 致命バグ保護 5 件 cross-check + rc12 + rc18 ring buffer 設計 cross-check + 計測ラベル 8 件維持確認 + version assertion、合計 16 件）
- 既存 version assertion ファイル（v130-features / rc7 / rc8 / rc9 / rc10 / rc12 / rc13 / rc15 / rc19 系列 3 / rc20 / rc21）を `2.0.4-rc21` → `2.0.4-rc22` に追従更新

### Compatibility (rc22)
- 致命バグ保護 5 件すべて完全無傷（C.2.7-A `resetBlindProgressOnly` / C.2.7-D `timerState` destructure 除外 / C.1-A2 `ensureEditorEditableState` 4 重防御 / C.1.7 AudioContext resume / C.1.8 runtime 永続化 8 箇所）。
- **rc12 修正コード保護**: onRoleChanged ハンドラ内 `setAttribute('data-role', newRole)` + `window.appRole = newRole` の try-catch 順序を完全維持（テスト rc12 不変保護 cross-check 済）。
- **rc18 第 1 弾 ring buffer 設計保護**: `_flushRollingLog` の `fs.promises.writeFile` 維持、`appendFile` 不在（タスク 2/3 のいずれでも復活なし）。タスク 2 は `await _flushRollingLog()` で I/O 順序保証維持、タスク 3 は同期 `readFileSync` のみで write 経路に介入なし。
- **計測ラベル 8 件は維持**（`renderer:onRoleChanged:` 系 6 件 + `preload:onRoleChanged:` 系 2 件）。rc22 第 2 弾完成後の試験で活用 → 真因確定 → **rc23 で問題 ⑩ 根治 + 観測ラベル 8 件全削除予定**。
- 前原さん判断 α / ③ c 遵守（IDLE 時は新 Lv1 duration を反映、PAUSED / RUNNING の `remainingMs` には触らず）。
- rc7〜rc21 までの確定 Fix すべて維持。

---

## [2.0.4-rc21] - 2026-05-02

### Fixed
- **問題 ⑨ 根治（タスク 1、案 ⑨-A）**: rc20 試験で発覚した「タイマー未開始 / 一時停止中にブラインド構造を適用しても AC 上部 TIME / 中央タイマー / NEXT BREAK / op-pane 現/次ブラインドが古いまま」現象を根治。**真因 = `setStructure`（blinds.js:20-26）が `setState` を呼ばないため subscribe 経由の表示更新が trigger されず、適用系 4 経路（`handleTournamentGameTypeChange` idle / `handleTournamentSaveTournament` idle / `doApplyTournament` apply-only / `handlePresetApply` apply-only）で `renderCurrentLevel` / `renderNextLevel` のみ手動補完していた**（rc21 第 1 弾事前調査で 100% 確定）。修正: `src/renderer/renderer.js` に共通ヘルパ `_refreshDisplayAfterStructureChange()` を追加（IDLE 時は前原さん判断 α により `setState({ remainingMs, totalMs })` で新 Lv1 duration を反映 → subscribe 経由で全表示同時更新、非 IDLE 時は ③ c により `remainingMs` に触らず `updateOperatorStatusBar` / `updateOperatorPane` / `renderTime` / `renderNextBreak` の明示呼出のみ）+ 4 経路末尾に呼出 1 行追加。約 35 行 / 1 ファイル、致命バグ保護 5 件すべて完全無傷、`timer.js` の `targetTime` 経路に新規呼出なし（③ c 厳守）。

### Investigated
- **問題 ⑩ 計測ビルド投入（タスク 2、案 ⑩-C、rc22 で削除予定）**: rc20 試験で再発した「HDMI 抜きでタイマー画面消失」の真因を rc11 → rc12 と同パターンで時系列確定するため、8 ラベルを一時計測として追加。**rc12 修正コード（`src/renderer/renderer.js` の onRoleChanged ハンドラ内 `setAttribute('data-role', newRole)` + `window.appRole = newRole` の try-catch 順序）は完全不変保護**（テストで cross-check 済）。
  - renderer.js（6 ラベル）: `renderer:onRoleChanged:before-setAttribute` / `:after-setAttribute`（data-role 現在値同梱）/ `:after-appRole-assign`（appRole 現在値同梱）/ `:after-updateMuteIndicator` / `:after-updateOperatorPane` / `:after-updateFocusBanner`
  - preload.js（2 ラベル）: `preload:onRoleChanged:enter` / `preload:onRoleChanged:catch`（rc12 と同種の握り潰し catch を ipcRenderer.send 経由でログ化、コールバック内 throw の決定的証拠化）
- **rc22 削除責任**: 本 8 ラベルは rc22 で問題 ⑩ 真因確定 + 根治コミット直後に**全件削除**する（cc-operation-pitfalls.md §6.1 準拠、削除予定 CC_REPORT §8 で明記）。

### Tests
- `tests/v204-rc21-display-refresh.test.js` 新規追加（タスク 1+2 関連、T1〜T9 + 致命バグ保護 5 件 cross-check + rc12 不変保護 + version assertion、合計 14 件）
- 既存テスト 12 ファイル（v130-features / rc7 / rc8 / rc9 / rc10 / rc12 / rc13 / rc15 / rc19 系列 3 / rc20 系列 1）の version assertion を `2.0.4-rc20` → `2.0.4-rc21` に追従更新

### Compatibility (rc21)
- 致命バグ保護 5 件すべて完全無傷（C.2.7-A `resetBlindProgressOnly` / C.2.7-D `timerState` destructure 除外 / C.1-A2 `ensureEditorEditableState` 4 重防御 / C.1.7 AudioContext resume / C.1.8 runtime 永続化 8 箇所）。`_refreshDisplayAfterStructureChange` ヘルパに `schedulePersistRuntime` を追加していない（C.1.8 境界保護）。
- **rc12 修正コード保護**: onRoleChanged ハンドラ内 `setAttribute('data-role', newRole)` 最優先 + `window.appRole = newRole` try-catch の順序を完全維持（テスト T9 / rc12 不変保護で cross-check）。タスク 2 の 6 ラベルは既存ロジックの**前後挿入のみ**で内部順序に介入していない。
- 前原さん判断 α（IDLE 時は新 Lv1 duration を即時反映）/ ③ c（進行中レベルの残り時間には反映しない、PAUSED 時は targetTime 整合性保護）すべて遵守。
- rc20 までの確定 Fix（rc7〜rc20 全件）すべて維持。

---

## [2.0.4-rc20] - 2026-05-02

### Fixed
- **問題 ⑥ 根治（タスク 1、案 A 単独採用）**: rc15〜rc19 で残存していた「ブラインドタブで構造変更 → 保存 → 適用 → 会場モニターが古いブラインドのまま」現象を根治。**真因 = `_publishDualState('structure', …)` が v2.0.0 STEP 2 で予約された kind 枠（`_dualStateCache.structure`、main.js:963）にもかかわらず、コードベース全体で呼出 0 件で死枠化していた**（rc20 第 1 弾事前調査で確定、3 体並列 sub-agent 独立到達）。修正: `src/main.js:1764-1786` `presets:saveUser` ハンドラ末尾で、当該 preset を使うアクティブトーナメントが存在する場合のみ `_publishDualState('structure', sanitized)` を強制発火。`src/renderer/renderer.js:6695-6712` の hall dual-sync handler に `kind === 'structure'` case を追加（`setStructure(value)` + `renderCurrentLevel` / `renderNextLevel` で即時再描画）。前原さん判断 ③ c に基づき、**進行中レベルの残り時間には影響しない設計**（`timer.js` の `targetTime` キャッシュは意図的に再計算しない、現レベル末端まで古い duration で継続、次レベル切替時に新 duration が効く）。約 18 行 / 2 ファイル、致命バグ保護 5 件すべて完全無傷。

### Added
- **配布版常時記録ラベル `structure:state:send` / `structure:state:recv:hall`（タスク 3）**: rc18 第 1 弾の 4 ラベル（`runtime:state:send` 等）と同パターン、`try { ... } catch (_) { }` で wrap、never throw from logging。
  - `structure:state:send` — `src/main.js:1772-1777` `presets:saveUser` ハンドラ内 `_publishDualState('structure', ...)` 直後で `rollingLog` 呼出（preset id + structureLength を記録）
  - `structure:state:recv:hall` — `src/renderer/renderer.js:6708-6711` hall dual-sync の `kind === 'structure'` 分岐内 `setStructure(value)` 直後で `window.api.log.write` 呼出（structureLength + role を記録）
- **rc20 試験で問題 ⑥ 真因確定の決定的証拠**として、これらラベルの時系列を rolling ログ採取で検証可能（rc20 第 1 弾事前調査 §6.2 シーケンス 1 参照）。

### Investigated（rc19 死コードへの (c) 並存方針）
- **rc19 で投入した `tournamentBasics` payload の `structure: validated.structure` 同梱（タスク 2）**: `normalizeTournament`（main.js:1814-1986）が `t.structure` を `out` に伝播しない仕様により、`validated.structure` は常に undefined となり**現在 dead code**。本 rc20 で案 A の `_publishDualState('structure', ...)` 経路に置換、rc19 経路は**履歴保護のため残置**（将来 normalizeTournament 修正時の二重保証）。`src/main.js:2092-2099` および `src/renderer/renderer.js:6667-6671` 双方にコメントで明示し、将来の混乱を防止。

### Tests
- `tests/v204-rc20-structure-publish.test.js` 新規追加（タスク 1+3 関連、T1〜T9 + 致命バグ保護 5 件 cross-check + rc19 (c) 並存方針 assertion + version assertion、合計 14 件）
- 既存テスト 11 ファイル（v130-features / rc7 / rc8 / rc9 / rc10 / rc12 / rc13 / rc15 / rc19 系列 3 ファイル）の version assertion を `2.0.4-rc19` → `2.0.4-rc20` に追従更新

### Compatibility (rc20)
- 致命バグ保護 5 件すべて完全無傷（C.2.7-A `resetBlindProgressOnly` / C.2.7-D `timerState` destructure 除外 / C.1-A2 `ensureEditorEditableState` 4 重防御 / C.1.7 AudioContext resume / C.1.8 runtime 永続化 8 箇所）。`presets:saveUser` ハンドラに `schedulePersistRuntime` を追加していない（preset と runtime の境界保護）。
- 前原さん判断 ① β（保存 = 保存だけ）/ ② B（連続押下しない）/ ③ c（進行中レベルには反映しない）すべて遵守。`_savePresetCore` への `setStructure` 追加なし、`handlePresetApply` の clean 時 IPC 追加なし、`timer.js` の `targetTime` 再計算経路追加なし、`normalizeTournament` 修正なし。
- rc19 までの確定 Fix（rc7〜rc18 第 1 弾 + rc19 の問題 ④⑦⑧ 解決）すべて維持。

---

## [2.0.4-rc19] - 2026-05-02

### Fixed
- **問題 ④（新規トーナメント / ブラインド構造名が初回クリックで編集できない）根治（タスク 1、案 A'' + 案 C）**: rc15 試験以降残存していた致命的 UX バグ（`presetName` を最初の 1 クリックで編集できない、フォーカス切替で治る）の真因を確定 + 修正。**真因 = `[data-role="operator"] .operator-pane`（`src/renderer/style.css:3830-3845`）が opaque（background `#0A1F3D`）かつ z-index 90、`pointer-events: none` 宣言が欠落 → `<dialog>.showModal()` の Chromium top layer 昇格と layer composition race の組合せで初回 click を operator-pane が吸収していた**。修正: ① `body:has(dialog[open]) [data-role="operator"] .operator-pane { pointer-events: none; }` 追加（ダイアログ open 時のみ hit-test 対象から外す、通常時の前原さん運用「クリックで window focus 取得」は維持）、② `.form-dialog.form-dialog--tabs { z-index: 10000; }` 追加（Chromium top layer race の二重保険）。CSS のみで完結、JS 介入ゼロ、致命バグ保護 5 件すべて完全無傷。
- **問題 ⑥ 残部（ブラインドタブ単独保存時の hall 同期遅延）解消（タスク 2、案 ⑥-A）**: rc18 第 1 弾で「トーナメントタブ保存は OK / ブラインドタブ単独保存は会場モニター切替がタイマースタート時まで遅れる」現象が残存。修正: `src/main.js:2086-2096` `tournaments:save` ハンドラの `_publishDualState('tournamentBasics', ...)` payload に `structure: validated.structure` を直接同梱、`src/renderer/renderer.js:6645-6679` の hall 側受信で `value.structure` があれば `setStructure(value.structure)` を直接呼び、無ければ既存 `loadPresetById(t.blindPresetId)` フォールバック維持で安全側。`loadPresetById` IPC 2 段化を回避、構造同期の即時化。
- **問題 ⑦（PAUSED 中 Ctrl+E specialStack 同期漏れ）解消（タスク 3、案 ⑦-A）**: rc18 第 1 弾で 7 関数末尾に `updateOperatorPane(getState())` を追加したが、`adjustSpecialStack` だけ漏れていた問題 ⑤ と完全同構造の同期漏れ。修正: `src/renderer/renderer.js:6288-6309` `adjustSpecialStack` 関数末尾に `try { updateOperatorPane(getState()); } catch (_) {}` を 1 行追加。**重要警告（C.1.8 不変条件保護）**: `schedulePersistRuntime` は意図的に追加していない（`specialStack` は `tournamentState.specialStack` であり `tournamentRuntime` ではないため、永続化は既存 `window.api.tournament.set({ specialStack })` 経路で十分、runtime 永続化 8 箇所の境界を曖昧化させない）。
- **問題 ⑧（AC 側「イベント名」項目空白表示）解消（タスク 4、案 3）**: rc18 第 1 弾試験で発覚、AC モニター左半分の「イベント名」項目が常に `'-'`（空白）表示。真因 = `updateOperatorPane`（`renderer.js:1670`）が `tournamentState.name` を読むが、initial state も `applyTournament` も `.title` のみ更新していた属性名不整合。修正: `src/renderer/renderer.js:1041-1051` `applyTournament` 内で `tournamentState.title` 代入と同時に `tournamentState.name` にも同期代入（双方向整合性保証）。

### Tests
- `tests/v204-rc19-dialog-overlay.test.js` 新規追加（タスク 1 関連、T1〜T4 + 致命バグ保護 cross-check）
- `tests/v204-rc19-structure-payload.test.js` 新規追加（タスク 2 関連、T5〜T7 + version assertion）
- `tests/v204-rc19-special-stack-and-name.test.js` 新規追加（タスク 3+4 関連、T8〜T11 + 致命バグ保護 5 件 cross-check + `schedulePersistRuntime` 不在 assertion）
- 既存テスト 10 ファイル（v130-features / rc7 / rc8 / rc9 / rc10 / rc12 / rc13 / rc15）の version assertion を `2.0.4-rc18` → `2.0.4-rc19` に追従更新

### Compatibility (rc19)
- 致命バグ保護 5 件すべて完全無傷（C.2.7-A `resetBlindProgressOnly` / C.2.7-D `timerState` destructure 除外 / C.1-A2 `ensureEditorEditableState` 4 重防御 / C.1.7 AudioContext resume / C.1.8 runtime 永続化 8 箇所）。特に C.1-A2 は本 fix が外側 hit-test 経路の修正で関数本体無介入、C.1.8 は `adjustSpecialStack` への `schedulePersistRuntime` 追加禁止により永続化境界を維持。
- rc18 第 1 弾の hall 側 `loadPresetById` フォールバック経路は完全維持（`value.structure` 不在時の旧経路）。
- 通常時の operator-pane クリック focus 取得（前原さん運用「AC 左半分クリックで window focus」）は維持、ダイアログ open 時のみ素通し。

---

## [2.0.4-rc18] - 2026-05-02

### Fixed
- **問題 ⑥ 新規トーナメント保存時の hall 構造同期漏れ根治（タスク 1、修正案 ⑥-A）**: rc17 試験で観察された「新規トーナメント保存時に hall（会場モニター）が違うブラインド構造を表示する」現象を構造的に解消。**v2.0.0 設計時から潜在していた構造的設計欠陥**（hall 側 dual-sync handler の `tournamentBasics` 受信時、`applyTournament` は `tournamentState.blindPresetId` をメモリ更新するが `setStructure(loadPresetById(blindPresetId))` を呼んでいなかった）。修正: `src/renderer/renderer.js:6645-6664` の hall 側 dual-sync handler を async 化し、`tournamentBasics` 受信後に `loadPresetById(t.blindPresetId)` で preset を取得して `setStructure(preset)` を呼ぶ + `renderCurrentLevel` / `renderNextLevel` で即時描画反映（約 14 行追加）。
- **問題 ② PAUSED 中 time-shift 連動解消（タスク 1 副次効果）**: rc17 試験「あまり変わらず」の真の根本原因が問題 ⑥ と同根（hall は level=6 を受信しても structure 不整合で level=0 に丸めて描画していた）と確定。修正案 ⑥-A の連動効果で問題 ② も解消想定（rc17 修正案 ②-1 + rc18 修正案 ⑥-A の 2 段で完成）。
- **問題 ⑤ PAUSED 中エントリー追加で AC 操作画面の operator-pane が更新されない（タスク 2）**: rc17 試験で観察された「PAUSED 中エントリー追加で AC 画面左半分の operator-pane（人数 / スタック数値表示エリア、rc4 追加）が変わらず、再開時に一気に更新される」現象を解消。真因: `addNewEntry` / `cancelNewEntry` / `eliminatePlayer` / `revivePlayer` / `resetTournamentRuntime` / `adjustReentry` / `adjustAddOn` の 7 関数は `tournamentRuntime` を直接 mutate（state.js を経由せず subscribe を発火しない）→ `updateOperatorPane()` が呼ばれない設計欠陥。修正: 各関数末尾の `schedulePersistRuntime();` 直後に `try { updateOperatorPane(getState()); } catch (_) {}` を 1 行追加（計 7 箇所、try/catch wrap）。

### Added
- **rolling ログ機構刷新（タスク 3、案 ①）**: fire-and-forget `fs.promises.appendFile` 一発打ちが I/O 順序を保証しないことが rc17 試験ログで判明（recv ts と書込順序の不一致、ログ末尾に古い ts が混入）→ **in-memory ring buffer 化**で根絶。`src/main.js:51-101` で:
  - `let _rollingLogBuffer = []` 追加（同期 push、上限 5,000 件で `shift` で古いエントリ自動削除）
  - `const ROLLING_LOG_BUFFER_MAX = 5000`（5 分 × 60 sec × 約 17 ラベル/秒余裕）
  - `_truncateRollingLog` 関数を **削除**、`async function _flushRollingLog` で置換（5 分 retention で filter → `fs.promises.writeFile` でファイル全体上書き）
  - 30 秒定期タイマーは `_flushRollingLog` を呼出（既存 `ROLLING_LOG_TRUNCATE_INTERVAL_MS` 流用）
  - `app.on('will-quit', ...)` ハンドラに `_flushRollingLog` fire-and-forget 呼出追加（line 2452）
  - `ipcMain.handle('logs:openFolder', ...)` ハンドラ先頭に `await _flushRollingLog()` 追加（line 2571、前原さんがログフォルダを開いた時点で最新状態反映）
- **常時 4 ラベル rolling ログ追加（タスク 4）**: 問題 ⑤⑥ の自動観測のため配布版にも常時記録される 4 ラベルを追加。すべて既存 rc15 機構流用、新規 IPC 追加なし、すべて `try { ... } catch (_) {}` で wrap、never throw from logging。
  - `runtime:state:send` — `src/main.js` `_publishDualState` 内で `kind === 'tournamentRuntime'` のみ `rollingLog` 呼出（main 送信 ts 記録）
  - `runtime:state:recv:hall` — `src/renderer/dual-sync.js` `_applyDiffToState` 内で `kind === 'tournamentRuntime'` のみ `window.api.log.write` 呼出（hall 受信 ts 記録）
  - `blindPreset:state:send` — `src/main.js` `_publishDualState` 内で `kind === 'tournamentBasics'` のみ `rollingLog` 呼出
  - `blindPreset:state:recv:hall` — `src/renderer/dual-sync.js` `_applyDiffToState` 内で `kind === 'tournamentBasics'` のみ `window.api.log.write` 呼出

### Investigated
- **問題 ④（新規トーナメント名が編集できない）は本フェーズの対象外**（rc18 第 2 弾事前調査依頼予定、DevTools 実機観測待ち）
- **問題 ① IPC レイテンシ「重い」体感**: rc17 試験ログ実測で 1ms〜574ms の極端二極化（94ms / 112ms / 1ms / 467ms / 574ms）を確認。重大発見: ログ ts そのものが信用できない可能性（fire-and-forget appendFile による I/O 順序乱れ）→ rc18 ring buffer 化で計測精度確保 → 再計測 → rc19 で本質的修正判断（IPC 順序入替案 ② は C.1.8 整合性窓拡大リスクのため第 2 弾以降で慎重判断）

### Compatibility (rc18)
- **致命バグ保護 5 件すべて完全維持**: C.2.7-A / C.2.7-D / C.1-A2 + C.1.4-fix1 Fix 5 / C.1.7 / C.1.8（タスク 2 で `schedulePersistRuntime` の 500ms debounce には触らず `updateOperatorPane` 呼出強化のみ）
- **rc7〜rc17 確定 Fix すべて維持**
- **operator-solo モード（v1.3.0 互換）影響なし**

### Tests (rc18)
- **新規テスト 2 ファイル**: `tests/v204-rc18-structure-and-pane-sync.test.js`（T1〜T8 + 致命バグ保護 5 件 + rc17 機構維持 = 計 15 件）+ `tests/v204-rc18-ring-buffer-and-labels.test.js`（T6〜T13 ring buffer + 4 ラベル + 致命バグ保護 5 件 + rc15/rc17 維持 + rc18 削除確認 = 計 19 件）。**追加 34 件すべて PASS**。
- **既存テスト追従**: `tests/v204-rc15-break-end-and-rolling-log.test.js` の T6-B / T6-C / T7 を rc18 仕様（`_truncateRollingLog` → `_flushRollingLog`、`appendFile` → `writeFile`）に追従更新。各 rc 追従用 version assertion テスト 8 ファイルを `2.0.4-rc17` → `2.0.4-rc18` 値更新。既存テスト全件（rc15 まで 540 件 + 新規 34 件）PASS、skip / コメントアウト / 無効化なし。

---

## [2.0.4-rc17] - 2026-05-02

### Fixed
- **問題 ② PAUSED 中 time-shift 不同期の根治（タスク 1）**: rc15 試験で観察された「PAUSED 中の進める/戻す操作で hall 側が固まり、解除時に一気に変わる」現象を構造的に解消。真因は `src/renderer/renderer.js:1579` の subscribe ガード `if (state.status !== prev.status || state.currentLevelIndex !== prev.currentLevelIndex)` が PAUSED 中の `remainingMs` 単独変化を弾いていたこと。修正案 ②-1（rc16 事前調査で確定）採用、ガードに `(state.status === States.PAUSED && state.remainingMs !== prev.remainingMs)` の OR 分岐を追加（1 行）→ `schedulePersistTimerState()` 経由で `tournaments:setTimerState` IPC が発火 → `_publishDualState` 経由で hall に同期。**500 ms debounce で IPC 集約は維持**、RUNNING / BREAK / PRE_START は対象外（既存ガードで十分）。

### Added
- **常時 3 ラベル rolling ログ（タスク 2）**: 配布版にも常時記録される 3 ラベルを追加、本配布後の障害発生時の自動観測ツールとして機能。
  - `timer:state:send` — `src/main.js` `_publishDualState(kind, value)` 内で `kind === 'timerState'` のみ `rollingLog()` 呼出（main 送信 ts 記録）
  - `timer:state:recv:hall` — `src/renderer/dual-sync.js` `_applyDiffToState(diff)` 入口で `kind === 'timerState'` のみ `window.api.log.write()` 呼出（hall 受信 ts 記録）
  - `render:tick:hall` — `src/renderer/renderer.js` subscribe コールバック内で `window.appRole === 'hall'` のみ `window.api.log.write()` 呼出（hall 描画タイミング記録）
  - すべて `try { ... } catch (_) {}` で wrap、never throw from logging。既存 rc15 rolling ログ機構流用、新規 IPC 追加なし。

### Investigated
- **問題 ③（トーナメント削除ダイアログが開かない、タスク 3）**: rc18 で修正予定。最有力候補は仮説 ③-3（別 `<dialog>` open 中の二重 `showModal()` で `InvalidStateError` がサイレント throw）。`renderer.js:3835` `el.tournamentDeleteDialog.showModal?.()` は `<dialog open>` 残存時に例外を throw するが、`handleTournamentRowDelete` は呼出側で `await` も `.catch` もしておらず、`try/finally` のみ（`catch` なし）→ 例外は unhandledrejection に流れるが rolling ログには記録なし = 無音失敗。修正案 A（dialog open ガード 1 行追加）+ 案 B（例外可視化 5〜8 行）併用を推奨、致命バグ保護 5 件への影響ゼロ。
- **問題 ④（新規トーナメント名が編集できない再発、タスク 4、🚨最優先）**: rc18 で修正予定。**真因は致命級の対象オブジェクト誤認**。`ensureEditorEditableState`（renderer.js:4563-4575）は `el.presetName`（ブラインド構造プリセット名）と blinds テーブルのみを操作し、**`el.tournamentTitle`（イベント名 input）には一切触っていない**。git blame で C.1.4-fix1 Fix 5 当時から `_handleTournamentNewImpl` 末尾の `ensureEditorEditableState` 2 重呼出は完全維持されているが、その関数が `tournamentTitle` を救う対象として元から含んでいない。「タイマー画面に戻ると治る」現象は modal `<dialog>` の focus context リセットによる focus race の解消で説明可能。**致命バグ保護 5 件は無傷、テスト盲点（`tournamentTitle` の編集可能性検査が 0 件）が見逃しの構造原因**。修正案 A（`_handleTournamentNewImpl` 末尾で `tournamentTitle.readOnly = false; .disabled = false; removeAttribute` を明示クリア、約 10 行）推奨、致命バグ保護への影響ゼロ。

### Compatibility (rc17)
- **致命バグ保護 5 件すべて完全維持**: C.2.7-A / **C.2.7-D 強化方向**（PAUSED 中 remainingMs 同期経路追加でも timerState destructure 除外設計は維持）/ C.1-A2 + C.1.4-fix1 Fix 5 / C.1.7 / C.1.8
- **rc7〜rc15 確定 Fix すべて維持**
- **operator-solo モード（v1.3.0 互換）影響なし**

### Tests (rc17)
- **新規テスト 1 ファイル**: `tests/v204-rc17-paused-time-shift-sync.test.js` を T1〜T8（PAUSED 同期トリガ条件式 4 + 3 ラベル rolling ログ 4）+ 致命バグ保護 5 件 cross-check + rc15 機構維持 3 件 = **計 16 件すべて PASS**。既存テスト全件 (rc15 まで 524+ 件) PASS、追従更新の必要なし（grep で `schedulePersistTimerState` / `_publishDualState` / `_applyDiffToState` を確認、rc17 PAUSED 経路追加の影響なし）。

---

## [2.0.4-rc15] - 2026-05-02

### Fixed
- **break-end 音が鳴らない問題の根治（タスク 1）**: rc13 試験で「BREAK 終了時の `break-end.mp3` だけ鳴らない」現象（パターン B）の真因を確定し構造的に解消。真因は `handleAudioOnTick` の `if (remainingSec === 0) playSound('break-end')` が onTick 1 フレーム（〜16 ms）しか持続せず、`onLevelEnd` の event loop race で見落とされること。修正: `playSound('break-end')` を `onLevelEnd` ハンドラの `lv.isBreak === true` 経路に移動（5〜6 行）、レベル境界で確実に発火。`warning-10sec` / `countdown-tick` は範囲判定のため race 影響なし、現状維持。

### Added
- **5 分 rolling ログ機構（タスク 2）**: バグ発見支援のため `<userData>/logs/rolling-current.log` に直近 5 分間のイベントを JSON Lines 形式で常時記録。30 秒定期で 5 分超を切り捨て（容量上限 ~1 MB）。記録対象: app:ready / app:before-quit / display-added/-removed / switchOperatorToSolo/SoloToOperator / second-instance / audio:play:enter/resumed/exit / window-state（focus/blur/resize、debounce 200ms）/ uncaughtException / unhandledRejection / renderer:onRoleChanged。タイマー 1 秒 tick / 通常ボタン click は記録しない（負荷主因）。**非同期 IO（`fs.promises`）必須**でメイン処理ブロック回避、main プロセス集約でロックフリー化。
- **「ログフォルダを開く」ボタン**: 設定ダイアログ「ハウス情報」タブに追加（`shell.openPath` で OS のファイルマネージャを開く）。バグ発生時に前原さんが 1 ファイルコピーで構築士に共有可能。

### Removed
- **H ショートカット説明の行ごと完全削除（タスク 3）**: `src/renderer/index.html` 行 102 の `<li><kbd>H</kbd> 手元 PC 側のボトムバー切替</li>` および `docs/specs.md` 行 430 の H 行を削除。**H キー機能本体（renderer.js の keydown ハンドラ KeyH）は完全無変更**で維持。前原さん要望「AC 画面が見えている時はそもそもショートカット欄も見えていない」前提で説明文の意義が薄かったため。

### Compatibility (rc15)
- **致命バグ保護 5 件すべて完全維持**: C.2.7-A / C.2.7-D / C.1-A2 + C.1.2-bugfix / C.1.7（rolling ログは観測のみ介入なし）/ C.1.8
- **rc7〜rc14 確定 Fix すべて維持**: specialStack / 二重送信 / app.focus / 単一インスタンス / onRoleChanged setAttribute 最優先 / appRole try-catch / 複製 readonly / BREAK 中 10 秒前 / 5 秒カウント音
- **operator-solo モード（v1.3.0 互換）影響なし**

### Tests (rc15)
- **新規テスト 1 ファイル + 既存 6 ファイル追従更新**: `tests/v204-rc15-break-end-and-rolling-log.test.js` を T1〜T10（onLevelEnd 移行 + rolling ログ infrastructure + IPC + UI ボタン）で構築、既存テストの H 行検証を「不在確認」に統一書き換え + version 期待値を rc15 に追従。

---

## [2.0.0] - 2026-05-01

### Added
- **2 画面対応（HDMI 拡張モニター）**: ホール側（お客向け）= タイマー / ブラインド / テロップ等の表示専用、PC 側（運営者操作用）= 操作 UI + 画面上部のミニ状態バー（Level / Time / Status）。役割は `BrowserWindow.webPreferences.additionalArguments: ['--role=operator|hall|operator-solo|picker']` で渡し、preload.js が `data-role` 属性付与
- **起動時のモニター選択ダイアログ**: 検出されたモニター 2 枚以上で表示。各モニターをカード表示（ラベル / 解像度 / プライマリ / 前回選択バッジ）、毎回手動選択（自動記憶しない、前原さん要望）。キャンセルで単画面モードで起動。前回選択は `electron-store` に参考保存
- **HDMI 抜き差し追従**: `screen.on('display-added' / 'display-removed')` イベント駆動（ポーリング禁止）。営業中の自動切替、タイマー進行は main プロセスで持続して中断ゼロ。ウィンドウ役割切替は**再生成方式**（`additionalArguments` は process.argv 注入のため reload では変更不可）
- **状態同期インフラ**: main プロセスを単一の真実源とする `_dualStateCache`（9 種類）+ `_broadcastDualState` + `_publishDualState`。既存 IPC ハンドラ末尾に publish 呼出を追加（`tournaments:setTimerState` / `setRuntime` / `setDisplaySettings` / `setMarqueeSettings` / `save` / `setActive` / `audio:set` / `settings:setVenueName`）。ホール側は `dual-sync.js` の `initDualSyncForHall` で初期同期 + 差分購読（イベント駆動、ポーリング禁止）
- **役割ガード**: renderer.js の主要操作 handler 14 箇所に `window.appRole === 'hall'` ガード（`handleStartPauseToggle` / `openResetDialog` / `openPreStartDialog` / `openSettingsDialog` / `handleTournamentNew` / `handleTournamentDuplicate` / `handleTournamentRowDelete` / `handleTournamentSave` / `handlePresetSave` / `handlePresetApply` / `handleMarqueeSave` / `handleReset` / `addNewEntry` / `eliminatePlayer`）。致命バグ保護関連の関数には**意図的にガードを追加せず**、PC 側で動作必須を維持
- **operator → main 通知経路**: `window.api.dual.notifyOperatorAction` + `notifyOperatorActionIfNeeded` ヘルパ（`role === 'operator'` のみで通知、operator-solo は no-op）
- **v2.0.0 専用テスト 52 件追加**: v2-dual-sync (8) / v2-role-guard (8) / v2-display-picker (8) / v2-display-change (8) / v2-integration (8) / v2-backward-compat (6) / v2-edge-cases (6)。既存 138 + 新規 52 = **190 件すべて PASS**

### Changed
- **AudioContext resume 強化（C.1.7 拡張）**: operator-solo 起動時に `ensureAudioReady()` 明示呼出を追加（HDMI 抜き直後のウィンドウ再生成 → AudioContext suspend のリスクに対する防御強化）。`audio.js _play()` 内 suspend resume はそのまま維持
- **CSS `[data-role]` 役割別 UI 分離**: hall = `.bottom-bar` / `.form-dialog` / `.confirm-dialog` / `.pip-action-btn` を hidden、operator = `.clock` / `.marquee` / `.slideshow-stage` / `.pip-timer` / `.bg-image-overlay` を hidden + `.operator-status-bar` を表示、operator-solo = 何も hidden しない（v1.3.0 完全同等）
- **`createMainWindow` async 化**: モニター選択ダイアログを await するため。`app.whenReady().then(async () => ...)` + `app.on('activate', async () => ...)` も async 化
- **STEP 1 のバッジ削除**: `[data-role]` 視認用バッジ（🖥 HALL / 💻 OPERATOR）は本番運用での誤表示防止のため CSS から削除

### Compatibility
- **単画面モード（HDMI なし環境）は v1.3.0 と完全同等**: 自動的に `operator-solo` で起動、`[data-role="operator-solo"]` は一切の hidden ルールを当てない
- **致命バグ保護 5 件すべて完全維持**: `resetBlindProgressOnly`（C.2.7-A）/ `timerState` destructure 除外（C.2.7-D Fix 3）/ `ensureEditorEditableState` 4 重防御（C.1-A2 系）/ AudioContext resume（C.1.7、強化）/ runtime 永続化 8 箇所（C.1.8）
- **store スキーマ変更なし**: 新規キー `preferredHallDisplayId`（モニター選択の参考情報）のみ追加。既存 `tournaments` / `settings` / `displaySettings` / `audio` / `marquee` / `logo` / `venueName` はすべて v1.3.0 と同じ構造
- **CSP `script-src 'self'` 不変**: 新規 `display-picker.html` も外部 `display-picker.js` を読み込む方式、inline script なし

### Migration Notes
- **v1.3.0 → v2.0.0 のデータ移行は不要**: store スキーマ変更なし、既存 tournaments / settings / displaySettings そのまま使用可
- HDMI モニターが繋がっていない PC では v2.0.0 にアップデートしても何も変わらない（自動的に operator-solo モードで起動）
- 2 画面環境では起動時にモニター選択ダイアログが表示される、運営者がホール側を選ぶフローに切り替わる

### Tests
- v2-dual-sync.test.js（8 件）/ v2-role-guard.test.js（8 件）/ v2-display-picker.test.js（8 件）/ v2-display-change.test.js（8 件）/ v2-integration.test.js（8 件）/ v2-backward-compat.test.js（6 件）/ v2-edge-cases.test.js（6 件）追加
- 既存 138 + 新規 52 = **190 件全 PASS**

### Documentation
- `docs/specs.md`: 「v2.0.0 機能追加（2 画面対応大改修）」セクション追記（役割分離 / モニター選択 / HDMI 追従 / 状態同期精度基準 / AudioContext 再初期化 / 後方互換）
- `skills/timer-logic.md`: v2.0.0 不変条件 G〜L を追加（hall purely consumer / main 真実源 / operator-solo v1.3.0 同等 / 再生成方式 / AudioContext 強化 / ポーリング禁止）
- `skills/v2-dual-screen.md`: STEP 0 で新規作成（アーキテクチャ / 同期精度 / HDMI 追従 / モニター選択 / 禁止事項 / テスト方針）
- `docs/v2-design.md`: STEP 0 設計調査結果（既存コード影響範囲 / 2 ウィンドウ動作検証 / 状態同期最小セット / 切替設計案 / リスク分析 / 致命バグ保護への影響評価）
- `skills/cc-operation-pitfalls.md`: 公式準拠の絶対遵守事項（並列 sub-agent 上限 3 体 / 「念のため」コード追加禁止 / context 肥大化検知 / 致命バグ保護不変条件）

---

## [1.3.0] - 2026-04-30

### Added
- **自動更新（次回更新版から動作）**: electron-updater 統合済み。GitHub Releases から新版を自動取得 → ダウンロード完了で再起動確認ダイアログ。本リリース v1.3.0 が初回配布のため、次回更新版（v1.3.1 以降）から動作開始します。`package.json` の `build.publish` は GitHub リポジトリ（`maetomo08020802-eng/PokerTimerPLUS`）に紐づけ済み
- **DONE 状態（'finished'）**: 全レベル完走時に明示的な完了ステータス保持。再起動しても完了状態維持、メイン画面に「トーナメント終了」緑系オーバーレイ表示
- **Ctrl+Q 状態別メッセージ**: タイマー RUNNING / PAUSED / BREAK 中は「タイマーが進行中です。本当に終了しますか？」と警告。IDLE / FINISHED は従来メッセージ
- **About 画面に DevTools 注記**: ハウス情報タブ末尾に「F12 / Ctrl+Shift+I で開発者ツールが開きます（開発者向け機能、通常使用には不要）」を追加
- **背景にカスタム画像を設定可能**（C.1.3）: 設定タブ「背景・時計フォント」に 9 種類目「カスタム画像」を追加。PNG / JPEG / WebP（5MB 以下）を OS ダイアログで選択 → 背景に表示。数字視認性確保のため自動で暗くする overlay（弱 30% / 中 50% / 強 70% から選択、既定 50%）。トーナメント単位 + グローバル既定値で保存。base64 data URL 直保存方式
- **休憩中・開始前カウントダウン中のスライドショー機能**（C.1.4）: 設定タブに「休憩中の画像（スライドショー）」セクションを追加。複数画像（最大 20 枚、各 5 MB 以下）を登録 → 休憩時間に画面いっぱいで自動切替表示。**休憩開始から 30 秒経過後に開始** + 0.8 秒のじんわりフェードイン。**右下に縮小タイマー（PIP）** を金色枠で同時表示（小 / 中 / 大の 3 サイズ）。再開 1 分前で自動的に通常画面復帰。手動切替ボタン 2 種（タイマー画面に戻す / スライドショーに戻る）も画面左下に配置。残り 1 分以内は「スライドショーに戻る」が無効化
- **設定ダイアログの拡大とリサイズ強化**（C.1.3-fix2/fix3）: 初期サイズを 1000×700px、最大 95vw×95vh に拡大。右下のリサイズハンドルでドラッグ可能
- **メイン画面のフォント拡大**（C.1.4-fix3）: 「レベル○」表示を約 1.7 倍、アベレージスタック等の右カラム数字を約 1.3 倍、プレイヤー / リエントリー / アドオン人数を 1.5 倍に拡大。アベレージスタックは 8 桁時のみ自動 0.8 倍縮小で右カラム幅を超えない
- **画像データサイズ警告**（C.1.4-fix3）: 全トーナメント画像合計が 150 MB を超えるとアプリ起動時に警告ポップアップを 1 度表示。設定タブの該当セクション見出しに ⚠ アイコンも常時表示
- **設定ダイアログの中身追従リサイズ**（C.1.6）: ダイアログを縦に伸ばすと中身（タブ内のフォーム）も追従して見える範囲が増える。`<dialog>` 内側に wrapper を挟む方式で ✕ボタン / リサイズハンドルの挙動を完全維持
- **NEXT BREAK IN ↔ TOTAL GAME TIME 自動切替**（C.1.6）: 残りのブレイクがすべて消化されると自動的に「TOTAL GAME TIME（トーナメントスタートからの累積時間）」表示に切替
- **NEXT BREAK IN タイマーの拡大**（C.1.5-patch）: 右上カラムのタイマー表示を 1.4 倍に拡大（視認性向上）
- **TOTAL PRIZE POOL の 7 桁時自動縮小**（C.1.7-patch）: 7 桁以上（¥1,000,000 以上）になった時のみ font-size を 0.85 倍に縮小して見切れ防止

### Fixed
- **音欠落バグ（重大）**（C.1.7）: 長時間 PAUSED 後の resume / 別ウィンドウ復帰 / PC スリープ復帰等で AudioContext が suspend 状態に遷移し、警告音 / カウントダウン音 / ブレイク終了音が鳴らなくなる現象を修正。`audio.js _play()` 冒頭で suspend 検出 + resume を追加することで全音発火パスを 1 箇所修正で一括解決
- **トーナメント途中のアプリ再起動でランタイムデータ消失（重大）**（C.1.8）: プレイヤー人数 / リエントリー / アドオン人数等のランタイムデータが `tournaments` テーブルに永続化されていなかったため、アプリ終了で消失していた問題を修正。runtime フィールド追加 + 8 箇所のミューテーション関数で都度永続化（debounce 500ms）+ 起動時復元
- **README に Windows SmartScreen 警告対応手順追加**（C.1.5）: 配布版を初回起動するユーザーが戸惑わないよう、3 ステップの起動手順 + 「外部通信なし」明記

### Fixed
- **audit 残課題 3 件**（C.1.1）: switching ガード（タイマー #20）/ preset 削除警告（UX #38）/ ID 衝突防止（エッジ #19）
- **新規トーナメント作成 → 複製して編集の readonly 残存バグ**（C.1.2-bugfix）: ensureEditorEditableState の builtin 保護内蔵化 + 多点防御拡張

### Documentation
- `CHANGELOG.md`: v1.3.0 リリースノート
- `package.json`: build.publish 設定は **GitHub リポジトリ作成後に追加予定**（C.1.2-followup でいったん削除）

### Tests
- audit-residuals.test.js（8 件）/ new-tournament-edit.test.js（8 件）/ v130-features.test.js（12 件）/ c13-bg-image.test.js（19 件）/ c14-slideshow.test.js（24 件）/ c16-features.test.js（8 件）/ c17-audio-resume.test.js（6 件）/ c18-runtime-persistence.test.js（6 件）追加
- 合計 138 件全 PASS

---

## [1.2.0] - 2026-04-30

STEP 10 完了マイルストーン。ゲーム種拡張・MIX 編集・致命バグ修正・UI 全面刷新を含むメジャーアップデート。

### Added

- **新ゲーム種**: Limit Hold'em / MIX (10-Game) / その他（自由記入）
- **構造型 5 種**: BLIND / LIMIT_BLIND / SHORT_DECK / STUD / **MIX**（新規）
- **MIX レベルごと自由編集**: 「複製して編集」フローで各レベルのゲーム種を 10 種から自由選択（NLH/PLO/PLO8/Limit Hold'em/Omaha Hi-Lo/Razz/Stud/Stud Hi-Lo/Short Deck/Big O Limit）+ 動的フィールド切替 + 値継承
- **MIX ゲーム数自動カウント**: メイン画面の「MIX (○-Game) — 現在: NLH」の○がユニーク subGameType 数で動的算出
- **同梱プリセット 4 → 8 種**: Limit 標準 / Short Deck 標準 / Stud 標準 / MIX 標準（10-Game）追加
- **「ブレイク終了後に一時停止」**機能（pauseAfterBreak）
- **PAUSED 3 択モーダル**: リセット / 経過保持で適用 / 構造のみ適用（一時停止維持）
- **テンプレート紐づけ表示**: 「『金曜タワー』で使用中」「未使用」「『〇〇』他 N 件で使用中」を ドロップダウンに表示
- **powerSaveBlocker**: タイマー RUNNING / PRE_START / BREAK 中にディスプレイスリープを防止、PAUSED / IDLE で解除
- **JSON import の UTF-8 BOM 対応**: ファイル / クリップボード両方
- **テロップ 200 文字上限**: HTML maxlength + JS sanitize の二重防御
- **トーナメント削除の二重起動防止**: in-flight フラグ
- **数字縮小ロジック**: data-max-digits でカード単位統一縮小（不揃い問題解消）
- **4 桁以下の項目間隔均等**: data-max-digits ≤ 4 で `space-around`、5+ 桁は既存 `space-between`
- **ensureEditorEditableState ヘルパ**: 「複製して編集」直後の readonly 残存を 4 重保証で防止

### Changed

- **数字フォント**: Oswald 700 → **Barlow Condensed 700**（細身、視認性向上、SIL OFL 1.1）
- **アプリアイコン**: 「P」ロゴ → **黒背景 + 白「20:40」7-segment LCD 風**（デジタル時計風、フォント不使用）
- **用語変更**（ブラインド構造文脈のみ）:
  - 「プリセット」→「テンプレート」
  - 「プリセット名」→「ブラインド構造名」
  - 「ユーザープリセット: M/100 件」→「保存済みテンプレート: M/100 件」
  - 背景プリセット / 賞金プリセット / 色プリセットは無変更
- **テンプレ名 maxlength**: 40 → 50 文字（HTML + JS 二重防御）

### Fixed

- **【致命】8-8 — PAUSED で「保存して適用」で tournamentRuntime（プレイヤー人数・リエントリー・アドオン・バイイン）が消失するバグ**: `handleReset()` を 2 関数に責任分離（`resetBlindProgressOnly()` / `handleReset()`）、不変条件「ブラインド構造を変えても runtime は消えない」を確立
- **timerState 上書き race**: タイマー RUNNING 中のプリセット保存でタイマーが巻き戻る race を `persistActiveTournamentBlindPresetId` の payload から timerState を destructure 除外することで解決
- **「複製して編集」後の readonly 残存**: 名前・BigBet 等の数値が編集できない問題を `ensureEditorEditableState()` ヘルパ + 4 重保証で根本解決
- **自由記入欄が常時表示されるバグ**: CSS `.form-row { display: flex }` が `[hidden]` 属性を上書きする問題に対し `.form-row[hidden] { display: none }` で根本解決
- **ブレイクラベル「ブレイク中」（薄い青カタカナ）を削除**: 明色背景でコントラスト低下する問題を `display: none` で安全に非表示化（HTML 残置で復元容易）
- **大きい数値（7 桁以上）の重なり**: Barlow Condensed フォント置換 + カード単位 data-max-digits 縮小で解決
- **preset name の JS sanitize ギャップ**: 50 文字 slice を main.js `presets:saveUser` に追加

### Performance

- ブラインド構造編集テーブルの描画を **DocumentFragment で一括挿入**（O(N²) reflow → O(N)）。50+ levels で体感改善

### Security

- powerSaveBlocker IPC（`power:preventDisplaySleep` / `power:allowDisplaySleep`）の単一 blocker ID 管理 + アプリ終了時の確実な解放
- `preset name` / marquee text の IPC 経由攻撃防御（巨大文字列の slice 防御）

### Documentation

- `docs/specs.md`: STEP 10 機能追加を網羅記載
- `skills/timer-logic.md`: 6 つの不変条件（A〜F）を明文化
- `CLAUDE.md`: isUserTypingInInput / ensureEditorEditableState / tournamentRuntime 不変条件の運用ルール追加
- `CREDITS.md`: Barlow Condensed フォント追加、App Icon オリジナル制作の記載

### Tests

合計 **47 テスト**（既存 7 + 新規 40）が静的解析・回帰防止を担保:
- `data-transfer.test.js`（7）
- `runtime-preservation.test.js`（6）— 致命バグ 8-8 リグレッション防止
- `audit-fix.test.js`（9）
- `paused-flow.test.js`（9）
- `race-fixes.test.js`（5）
- `light-todos.test.js`（4）
- `editable-state.test.js`（7）

---

## [1.1.0] - 2026-04 (Previous Release)

STEP 9 完了。左上ロゴ差替機能 + アプリアイコン（P ロゴ）。配布リリース。

### Added
- 左上ロゴ表示（任意の店舗ロゴをアップロード可能）
- アプリアイコン（タイマー＋P）

---

## [1.0.0] - 2026-04 (Initial Release)

STEP 1〜8 完了。基本機能リリース。

### Added
- ブラインドタイマー（カウントダウン + レベル進行）
- ブラインド構造管理（同梱プリセット 4 種 + ユーザーカスタム）
- 通知音（5 種類、商用無料・効果音ラボ提供）
- スタートカウントダウン
- プレイヤー / 賞金管理（プール / アベスタック / PAYOUTS）
- 設定永続化（electron-store 経由）
- 配布ビルド（Windows NSIS インストーラ + macOS DMG）

---

製作: Yu Shimomachi（PLUS2 運営）
配布: 全国のポーカールームへの無料配布
