// 단위 시험 (브라우저 없이): node --test test/unit.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

['aci', 'geom', 'model', 'dxf-write', 'dxf-read', 'svg', 'library', 'commands'].forEach((f) => require(path.join(__dirname, '..', 'js', f + '.js')));
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
