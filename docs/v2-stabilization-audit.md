# v2.0.1 Stabilization 網羅調査結果

**作成日**: 2026-05-01（v2.0.1 Stabilization、特例 7 時間自走）
**調査者**: CC（並列 sub-agent 3 体、各担当範囲を網羅調査）
**対象**: v2.0.0 完成後の配布前最終バグ取り

---

## 調査体制

並列 sub-agent 3 体（公式 Agent Teams 推奨遵守）:
- **Agent 1**: トーナメント / プレイヤー / 賞金管理 handler
- **Agent 2**: ブラインド構造 / プリセット / テロップ / ロゴ / 表示設定
- **Agent 3**: タイマー状態遷移 / 音 / HDMI 追従 / IPC / 致命バグ保護周辺

各 Agent は**実コードで再現することを確認**した項目のみ報告（C.2.6 教訓: 過去 audit の 10 件中 9 件は再現せず）。

---

## 致命バグ保護 5 件 — 現状維持確認（Agent 3 担当領域）

| 保護 | 状態 | 根拠 |
| --- | --- | --- |
| `resetBlindProgressOnly`（C.2.7-A）| **OK** | renderer.js:5897 で runtime に触らず `timerReset` のみ |
| `timerState` destructure 除外（C.2.7-D）| **OK** | main.js:1838-1881 setDisplaySettings で timerState を一切触らない |
| `ensureEditorEditableState` 4 重防御（C.1-A2 系）| **OK** | renderer.js の編集系経路に変更なし |
| AudioContext resume in `_play()`（C.1.7）| **OK** | audio.js:503-505 で suspend 時 resume 維持 |
| runtime 永続化 8 箇所（C.1.8）| **OK** | renderer.js:1409 + main.js:1799 の hook 全件生存 |

---

## 発見事項（優先度順）

### #A1 [致命] hall 側が `dual:state-sync` 受信値を一切消費していない（同期コア機能不全）

- **状況**: 2 画面モードで operator 側がテロップ・ロゴ・背景画像・スライドショー・店舗名等を変更しても、hall 側のメイン画面に反映されない
- **再現条件**:
  - `src/renderer/dual-sync.js:24` `_applyDiffToState` は `setState({ [\`dual_${kind}\`]: value })` で `appState` に書き込むのみ
  - `src/renderer/state.js` 全体で `dual_*` プレフィックスを読む subscriber がゼロ件（grep 確認済）
  - main.js は `_publishDualState('marqueeSettings'|'displaySettings'|'venueName'|...)` で正しく hall に push しているが、hall 側で受信しても何もしていない
  - 初期同期（hall 起動時の `dual:state-sync-init`）は `initialize() → tournaments.getActive() → applyTournament` 経路で正常反映、起動以降の差分は受信しても捨てられる
- **影響**: テロップ文字列変更、ロゴ切替、背景画像変更、breakImages 追加・削除、interval 変更、pipSize 変更、店舗名変更すべてが hall に伝わらない（v2 の 2 画面同期というコア機能の機能不全）
- **修正方針**: `dual-sync.js` の `_applyDiffToState` で kind 別に動的呼出（`marqueeSettings → applyMarquee`, `displaySettings → applyBackground/applyTimerFont/applyPipSize 等`, `logoUrl → applyLogo`, `venueName → applyVenueName`, `tournamentBasics → applyTournament 部分反映`, `tournamentRuntime → tournamentRuntime 反映 + renderStaticInfo`）。renderer.js から該当関数を export してインポート。修正範囲: dual-sync.js（30〜50 行追加）+ renderer.js（数関数の export 化）
- **致命バグ保護への影響**: 影響なし

### #A2 [致命] hall 側が `schedulePersistTimerState` で main の timer state を上書き（hall purely consumer 原則違反）

- **状況**: HDMI 接続時、hall の renderer も `initialize()` を実行するため `subscribe → schedulePersistTimerState → window.api.tournaments.setTimerState` を呼び、main の store を逆書込
- **再現条件**:
  - `src/renderer/renderer.js:6177` `initDualSyncForHall().finally(() => initialize())` で hall も `initialize()` を実行
  - `:6150` `startPeriodicTimerStatePersist()` が hall でも開始 → `:1437` `setInterval(periodicPersistAllRunning, 5000)` で 5 秒毎に setTimerState
  - `:1530` subscribe 内 `:1558` `schedulePersistTimerState` で同 id を debounce 500ms で書込
- **影響**: operator の pause/start 操作が hall 側の自前 timer 状態（applyTimerStateToTimer 経由）で書き戻される → 状態揺れ・タイマーステータス race。「hall は purely consumer」原則違反（v2-dual-screen.md §1.3）
- **修正方針**: `schedulePersistTimerState` / `startPeriodicTimerStatePersist` / `schedulePersistRuntime` / 各種 `setTimerState` 経路の冒頭に `if (window.appRole === 'hall') return;` ガード（10〜15 行）
- **致命バグ保護への影響**: 影響なし（runtime 永続化は operator 側で正常動作維持）

