// 도면 모델: 문서, 도면층, 선 종류, 개체별 기본 도형(prim)·경계·스냅·변환·분해.
// 개체는 JSON으로 그대로 저장할 수 있는 평범한 객체다.
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var G = NS.G, M = G.M, TAU = G.TAU;

  // 선 종류: 도면(종이) 기준 mm. +는 선, -는 빈칸, 0은 점. 도면 축척(ltscale)을 곱해 쓴다.
  var LTYPES = {
    CONTINUOUS: { desc: '실선', pat: [] },
    DASHED: { desc: '파선 __ __ __', pat: [6, -3] },
    HIDDEN: { desc: '숨은선 _ _ _ _', pat: [3, -1.5] },
    CENTER: { desc: '중심선 ____ _ ____', pat: [20, -3, 3, -3] },
    PHANTOM: { desc: '가상선 ____ _ _ ____', pat: [20, -3, 3, -3, 3, -3] },
    DASHDOT: { desc: '일점쇄선 __ . __', pat: [10, -3, 0, -3] },
    DOT: { desc: '점선 . . . .', pat: [0, -2] }
  };

  function newDoc() {
    return {
      format: 'daedong-cad', version: 1,
      name: '새 도면',
      layers: [{ name: '0', color: 7, ltype: 'CONTINUOUS', visible: true, locked: false }],
      currentLayer: '0',
      ltypes: JSON.parse(JSON.stringify(LTYPES)),
      blocks: {},
      ents: [],
      settings: {
        type: '', scale: 1, sheet: '', ltscale: 1, textH: 2.5, grid: 10,
        dim: { textH: 2.5, arrow: 2.5, exo: 1, exe: 1.25, gap: 0.8, dec: 0 }
      },
      nextId: 1
    };
  }

  function layerOf(doc, name) {
    for (var i = 0; i < doc.layers.length; i++) if (doc.layers[i].name === name) return doc.layers[i];
    return null;
  }
  function ensureLayer(doc, name, color, ltype) {
    var l = layerOf(doc, name);
    if (!l) {
      l = { name: name, color: color || 7, ltype: ltype || 'CONTINUOUS', visible: true, locked: false };
      doc.layers.push(l);
    }
    return l;
  }
  function ensureLtype(doc, name, pat, desc) {
    if (!name || name === 'BYLAYER' || name === 'BYBLOCK') return;
    if (!doc.ltypes[name]) doc.ltypes[name] = { desc: desc || name, pat: pat || (LTYPES[name] ? LTYPES[name].pat.slice() : []) };
  }

  function mk(doc, type, props) {
    var e = { id: doc ? doc.nextId++ : 0, type: type, layer: doc ? doc.currentLayer : '0', color: 256, ltype: 'BYLAYER' };
    for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) e[k] = props[k];
    return e;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- 문자 크기 ----------
  var measureCtx = null;
  function textWidth(s, h) {
    if (!s) return 0;
    if (measureCtx === null) {
      try {
        var c = g.document && g.document.createElement ? g.document.createElement('canvas') : null;
        measureCtx = c ? c.getContext('2d') : false;
      } catch (err) { measureCtx = false; }
    }
    if (measureCtx) {
      measureCtx.font = '100px ' + NS.FONT;
      return measureCtx.measureText(s).width / 100 * h;
    }
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 1.0 : 0.6;
    return w * h;
  }
  NS.FONT = '"Malgun Gothic","맑은 고딕","Noto Sans KR","Apple SD Gothic Neo",sans-serif';

  // 문자 개체의 네 모서리 (월드 좌표)
  function textBox(e) {
    var lines = e.type === 'mtext' ? String(e.s).split('\n') : [String(e.s)];
    var h = e.h, w = 0;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, textWidth(lines[i], h));
    var gap = h * 1.667, tot = (lines.length - 1) * gap + h;
    var x0, y0;
    if (e.type === 'mtext') {
      var at = e.attach || 1, col = (at - 1) % 3, row = Math.floor((at - 1) / 3);
      x0 = col === 0 ? 0 : col === 1 ? -w / 2 : -w;
      var top = row === 0 ? 0 : row === 1 ? tot / 2 : tot;
      y0 = top - tot;
      return rotBox(e.p, x0, y0, w, tot, e.rot || 0);
    }
    var al = e.align || 'L', va = e.valign || 'B';
    x0 = al === 'C' ? -w / 2 : al === 'R' ? -w : 0;
    y0 = va === 'M' ? -h / 2 : va === 'T' ? -h : -0.2 * h;
    var hh = va === 'B' ? h * 1.2 : h;
    return rotBox(e.p, x0, y0, w, hh, e.rot || 0);
  }
  function rotBox(p, x0, y0, w, h, rot) {
    var pts = [G.v(x0, y0), G.v(x0 + w, y0), G.v(x0 + w, y0 + h), G.v(x0, y0 + h)];
    return pts.map(function (q) { return G.add(p, G.rotate(q, G.v(0, 0), rot)); });
  }

  // ---------- 치수 ----------
  // 치수 개체 -> {lines:[[a,b]], arrows:[[p,p,p]], text:{p,h,rot,s}}
  function dimText(e, val, dec) {
    var s = G.fmt(val, dec);
    var pre = e.kind === 'rad' ? 'R' : e.kind === 'dia' ? 'Ø' : '';
    var suf = e.kind === 'ang' ? '°' : '';
    var t = pre + s + suf;
    if (e.text) t = String(e.text).replace('<>', t);
    return t;
  }
  function readableRot(a) {
    a = G.normAng(a);
    if (a > Math.PI / 2 + 1e-9 && a <= Math.PI * 1.5 + 1e-9) a -= Math.PI;
    return a;
  }
  function arrowTri(tip, dir, size) {
    var d = G.norm(dir), n = G.perp(d), base = G.add(tip, G.mul(d, size));
    return [tip, G.add(base, G.mul(n, size / 6)), G.sub(base, G.mul(n, size / 6))];
  }
  function dimGeom(e, doc) {
    var st = (doc && doc.settings && doc.settings.dim) || newDoc().settings.dim;
    var sz = e.st || st;
    var h = sz.textH, ar = sz.arrow, out = { lines: [], arrows: [], text: null };
    var dec = sz.dec !== undefined ? sz.dec : st.dec;
    if (e.kind === 'lin') {
      var u = G.v(Math.cos(e.ang), Math.sin(e.ang)), n = G.perp(u);
      var d1 = G.add(e.p1, G.mul(n, G.dot(G.sub(e.loc, e.p1), n)));
      var d2 = G.add(e.p2, G.mul(n, G.dot(G.sub(e.loc, e.p2), n)));
      var val = Math.abs(G.dot(G.sub(e.p2, e.p1), u));
      [[e.p1, d1], [e.p2, d2]].forEach(function (pr) {
        var v = G.sub(pr[1], pr[0]), l = G.len(v);
        if (l < 1e-9) return;
        var dn = G.mul(v, 1 / l);
        out.lines.push([G.add(pr[0], G.mul(dn, Math.min(sz.exo, l))), G.add(pr[1], G.mul(dn, sz.exe))]);
      });
      var dl = G.dist(d1, d2), dd = dl > 1e-9 ? G.norm(G.sub(d2, d1)) : u;
      var inside = dl >= ar * 2.6;
      if (inside) {
        out.lines.push([d1, d2]);
        out.arrows.push(arrowTri(d1, dd, ar), arrowTri(d2, G.mul(dd, -1), ar));
      } else {
        out.lines.push([G.sub(d1, G.mul(dd, ar * 2)), G.add(d2, G.mul(dd, ar * 2))]);
        out.arrows.push(arrowTri(d1, G.mul(dd, -1), ar), arrowTri(d2, dd, ar));
      }
      var rot = readableRot(Math.atan2(dd.y, dd.x)), up = G.perp(G.v(Math.cos(rot), Math.sin(rot)));
      out.text = { p: G.add(G.mid(d1, d2), G.mul(up, sz.gap)), h: h, rot: rot, s: dimText(e, val, dec), align: 'C', valign: 'B' };
      out.value = val;
    } else if (e.kind === 'rad' || e.kind === 'dia') {
      var r = G.dist(e.c, e.p), dir = G.norm(G.sub(e.p, e.c));
      var s = dimText(e, e.kind === 'dia' ? r * 2 : r, dec);
      var tw = textWidth(s, h);
      var start = e.kind === 'dia' ? G.sub(e.c, G.mul(dir, r)) : e.c;
      var outPt = G.add(e.p, G.mul(dir, ar * 2 + tw * 0.15));
      out.lines.push([start, outPt]);
      out.arrows.push(arrowTri(e.p, G.mul(dir, -1), ar));
      if (e.kind === 'dia') out.arrows.push(arrowTri(start, dir, ar));
      var right = dir.x >= 0, land = G.add(outPt, G.v(right ? tw + h * 0.6 : -(tw + h * 0.6), 0));
      out.lines.push([outPt, land]);
      out.text = { p: G.add(G.mid(outPt, land), G.v(0, sz.gap)), h: h, rot: 0, s: s, align: 'C', valign: 'B' };
      out.value = e.kind === 'dia' ? r * 2 : r;
    } else if (e.kind === 'ang') {
      // 꼭짓점 c, 두 방향 점 p1, p2, 호 위치 loc
      var a1 = G.angle(e.c, e.p1), a2 = G.angle(e.c, e.p2), rr = G.dist(e.c, e.loc), al = G.angle(e.c, e.loc);
      var s0 = a1, s1 = a2;
      if (!G.angInArc(al, s0, s1)) { s0 = a2; s1 = a1; }
      var sw = G.sweep(s0, s1);
      var pts = G.arcPoints(e.c, rr, s0, s1, rr / 400);
      for (var i = 0; i + 1 < pts.length; i++) out.lines.push([pts[i], pts[i + 1]]);
      [[e.p1, a1], [e.p2, a2]].forEach(function (pr) {
        var r0 = G.dist(e.c, pr[0]), lo = Math.min(r0, rr), hi = Math.max(r0, rr);
        if (hi - lo > sz.exo) out.lines.push([G.polar(e.c, lo + (r0 < rr ? sz.exo : 0), pr[1]), G.polar(e.c, hi + (r0 < rr ? sz.exe : -sz.exo), pr[1])]);
      });
      var ta = G.polar(e.c, rr, s0), tb = G.polar(e.c, rr, s1);
      out.arrows.push(arrowTri(ta, G.perp(G.v(Math.cos(s0), Math.sin(s0))), ar));
      out.arrows.push(arrowTri(tb, G.mul(G.perp(G.v(Math.cos(s1), Math.sin(s1))), -1), ar));
      var am = s0 + sw / 2, tr = readableRot(am - Math.PI / 2);
      out.text = { p: G.polar(e.c, rr + sz.gap, am), h: h, rot: tr, s: dimText(e, G.deg(sw), Math.max(0, dec)), align: 'C', valign: 'B' };
      out.value = G.deg(sw);
    }
    return out;
  }

  // ---------- 기본 도형(prim) ----------
  // L: 선분, A: 호(반시계), C: 원, P: 꺾은선(점열), T: 문자 상자(사각형)
  function polySegs(pts, closed) {
    var out = [], n = pts.length;
    var last = closed ? n : n - 1;
    for (var i = 0; i < last; i++) {
      var a = pts[i], b = pts[(i + 1) % n], bl = a.bulge || 0;
      if (Math.abs(bl) > 1e-12) {
        var arc = G.bulgeArc(a, b, bl);
        if (arc) {
          out.push(arc.ccw ? { k: 'A', c: arc.c, r: arc.r, a0: arc.a0, a1: arc.a1, from: a, to: b }
            : { k: 'A', c: arc.c, r: arc.r, a0: arc.a1, a1: arc.a0, from: a, to: b });
          continue;
        }
      }
      out.push({ k: 'L', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
    }
    return out;
  }
  function ellipsePoints(e, n) {
    var maj = e.major, minr = G.mul(G.perp(maj), e.ratio);
    var t0 = e.t0 || 0, t1 = e.t1 === undefined ? TAU : e.t1;
    var sw = G.sweep(t0, t1), full = sw >= TAU - 1e-9;
    n = n || Math.max(24, Math.ceil(96 * sw / TAU));
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = t0 + sw * i / n;
      pts.push(G.add(e.c, G.add(G.mul(maj, Math.cos(t)), G.mul(minr, Math.sin(t)))));
    }
    return { pts: pts, full: full };
  }
  function insertMatrix(e, blk) {
    var base = blk ? blk.base : G.v(0, 0);
    var m = M.move(-base.x, -base.y);
    m = M.mul(M.scale(e.sx === undefined ? 1 : e.sx, e.sy === undefined ? 1 : e.sy), m);
    m = M.mul(M.rot(e.rot || 0), m);
    return M.mul(M.move(e.p.x, e.p.y), m);
  }
  function mapPrim(pr, m, uniform) {
    switch (pr.k) {
      case 'L': return { k: 'L', a: M.apply(m, pr.a), b: M.apply(m, pr.b) };
      case 'P': return { k: 'P', pts: pr.pts.map(function (p) { return M.apply(m, p); }), closed: pr.closed };
      case 'T': return { k: 'T', poly: pr.poly.map(function (p) { return M.apply(m, p); }), ins: M.apply(m, pr.ins) };
      case 'C':
        if (uniform) return { k: 'C', c: M.apply(m, pr.c), r: pr.r * M.scaleOf(m) };
        return { k: 'P', pts: G.arcPoints(pr.c, pr.r, 0, 0, pr.r / 300, true).map(function (p) { return M.apply(m, p); }), closed: true };
      case 'A':
        if (uniform) {
          var c = M.apply(m, pr.c), q0 = M.apply(m, G.polar(pr.c, pr.r, pr.a0)), q1 = M.apply(m, G.polar(pr.c, pr.r, pr.a1));
          var a0 = G.angle(c, q0), a1 = G.angle(c, q1);
          return M.det(m) < 0 ? { k: 'A', c: c, r: pr.r * M.scaleOf(m), a0: a1, a1: a0 } : { k: 'A', c: c, r: pr.r * M.scaleOf(m), a0: a0, a1: a1 };
        }
        return { k: 'P', pts: G.arcPoints(pr.c, pr.r, pr.a0, pr.a1, pr.r / 300).map(function (p) { return M.apply(m, p); }) };
    }
    return pr;
  }

  function primsOf(e, doc, depth) {
    depth = depth || 0;
    switch (e.type) {
      case 'line': return [{ k: 'L', a: e.a, b: e.b }];
      case 'circle': return [{ k: 'C', c: e.c, r: e.r }];
      case 'arc': return [{ k: 'A', c: e.c, r: e.r, a0: e.a0, a1: e.a1 }];
      case 'poly': return polySegs(e.pts, e.closed);
      case 'ellipse': { var ep = ellipsePoints(e); return [{ k: 'P', pts: ep.pts, closed: ep.full }]; }
      case 'point': return [{ k: 'P', pts: [e.p, e.p] }];
      case 'text': case 'mtext': return [{ k: 'T', poly: textBox(e), ins: e.p }];
      case 'dim': {
        var dg = dimGeom(e, doc), out = [];
        dg.lines.forEach(function (l) { out.push({ k: 'L', a: l[0], b: l[1] }); });
        dg.arrows.forEach(function (t) { out.push({ k: 'P', pts: t, closed: true, fill: true }); });
        if (dg.text) out.push({ k: 'T', poly: textBox({ type: 'text', p: dg.text.p, h: dg.text.h, rot: dg.text.rot, s: dg.text.s, align: 'C', valign: 'B' }), ins: dg.text.p });
        return out;
      }
      case 'insert': {
        var blk = doc && doc.blocks[e.name];
        if (!blk || depth > 8) return [{ k: 'P', pts: [e.p, e.p] }];
        var m = insertMatrix(e, blk), uni = M.isUniform(m), res = [];
        blk.ents.forEach(function (be) {
          primsOf(be, doc, depth + 1).forEach(function (pr) { res.push(mapPrim(pr, m, uni)); });
        });
        if (!res.length) res.push({ k: 'P', pts: [e.p, e.p] });
        return res;
      }
    }
    return [];
  }

  // 화면 갱신마다 다시 계산하지 않도록 문서 버전별 캐시
  var cache = new WeakMap();
  NS.docVersion = 1;
  function prims(e, doc) {
    var c = cache.get(e);
    if (c && c.v === NS.docVersion) return c.p;
    var p = primsOf(e, doc);
    var b = G.box();
    p.forEach(function (pr) { primBox(pr, b); });
    cache.set(e, { v: NS.docVersion, p: p, b: b });
    return p;
  }
  function bounds(e, doc) {
    prims(e, doc);
    return cache.get(e).b;
  }
  function touch() { NS.docVersion++; }

  function primBox(pr, b) {
    switch (pr.k) {
      case 'L': G.boxAdd(b, pr.a); G.boxAdd(b, pr.b); break;
      case 'C': G.boxAdd(b, G.v(pr.c.x - pr.r, pr.c.y - pr.r)); G.boxAdd(b, G.v(pr.c.x + pr.r, pr.c.y + pr.r)); break;
      case 'A': { var ab = G.arcBox(pr.c, pr.r, pr.a0, pr.a1); G.boxAdd(b, G.v(ab.x0, ab.y0)); G.boxAdd(b, G.v(ab.x1, ab.y1)); break; }
      case 'P': pr.pts.forEach(function (p) { G.boxAdd(b, p); }); break;
      case 'T': pr.poly.forEach(function (p) { G.boxAdd(b, p); }); break;
    }
    return b;
  }

  function primDist(pr, p) {
    switch (pr.k) {
      case 'L': return G.segClosest(p, pr.a, pr.b).d;
      case 'C': return Math.abs(G.dist(p, pr.c) - pr.r);
      case 'A': {
        var a = G.angle(pr.c, p);
        if (G.angInArc(a, pr.a0, pr.a1)) return Math.abs(G.dist(p, pr.c) - pr.r);
        return Math.min(G.dist(p, G.polar(pr.c, pr.r, pr.a0)), G.dist(p, G.polar(pr.c, pr.r, pr.a1)));
      }
      case 'P': {
        var best = Infinity, pts = pr.pts, n = pts.length;
        for (var i = 0; i + 1 < n; i++) best = Math.min(best, G.segClosest(p, pts[i], pts[i + 1]).d);
        if (pr.closed && n > 2) best = Math.min(best, G.segClosest(p, pts[n - 1], pts[0]).d);
        if (n === 1) best = G.dist(p, pts[0]);
        if (pr.fill && G.pointInPoly(p, pts)) best = 0;
        return best;
      }
      case 'T': {
        if (G.pointInPoly(p, pr.poly)) return 0;
        var bb = Infinity;
        for (var j = 0; j < 4; j++) bb = Math.min(bb, G.segClosest(p, pr.poly[j], pr.poly[(j + 1) % 4]).d);
        return bb;
      }
    }
    return Infinity;
  }
  function primNearest(pr, p) {
    switch (pr.k) {
      case 'L': return G.segClosest(p, pr.a, pr.b).pt;
      case 'C': return G.polar(pr.c, pr.r, G.angle(pr.c, p));
      case 'A': {
        var a = G.angle(pr.c, p);
        if (G.angInArc(a, pr.a0, pr.a1)) return G.polar(pr.c, pr.r, a);
        var e0 = G.polar(pr.c, pr.r, pr.a0), e1 = G.polar(pr.c, pr.r, pr.a1);
        return G.dist(p, e0) < G.dist(p, e1) ? e0 : e1;
      }
      case 'P': {
        var best = null, bd = Infinity, pts = pr.pts;
        for (var i = 0; i + 1 < pts.length; i++) { var r = G.segClosest(p, pts[i], pts[i + 1]); if (r.d < bd) { bd = r.d; best = r.pt; } }
        return best || pts[0];
      }
    }
    return null;
  }
  // 두 prim의 교점 (실제 구간 안)
  function asSegs(pr) {
    if (pr.k === 'L') return [[pr.a, pr.b]];
    if (pr.k === 'P') {
      var s = [];
      for (var i = 0; i + 1 < pr.pts.length; i++) s.push([pr.pts[i], pr.pts[i + 1]]);
      if (pr.closed && pr.pts.length > 2) s.push([pr.pts[pr.pts.length - 1], pr.pts[0]]);
      return s;
    }
    return null;
  }
  function onCurve(pr, q) {
    if (pr.k === 'C') return true;
    if (pr.k === 'A') return G.angInArc(G.angle(pr.c, q), pr.a0, pr.a1);
    return true;
  }
  function primInter(p1, p2) {
    if (p1.k === 'T' || p2.k === 'T') return [];
    var s1 = asSegs(p1), s2 = asSegs(p2), out = [];
    if (s1 && s2) {
      s1.forEach(function (a) {
        s2.forEach(function (b) {
          var r = G.lineLine(a[0], a[1], b[0], b[1]);
          if (r && r.t >= -1e-9 && r.t <= 1 + 1e-9 && r.u >= -1e-9 && r.u <= 1 + 1e-9) out.push(r.pt);
        });
      });
      return out;
    }
    if (s1 || s2) {
      var segs = s1 || s2, cv = s1 ? p2 : p1;
      segs.forEach(function (a) {
        G.lineCircle(a[0], a[1], cv.c, cv.r).forEach(function (h) {
          if (h.t >= -1e-9 && h.t <= 1 + 1e-9 && onCurve(cv, h.pt)) out.push(h.pt);
        });
      });
      return out;
    }
    G.circleCircle(p1.c, p1.r, p2.c, p2.r).forEach(function (q) {
      if (onCurve(p1, q) && onCurve(p2, q)) out.push(q);
    });
    return out;
  }
  function primHitsBox(pr, bx) {
    switch (pr.k) {
      case 'L': return G.segHitsBox(pr.a, pr.b, bx);
      case 'C': case 'A': {
        var pts = pr.k === 'C' ? G.arcPoints(pr.c, pr.r, 0, 0, pr.r / 100, true) : G.arcPoints(pr.c, pr.r, pr.a0, pr.a1, pr.r / 100);
        for (var i = 0; i + 1 < pts.length; i++) if (G.segHitsBox(pts[i], pts[i + 1], bx)) return true;
        return false;
      }
      case 'P': {
        var s = asSegs(pr);
        if (pr.pts.length === 1 || (pr.pts.length === 2 && G.eq(pr.pts[0], pr.pts[1]))) return G.boxHas(bx, pr.pts[0]);
        for (var j = 0; j < s.length; j++) if (G.segHitsBox(s[j][0], s[j][1], bx)) return true;
        return false;
      }
      case 'T': {
        for (var k = 0; k < 4; k++) if (G.segHitsBox(pr.poly[k], pr.poly[(k + 1) % 4], bx)) return true;
        return G.pointInPoly(G.v(bx.x0, bx.y0), pr.poly);
      }
    }
    return false;
  }

  function hitDist(e, doc, p) {
    var ps = prims(e, doc), best = Infinity;
    for (var i = 0; i < ps.length; i++) best = Math.min(best, primDist(ps[i], p));
    return best;
  }
  function hitsBox(e, doc, bx) {
    if (!G.boxHit(bounds(e, doc), bx)) return false;
    var ps = prims(e, doc);
    for (var i = 0; i < ps.length; i++) if (primHitsBox(ps[i], bx)) return true;
    return false;
  }

  // ---------- 스냅 후보 ----------
  function snapsOf(e, doc) {
    var out = [];
    function put(p, kind) { out.push({ p: p, kind: kind }); }
    switch (e.type) {
      case 'line': put(e.a, 'end'); put(e.b, 'end'); put(G.mid(e.a, e.b), 'mid'); break;
      case 'circle':
        put(e.c, 'cen');
        for (var q = 0; q < 4; q++) put(G.polar(e.c, e.r, q * Math.PI / 2), 'qua');
        break;
      case 'arc':
        put(e.c, 'cen'); put(G.polar(e.c, e.r, e.a0), 'end'); put(G.polar(e.c, e.r, e.a1), 'end');
        put(G.polar(e.c, e.r, e.a0 + G.sweep(e.a0, e.a1) / 2), 'mid');
        for (var k = 0; k < 4; k++) if (G.angInArc(k * Math.PI / 2, e.a0, e.a1)) put(G.polar(e.c, e.r, k * Math.PI / 2), 'qua');
        break;
      case 'poly':
        e.pts.forEach(function (p) { put(p, 'end'); });
        polySegs(e.pts, e.closed).forEach(function (s) {
          if (s.k === 'L') put(G.mid(s.a, s.b), 'mid');
          else { put(G.polar(s.c, s.r, s.a0 + G.sweep(s.a0, s.a1) / 2), 'mid'); put(s.c, 'cen'); }
        });
        break;
      case 'ellipse': {
        put(e.c, 'cen');
        var mn = G.mul(G.perp(e.major), e.ratio);
        [G.add(e.c, e.major), G.sub(e.c, e.major), G.add(e.c, mn), G.sub(e.c, mn)].forEach(function (p) { put(p, 'qua'); });
        break;
      }
      case 'text': case 'mtext': case 'point': put(e.p, 'ins'); break;
      case 'dim':
        if (e.kind === 'lin') { put(e.p1, 'end'); put(e.p2, 'end'); }
        else { put(e.c, 'cen'); put(e.p, 'end'); }
        break;
      case 'insert': {
        put(e.p, 'ins');
        var ps = prims(e, doc), cnt = 0;
        for (var i = 0; i < ps.length && cnt < 400; i++) {
          var pr = ps[i];
          if (pr.k === 'L') { put(pr.a, 'end'); put(pr.b, 'end'); put(G.mid(pr.a, pr.b), 'mid'); cnt += 3; }
          else if (pr.k === 'C') { put(pr.c, 'cen'); cnt++; }
          else if (pr.k === 'A') { put(pr.c, 'cen'); put(G.polar(pr.c, pr.r, pr.a0), 'end'); put(G.polar(pr.c, pr.r, pr.a1), 'end'); cnt += 3; }
        }
        break;
      }
    }
    return out;
  }

  // ---------- 변환 ----------
  // m: 아핀 행렬(회전·이동·균일 축척·대칭). 개체를 제자리에서 바꾼다.
  function transform(e, m) {
    var det = M.det(m), s = M.scaleOf(m), flip = det < 0;
    var ap = function (p) { var q = M.apply(m, p); p.x = q.x; p.y = q.y; };
    var dirAng = function (a) { var d = M.vec(m, G.v(Math.cos(a), Math.sin(a))); return Math.atan2(d.y, d.x); };
    switch (e.type) {
      case 'line': ap(e.a); ap(e.b); break;
      case 'circle': ap(e.c); e.r *= s; break;
      case 'arc': {
        var q0 = M.apply(m, G.polar(e.c, e.r, e.a0)), q1 = M.apply(m, G.polar(e.c, e.r, e.a1));
        ap(e.c); e.r *= s;
        var b0 = G.angle(e.c, q0), b1 = G.angle(e.c, q1);
        if (flip) { e.a0 = b1; e.a1 = b0; } else { e.a0 = b0; e.a1 = b1; }
        break;
      }
      case 'poly':
        e.pts.forEach(function (p) { ap(p); if (flip && p.bulge) p.bulge = -p.bulge; });
        break;
      case 'ellipse': {
        ap(e.c); e.major = M.vec(m, e.major);
        if (flip) { var t0 = e.t0 || 0, t1 = e.t1 === undefined ? TAU : e.t1; if (G.sweep(t0, t1) < TAU - 1e-9) { e.t0 = G.normAng(-t1); e.t1 = G.normAng(-t0); } }
        break;
      }
      case 'point': ap(e.p); break;
      case 'text': case 'mtext': {
        ap(e.p); e.h *= s;
        var r = dirAng(e.rot || 0);
        if (flip && Math.cos(r) < -1e-9) r += Math.PI;
        e.rot = G.normAng(r);
        if (e.width) e.width *= s;
        break;
      }
      case 'dim':
        ['p1', 'p2', 'loc', 'c', 'p'].forEach(function (k) { if (e[k]) ap(e[k]); });
        if (e.kind === 'lin') e.ang = dirAng(e.ang);
        if (e.kind === 'ang' && flip) { var t = e.p1; e.p1 = e.p2; e.p2 = t; }
        if (e.st) { e.st = clone(e.st); e.st.textH *= s; e.st.arrow *= s; e.st.exo *= s; e.st.exe *= s; e.st.gap *= s; }
        break;
      case 'insert': {
        ap(e.p);
        var th = Math.atan2(m.b, m.a), sx = e.sx === undefined ? 1 : e.sx, sy = e.sy === undefined ? 1 : e.sy;
        if (flip) { e.rot = G.normAng(th - (e.rot || 0)); e.sx = sx * s; e.sy = -sy * s; }
        else { e.rot = G.normAng(th + (e.rot || 0)); e.sx = sx * s; e.sy = sy * s; }
        break;
      }
    }
    return e;
  }

  // ---------- 분해 ----------
  function explode(e, doc) {
    var base = { layer: e.layer, color: e.color, ltype: e.ltype };
    function k(type, props) { var o = mk(doc, type, props); o.layer = base.layer; o.color = base.color; o.ltype = base.ltype; return o; }
    switch (e.type) {
      case 'poly':
        return polySegs(e.pts, e.closed).map(function (s) {
          return s.k === 'L' ? k('line', { a: s.a, b: s.b }) : k('arc', { c: s.c, r: s.r, a0: s.a0, a1: s.a1 });
        });
      case 'mtext': {
        // 상자의 왼쪽 위 모서리에서 줄마다 내려가며 한 줄 문자로 바꾼다
        var bx = textBox(e), lines = String(e.s).split('\n'), rot = e.rot || 0;
        var col = ((e.attach || 1) - 1) % 3, wd = G.dist(bx[0], bx[1]);
        var al = col === 0 ? 'L' : col === 1 ? 'C' : 'R';
        return lines.map(function (ln, i) {
          var local = G.v(col * wd / 2, -i * e.h * 1.667 - e.h);
          return k('text', { p: G.add(bx[3], G.rotate(local, G.v(0, 0), rot)), h: e.h, rot: rot, s: ln, align: al, valign: 'B' });
        });
      }
      case 'dim': {
        var dg = dimGeom(e, doc), res = [];
        dg.lines.forEach(function (l) { res.push(k('line', { a: l[0], b: l[1] })); });
        dg.arrows.forEach(function (t) { res.push(k('poly', { pts: t.map(function (p) { return { x: p.x, y: p.y }; }), closed: true, fill: true })); });
        if (dg.text) res.push(k('text', { p: dg.text.p, h: dg.text.h, rot: dg.text.rot, s: dg.text.s, align: 'C', valign: 'B' }));
        return res;
      }
      case 'insert': {
        var blk = doc.blocks[e.name];
        if (!blk) return [];
        var m = insertMatrix(e, blk), uni = M.isUniform(m);
        var out = [];
        blk.ents.forEach(function (be) {
          var c = clone(be);
          c.id = doc.nextId++;
          if (c.layer === '0') c.layer = e.layer;
          if (c.color === 0) c.color = e.color;
          if (c.ltype === 'BYBLOCK') c.ltype = e.ltype;
          var straight = c.type === 'line' || c.type === 'point' || (c.type === 'poly' && !c.pts.some(function (p) { return p.bulge; }));
          if (uni || straight || c.type === 'insert' || c.type === 'text' || c.type === 'mtext') {
            out.push(transform(c, m));
          } else {
            var own = { layer: c.layer, color: c.color, ltype: c.ltype };
            primsOf(c, doc).forEach(function (pr) {
              var mp = mapPrim(pr, m, false), ne = null;
              if (mp.k === 'P') ne = mk(doc, 'poly', { pts: mp.pts.map(function (p) { return { x: p.x, y: p.y }; }), closed: !!mp.closed });
              else if (mp.k === 'L') ne = mk(doc, 'line', { a: mp.a, b: mp.b });
              if (ne) { ne.layer = own.layer; ne.color = own.color; ne.ltype = own.ltype; out.push(ne); }
            });
          }
        });
        return out;
      }
    }
    return null;
  }

  // ---------- 색 ----------
  function aciRgb(i, dark) {
    if (i === 7) return dark ? '#ffffff' : '#000000';
    var c = NS.ACI[i] === undefined ? 0xffffff : NS.ACI[i];
    var hex = '#' + ('000000' + c.toString(16)).slice(-6);
    if (!dark && (c === 0xffffff)) return '#000000';
    return hex;
  }
  function entAci(e, doc, parent) {
    var c = e.color === undefined ? 256 : e.color;
    if (c === 0) return parent ? entAci(parent.e, doc, parent.parent) : 7;
    if (c === 256 || c === undefined) {
      if (e.layer === '0' && parent) return entAci(parent.e, doc, parent.parent);
      var l = layerOf(doc, e.layer);
      return l ? Math.abs(l.color) : 7;
    }
    return c;
  }
  function entLtype(e, doc, parent) {
    var t = e.ltype || 'BYLAYER';
    if (t === 'BYBLOCK') return parent ? entLtype(parent.e, doc, parent.parent) : 'CONTINUOUS';
    if (t === 'BYLAYER') {
      if (e.layer === '0' && parent) return entLtype(parent.e, doc, parent.parent);
      var l = layerOf(doc, e.layer);
      return l ? l.ltype || 'CONTINUOUS' : 'CONTINUOUS';
    }
    return t;
  }

  // 도면 전체 범위
  function extents(doc, ents) {
    var b = G.box();
    (ents || doc.ents).forEach(function (e) {
      var l = layerOf(doc, e.layer);
      if (l && !l.visible) return;
      var eb = bounds(e, doc);
      if (G.boxValid(eb)) b = G.boxUnion(b, eb);
    });
    return b;
  }

  NS.Model = {
    LTYPES: LTYPES, newDoc: newDoc, layerOf: layerOf, ensureLayer: ensureLayer, ensureLtype: ensureLtype,
    mk: mk, clone: clone, textWidth: textWidth, textBox: textBox, dimGeom: dimGeom, polySegs: polySegs,
    ellipsePoints: ellipsePoints, insertMatrix: insertMatrix, mapPrim: mapPrim, primsOf: primsOf, prims: prims,
    bounds: bounds, touch: touch, primDist: primDist, primNearest: primNearest, primInter: primInter,
    hitDist: hitDist, hitsBox: hitsBox, snapsOf: snapsOf, transform: transform, explode: explode,
    aciRgb: aciRgb, entAci: entAci, entLtype: entLtype, extents: extents, readableRot: readableRot
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
