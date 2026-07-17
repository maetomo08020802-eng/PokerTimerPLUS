// PokerTimerPLUS+ プリロードスクリプト
// レンダラ（contextIsolation + sandbox）から安全に IPC を呼ぶブリッジ
// 公開API: window.api.settings.*

const { contextBridge, ipcRenderer } = require('electron');

// v2.0.0 STEP 1: BrowserWindow.webPreferences.additionalArguments で渡された
//   `--role=operator` / `--role=hall` / `--role=operator-solo` を抽出。
//   document.documentElement に data-role 属性を付与することで、CSS [data-role] セレクタが
//   役割別の表示制御を行えるようにする。CSP `script-src 'self'` は不変、inline script 不要。
//   document が loading 状態でも documentElement は早期から存在するため flicker 回避のため即時付与。
const _roleArg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith('--role='));
const _role = _roleArg ? _roleArg.split('=')[1] : 'operator-solo';
function _applyRoleAttribute() {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-role', _role);
  }
}
// preload は document 構築途中でも実行可能。documentElement が既に存在する場合は即時付与、
// 未生成なら DOMContentLoaded で再試行（保険、通常は到達しない）。
_applyRoleAttribute();
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', _applyRoleAttribute, { once: true });
}
// renderer 側からも参照できるよう expose（read-only、STEP 3 以降の役割分岐ロジックで利用）
contextBridge.exposeInMainWorld('appRole', _role);

// perf-heaviness（2026-06-08）: main が PERF_METRICS env 時のみ渡す `--perf-metrics=1` を検出して
//   renderer に window.__PERF_METRICS（boolean）として公開。renderer 側 rAF Hz カウンタのゲート。
//   フラグ未付与（通常起動・本番）では false ＝ 計測フックは一切作動しない。
const _perfMetricsOn = (process.argv || []).some((a) => a === '--perf-metrics=1');
contextBridge.exposeInMainWorld('__PERF_METRICS', _perfMetricsOn);

