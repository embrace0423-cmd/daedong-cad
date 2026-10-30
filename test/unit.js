// 단위 시험 (브라우저 없이): node --test test/unit.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

['aci', 'geom', 'model', 'hatch', 'region', 'dxf-write', 'dxf-read', 'svg', 'library', 'commands'].forEach((f) => require(path.join(__dirname, '..', 'js', f + '.js')));
const D = globalThis.DCAD;
const { G, Model, Commands: Cmd, Library: Lib, DXF } = D;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const nearPt = (p, q, eps = 1e-6) => { near(p.x, q.x, eps); near(p.y, q.y, eps); };

test('기하: 교점·세 점 호·볼록값', () => {
  const x = G.lineLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
  nearPt(x.pt, { x: 5, y: 0 });
  const a = G.arc3({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 });
  nearPt(a.c, { x: 0, y: 0 }); near(a.r, 10); near(a.a0, 0); near(G.normAng(a.a1), Math.PI);
  const b = G.bulgeArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1); // 반원, 반시계 → 중심 (5,0), 아래로 볼록
  nearPt(b.c, { x: 5, y: 0 }); near(b.r, 5);
  const cc = G.circleCircle({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5);
  assert.equal(cc.length, 2); near(cc[0].x, 4); near(Math.abs(cc[0].y), 3);
});

test('행렬: 대칭·회전·역행렬', () => {
  const m = G.M.mirror({ x: 0, y: 0 }, { x: 0, y: 1 });
  nearPt(G.M.apply(m, { x: 3, y: 2 }), { x: -3, y: 2 });
  assert.ok(G.M.det(m) < 0);
  const r = G.M.rot(Math.PI / 2, { x: 1, y: 1 });
  nearPt(G.M.apply(r, { x: 2, y: 1 }), { x: 1, y: 2 });
  const inv = G.M.inv(r);
  nearPt(G.M.apply(inv, G.M.apply(r, { x: 7, y: -3 })), { x: 7, y: -3 });
});

test('입력: 좌표 형식과 숫자식', () => {
  nearPt(Cmd.parsePoint('1200,800'), { x: 1200, y: 800 });
  nearPt(Cmd.parsePoint('@100,-50', { x: 10, y: 10 }), { x: 110, y: -40 });
  nearPt(Cmd.parsePoint('@1000<90', { x: 0, y: 0 }), { x: 0, y: 1000 });
  nearPt(Cmd.parsePoint('500', { x: 0, y: 0 }, { x: 0, y: 30 }), { x: 0, y: 500 }); // 커서 방향 거리
  nearPt(Cmd.parsePoint('500', { x: 0, y: 0 }, { x: 40, y: 30 }, true), { x: 500, y: 0 }); // 직교
  near(Cmd.evalNum('3000/2+(100-50)*2'), 1600);
  assert.ok(Number.isNaN(Cmd.evalNum('alert(1)')));
  assert.equal(Cmd.parsePoint('abc', { x: 0, y: 0 }), null);
});

test('오프셋·넓이(볼록 포함)', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const out = Cmd.offsetPts(sq, -10, true); // 반시계 사각형의 오른쪽(바깥)
  nearPt(out[0], { x: -10, y: -10 }); nearPt(out[2], { x: 110, y: 110 });
  const inner = Cmd.offsetPts(sq, 10, true);
  near(Math.abs(G.polyArea(inner)), 80 * 80);
  // 볼록값 1인 두 구간 = 지름 20인 원
  const circ = [{ x: 0, y: 0, bulge: 1 }, { x: 20, y: 0, bulge: 1 }];
  near(Math.abs(Cmd.polyAreaBulge(circ, true)), Math.PI * 100, 1e-9);
});

