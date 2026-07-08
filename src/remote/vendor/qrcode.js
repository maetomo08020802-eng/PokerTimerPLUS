'use strict';
/*!
 * qrcode.js — 依存ゼロの自作 QR コード生成器（remote-control Phase 1b-qr）
 *
 * PokerTimerPLUS+ 用に本プロジェクトで書き下ろした自己完結・単一ファイル実装。
 * 第三者ライブラリのコピーではない（オフラインで検証済み MIT ライブラリの全文を確実に同梱する
 * 手段がないため、依存ゼロ・ライセンス問題ゼロの自作実装を採用）。追加 npm 依存なし。
 * node（テスト）とブラウザ（設定画面の canvas 描画）の双方で動く（UMD 風）。
 *
 * 対応範囲（接続 URL＝短い ASCII を QR 化する用途に限定して単純化・低リスク化）:
 *   - バイトモードのみ / 誤り訂正レベル L / バージョン 1〜5（いずれも単一ブロック＝ブロック分割・
 *     インターリーブ不要）。データ最大 108 バイト（URL には十分）。
 *   - 8 マスクをペナルティ評価して最良を選択・フォーマット情報（BCH）を配置。
 * 仕様: ISO/IEC 18004。GF(256) 原始多項式 0x11d。
 *
 * API: QRCode.generate(text) -> { size: number, modules: number[][] }（1=暗, 0=明）。
 *   収まらない（>108 バイト）場合は Error を投げる。
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.QRCode = mod;
})(typeof self !== 'undefined' ? self : this, function () {

  // ---- GF(256) 指数 / 対数テーブル（原始元 2・原始多項式 0x11d）----
  var EXP = new Array(256), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    EXP[255] = EXP[0];
  })();
  function gmul(a, b) { if (a === 0 || b === 0) return 0; return EXP[(LOG[a] + LOG[b]) % 255]; }

  // 誤り訂正用の生成多項式（次数 = EC コードワード数）。係数は整数表現・【最高次先頭】。
  //   g = Π(x − α^i)。g[0] が最高次（x^degree の係数=1）、g[degree] が定数項。
  //   規格 ISO/IEC 18004 の生成多項式係数（例: deg7 = α^0..α^21）と一致する順序。
  function rsGenPoly(degree) {
    var g = [1];
    for (var i = 0; i < degree; i++) {
      var ng = new Array(g.length + 1);
      for (var k = 0; k < ng.length; k++) ng[k] = 0;
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= g[j];                 // x · g（最高次側へ）
        ng[j + 1] ^= gmul(g[j], EXP[i]); // α^i · g（低次側へ）
      }
      g = ng;
    }
    return g; // 長さ degree+1・最高次先頭（g[0]=1）
  }

  // データコードワード列から EC コードワードを計算（多項式除算の剰余）。
  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = data.slice().concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
    }
    return res.slice(data.length); // 末尾 ecLen 個が EC
  }

  // バージョン 1〜5・レベル L（全て単一ブロック）: { totalDataCodewords, ecCodewords }。
  var LEVEL_L = {
    1: { data: 19,  ec: 7 },
    2: { data: 34,  ec: 10 },
    3: { data: 55,  ec: 15 },
    4: { data: 80,  ec: 20 },
    5: { data: 108, ec: 26 }
  };
  // 各バージョンのアライメントパターン中心座標（V1 は無し）。V2〜5 は中心 1 個 (p,p)。
  var ALIGN_CENTER = { 2: 18, 3: 22, 4: 26, 5: 30 };

  function sizeOf(version) { return version * 4 + 17; }

  // ---- ビットバッファ ----
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  // テキスト → データコードワード列（バイトモード・レベル L・バージョン自動）。
  function encodeData(text) {
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else { // UTF-8（URL は基本 ASCII だが保険）
        if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
        else { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
      }
    }
    // 収まる最小バージョンを選ぶ
    var version = 0;
    for (var v = 1; v <= 5; v++) {
      // モード(4) + 文字数(8) + データ(8×n) + 終端(4) ≤ data×8
      if (4 + 8 + bytes.length * 8 + 4 <= LEVEL_L[v].data * 8) { version = v; break; }
    }
    if (!version) throw new Error('QR: データが長すぎます（URL が想定より長い）');

    var buf = new BitBuffer();
    buf.put(0x4, 4);                 // バイトモード
    buf.put(bytes.length, 8);        // 文字数（V1〜9 は 8bit）
    for (var b = 0; b < bytes.length; b++) buf.put(bytes[b], 8);
    var cap = LEVEL_L[version].data * 8;
    // 終端 0000（最大 4bit）
    for (var t = 0; t < 4 && buf.bits.length < cap; t++) buf.bits.push(0);
    // バイト境界まで 0 詰め
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);
    // データコードワードへ
    var codewords = [];
    for (var p = 0; p < buf.bits.length; p += 8) {
      var byte = 0;
      for (var q = 0; q < 8; q++) byte = (byte << 1) | buf.bits[p + q];
      codewords.push(byte);
    }
    // パッドバイト 0xEC / 0x11 交互
    var pad = [0xec, 0x11], pi = 0;
    while (codewords.length < LEVEL_L[version].data) { codewords.push(pad[pi & 1]); pi++; }

    var ec = rsEncode(codewords, LEVEL_L[version].ec);
    return { version: version, codewords: codewords.concat(ec) };
  }

  // ---- モジュール配置 ----
  function makeMatrix(size) {
    var m = new Array(size), r = new Array(size);
    for (var i = 0; i < size; i++) { m[i] = new Array(size).fill(null); r[i] = new Array(size).fill(false); }
    return { m: m, reserved: r, size: size };
  }
  function placeFinder(mx, top, left) {
    for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
      var rr = top + r, cc = left + c;
      if (rr < 0 || cc < 0 || rr >= mx.size || cc >= mx.size) continue;
      var inner = (r >= 0 && r <= 6 && c >= 0 && c <= 6) &&
        (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      mx.m[rr][cc] = inner ? 1 : 0;
      mx.reserved[rr][cc] = true;
    }
  }
  function placeAlignment(mx, version) {
    var center = ALIGN_CENTER[version];
    if (!center) return;
    for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++) {
      var rr = center + r, cc = center + c;
      var on = (Math.max(Math.abs(r), Math.abs(c)) !== 1); // 外枠 + 中心
      mx.m[rr][cc] = on ? 1 : 0;
      mx.reserved[rr][cc] = true;
    }
  }
  function placeTiming(mx) {
    for (var i = 8; i < mx.size - 8; i++) {
      var v = (i % 2 === 0) ? 1 : 0;
      if (mx.m[6][i] === null) { mx.m[6][i] = v; mx.reserved[6][i] = true; }
      if (mx.m[i][6] === null) { mx.m[i][6] = v; mx.reserved[i][6] = true; }
    }
  }
  function reserveFormat(mx) {
    var size = mx.size;
    for (var i = 0; i <= 8; i++) {
      if (i !== 6) { mx.reserved[8][i] = true; mx.reserved[i][8] = true; }
    }
    for (var j = 0; j < 8; j++) { mx.reserved[8][size - 1 - j] = true; mx.reserved[size - 1 - j][8] = true; }
    // ダークモジュール
    mx.m[size - 8][8] = 1; mx.reserved[size - 8][8] = true;
  }

  // フォーマット情報（レベル L=01 + マスク 3bit）の 15bit（BCH）を配置。
  function placeFormat(mx, mask) {
    var data = (0x01 << 3) | mask; // L=01
    var rem = data << 10;
    var g = 0x537;
    for (var i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= g << (i - 10);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var size = mx.size;
    for (var k = 0; k <= 14; k++) {
      var bit = (bits >> k) & 1;
      // 左上 + 縦
      if (k < 6) mx.m[k][8] = bit;
      else if (k === 6) mx.m[7][8] = bit;
      else if (k === 7) mx.m[8][8] = bit;
      else if (k === 8) mx.m[8][7] = bit;
      else mx.m[8][14 - k] = bit;
      // 右上 / 左下（冗長コピー）
      if (k < 8) mx.m[8][size - 1 - k] = bit;
      else mx.m[size - 15 + k][8] = bit;
    }
  }

  function maskFn(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
    return false;
  }

  // データビットをジグザグ配置（マスク適用）。
  function placeData(mx, bits, mask) {
    var size = mx.size, idx = 0, dir = -1, row = size - 1;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // タイミング列をスキップ
      for (;;) {
        for (var i = 0; i < 2; i++) {
          var c = col - i;
          if (!mx.reserved[row][c] && mx.m[row][c] === null) {
            var bit = (idx < bits.length) ? bits[idx++] : 0;
            if (maskFn(mask, row, c)) bit ^= 1;
            mx.m[row][c] = bit;
          }
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
    }
  }

  function penalty(mx) {
    var size = mx.size, score = 0, r, c, i;
    // 規則1: 同色連続（行・列）
    for (r = 0; r < size; r++) {
      var runC = 1;
      for (c = 1; c < size; c++) {
        if (mx.m[r][c] === mx.m[r][c - 1]) { runC++; if (runC === 5) score += 3; else if (runC > 5) score++; }
        else runC = 1;
      }
    }
    for (c = 0; c < size; c++) {
      var runR = 1;
      for (r = 1; r < size; r++) {
        if (mx.m[r][c] === mx.m[r - 1][c]) { runR++; if (runR === 5) score += 3; else if (runR > 5) score++; }
        else runR = 1;
      }
    }
    // 規則2: 2×2 同色ブロック
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
      var v = mx.m[r][c];
      if (v === mx.m[r][c + 1] && v === mx.m[r + 1][c] && v === mx.m[r + 1][c + 1]) score += 3;
    }
    // 規則3: 1:1:3:1:1 パターン
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function match(get, len, idx2) {
      for (r = 0; r < len; r++) for (c = 0; c < len - 10; c++) {
        var ok1 = true, ok2 = true;
        for (i = 0; i < 11; i++) { var val = get(r, c + i); if (val !== pat1[i]) ok1 = false; if (val !== pat2[i]) ok2 = false; }
        if (ok1 || ok2) score += 40;
      }
    }
    match(function (a, b) { return mx.m[a][b]; }, size);
    match(function (a, b) { return mx.m[b][a]; }, size);
    // 規則4: 暗モジュール比率
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (mx.m[r][c]) dark++;
    var ratio = dark * 100 / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  function generate(text) {
    var enc = encodeData(String(text == null ? '' : text));
    var version = enc.version, size = sizeOf(version);
    // 全コードワードをビット列へ
    var bits = [];
    for (var i = 0; i < enc.codewords.length; i++) for (var b = 7; b >= 0; b--) bits.push((enc.codewords[i] >> b) & 1);

    // 8 マスクを試し最良を選ぶ
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var mask = 0; mask < 8; mask++) {
      var mx = makeMatrix(size);
      placeFinder(mx, 0, 0); placeFinder(mx, 0, size - 7); placeFinder(mx, size - 7, 0);
      placeAlignment(mx, version);
      placeTiming(mx);
      reserveFormat(mx);
      placeData(mx, bits, mask);
      placeFormat(mx, mask);
      var s = penalty(mx);
      if (s < bestScore) { bestScore = s; best = mx; bestMask = mask; }
    }
    // null 残（未使用モジュール）を 0 に
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) if (best.m[r][c] === null) best.m[r][c] = 0;
    return { size: size, version: version, mask: bestMask, modules: best.m };
  }

  return { generate: generate };
});
