# Changelog

All notable changes to PokerTimerPLUS+ will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
