// 기하 계산: 벡터, 교점, 호/볼록(bulge), 경계 상자, 행렬.
// 좌표 단위는 mm, Y축은 위쪽이 +. 각도는 라디안, 반시계 방향이 +.
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var EPS = 1e-9;
  var TAU = Math.PI * 2;

  function v(x, y) { return { x: x, y: y }; }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function mul(a, k) { return { x: a.x * k, y: a.y * k }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function cross(a, b) { return a.x * b.y - a.y * b.x; }
  function len(a) { return Math.hypot(a.x, a.y); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function norm(a) { var l = len(a); return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; }
  function perp(a) { return { x: -a.y, y: a.x }; }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function eq(a, b, tol) { return dist(a, b) <= (tol || 1e-7); }
  function angle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
  function polar(c, r, ang) { return { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) }; }
  function rotate(p, c, ang) {
    var s = Math.sin(ang), co = Math.cos(ang), dx = p.x - c.x, dy = p.y - c.y;
    return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
  }
  function normAng(a) { a = a % TAU; if (a < 0) a += TAU; return a; }
  // 반시계 방향 호 a0 -> a1 의 각도 크기 (0이면 한 바퀴로 본다)
  function sweep(a0, a1) { var s = normAng(a1 - a0); return s < 1e-12 ? TAU : s; }
  function angInArc(a, a0, a1) { return normAng(a - a0) <= sweep(a0, a1) + 1e-12; }
  function deg(r) { return r * 180 / Math.PI; }
  function rad(d) { return d * Math.PI / 180; }

  // 선분 a-b 위에서 p에 가장 가까운 점
  function segClosest(p, a, b) {
    var ab = sub(b, a), l2 = dot(ab, ab), t = 0;
    if (l2 > EPS) t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
    var q = lerp(a, b, t);
    return { pt: q, t: t, d: dist(p, q) };
  }
  // 무한 직선 위 투영
  function projectLine(p, a, b) {
    var ab = sub(b, a), l2 = dot(ab, ab);
    if (l2 < EPS) return { pt: a, t: 0 };
    var t = dot(sub(p, a), ab) / l2;
    return { pt: lerp(a, b, t), t: t };
  }
  // 두 직선(무한)의 교점. t,u는 각 선분의 매개변수.
  function lineLine(a1, a2, b1, b2) {
    var r = sub(a2, a1), s = sub(b2, b1), den = cross(r, s);
    if (Math.abs(den) < 1e-12 * (len(r) * len(s) + 1)) return null;
    var qp = sub(b1, a1);
    var t = cross(qp, s) / den, u = cross(qp, r) / den;
    return { pt: add(a1, mul(r, t)), t: t, u: u };
  }
  // 직선(무한) a-b 와 원의 교점들 (t는 a-b 매개변수)
  function lineCircle(a, b, c, r) {
    var d = sub(b, a), f = sub(a, c);
    var A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - r * r;
    if (A < EPS) return [];
    var disc = B * B - 4 * A * C;
    if (disc < -1e-9 * Math.max(1, Math.abs(B * B))) return [];
    disc = Math.max(0, disc);
    var sq = Math.sqrt(disc), out = [];
    var t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A);
    out.push({ pt: add(a, mul(d, t1)), t: t1 });
    if (sq > 1e-12) out.push({ pt: add(a, mul(d, t2)), t: t2 });
    return out;
  }
  function circleCircle(c1, r1, c2, r2) {
    var d = dist(c1, c2);
    if (d < EPS || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
    var a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    var h2 = r1 * r1 - a * a, h = h2 > 0 ? Math.sqrt(h2) : 0;
    var u = mul(sub(c2, c1), 1 / d), p = add(c1, mul(u, a));
    if (h < 1e-12) return [p];
    var n = perp(u);
    return [add(p, mul(n, h)), sub(p, mul(n, h))];
  }

  // 폴리선 볼록값(bulge) 구간 -> 호. bulge = tan(사잇각/4), +는 반시계.
  function bulgeArc(p1, p2, b) {
    var th = 4 * Math.atan(b), d = dist(p1, p2);
    if (Math.abs(b) < 1e-12 || d < EPS) return null;
    var r = d / (2 * Math.sin(Math.abs(th) / 2));
    var m = mid(p1, p2), n = perp(norm(sub(p2, p1)));
    var s = (d / 2) / Math.tan(th / 2);
    var c = add(m, mul(n, s));
    return { c: c, r: r, a0: angle(c, p1), a1: angle(c, p2), ccw: b > 0, th: th };
  }
  // 세 점을 지나는 호 (p1 -> p2 -> p3). 반환 호는 반시계 a0->a1.
  function arc3(p1, p2, p3) {
    var ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
    var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    var ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    var uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    var c = { x: ux, y: uy }, r = dist(c, p1);
    var s1 = angle(c, p1), s3 = angle(c, p3);
    var ccw = cross(sub(p2, p1), sub(p3, p2)) > 0;
    return ccw ? { c: c, r: r, a0: s1, a1: s3 } : { c: c, r: r, a0: s3, a1: s1 };
  }
  // 호를 점열로 (반시계 a0 -> a1). tol은 허용 현 높이(mm).
  function arcPoints(c, r, a0, a1, tol, full) {
    var sw = full ? TAU : sweep(a0, a1);
    var n = segCount(r, sw, tol);
    var pts = [];
    for (var i = 0; i <= n; i++) pts.push(polar(c, r, a0 + sw * i / n));
    return pts;
  }
  function segCount(r, sw, tol) {
    tol = tol || r / 200;
    var step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 4;
    step = Math.max(step, TAU / 1440);
    return Math.max(2, Math.min(720, Math.ceil(sw / step)));
  }
  function bulgePoints(p1, p2, b, tol) {
    var arc = bulgeArc(p1, p2, b);
    if (!arc) return [p1, p2];
    var n = segCount(arc.r, Math.abs(arc.th), tol), pts = [];
    for (var i = 0; i <= n; i++) pts.push(polar(arc.c, arc.r, arc.a0 + arc.th * i / n));
    return pts;
  }

  // 경계 상자
  function box() { return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; }
  function boxAdd(bx, p) {
    if (p.x < bx.x0) bx.x0 = p.x; if (p.y < bx.y0) bx.y0 = p.y;
    if (p.x > bx.x1) bx.x1 = p.x; if (p.y > bx.y1) bx.y1 = p.y;
    return bx;
  }
  function boxUnion(a, b) {
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
  }
  function boxValid(b) { return b && b.x0 <= b.x1 && b.y0 <= b.y1; }
  function boxHit(a, b) { return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0; }
  function boxInside(inner, outer) {
    return inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;
  }
  function boxHas(b, p) { return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1; }
  function boxGrow(b, d) { return { x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d }; }
  function boxFrom(a, b) {
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  }
  function arcBox(c, r, a0, a1) {
    var b = box();
    boxAdd(b, polar(c, r, a0)); boxAdd(b, polar(c, r, a1));
    for (var k = 0; k < 4; k++) { var q = k * Math.PI / 2; if (angInArc(q, a0, a1)) boxAdd(b, polar(c, r, q)); }
    return b;
  }
  // 선분이 상자와 만나는지 (교차 선택용)
  function segHitsBox(a, b, bx) {
    if (boxHas(bx, a) || boxHas(bx, b)) return true;
    var c = [v(bx.x0, bx.y0), v(bx.x1, bx.y0), v(bx.x1, bx.y1), v(bx.x0, bx.y1)];
    for (var i = 0; i < 4; i++) {
      var r = lineLine(a, b, c[i], c[(i + 1) % 4]);
      if (r && r.t >= -EPS && r.t <= 1 + EPS && r.u >= -EPS && r.u <= 1 + EPS) return true;
    }
    return false;
  }
  function polyArea(pts) {
    var s = 0;
    for (var i = 0, n = pts.length; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; s += a.x * b.y - b.x * a.y; }
    return s / 2;
  }
  function pointInPoly(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  // 2D 아핀 행렬 {a,b,c,d,e,f}: x' = a x + c y + e, y' = b x + d y + f (캔버스와 같은 꼴)
  var M = {
    id: function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    mul: function (m, n) { // m * n (n을 먼저 적용)
      return {
        a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
        c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
        e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f
      };
    },
    move: function (dx, dy) { return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy }; },
    rot: function (ang, c) {
      var s = Math.sin(ang), co = Math.cos(ang), cx = c ? c.x : 0, cy = c ? c.y : 0;
      return { a: co, b: s, c: -s, d: co, e: cx - co * cx + s * cy, f: cy - s * cx - co * cy };
    },
    scale: function (sx, sy, c) {
      var cx = c ? c.x : 0, cy = c ? c.y : 0;
      return { a: sx, b: 0, c: 0, d: sy, e: cx - sx * cx, f: cy - sy * cy };
    },
    mirror: function (p1, p2) { // p1-p2 직선에 대한 대칭
      var ang = angle(p1, p2), c2 = Math.cos(2 * ang), s2 = Math.sin(2 * ang);
      var m = { a: c2, b: s2, c: s2, d: -c2, e: 0, f: 0 };
      var q = M.apply(m, p1);
      m.e = p1.x - q.x; m.f = p1.y - q.y;
      return m;
    },
    apply: function (m, p) { return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; },
    vec: function (m, p) { return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y }; },
    det: function (m) { return m.a * m.d - m.b * m.c; },
    inv: function (m) {
      var det = m.a * m.d - m.b * m.c;
      if (Math.abs(det) < 1e-18) return M.id();
      var a = m.d / det, b = -m.b / det, c = -m.c / det, d = m.a / det;
      return { a: a, b: b, c: c, d: d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
    },
    // 균일 축척 크기 (비균일이면 평균)
    scaleOf: function (m) { return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); },
    isUniform: function (m) {
      var sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
      return Math.abs(sx - sy) <= 1e-9 * Math.max(1, sx) && Math.abs(m.a * m.c + m.b * m.d) <= 1e-9 * Math.max(1, sx * sy);
    }
  };

  // 숫자 표시: 소수 dec자리, 뒤쪽 0 정리
  function fmt(n, dec) {
    if (dec === undefined) dec = 3;
    var s = (Math.abs(n) < 1e-12 ? 0 : n).toFixed(dec);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }

  NS.G = {
    EPS: EPS, TAU: TAU, v: v, add: add, sub: sub, mul: mul, dot: dot, cross: cross, len: len, dist: dist,
    norm: norm, perp: perp, mid: mid, lerp: lerp, eq: eq, angle: angle, polar: polar, rotate: rotate,
    normAng: normAng, sweep: sweep, angInArc: angInArc, deg: deg, rad: rad,
    segClosest: segClosest, projectLine: projectLine, lineLine: lineLine, lineCircle: lineCircle,
    circleCircle: circleCircle, bulgeArc: bulgeArc, arc3: arc3, arcPoints: arcPoints, bulgePoints: bulgePoints,
    segCount: segCount, box: box, boxAdd: boxAdd, boxUnion: boxUnion, boxValid: boxValid, boxHit: boxHit,
    boxInside: boxInside, boxHas: boxHas, boxGrow: boxGrow, boxFrom: boxFrom, arcBox: arcBox,
    segHitsBox: segHitsBox, polyArea: polyArea, pointInPoly: pointInPoly, M: M, fmt: fmt
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