### #B1 [高] ランタイム操作系 5 ハンドラに hall ガード漏れ

- **状況**: hall 側でキーボードショートカット（Shift+↑/↓ / Ctrl+R/A/E）が hidden UI を介さず handler に到達
- **再現条件**: `src/renderer/renderer.js`
  - `cancelNewEntry()` 5835（Shift+↑、5773 で発火）
  - `revivePlayer()` 5859（Shift+↓、5783 で発火）
  - `adjustReentry()` 5908（Ctrl+R、5748 で発火）
  - `adjustAddOn()` 5916（Ctrl+A、5758 で発火）
  - `adjustSpecialStack()` 5927（Ctrl+E、5765 で発火）
  - 比較: `addNewEntry`（5823）/ `eliminatePlayer`（5849）には hall ガードあり
- **影響**: hall 側でランタイム値（リエントリー数 / アドオン数 / 特殊スタック / プレイヤー復活 / 取消）が改変される。`adjustSpecialStack` は更に `tournament:set` を呼ぶため main の永続データを書換 → 両画面 UI 不整合
- **修正方針**: 各関数の冒頭に `if (window.appRole === 'hall') return;`（5 行 / 1 ファイル）
- **致命バグ保護への影響**: 影響なし

### #B2 [中] tournaments:delete / importPayload で hall への broadcast 漏れ

- **状況**: 削除で active が切り替わった場合 / インポートで active トーナメントを上書きした場合、main の store は更新されるが hall への `_publishDualState` broadcast がない
- **再現条件**: `src/main.js`
  - `tournaments:delete` 2004-2014: `activeTournamentId` 切替時に `_publishDualState` 無し
  - `tournaments:importPayload` 1946-2001: store.set 後 broadcast 無し（active 上書きでも）
- **影響**: hall がメイン画面に古いトーナメント名 / payouts / buyIn / runtime を表示したまま固まる
- **修正方針**: 削除後・インポート後に新 active を取得して `_publishDualState('tournamentBasics' / 'displaySettings' / 'marqueeSettings' / 'tournamentRuntime' / 'timerState')` を順次配信（15 行 / 1 ファイル）
- **致命バグ保護への影響**: 影響なし

### #B3 [中] schedulePersistRuntime にトーナメント切替中ガード無し（runtime race）

- **状況**: 旧 active で `tournamentRuntime` 変更 → 500ms debounce → 完了前に `handleTournamentSelectChange` 等で `_tournamentSwitching=true` 遷移 → debounce タイマが新 `tournamentState.id` を見て setRuntime 発火
- **再現条件**: `src/renderer/renderer.js:1409-1425` `schedulePersistRuntime` の callback が `_tournamentSwitching` を見ない & cancel もしない
- **影響**: 高速操作時、新 active の runtime が「旧 active の値」で上書きされる
- **修正方針**: callback 冒頭に `if (_tournamentSwitching) return;` を追加し、新規 / 複製 / 切替経路冒頭で debounce timer cancel（4 行）
- **致命バグ保護への影響**: C.1.8（runtime 永続化 8 箇所）の意図を**強化**、影響なし

### #B4 [中] _dualStateCache の structure / logoUrl が一度も publish されない

- **状況**: cache に枠だけあり、`_publishDualState('structure'/'logoUrl')` の呼出ゼロ
- **再現条件**: `src/main.js:864-874` で `_dualStateCache` に structure / logoUrl を宣言、grep で `_publishDualState\('structure'` / `'logoUrl'` 該当ゼロ
- **影響**: operator がブラインド構造を保存（tournaments:save）してもプリセット適用しても、hall に通知が飛ばない。logo 変更も同様
- **修正方針**: `presets:saveUser` / `logo:setMode` / `logo:selectFile` 末尾で `_publishDualState('logoUrl', logo)` を発火。`tournaments:save` の structure 部分は #A1 で代替可能（applyTournament 経由）（5〜8 行）
- **致命バグ保護への影響**: 影響なし

### #B5 [中] トーナメント切替・リスト操作系 4+ ハンドラに hall ガード漏れ

- **状況**: hall 側でリスト UI が hidden になっていても、誤発火経路で active 切替や timerState 上書きが発生
- **再現条件**: `src/renderer/renderer.js`
  - `handleTournamentListToggle()` 3313（hall ガード無し → `timerPause/Resume` / `setTimerState` 呼出）
  - `handleTournamentListReset()` 3343（`window.confirm` + `setTimerState` + `timerReset`）
  - `handleTournamentListSelect()` 3352
  - `handleTournamentSelectChange()` 3390
  - `handleTournamentGameTypeChange()` 2772
  - `handleTournamentSaveApply()` 3921（多重防御として）
