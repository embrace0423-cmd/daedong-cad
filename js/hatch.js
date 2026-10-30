// 해치(채우기): 무늬 정의, 무늬 선 만들기(경계 안만 남기기), 단색 채우기를 사다리꼴로 나누기.
// 무늬 한 줄 묶음(family) = {a: 각도, p: 기준점, d: 다음 줄까지의 이동(월드 벡터), dash: [길이]}
// DXF HATCH의 무늬 선(53·43·44·45·46·49)과 같은 꼴이다.
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var G = NS.G;

  // 무늬: [각도°, 기준x, 기준y, 줄 방향 밀림, 줄 간격, 대시...] (종이 mm, 축척을 곱해 쓴다)
  var PATTERNS = {
    SOLID: { label: '채우기 (단색)', solid: true },
    LINE45: { label: '사선 (단면)', fams: [[45, 0, 0, 0, 3]] },
    LINE135: { label: '역사선', fams: [[135, 0, 0, 0, 3]] },
    CROSS: { label: '격자', fams: [[0, 0, 0, 0, 4], [90, 0, 0, 0, 4]] },
    CROSS45: { label: '사선 격자', fams: [[45, 0, 0, 0, 3], [135, 0, 0, 0, 3]] },
    INSUL: { label: '단열재 (촘촘한 사선 격자)', fams: [[45, 0, 0, 0, 1.5], [135, 0, 0, 0, 1.5]] },
    BRICK: { label: '벽돌', fams: [[0, 0, 0, 0, 5], [90, 0, 0, 5, 5, 5, -5]] },
    TILE: { label: '타일 (큰 격자)', fams: [[0, 0, 0, 0, 10], [90, 0, 0, 0, 10]] },
    GRASS: { label: '잔디', fams: [[90, 0, 0, 2.5, 3.5, 1.2, -5.8], [90, 1.75, 3.5, 2.5, 3.5, 0, -7]] },
    DOTS: { label: '점 (자갈·모래)', fams: [[0, 0, 0, 1.5, 3, 0, -3]] },
    WATER: { label: '물·수경', fams: [[0, 0, 0, 4, 4, 8, -4]] }
  };

  // 무늬 이름·축척(월드 배율)·각도 → 월드 무늬 묶음
  function families(pat, scale, ang) {
    var P = PATTERNS[pat];
    if (!P || P.solid) return [];
    ang = ang || 0; scale = scale || 1;
    return P.fams.map(function (f) {
      var a = G.rad(f[0]) + ang, u = G.v(Math.cos(a), Math.sin(a)), n = G.perp(u);
      return {
        a: G.normAng(a),
        p: G.rotate(G.v(f[1] * scale, f[2] * scale), G.v(0, 0), ang),
        d: G.add(G.mul(u, f[3] * scale), G.mul(n, f[4] * scale)),
        dash: f.slice(5).map(function (x) { return x * scale; })
      };
    });
  }

  // 경계(볼록값 포함) → 다각형 점열
  function loopPoints(loop, tol) {
    var out = [], n = loop.length;
    for (var i = 0; i < n; i++) {
      var a = loop[i], b = loop[(i + 1) % n];
      out.push({ x: a.x, y: a.y });
      if (a.bulge) {
        var pts = G.bulgePoints(a, b, a.bulge, tol);
        for (var k = 1; k < pts.length - 1; k++) out.push(pts[k]);
      }
    }
    return out;
  }
  function loopsBox(polys) {
    var b = G.box();
    polys.forEach(function (pl) { pl.forEach(function (p) { G.boxAdd(b, p); }); });
    return b;
  }
  function polysOf(e) {
    var b = G.box();
    e.loops.forEach(function (l) { l.forEach(function (p) { G.boxAdd(b, p); }); });
    var diag = G.boxValid(b) ? Math.hypot(b.x1 - b.x0, b.y1 - b.y0) : 1;
    return e.loops.map(function (l) { return loopPoints(l, diag / 3000); }).filter(function (p) { return p.length >= 3; });
  }

  // 무늬 선 만들기. limit을 넘으면 {dense:true}
  function segments(e, limit) {
    limit = limit || 60000;
    var polys = polysOf(e), out = [], dense = false;
    if (!polys.length) return { segs: out, dense: false };
    var bx = loopsBox(polys), corners = [G.v(bx.x0, bx.y0), G.v(bx.x1, bx.y0), G.v(bx.x1, bx.y1), G.v(bx.x0, bx.y1)];
    var edges = [];
    polys.forEach(function (pl) { for (var i = 0; i < pl.length; i++) edges.push([pl[i], pl[(i + 1) % pl.length]]); });
    (e.fams || []).forEach(function (f) {
      if (dense) return;
      var u = G.v(Math.cos(f.a), Math.sin(f.a)), n = G.perp(u);
      var sp = G.dot(f.d, n), sh = G.dot(f.d, u);
      if (Math.abs(sp) < 1e-9) return;
      var t0 = Infinity, t1 = -Infinity;
      corners.forEach(function (c) { var t = G.dot(G.sub(c, f.p), n); t0 = Math.min(t0, t); t1 = Math.max(t1, t); });
      var k0 = Math.ceil(Math.min(t0 / sp, t1 / sp) - 1e-9), k1 = Math.floor(Math.max(t0 / sp, t1 / sp) + 1e-9);
      if (k1 - k0 > limit) { dense = true; return; }
      var period = 0;
      f.dash.forEach(function (x) { period += Math.abs(x); });
      for (var k = k0; k <= k1; k++) {
        var o = G.add(f.p, G.mul(f.d, k));
        // 경계와 만나는 곳 (반열린 규칙으로 꼭짓점을 두 번 세지 않음)
        var ss = [];
        for (var j = 0; j < edges.length; j++) {
          var A = edges[j][0], B = edges[j][1];
          var da = G.dot(G.sub(A, o), n), db = G.dot(G.sub(B, o), n);
          if ((da > 0) === (db > 0)) continue;
          var q = G.lerp(A, B, da / (da - db));
          ss.push(G.dot(G.sub(q, o), u));
        }
        if (ss.length < 2) continue;
        ss.sort(function (x, y) { return x - y; });
        for (var m = 0; m + 1 < ss.length; m += 2) {
          var s0 = ss[m], s1 = ss[m + 1];
          if (s1 - s0 < 1e-9) continue;
          if (!f.dash.length || period < 1e-9) { out.push([G.add(o, G.mul(u, s0)), G.add(o, G.mul(u, s1))]); }
          else {
            var x = Math.floor(s0 / period) * period, guard = 0;
            while (x < s1 && guard++ < 100000) {
              for (var di = 0; di < f.dash.length && x < s1; di++) {
                var L = f.dash[di];
                if (L >= 0) {
                  var a0 = Math.max(x, s0), a1 = Math.min(x + L, s1);
                  if (L === 0 ? (x >= s0 && x <= s1) : a1 > a0) out.push([G.add(o, G.mul(u, L === 0 ? x : a0)), G.add(o, G.mul(u, L === 0 ? x : a1))]);
                }
                x += Math.abs(L);
              }
            }
          }
          if (out.length > limit) { dense = true; return; }
        }
      }
    });
    return { segs: dense ? [] : out, dense: dense };
  }

  // 단색 채우기 → 가로 띠 사다리꼴 [p1(아래 왼),p2(아래 오른),p3(위 오른),p4(위 왼)]
  function trapezoids(e) {
    var polys = polysOf(e), edges = [], ys = [];
    polys.forEach(function (pl) {
      for (var i = 0; i < pl.length; i++) { edges.push([pl[i], pl[(i + 1) % pl.length]]); ys.push(pl[i].y); }
    });
    ys.sort(function (a, b) { return a - b; });
    var uy = [];
    ys.forEach(function (y) { if (!uy.length || y - uy[uy.length - 1] > 1e-9) uy.push(y); });
    var out = [];
    function xAt(ed, y) { var A = ed[0], B = ed[1]; return A.x + (B.x - A.x) * (y - A.y) / (B.y - A.y); }
    for (var i = 0; i + 1 < uy.length; i++) {
      var y0 = uy[i], y1 = uy[i + 1], ym = (y0 + y1) / 2, cross = [];
      edges.forEach(function (ed) {
        if ((ed[0].y > ym) !== (ed[1].y > ym)) cross.push({ ed: ed, xm: xAt(ed, ym) });
      });
      cross.sort(function (a, b) { return a.xm - b.xm; });
      for (var k = 0; k + 1 < cross.length; k += 2) {
        var L = cross[k].ed, R = cross[k + 1].ed;
        out.push([G.v(xAt(L, y0), y0), G.v(xAt(R, y0), y0), G.v(xAt(R, y1), y1), G.v(xAt(L, y1), y1)]);
      }
    }
    return out;
  }

  // 닫힌 개체 → 해치 경계 (볼록값 점열)
  function loopOf(ent) {
    if (ent.type === 'poly' && ent.closed) return ent.pts.map(function (p) { var o = { x: p.x, y: p.y }; if (p.bulge) o.bulge = p.bulge; return o; });
    if (ent.type === 'circle') return [{ x: ent.c.x + ent.r, y: ent.c.y, bulge: 1 }, { x: ent.c.x - ent.r, y: ent.c.y, bulge: 1 }];
    if (ent.type === 'ellipse') {
      var ep = NS.Model.ellipsePoints(ent, 96);
      if (!ep.full) return null;
      return ep.pts.slice(0, -1).map(function (p) { return { x: p.x, y: p.y }; });
    }
    return null;
  }
  function loopArea(loop) { return Math.abs(G.polyArea(loopPoints(loop, 0))); }

  NS.Hatch = { PATTERNS: PATTERNS, families: families, loopPoints: loopPoints, polysOf: polysOf, segments: segments, trapezoids: trapezoids, loopOf: loopOf, loopArea: loopArea };
})(typeof globalThis !== 'undefined' ? globalThis : this);