test('자르기: 선·원·폴리선', () => {
  const doc = Model.newDoc();
  const ln = Model.mk(doc, 'line', { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
  let r = Cmd.trimEntity(ln, { x: 50, y: 0 }, [{ x: 30, y: 0 }, { x: 70, y: 0 }], doc);
  assert.equal(r.length, 2); near(r[0].b.x, 30); near(r[1].a.x, 70);
  r = Cmd.trimEntity(ln, { x: 90, y: 0 }, [{ x: 30, y: 0 }, { x: 70, y: 0 }], doc);
  assert.equal(r.length, 1); near(r[0].a.x, 0); near(r[0].b.x, 70);
  const c = Model.mk(doc, 'circle', { c: { x: 0, y: 0 }, r: 10 });
  r = Cmd.trimEntity(c, { x: 10, y: 0 }, [{ x: 0, y: 10 }, { x: 0, y: -10 }], doc); // 오른쪽 반원 지움
  assert.equal(r.length, 1); near(G.normAng(r[0].a0), Math.PI / 2); near(G.normAng(r[0].a1), Math.PI * 1.5);
  const pl = Model.mk(doc, 'poly', { pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], closed: false });
  r = Cmd.trimEntity(pl, { x: 50, y: 0 }, [{ x: 40, y: 0 }, { x: 60, y: 0 }], doc);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].pts.map((p) => [p.x, p.y]), [[0, 0], [40, 0]]);
  assert.deepEqual(r[1].pts.map((p) => [p.x, p.y]), [[60, 0], [100, 0], [100, 100]]);
});

test('변환: 호·블록 대칭, 문자는 읽을 수 있게', () => {
  const doc = Model.newDoc();
  const arc = Model.mk(doc, 'arc', { c: { x: 0, y: 0 }, r: 10, a0: 0, a1: Math.PI / 2 });
  Model.transform(arc, G.M.mirror({ x: 0, y: 0 }, { x: 0, y: 1 }));
  near(G.normAng(arc.a0), Math.PI / 2); near(G.normAng(arc.a1), Math.PI);
  const ins = Model.mk(doc, 'insert', { name: 'X', p: { x: 5, y: 0 }, sx: 1, sy: 1, rot: 0 });
  Model.transform(ins, G.M.mirror({ x: 0, y: 0 }, { x: 0, y: 1 }));
  nearPt(ins.p, { x: -5, y: 0 }); near(ins.sx * ins.sy, -1);
  const t = Model.mk(doc, 'text', { p: { x: 5, y: 0 }, h: 2, rot: 0, s: '가' });
  Model.transform(t, G.M.mirror({ x: 0, y: 0 }, { x: 0, y: 1 }));
  near(G.normAng(t.rot), 0);
});

test('치수 값', () => {
  const doc = Model.newDoc();
  const d = Model.mk(doc, 'dim', { kind: 'lin', p1: { x: 0, y: 0 }, p2: { x: 3000, y: 400 }, loc: { x: 0, y: -500 }, ang: 0 });
  near(Model.dimGeom(d, doc).value, 3000);
  d.ang = Math.atan2(400, 3000);
  near(Model.dimGeom(d, doc).value, Math.hypot(3000, 400));
  const r = Model.mk(doc, 'dim', { kind: 'dia', c: { x: 0, y: 0 }, p: { x: 25, y: 0 } });
  assert.equal(Model.dimGeom(r, doc).text.s, 'Ø50');
});

function sampleDoc() {
  const doc = Lib.newFromTemplate('remodel', { date: '2026-10-29' });
  const add = (t, p) => { const e = Model.mk(doc, t, p); doc.ents.push(e); return e; };
  doc.currentLayer = '벽체';
  add('line', { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } });
  add('poly', { pts: [{ x: 0, y: 0 }, { x: 3000, y: 0, bulge: 0.4142 }, { x: 3000, y: 2000 }, { x: 0, y: 2000 }], closed: true });
  add('circle', { c: { x: 500, y: 500 }, r: 120 });
  add('arc', { c: { x: 500, y: 500 }, r: 300, a0: 0.3, a1: 2.1 });
  add('ellipse', { c: { x: 4000, y: 500 }, major: { x: 400, y: 0 }, ratio: 0.5 });
  add('text', { p: { x: 10, y: 10 }, h: 150, rot: 0.5, s: '거실 Ø50 ±0.5 30°', align: 'C', valign: 'M' });
  add('mtext', { p: { x: 10, y: -500 }, h: 100, s: '첫 줄\n둘째 줄', attach: 1 });
  add('dim', { kind: 'lin', p1: { x: 0, y: 0 }, p2: { x: 3000, y: 0 }, loc: { x: 0, y: -800 }, ang: 0 });
  Lib.ensureBlock(doc, 'BED_QUEEN');
  add('insert', { name: 'BED_QUEEN', p: { x: 6000, y: 0 }, sx: -1, sy: 1, rot: Math.PI / 2 });
  Model.layerOf(doc, '철거').visible = false;
  Model.layerOf(doc, '전기').locked = true;
  Model.touch();
  return doc;
}

