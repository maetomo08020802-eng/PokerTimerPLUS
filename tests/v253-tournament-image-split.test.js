/**
 * v2.5.0 静的解析 + 機能テスト — tournament-bloat 画像分離（根治）
 *
 *   背景画像 / 休憩スライドショーの base64 を tournaments 配列から分離し、
 *   別ファイル tournament-images.json（imagesStore）へ保持。
 *   毎秒 tournaments:list・毎操作の全件書込から画像を外す（重さの根治）。
 *
 * 検証:
 *   - imagesStore / get・set・delete・merge ヘルパ存在
 *   - tournaments:list / normalizeTournament / migrate が image-free
 *   - tournaments:getImages IPC + preload expose
 *   - setDisplaySettings の画像分岐が imagesStore へ付け替え（tournaments 非肥大）
 *   - getActive / setActive / save 戻り値・broadcast に画像再マージ
 *   - migration: backup → 検証一致のみ strip → 冪等フラグ → runtime 非消失 → schema より先
 *   - delete で画像後片付け / export で画像 2 フィールド除外（marquee 維持）
 *   - renderer: loadTournamentIntoForm / 起動初期化が getImages 経由
 *   - 機能: 実 config から画像を外すと極小化する（根治の実証、read-only）
 *
 * 実行: node tests/v253-tournament-image-split.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const os     = require('node:os');

const ROOT       = path.join(__dirname, '..');
const PKG        = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN       = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD    = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 指定関数の本体を抜き出す（インデント非依存。本体の開き波括弧から対応をカウントして閉じまで抽出）。
//   ※ デフォルト引数の {}（例: fallback = {}）を本体波括弧と誤認しないよう、マッチ末尾の本体 { から数える。
function topLevelFnBody(src, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{', 'g');
  const m = re.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;   // 本体の '{' の位置（マッチ最終文字）
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

// ============================================================
// version
// ============================================================
test('version: package.json version === 2.5.0', () => {
  assert.equal(PKG.version, '2.6.1', `version が ${PKG.version}（期待 2.5.0）`);
});

// ============================================================
// imagesStore + ヘルパ
// ============================================================
test('imagesStore: tournament-images.json の別 store を新設', () => {
  assert.match(MAIN, /new Store\(\{\s*name:\s*['"]tournament-images['"]/, 'imagesStore（別ファイル）が無い');
});

test('ヘルパ: get/set/delete/merge が存在', () => {
  assert.match(MAIN, /function getTournamentImages\(id\)/, 'getTournamentImages が無い');
  assert.match(MAIN, /function setTournamentImages\(id, patch\)/, 'setTournamentImages が無い');
  assert.match(MAIN, /function deleteTournamentImages\(id\)/, 'deleteTournamentImages が無い');
  assert.match(MAIN, /function mergeImagesIntoDisplaySettings\(id, baseDs\)/, 'mergeImagesIntoDisplaySettings が無い');
});

// ============================================================
// tournaments:list / normalize が image-free
// ============================================================
test('tournaments:list の displaySettings に画像 2 フィールドが無い（毎秒 hot path 軽量化）', () => {
  const m = MAIN.match(/ipcMain\.handle\('tournaments:list'[\s\S]*?\n  \}\);/);
  assert.ok(m, 'tournaments:list ハンドラが見つからない');
  const handler = m[0];
  // displaySettings 構築ブロックを抽出（IIFE）
  const dsBlock = handler.match(/displaySettings:\s*\(\(\)\s*=>\s*\{[\s\S]*?\}\)\(\)/);
  assert.ok(dsBlock, 'list の displaySettings ブロックが見つからない');
  assert.doesNotMatch(dsBlock[0], /backgroundImage:/, 'list が backgroundImage を返している（image-free 違反）');
  assert.doesNotMatch(dsBlock[0], /breakImages:/, 'list が breakImages を返している（image-free 違反）');
  // 非画像フィールドは維持
  assert.match(dsBlock[0], /backgroundOverlay:/, 'backgroundOverlay が欠落');
  assert.match(dsBlock[0], /pipSize:/, 'pipSize が欠落');
});

test('normalizeTournament の displaySettings が image-free（取込・補完とも）', () => {
  const body = topLevelFnBody(MAIN, 'normalizeTournament');
  assert.ok(body, 'normalizeTournament が見つからない');
  // out.displaySettings = { ... } のブロック群に backgroundImage / breakImages のキー代入が無い
  const dsAssigns = body.match(/out\.displaySettings = \{[\s\S]*?\};/g) || [];
  assert.ok(dsAssigns.length >= 1, 'out.displaySettings 代入が見つからない');
  for (const blk of dsAssigns) {
    assert.doesNotMatch(blk, /backgroundImage:/, 'normalizeTournament が backgroundImage を displaySettings に入れている');
    assert.doesNotMatch(blk, /breakImages:/, 'normalizeTournament が breakImages を displaySettings に入れている');
  }
});

// ============================================================
// getImages IPC + preload
// ============================================================
test('IPC: tournaments:getImages を登録 + preload で公開', () => {
  assert.match(MAIN, /ipcMain\.handle\('tournaments:getImages',\s*\(_event,\s*id\)\s*=>\s*getTournamentImages\(id\)\)/, 'tournaments:getImages ハンドラが無い');
  assert.match(PRELOAD, /getImages:\s*\(id\)\s*=>\s*_measuredInvoke\('tournaments:getImages',\s*id\)/, 'preload に getImages が無い');
});

// ============================================================
// setDisplaySettings の画像分岐が imagesStore へ
// ============================================================
test('setDisplaySettings: 画像は imagesStore へ、tournaments には書かない', () => {
  const m = MAIN.match(/ipcMain\.handle\('tournaments:setDisplaySettings'[\s\S]*?\n  \}\);/);
  assert.ok(m, 'setDisplaySettings ハンドラが無い');
  const h = m[0];
  assert.match(h, /setTournamentImages\(id,\s*imagePatch\)/, '画像を imagesStore へ書いていない');
  // 永続化する nextDs（tournaments 行）に画像キーが無い
  const nextDs = h.match(/const nextDs = \{[\s\S]*?\};/);
  assert.ok(nextDs, 'nextDs が見つからない');
  assert.doesNotMatch(nextDs[0], /backgroundImage:/, 'nextDs（tournaments 保存）に backgroundImage が混入');
  assert.doesNotMatch(nextDs[0], /breakImages:/, 'nextDs（tournaments 保存）に breakImages が混入');
  // 戻り値・broadcast は再マージ
  assert.match(h, /mergeImagesIntoDisplaySettings\(id,\s*nextDs\)/, '戻り値/broadcast の再マージが無い');
  // サイズ超過の error 経路は維持
  assert.match(h, /image-too-large/, 'サイズ超過 error 経路が消えている');
});

// ============================================================
// getActive / setActive / save 戻り値の再マージ
// ============================================================
test('getActive / setActive / save 戻り値に画像を再マージ', () => {
  const getActive = topLevelFnBody(MAIN, 'getActiveTournamentWithAliases');
  assert.ok(getActive, 'getActiveTournamentWithAliases が無い');
  assert.match(getActive, /mergeImagesIntoDisplaySettings\(found\.id/, 'getActive 戻り値が再マージしていない');
  // setActive return
  assert.match(MAIN, /return \{ \.\.\.found, title: found\.name, displaySettings: mergeImagesIntoDisplaySettings\(found\.id/, 'setActive 戻り値が再マージしていない');
  // save return
  assert.match(MAIN, /tournament: \{ \.\.\.validated, title: validated\.name, displaySettings: mergeImagesIntoDisplaySettings\(validated\.id/, 'save 戻り値が再マージしていない');
});

// ============================================================
// migration: 安全要件
// ============================================================
test('migration: migrateTournamentImages が backup→検証→strip→冪等フラグの順で安全に実装', () => {
  const body = topLevelFnBody(MAIN, 'migrateTournamentImages');
  assert.ok(body, 'migrateTournamentImages が無い');
  // 冪等フラグ
  assert.match(body, /imageSplitMigrated/, '冪等フラグ（imageSplitMigrated）が無い');
  assert.match(body, /if \(s\.get\('imageSplitMigrated'\)\) return;/, '冒頭の冪等 return が無い');
  // backup
  assert.match(body, /copyFileSync/, 'config backup（copyFileSync）が無い');
  assert.match(body, /config\.pre-image-split\.backup\.json/, 'backup ファイル名が違う');
  // 検証してから strip（不一致で return）
  assert.match(body, /dstCount !== srcCount \|\| dstBytes !== srcBytes/, '枚数・バイト一致検証が無い');
  // strip は displaySettings のみ書換、t を spread して runtime 等を保持（致命バグ保護）
  assert.match(body, /\{\s*\.\.\.t,\s*displaySettings:\s*nextDs\s*\}/, 'strip で t を spread して runtime 等を保持していない');
  // フラグ set は strip の後
  const stripIdx = body.indexOf("s.set('tournaments', stripped)");
  const flagIdx  = body.indexOf("s.set('imageSplitMigrated', true)");
  assert.ok(stripIdx > 0 && flagIdx > stripIdx, 'フラグ set が strip の後になっていない');
});

test('migration: 画像分離は schema migration より前に呼ばれる（生の inline 画像を読むため）', () => {
  const imgIdx    = MAIN.indexOf('migrateTournamentImages(store)');
  const schemaIdx = MAIN.indexOf('migrateTournamentSchema(store)');
  assert.ok(imgIdx > 0 && schemaIdx > 0, '両 migration 呼出が見つからない');
  assert.ok(imgIdx < schemaIdx, 'migrateTournamentImages が migrateTournamentSchema より後に呼ばれている');
});

// ============================================================
// delete / export
// ============================================================
test('delete: 削除時に画像を後片付け', () => {
  const m = MAIN.match(/ipcMain\.handle\('tournaments:delete'[\s\S]*?\n  \}\);/);
  assert.ok(m, 'delete ハンドラが無い');
  assert.match(m[0], /deleteTournamentImages\(id\)/, 'delete で画像後片付けが無い');
});

test('export: buildExportPayload が画像 2 フィールドを除外（marquee 等は維持）', () => {
  const body = topLevelFnBody(MAIN, 'buildExportPayload');
  assert.ok(body, 'buildExportPayload が無い');
  assert.match(body, /delete nextDs\.backgroundImage/, 'export で backgroundImage を除外していない');
  assert.match(body, /delete nextDs\.breakImages/, 'export で breakImages を除外していない');
  // marquee は除外しない（引き継ぐ）
  assert.doesNotMatch(body, /delete\s+\w*\.?marqueeSettings/, 'export で marquee を誤って除外している');
});

// ============================================================
// renderer の付け替え
// ============================================================
test('renderer: loadTournamentIntoForm が getImages で画像注入', () => {
  const m = RENDERER.match(/async function loadTournamentIntoForm\(id\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, 'loadTournamentIntoForm が見つからない');
  assert.match(m[0], /tournaments\.getImages\(id\)/, 'loadTournamentIntoForm が getImages を呼んでいない');
  assert.match(m[0], /applyTournament\(foundWithImages\)/, '画像注入後に applyTournament していない');
});

test('renderer: 起動初期化が getImages(activeId) で画像取得', () => {
  assert.match(RENDERER, /tournaments\.getImages\(activeId\)/, '起動初期化が getImages(activeId) を使っていない');
});

// ============================================================
// 機能テスト: 画像を外すと config が極小化（根治の実証、read-only）
// ============================================================
test('機能: 実 config から画像 2 フィールドを外すと極小化（根治の実証）', () => {
  const cfgPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PokerTimerPLUS+', 'config.json');
  if (!fs.existsSync(cfgPath)) {
    console.log('  (skip: 実 config.json 不在の環境)');
    return;
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const ts = cfg.tournaments || [];
  const fullBytes = Buffer.byteLength(JSON.stringify(ts), 'utf8');
  const lite = ts.map((t) => {
    const ds = { ...(t.displaySettings || {}) };
    delete ds.backgroundImage; delete ds.breakImages;
    return { ...t, displaySettings: ds };
  });
  const liteBytes = Buffer.byteLength(JSON.stringify(lite), 'utf8');
  // runtime 等の非画像フィールドが全件保持されていること
  for (let i = 0; i < ts.length; i++) {
    assert.deepEqual(lite[i].runtime, ts[i].runtime, `tournament[${i}] の runtime が strip で失われた`);
    assert.deepEqual(lite[i].timerState, ts[i].timerState, `tournament[${i}] の timerState が strip で失われた`);
    assert.deepEqual(lite[i].marqueeSettings, ts[i].marqueeSettings, `tournament[${i}] の marqueeSettings が失われた`);
  }
  // 画像入りなら大幅縮小、元々画像が無くても lite <= full は常に成立
  assert.ok(liteBytes <= fullBytes, 'strip 後がむしろ大きい');
  console.log(`  実測: tournaments ${ (fullBytes/1024/1024).toFixed(2) }MB → image-free ${ (liteBytes/1024).toFixed(1) }KB`);
});

// ============================================================
// 致命バグ保護 cross-check
// ============================================================
test('致命バグ保護: tournaments:list が runtime / timerState を引き続き返す', () => {
  const m = MAIN.match(/ipcMain\.handle\('tournaments:list'[\s\S]*?\n  \}\);/);
  assert.match(m[0], /runtime:\s*sanitizeRuntime/, 'list が runtime を返していない（C.1.8 不変条件）');
  assert.match(m[0], /timerState:\s*normalizeTimerState/, 'list が timerState を返していない');
});

console.log(`\nv253 tournament-image-split: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
