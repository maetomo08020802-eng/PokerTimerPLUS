# Changelog

All notable changes to PokerTimerPLUS+ will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

製作: Yu Shitamachi（PLUS2 運営）
配布: 全国のポーカールームへの無料配布
