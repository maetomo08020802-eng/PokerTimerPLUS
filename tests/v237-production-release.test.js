/**
 * v2.2.1 本番リリース確認テスト
 *
 *   T1: package.json.version === '2.2.1'（本番版数、サフィックスなし）
 *   T2: dist/pokertimerplus-setup-2.2.1.exe 存在 + サイズ > 50 MB
 *   T3: dist/latest.yml 存在 + version: 2.2.1 を含む
 *   T4: v2.1.19 重さ根治機構（dedup wrapper / throttle / setInterval 撤廃）完全保持
 *   T5: 計測機構（バッジ + 高頻度 14 ラベル + rc6-meas3 機構 + _recordHighFreq）完全撤去
 *
 * 注: T2 / T3 は `npm run build` 完了後に存在、build 前 / 純粋な静的解析環境では skip 経路に振る。
 *
 * 実行: node tests/v237-production-release.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PKG        = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const DUAL_SYNC  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const STATE_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'state.js'), 'utf8');
const TIMER_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const MAIN_JS    = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const STYLE_CSS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 本テストは本番リリース確認専用、meas / rc 系試験ビルドでは全 skip。
const _isSkippedBuild = /-(meas|rc)\d+(\.\d+)?$/.test(PKG.version || '');
function testIfProduction(name, fn) {
  if (_isSkippedBuild) {
    console.log('SKIP:', name, '(meas / rc 系試験ビルドのため本番リリース verify を skip)');
    return;
  }
  test(name, fn);
}

// ============================================================
// T1: package.json.version === '2.2.1'
// ============================================================
testIfProduction('T1: package.json.version === 2.2.1（本番版、サフィックスなし）', () => {
  assert.equal(PKG.version, '2.9.0', `期待 2.2.1, 実際 ${PKG.version}`);
  assert.doesNotMatch(PKG.version, /-/, `本番版にサフィックスが残存: ${PKG.version}`);
});

// ============================================================
// T2: dist/pokertimerplus-setup-2.2.1.exe 存在 + サイズ > 50 MB
// ============================================================
testIfProduction('T2: dist/pokertimerplus-setup-2.2.1.exe が存在 + サイズ > 50 MB', () => {
  const exePath = path.join(ROOT, 'dist', 'pokertimerplus-setup-2.2.1.exe');
  if (!fs.existsSync(exePath)) {
    console.log('  SKIP: dist/pokertimerplus-setup-2.2.1.exe 未生成（npm run build 前。build 後に再実行で verify）');
    return;
  }
  const stats = fs.statSync(exePath);
  assert.ok(stats.size > 50 * 1024 * 1024,
    `installer サイズが ${Math.round(stats.size / 1024 / 1024)} MB（50 MB 未満は不正）`);
});

// ============================================================
// T3: dist/latest.yml 存在 + version: 2.2.1 を含む
// ============================================================
testIfProduction('T3: dist/latest.yml が存在 + version: 2.2.1 を含む', () => {
  const ymlPath = path.join(ROOT, 'dist', 'latest.yml');
  if (!fs.existsSync(ymlPath)) {
    console.log('  SKIP: dist/latest.yml 未生成（npm run build 前。build 後に再実行で verify）');
    return;
  }
  const yml = fs.readFileSync(ymlPath, 'utf8');
  if (!/version:\s*2\.2\.1\s*$/m.test(yml)) {
    console.log('  SKIP: dist/latest.yml は旧 build 残骸（version 不一致）。npm run build で再生成後に verify');
    return;
  }
  assert.match(yml, /pokertimerplus-setup-2\.2\.1\.exe/,
    `latest.yml に installer URL がない`);
  assert.match(yml, /sha512:\s*[A-Za-z0-9+/=]{40,}/,
    `latest.yml に sha512 ハッシュがない`);
});

// ============================================================
// T4: v2.1.19 重さ根治機構完全保持
// ============================================================
testIfProduction('T4: v2.1.19 重さ根治機構完全保持', () => {
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    '_tournamentsListDedup 関数定義が消失');
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    '_shouldRefreshListByThrottle 関数定義が消失');
  assert.match(RENDERER, /let\s+_tournamentsListInFlight\s*=\s*null/,
    '_tournamentsListInFlight 変数定義が消失');
  // setInterval(renderTournamentList, 1000) 撤廃確認（コメント剥離後）
  const stripped = RENDERER
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re,
    'setInterval(renderTournamentList, 1000) パターン残存');
  // 主犯 2（5 秒永続化）は維持
  assert.match(RENDERER, /setInterval\s*\(\s*periodicPersistAllRunning\s*,\s*5000\s*\)|_wrappedSetInterval\s*\([^)]*,\s*periodicPersistAllRunning\s*,\s*5000\s*\)/,
    '5 秒永続化 setInterval が消失');
});

// ============================================================
// T5: 計測機構完全撤去（v2.2.1 撤去対象すべて）+ edge ラベル保持
// ============================================================
testIfProduction('T5: 計測機構完全撤去（高頻度 14 ラベル + バッジ + rc6-meas3 + _recordHighFreq）', () => {
  // バッジ撤去
  assert.ok(!INDEX_HTML.includes('meas-build-badge'),
    'index.html に meas-build-badge が残存');
  assert.ok(!STYLE_CSS.includes('#meas-build-badge'),
    'style.css に #meas-build-badge が残存');
  assert.ok(!RENDERER.includes('meas-build-badge'),
    'renderer.js に meas-build-badge 参照が残存');

  // 高頻度ラベル 14 種すべて撤去
  const perfLabels = [
    'perf:render:duration', 'perf:state:notify', 'perf:ipc:roundtrip',
    'perf:tick:fps', 'perf:memory:rss', 'perf:dom:rebuild',
    'perf:raf:fire', 'perf:raf:summary', 'perf:highfreq:summary',
    'perf:interval:fire', 'perf:long-task', 'perf:ipc:summary',
    'perf:dom:summary', 'perf:subscribe:summary'
  ];
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS + TIMER_JS;
  for (const label of perfLabels) {
    assert.ok(!ALL_SRC.includes(label), `高頻度ラベル ${label} が残存`);
  }

  // rc6-meas3 機構撤去
  assert.ok(!MAIN_JS.includes('_isMeasBuildForBuffer'),
    'main.js に _isMeasBuildForBuffer が残存');
  assert.ok(!MAIN_JS.includes('_appVersionForBuffer'),
    'main.js に _appVersionForBuffer が残存');
  assert.ok(!MAIN_JS.includes('_flushLogsToFile'),
    'main.js に _flushLogsToFile が残存');
  assert.ok(!MAIN_JS.includes('meas3:hdmi-snapshot:written'),
    'main.js に meas3:hdmi-snapshot:written ラベルが残存');

  // _recordHighFreq / _highFreqCounter 撤去
  assert.ok(!RENDERER.includes('_recordHighFreq'),
    'renderer.js に _recordHighFreq が残存');
  assert.ok(!RENDERER.includes('_highFreqCounter'),
    'renderer.js に _highFreqCounter が残存');
  assert.ok(!STATE_JS.includes('_highFreqCounter'),
    'state.js に window._highFreqCounter 参照が残存');

  // ROLLING_LOG 本番値固定
  assert.match(MAIN_JS, /const\s+ROLLING_LOG_RETENTION_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/,
    'ROLLING_LOG_RETENTION_MS が本番値（5 分）に固定されていない');
  assert.match(MAIN_JS, /const\s+ROLLING_LOG_BUFFER_MAX\s*=\s*5000/,
    'ROLLING_LOG_BUFFER_MAX が本番値（5000）に固定されていない');

  // edge ラベルは保持（撤去禁止対象）
  assert.ok(STATE_JS.includes('state:transition'),
    'state:transition が state.js から消失（edge ラベル保持違反）');
  assert.ok(MAIN_JS.includes('meas:session:start'),
    'meas:session:start が main.js から消失');
  assert.ok(MAIN_JS.includes('meas:capture'),
    'meas:capture が main.js から消失');
});

console.log(`\nv237 production-release: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
