// 명령 엔진과 명령들. 명령은 제너레이터 함수로, 입력이 필요할 때 요청을 yield 한다.
// 요청 {type:'point'|'number'|'angle'|'text'|'select'|'entity'|'choice', prompt, base, kw, def, allowNone, preview}
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var G = NS.G, M = G.M, Model = NS.Model, TAU = G.TAU;

  // ---------- 입력 해석 ----------
  // 숫자식: 1200+300, 3000/2, (900-100)*2
  function evalNum(s) {
    s = String(s).replace(/\s+/g, '');
    if (!s || !/^[0-9+\-*/().eE]+$/.test(s)) return NaN;
    var i = 0;
    function peek() { return s.charAt(i); }
    function num() {
      var m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) throw new Error('num');
      i += m[0].length; return parseFloat(m[0]);
    }
    function factor() {
      if (peek() === '-') { i++; return -factor(); }
      if (peek() === '+') { i++; return factor(); }
      if (peek() === '(') { i++; var v = expr(); if (peek() !== ')') throw new Error(')'); i++; return v; }
      return num();
    }
    function term() { var v = factor(); while (peek() === '*' || peek() === '/') { var o = s.charAt(i++), r = factor(); v = o === '*' ? v * r : v / r; } return v; }
    function expr() { var v = term(); while (peek() === '+' || peek() === '-') { var o = s.charAt(i++), r = term(); v = o === '+' ? v + r : v - r; } return v; }
    try { var v = expr(); return i === s.length && isFinite(v) ? v : NaN; } catch (e) { return NaN; }
  }
  function ortho(base, p) {
    return Math.abs(p.x - base.x) >= Math.abs(p.y - base.y) ? G.v(p.x, base.y) : G.v(base.x, p.y);
  }
  // 좌표 입력: "x,y", "@dx,dy", "@거리<각도", "거리<각도", 거리만(커서 방향)
  function parsePoint(str, base, cursor, isOrtho, last) {
    var s = String(str).trim().replace(/，/g, ',').replace(/\s+/g, '');
    if (!s) return null;
    var rel = false;
    if (s.charAt(0) === '@') { rel = true; s = s.slice(1); }
    var origin = rel ? (base || last || G.v(0, 0)) : G.v(0, 0);
    if (s.indexOf('<') >= 0) {
      var pa = s.split('<'), d = evalNum(pa[0]), a = evalNum(pa[1]);
      if (isFinite(d) && isFinite(a)) return G.polar(origin, d, G.rad(a));
      return null;
    }
    if (s.indexOf(',') >= 0) {
      var xy = s.split(','), x = evalNum(xy[0]), y = evalNum(xy[1]);
      if (!isFinite(x) || !isFinite(y)) return null;
      return rel ? G.v(origin.x + x, origin.y + y) : G.v(x, y);
    }
    if (rel) return s === '' ? origin : null;
    var dd = evalNum(s);
    if (isFinite(dd) && base) {
      var tgt = cursor || G.add(base, G.v(1, 0));
      if (isOrtho) tgt = ortho(base, tgt);
      var dir = G.sub(tgt, base);
      if (G.len(dir) < 1e-9) dir = G.v(1, 0);
      return G.add(base, G.mul(G.norm(dir), dd));
    }
    return null;
  }

  // ---------- 오프셋(평행) 점열 ----------
  function cleanPts(pts) {
    var out = [];
    pts.forEach(function (p) { if (!out.length || !G.eq(out[out.length - 1], p, 1e-7)) out.push({ x: p.x, y: p.y }); });
    return out;
  }
  // d>0이면 진행 방향 왼쪽. 꺾이는 곳은 두 선의 교점(마이터)
  function offsetPts(pts, d, closed) {
    pts = cleanPts(pts);
    if (closed && pts.length > 2 && G.eq(pts[0], pts[pts.length - 1], 1e-7)) pts.pop();
    var n = pts.length, segs = [];
    if (n < 2) return pts;
    for (var i = 0; i < (closed ? n : n - 1); i++) {
      var a = pts[i], b = pts[(i + 1) % n], nr = G.perp(G.norm(G.sub(b, a)));
      segs.push([G.add(a, G.mul(nr, d)), G.add(b, G.mul(nr, d))]);
    }
    var m = segs.length, out = [];
    if (!closed) out.push(segs[0][0]);
    for (var j = closed ? 0 : 1; j < m; j++) {
      var s1 = segs[(j - 1 + m) % m], s2 = segs[j], x = G.lineLine(s1[0], s1[1], s2[0], s2[1]);
      if (x && G.dist(x.pt, s2[0]) < Math.abs(d) * 20) out.push(x.pt); else out.push(s2[0]);
    }
    if (!closed) out.push(segs[m - 1][1]);
    return out;
  }

  // 폴리선 넓이(볼록 구간 포함, 부호 있음)
  function polyAreaBulge(pts, closed) {
    var a = G.polyArea(pts);
    if (closed) {
      for (var i = 0; i < pts.length; i++) {
        var b = pts[i].bulge;
        if (!b) continue;
        var p1 = pts[i], p2 = pts[(i + 1) % pts.length], th = 4 * Math.atan(Math.abs(b));
        var r = G.dist(p1, p2) / (2 * Math.sin(th / 2));
        a += (b > 0 ? 1 : -1) * r * r / 2 * (th - Math.sin(th));
      }
    }
    return a;
  }
  function entLength(e, doc) {
    var L = 0;
    Model.prims(e, doc).forEach(function (pr) {
      if (pr.k === 'L') L += G.dist(pr.a, pr.b);
      else if (pr.k === 'C') L += TAU * pr.r;
      else if (pr.k === 'A') L += pr.r * G.sweep(pr.a0, pr.a1);
      else if (pr.k === 'P') { for (var i = 0; i + 1 < pr.pts.length; i++) L += G.dist(pr.pts[i], pr.pts[i + 1]); if (pr.closed) L += G.dist(pr.pts[pr.pts.length - 1], pr.pts[0]); }
    });
    return L;
  }

  // ---------- 개체 편집 도우미 ----------
  function cloneMove(ents, m) {
    return ents.map(function (e) { return Model.transform(Model.clone(e), m); });
  }
  function previewOf(ents, m) {
    if (ents.length > 1500) {
      var b = G.box();
      ents.forEach(function (e) { var eb = Model.bounds(e, null); if (G.boxValid(eb)) b = G.boxUnion(b, eb); });
      var r = Model.mk(null, 'poly', { pts: [G.v(b.x0, b.y0), G.v(b.x1, b.y0), G.v(b.x1, b.y1), G.v(b.x0, b.y1)], closed: true });
      return [Model.transform(r, m)];
    }
    return cloneMove(ents, m);
  }
  // 다른 개체들과의 교점
  function interPts(target, others, doc) {
    var tp = Model.prims(target, doc), out = [];
    var tb = G.boxGrow(Model.bounds(target, doc), 1e-6);
    others.forEach(function (o) {
      if (o === target) return;
      if (!G.boxHit(Model.bounds(o, doc), tb)) return;
      var op = Model.prims(o, doc);
      tp.forEach(function (a) { op.forEach(function (b) { Model.primInter(a, b).forEach(function (q) { out.push(q); }); }); });
    });
    return out;
  }
  // 선분과 다른 개체들의 교점 (직선 연장용, 가상 선분)
  function rayHits(a, b, others, doc, skip) {
    var seg = { k: 'L', a: a, b: b }, out = [];
    var sb = G.boxFrom(a, b);
    others.forEach(function (o) {
      if (o === skip || !G.boxHit(Model.bounds(o, doc), G.boxGrow(sb, 1e-6))) return;
      Model.prims(o, doc).forEach(function (pr) { Model.primInter(seg, pr).forEach(function (q) { out.push(q); }); });
    });
    return out;
  }

  // ---------- 자르기 ----------
  function trimEntity(e, click, cuts, doc) {
    var mkLike = function (type, props) { var n = Model.mk(doc, type, props); n.layer = e.layer; n.color = e.color; n.ltype = e.ltype; return n; };
    if (e.type === 'line') {
      var ts = cuts.map(function (q) { return G.projectLine(q, e.a, e.b).t; }).filter(function (t) { return t > 1e-7 && t < 1 - 1e-7; });
      var tc = G.projectLine(click, e.a, e.b).t, lo = null, hi = null;
      ts.forEach(function (t) { if (t < tc && (lo === null || t > lo)) lo = t; if (t > tc && (hi === null || t < hi)) hi = t; });
      var out = [];
      if (lo !== null) out.push(mkLike('line', { a: G.v(e.a.x, e.a.y), b: G.lerp(e.a, e.b, lo) }));
      if (hi !== null) out.push(mkLike('line', { a: G.lerp(e.a, e.b, hi), b: G.v(e.b.x, e.b.y) }));
      return out;
    }
    if (e.type === 'arc' || e.type === 'circle') {
      var full = e.type === 'circle', a0 = full ? 0 : e.a0, sw = full ? TAU : G.sweep(e.a0, e.a1);
      var us = cuts.map(function (q) { return G.normAng(G.angle(e.c, q) - a0); }).filter(function (u) { return full || (u > 1e-7 && u < sw - 1e-7); });
      var uc = G.normAng(G.angle(e.c, click) - a0);
      if (full) {
        if (us.length < 2) return [];
        us.sort(function (x, y) { return x - y; });
        var lo2 = null, hi2 = null;
        us.forEach(function (u) { if (u < uc) lo2 = u; if (u > uc && hi2 === null) hi2 = u; });
        if (lo2 === null) lo2 = us[us.length - 1];
        if (hi2 === null) hi2 = us[0];
        return [mkLike('arc', { c: G.v(e.c.x, e.c.y), r: e.r, a0: G.normAng(a0 + hi2), a1: G.normAng(a0 + lo2) })];
      }
      var l3 = null, h3 = null;
      us.forEach(function (u) { if (u < uc && (l3 === null || u > l3)) l3 = u; if (u > uc && (h3 === null || u < h3)) h3 = u; });
      var res = [];
      if (l3 !== null) res.push(mkLike('arc', { c: G.v(e.c.x, e.c.y), r: e.r, a0: e.a0, a1: G.normAng(a0 + l3) }));
      if (h3 !== null) res.push(mkLike('arc', { c: G.v(e.c.x, e.c.y), r: e.r, a0: G.normAng(a0 + h3), a1: e.a1 }));
      return res;
    }
    if (e.type === 'poly') return trimPoly(e, click, cuts, doc, mkLike);
    return null;
  }
  // 폴리선: 클릭한 구간에서 가장 가까운 두 교점 사이를 지운다
  function trimPoly(e, click, cuts, doc, mkLike) {
    var pts = e.pts, n = pts.length, segs = Model.polySegs(pts, e.closed), best = -1, bd = Infinity;
    segs.forEach(function (s, i) { var d = Model.primDist(s, click); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return null;
    var p1 = pts[best], p2 = pts[(best + 1) % n], bl = p1.bulge || 0, arc = bl ? G.bulgeArc(p1, p2, bl) : null;
    // 구간 매개변수 u (0..1)
    function param(q) {
      if (!arc) return G.projectLine(q, p1, p2).t;
      var a = G.normAng((G.angle(arc.c, q) - arc.a0) * (arc.th > 0 ? 1 : -1));
      return a / Math.abs(arc.th);
    }
    function at(u) { return arc ? G.rotate(p1, arc.c, arc.th * u) : G.lerp(p1, p2, u); }
    function subBulge(u0, u1) { return arc ? Math.tan(arc.th * (u1 - u0) / 4) : 0; }
    // 같은 폴리선의 다른 구간과의 교점도 자르는 기준
    var own = [];
    segs.forEach(function (s, i) { if (i !== best) Model.primInter(segs[best], s).forEach(function (q) { own.push(q); }); });
    var us = cuts.concat(own).map(param).filter(function (u) { return u > 1e-7 && u < 1 - 1e-7; });
    var uc = param(click), lo = 0, hi = 1, hasLo = false, hasHi = false;
    us.forEach(function (u) { if (u < uc && u >= lo) { lo = u; hasLo = true; } if (u > uc && u <= hi) { hi = u; hasHi = true; } });
    var cutA = at(lo), cutB = at(hi);
    function V(p, b) { var o = { x: p.x, y: p.y }; if (b) o.bulge = b; return o; }
    var out = [];
    if (e.closed) {
      // cutB에서 시작해 한 바퀴 돌아 cutA에서 끝나는 열린 폴리선
      var seq = [V(cutB, hasHi ? subBulge(hi, 1) : bl ? subBulge(0, 1) * 0 + (pts[(best + 1) % n].bulge || 0) : 0)];
      if (!hasHi) seq = [];
      for (var k = 1; k <= n; k++) {
        var idx = (best + k) % n;
        if (k === n) break;
        seq.push(V(pts[idx], pts[idx].bulge || 0));
      }
      seq.push(V(pts[best], hasLo ? subBulge(0, lo) : 0));
      if (hasLo) seq.push(V(cutA, 0));
      seq[seq.length - 1].bulge = undefined;
      seq = seq.map(function (p) { var o = { x: p.x, y: p.y }; if (p.bulge) o.bulge = p.bulge; return o; });
      if (seq.length >= 2) out.push(mkLike('poly', { pts: seq, closed: false }));
      return out;
    }
    var first = [], second = [];
    for (var i = 0; i < best; i++) first.push(V(pts[i], pts[i].bulge || 0));
    first.push(V(pts[best], hasLo ? subBulge(0, lo) : 0));
    if (hasLo) first.push(V(cutA, 0));
    if (hasHi) second.push(V(cutB, subBulge(hi, 1)));
    for (var j = best + 1; j < n; j++) second.push(V(pts[j], j < n - 1 ? pts[j].bulge || 0 : 0));
    [first, second].forEach(function (s) {
      if (s.length >= 2) { s[s.length - 1] = { x: s[s.length - 1].x, y: s[s.length - 1].y }; out.push(mkLike('poly', { pts: s, closed: false })); }
    });
    return out;
  }

  // ---------- 그립(손잡이) ----------
  function gripsOf(e) {
    var gp = [];
    function put(p, k) { gp.push({ p: p, k: k }); }
    switch (e.type) {
      case 'line': put(e.a, 'a'); put(e.b, 'b'); put(G.mid(e.a, e.b), 'move'); break;
      case 'circle': put(e.c, 'move'); for (var q = 0; q < 4; q++) put(G.polar(e.c, e.r, q * Math.PI / 2), 'r'); break;
      case 'arc': put(e.c, 'move'); put(G.polar(e.c, e.r, e.a0), 'a0'); put(G.polar(e.c, e.r, e.a1), 'a1'); put(G.polar(e.c, e.r, e.a0 + G.sweep(e.a0, e.a1) / 2), 'r'); break;
      case 'poly': e.pts.forEach(function (p, i) { put(p, 'v' + i); }); break;
      case 'ellipse': put(e.c, 'move'); break;
      case 'text': case 'mtext': case 'insert': case 'point': put(e.p, 'move'); break;
      case 'dim':
        if (e.kind === 'lin') { put(e.p1, 'p1'); put(e.p2, 'p2'); put(e.loc, 'loc'); }
        else if (e.kind === 'ang') { put(e.c, 'move'); put(e.loc, 'loc'); }
        else { put(e.c, 'move'); put(e.p, 'p'); }
        break;
    }
    return gp;
  }
  function applyGrip(e, grip, from, to) {
    var d = G.sub(to, from);
    switch (grip.k) {
      case 'move': return Model.transform(e, M.move(d.x, d.y));
      case 'a': e.a = to; break;
      case 'b': e.b = to; break;
      case 'r': e.r = Math.max(1e-6, G.dist(e.c, to)); break;
      case 'a0': e.a0 = G.angle(e.c, to); break;
      case 'a1': e.a1 = G.angle(e.c, to); break;
      case 'p1': e.p1 = to; break;
      case 'p2': e.p2 = to; break;
      case 'loc': e.loc = to; break;
      case 'p': e.p = G.polar(e.c, G.dist(e.c, e.p), G.angle(e.c, to)); break;
      default:
        if (grip.k.charAt(0) === 'v') { var i = parseInt(grip.k.slice(1), 10), bl = e.pts[i].bulge; e.pts[i] = { x: to.x, y: to.y }; if (bl) e.pts[i].bulge = bl; }
    }
    return e;
  }

  // ---------- 명령 정의 ----------
  var C = {};
  function def(name, label, aliases, fn, opts) { C[name] = { name: name, label: label, aliases: aliases, fn: fn, opts: opts || {} }; }

  def('LINE', '선', ['L', '선'], function* (ctx) {
    var p0 = yield { type: 'point', prompt: '선의 첫 점' };
    var start = p0, prev = p0, made = [];
    while (true) {
      var kw = made.length >= 2 ? { C: '닫기', U: '되돌리기' } : made.length ? { U: '되돌리기' } : null;
      var q = yield { type: 'point', prompt: '다음 점', base: prev, kw: kw, allowNone: true, preview: function (p) { return [ctx.tmp('line', { a: prev, b: p })]; } };
      if (!q) break;
      if (q.kw === 'C') { made.push(ctx.add(ctx.tmp('line', { a: prev, b: start }))); break; }
      if (q.kw === 'U') { var last = made.pop(); if (last) { ctx.remove([last]); prev = last.a; } continue; }
      made.push(ctx.add(ctx.tmp('line', { a: prev, b: q })));
      prev = q;
    }
  });

  def('PLINE', '폴리선', ['PL', '폴리선'], function* (ctx) {
    var p0 = yield { type: 'point', prompt: '폴리선 시작점' };
    var pts = [{ x: p0.x, y: p0.y }], arcMode = false, closed = false;
    function tangentDir() {
      var n = pts.length;
      if (n < 2) return null;
      var a = pts[n - 2], b = pts[n - 1];
      if (a.bulge) { var arc = G.bulgeArc(a, b, a.bulge); var r = G.sub(b, arc.c); return arc.ccw ? G.norm(G.perp(r)) : G.norm(G.mul(G.perp(r), -1)); }
      return G.norm(G.sub(b, a));
    }
    function bulgeTo(q) {
      var p = pts[pts.length - 1], t = tangentDir() || G.v(1, 0), ch = G.sub(q, p);
      var al = Math.atan2(G.cross(t, ch), G.dot(t, ch));
      return Math.tan(al / 2);
    }
    function shape(extra) {
      var list = pts.map(function (p) { var o = { x: p.x, y: p.y }; if (p.bulge) o.bulge = p.bulge; return o; });
      if (extra) { if (arcMode) list[list.length - 1].bulge = bulgeTo(extra); list.push({ x: extra.x, y: extra.y }); }
      return ctx.tmp('poly', { pts: list, closed: false });
    }
    while (true) {
      var kw = { A: '호', L: '직선', U: '되돌리기' };
      if (pts.length >= 3) kw.C = '닫기';
      var q = yield {
        type: 'point', prompt: arcMode ? '호의 끝점' : '다음 점', base: pts[pts.length - 1], kw: kw, allowNone: true,
        preview: function (p) { return [shape(p)]; }
      };
      if (!q) break;
      if (q.kw === 'A') { arcMode = true; continue; }
      if (q.kw === 'L') { arcMode = false; continue; }
      if (q.kw === 'U') { if (pts.length > 1) { pts.pop(); delete pts[pts.length - 1].bulge; } continue; }
      if (q.kw === 'C') { if (arcMode) pts[pts.length - 1].bulge = bulgeTo(pts[0]); closed = true; break; }
      if (arcMode) pts[pts.length - 1].bulge = bulgeTo(q);
      pts.push({ x: q.x, y: q.y });
    }
    if (pts.length >= 2) {
      var e = shape(null); e.closed = closed;
      if (!closed) delete e.pts[e.pts.length - 1].bulge;
      ctx.add(e);
    }
  });

  def('RECT', '사각형', ['REC', '사각형'], function* (ctx) {
    var a = yield { type: 'point', prompt: '첫 구석점' };
    var mkR = function (b) { return ctx.tmp('poly', { pts: [G.v(a.x, a.y), G.v(b.x, a.y), G.v(b.x, b.y), G.v(a.x, b.y)], closed: true }); };
    var b = yield { type: 'point', prompt: '반대 구석점 (예: @3000,2400)', base: a, noOrtho: true, preview: function (p) { return [mkR(p)]; } };
    ctx.add(mkR(b));
  });

  def('CIRCLE', '원', ['C', '원'], function* (ctx) {
    var c = yield { type: 'point', prompt: '원의 중심', kw: { '3P': '세 점', '2P': '두 점' } };
    if (c.kw === '3P') {
      var p1 = yield { type: 'point', prompt: '첫 점' };
      var p2 = yield { type: 'point', prompt: '둘째 점', base: p1 };
      var p3 = yield { type: 'point', prompt: '셋째 점', preview: function (p) { var a = G.arc3(p1, p2, p); return a ? [ctx.tmp('circle', { c: a.c, r: a.r })] : []; } };
      var a3 = G.arc3(p1, p2, p3);
      if (!a3) { ctx.msg('세 점이 한 줄 위에 있어 원을 만들 수 없습니다.'); return; }
      ctx.add(ctx.tmp('circle', { c: a3.c, r: a3.r }));
      return;
    }
    if (c.kw === '2P') {
      var q1 = yield { type: 'point', prompt: '지름의 한 끝' };
      var q2 = yield { type: 'point', prompt: '지름의 다른 끝', base: q1, preview: function (p) { return [ctx.tmp('circle', { c: G.mid(q1, p), r: G.dist(q1, p) / 2 })]; } };
      ctx.add(ctx.tmp('circle', { c: G.mid(q1, q2), r: G.dist(q1, q2) / 2 }));
      return;
    }
    var dia = false;
    var r = yield { type: 'number', prompt: '반지름 (지름은 D)', base: c, kw: { D: '지름' }, def: ctx.state.circleR, distFromBase: true, preview: function (p) { return [ctx.tmp('circle', { c: c, r: G.dist(c, p) })]; } };
    if (r && r.kw === 'D') {
      dia = true;
      r = yield { type: 'number', prompt: '지름', base: c, def: ctx.state.circleR ? ctx.state.circleR * 2 : undefined, distFromBase: true, preview: function (p) { return [ctx.tmp('circle', { c: c, r: G.dist(c, p) / 2 })]; } };
    }
    if (!(r > 0)) return;
    var rr = dia ? r / 2 : r;
    ctx.state.circleR = rr;
    ctx.add(ctx.tmp('circle', { c: c, r: rr }));
  });

  def('ARC', '호', ['A', '호'], function* (ctx) {
    var p1 = yield { type: 'point', prompt: '호의 시작점 (중심부터는 C)', kw: { C: '중심' } };
    if (p1.kw === 'C') {
      var c = yield { type: 'point', prompt: '호의 중심' };
      var s = yield { type: 'point', prompt: '시작점', base: c };
      var r = G.dist(c, s), a0 = G.angle(c, s);
      var e = yield { type: 'point', prompt: '끝점 (반시계 방향)', base: c, preview: function (p) { return [ctx.tmp('arc', { c: c, r: r, a0: a0, a1: G.angle(c, p) })]; } };
      ctx.add(ctx.tmp('arc', { c: c, r: r, a0: a0, a1: G.angle(c, e) }));
      return;
    }
    var p2 = yield { type: 'point', prompt: '호 위의 둘째 점', base: p1 };
    var p3 = yield { type: 'point', prompt: '호의 끝점', preview: function (p) { var a = G.arc3(p1, p2, p); return a ? [ctx.tmp('arc', a)] : [ctx.tmp('line', { a: p1, b: p })]; } };
    var a3 = G.arc3(p1, p2, p3);
    if (a3) ctx.add(ctx.tmp('arc', a3)); else ctx.msg('세 점이 한 줄 위에 있습니다.');
  });

  def('ELLIPSE', '타원', ['EL', '타원'], function* (ctx) {
    var c = yield { type: 'point', prompt: '타원의 중심' };
    var a = yield { type: 'point', prompt: '한 축의 끝점', base: c };
    var maj = G.sub(a, c), L = G.len(maj);
    if (L < 1e-9) return;
    var b = yield { type: 'number', prompt: '다른 축의 반 길이', base: c, distFromBase: true, preview: function (p) { return [ctx.tmp('ellipse', { c: c, major: maj, ratio: Math.max(1e-3, G.dist(c, p) / L) })]; } };
    if (!(b > 0)) return;
    var e = b > L ? ctx.tmp('ellipse', { c: c, major: G.mul(G.perp(G.norm(maj)), b), ratio: L / b }) : ctx.tmp('ellipse', { c: c, major: maj, ratio: b / L });
    ctx.add(e);
  });

  def('TEXT', '문자', ['T', 'DT', '문자'], function* (ctx) {
    var p = yield { type: 'point', prompt: '문자 시작점 (가운데 정렬은 J)', kw: { J: '가운데' } };
    var align = 'L';
    if (p.kw === 'J') { align = 'C'; p = yield { type: 'point', prompt: '문자 가운데 점' }; }
    var h = yield { type: 'number', prompt: '문자 높이', base: p, distFromBase: true, def: ctx.state.textH || ctx.doc.settings.textH };
    if (!(h > 0)) return;
    ctx.state.textH = h;
    var rot = yield { type: 'angle', prompt: '회전 각도', base: p, def: 0 };
    rot = G.rad(rot || 0);
    var line = 0;
    while (true) {
      var s = yield { type: 'text', prompt: line ? '다음 줄 (Enter로 끝)' : '문자 입력', allowNone: true };
      if (!s) break;
      var at = G.add(p, G.rotate(G.v(0, -line * h * 1.667), G.v(0, 0), rot));
      ctx.add(ctx.tmp('text', { p: at, h: h, rot: rot, s: s, align: align, valign: 'B' }));
      line++;
    }
  });

  def('EDITTEXT', '문자 고치기', ['ED', '문자고치기'], function* (ctx, pre) {
    var hit = pre || (yield { type: 'entity', prompt: '고칠 문자·치수 선택', filter: function (e) { return e.type === 'text' || e.type === 'mtext' || e.type === 'dim'; } });
    if (!hit) return;
    var e = hit.e;
    var cur = e.type === 'dim' ? (e.text || '<>') : e.s;
    var s = yield { type: 'text', prompt: e.type === 'dim' ? '치수 문자 (<>는 측정값)' : '새 문자', def: cur };
    if (s === null || s === undefined) return;
    ctx.change();
    if (e.type === 'dim') e.text = s === '<>' ? undefined : s; else e.s = s;
    ctx.modified();
  });

  // ---- 치수 ----
  function* pickTwo(ctx, label) {
    var p1 = yield { type: 'point', prompt: label + ' 첫째 점 (Enter: 선 선택)', allowNone: true };
    if (!p1) {
      var hit = yield { type: 'entity', prompt: '치수를 잴 선 선택', filter: function (e) { return e.type === 'line' || e.type === 'poly'; } };
      if (hit.e.type === 'line') return [hit.e.a, hit.e.b];
      var seg = null, bd = Infinity;
      Model.polySegs(hit.e.pts, hit.e.closed).forEach(function (s) { var d = Model.primDist(s, hit.p); if (d < bd) { bd = d; seg = s; } });
      return seg.k === 'L' ? [seg.a, seg.b] : [seg.from, seg.to];
    }
    var p2 = yield { type: 'point', prompt: label + ' 둘째 점', base: p1 };
    return [p1, p2];
  }
  def('DIMLIN', '선형 치수', ['DLI', '선형치수'], function* (ctx) {
    var pp = yield* pickTwo(ctx, '선형 치수');
    var p1 = pp[0], p2 = pp[1];
    function angFor(loc) {
      var inX = loc.x > Math.min(p1.x, p2.x) && loc.x < Math.max(p1.x, p2.x);
      var inY = loc.y > Math.min(p1.y, p2.y) && loc.y < Math.max(p1.y, p2.y);
      if (inX && !inY) return 0;
      if (inY && !inX) return Math.PI / 2;
      var m = G.mid(p1, p2);
      return Math.abs(loc.y - m.y) >= Math.abs(loc.x - m.x) ? 0 : Math.PI / 2;
    }
    var mkD = function (loc, ang) { return ctx.tmp('dim', { kind: 'lin', p1: p1, p2: p2, loc: loc, ang: ang }); };
    var loc = yield { type: 'point', prompt: '치수선 위치 (가로 H / 세로 V)', kw: { H: '가로', V: '세로' }, preview: function (p) { return [mkD(p, angFor(p))]; } };
    var fixed = null;
    if (loc.kw) {
      fixed = loc.kw === 'H' ? 0 : Math.PI / 2;
      loc = yield { type: 'point', prompt: '치수선 위치', preview: function (p) { return [mkD(p, fixed)]; } };
    }
    ctx.add(mkD(loc, fixed === null ? angFor(loc) : fixed));
  });
  def('DIMALI', '평행 치수', ['DAL', '평행치수'], function* (ctx) {
    var pp = yield* pickTwo(ctx, '평행 치수');
    var ang = G.angle(pp[0], pp[1]);
    var mkD = function (loc) { return ctx.tmp('dim', { kind: 'lin', p1: pp[0], p2: pp[1], loc: loc, ang: ang }); };
    var loc = yield { type: 'point', prompt: '치수선 위치', preview: function (p) { return [mkD(p)]; } };
    ctx.add(mkD(loc));
  });
  function* radialDim(ctx, kind) {
    var hit = yield { type: 'entity', prompt: (kind === 'rad' ? '반지름' : '지름') + ' 치수를 넣을 원·호 선택', filter: function (e) { return e.type === 'circle' || e.type === 'arc' || (e.type === 'poly' && e.pts.some(function (p) { return p.bulge; })); } };
    var c, r;
    if (hit.e.type === 'poly') {
      var seg = null, bd = Infinity;
      Model.polySegs(hit.e.pts, hit.e.closed).forEach(function (s) { if (s.k !== 'A') return; var d = Model.primDist(s, hit.p); if (d < bd) { bd = d; seg = s; } });
      c = seg.c; r = seg.r;
    } else { c = hit.e.c; r = hit.e.r; }
    var mkD = function (p) { return ctx.tmp('dim', { kind: kind, c: G.v(c.x, c.y), p: G.polar(c, r, G.angle(c, p)) }); };
    var loc = yield { type: 'point', prompt: '치수 문자 방향', preview: function (p) { return [mkD(p)]; } };
    ctx.add(mkD(loc));
  }
  def('DIMRAD', '반지름 치수', ['DRA', '반지름치수'], function* (ctx) { yield* radialDim(ctx, 'rad'); });
  def('DIMDIA', '지름 치수', ['DDI', '지름치수'], function* (ctx) { yield* radialDim(ctx, 'dia'); });
  def('DIMANG', '각도 치수', ['DAN', '각도치수'], function* (ctx) {
    var h1 = yield { type: 'entity', prompt: '각도의 첫째 선', filter: function (e) { return e.type === 'line'; } };
    var h2 = yield { type: 'entity', prompt: '각도의 둘째 선', filter: function (e) { return e.type === 'line' && e !== h1.e; } };
    var x = G.lineLine(h1.e.a, h1.e.b, h2.e.a, h2.e.b);
    if (!x) { ctx.msg('두 선이 평행합니다.'); return; }
    var c = x.pt;
    var far = function (l, p) { var a = G.dot(G.sub(p, c), G.sub(l.a, c)) >= 0 ? l.a : l.b; return G.dist(a, c) < 1e-9 ? (a === l.a ? l.b : l.a) : a; };
    var p1 = far(h1.e, h1.p), p2 = far(h2.e, h2.p);
    var mkD = function (loc) { return ctx.tmp('dim', { kind: 'ang', c: c, p1: p1, p2: p2, loc: loc }); };
    var loc = yield { type: 'point', prompt: '치수 호 위치', preview: function (p) { return [mkD(p)]; } };
    ctx.add(mkD(loc));
  });

  // ---- 벽 ----
  def('WALL', '벽', ['W', '벽'], function* (ctx) {
    var t = ctx.state.wallT || 200;
    var p0 = yield { type: 'point', prompt: '벽 중심선 시작점 (두께 ' + G.fmt(t) + ', 바꾸려면 T)', kw: { T: '두께' } };
    while (p0.kw === 'T') {
      var nt = yield { type: 'number', prompt: '벽 두께', def: t };
      if (nt > 0) { t = nt; ctx.state.wallT = t; }
      p0 = yield { type: 'point', prompt: '벽 중심선 시작점 (두께 ' + G.fmt(t) + ')', kw: { T: '두께' } };
    }
    var pts = [p0], closed = false;
    function outline(extra, close) {
      var c = extra ? pts.concat([extra]) : pts.slice();
      if (c.length < 2) return [];
      if (close) return [ctx.tmp('poly', { pts: offsetPts(c, t / 2, true), closed: true }), ctx.tmp('poly', { pts: offsetPts(c, -t / 2, true), closed: true })];
      var l = offsetPts(c, t / 2, false), r = offsetPts(c, -t / 2, false).reverse();
      return [ctx.tmp('poly', { pts: l.concat(r), closed: true })];
    }
    while (true) {
      var kw = { U: '되돌리기' };
      if (pts.length >= 3) kw.C = '닫기';
      var q = yield { type: 'point', prompt: '다음 점', base: pts[pts.length - 1], kw: kw, allowNone: true, preview: function (p) { return outline(p); } };
      if (!q) break;
      if (q.kw === 'U') { if (pts.length > 1) pts.pop(); continue; }
      if (q.kw === 'C') { closed = true; break; }
      pts.push(q);
    }
    outline(null, closed).forEach(function (e) { ctx.add(e); });
  });

  // ---- 기호 넣기 ----
  def('INSERT', '기호 넣기', ['I', '기호'], function* (ctx, pre) {
    var name = pre && pre.name;
    if (!name) {
      name = yield { type: 'text', prompt: '블록(기호) 이름' };
      if (!name) return;
    }
    var blk = NS.Library.ensureBlock(ctx.doc, name) || ctx.doc.blocks[name];
    if (!blk) { ctx.msg('그런 블록이 없습니다: ' + name); return; }
    var sym = NS.Library.symbolByName(name);
    var k = sym && sym.annot ? (ctx.doc.settings.scale || 1) : 1;
    var rot = ctx.state.insRot || 0, flip = false;
    var mkI = function (p) { return ctx.tmp('insert', { name: name, p: p, sx: flip ? -k : k, sy: k, rot: rot }); };
    while (true) {
      var p = yield { type: 'point', prompt: '넣을 위치 (회전 R / 좌우 뒤집기 F)', kw: { R: '회전', F: '뒤집기' }, preview: function (q) { return [mkI(q)]; } };
      if (p.kw === 'R') { var a = yield { type: 'angle', prompt: '회전 각도', def: G.deg(rot) }; rot = G.rad(a || 0); ctx.state.insRot = rot; continue; }
      if (p.kw === 'F') { flip = !flip; continue; }
      ctx.add(mkI(p));
      break;
    }
  });

  def('SHEET', '도곽·표제란', ['SHEET', '도곽'], function* (ctx) {
    var st = ctx.doc.settings;
    var sheet = yield { type: 'choice', prompt: '종이 크기', kw: { A4: 'A4', A3: 'A3', A2: 'A2', A1: 'A1', A0: 'A0' }, def: st.sheet || 'A3' };
    var k = yield { type: 'number', prompt: '축척 1:', def: st.scale || 1 };
    if (!(k > 0)) return;
    ctx.change();
    NS.Library.addSheet(ctx.doc, sheet.kw || sheet, k, { title: ctx.doc.name, date: new Date().toISOString().slice(0, 10) });
    ctx.modified();
    ctx.zoomExtents();
  });

  // ---- 수정 명령 ----
  function* selectEnts(ctx, prompt) {
    var s = yield { type: 'select', prompt: prompt || '객체 선택 (끝나면 Enter)' };
    return s || [];
  }
  def('ERASE', '지우기', ['E', '지우기'], function* (ctx) {
    var s = yield* selectEnts(ctx);
    if (s.length) { ctx.remove(s); ctx.msg(s.length + '개를 지웠습니다.'); }
  });
  def('MOVE', '이동', ['M', '이동'], function* (ctx) {
    var s = yield* selectEnts(ctx);
    if (!s.length) return;
    var a = yield { type: 'point', prompt: '기준점' };
    var b = yield { type: 'point', prompt: '옮길 곳 (예: @1000,0)', base: a, preview: function (p) { return previewOf(s, M.move(p.x - a.x, p.y - a.y)); } };
    ctx.change();
    s.forEach(function (e) { Model.transform(e, M.move(b.x - a.x, b.y - a.y)); });
    ctx.modified();
  });
  def('COPY', '복사', ['CO', 'CP', '복사'], function* (ctx) {
    var s = yield* selectEnts(ctx);
    if (!s.length) return;
    var a = yield { type: 'point', prompt: '기준점' };
    while (true) {
      var b = yield { type: 'point', prompt: '복사할 곳 (끝나면 Enter)', base: a, allowNone: true, preview: function (p) { return previewOf(s, M.move(p.x - a.x, p.y - a.y)); } };
      if (!b) break;
      cloneMove(s, M.move(b.x - a.x, b.y - a.y)).forEach(function (e) { ctx.add(e); });
    }
  });
  def('ROTATE', '회전', ['RO', '회전'], function* (ctx) {
    var s = yield* selectEnts(ctx);
    if (!s.length) return;
    var c = yield { type: 'point', prompt: '회전 중심' };
    var a = yield { type: 'angle', prompt: '회전 각도 (반시계 +)', base: c, preview: function (p) { return previewOf(s, M.rot(G.angle(c, p), c)); } };
    if (a === null || a === undefined) return;
    ctx.change();
    s.forEach(function (e) { Model.transform(e, M.rot(G.rad(a), c)); });
    ctx.modified();
  });
  def('MIRROR', '대칭', ['MI', '대칭'], function* (ctx) {
    var s = yield* selectEnts(ctx);
    if (!s.length) return;
    var p1 = yield { type: 'point', prompt: '대칭선 첫 점' };
    var p2 = yield { type: 'point', prompt: '대칭선 둘째 점', base: p1, preview: function (p) { return G.dist(p1, p) > 1e-9 ? previewOf(s, M.mirror(p1, p)) : []; } };
    if (G.dist(p1, p2) < 1e-9) return;
    var del = yield { type: 'choice', prompt: '원본을 지울까요?', kw: { Y: '예', N: '아니오' }, def: 'N' };
    var copies = cloneMove(s, M.mirror(p1, p2));
    copies.forEach(function (e) { ctx.add(e); });
    if ((del.kw || del) === 'Y') ctx.remove(s);
  });
  def('SCALE', '크기', ['SC', '크기'], function* (ctx) {
    var s = yield* selectEnts(ctx);
    if (!s.length) return;
    var c = yield { type: 'point', prompt: '기준점' };
    var f = yield { type: 'number', prompt: '배율 (참조 길이로는 R)', kw: { R: '참조' }, base: c, preview: function (p) { var k = G.dist(c, p) / 1000; return k > 1e-9 ? previewOf(s, M.scale(k, k, c)) : []; } };
    if (f && f.kw === 'R') {
      var r1 = yield { type: 'number', prompt: '참조 길이 (현재 길이)' };
      var r2 = yield { type: 'number', prompt: '새 길이' };
      if (!(r1 > 0 && r2 > 0)) return;
      f = r2 / r1;
    }
    if (!(f > 0)) return;
    ctx.change();
    s.forEach(function (e) { Model.transform(e, M.scale(f, f, c)); });
    ctx.modified();
  });
  def('OFFSET', '간격띄우기', ['O', '간격띄우기'], function* (ctx) {
    var d = yield { type: 'number', prompt: '간격 거리', def: ctx.state.offsetD };
    if (!(d > 0)) return;
    ctx.state.offsetD = d;
    while (true) {
      var hit = yield { type: 'entity', prompt: '간격을 띄울 객체 (끝나면 Enter)', allowNone: true, filter: function (e) { return /^(line|circle|arc|poly)$/.test(e.type); } };
      if (!hit) break;
      var e = hit.e;
      var mkSide = function (p) {
        var c = Model.clone(e); c.id = 0;
        if (e.type === 'line') {
          var side = G.cross(G.sub(e.b, e.a), G.sub(p, e.a)) >= 0 ? 1 : -1, n = G.mul(G.perp(G.norm(G.sub(e.b, e.a))), d * side);
          c.a = G.add(e.a, n); c.b = G.add(e.b, n); return c;
        }
        if (e.type === 'circle' || e.type === 'arc') {
          var out = G.dist(p, e.c) > e.r; c.r = out ? e.r + d : e.r - d;
          return c.r > 1e-9 ? c : null;
        }
        if (e.pts.some(function (q) { return q.bulge; })) return null;
        var segs = Model.polySegs(e.pts, e.closed), bi = 0, bd = Infinity;
        segs.forEach(function (sg, i) { var dd = Model.primDist(sg, p); if (dd < bd) { bd = dd; bi = i; } });
        var sg = segs[bi], sd = G.cross(G.sub(sg.b, sg.a), G.sub(p, sg.a)) >= 0 ? 1 : -1;
        c.pts = offsetPts(e.pts, d * sd, e.closed);
        return c;
      };
      if (e.type === 'poly' && e.pts.some(function (q) { return q.bulge; })) { ctx.msg('호 구간이 있는 폴리선은 분해(X) 뒤 간격띄우기 하세요.'); continue; }
      var side = yield { type: 'point', prompt: '띄울 쪽 클릭', preview: function (p) { var c = mkSide(p); return c ? [c] : []; } };
      var made = mkSide(side);
      if (made) { made.id = ctx.doc.nextId++; ctx.add(made); }
    }
  });
  def('TRIM', '자르기', ['TR', '자르기'], function* (ctx) {
    ctx.msg('모든 객체를 자르는 기준으로 씁니다. 지울 부분을 클릭하세요.');
    while (true) {
      var hit = yield { type: 'entity', prompt: '자를 부분 클릭 (끝나면 Enter)', allowNone: true, filter: function (e) { return /^(line|circle|arc|poly)$/.test(e.type); } };
      if (!hit) break;
      var cuts = interPts(hit.e, ctx.visibleEnts(), ctx.doc);
      var res = trimEntity(hit.e, hit.p, cuts, ctx.doc);
      if (res === null) { ctx.msg('이 객체는 자를 수 없습니다.'); continue; }
      if (hit.e.type === 'circle' && !res.length && cuts.length === 1) { ctx.msg('원은 교점이 둘 이상이어야 자를 수 있습니다.'); continue; }
      ctx.replace(hit.e, res);
    }
  });
  def('EXTEND', '연장', ['EX', '연장'], function* (ctx) {
    while (true) {
      var hit = yield { type: 'entity', prompt: '늘릴 선의 끝 쪽 클릭 (끝나면 Enter)', allowNone: true, filter: function (e) { return e.type === 'line'; } };
      if (!hit) break;
      var e = hit.e, atB = G.dist(hit.p, e.b) < G.dist(hit.p, e.a);
      var from = atB ? e.b : e.a, dir = G.norm(atB ? G.sub(e.b, e.a) : G.sub(e.a, e.b));
      var ext = Model.extents(ctx.doc), far = Math.max(1, (ext.x1 - ext.x0) + (ext.y1 - ext.y0)) * 2;
      var hits = rayHits(G.add(from, G.mul(dir, 1e-7)), G.add(from, G.mul(dir, far)), ctx.visibleEnts(), ctx.doc, e);
      var best = null, bd = Infinity;
      hits.forEach(function (q) { var d = G.dist(from, q); if (d > 1e-6 && d < bd) { bd = d; best = q; } });
      if (!best) { ctx.msg('늘릴 곳에 만나는 객체가 없습니다.'); continue; }
      ctx.change();
      if (atB) e.b = best; else e.a = best;
      ctx.modified();
    }
  });
  function cornerLines(ctx, h1, h2) {
    var l1 = h1.e, l2 = h2.e, x = G.lineLine(l1.a, l1.b, l2.a, l2.b);
    if (!x) return null;
    var X = x.pt;
    function side(l, q) {
      var d = G.norm(G.sub(l.b, l.a)), s = G.dot(G.sub(q, X), d) >= 0 ? 1 : -1, u = G.mul(d, s);
      var far = G.dot(G.sub(l.a, X), u) > G.dot(G.sub(l.b, X), u) ? 'a' : 'b';
      return { u: u, far: far, len: G.dot(G.sub(l[far], X), u) };
    }
    return { X: X, s1: side(l1, h1.p), s2: side(l2, h2.p) };
  }
  def('FILLET', '모깎기', ['F', '모깎기'], function* (ctx) {
    var r = ctx.state.filletR || 0;
    var h1 = yield { type: 'entity', prompt: '첫째 선 (반지름 ' + G.fmt(r) + ', 바꾸려면 R)', kw: { R: '반지름' }, filter: function (e) { return e.type === 'line'; } };
    while (h1.kw === 'R') {
      var nr = yield { type: 'number', prompt: '모깎기 반지름', def: r };
      if (nr >= 0) { r = nr; ctx.state.filletR = r; }
      h1 = yield { type: 'entity', prompt: '첫째 선 (반지름 ' + G.fmt(r) + ')', kw: { R: '반지름' }, filter: function (e) { return e.type === 'line'; } };
    }
    var h2 = yield { type: 'entity', prompt: '둘째 선', filter: function (e) { return e.type === 'line' && e !== h1.e; } };
    var cl = cornerLines(ctx, h1, h2);
    if (!cl) { ctx.msg('두 선이 평행합니다.'); return; }
    var X = cl.X, u1 = cl.s1.u, u2 = cl.s2.u;
    if (r <= 1e-9) {
      ctx.change(); h1.e[cl.s1.far === 'a' ? 'b' : 'a'] = X; h2.e[cl.s2.far === 'a' ? 'b' : 'a'] = X; ctx.modified();
      return;
    }
    var phi = Math.acos(Math.max(-1, Math.min(1, G.dot(u1, u2))));
    if (phi < 1e-6 || Math.PI - phi < 1e-6) { ctx.msg('선이 일직선이라 모깎기를 할 수 없습니다.'); return; }
    var t = r / Math.tan(phi / 2);
    if (t > cl.s1.len + 1e-9 || t > cl.s2.len + 1e-9) { ctx.msg('반지름이 너무 큽니다.'); return; }
    var T1 = G.add(X, G.mul(u1, t)), T2 = G.add(X, G.mul(u2, t));
    var c = G.add(X, G.mul(G.norm(G.add(u1, u2)), r / Math.sin(phi / 2)));
    var a0 = G.angle(c, T1), a1 = G.angle(c, T2);
    if (G.sweep(a0, a1) > Math.PI) { var tt = a0; a0 = a1; a1 = tt; }
    ctx.change();
    h1.e[cl.s1.far === 'a' ? 'b' : 'a'] = T1; h2.e[cl.s2.far === 'a' ? 'b' : 'a'] = T2;
    ctx.modified();
    var arc = ctx.tmp('arc', { c: c, r: r, a0: a0, a1: a1 }); arc.layer = h1.e.layer;
    ctx.add(arc);
  });
  def('CHAMFER', '모따기', ['CHA', '모따기'], function* (ctx) {
    var d1 = yield { type: 'number', prompt: '첫째 선 모따기 거리', def: ctx.state.chaD1 || 10 };
    var d2 = yield { type: 'number', prompt: '둘째 선 모따기 거리', def: ctx.state.chaD2 || d1 };
    if (!(d1 >= 0 && d2 >= 0)) return;
    ctx.state.chaD1 = d1; ctx.state.chaD2 = d2;
    var h1 = yield { type: 'entity', prompt: '첫째 선', filter: function (e) { return e.type === 'line'; } };
    var h2 = yield { type: 'entity', prompt: '둘째 선', filter: function (e) { return e.type === 'line' && e !== h1.e; } };
    var cl = cornerLines(ctx, h1, h2);
    if (!cl) { ctx.msg('두 선이 평행합니다.'); return; }
    if (d1 > cl.s1.len + 1e-9 || d2 > cl.s2.len + 1e-9) { ctx.msg('모따기 거리가 선보다 깁니다.'); return; }
    var C1 = G.add(cl.X, G.mul(cl.s1.u, d1)), C2 = G.add(cl.X, G.mul(cl.s2.u, d2));
    ctx.change();
    h1.e[cl.s1.far === 'a' ? 'b' : 'a'] = C1; h2.e[cl.s2.far === 'a' ? 'b' : 'a'] = C2;
    ctx.modified();
    if (G.dist(C1, C2) > 1e-9) { var ln = ctx.tmp('line', { a: C1, b: C2 }); ln.layer = h1.e.layer; ctx.add(ln); }
  });
  def('ARRAY', '직사각 배열', ['AR', '배열'], function* (ctx) {
    var s = yield* selectEnts(ctx);
    if (!s.length) return;
    var rows = yield { type: 'number', prompt: '행 수 (세로 개수)', def: 1 };
    var cols = yield { type: 'number', prompt: '열 수 (가로 개수)', def: 3 };
    rows = Math.max(1, Math.round(rows || 1)); cols = Math.max(1, Math.round(cols || 1));
    var dy = rows > 1 ? yield { type: 'number', prompt: '행 간격 (위쪽 +)', def: 1000 } : 0;
    var dx = cols > 1 ? yield { type: 'number', prompt: '열 간격 (오른쪽 +)', def: 1000 } : 0;
    if (rows * cols > 5000) { ctx.msg('개수가 너무 많습니다 (5000개 이하).'); return; }
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (!r && !c) continue;
      cloneMove(s, M.move(c * dx, r * dy)).forEach(function (e) { ctx.add(e); });
    }
  });
  def('ARRAYPOLAR', '원형 배열', ['ARP', '원형배열'], function* (ctx) {
    var s = yield* selectEnts(ctx);
    if (!s.length) return;
    var c = yield { type: 'point', prompt: '배열 중심' };
    var n = yield { type: 'number', prompt: '전체 개수 (원본 포함)', def: 6 };
    n = Math.max(2, Math.round(n || 2));
    var fill = yield { type: 'number', prompt: '채울 각도 (360이면 한 바퀴)', def: 360 };
    fill = fill || 360;
    var step = Math.abs(fill) >= 360 ? 360 / n : fill / (n - 1);
    for (var i = 1; i < n; i++) cloneMove(s, M.rot(G.rad(step * i), c)).forEach(function (e) { ctx.add(e); });
  });
  def('EXPLODE', '분해', ['X', '분해'], function* (ctx) {
    var s = yield* selectEnts(ctx);
    var n = 0;
    s.forEach(function (e) {
      var parts = Model.explode(e, ctx.doc);
      if (parts && parts.length) { ctx.replace(e, parts); n++; }
    });
    ctx.msg(n ? n + '개를 분해했습니다.' : '분해할 수 있는 객체(블록·폴리선·치수·여러 줄 문자)가 없습니다.');
  });
  def('JOIN', '결합', ['J', '결합'], function* (ctx) {
    var s = yield* selectEnts(ctx, '이을 선·호·폴리선 선택');
    var parts = s.filter(function (e) { return /^(line|arc|poly)$/.test(e.type) && !(e.type === 'poly' && e.closed); });
    if (parts.length < 2) { ctx.msg('이을 객체가 둘 이상 필요합니다.'); return; }
    // 각 조각을 (점열, 볼록값) 꼴로
    function chain(e) {
      if (e.type === 'line') return [{ x: e.a.x, y: e.a.y }, { x: e.b.x, y: e.b.y }];
      if (e.type === 'arc') { var sw = G.sweep(e.a0, e.a1), p0 = G.polar(e.c, e.r, e.a0), p1 = G.polar(e.c, e.r, e.a1); return [{ x: p0.x, y: p0.y, bulge: Math.tan(sw / 4) }, { x: p1.x, y: p1.y }]; }
      return e.pts.map(function (p) { var o = { x: p.x, y: p.y }; if (p.bulge) o.bulge = p.bulge; return o; });
    }
    function rev(c) {
      var out = [];
      for (var i = c.length - 1; i >= 0; i--) { var o = { x: c[i].x, y: c[i].y }; var b = i > 0 ? c[i - 1].bulge : 0; if (b) o.bulge = -b; out.push(o); }
      return out;
    }
    var pool = parts.map(chain), cur = pool.shift(), tol = Math.max(1e-6, ctx.pickTol() * 0.5), used = [parts[0]], left = parts.slice(1);
    var grew = true;
    while (grew && pool.length) {
      grew = false;
      for (var i = 0; i < pool.length; i++) {
        var c = pool[i], head = cur[0], tail = cur[cur.length - 1];
        if (G.dist(tail, c[0]) <= tol) { cur = cur.slice(0, -1).concat([Object.assign({}, tail, c[0].bulge ? { bulge: c[0].bulge } : {})]).concat(c.slice(1)); }
        else if (G.dist(tail, c[c.length - 1]) <= tol) { var r = rev(c); cur = cur.slice(0, -1).concat([Object.assign({}, tail, r[0].bulge ? { bulge: r[0].bulge } : {})]).concat(r.slice(1)); }
        else if (G.dist(head, c[c.length - 1]) <= tol) { cur = c.slice(0, -1).concat([Object.assign({}, c[c.length - 1], cur[0].bulge ? { bulge: cur[0].bulge } : {})]).concat(cur.slice(1)); }
        else if (G.dist(head, c[0]) <= tol) { var r2 = rev(c); cur = r2.slice(0, -1).concat([Object.assign({}, r2[r2.length - 1], cur[0].bulge ? { bulge: cur[0].bulge } : {})]).concat(cur.slice(1)); }
        else continue;
        used.push(left[i]); pool.splice(i, 1); left.splice(i, 1); grew = true; break;
      }
    }
    var closed = cur.length > 2 && G.dist(cur[0], cur[cur.length - 1]) <= tol;
    if (closed) cur.pop();
    cur = cur.map(function (p) { var o = { x: p.x, y: p.y }; if (p.bulge) o.bulge = p.bulge; return o; });
    var e = ctx.tmp('poly', { pts: cur, closed: closed });
    e.layer = used[0].layer; e.color = used[0].color; e.ltype = used[0].ltype;
    ctx.remove(used);
    ctx.add(e);
    ctx.msg(used.length + '개를 폴리선 하나로 이었습니다' + (closed ? ' (닫힘).' : '.') + (pool.length ? ' 이어지지 않은 ' + pool.length + '개는 그대로 둡니다.' : ''));
  });

  // ---- 조회 ----
  def('DIST', '거리 재기', ['DI', '거리'], function* (ctx) {
    var a = yield { type: 'point', prompt: '첫 점' };
    var b = yield { type: 'point', prompt: '둘째 점', base: a };
    var d = G.dist(a, b);
    ctx.msg('거리 ' + G.fmt(d, 2) + ' mm (' + G.fmt(d / 1000, 3) + ' m), 가로 ' + G.fmt(b.x - a.x, 2) + ', 세로 ' + G.fmt(b.y - a.y, 2) + ', 각도 ' + G.fmt(G.deg(G.normAng(G.angle(a, b))), 2) + '°');
  });
  function areaMsg(ctx, a, per) {
    var m2 = Math.abs(a) / 1e6;
    ctx.msg('넓이 ' + G.fmt(m2, 3) + ' m² (' + G.fmt(m2 / 3.305785, 2) + '평), 둘레 ' + G.fmt(per, 1) + ' mm');
  }
  def('AREA', '넓이 재기', ['AA', '넓이', '면적'], function* (ctx) {
    var p = yield { type: 'point', prompt: '첫 점 (객체로 재려면 O)', kw: { O: '객체' } };
    if (p.kw === 'O') {
      var hit = yield { type: 'entity', prompt: '닫힌 폴리선·원·타원 선택', filter: function (e) { return (e.type === 'poly' && e.closed) || e.type === 'circle' || e.type === 'ellipse'; } };
      var e = hit.e, a;
      if (e.type === 'circle') a = Math.PI * e.r * e.r;
      else if (e.type === 'ellipse') a = Math.PI * G.len(e.major) * G.len(e.major) * e.ratio;
      else a = polyAreaBulge(e.pts, true);
      areaMsg(ctx, a, entLength(e, ctx.doc));
      return;
    }
    var pts = [p];
    while (true) {
      var q = yield { type: 'point', prompt: '다음 점 (끝나면 Enter)', base: pts[pts.length - 1], allowNone: true, preview: function (x) { return [ctx.tmp('poly', { pts: pts.concat([x]), closed: true })]; } };
      if (!q) break;
      pts.push(q);
    }
    if (pts.length < 3) { ctx.msg('점이 셋 이상 필요합니다.'); return; }
    var per = 0;
    for (var i = 0; i < pts.length; i++) per += G.dist(pts[i], pts[(i + 1) % pts.length]);
    areaMsg(ctx, G.polyArea(pts), per);
  });

  def('ZOOMEXT', '전체 보기', ['Z', 'ZE', '전체보기'], function* (ctx) { ctx.zoomExtents(); });

  // 그립 편집 (내부 명령)
  def('_GRIP', '그립 편집', [], function* (ctx, pre) {
    var e = pre.e, grip = pre.grip;
    var to = yield {
      type: 'point', prompt: '새 위치', base: grip.p,
      preview: function (p) { return [applyGrip(Model.clone(e), grip, grip.p, p)]; }
    };
    ctx.change();
    applyGrip(e, grip, grip.p, to);
    ctx.modified();
  });

  // 별칭 표
  var ALIAS = {};
  Object.keys(C).forEach(function (k) {
    ALIAS[k] = k;
    C[k].aliases.forEach(function (a) { ALIAS[a.toUpperCase()] = k; });
  });

  NS.Commands = {
    defs: C, alias: ALIAS, parsePoint: parsePoint, evalNum: evalNum, ortho: ortho, offsetPts: offsetPts,
    polyAreaBulge: polyAreaBulge, trimEntity: trimEntity, interPts: interPts, gripsOf: gripsOf, applyGrip: applyGrip,
    entLength: entLength
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