test('DXF: 쓰고 다시 읽기 (R12, 한글)', () => {
  const doc = sampleDoc();
  const txt = DXF.write(doc);
  assert.ok(/^[\x00-\x7f]*$/.test(txt), 'DXF 파일은 ASCII만');
  const back = DXF.read(txt);
  const d2 = back.doc;
  assert.deepEqual(back.report.skipped, {});
  assert.ok(Model.layerOf(d2, '벽체') && Model.layerOf(d2, '중심선').ltype === 'CENTER');
  assert.equal(Model.layerOf(d2, '철거').visible, false);
  assert.equal(Model.layerOf(d2, '전기').locked, true);
  const texts = d2.ents.filter((e) => e.type === 'text').map((e) => e.s);
  assert.ok(texts.includes('거실 Ø50 ±0.5 30°'), '특수 기호 왕복');
  assert.ok(texts.includes('첫 줄') && texts.includes('둘째 줄'), '여러 줄 문자 → 줄마다 문자');
  assert.ok(texts.includes('3000'), '치수 문자');
  const ins = d2.ents.find((e) => e.type === 'insert');
  assert.equal(ins.name, 'BED_QUEEN'); near(ins.sx, -1); near(ins.rot, Math.PI / 2);
  // 범위가 같아야 한다 (치수·문자 근사 차이를 위해 여유)
  const e1 = Model.extents(doc), e2 = Model.extents(d2);
  ['x0', 'y0', 'x1', 'y1'].forEach((k) => near(e1[k], e2[k], 5));
  const poly = d2.ents.find((e) => e.type === 'poly' && e.pts.some((p) => p.bulge));
  near(poly.pts[1].bulge, 0.4142);
});

test('DXF: 다른 프로그램(ezdxf)이 만든 파일 읽기', () => {
  const dir = path.join(__dirname, 'fixtures');
  for (const f of ['rich-r12-cp949.dxf', 'rich-r2000-cp949.dxf', 'rich-r2018-utf8.dxf']) {
    const r = DXF.read(new Uint8Array(fs.readFileSync(path.join(dir, f))));
    const texts = r.doc.ents.filter((e) => e.type === 'text').map((e) => e.s);
    assert.ok(texts.includes('한글 문자 Ø20'), f + ' 한글');
    assert.ok(texts.includes('의자1'), f + ' 블록 속성');
    assert.ok(r.doc.blocks['의자'], f + ' 한글 블록 이름');
    const mirrored = r.doc.ents.find((e) => e.type === 'arc' && Math.abs(e.r - 50) < 1e-9);
    nearPt(mirrored.c, { x: -100, y: 0 }); near(G.normAng(mirrored.a0), Math.PI / 2); near(G.normAng(mirrored.a1), Math.PI);
    assert.equal(Model.layerOf(r.doc, '숨김층').visible, false, f + ' 꺼진 층');
    assert.equal(Model.layerOf(r.doc, '잠금층').locked, true, f + ' 잠긴 층');
    const ins = r.doc.ents.filter((e) => e.type === 'insert');
    assert.ok(ins.length <= 2, f + ' 치수를 배열로 잘못 읽지 않음');
  }
});

test('양식 6종과 기호', () => {
  Lib.TEMPLATES.forEach((t) => {
    const d = Lib.newFromTemplate(t.id);
    assert.ok(d.settings.scale > 0);
    if (t.layers) assert.ok(d.layers.length > 5, t.id);
    if (t.sheet) assert.ok(d.ents.length > 10, t.id + ' 도곽');
  });
  const doc = Model.newDoc();
  Lib.SYMBOLS.forEach((s) => {
    const b = Lib.ensureBlock(doc, s.name);
    assert.ok(b && b.ents.length, s.name);
    assert.ok(/^[A-Z0-9_]+$/.test(s.name), 'DXF 호환 이름 ' + s.name);
  });
});

test('SVG: 종이 크기 = 범위 ÷ 축척', () => {
  const doc = Lib.newFromTemplate('remodel'); // A3 1:50
  const svg = D.SVG.toSVG(doc);
  const m = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
  near(parseFloat(m[1]), 420, 1); near(parseFloat(m[2]), 297, 1);
});

