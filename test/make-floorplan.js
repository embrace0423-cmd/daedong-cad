// 밑그림 시험용 아파트 평면도 그림 만들기: node test/make-floorplan.js [출력 PNG]
// 실제 단지 도면이 아닌 가상의 3베이 평면도다. 위쪽 전체 치수 10,800으로 축척을 맞춰 시험한다.
'use strict';
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'test-floorplan.png'));
// 좌표는 mm, y는 아래로 +. 평면 외곽 (0,0)-(10800,8400), 발코니 8400-9900
const VB = { x: -1900, y: -2000, w: 14200, h: 14200 };
const PX = 2400; // 그림 폭(픽셀). 1픽셀 ≈ 5.9mm
const EXT = 240, INT = 140, BAL = 150;
const s = [];
const ln = (x1, y1, x2, y2, w, c) => s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c || '#222'}" stroke-width="${w}" stroke-linecap="square"/>`);
const rect = (x0, y0, x1, y1, w, fill) => s.push(`<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" fill="${fill || 'none'}" stroke="${w ? '#222' : 'none'}" stroke-width="${w || 0}"/>`);
const text = (x, y, t, size, opt) => s.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${(opt && opt.anchor) || 'middle'}" font-weight="${(opt && opt.bold) ? 700 : 400}" fill="${(opt && opt.fill) || '#222'}"${opt && opt.rot ? ` transform="rotate(${opt.rot} ${x} ${y})"` : ''}>${t}</text>`);
// 벽에 구멍 내기 (흰 사각형으로 지움): 가로벽(y 고정) 또는 세로벽(x 고정)
const gapH = (y, x0, x1, th) => rect(x0, y - th / 2 - 10, x1, y + th / 2 + 10, 0, '#fff');
const gapV = (x, y0, y1, th) => rect(x - th / 2 - 10, y0, x + th / 2 + 10, y1, 0, '#fff');
// 문: 경첩 (hx,hy), 문짝 끝 (lx,ly), 호 끝 (ax,ay)
const door = (hx, hy, lx, ly, ax, ay, sweep) => {
  ln(hx, hy, lx, ly, 30);
  const r = Math.hypot(lx - hx, ly - hy);
  s.push(`<path d="M${lx} ${ly} A${r} ${r} 0 0 ${sweep} ${ax} ${ay}" fill="none" stroke="#222" stroke-width="16"/>`);
};
// 창: 벽 두께 안에 세 줄
const winH = (y, x0, x1, th) => { gapH(y, x0, x1, th); [-th / 2, 0, th / 2].forEach((d) => ln(x0, y + d, x1, y + d, d ? 18 : 12)); ln(x0, y - th / 2, x0, y + th / 2, 18); ln(x1, y - th / 2, x1, y + th / 2, 18); };
const winV = (x, y0, y1, th) => { gapV(x, y0, y1, th); [-th / 2, 0, th / 2].forEach((d) => ln(x + d, y0, x + d, y1, d ? 18 : 12)); ln(x - th / 2, y0, x + th / 2, y0, 18); ln(x - th / 2, y1, x + th / 2, y1, 18); };
// 미닫이 창(발코니 쪽): 어긋난 두 짝
const slideH = (y, x0, x1, th) => { gapH(y, x0, x1, th); const m = (x0 + x1) / 2; ln(x0, y - th / 4, m + 150, y - th / 4, 20); ln(m - 150, y + th / 4, x1, y + th / 4, 20); ln(x0, y - th / 2, x0, y + th / 2, 18); ln(x1, y - th / 2, x1, y + th / 2, 18); };
// 치수: 가로(y 높이에 선), 세로(x 위치에 선). 끝은 사선
const tick = (x, y) => ln(x - 90, y + 90, x + 90, y - 90, 16);
const dimH = (xs, y, from) => {
  ln(xs[0] - 150, y, xs[xs.length - 1] + 150, y, 12);
  xs.forEach((x) => { ln(x, from, x, y - 200, 10, '#555'); tick(x, y); });
  for (let i = 0; i + 1 < xs.length; i++) text((xs[i] + xs[i + 1]) / 2, y - 90, (xs[i + 1] - xs[i]).toLocaleString('en-US'), 230);
};
const dimV = (ys, x, from) => {
  ln(x, ys[0] - 150, x, ys[ys.length - 1] + 150, 12);
  ys.forEach((y) => { ln(from, y, x - 200, y, 10, '#555'); tick(x, y); });
  for (let i = 0; i + 1 < ys.length; i++) text(x - 90, (ys[i] + ys[i + 1]) / 2, (ys[i + 1] - ys[i]).toLocaleString('en-US'), 230, { rot: -90 });
};

