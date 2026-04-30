# v2.0.0 設計調査結果

**作成日**: 2026-05-01（v2.0.0 STEP 0）
**作成者**: CC（v1.3.0 コードベース読解 + Electron 2 ウィンドウ probe 実行に基づく）
**対象**: v2.0.0「2 画面対応」大改修の設計判断材料

---

## 1. 既存コードへの影響範囲

### 1.1 変更が必要な箇所

| ファイル | 関数 / 領域 | 変更内容（要約） | 致命バグ保護への影響 |
| --- | --- | --- | --- |
| `src/main.js` | `createMainWindow()` (L856) | `createOperatorWindow()` / `createHallWindow()` の 2 関数に分離 | なし（保護は IPC ハンドラ側） |
| `src/main.js` | アプリ初期化（whenReady） | `screen.getAllDisplays()` でモニター数判定、2 枚以上ならモニター選択ダイアログ → 2 ウィンドウ生成 | なし |
| `src/main.js` | 新規 IPC ハンドラ群 | `dual:state-sync` / `dual:display-changed` / `dual:select-hall-monitor` 等の差分配信 | timerState destructure 除外（C.2.7-D）の同経路を踏襲 |
| `src/main.js` | `screen.on('display-added' / 'display-removed')` | 新規イベント購読、HDMI 抜き差し検出 | なし |
| `src/preload.js` | `window.api.dual.*` | 新規グループ追加（subscribeStateSync / requestSelectHallMonitor 等） | なし |
| `src/renderer/index.html` | body 直下構造 | querystring（`?role=hall` / `?role=operator`）or process.argv で操作 UI を hidden 化する CSS フックを追加 | なし |
| `src/renderer/style.css` | 新規 `[data-role="hall"]` / `[data-role="operator"]` セレクタ | 各役割で表示する要素を切替（settings dialog はホール側で完全 hidden 等） | なし（既存 z-index 階層 / カード幅 / Barlow Condensed すべて流用） |
| `src/renderer/renderer.js` | 役割判定 + 早期 return | `role === 'hall'` 時にイベントリスナ登録 / 設定ダイアログ起動を skip | ensureEditorEditableState は PC 側のみで動作なので不変、ただし呼出経路に role ガードを追加 |
| `src/renderer/renderer.js` | 状態購読の起点 | 単画面: 既存 `state.js` の subscribe / 2 画面: main プロセスからの `dual:state-sync` IPC を subscribe → setState で local state.js に反映 | 既存 timer.js / state.js は無変更、上に薄い同期レイヤを乗せる |
| `src/renderer/renderer.js` | playSound 呼出（11 箇所） | ホール側で発火（音声出力はホール側スピーカー想定）/ PC 側は no-op | AudioContext resume（C.1.7）はホール側 _play で機能、PC 側は不要 |
| `src/renderer/audio.js` | initAudio / ensureAudioReady | role==='hall' なら通常初期化、role==='operator' なら no-op（音を鳴らさない） | resume 防御は変更なし |
| `package.json` | `build.files` | `scripts/_probes/` 配下を除外する `!scripts/**/*` を追加（既に `!tests/**/*` 等の exclusion パターンあり） | なし |

### 1.2 変更不要な箇所（v1.3.0 のまま流用）

| ファイル | 領域 | 流用理由 |
| --- | --- | --- |
| `src/renderer/state.js`（67 行）| 全体 | 既存の subscribe / setState モデルがそのまま 2 画面同期の基盤として使える。main からの差分通知を receiver 側で setState 適用するだけ |
| `src/renderer/timer.js`（334 行）| 全体 | タイマーコアは main プロセスで 1 つだけ動作させ、両画面に同 state を配信する設計なら無変更で流用可能 |
| `src/renderer/blinds.js`（174 行）| 全体 | ブラインド構造の検証ロジック、両画面で参照のみ |
| `src/renderer/marquee.js`（108 行）| 全体 | テロップアニメーション、ホール側のみで動作 |
| `src/main.js` | 既存 IPC ハンドラ 30+ 件 | tournaments:* / settings:* / presets:* / display:* / power:* / audio:* / logo:* すべて main プロセス側の責務、2 画面化で変更不要 |
| `src/main.js` | electron-store スキーマ + sanitize 関数群 | 単一の真実源として両画面が読込、変更不要 |
| `src/main.js` | migrateTournamentSchema / normalizeTournament / sanitizeRuntime 等 | データレイヤは無変更、致命バグ保護も不変 |
| `tests/` 全 138 テスト | 全件 | 静的解析ベースなので renderer.js の役割分離後も実行可能、PASS 維持を不変条件として扱う |
| 致命バグ保護 5 件すべて（resetBlindProgressOnly / timerState destructure 除外 / ensureEditorEditableState 4 重防御 / AudioContext resume / runtime 永続化 8 箇所）| 全体 | 関数本体・呼出経路は変更しない。役割ガードを呼出側に**追加**するのみ |

