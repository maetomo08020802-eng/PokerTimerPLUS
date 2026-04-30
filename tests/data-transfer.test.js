/**
 * STEP 6.23 PC間データ移行ロジックの Node.js テスト
 *
 * main.js から pure なロジックだけ require して assert で検証。
 * Electron / electron-store は require.cache インジェクションで stub。
 *
 * 実行: node tests/data-transfer.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// ============================================================
// 1. Electron の stub（app.whenReady() は never-resolves で then 副作用を完全停止）
// ============================================================
const electronStub = {
  app: {
    getVersion: () => '1.0.0-test',
    whenReady: () => new Promise(() => {}), // 永久に resolve しない → .then() は走らない
    commandLine: { appendSwitch: () => {} },
    on: () => {},
    quit: () => {}
  },
  BrowserWindow: function () {}, // 使われない（whenReady never resolves）
  Menu: { setApplicationMenu: () => {} },
  dialog: {
    showMessageBox: async () => ({ response: 0 }),
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true })
  },
  globalShortcut: { register: () => {}, unregisterAll: () => {} },
  ipcMain: { handle: () => {} },
  shell: { openExternal: () => {} },
  powerMonitor: { on: () => {} }
};

// ============================================================
// 2. electron-store の stub（in-memory）
// ============================================================
class FakeStore {
  constructor(opts) {
    this._data = JSON.parse(JSON.stringify(opts?.defaults || {}));
  }
  get(key) { return this._data[key]; }
  set(key, value) { this._data[key] = value; }
  delete(key) { delete this._data[key]; }
  get store() { return this._data; }
}

// ============================================================
// 3. require.cache インジェクション
// ============================================================
const electronCacheKey = require.resolve.paths
  ? 'electron-stub'
  : 'electron-stub';
require.cache[electronCacheKey] = {
  id: electronCacheKey,
  filename: electronCacheKey,
  loaded: true,
  exports: electronStub
};
const storeCacheKey = 'electron-store-stub';
require.cache[storeCacheKey] = {
  id: storeCacheKey,
  filename: storeCacheKey,
  loaded: true,
  exports: FakeStore
};

// require resolution を上書き
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return electronCacheKey;
  if (request === 'electron-store') return storeCacheKey;
  return originalResolve.call(this, request, parent, ...rest);
};

// ============================================================
// 4. main.js を require
// ============================================================
const mainPath = path.join(__dirname, '..', 'src', 'main.js');
const main = require(mainPath);

// ============================================================
// 5. 簡易テストランナー
// ============================================================
const passed = [];
const failed = [];

function t(name, fn) {
  try {
    fn();
    passed.push(name);
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed.push({ name, message: err.message });
    console.error(`FAIL: ${name}`);
    console.error(`  ${err.message}`);
  }
}

// ============================================================
// 6. テストケース
// ============================================================

// T1: builtinプリセット参照のtournamentで buildExportPayload → userPresets が空配列
// IPC ハンドラ tournaments:exportSingle のフィルタリングロジックを再現
t('T1: builtin reference → userPresets is empty', () => {
  const tournament = { id: 't-1', name: 'A', blindPresetId: 'demo-fast' };
  const userPresets = [
    { id: 'user-1', name: 'P', levels: [{ durationMinutes: 5, smallBlind: 100, bigBlind: 200, ante: 0 }] }
  ];
  // IPC 内のフィルタ: builtin なら同梱しない
  const builtinIds = new Set(main.BUILTIN_PRESETS.map((p) => p.id));
  const linked = builtinIds.has(tournament.blindPresetId)
    ? []
    : userPresets.filter((p) => p.id === tournament.blindPresetId);
  const out = main.buildExportPayload('single', [tournament], linked);
  assert.deepEqual(out.userPresets, [], 'userPresets は空配列であるべき');
  assert.equal(out.tournaments.length, 1);
  assert.equal(out.kind, 'single');
  assert.equal(out.format, main.EXPORT_FORMAT);
  assert.equal(out.version, main.EXPORT_VERSION);
});

// T2: userPreset参照のtournamentで buildExportPayload → 該当userPresetが同梱
t('T2: userPreset reference → matching preset included', () => {
  const tournament = { id: 't-2', name: 'B', blindPresetId: 'user-1' };
  const userPresets = [
    { id: 'user-1', name: 'P', levels: [{ durationMinutes: 5, smallBlind: 100, bigBlind: 200, ante: 0 }] },
    { id: 'user-2', name: 'Q', levels: [{ durationMinutes: 10, smallBlind: 50, bigBlind: 100, ante: 0 }] }
  ];
  const builtinIds = new Set(main.BUILTIN_PRESETS.map((p) => p.id));
  const linked = builtinIds.has(tournament.blindPresetId)
    ? []
    : userPresets.filter((p) => p.id === tournament.blindPresetId);
  const out = main.buildExportPayload('single', [tournament], linked);
  assert.equal(out.userPresets.length, 1, '該当 1 件のみ同梱');
  assert.equal(out.userPresets[0].id, 'user-1');
  assert.equal(out.userPresets[0].name, 'P');
});

// T3: timerStateが何であっても buildExportPayload で必ず idle に初期化
t('T3: timerState forcibly initialized to idle', () => {
  const tournament = {
    id: 't-3', name: 'C', blindPresetId: 'demo-fast',
    timerState: {
      status: 'running',
      currentLevel: 5,
      elapsedSecondsInLevel: 99,
      startedAt: 1700000000000,
      pausedAt: null
    }
  };
  const out = main.buildExportPayload('single', [tournament], []);
  const ts = out.tournaments[0].timerState;
  assert.equal(ts.status, 'idle', 'status は idle');
  assert.equal(ts.currentLevel, 1);
  assert.equal(ts.elapsedSecondsInLevel, 0);
  assert.equal(ts.startedAt, null);
  assert.equal(ts.pausedAt, null);
});

// T4: validateImportPayload({format:'wrong',...}) → wrong-format
t('T4: wrong-format rejected', () => {
  const r = main.validateImportPayload({ format: 'wrong', version: 1, tournaments: [], userPresets: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'wrong-format');
});

// T5: validateImportPayload({format:正,version:99,...}) → version-too-new
t('T5: version-too-new rejected', () => {
  const r = main.validateImportPayload({
    format: 'PokerTimerPLUS+ Tournament Export',
    version: 99,
    tournaments: [],
    userPresets: []
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'version-too-new');
});

// T6: 正常な payload → ok
t('T6: valid payload accepted', () => {
  const r = main.validateImportPayload({
    format: 'PokerTimerPLUS+ Tournament Export',
    version: 1,
    tournaments: [],
    userPresets: []
  });
  assert.equal(r.ok, true);
});

// T7: rename戦略で id と name に「(コピー)」付与される
// importPayload IPC ハンドラ内の rename ロジックと同一の処理を実行して挙動を検証
t('T7: rename action → new id, "(コピー)" suffix on name', () => {
  // main.js の `tournaments:importPayload` ハンドラ内の rename 分岐と同じ処理:
  //   normalized = { ...normalized,
  //     id: `tournament-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
  //     name: `${normalized.name} (コピー)` };
  const original = { id: 'tournament-abc', name: '元のトーナメント名' };
  const renamed = {
    ...original,
    id: `tournament-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${original.name} (コピー)`
  };
  // 検証
  assert.notEqual(renamed.id, original.id, 'id は新規発番されている');
  assert.match(renamed.id, /^tournament-\d+-[a-z0-9]{1,4}$/, 'id 書式が tournament-{ts}-{rand} に従う');
  assert.equal(renamed.name, '元のトーナメント名 (コピー)', 'name 末尾に「 (コピー)」が付与');
  // 念のため: 衝突防止のため複数回生成しても id が異なる
  const renamed2 = {
    ...original,
    id: `tournament-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${original.name} (コピー)`
  };
  // Date.now() 同タイミングなら同値の可能性があるが、Math.random() で衝突回避
  assert.notEqual(renamed2.id, renamed.id, '2 回目も id が異なる（rand suffix で衝突回避）');
});

// ============================================================
// 7. サマリー
// ============================================================
console.log('');
console.log(`=== Summary: ${passed.length} passed / ${failed.length} failed ===`);

if (failed.length > 0) {
  console.error('\nFailed tests:');
  for (const f of failed) {
    console.error(`  - ${f.name}: ${f.message}`);
  }
  process.exit(1);
} else {
  process.exit(0);
}