- **影響**: hall 側で誤発火した場合 active 切替や timerState 上書きが発生し operator と乖離。`handleTournamentListReset` は `window.confirm` ダイアログ表示
- **修正方針**: 各冒頭に hall ガード（6 行 / 1 ファイル）
- **致命バグ保護への影響**: 影響なし

### #B6 [中] handleMarqueeTab(Save|Preview) / preset(New|Duplicate|Delete) clickハンドラに hall ガード漏れ

- **状況**: 設定タブ「テロップ」の保存・プレビューボタン、ブラインドプリセット「新規」「複製」「削除」ボタンに hall ガード無し（CSS で settings-dialog hidden により実害は限定的だが、防御的多重化の整合が崩れている）
- **再現条件**: `src/renderer/renderer.js`
  - `handleMarqueeTabPreview` 5569 / `handleMarqueeTabSave` 5578
  - `el.presetNew?.addEventListener` 4896 / `el.presetDuplicate?.addEventListener` 4931 / `el.presetDelete?.addEventListener` 4961
- **影響**: 通常運用では CSS hidden で到達不能。多重防御方針との整合性問題
- **修正方針**: 各冒頭に hall ガード（5 行 / 1 ファイル）
- **致命バグ保護への影響**: 影響なし

---

## 提案項目（修正せず提案のみ、構築士判断要）

### #P1 [低] dual:operator-action ハンドラが事実上 no-op

- main.js:2156-2167 で validate して `{ok:true, payloadShape}` を返すだけ、store 操作も timer 制御もしない
- 現状 operator → hall は別経路（renderer 直 IPC → main → broadcast）で動いているため実害なし、デッドコード
- **提案**: `notifyOperatorActionIfNeeded` のコールサイトと共に削除する、または本来の operator-action 経路を実装する判断は構築士へ

### #P2 [低] el.presetSelect.value 設定時、フィルタ後に option が無いと selection 不整合

- `ensureBlindsEditorLoaded` (5383) と `_savePresetCore` (5138) で gameType 変更後にフィルタで除外された preset id を value に設定
- 既存ロジック上 readonly 制御は正しい、UX 上の混乱要因
- **提案**: refreshPresetList の末尾に「無ければ draft クリア」を追加（5 行）。本フェーズスコープ外として提案のみ

### #P3 [低] sanitizeBreakImages の else 分岐で fallback 再 sanitize

- main.js:1864-1866 で `breakImages` が partial update に含まれない場合、既存値を再 sanitize
- 過去（5MB 上限導入前）の大きい breakImage が silent drop される可能性、実害はほぼ無い
- **提案**: else 分岐を `cur.breakImages || []` 直接代入に変更（1 行）。本フェーズスコープ外として提案のみ

### #P4 [低] app.on('will-quit') が二重登録（main.js:2077, 2266）

- powerSaveBlocker.stop と globalShortcut.unregisterAll の handler が別個登録
- 機能的に問題なし、メンテナンス時の見落としリスク
- **提案**: 1 ハンドラに統合（5 行）。本フェーズスコープ外として提案のみ

---

## 修正計画（フェーズ 2）

### 修正対象（高 + 中レベル、合計 6 Fix）

| ID | 優先度 | 概要 | 修正範囲 |
| --- | --- | --- | --- |
| **A1** | 致命 | hall 購読バグ（dual-sync 改修 + renderer export） | dual-sync.js + renderer.js, ~80 行 |
| **A2** | 致命 | hall 逆書込ガード（persist 系関数） | renderer.js, ~10 行 |
| **B1** | 高 | ランタイム操作 5 ハンドラ hall ガード | renderer.js, ~5 行 |
| **B2** | 中 | tournaments:delete / importPayload broadcast | main.js, ~15 行 |
| **B3** | 中 | schedulePersistRuntime 切替中ガード | renderer.js, ~5 行 |
| **B4** | 中 | _dualStateCache logoUrl publish | main.js, ~5 行（structure は A1 でカバー）|
| **B5** | 中 | リスト操作系 4 ハンドラ hall ガード | renderer.js, ~6 行 |
| **B6** | 中 | テロップタブ・preset clickハンドラ hall ガード | renderer.js, ~5 行 |

合計約 130 行。複数ファイル横断、各 Fix を個別 commit。

### 致命バグ保護への影響（全 Fix を通した cross-check）

すべての Fix は致命バグ保護 5 件に**影響なし**:
- A1: dual-sync は新規追加ロジックのみ、既存 5 件の経路には触らない
- A2: hall ガード追加のみ、persist 系の operator 側経路は維持
- B1〜B6: 関数冒頭に role ガード追加のみ、本体ロジック無変更

---

## 残課題（保留 / スコープ外）

- 提案項目 #P1〜#P4 は修正せず、構築士判断を仰ぐ
- E2E テスト導入は時間と複雑性によりスコープ外
- 実機 GUI 確認は前原さん起床後に実施依頼（CC は静的解析テストで担保）