test('해치: 사선 무늬는 경계 안에만, 길이 합 ≈ 넓이 ÷ 간격', () => {
  const doc = Model.newDoc();
  const loop = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const h = Model.mk(doc, 'hatch', { loops: [loop], solid: false, pat: 'LINE45', scale: 1, ang: 0, fams: D.Hatch.families('LINE45', 1, 0) });
  const r = D.Hatch.segments(h);
  let total = 0;
  r.segs.forEach(([a, b]) => {
    total += G.dist(a, b);
    [a, b].forEach((p) => assert.ok(p.x > -1e-6 && p.x < 100 + 1e-6 && p.y > -1e-6 && p.y < 100 + 1e-6));
  });
  near(total, 10000 / 3, 40);
  // 구멍(섬)이 있으면 그만큼 빠진다
  const hole = [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }];
  const h2 = Model.mk(doc, 'hatch', { loops: [loop, hole], solid: false, pat: 'LINE45', scale: 1, ang: 0, fams: D.Hatch.families('LINE45', 1, 0) });
  let t2 = 0; D.Hatch.segments(h2).segs.forEach(([a, b]) => { t2 += G.dist(a, b); });
  near(t2, 7500 / 3, 40);
  // 단색은 사다리꼴 넓이 = 7500
  const h3 = Model.mk(doc, 'hatch', { loops: [loop, hole], solid: true, pat: 'SOLID', fams: [] });
  let a3 = 0; D.Hatch.trapezoids(h3).forEach((q) => { a3 += Math.abs(G.polyArea(q)); });
  near(a3, 7500, 1e-6);
});

test('해치: 클릭한 점의 경계 찾기 (벽 사이 = 바깥·안쪽 두 경계)', () => {
  const doc = Lib.newFromTemplate('blank');
  const add = (t, p) => { const e = Model.mk(doc, t, p); doc.ents.push(e); return e; };
  const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  add('poly', { pts: sq(0, 0, 1000, 1000), closed: true });
  add('poly', { pts: sq(100, 100, 900, 900), closed: true });
  add('circle', { c: { x: 500, y: 500 }, r: 100 });
  Model.touch();
  const ctx = { doc, visibleEnts: () => doc.ents };
  let loops = Cmd.findBoundary(ctx, { x: 50, y: 500 });
  assert.equal(loops.length, 2, '벽 사이: 바깥 + 안쪽');
  loops = Cmd.findBoundary(ctx, { x: 300, y: 500 });
  assert.equal(loops.length, 2, '방 안: 안쪽 사각형 + 원(섬)');
  assert.equal(Cmd.findBoundary(ctx, { x: 2000, y: 0 }), null);
});

test('해치: DXF 읽기 (ezdxf 해치 5종) · 쓰기(블록) · SVG', () => {
  const r = DXF.read(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'hatch-r2018.dxf'))));
  const hs = r.doc.ents.filter((e) => e.type === 'hatch');
  assert.equal(hs.length, 5);
  assert.deepEqual(r.report.skipped, {});
  near(G.deg(hs[0].fams[0].a), 75); near(hs[0].fams[0].d.x, -6.133629, 1e-5); // ANSI31 ×2, 30°
  near(Math.abs(Cmd.polyAreaBulge(hs[1].loops[0], true)), 6000 + Math.PI * 900, 1e-6); // 시계 방향 호 모서리
  assert.equal(hs[2].loops.length, 2); assert.ok(hs[2].solid);
  const b5 = Model.bounds(hs[4], r.doc); near(b5.x0, -150); near(b5.x1, -100); // -Z 방향
  const txt = DXF.write(r.doc);
  const back = DXF.read(txt).doc;
  const hb = Object.keys(back.blocks).filter((n) => /^DCAD_HATCH_/.test(n));
  assert.equal(hb.length, 5, '해치마다 블록 하나');
  assert.ok(back.blocks[hb[0]].ents.length > 5);
  assert.ok(back.blocks[hb[2]].ents.every((e) => e.type === 'poly' && e.fill), '단색 = SOLID 사다리꼴');
  assert.ok(/fill-rule="evenodd"/.test(D.SVG.toSVG(r.doc)));
});

