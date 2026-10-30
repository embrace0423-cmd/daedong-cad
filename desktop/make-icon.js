// 아이콘 만들기 (한 번만): build/icon.svg → build/icon.png(512) + build/icon.ico(16~256)
// Playwright Chromium으로 그린다. node make-icon.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SIZES_BMP = [16, 20, 24, 32, 40, 48, 64];
const svg = fs.readFileSync(path.join(__dirname, 'build', 'icon.svg'), 'utf8');

// 32비트 BMP(DIB) 아이콘 항목: 아래에서 위로 BGRA, 높이는 두 배, 뒤에 AND 마스크
function dib(size, rgba) {
  const maskRow = Math.ceil(size / 32) * 4;
  const buf = Buffer.alloc(40 + size * size * 4 + maskRow * size);
  buf.writeUInt32LE(40, 0); buf.writeInt32LE(size, 4); buf.writeInt32LE(size * 2, 8);
  buf.writeUInt16LE(1, 12); buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  let o = 40;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      buf[o++] = rgba[i + 2]; buf[o++] = rgba[i + 1]; buf[o++] = rgba[i]; buf[o++] = rgba[i + 3];
    }
  }
  return buf; // 마스크는 0(알파로 처리)
}

function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach((e, k) => {
    const p = 6 + 16 * k;
    head[p] = e.size >= 256 ? 0 : e.size; head[p + 1] = e.size >= 256 ? 0 : e.size;
    head.writeUInt16LE(1, p + 4); head.writeUInt16LE(32, p + 6);
    head.writeUInt32LE(e.data.length, p + 8); head.writeUInt32LE(off, p + 12);
    off += e.data.length;
  });
  return Buffer.concat([head].concat(entries.map((e) => e.data)));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<body style="margin:0"></body>');
  async function render(size) {
    return page.evaluate(async ({ svg, size }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, size, size);
      return { rgba: Array.from(g.getImageData(0, 0, size, size).data), png: c.toDataURL('image/png').split(',')[1] };
    }, { svg, size });
  }
  const entries = [];
  for (const s of SIZES_BMP) entries.push({ size: s, data: dib(s, (await render(s)).rgba) });
  const big = await render(256);
  entries.push({ size: 256, data: Buffer.from(big.png, 'base64') });
  fs.writeFileSync(path.join(__dirname, 'build', 'icon.ico'), ico(entries));
  fs.writeFileSync(path.join(__dirname, 'build', 'icon.png'), Buffer.from((await render(512)).png, 'base64'));
  await browser.close();
  console.log('만듦: build/icon.ico (' + entries.map((e) => e.size).join('·') + '), build/icon.png (512)');
})();