---

## 2. Electron 2 ウィンドウ動作検証結果

`scripts/_probes/v2-probe.js` を作成し、現環境（単画面、フルHD 1536×864 / scaleFactor 1.25）で起動した結果。

### 2.1 BrowserWindow 並列配置

```js
new BrowserWindow({ x: display.bounds.x + 40, y: display.bounds.y + 40, ... });
```

- `BrowserWindow` の `x` / `y` プロパティで targetDisplay の `bounds` 内に配置可能（API 確認済）
- 単画面環境では 1 ウィンドウのみ生成、2 画面環境では `screen.getAllDisplays()` で複数 display を取得して各々に配置（コード上は実装済、実機 HDMI 環境での 2 ウィンドウ並列確認は前原さん側で要検証）

### 2.2 screen モジュールのモニター情報取得結果

probe ログ（単画面環境）:

```
[startup] displays: 1
  - id=2902177282 label="(no label)" primary=true
    bounds={"x":0,"y":0,"width":1536,"height":864}
    workArea={"x":0,"y":0,"width":1536,"height":816}
    scaleFactor=1.25
```

取得可能な情報: `id` / `label`（Windows 環境では空の場合あり）/ `bounds` / `workArea`（タスクバー除外）/ `scaleFactor`。**モニター選択ダイアログでは `label` が空の可能性に対処し、解像度 + 位置でフォールバック表示する設計が必要**。

### 2.3 display-added / display-removed イベント挙動

probe では `display-metrics-changed` イベントが起動直後に 1 回発火（changedMetrics は空配列、メタイベント）。`display-added` / `display-removed` は単画面環境では発火せず（仕様通り）。実機 HDMI 抜き差しでの発火タイミング検証は前原さん側で要確認。

ヒント: `display-metrics-changed` も合わせて購読すると、解像度変更や DPI 変更も検出可能。HDMI 抜き差し追従だけなら added/removed のみで十分。

### 2.4 ウィンドウ生成・破棄コスト

probe ログ:
```
[create] operator window ready in 236ms
```

- 1 ウィンドウ生成: ~236ms（loadURL 含む、preload.js なし簡易設定）
- 2 ウィンドウ生成: 起動時に並列で行えば総コスト ~250ms 想定（許容範囲）
- `win.close()` 破棄コストは数 ms で完結（probe 終了時に確認）

HDMI 抜き差しでの単画面復帰・2 画面復帰の切替は **2 秒以内**（v2-dual-screen.md §3.1 基準）に余裕で収まる見込み。

---

## 3. 状態同期に必要な情報の最小セット

| 情報項目 | 同期頻度 | 同期方向 | 備考 |
| --- | --- | --- | --- |
| `timerState`（status / currentLevel / elapsedSecondsInLevel / startedAt / pausedAt）| 状態変化時のみ（IDLE↔RUNNING↔PAUSED↔BREAK 遷移、レベル進行）| main → hall | timer.js は main プロセスで 1 個動作、両画面は ticker から計算済 remainingMs を受信。**ポーリング禁止、tick イベント駆動**（毎秒 1 回の tick は許容） |
| ブラインド構造（structure.levels）| 構造変更時のみ（プリセット切替 / 編集保存）| main → hall | preset 適用 or 編集保存トリガで `dual:structure-changed` 配信、ホール側はキャッシュ |
| `displaySettings`（background / backgroundImage / backgroundOverlay / breakImages / breakImageInterval / pipSize / timerFont）| 変更時のみ | main → hall | 既存 `tournaments:setDisplaySettings` IPC の延長で hall に push |
| `marqueeSettings`（enabled / text / speed）| 変更時のみ | main → hall | テロップは hall でのみアニメ動作 |
| `tournamentRuntime`（playersInitial / Remaining / reentryCount / addOnCount）| 変更時のみ（PC 側操作時のみ）| main → hall | 既存 schedulePersistRuntime の経路を流用、hall にも broadcast |
| `tournamentState` 基本情報（name / subtitle / titleColor / venueName / blindPresetId 等）| 変更時のみ | main → hall | tournaments:save / setActive の trigger を hall にも配信 |
| `audio` 設定（volume / 個別 ON-OFF）| 変更時のみ | main → hall | 音はホール側スピーカーで鳴る想定、設定は audio.js が hall で読込 |
| `logo` / `venueName` / `prizeCategory` 等の表示文字列 | 変更時のみ | main → hall | 既存 store 値、変更通知のみ |
| 操作リクエスト（プレスタート開始 / 一時停止 / 次レベル等）| ユーザー操作時 | operator → main → hall に状態変化伝播 | hall から main への送信なし（hall は purely consumer） |
| HDMI 接続状態 | display-added / display-removed イベント | main → both | ウィンドウ生成・破棄の指示を main から発行 |

