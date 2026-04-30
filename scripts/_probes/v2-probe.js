// v2.0.0 STEP 0 設計調査用 probe（本体に組み込まない、調査専用）
//
// 目的:
//   1. 2 つの BrowserWindow を別モニターに配置できるか
//   2. screen モジュールでモニター情報取得（display.bounds / id / label）
//   3. display-added / display-removed イベントの発火タイミング
//   4. 単画面 ↔ 2 画面切替時のウィンドウ生成・破棄コスト
//
// 起動: npx electron scripts/_probes/v2-probe.js
//   または: node_modules/.bin/electron scripts/_probes/v2-probe.js
//
// 配布物には含めない（package.json の build.files で除外、または scripts/_probes/ 配下なので
// build.files の `src/**/*` パターンに含まれない）。

'use strict';

const { app, BrowserWindow, screen } = require('electron');

let operatorWindow = null;
let hallWindow = null;

function logDisplays(label) {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  console.log(`\n[${label}] displays: ${all.length}`);
  for (const d of all) {
    console.log(`  - id=${d.id} label="${d.label || '(no label)'}" ` +
      `primary=${d.id === primary.id} ` +
      `bounds=${JSON.stringify(d.bounds)} ` +
      `workArea=${JSON.stringify(d.workArea)} ` +
      `scaleFactor=${d.scaleFactor}`);
  }
}

function createOperatorWindow(displayBounds) {
  const t0 = Date.now();
  const win = new BrowserWindow({
    title: 'v2-probe / OPERATOR',
    x: displayBounds.x + 40,
    y: displayBounds.y + 40,
    width: 800,
    height: 600,
    backgroundColor: '#0A1F3D',
    webPreferences: { sandbox: true }
  });
  win.loadURL('data:text/html,<h1 style="color:#fff;background:#0A1F3D;padding:1em">OPERATOR (PC 側)</h1>');
  const cost = Date.now() - t0;
  console.log(`[create] operator window ready in ${cost}ms`);
  win.on('closed', () => { operatorWindow = null; });
  return win;
}

function createHallWindow(displayBounds) {
  const t0 = Date.now();
  const win = new BrowserWindow({
    title: 'v2-probe / HALL',
    x: displayBounds.x + 40,
    y: displayBounds.y + 40,
    width: 800,
    height: 600,
    backgroundColor: '#000',
    webPreferences: { sandbox: true }
  });
  win.loadURL('data:text/html,<h1 style="color:#FFD700;background:#000;padding:1em">HALL (お客向け)</h1>');
  const cost = Date.now() - t0;
  console.log(`[create] hall window ready in ${cost}ms`);
  win.on('closed', () => { hallWindow = null; });
  return win;
}

function destroyHallWindow() {
  if (!hallWindow) return;
  const t0 = Date.now();
  hallWindow.close();
  hallWindow = null;
  console.log(`[destroy] hall window closed in ${Date.now() - t0}ms`);
}

app.whenReady().then(() => {
  logDisplays('startup');
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();

  // operator は primary に置く
  operatorWindow = createOperatorWindow(primary.bounds);

  // 2 枚目があれば hall として開く
  const secondary = all.find((d) => d.id !== primary.id);
  if (secondary) {
    console.log(`[init] secondary display detected (id=${secondary.id}), opening hall window`);
    hallWindow = createHallWindow(secondary.bounds);
  } else {
    console.log('[init] only one display detected, hall window NOT opened (single-screen mode)');
  }

  // display-added / display-removed イベント
  screen.on('display-added', (_event, newDisplay) => {
    console.log(`\n[event] display-added id=${newDisplay.id}`);
    logDisplays('after display-added');
    if (!hallWindow) {
      console.log('[event] auto-opening hall window on new display');
      hallWindow = createHallWindow(newDisplay.bounds);
    }
  });

  screen.on('display-removed', (_event, oldDisplay) => {
    console.log(`\n[event] display-removed id=${oldDisplay.id}`);
    logDisplays('after display-removed');
    if (hallWindow) {
      console.log('[event] auto-closing hall window');
      destroyHallWindow();
    }
  });

  screen.on('display-metrics-changed', (_event, display, changedMetrics) => {
    console.log(`[event] display-metrics-changed id=${display.id} changed=${JSON.stringify(changedMetrics)}`);
  });
});

app.on('window-all-closed', () => {
  console.log('[lifecycle] all windows closed, exiting');
  app.quit();
});