// ---- 바닥 (방마다 옅은 색) ----
rect(0, 8400, 10800, 9900, 0, '#f4f4f4'); // 발코니
[[4500, 0, 6000, 1800], [7200, 1800, 9000, 3600]].forEach((r) => rect(r[0], r[1], r[2], r[3], 0, '#eef3f7')); // 욕실 타일

// ---- 벽 ----
rect(0, 0, 10800, 8400, EXT); // 외벽
ln(0, 8400, 0, 9900, BAL); ln(10800, 8400, 10800, 9900, BAL); ln(0, 9900, 10800, 9900, BAL); // 발코니 난간벽
[[3000, 0, 3000, 8400], [0, 3600, 3000, 3600], [4500, 0, 4500, 1800], [4500, 1800, 4500, 2600], [4500, 1800, 7200, 1800], [6000, 0, 6000, 1800],
  [7200, 0, 7200, 8400], [7200, 1800, 10800, 1800], [9000, 1800, 9000, 3600], [7200, 3600, 10800, 3600]].forEach((w) => ln(w[0], w[1], w[2], w[3], INT));

// ---- 창 ----
winH(0, 600, 2400, EXT); winH(0, 7800, 10200, EXT); winH(0, 6200, 6800, EXT);
winV(0, 5000, 7000, EXT); winV(10800, 5000, 7000, EXT);
slideH(8400, 400, 2600, EXT); slideH(8400, 3300, 6900, EXT); slideH(8400, 7600, 10400, EXT);
[[300, 3700], [3700, 7100], [7100, 10500]].forEach((r) => winH(9900, r[0], r[1], BAL));

// ---- 문 ----
gapH(0, 3250, 4250, EXT); door(3250, 0, 3250, 1000, 4250, 0, 0); // 현관
gapV(3000, 2500, 3400, INT); door(3000, 3400, 2100, 3400, 3000, 2500, 1); // 침실3
gapV(3000, 3800, 4700, INT); door(3000, 3800, 2100, 3800, 3000, 4700, 0); // 침실2
gapH(1800, 4700, 5500, INT); door(4700, 1800, 4700, 1000, 5500, 1800, 1); // 욕실1
gapH(1800, 6200, 7000, INT); door(6200, 1800, 6200, 1000, 7000, 1800, 1); // 다용도실
gapV(7200, 3800, 4700, INT); door(7200, 3800, 8100, 3800, 7200, 4700, 1); // 안방
gapH(3600, 8100, 8900, INT); door(8900, 3600, 8900, 2800, 8100, 3600, 0); // 욕실2
gapH(3600, 9300, 10200, INT); door(10200, 3600, 10200, 2700, 9300, 3600, 0); // 드레스룸
gapV(7200, 300, 1200, INT); door(7200, 1200, 8100, 1200, 7200, 300, 0); // 알파룸

// ---- 붙박이·설비 ----
rect(4600, 1900, 7100, 2500, 20); rect(5500, 1980, 6200, 2420, 14); // 주방 싱크대·개수대
rect(6650, 1980, 7020, 2420, 14); s.push('<circle cx="6835" cy="2200" r="120" fill="none" stroke="#222" stroke-width="14"/>'); // 가스레인지
rect(4900, 4100, 6500, 5000, 20); [5150, 5750, 6250].forEach((x) => { rect(x - 180, 3800, x + 180, 4060, 12); rect(x - 180, 5040, x + 180, 5300, 12); }); // 식탁·의자
rect(4600, 100, 5900, 700, 20); s.push('<rect x="4700" y="170" width="1100" height="460" rx="180" fill="none" stroke="#222" stroke-width="14"/>'); // 욕조
s.push('<ellipse cx="5700" cy="1350" rx="180" ry="240" fill="none" stroke="#222" stroke-width="16"/>'); rect(5550, 1600, 5850, 1750, 14); // 양변기
s.push('<ellipse cx="4800" cy="1350" rx="180" ry="140" fill="none" stroke="#222" stroke-width="16"/>'); // 세면대
rect(7300, 1900, 8200, 2800, 20); ln(7300, 1900, 8200, 2800, 10); ln(8200, 1900, 7300, 2800, 10); // 샤워
s.push('<ellipse cx="8650" cy="2300" rx="180" ry="240" fill="none" stroke="#222" stroke-width="16"/>'); rect(8500, 1950, 8800, 2080, 14);
s.push('<ellipse cx="7520" cy="3330" rx="200" ry="150" fill="none" stroke="#222" stroke-width="16"/>');
rect(3100, 600, 3400, 1700, 16); ln(3000, 1500, 4500, 1500, 12, '#555'); // 신발장·현관 단차
s.push('<line x1="9100" y1="2100" x2="10700" y2="2100" stroke="#555" stroke-width="12" stroke-dasharray="120 80"/>');
s.push('<line x1="9100" y1="3300" x2="10700" y2="3300" stroke="#555" stroke-width="12" stroke-dasharray="120 80"/>');
rect(100, 3700, 700, 5400, 16); rect(10100, 3700, 10700, 5600, 16); // 붙박이장

