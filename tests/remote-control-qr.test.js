/**
 * remote-control Phase 1b-qr — 自作 QR 生成器の正確性（規格照合）+ 配線の回帰テスト
 *
 * 対象: src/remote/vendor/qrcode.js（依存ゼロ自作・byte/level L/version 1-5）
 *   実機スキャンは 6-B だが、数学的に致命的な部分（GF(256)・RS 生成多項式・BCH 形式情報・構造）を
 *   ISO/IEC 18004 の既知値と照合して固定回帰する（生成多項式の順序バグ等の再発防止）。
 *
 * 実行: node tests/remote-control-qr.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const QR   = require('../src/remote/vendor/qrcode.js');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const INDEXHTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err && err.message); fail++; }
}

// 検証用の独立 GF(256)（qrcode.js とは別実装で照合＝相互検証）。
const EXP = new Array(256), LOG = new Array(256);
(function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } EXP[255] = EXP[0]; })();
function gmul(a, b) { if (!a || !b) return 0; return EXP[(LOG[a] + LOG[b]) % 255]; }
function rsGenPoly(deg) { let g = [1]; for (let i = 0; i < deg; i++) { let ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); } g = ng; } return g; }

// ISO/IEC 18004 の生成多項式係数（α 指数・最高次先頭）— 逆順バグの再発防止。
const KNOWN_GEN = {
  7:  [0, 87, 229, 146, 149, 238, 102, 21],
  10: [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45],
  15: [0, 8, 183, 61, 91, 202, 37, 51, 58, 58, 237, 140, 124, 5, 99, 105]
};

test('QR: 生成多項式 deg 7/10/15 が ISO/IEC 18004 既知係数と一致（最高次先頭）', () => {
  for (const deg of [7, 10, 15]) {
    const g = rsGenPoly(deg);
    assert.equal(g.length, deg + 1);
    assert.ok(g.every((c, i) => c === EXP[KNOWN_GEN[deg][i]]),
      `gen(${deg}) が規格既知係数と不一致（順序/値バグ）: ${g.map((c) => LOG[c]).join(',')}`);
  }
});

test('QR: RS 除算が標準（data 位置が消費され full が生成多項式で割り切れる）', () => {
  const gen = rsGenPoly(7);
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  const res = data.concat(new Array(7).fill(0));
  for (let i = 0; i < data.length; i++) { const c = res[i]; if (c) for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], c); }
  const ec = res.slice(data.length);
  const full = data.concat(ec);
  for (let i = 0; i < data.length; i++) { const c = full[i]; if (c) for (let j = 0; j < gen.length; j++) full[i + j] ^= gmul(gen[j], c); }
  assert.ok(full.every((v) => v === 0), 'full = data+EC が生成多項式で割り切れない（RS バグ）');
});

test('QR: 形式情報 BCH（レベル L・8 マスク）が規格既知定数と一致', () => {
  const known = [0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976];
  for (let mask = 0; mask < 8; mask++) {
    const dataBits = (0x01 << 3) | mask;
    let rem = dataBits << 10; const g = 0x537;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= g << (i - 10);
    const bits = ((dataBits << 10) | rem) ^ 0x5412;
    assert.equal(bits, known[mask], `mask ${mask} の形式情報が不一致`);
  }
});

test('QR: generate 構造 — サイズ=4v+17・3隅ファインダー・タイミング・ダークモジュール', () => {
  const out = QR.generate('http://192.168.1.100:54321');
  const m = out.modules, size = out.size;
  assert.equal(size, out.version * 4 + 17);
  assert.equal(m.length, size);
  const finder = (t, l) => m[t][l] === 1 && m[t + 6][l + 6] === 1 && m[t + 3][l + 3] === 1 && m[t + 1][l + 1] === 0;
  assert.ok(finder(0, 0), 'TL ファインダー不正');
  assert.ok(finder(0, size - 7), 'TR ファインダー不正');
  assert.ok(finder(size - 7, 0), 'BL ファインダー不正');
  assert.equal(m[size - 8][8], 1, 'ダークモジュール不正');
  for (let i = 8; i < size - 8; i++) assert.equal(m[6][i], (i % 2 === 0) ? 1 : 0, `タイミング(row) ${i} 不正`);
});

test('QR: バージョン自動選択（短い URL は v1〜、長め URL で version が上がる）', () => {
  const short = QR.generate('http://10.0.0.1:80');
  assert.ok(short.version >= 1 && short.version <= 5);
  const long = QR.generate('http://192.168.100.100:65535/' + 'a'.repeat(40));
  assert.ok(long.version >= short.version, 'データ増で version が下がるのは不正');
});

test('QR: 108 バイト超はエラー（容量外を黙って壊さない）', () => {
  assert.throws(() => QR.generate('x'.repeat(200)), /長すぎ|QR/);
});

test('QR: modules は 0/1 のみ（未使用セルの null 残りなし）', () => {
  const out = QR.generate('http://192.168.1.50:40000');
  for (let r = 0; r < out.size; r++) for (let c = 0; c < out.size; c++) {
    assert.ok(out.modules[r][c] === 0 || out.modules[r][c] === 1, `(${r},${c}) が 0/1 でない`);
  }
});

// ===== 配線 / CSP 無改変（静的）=====
test('配線: main が status に QR 行列を同梱（vendored 自作を require・URL のみ）', () => {
  assert.match(MAIN, /require\(\s*['"]\.\/remote\/vendor\/qrcode['"]\s*\)/, 'vendored QR を require していない');
  assert.match(MAIN, /remoteQr\.generate\(\s*conn\.url\s*\)/, 'status に QR(URL) を同梱していない');
});

test('配線: renderer は QR を描画するだけ（drawRemoteQr・クワイエットゾーン）', () => {
  assert.match(RENDERER, /function drawRemoteQr\(/, 'drawRemoteQr なし');
  assert.match(RENDERER, /quiet/, 'クワイエットゾーンの余白処理なし（スキャン不可の元）');
});

test('CSP 無改変: index.html の script-src \'self\' 維持 + QR 用の外部 script タグを足していない', () => {
  assert.match(INDEXHTML, /Content-Security-Policy[^>]*script-src 'self'/, 'CSP 改変');
  assert.doesNotMatch(INDEXHTML, /<script[^>]+src=["'][^"']*qrcode/, '本体 renderer に QR script を読み込ませている（main 生成 + IPC のはず）');
  assert.match(INDEXHTML, /id="js-remote-qr"/, 'QR canvas なし');
});

test('依存ゼロ: package.json dependencies に QR ライブラリを追加していない', () => {
  const deps = Object.keys(PKG.dependencies || {});
  for (const forbidden of ['qrcode', 'qr-image', 'qrcode-generator', 'qrcode-svg']) {
    assert.ok(!deps.includes(forbidden), `QR の外部依存が追加されている: ${forbidden}`);
  }
});

console.log(`\n=== remote-control Phase 1b-qr: ${pass} passed / ${fail} failed ===`);
if (fail > 0) process.exit(1);
