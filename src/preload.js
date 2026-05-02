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

contextBridge.exposeInMainWorld('api', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    // STEP 7: setMarquee は削除（tournaments:setMarqueeSettings に完全移行）
    setDisplay: (value) => ipcRenderer.invoke('settings:setDisplay', value),
    // STEP 6.22: 店舗名「Presented by ○○」表記
    setVenueName: (value) => ipcRenderer.invoke('settings:setVenueName', value)
  },
  presets: {
    listBuiltin: () => ipcRenderer.invoke('presets:listBuiltin'),
    loadBuiltin: (id) => ipcRenderer.invoke('presets:loadBuiltin', id),
    listUser: () => ipcRenderer.invoke('presets:listUser'),
    loadUser: (id) => ipcRenderer.invoke('presets:loadUser', id),
    saveUser: (preset) => ipcRenderer.invoke('presets:saveUser', preset),
    deleteUser: (id) => ipcRenderer.invoke('presets:deleteUser', id)
  },
  tournament: {
    get: () => ipcRenderer.invoke('tournament:get'),
    set: (data) => ipcRenderer.invoke('tournament:set', data)
  },
  tournaments: {
    list: () => ipcRenderer.invoke('tournaments:list'),
    getActive: () => ipcRenderer.invoke('tournaments:getActive'),
    setActive: (id) => ipcRenderer.invoke('tournaments:setActive', id),
    save: (t) => ipcRenderer.invoke('tournaments:save', t),
    delete: (id) => ipcRenderer.invoke('tournaments:delete', id),
    // STEP 6.21: 個別 timerState 部分更新
    setTimerState: (id, timerState) => ipcRenderer.invoke('tournaments:setTimerState', { id, timerState }),
    // STEP 10 フェーズC.1.8: ランタイム情報の部分更新（playersInitial / Remaining / reentryCount / addOnCount）
    setRuntime: (id, runtime) => ipcRenderer.invoke('tournaments:setRuntime', { id, runtime }),
    // STEP 6.21.6: 個別 displaySettings 部分更新（背景プリセット / 数字フォントの即時保存）
    setDisplaySettings: (id, displaySettings) => ipcRenderer.invoke('tournaments:setDisplaySettings', { id, displaySettings }),
    // STEP 6.22.1: 個別 marqueeSettings 部分更新（テロップ enabled/text/speed の即時保存）
    setMarqueeSettings: (id, marqueeSettings) => ipcRenderer.invoke('tournaments:setMarqueeSettings', { id, marqueeSettings }),
    // STEP 6.23: PC間データ移行（JSON Export / Import）
    exportSingle:    (id) => ipcRenderer.invoke('tournaments:exportSingle', id),
    exportBulk:      () => ipcRenderer.invoke('tournaments:exportBulk'),
    writeExportFile: (payload, defaultFileName) => ipcRenderer.invoke('tournaments:writeExportFile', payload, defaultFileName),
    readImportFile:  () => ipcRenderer.invoke('tournaments:readImportFile'),
    importPayload:   (params) => ipcRenderer.invoke('tournaments:importPayload', params)
  },
  audio: {
    get: () => ipcRenderer.invoke('audio:get'),
    set: (data) => ipcRenderer.invoke('audio:set', data)
  },
  // STEP 9-B: メイン画面左上ロゴ設定
  logo: {
    selectFile: () => ipcRenderer.invoke('logo:selectFile'),
    setMode: (kind) => ipcRenderer.invoke('logo:setMode', kind)
  },
  // STEP 10 フェーズC.1.3: 背景画像（カスタム画像）の選択 — OS ファイルダイアログ → base64 data URL を返す
  // STEP 10 フェーズC.1.4: 休憩中スライドショー用の複数画像選択
  display: {
    selectBackgroundImage: () => ipcRenderer.invoke('display:selectBackgroundImage'),
    selectBreakImages:     () => ipcRenderer.invoke('display:selectBreakImages')
  },
  // STEP 6.21.4: PC スリープ → 復帰時の通知購読
  // 引数 callback は (event) => void。event は IPC イベントオブジェクト（通常は引数として無視）
  onSystemResume: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('system:resume', () => callback());
  },
  // STEP 10 フェーズC.2.7-audit-fix: powerSaveBlocker（営業中ディスプレイスリープ抑止）
  power: {
    preventDisplaySleep: () => ipcRenderer.invoke('power:preventDisplaySleep'),
    allowDisplaySleep:   () => ipcRenderer.invoke('power:allowDisplaySleep')
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
    fetchInitialState: () => ipcRenderer.invoke('dual:state-sync-init'),
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
        // v2.0.4-rc21 タスク 2（問題 ⑩ 計測ビルド、rc22 で削除予定）: コールバック呼出前のエントリラベル
        try { ipcRenderer.send('rolling-log:write', { label: 'preload:onRoleChanged:enter', data: { newRole } }); } catch (_) { /* never throw from logging */ }
        try { callback(newRole); } catch (err) {
          // v2.0.4-rc21 タスク 2（問題 ⑩ 計測ビルド、rc22 で削除予定）: コールバック throw を捕捉してログ化（rc12 真因再発の決定的証拠）
          try { ipcRenderer.send('rolling-log:write', { label: 'preload:onRoleChanged:catch', data: { newRole, message: (err && err.message) || null, stack: (err && err.stack) || null } }); } catch (_) { /* never throw from logging */ }
        }
      });
    },
    // v2.0.0 STEP 4: モニター選択ダイアログ（display-picker.html 専用）。
    //   fetchDisplays: 検出済の displays + 前回選択 id を取得（invoke、結果を返す）
    //   selectHallMonitor: ユーザーが選んだモニター id を main に通知（send、結果不要）
    //   ※ ipcRenderer.send は通知系（main 側 ipcMain.on で受信）。invoke と区別。
    fetchDisplays: () => ipcRenderer.invoke('display-picker:fetch'),
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
    openFolder: () => ipcRenderer.invoke('logs:openFolder')
  }
});
