#!/usr/bin/env node
/**
 * tournament-bloat-bench.js — tournament-bloat STEP1 計測ベースライン（before/after-projection）
 *
 * 目的: 保存トーナメント激重問題の根因（displaySettings の画像 base64 を tournaments 配列に inline 格納）を
 *       数値で可視化し、STEP2「画像分離」後の after と同条件比較できる再現可能スクリプトとして残す。
 *
 * 安全性:
 *   - 実 config.json は **read-only**（fs.readFileSync のみ）。原本は一切変更しない。
 *   - 書込ベンチ（store.set 相当）は os.tmpdir() のコピーに対してのみ実施し、終了時に削除する。
 *   - build 対象外（package.json build.files で scripts 配下を除外）、テスト対象外。本番アプリには同梱されない。
 *
 * 使い方:
 *   node scripts/tournament-bloat-bench.js                # 既定 = %APPDATA%/PokerTimerPLUS+/config.json
 *   node scripts/tournament-bloat-bench.js <configPath>   # 任意の config.json を指定（STEP2 after 比較用）
 *
 * 計測項目（brief DoD 準拠）:
 *   1. config.json 実ディスクサイズ
 *   2. tournaments:list 戻り値バイトサイズ（JSON.stringify(result) のバイト長）
 *   3. tournaments:list の CPU コスト（main の sanitize ホットパス再現）+ IPC 搬送 proxy（v8 serialize/deserialize）
 *   4. 1 件部分保存（store.set('tournaments', list)）= 全件 stringify + atomic write のコスト
 *   いずれも BEFORE（画像入り）と AFTER 想定（画像分離後）を並記。
 *
 * 注意: 実 Electron の ipcMain↔ipcRenderer 往復“そのもの”は GUI 起動が要るため本スクリプトでは測れない。
 *       ただし往復コストの支配項（main 側 sanitize CPU + structured-clone 直列化）は本スクリプトで実測できる。
 *       Electron IPC は内部で V8 structured clone を用いるため、v8.serialize/deserialize を搬送 proxy とする。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const v8 = require('v8');

const CONFIG_PATH = process.argv[2] || path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'PokerTimerPLUS+', 'config.json'
);
const RUNS = 15;

// ===== main.js の画像 sanitize ホットパスを忠実に再現（定数・正規表現は main.js と同一）=====
const BACKGROUND_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const BACKGROUND_IMAGE_DATA_URL_MAX_LEN = Math.ceil(BACKGROUND_IMAGE_MAX_BYTES * 4 / 3) + 64;
const BACKGROUND_IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
const BREAK_IMAGES_MAX_COUNT = 20;

function sanitizeBackgroundImage(value, fallback) {
  if (typeof value !== 'string') return (typeof fallback === 'string') ? fallback : '';
  if (value === '') return '';
  if (!BACKGROUND_IMAGE_DATA_URL_RE.test(value)) return (typeof fallback === 'string') ? fallback : '';
  if (value.length > BACKGROUND_IMAGE_DATA_URL_MAX_LEN) return null;
  return value;
}
function sanitizeBreakImages(value, fallback) {
  const fb = Array.isArray(fallback) ? fallback : [];
  if (!Array.isArray(value)) return fb.slice(0, BREAK_IMAGES_MAX_COUNT);
  const out = [];
  for (const item of value) {
    if (out.length >= BREAK_IMAGES_MAX_COUNT) break;
    const s = sanitizeBackgroundImage(item, '');
    if (typeof s === 'string' && s !== '') out.push(s);
  }
  return out;
}

// tournaments:list ハンドラの displaySettings 構築（画像 sanitize を含む = 毎秒走るホットパス）
function buildListItem(t) {
  const ds = t.displaySettings || {};
  const sanImage = sanitizeBackgroundImage(ds.backgroundImage, '');
  return {
    id: t.id, name: t.name, subtitle: t.subtitle,
    timerState: t.timerState, marqueeSettings: t.marqueeSettings, runtime: t.runtime,
    displaySettings: {
      background: ds.background, timerFont: ds.timerFont,
      backgroundImage: (sanImage === null) ? '' : sanImage,
      backgroundOverlay: ds.backgroundOverlay,
      breakImages: sanitizeBreakImages(ds.breakImages, []),
      breakImageInterval: ds.breakImageInterval, pipSize: ds.pipSize
    }
  };
}

// AFTER 想定: list 戻り値から画像 2 フィールドを除外した軽量 item
function buildLiteItem(t) {
  const ds = t.displaySettings || {};
  return {
    id: t.id, name: t.name, subtitle: t.subtitle,
    timerState: t.timerState, marqueeSettings: t.marqueeSettings, runtime: t.runtime,
    displaySettings: {
      background: ds.background, timerFont: ds.timerFont,
      backgroundOverlay: ds.backgroundOverlay,
      breakImageInterval: ds.breakImageInterval, pipSize: ds.pipSize
    }
  };
}

function median(arr) { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function bench(fn, runs) {
  const ts = [];
  for (let i = 0; i < runs; i++) {
    const a = process.hrtime.bigint();
    fn();
    const b = process.hrtime.bigint();
    ts.push(Number(b - a) / 1e6);
  }
  return { median: median(ts), min: Math.min(...ts), max: Math.max(...ts) };
}
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

// ===== 計測本体 =====
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('config.json が見つかりません:', CONFIG_PATH);
  process.exit(1);
}
const st = fs.statSync(CONFIG_PATH);
const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
const cfg = JSON.parse(raw);
const tournaments = cfg.tournaments || [];

console.log('===== tournament-bloat 計測ベースライン =====');
console.log('config:', CONFIG_PATH);
console.log('① config.json 実ディスクサイズ:', st.size, 'bytes (~' + mb(st.size) + ')');
console.log('  トーナメント件数:', tournaments.length);

// 画像内訳
let bgTotal = 0, brkTotal = 0, brkCount = 0;
for (const t of tournaments) {
  const ds = t.displaySettings || {};
  if (typeof ds.backgroundImage === 'string') bgTotal += ds.backgroundImage.length;
  if (Array.isArray(ds.breakImages)) { brkCount += ds.breakImages.length; for (const s of ds.breakImages) if (typeof s === 'string') brkTotal += s.length; }
}
console.log('  背景画像 合計:', '~' + mb(bgTotal));
console.log('  休憩スライドショー 合計:', '~' + mb(brkTotal), '(' + brkCount + ' 枚)');
console.log('  画像がファイルに占める割合:', ((bgTotal + brkTotal) / raw.length * 100).toFixed(1) + '%');

// ----- BEFORE（画像入り）-----
let listResult;
const mapB = bench(() => { listResult = tournaments.map(buildListItem); }, RUNS);
const listBytes = Buffer.byteLength(JSON.stringify(listResult), 'utf8');
const scB = bench(() => { v8.deserialize(v8.serialize(listResult)); }, RUNS);
console.log('\n--- BEFORE: tournaments:list（画像入り、毎秒）---');
console.log('② 戻り値 JSON バイトサイズ:', listBytes, 'bytes (~' + mb(listBytes) + ')');
console.log('③ list mapping+sanitize CPU:', mapB.median.toFixed(2), 'ms (min', mapB.min.toFixed(2), '/ max', mapB.max.toFixed(2) + ')');
console.log('③ IPC 搬送 proxy (v8 serialize+deserialize):', scB.median.toFixed(2), 'ms');

// 1 件部分保存（store.set）= 全件 stringify + atomic write（temp に対して）
const tmp = path.join(os.tmpdir(), 'ptp-bloat-bench-tmp.json');
const cfgBytes = Buffer.byteLength(JSON.stringify(cfg), 'utf8');
const saveB = bench(() => { fs.writeFileSync(tmp, JSON.stringify(cfg)); }, RUNS);
console.log('④ 1 件部分保存 store.set 相当（全件 stringify+write、payload ~' + mb(cfgBytes) + '）:', saveB.median.toFixed(2), 'ms');

// ----- AFTER 想定（画像を list / 保存対象から分離）-----
const liteList = tournaments.map(buildLiteItem);
const liteListBytes = Buffer.byteLength(JSON.stringify(liteList), 'utf8');
const liteCfg = { ...cfg, tournaments: tournaments.map((t) => {
  const c = { ...t };
  if (c.displaySettings) { const d = { ...c.displaySettings }; delete d.backgroundImage; delete d.breakImages; c.displaySettings = d; }
  return c;
}) };
const liteCfgBytes = Buffer.byteLength(JSON.stringify(liteCfg), 'utf8');
const liteMap = bench(() => tournaments.map(buildLiteItem), RUNS);
const liteSC = bench(() => v8.deserialize(v8.serialize(liteList)), RUNS);
const liteSave = bench(() => fs.writeFileSync(tmp, JSON.stringify(liteCfg)), RUNS);
console.log('\n--- AFTER 想定: 画像を tournaments 配列から分離 ---');
console.log('② list 戻り値:', liteListBytes, 'bytes (~' + kb(liteListBytes) + ')  削減率 ' + (100 - liteListBytes / listBytes * 100).toFixed(2) + '%');
console.log('③ list mapping CPU:', liteMap.median.toFixed(3), 'ms');
console.log('③ IPC 搬送 proxy:', liteSC.median.toFixed(3), 'ms');
console.log('④ 保存対象 config:', liteCfgBytes, 'bytes (~' + kb(liteCfgBytes) + ')  保存 stringify+write:', liteSave.median.toFixed(3), 'ms');

try { fs.unlinkSync(tmp); } catch (_) { /* noop */ }
console.log('\n(原本 config.json は read-only。書込ベンチは', tmp, 'に対してのみ実施し削除済)');
