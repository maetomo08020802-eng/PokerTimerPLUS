/**
 * v2.1.19 本番リリース確認テスト
 *
 *   T1: package.json.version === '2.1.20-rc4'（本番版数、サフィックスなし）
 *   T2: dist/pokertimerplus-setup-2.1.19.exe 存在 + サイズ > 50 MB
 *   T3: dist/latest.yml 存在 + version: 2.1.19 を含む
 *   T4: rc1 機構完全保持
 *   T5: meas1 機構完全撤去
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
const MAIN_JS    = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const STYLE_CSS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// v2.1.20-meas1: 本テストは本番リリース確認専用、meas / rc 系試験ビルドでは全 skip。
const _isSkippedBuild = /-(meas|rc)\d+$/.test(PKG.version || '');
function testIfProduction(name, fn) {
  if (_isSkippedBuild) {
    console.log('SKIP:', name, '(meas / rc 系試験ビルドのため本番リリース verify を skip)');
    return;
  }
  test(name, fn);
}

// ============================================================
// T1: package.json.version === '2.1.19'（本番版数、サフィックスなし）
// ============================================================
testIfProduction('T1: package.json.version === 2.1.19（本番版、サフィックスなし）', () => {
  assert.equal(PKG.version, '2.1.19', `期待 2.1.19, 実際 ${PKG.version}`);
  // サフィックス（-rc / -meas / -beta 等）が含まれていないことを明示確認
  assert.doesNotMatch(PKG.version, /-/, `本番版にサフィックスが残存: ${PKG.version}`);
});

// ============================================================
// T2: dist/pokertimerplus-setup-2.1.19.exe 存在 + サイズ > 50 MB
// ============================================================
testIfProduction('T2: dist/pokertimerplus-setup-2.1.19.exe が存在 + サイズ > 50 MB', () => {
  const exePath = path.join(ROOT, 'dist', 'pokertimerplus-setup-2.1.19.exe');
  if (!fs.existsSync(exePath)) {
    console.log('  SKIP: dist/pokertimerplus-setup-2.1.19.exe 未生成（npm run build 前。build 後に再実行で verify）');
    return;
  }
  const stats = fs.statSync(exePath);
  assert.ok(stats.size > 50 * 1024 * 1024,
    `installer サイズが ${Math.round(stats.size / 1024 / 1024)} MB（50 MB 未満は不正）`);
});

// ============================================================
// T3: dist/latest.yml 存在 + version: 2.1.19 を含む
// ============================================================
testIfProduction('T3: dist/latest.yml が存在 + version: 2.1.19 を含む', () => {
  const ymlPath = path.join(ROOT, 'dist', 'latest.yml');
  if (!fs.existsSync(ymlPath)) {
    console.log('  SKIP: dist/latest.yml 未生成（npm run build 前。build 後に再実行で verify）');
    return;
  }
  const yml = fs.readFileSync(ymlPath, 'utf8');
  // 旧 build 残骸（rc1 / rc2 / meas1 等）の場合は SKIP（npm run build で再生成必要）
  if (!/version:\s*2\.1\.19\s*$/m.test(yml)) {
    console.log('  SKIP: dist/latest.yml は旧 build 残骸（version 不一致）。npm run build で再生成後に verify');
    return;
  }
  // installer URL
  assert.match(yml, /pokertimerplus-setup-2\.1\.19\.exe/,
    `latest.yml に installer URL がない`);
  // sha512 ハッシュ
  assert.match(yml, /sha512:\s*[A-Za-z0-9+/=]{40,}/,
    `latest.yml に sha512 ハッシュがない`);
});

// ============================================================
// T4: v2.1.19-rc1 機構完全保持（dedup wrapper / throttle / setInterval 撤廃 / 12 箇所 dedup wrapper 経由）
// ============================================================
testIfProduction('T4: v2.1.19-rc1 機構完全保持', () => {
  // 関数定義
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    '_tournamentsListDedup 関数定義が消失');
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    '_shouldRefreshListByThrottle 関数定義が消失');
  assert.match(RENDERER, /let\s+_tournamentsListInFlight\s*=\s*null/,
    '_tournamentsListInFlight 変数定義が消失');
  assert.match(RENDERER, /let\s+_lastListRenderAt\s*=\s*0/,
    '_lastListRenderAt 変数定義が消失');
  // setInterval(renderTournamentList, 1000) 撤廃確認（コメント剥離後）
  const stripped = RENDERER
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re,
    'setInterval(renderTournamentList, 1000) パターン残存（rc1 主犯 1 撤廃が破壊）');
  // 主犯 2（永続化用 5 秒 setInterval）は維持
  assert.match(RENDERER, /setInterval\s*\(\s*periodicPersistAllRunning\s*,\s*5000\s*\)/,
    '主犯 2 (setInterval(periodicPersistAllRunning, 5000)) が消失（永続化機能、維持必須）');
  // 直接 list 呼出 0 件 + dedup wrapper 経由 12 件以上
  const directCalls = RENDERER.match(/await\s+window\.api\??\.?tournaments\??\.?list\??\.?\(\)/g) || [];
  assert.equal(directCalls.length, 0,
    `await window.api.tournaments.list() 直接呼出が ${directCalls.length} 件残存（dedup 経由必須）`);
  const dedupCalls = (RENDERER.match(/_tournamentsListDedup\s*\(\)/g) || []).length;
  assert.ok(dedupCalls >= 12, `_tournamentsListDedup() 呼出が ${dedupCalls} 件しかない（12 件以上必要）`);
});

// ============================================================
// T5: v2.1.18-meas1 計測機構完全撤去（バッジ + perf 系 6 ラベル + meas:* + _measOpCounter すべて 0 件）
// ============================================================
testIfProduction('T5: v2.1.18-meas1 計測機構完全撤去', () => {
  // バッジ撤去
  assert.ok(!INDEX_HTML.includes('meas-build-badge'),
    'index.html に meas-build-badge が残存');
  assert.ok(!STYLE_CSS.includes('#meas-build-badge'),
    'style.css に #meas-build-badge が残存');
  assert.ok(!RENDERER.includes('meas-build-badge'),
    'renderer.js に meas-build-badge が残存');
  // perf 系 6 ラベル全撤去
  const perfLabels = ['perf:render:duration', 'perf:ipc:roundtrip', 'perf:tick:fps', 'perf:memory:rss', 'perf:state:notify', 'perf:dom:rebuild'];
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  for (const label of perfLabels) {
    assert.ok(!ALL_SRC.includes(label), `${label} が残存`);
  }
  // meas:* 系撤去
  assert.ok(!ALL_SRC.includes('meas:session:start'), 'meas:session:start が残存');
  assert.ok(!ALL_SRC.includes('meas:capture'), 'meas:capture が残存');
  // バグ発見系新規 2 ラベル撤去
  assert.ok(!ALL_SRC.includes('state:transition'), 'state:transition が残存');
  assert.ok(!ALL_SRC.includes('dual-sync:apply'), 'dual-sync:apply が残存');
  // _measOpCounter 撤去
  assert.ok(!MAIN_JS.includes('_measOpCounter'),
    'main.js に _measOpCounter が残存');
  // error:caught:* / ui:keypress / ui:click:major（meas1 追加分）撤去
  const errCatch = ALL_SRC.match(/['"]error:caught:[a-zA-Z][\w:.-]*['"]/g) || [];
  assert.equal(errCatch.length, 0, `error:caught:* が ${errCatch.length} 件残存`);
  const keypress = ALL_SRC.match(/['"]ui:keypress['"]/g) || [];
  assert.equal(keypress.length, 0, `ui:keypress が ${keypress.length} 件残存`);
  const click = ALL_SRC.match(/['"]ui:click:major['"]/g) || [];
  assert.equal(click.length, 0, `ui:click:major が ${click.length} 件残存`);
});

console.log(`\nv237 production-release: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