**規模感**: 同期項目は約 9 種類、すべて既存の `tournaments` / `display` / `marquee` / `audio` ストアの延長で対応可能。新規スキーマ追加は不要。

---

## 4. 単画面 ↔ 2 画面切替の設計案

### 4.1 起動時のフロー

```
app.whenReady
   ↓
screen.getAllDisplays() で displays 取得
   ↓
displays.length >= 2 ?
   ├─ Yes: モニター選択ダイアログ（PC 側 = primary に表示）
   │        ↓ ユーザーが hall モニターを選択
   │      createOperatorWindow(operatorDisplay)
   │      createHallWindow(hallDisplay)  ← querystring "?role=hall"
   │        ↓
   │      両ウィンドウが state.js 経由で IPC 購読開始
   │        ↓
   │      タイマー継続 / 設定継続（既存 store からロード）
   │
   └─ No: createOperatorWindow(primary) のみ ← querystring "?role=operator-solo"
            renderer.js は v1.3.0 と同じレイアウト + 動作（後方互換）
```

### 4.2 営業中 HDMI 抜き → 単画面復帰

```
screen.on('display-removed', oldDisplay)
   ↓
hallWindow.id が removed display 上にあった ?
   ├─ Yes: hallWindow.close()
   │        ↓
   │       operatorWindow.webContents.send('dual:fallback-to-solo')
   │        ↓ renderer 受信
   │       querystring を変えずに data-role="operator-solo" 切替
   │       → CSS で hidden 化していた表示要素を復活、v1.3.0 のレイアウトに統合
   │        ↓
   │       タイマー進行は main プロセスで持続（中断なし）
   │
   └─ No: 何もしない（PC 側モニターが抜けるケースは想定外、ログのみ）
```

### 4.3 営業中 HDMI 再接続 → 2 画面復帰

```
screen.on('display-added', newDisplay)
   ↓
2 画面以上検出
   ↓
モニター選択ダイアログ表示（毎回手動選択、v2-dual-screen.md §4.2）
   ↓ ユーザーが hall モニターを選択
   ↓
createHallWindow(newDisplay)
   ↓
hallWindow.webContents.send('dual:state-sync', { current full state })
   ↓ hall 側 renderer 受信
   state.js に setState で適用、表示開始
   ↓
operatorWindow.webContents.send('dual:role-changed', { role: 'operator' })
   ↓ operator 側 renderer 受信
   data-role="operator" に変更、表示要素を hide（タイマー等は hall に任せる）
```

### 4.4 致命バグ保護への影響

- `resetBlindProgressOnly`: PC 側 renderer で呼ばれる、main 経由で hall に新構造を配信 → hall は受信のみ。**呼出経路に variation なし**
- `timerState` destructure 除外: 既存 IPC（`tournaments:setDisplaySettings`）に手を入れない。新規 `dual:state-sync` も同パターン（差分のみ送信、timerState は別チャンネル `tournaments:setTimerState` 経由）
- `ensureEditorEditableState` 4 重防御: PC 側 renderer のみで動作、hall 側では呼ばれない
- AudioContext resume: hall 側のみ initAudio / playSound を有効化、PC 側は no-op
- runtime 永続化 8 箇所: PC 側操作のみで trigger、main 経由 hall に broadcast

---

## 5. リスク・懸念事項

### リスク 1（高）: renderer.js 6106 行の役割分離が機械的に困難
renderer.js は操作 UI と表示が同じファイル内で混在、特に `subscribe` コールバックや `setHandlers({ onTick, onLevelChange })` 内で表示更新と操作応答が一体化している。**1 ファイルを 2 ロールに分離**するのではなく、**役割フラグでイベントリスナの登録を skip**する方式（既存ファイル流用）が現実的。

対処: 各 handler 関数の冒頭で `if (role === 'hall') return;` ガードを追加。逆にホール側のみで動くもの（PIP / スライドショー / クロスフェード）はそのまま残す。

### リスク 2（中）: ホール側 ↔ PC 側の同期遅延がユーザー知覚閾値を超える可能性
v2-dual-screen.md §2.1 が「±100ms 以内」を要求するが、Electron IPC は通常数 ms でも、main プロセスでの状態計算 + 2 ウィンドウへの broadcast + renderer での DOM 更新を含めると 50-80ms かかる場合あり。

