// STEP 9-A: build/icon-source.svg から build/icon.png（512x512）+ build/icon.ico（マルチサイズ）を生成
// SVG は viewBox 512x512 で作成済み（中立デザイン: 深紺 + 金色 + 中央 P）
// 出力:
//   - build/icon.png  : 512x512 PNG（electron-builder の win.icon / mac.icon 用）
//   - build/icon.ico  : 16/24/32/48/64/128/256 マルチサイズ ICO（NSIS インストーラ用）
//
// 実行: node build/generate-icon.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const SOURCE = path.join(__dirname, 'icon-source.svg');
const DST_PNG = path.join(__dirname, 'icon.png');
const DST_ICO = path.join(__dirname, 'icon.ico');
const TARGET = 512;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`source SVG not found: ${SOURCE}`);
  }
  console.log(`[icon] source: ${SOURCE}`);

  // SVG → 512x512 PNG（透明背景、SVG の viewBox を尊重）
  // density を上げてアンチエイリアスを綺麗に
  await sharp(SOURCE, { density: 384 })
    .resize(TARGET, TARGET, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(DST_PNG);
  const outMeta = await sharp(DST_PNG).metadata();
  console.log(`[icon] done: ${DST_PNG} (${outMeta.width}x${outMeta.height}, ${outMeta.format})`);

  // マルチサイズ ICO（小さいサイズも別 density で個別レンダリングして潰れ防止）
  const icoBuffers = await Promise.all(
    ICO_SIZES.map((s) =>
      sharp(SOURCE, { density: Math.max(96, s * 1.5) })
        .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );
  const icoBuffer = await pngToIco(icoBuffers);
  fs.writeFileSync(DST_ICO, icoBuffer);
  console.log(`[icon] done: ${DST_ICO} (multi-size: ${ICO_SIZES.join('/')}, ${icoBuffer.length} bytes)`);
}

main().catch((err) => {
  console.error('[icon] failed:', err);
  process.exit(1);
});