// ---- 방 이름 ----
const room = (x, y, name, size) => { text(x, y, name, 340, { bold: true }); if (size) text(x, y + 380, size, 220, { fill: '#555' }); };
room(1500, 1900, '침실3', '3.0 × 3.6'); room(3750, 2350, '현관', ''); text(5250, 940, '욕실1', 220, { bold: true });
text(6600, 650, '다용도', 220, { bold: true }); room(5850, 3250, '주방·식당', ''); room(9000, 900, '알파룸', '3.6 × 1.8');
text(7750, 3070, '욕실2', 220, { bold: true }); text(9900, 2480, '드레스룸', 220, { bold: true });
room(1500, 6100, '침실2', '3.0 × 4.8'); room(5100, 6600, '거실', '4.2 × 4.8'); room(9000, 6100, '침실1 (안방)', '3.6 × 4.8');
room(5400, 9250, '발코니', '');

// ---- 치수 ----
dimH([0, 3000, 4500, 6000, 7200, 10800], -650, -150);
dimH([0, 10800], -1350, -800);
dimV([0, 3600, 8400, 9900], -650, -150);
dimV([0, 9900], -1350, -800);
dimV([0, 1800, 3600, 8400], 11400, 10950);

// ---- 방위표 ----
s.push('<g transform="translate(11500 -1300)"><circle r="380" fill="none" stroke="#222" stroke-width="18"/><path d="M0 -330 L150 250 L0 140 L-150 250 Z" fill="#222"/></g>');
text(11500, -1760, 'N', 240, { bold: true });

// ---- 표제 ----
text(0, 10650, '시험용 아파트 평면도 (가상)', 420, { anchor: 'start', bold: true });
text(0, 11150, '3베이 · 외곽 10,800 × 8,400 mm (발코니 1,500 별도) · 치수 단위 mm · 대동 CAD 밑그림 시험용', 240, { anchor: 'start', fill: '#333' });
text(0, 11550, '축척 맞추기: 위쪽 전체 치수 10,800의 양 끝(사선 표시)을 찍고 10800을 입력하세요. 실제 단지의 도면이 아닙니다.', 220, { anchor: 'start', fill: '#a33' });
// 축척 막대 0-1-2-3m
[0, 1, 2].forEach((i) => rect(8300 + i * 1000, 10300, 9300 + i * 1000, 10450, 14, i % 2 ? '#fff' : '#222'));
[0, 1, 2, 3].forEach((i) => text(8300 + i * 1000, 10720, i + (i === 3 ? 'm' : ''), 200));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PX}" height="${Math.round(PX * VB.h / VB.w)}" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" font-family="Malgun Gothic, Noto Sans KR, WenQuanYi Zen Hei, sans-serif"><rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="#fff"/>${s.join('')}</svg>`;

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: PX, height: Math.round(PX * VB.h / VB.w) } });
  await page.setContent('<html><body style="margin:0">' + svg + '</body></html>');
  await page.locator('svg').screenshot({ path: out });
  await browser.close();
  // 시험에서 쓰도록 그림 좌표(픽셀)와 도면 좌표(mm)의 관계를 알려 준다
  const k = PX / VB.w;
  console.log('만듦: ' + path.relative(process.cwd(), out) + ' (' + PX + '×' + Math.round(PX * VB.h / VB.w) + ' 픽셀, 1픽셀 = ' + (1 / k).toFixed(3) + 'mm)');
  console.log('전체 치수 10,800 양 끝 픽셀: (' + ((0 - VB.x) * k).toFixed(1) + ', ' + ((-1350 - VB.y) * k).toFixed(1) + ') – (' + ((10800 - VB.x) * k).toFixed(1) + ', ' + ((-1350 - VB.y) * k).toFixed(1) + ')');
})();