// v2.2.1: IPC 往復計測撤去。`_measuredInvoke` は名前だけ維持し ipcRenderer.invoke の薄ラッパとして残す
//   （preload 内全 API が経由する設計のため）。計測ラベル発火は本番版で完全撤去。
function _measuredInvoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld('api', {
  app: {
    getVersion: () => _measuredInvoke('app:getVersion')
  },
  settings: {
    getAll: () => _measuredInvoke('settings:getAll'),
    // STEP 7: setMarquee は削除（tournaments:setMarqueeSettings に完全移行）
    setDisplay: (value) => _measuredInvoke('settings:setDisplay', value),
    // STEP 6.22: 店舗名「Presented by ○○」表記
    setVenueName: (value) => _measuredInvoke('settings:setVenueName', value),
    // v2.4.0: 店舗デフォルト プール率（dormant、v2.6.0 で POT へ移行）
    setPoolRatesDefault: (value) => _measuredInvoke('settings:setPoolRatesDefault', value),
    // v2.6.0: 店舗デフォルト POT（店内通貨 $ の1件あたり拠出、appConfig.potDefaults）
    setPotDefaults: (value) => _measuredInvoke('settings:setPotDefaults', value)
  },
  presets: {
    listBuiltin: () => _measuredInvoke('presets:listBuiltin'),
    loadBuiltin: (id) => _measuredInvoke('presets:loadBuiltin', id),
    listUser: () => _measuredInvoke('presets:listUser'),
    loadUser: (id) => _measuredInvoke('presets:loadUser', id),
    saveUser: (preset) => _measuredInvoke('presets:saveUser', preset),
    deleteUser: (id) => _measuredInvoke('presets:deleteUser', id)
  },
  tournament: {
    get: () => _measuredInvoke('tournament:get'),
    set: (data) => _measuredInvoke('tournament:set', data)
  },
  tournaments: {
    list: () => _measuredInvoke('tournaments:list'),
    getActive: () => _measuredInvoke('tournaments:getActive'),
    // v2.5.0: 画像分離。tournaments:list は image-free のため画像は id 指定で別取得する。
    getImages: (id) => _measuredInvoke('tournaments:getImages', id),
    setActive: (id) => _measuredInvoke('tournaments:setActive', id),
    save: (t) => _measuredInvoke('tournaments:save', t),
    delete: (id) => _measuredInvoke('tournaments:delete', id),
    // STEP 6.21: 個別 timerState 部分更新
    setTimerState: (id, timerState) => _measuredInvoke('tournaments:setTimerState', { id, timerState }),
    // STEP 10 フェーズC.1.8: ランタイム情報の部分更新（playersInitial / Remaining / reentryCount / addOnCount）
    setRuntime: (id, runtime) => _measuredInvoke('tournaments:setRuntime', { id, runtime }),
    // STEP 6.21.6: 個別 displaySettings 部分更新（背景プリセット / 数字フォントの即時保存）
    setDisplaySettings: (id, displaySettings) => _measuredInvoke('tournaments:setDisplaySettings', { id, displaySettings }),
    // STEP 6.22.1: 個別 marqueeSettings 部分更新（テロップ enabled/text/speed の即時保存）
    setMarqueeSettings: (id, marqueeSettings) => _measuredInvoke('tournaments:setMarqueeSettings', { id, marqueeSettings }),
    // STEP 6.23: PC間データ移行（JSON Export / Import）
    exportSingle:    (id) => _measuredInvoke('tournaments:exportSingle', id),
    exportBulk:      () => _measuredInvoke('tournaments:exportBulk'),
    writeExportFile: (payload, defaultFileName) => _measuredInvoke('tournaments:writeExportFile', payload, defaultFileName),
    readImportFile:  () => _measuredInvoke('tournaments:readImportFile'),
    importPayload:   (params) => _measuredInvoke('tournaments:importPayload', params)
  },
  audio: {
    get: () => _measuredInvoke('audio:get'),
    set: (data) => _measuredInvoke('audio:set', data)
  },
  // STEP 9-B: メイン画面左上ロゴ設定
  logo: {
    selectFile: () => _measuredInvoke('logo:selectFile'),
    setMode: (kind) => _measuredInvoke('logo:setMode', kind)
  },
  // STEP 10 フェーズC.1.3: 背景画像（カスタム画像）の選択 — OS ファイルダイアログ → base64 data URL を返す
  // STEP 10 フェーズC.1.4: 休憩中スライドショー用の複数画像選択
  display: {
    selectBackgroundImage: () => _measuredInvoke('display:selectBackgroundImage'),
    selectBreakImages:     () => _measuredInvoke('display:selectBreakImages')
  },
  // STEP 6.21.4: PC スリープ → 復帰時の通知購読
  // 引数 callback は (event) => void。event は IPC イベントオブジェクト（通常は引数として無視）
  onSystemResume: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('system:resume', () => callback());
  },
  // STEP 10 フェーズC.2.7-audit-fix: powerSaveBlocker（営業中ディスプレイスリープ抑止）
  // v2.2.2 hotfix Phase 2 第 1 段階: prevent-app-suspension 並行採用（仮説 F = OS suspend 対策）
  power: {
    preventDisplaySleep:  () => _measuredInvoke('power:preventDisplaySleep'),
    allowDisplaySleep:    () => _measuredInvoke('power:allowDisplaySleep'),
    preventAppSuspension: () => _measuredInvoke('power:preventAppSuspension'),
    allowAppSuspension:   () => _measuredInvoke('power:allowAppSuspension')
  },
  // v2.0.0 STEP 2: 2 画面間の状態同期ブリッジ。
  //   - subscribeStateSync: hall 側で main からの差分を受信（イベント駆動、ポーリング禁止）
  //   - fetchInitialState:  hall 起動時に 1 回だけ呼ぶ初期同期（_dualStateCache 全体）
  //   v2.0.2: notifyOperatorAction は撤去（main 側 dual:operator-action ハンドラがデッドコードのため）。
  //   operator-solo モードでは hall が存在しないので、これらは呼ばれない（renderer 側 role ガード）。
  dual: {
    subscribeStateSync: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.on('dual:state-sync', (_event, payload) => callback(payload));
    },
    fetchInitialState: () => _measuredInvoke('dual:state-sync-init'),
    // v2.1.6: PRE_START の hall 同期。operator 側から send で broadcast を要求、main 側で
    //   _publishDualState('preStartState', payload) を呼ぶ。payload 形:
    //   { isActive: bool, totalMs?: number, remainingMs?: number, startAtMs?: number }
    publishPreStartState: (payload) => ipcRenderer.send('dual:publish-pre-start-state', payload),
    // v2.0.4-rc4: hall 側 before-input-event で捕捉した操作系キーを operator 側に IPC 転送する受信口。
    //   旧実装（rc3）の sendInputEvent 方式は letter キーで event.code が空文字になる Electron 31 系の
    //   構造的制約により、R / Ctrl+E / S 等 13 キーが無反応だった。論理キーオブジェクトを直接送る
    //   IPC 化で確実に operator の dispatchClockShortcut に届く。
    onHallForwardedKey: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.on('hall:forwarded-key', (_event, payload) => callback(payload));
    },
    // v2.0.4-rc6 Fix 4-B: ESC で hall 全画面解除を main に通知（dispatcher 経由）
    requestExitFullScreen: () => ipcRenderer.send('dual:request-exit-fullscreen'),
    // v2.0.4-rc6 Fix 5-M: operator 側ミュート状態を hall に同期する送信口
    broadcastMuteState: (muted) => ipcRenderer.send('dual:broadcast-mute-state', !!muted),
    // v2.0.4-rc6 Fix 5-M: hall 側で operator のミュート状態を受信（subscribe）
    onMuteStateChanged: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.on('dual:mute-state-changed', (_event, muted) => callback(!!muted));
    },
    // v2.0.4-rc6 Fix 5-H: operator 側ボトムバー状態を hall に同期する送信口
    broadcastBottomBarState: (hidden) => ipcRenderer.send('dual:broadcast-bottombar-state', !!hidden),
    // v2.0.4-rc6 Fix 5-H: hall 側で operator のボトムバー状態を受信
    onBottomBarStateChanged: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.on('dual:bottombar-state-changed', (_event, hidden) => callback(!!hidden));
    },
    // v2.0.4-rc7 Fix 1-B: HDMI 切替時に main から renderer に role 変更を通知。
    //   renderer 側で window.appRole + documentElement[data-role] を更新し、CSS が
    //   2 画面用 / 単画面用レイアウトに自動追従する（表示踏襲問題の解消）。
    //   ウィンドウ生成を伴わない動的切替のため race ゼロ。
    onRoleChanged: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.on('dual:role-changed', (_event, newRole) => {
        // rc12 防御: コールバック throw を握り潰す（contextBridge 凍結の TypeError 等を吸収）
        try { callback(newRole); } catch (_) { /* ignore — rc12 防御 */ }
      });
    },
    // v2.0.0 STEP 4: モニター選択ダイアログ（display-picker.html 専用）。
    //   fetchDisplays: 検出済の displays + 前回選択 id を取得（invoke、結果を返す）
    //   selectHallMonitor: ユーザーが選んだモニター id を main に通知（send、結果不要）
    //   ※ ipcRenderer.send は通知系（main 側 ipcMain.on で受信）。invoke と区別。
    fetchDisplays: () => _measuredInvoke('display-picker:fetch'),
    selectHallMonitor: (displayId) => ipcRenderer.send('dual:select-hall-monitor', displayId)
  },
  // v2.0.4-rc15 タスク 2: 5 分 rolling ログ機構の renderer ブリッジ。
  //   write: send（一方向、結果不要、低 overhead）→ main の ipcMain.on('rolling-log:write') で集約。
  //   openFolder: invoke（結果を Promise で返す）→ shell.openPath で OS のファイルマネージャを開く。
  //   renderer 側は直接 fs アクセス禁止、main プロセス集約でロックフリー化（CC_REPORT rc14 §3.7）。
  log: {
    write: (label, data) => {
      try { ipcRenderer.send('rolling-log:write', { label: String(label || ''), data: data || null }); }
      catch (_) { /* never throw from logging */ }
    },
    openFolder: () => _measuredInvoke('logs:openFolder')
  },
  // multi-tournament-4up Phase 1: 4分割マルチ表示モードのブリッジ。
  //   enter/exit: モード切替（main がウィンドウ生成/復元を担う。enter は単一モード IDLE 時のみ許可）
  //   publish: multi-control（真実源）→ main → multi-grid の edge イベント中継（既存 dual:* とは別チャンネル）
  //   fetchInitialState / subscribeStateSync: multi-grid 起動時の全量 1 回 + 以後の差分購読（ポーリング禁止）
  multi: {
    enter: () => _measuredInvoke('multi:enter'),
    exit: () => _measuredInvoke('multi:exit'),
    publish: (payload) => ipcRenderer.send('multi:publish', payload),
    fetchInitialState: () => _measuredInvoke('multi:state-sync-init'),
    subscribeStateSync: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.on('multi:state-sync', (_event, payload) => callback(payload));
    },
    // Phase 2: フィラー画像のファイル選択（main の dialog・完全ローカル）
    pickFillerImage: () => _measuredInvoke('multi:pick-filler-image'),
    // Phase 2: mirror（複製）運用の前面切替（grid は focusable:false のため focus は control に残る）
    gridFront: () => ipcRenderer.send('multi:grid-front'),
    controlFront: () => ipcRenderer.send('multi:control-front')
  },
  // remote-control Phase 1a: スマホ遠隔操作のブリッジ。
  //   onRemoteOp: 配線点② = main が認証通過操作を remote:op で送る → renderer が dispatchClockShortcut に流す
  //     （既存 dual.onHallForwardedKey は operator 限定・無改変。remote は operator-solo でも受信する別経路）。
  //   getStatus/setEnabled: 設定画面のトグル + PIN/URL/ポート表示のための制御（invoke）。
  remote: {
    onRemoteOp: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.on('remote:op', (_event, payload) => callback(payload));
    },
    getStatus: () => _measuredInvoke('remote:getStatus'),
    setEnabled: (enabled) => _measuredInvoke('remote:setEnabled', !!enabled),
    // 1b: 現在状態（人数/RE/AO/特殊/卓名）を main へ【読み取り送信】（一方向・SSE でスマホへ push される）。
    //   renderer が真実源。runtime を変えない読み取りのみ（致命バグ保護⑤ 非接触）。
    publishState: (state) => {
      try { ipcRenderer.send('remote:state', state || null); }
      catch (_) { /* never throw */ }
    }
  },
  // 外部DB連携 STEP2a: 設定タブ「外部連携」のブリッジ。通信は main（src/link/db-link.js）に集約
  //   （renderer CSP 無改変）。公開は以下 6 チャネルのみ（tests/db-link.test.js が whitelist 検査）。
  //   PW は login() の引数として main へ渡すだけ（renderer/preload では保存・保持・ログ出力しない）。
  dblink: {
    getStatus: () => _measuredInvoke('dblink:getStatus'),
    setConfig: (cfg) => _measuredInvoke('dblink:setConfig', cfg || {}),
    login: (cred) => _measuredInvoke('dblink:login', cred || {}),
    logout: () => _measuredInvoke('dblink:logout'),
    listTodayTournaments: () => _measuredInvoke('dblink:listTodayTournaments'),
    setTournamentLink: (p) => _measuredInvoke('dblink:setTournamentLink', p || {})
  }
});