test('늘리기: 창 안의 끝점·치수 점만 움직임', () => {
  const doc = Model.newDoc();
  const ln = Model.mk(doc, 'line', { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } });
  const dm = Model.mk(doc, 'dim', { kind: 'lin', p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, loc: { x: 0, y: -300 }, ang: 0 });
  const bx = { x0: 900, y0: -100, x1: 1100, y1: 100 };
  Cmd.stretchEnt(ln, bx, { x: 500, y: 0 }); Cmd.stretchEnt(dm, bx, { x: 500, y: 0 });
  near(ln.a.x, 0); near(ln.b.x, 1500);
  near(Model.dimGeom(dm, doc).value, 1500);
});

test('끊기: 선·닫힌 폴리선·열린 폴리선(호 구간)', () => {
  const doc = Model.newDoc();
  let r = Cmd.breakEntity(Model.mk(doc, 'line', { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }), { x: 30, y: 0 }, { x: 60, y: 0 }, doc);
  assert.equal(r.length, 2); near(r[0].b.x, 30); near(r[1].a.x, 60);
  r = Cmd.breakEntity(Model.mk(doc, 'line', { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }), { x: 40, y: 0 }, { x: 40, y: 0 }, doc);
  assert.equal(r.length, 2); near(r[0].b.x, 40); near(r[1].a.x, 40);
  const sq = Model.mk(doc, 'poly', { pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], closed: true });
  r = Cmd.breakEntity(sq, { x: 50, y: 0 }, { x: 50, y: 0 }, doc);
  assert.equal(r.length, 1); assert.equal(r[0].closed, false);
  assert.deepEqual(r[0].pts.map((p) => [p.x, p.y]), [[50, 0], [100, 0], [100, 100], [0, 100], [0, 0], [50, 0]]);
  const op = Model.mk(doc, 'poly', { pts: [{ x: 0, y: 0, bulge: 1 }, { x: 100, y: 0 }, { x: 200, y: 0 }], closed: false });
  r = Cmd.breakEntity(op, { x: 50, y: -50 }, { x: 150, y: 0 }, doc); // 반원 가운데 ~ 직선 가운데
  assert.equal(r.length, 2);
  near(r[0].pts[0].bulge, Math.tan(Math.PI / 8)); nearPt(r[0].pts[1], { x: 50, y: -50 });
  nearPt(r[1].pts[0], { x: 150, y: 0 }); nearPt(r[1].pts[1], { x: 200, y: 0 });
});

test('간격띄우기: 호 구간 폴리선(경기장 모양)', () => {
  // 100×60 + 반원 r30 양쪽, 반시계. 바깥으로 10 → 넓이 100·80 + π·40²
  const st = [{ x: 0, y: 0 }, { x: 100, y: 0, bulge: 1 }, { x: 100, y: 60 }, { x: 0, y: 60, bulge: 1 }];
  const out = Cmd.offsetPts(st, -10, true);
  near(Math.abs(Cmd.polyAreaBulge(out, true)), 8000 + Math.PI * 1600, 1e-6);
  const inn = Cmd.offsetPts(st, 10, true);
  near(Math.abs(Cmd.polyAreaBulge(inn, true)), 100 * 40 + Math.PI * 400, 1e-6);
  assert.equal(Cmd.offsetPts(st, 35, true), null, '반지름보다 안쪽은 불가');
});

