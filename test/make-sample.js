// 예시 도면(리모델링 평면도)과 화면 캡처 만들기: node test/make-sample.js
'use strict';
const path = require('path');
const fs = require('fs');
['aci', 'geom', 'model', 'hatch', 'dxf-write', 'dxf-read', 'svg', 'library', 'commands'].forEach((f) => require(path.join(__dirname, '..', 'js', f + '.js')));
const { G, Model, Commands: Cmd, Library: Lib, DXF } = globalThis.DCAD;

const doc = Lib.newFromTemplate('remodel', { title: '리모델링 평면도 (예시)', date: '2026-10-29' });
doc.name = '리모델링 평면도 (예시)';
const add = (layer, type, props) => { const e = Model.mk(doc, type, props); e.layer = layer; doc.ents.push(e); return e; };
const wall = (pts, t, closed, layer) => {
  if (closed) {
    add(layer, 'poly', { pts: Cmd.offsetPts(pts, t / 2, true), closed: true });
    add(layer, 'poly', { pts: Cmd.offsetPts(pts, -t / 2, true), closed: true });
  } else {
    add(layer, 'poly', { pts: Cmd.offsetPts(pts, t / 2, false).concat(Cmd.offsetPts(pts, -t / 2, false).reverse()), closed: true });
  }
};
const sym = (layer, name, x, y, rot, sx) => { Lib.ensureBlock(doc, name); return add(layer, 'insert', { name, p: G.v(x, y), sx: sx || 1, sy: 1, rot: G.rad(rot || 0) }); };
const txt = (layer, x, y, h, s) => add(layer, 'text', { p: G.v(x, y), h, s, rot: 0, align: 'C', valign: 'M' });

// 바깥벽 200, 가운데 칸막이 100(신설), 철거할 옛 벽은 파선
wall([G.v(3000, 4000), G.v(11500, 4000), G.v(11500, 11000), G.v(3000, 11000)], 200, true, '벽체');
wall([G.v(7600, 4100), G.v(7600, 10900)], 100, false, '신설벽');
add('철거', 'poly', { pts: [G.v(5600, 7900), G.v(7550, 7900), G.v(7550, 8050), G.v(5600, 8050)], closed: true });
// 해치: 기존 벽은 사선, 새 칸막이는 단색 (다른 객체 뒤에)
const walls = doc.ents.filter((e) => e.type === 'poly' && e.layer === '벽체');
const hatchOf = (layer, loops, pat) => { const k = doc.settings.scale; const e = Model.mk(doc, 'hatch', { loops, solid: pat === 'SOLID', pat, scale: k, ang: 0, fams: globalThis.DCAD.Hatch.families(pat, k, 0) }); e.layer = layer; doc.ents.unshift(e); };
hatchOf('벽체', walls.map((w) => w.pts.map((p) => ({ x: p.x, y: p.y }))), 'LINE45');
hatchOf('신설벽', [doc.ents.find((e) => e.layer === '신설벽').pts.map((p) => ({ x: p.x, y: p.y }))], 'SOLID');
// 문·창
sym('문창', 'DOOR_900', 7650, 6000, 90);
sym('문창', 'DOOR_900', 3100, 10400, -90);
sym('문창', 'WINDOW_2400', 4000, 3900);
sym('문창', 'WINDOW_1800', 8800, 3900);
sym('문창', 'WINDOW_1800', 11400, 7000, 90);
// 가구
sym('가구', 'SOFA_3', 3600, 4700);
sym('가구', 'TV_STAND', 4300, 10350);
sym('가구', 'TABLE_4', 3500, 7700);
sym('가구', 'BED_QUEEN', 8300, 8800);
sym('가구', 'WARDROBE', 11400, 5600, 90);
sym('가구', 'DESK', 8000, 4400);
// 실 이름과 넓이
txt('문자', 5900, 6900, 250, '거실·주방');
txt('문자', 9500, 6500, 250, '침실');
const room = (x0, y0, x1, y1) => (x1 - x0) * (y1 - y0) / 1e6;
txt('문자', 5900, 6500, 160, G.fmt(room(3100, 4100, 7550, 10900), 1) + '㎡ (' + G.fmt(room(3100, 4100, 7550, 10900) / 3.305785, 1) + '평)');
txt('문자', 9500, 6100, 160, G.fmt(room(7650, 4100, 11400, 10900), 1) + '㎡ (' + G.fmt(room(7650, 4100, 11400, 10900) / 3.305785, 1) + '평)');
txt('문자', 6575, 8350, 120, '철거 (파선)');
// 치수
add('치수', 'dim', { kind: 'lin', p1: G.v(2900, 11100), p2: G.v(11600, 11100), loc: G.v(0, 12000), ang: 0 });
add('치수', 'dim', { kind: 'lin', p1: G.v(2900, 11100), p2: G.v(7600, 11100), loc: G.v(0, 11600), ang: 0 });
add('치수', 'dim', { kind: 'lin', p1: G.v(7600, 11100), p2: G.v(11600, 11100), loc: G.v(0, 11600), ang: 0 });
add('치수', 'dim', { kind: 'lin', p1: G.v(11600, 3900), p2: G.v(11600, 11100), loc: G.v(12500, 0), ang: Math.PI / 2 });
// 방위표
sym('문자', 'NORTH', 14000, 11500, 0, 50).sy = 50;
Model.touch();

const docsDir = path.join(__dirname, '..', 'docs');
fs.writeFileSync(path.join(docsDir, 'sample-remodel.dcad.json'), JSON.stringify(doc));
fs.writeFileSync(path.join(docsDir, 'sample-remodel.dxf'), DXF.write(doc));
console.log('예시 도면: 개체', doc.ents.length);

let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }
(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForSelector('#dlg-new[open]');
  await page.click('#dlg-new [data-close]');
  await page.evaluate((json) => {
    const d = JSON.parse(json);
    DCAD.App.Engine.cancel(true);
    DCAD.App.doc = d; DCAD.Model.touch();
    DCAD.App.R.fit({ x0: 1000, y0: 2500, x1: 15500, y1: 13000 });
    document.querySelector('[data-tab=lib]').click();
  }, JSON.stringify(doc));
  await page.fill('#cmd', 'DLI'); await page.press('#cmd', 'Enter');
  const s = await page.evaluate(() => { const r = DCAD.App.R.toScreen({ x: 7600, y: 4100 }); const b = document.getElementById('cv').getBoundingClientRect(); return { x: r.x + b.left + 3, y: r.y + b.top - 2 }; });
  await page.mouse.move(s.x, s.y);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(docsDir, 'screenshot.png') });
  await browser.close();
  console.log('화면 캡처: docs/screenshot.png');
})();
