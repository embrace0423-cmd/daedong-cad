// 선으로 둘러싼 영역 찾기 (해치 경계). 보이는 선·호·원·폴리선·블록 모양을 교점에서 나눠 평면 그래프를 만들고,
// 클릭한 점을 둘러싼 가장 작은 면(반시계 순환)과 그 바로 안쪽 섬(다른 덩어리의 바깥 테두리)을 돌려준다.
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var G = NS.G, Model = NS.Model;

  // 개체들 → 선분 목록 (호·원은 잘게 나눔)
  function segmentsOf(ents, doc, tol) {
    var segs = [];
    function addPts(pts, closed) {
      for (var i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
      if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
    }
    ents.forEach(function (e) {
      if (e.type === 'hatch' || e.type === 'image' || e.type === 'text' || e.type === 'mtext' || e.type === 'dim' || e.type === 'point') return;
      Model.prims(e, doc).forEach(function (pr) {
        if (pr.hp || pr.hb) return;
        if (pr.k === 'L') segs.push([pr.a, pr.b]);
        else if (pr.k === 'P') { if (!pr.fill) addPts(pr.pts, pr.closed); }
        else if (pr.k === 'A') addPts(G.arcPoints(pr.c, pr.r, pr.a0, pr.a1, tol));
        else if (pr.k === 'C') addPts(G.arcPoints(pr.c, pr.r, 0, 0, tol, true));
      });
    });
    return segs.filter(function (s) { return G.dist(s[0], s[1]) > 1e-12; });
  }

  function find(ents, doc, p, opts) {
    opts = opts || {};
    var bx = G.box();
    ents.forEach(function (e) { var b = Model.bounds(e, doc); if (G.boxValid(b)) bx = G.boxUnion(bx, b); });
    if (!G.boxValid(bx)) return null;
    var diag = Math.hypot(bx.x1 - bx.x0, bx.y1 - bx.y0) || 1;
    var tol = opts.tol || diag / 20000, eps = Math.max(1e-7, diag * 1e-9);
    var segs = segmentsOf(ents, doc, tol);
    if (segs.length > (opts.limit || 40000)) return { tooMany: segs.length };
    if (!segs.length) return null;

    // 1) 격자로 후보 쌍을 줄여 교점 찾기
    var cell = Math.max(diag / Math.max(8, Math.sqrt(segs.length) * 2), eps * 10), grid = new Map();
    function key(i, j) { return i + ',' + j; }
    segs.forEach(function (s, idx) {
      var i0 = Math.floor(Math.min(s[0].x, s[1].x) / cell), i1 = Math.floor(Math.max(s[0].x, s[1].x) / cell);
      var j0 = Math.floor(Math.min(s[0].y, s[1].y) / cell), j1 = Math.floor(Math.max(s[0].y, s[1].y) / cell);
      for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++) { var k = key(i, j), l = grid.get(k); if (!l) grid.set(k, l = []); l.push(idx); }
    });
    var cuts = segs.map(function () { return [0, 1]; });
    var seen = new Set();
    grid.forEach(function (list) {
      for (var a = 0; a < list.length; a++) for (var b = a + 1; b < list.length; b++) {
        var i = list[a], j = list[b], pk = i < j ? i * 1e7 + j : j * 1e7 + i;
        if (seen.has(pk)) continue;
        seen.add(pk);
        inter(segs[i], segs[j], cuts[i], cuts[j]);
      }
    });
    function inter(s1, s2, c1, c2) {
      var A = s1[0], B = s1[1], C = s2[0], D = s2[1];
      var r = G.sub(B, A), s = G.sub(D, C), den = G.cross(r, s), lr = G.len(r), ls = G.len(s);
      if (Math.abs(den) > 1e-12 * lr * ls) {
        var q = G.sub(C, A), t = G.cross(q, s) / den, u = G.cross(q, r) / den, dt = eps / lr, du = eps / ls;
        if (t >= -dt && t <= 1 + dt && u >= -du && u <= 1 + du) { c1.push(Math.max(0, Math.min(1, t))); c2.push(Math.max(0, Math.min(1, u))); }
        return;
      }
      if (Math.abs(G.cross(G.sub(C, A), r)) > eps * lr) return; // 평행하지만 다른 줄
      // 같은 줄 위에서 겹치면 서로의 끝점에서 나눈다
      [C, D].forEach(function (P) { var t2 = G.dot(G.sub(P, A), r) / (lr * lr); if (t2 > 0 && t2 < 1) c1.push(t2); });
      [A, B].forEach(function (P) { var u2 = G.dot(G.sub(P, C), s) / (ls * ls); if (u2 > 0 && u2 < 1) c2.push(u2); });
    }

    // 2) 꼭짓점 합치기와 변 만들기
    var vxs = [], vgrid = new Map(), q = eps * 4;
    function vid(P) {
      var gi = Math.floor(P.x / q), gj = Math.floor(P.y / q);
      for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) {
        var l = vgrid.get(key(gi + di, gj + dj));
        if (l) for (var k = 0; k < l.length; k++) if (G.dist(vxs[l[k]], P) <= q) return l[k];
      }
      var id = vxs.length; vxs.push({ x: P.x, y: P.y });
      var kk = key(gi, gj), ll = vgrid.get(kk); if (!ll) vgrid.set(kk, ll = []); ll.push(id);
      return id;
    }
    var adj = new Map(), edgeSet = new Set();
    function link(a, b) {
      if (a === b) return;
      var ek = a < b ? a + '_' + b : b + '_' + a;
      if (edgeSet.has(ek)) return;
      edgeSet.add(ek);
      if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b); adj.get(b).add(a);
    }
    segs.forEach(function (s, i) {
      var ts = cuts[i].sort(function (x, y) { return x - y; }), prev = null;
      ts.forEach(function (t) { var id = vid(G.lerp(s[0], s[1], t)); if (prev !== null) link(prev, id); prev = id; });
    });
    // 3) 끝이 매달린 선 지우기
    var changed = true;
    while (changed) {
      changed = false;
      adj.forEach(function (ns, v) { if (ns.size <= 1) { ns.forEach(function (w) { adj.get(w).delete(v); }); adj.delete(v); changed = true; } });
    }
    if (!adj.size) return null;
    // 4) 꼭짓점마다 이웃을 각도순으로, 반쪽 변마다 다음 변 = 들어온 곳에서 시계 방향으로 첫 이웃
    var order = new Map();
    adj.forEach(function (ns, v) {
      var arr = Array.from(ns);
      arr.sort(function (a, b) { return Math.atan2(vxs[a].y - vxs[v].y, vxs[a].x - vxs[v].x) - Math.atan2(vxs[b].y - vxs[v].y, vxs[b].x - vxs[v].x); });
      order.set(v, arr);
    });
    var visited = new Set(), cycles = [];
    adj.forEach(function (ns, u) {
      ns.forEach(function (v) {
        var hk = u + '>' + v;
        if (visited.has(hk)) return;
        var cyc = [], a = u, b = v, guard = 0;
        while (guard++ < 200000) {
          var k = a + '>' + b;
          if (visited.has(k)) break;
          visited.add(k); cyc.push(a);
          var arr = order.get(b), idx = arr.indexOf(a), w = arr[(idx - 1 + arr.length) % arr.length];
          a = b; b = w;
        }
        if (cyc.length >= 3) {
          var pts = cyc.map(function (i) { return vxs[i]; });
          cycles.push({ pts: pts, area: G.polyArea(pts), ids: cyc });
        }
      });
    });
    // 5) 점을 둘러싼 가장 작은 반시계 순환 = 바깥 경계
    var outer = null;
    cycles.forEach(function (c) {
      if (c.area <= eps * eps) return;
      c.box = G.box(); c.pts.forEach(function (P) { G.boxAdd(c.box, P); });
      if (!G.boxHas(c.box, p) || !G.pointInPoly(p, c.pts)) return;
      if (!outer || c.area < outer.area) outer = c;
    });
    if (!outer) return null;
    // 6) 섬: 다른 덩어리의 바깥 테두리(시계 순환) 중 바깥 경계 안에 있고 점을 품지 않는 것, 그중 바로 안쪽만
    var outerIds = new Set(outer.ids);
    var islands = cycles.filter(function (c) {
      if (c.area >= -eps * eps) return false;
      if (c.ids.some(function (i) { return outerIds.has(i); })) return false;
      if (!c.box) { c.box = G.box(); c.pts.forEach(function (P) { G.boxAdd(c.box, P); }); }
      if (!G.boxInside(c.box, G.boxGrow(outer.box, eps))) return false;
      return G.pointInPoly(c.pts[0], outer.pts) && !G.pointInPoly(p, c.pts);
    });
    islands = islands.filter(function (c) {
      return !islands.some(function (o) { return o !== c && -o.area > -c.area && G.boxInside(c.box, G.boxGrow(o.box, eps)) && G.pointInPoly(c.pts[0], o.pts); });
    });
    var clean = function (pts) { return pts.map(function (P) { return { x: P.x, y: P.y }; }); };
    return { loops: [clean(outer.pts)].concat(islands.map(function (c) { return clean(c.pts).reverse(); })), outerArea: outer.area };
  }

  NS.Region = { find: find, segmentsOf: segmentsOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