test('해치 경계를 선으로 찾기: 도곽 안의 선으로 그린 방, 선 가구·원 섬, 호 모서리', () => {
  const doc = Lib.newFromTemplate('remodel'); // 도곽(닫힌 폴리선)이 있어도 방을 찾아야 함
  const add = (t, p) => { const e = Model.mk(doc, t, p); doc.ents.push(e); return e; };
  const box4 = (x0, y0, x1, y1) => { add('line', { a: { x: x0, y: y0 }, b: { x: x1, y: y0 } }); add('line', { a: { x: x1, y: y0 }, b: { x: x1, y: y1 } }); add('line', { a: { x: x1, y: y1 }, b: { x: x0, y: y1 } }); add('line', { a: { x: x0, y: y1 }, b: { x: x0, y: y0 } }); };
  box4(2000, 2000, 6000, 5000);
  add('line', { a: { x: 1500, y: 3500 }, b: { x: 2500, y: 3500 } }); // 벽을 뚫은 매달린 선
  box4(3000, 3000, 4000, 4000);
  add('circle', { c: { x: 5000, y: 4000 }, r: 300 });
  add('line', { a: { x: 7000, y: 2000 }, b: { x: 9500, y: 2000 } });
  add('arc', { c: { x: 9500, y: 2500 }, r: 500, a0: -Math.PI / 2, a1: 0 });
  add('line', { a: { x: 10000, y: 2500 }, b: { x: 10000, y: 5000 } });
  add('line', { a: { x: 10000, y: 5000 }, b: { x: 7000, y: 5000 } });
  add('line', { a: { x: 7000, y: 5000 }, b: { x: 7000, y: 2000 } });
  Model.touch();
  const ctx = { doc, visibleEnts: () => doc.ents, msg: () => {} };
  const loops = Cmd.findBoundary(ctx, { x: 2500, y: 2500 });
  const areas = loops.map((l) => Math.abs(Cmd.polyAreaBulge(l, true)) / 1e6);
  near(areas[0], 12, 1e-9); near(areas[1], 1, 1e-9); near(areas[2], Math.PI * 0.09, 1e-9);
  assert.ok(loops[2].some((p) => p.bulge), '원 섬은 정확한 곡선으로');
  const r2 = Cmd.findBoundary(ctx, { x: 8000, y: 3000 });
  near(Math.abs(Cmd.polyAreaBulge(r2[0], true)) / 1e6, (9e6 - 25e4 + Math.PI * 25e4 / 4) / 1e6, 2e-3);
});

test('선 굵기: 개체 → 도면층 → 기본, 블록 안 0층은 블록을 따름', () => {
  const doc = Lib.newFromTemplate('remodel');
  const w = Model.mk(doc, 'line', { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }); w.layer = '벽체';
  near(Model.entLw(w, doc), 0.5);
  w.lw = 0.13; near(Model.entLw(w, doc), 0.13);
  const z = Model.mk(null, 'line', { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }); z.layer = '0';
  const ins = Model.mk(doc, 'insert', { name: 'X', p: { x: 0, y: 0 } }); ins.layer = '치수';
  near(Model.entLw(z, doc, { e: ins }), 0.13);
  near(Model.entLw(Model.mk(Model.newDoc(), 'line', {}), Model.newDoc()), 0.25);
});

test('치수 끝: 건축 양식은 사선, 기계 양식은 화살표', () => {
  const a = Lib.newFromTemplate('remodel'), m = Lib.newFromTemplate('machine');
  const d = (doc) => Model.dimGeom(Model.mk(doc, 'dim', { kind: 'lin', p1: { x: 0, y: 0 }, p2: { x: 3000, y: 0 }, loc: { x: 0, y: -500 }, ang: 0 }), doc);
  const ga = d(a), gm = d(m);
  assert.equal(ga.arrows.length, 0); assert.equal(ga.lines.length, 5); near(ga.value, 3000);
  assert.equal(gm.arrows.length, 2);
});

test('물량 산출: 기호 개수, 도면층별 길이, 넓이(평)', () => {
  const doc = Lib.newFromTemplate('furniture', { frame: false });
  const add = (t, p, layer) => { const e = Model.mk(doc, t, p); e.layer = layer; doc.ents.push(e); return e; };
  ['BED_QUEEN', 'BED_QUEEN', 'SOFA_3'].forEach((n, i) => { Lib.ensureBlock(doc, n); add('insert', { name: n, p: { x: i * 3000, y: 0 } }, '가구-침실'); });
  add('line', { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } }, '벽체');
  add('poly', { pts: [{ x: 0, y: 0 }, { x: 3305.785, y: 0 }, { x: 3305.785, y: 1000 }, { x: 0, y: 1000 }], closed: true }, '벽체');
  const q = Cmd.quantities(doc.ents, doc);
  assert.deepEqual(q.blocks.map((b) => [b.label, b.count]), [['침대 퀸', 2], ['소파 3인', 1]]);
  near(q.lengths.find((l) => l.layer === '벽체').m, 3 + 2 * (3.305785 + 1));
  const a = q.areas.find((x) => x.kind === '닫힌 폴리선');
  near(a.m2, 3.305785); near(a.m2 / 3.305785, 1);
  const csv = Cmd.quantitiesCSV(q, '시험');
  assert.ok(csv.charCodeAt(0) === 0xfeff && /침대 퀸,BED_QUEEN,2,개/.test(csv));
});