対処: ホール側でローカル計算（既存 timer.js のように performance.now ベース）、main からは「**基準時刻 + 状態フラグ**」を送るだけ。tick ごとに timer 値を送らない。

### リスク 3（中）: HDMI 抜き差し時の AudioContext suspend / resume
ホール側ウィンドウを `close()` した瞬間に AudioContext が destroy され、再接続後に新ウィンドウで AudioContext を再初期化する必要。**音が鳴らない期間が発生**する可能性。

対処: 単画面復帰時は AudioContext をホール側 → operator 側に「移譲」する設計が望ましいが Electron ではコンテキスト移譲不可。代替: operator-solo モードの renderer で initAudio + ensureAudioReady を再呼出。これは既存の C.1.7 修正で `_play` 内 resume が走るので、最初の音発火時に自動 resume する。

### リスク 4（低）: モニター label が空の Windows 環境
probe で確認した通り Windows では `display.label` が空の場合あり。モニター選択ダイアログで「モニター 1（1920×1080）」のような fallback ラベルを生成する必要。

### リスク 5（低）: index.html のフラグ判定タイミング
querystring（`?role=hall`）は preload より前に確定するが、CSS の `[data-role]` セレクタを効かせるには `<html>` 要素に DOM 構築前に attribute を付与する必要。`<head>` 内 inline script で `document.documentElement.setAttribute('data-role', new URL(location.href).searchParams.get('role'))` で対処可能、ただし CSP `script-src 'self'` だとブロックされる。**CSP 緩和は禁止**（既存セキュリティ）、別方式（preload 経由 or BrowserWindow.webPreferences.additionalArguments）の検討が必要。

---

## 6. STEP 1〜7 の実装順序提案

CLAUDE.md「v2.0.0 STEP 順序」に従い、現状の順序で問題なし。ただし以下の小提案あり:

- STEP 1（ホール側ウィンドウ追加、最小骨格）の冒頭で **CSP 緩和なしで data-role 属性を付与する方式の検証**を行う（リスク 5）
- STEP 2（状態同期）で **ホール側ローカル時刻計算方式**を確立（リスク 2）
- STEP 3（PC 側 UI 分離）で **role ガードの一括追加**を patch 化、レビュー容易にする
- STEP 5（HDMI 抜き差し追従）で **AudioContext 再初期化フロー**を明示テスト（リスク 3）

順序自体の変更提案なし。

---

## 7. 致命バグ保護への影響評価

| 致命バグ保護 | 影響有無 | 必要な対策 |
| --- | --- | --- |
| `resetBlindProgressOnly`（C.2.7-A）| なし | PC 側 renderer での呼出経路は不変。main 経由 hall に新構造 broadcast のみ追加 |
| `timerState` race（destructure 除外、C.2.7-D Fix 3）| なし | 既存 `tournaments:setDisplaySettings` IPC の payload 構造に触らない。新規 `dual:state-sync` も timerState は別チャンネル経由 |
| `ensureEditorEditableState` 4 重防御（C.1-A2 / C.1.2-bugfix / C.1.4-fix1）| なし | PC 側 renderer のみで動作、hall 側では呼出されない。`role === 'operator'` ガードで完全に分離 |
| AudioContext resume（C.1.7）| **要注意** | hall 側で initAudio + ensureAudioReady、PC 側は no-op。HDMI 抜き差し時の AudioContext 再初期化に新規対応必要（リスク 3）|
| runtime 永続化 8 箇所（C.1.8）| なし | 操作は PC 側のみ → schedulePersistRuntime → main 経由 hall に broadcast。main 側の永続化ロジックは無変更 |

**全体評価**: AudioContext のみ要追加対策。それ以外は既存保護をそのまま継承可能。

---

## 8. 補足: probe スクリプトの保管

`scripts/_probes/v2-probe.js` は配布物に含めない:
- `package.json` の `build.files` に `!scripts/**/*` を追加（STEP 1 で対応推奨）
- もしくは `scripts/_probes/` 配下なら現状の `src/**/*` パターンには含まれないため自動的に除外（要確認）

probe スクリプトは v2 実装中も参照可能（モニター情報取得・display イベント挙動の再確認用）。**削除しない**こと。

---

## 完了状態

- §1〜§7 すべて記載済
- probe 動作確認: 単画面環境で起動成功、screen API + display-metrics-changed イベント発火確認
- src/ 配下に変更ゼロ（git diff で確認）
- 既存 138 テスト全 PASS（コード変更なしのため当然 PASS、念のため最終確認）
