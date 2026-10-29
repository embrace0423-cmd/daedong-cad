// 기호 목록 그림 만들기: node test/symbol-sheet.js <출력 PNG>
'use strict';
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }
(async () => {
  const out = path.resolve(process.argv[2] || 'symbols.png');
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForSelector('#dlg-new[open]');
  const h = await page.evaluate(() => {
    document.body.innerHTML = '';
    document.body.style.cssText = 'display:block;overflow:visible;background:#fff;color:#222;padding:12px;font:12px "Noto Sans KR",sans-serif';
    const { Library: Lib, Model, Renderer, G } = DCAD;
    let cat = '';
    const grid = () => { const d = document.createElement('div'); d.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:8px;margin-bottom:10px'; document.body.appendChild(d); return d; };
    let cur;
    Lib.SYMBOLS.forEach((s) => {
      if (s.cat !== cat) { cat = s.cat; const t = document.createElement('h3'); t.textContent = cat; t.style.margin = '8px 0 4px'; document.body.appendChild(t); cur = grid(); }
      const cell = document.createElement('div'); cell.style.cssText = 'border:1px solid #ddd;border-radius:6px;padding:4px;text-align:center';
      const c = document.createElement('canvas'); c.width = 260; c.height = 200; c.style.width = '130px'; c.style.height = '100px';
      cell.appendChild(c);
      const l = document.createElement('div'); l.textContent = s.label.indexOf(s.size) < 0 ? s.label + ' · ' + s.size : s.label; cell.appendChild(l);
      cur.appendChild(cell);
      const doc = Model.newDoc();
      Lib.ensureBlock(doc, s.name);
      const ins = Model.mk(doc, 'insert', { name: s.name, p: G.v(0, 0), sx: 1, sy: 1, rot: 0 });
      doc.ents.push(ins);
      const r = new Renderer(c); r.w = c.width; r.h = c.height; r.dpr = 1; r.dark = false;
      r.fit(Model.extents(doc), 0.08);
      const ctx = c.getContext('2d'); r.worldTransform(ctx);
      r.drawEnt(ctx, doc, ins, null, { color: '#1b2a4a', width: 1.4, keepLtype: true }, 1);
    });
    return document.body.scrollHeight;
  });
  await page.setViewportSize({ width: 1200, height: h + 20 });
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log('ok', out);
})();
