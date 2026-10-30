// 화면 그리기 (HTML canvas). 월드 좌표(mm, Y 위쪽 +)를 화면 픽셀로 바꿔 그린다.
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var G = NS.G, Model = NS.Model, TAU = G.TAU;

  var SNAP_LABEL = { end: '끝점', mid: '중간점', cen: '중심', qua: '사분점', int: '교차점', nea: '근처점', ins: '삽입점', per: '수직점', grid: '격자' };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = { cx: 0, cy: 0, scale: 1 };
    this.dark = true;
    this.w = 0; this.h = 0; this.dpr = 1;
  }
  Renderer.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect(), dpr = g.devicePixelRatio || 1;
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height); this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
  };
  Renderer.prototype.toScreen = function (p) {
    var v = this.view;
    return { x: (p.x - v.cx) * v.scale + this.w / 2, y: this.h / 2 - (p.y - v.cy) * v.scale };
  };
  Renderer.prototype.toWorld = function (s) {
    var v = this.view;
    return { x: (s.x - this.w / 2) / v.scale + v.cx, y: (this.h / 2 - s.y) / v.scale + v.cy };
  };
  Renderer.prototype.viewBox = function () {
    var a = this.toWorld({ x: 0, y: this.h }), b = this.toWorld({ x: this.w, y: 0 });
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  };
  Renderer.prototype.zoomAt = function (s, factor) {
    var before = this.toWorld(s);
    this.view.scale = Math.max(1e-6, Math.min(1e6, this.view.scale * factor));
    var after = this.toWorld(s);
    this.view.cx += before.x - after.x; this.view.cy += before.y - after.y;
  };
  Renderer.prototype.fit = function (b, margin) {
    if (!G.boxValid(b)) { this.view = { cx: 0, cy: 0, scale: 1 }; return; }
    var w = Math.max(b.x1 - b.x0, 1e-6), h = Math.max(b.y1 - b.y0, 1e-6), m = margin || 0.08;
    this.view.cx = (b.x0 + b.x1) / 2; this.view.cy = (b.y0 + b.y1) / 2;
    this.view.scale = Math.min(this.w / (w * (1 + 2 * m)), this.h / (h * (1 + 2 * m)));
  };

  // 월드 좌표 그리기 설정
  Renderer.prototype.worldTransform = function (ctx) {
    var v = this.view, d = this.dpr;
    ctx.setTransform(d * v.scale, 0, 0, -d * v.scale, d * (this.w / 2 - v.cx * v.scale), d * (this.h / 2 + v.cy * v.scale));
  };

  Renderer.prototype.colors = function () {
    return this.dark
      ? { bg: '#1d2026', grid: 'rgba(255,255,255,0.05)', gridMajor: 'rgba(255,255,255,0.11)', sel: '#4fa8ff', hover: '#9fd0ff', preview: 'rgba(255,255,255,0.75)', snap: '#ffd34d', cross: 'rgba(255,255,255,0.85)', axisX: '#e05555', axisY: '#55c06a' }
      : { bg: '#ffffff', grid: 'rgba(0,0,0,0.05)', gridMajor: 'rgba(0,0,0,0.12)', sel: '#0a64d8', hover: '#3d8cf0', preview: 'rgba(0,0,0,0.7)', snap: '#d07a00', cross: 'rgba(0,0,0,0.8)', axisX: '#c62828', axisY: '#2e7d32' };
  };

  // state: {doc, sel:Set, hover, preview:[ents], snap:{p,kind}, rubber:{a,b,crossing}, grid:bool, cursor:{x,y}, grips:[p], ortho, base}
  Renderer.prototype.draw = function (state) {
    var ctx = this.ctx, C = this.colors(), doc = state.doc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (state.grid) this.drawGrid(doc, C);
    var vb = G.boxGrow(this.viewBox(), 1 / this.view.scale * 4);
    var self = this;
    this.worldTransform(ctx);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 0; i < doc.ents.length; i++) {
      var e = doc.ents[i], l = Model.layerOf(doc, e.layer);
      if (l && !l.visible) continue;
      var b = Model.bounds(e, doc);
      if (G.boxValid(b) && !G.boxHit(b, vb)) continue;
      var hi = state.sel && state.sel.has(e.id) ? 'sel' : state.hover === e.id ? 'hover' : null;
      self.drawEnt(ctx, doc, e, null, hi ? { color: hi === 'sel' ? C.sel : C.hover, width: 2, dash: hi === 'sel' ? [6, 3] : null } : null, 1, l && l.locked);
    }
    if (state.preview && state.preview.length) {
      state.preview.forEach(function (e) { self.drawEnt(ctx, doc, e, null, { color: C.preview, width: 1, dash: null, keepLtype: true }, 1); });
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);
    if (state.grips) this.drawGrips(state.grips, state.hotGrip, C);
    if (state.rubber) this.drawRubber(state.rubber, C);
    if (state.base && state.cursorWorld && state.rubberLine) this.drawRubberLine(state.base, state.cursorWorld, C);
    this.drawAxes(C);
    if (state.snap) this.drawSnap(state.snap, C);
    if (state.cursor) this.drawCursor(state.cursor, C, state.pickMode);
  };

  // 선 종류 무늬 (화면 픽셀)
  Renderer.prototype.dashFor = function (doc, name) {
    var lt = doc.ltypes[name] || Model.LTYPES[name];
    if (!lt || !lt.pat || !lt.pat.length) return null;
    var k = (doc.settings.ltscale || 1), px = this.view.scale, out = [];
    var total = 0;
    lt.pat.forEach(function (x) { total += Math.abs(x); });
    if (total * k * px < 6) return null; // 너무 촘촘하면 실선
    lt.pat.forEach(function (x) { out.push(Math.max(Math.abs(x) * k, x === 0 ? 0.5 / px : 0)); });
    if (out.length % 2) out = out.concat(out);
    return out; // 월드 단위 (캔버스 변환으로 픽셀이 된다)
  };

  // parent: 블록 안일 때 {e: insert, parent}, hi: 강조 스타일, unit: 현재 변환에서 1 화면픽셀의 길이 비
  Renderer.prototype.drawEnt = function (ctx, doc, e, parent, hi, unit, faded) {
    var px = 1 / this.view.scale / unit; // 1 css 픽셀 (현재 좌표계)
    var aci = Model.entAci(e, doc, parent);
    var color = hi ? hi.color : Model.aciRgb(aci, this.dark);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.globalAlpha = faded && !hi ? 0.55 : 1;
    ctx.lineWidth = px * (hi ? hi.width : 1);
    var dash = null;
    if (!hi || hi.keepLtype) {
      var lt = Model.entLtype(e, doc, parent);
      var d = this.dashFor(doc, lt);
      if (d) dash = d.map(function (x) { return x / unit; });
    } else if (hi.dash) dash = hi.dash.map(function (x) { return x * px; });
    ctx.setLineDash(dash || []);
    switch (e.type) {
      case 'line':
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke(); break;
      case 'circle':
        ctx.beginPath(); ctx.arc(e.c.x, e.c.y, Math.max(e.r, 0), 0, TAU); ctx.stroke(); break;
      case 'arc':
        ctx.beginPath(); ctx.arc(e.c.x, e.c.y, Math.max(e.r, 0), e.a0, e.a0 + G.sweep(e.a0, e.a1), false); ctx.stroke(); break;
      case 'ellipse': {
        var rx = G.len(e.major), t0 = e.t0 || 0, t1 = e.t1 === undefined ? TAU : e.t1;
        ctx.beginPath(); ctx.ellipse(e.c.x, e.c.y, rx, rx * e.ratio, Math.atan2(e.major.y, e.major.x), t0, t0 + G.sweep(t0, t1), false); ctx.stroke();
        break;
      }
      case 'poly': this.pathPoly(ctx, e.pts, e.closed); if (e.fill) ctx.fill(); ctx.stroke(); break;
      case 'hatch': {
        var pr = Model.prims(e, doc);
        ctx.setLineDash([]);
        if (e.solid) {
          ctx.beginPath();
          pr.forEach(function (q) { if (q.hb) { ctx.moveTo(q.pts[0].x, q.pts[0].y); for (var t = 1; t < q.pts.length; t++) ctx.lineTo(q.pts[t].x, q.pts[t].y); ctx.closePath(); } });
          if (!hi) { ctx.fill('evenodd'); break; }
          ctx.globalAlpha = 0.35; ctx.fill('evenodd'); ctx.globalAlpha = 1;
        } else {
          ctx.beginPath();
          pr.forEach(function (q) { if (q.hp) { ctx.moveTo(q.a.x, q.a.y); ctx.lineTo(q.b.x + (q.a.x === q.b.x && q.a.y === q.b.y ? px * 0.01 : 0), q.b.y); } });
          ctx.stroke();
        }
        if (hi || pr.dense) {
          // 고른 해치나 너무 촘촘한 해치는 경계를 보여 준다
          ctx.setLineDash(hi && hi.dash ? hi.dash.map(function (x) { return x * px; }) : [4 * px, 4 * px]);
          ctx.beginPath();
          pr.forEach(function (q) { if (q.hb) { ctx.moveTo(q.pts[0].x, q.pts[0].y); for (var t = 1; t < q.pts.length; t++) ctx.lineTo(q.pts[t].x, q.pts[t].y); ctx.closePath(); } });
          ctx.stroke();
        }
        break;
      }
      case 'point': {
        var s = px * 4;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(e.p.x - s, e.p.y); ctx.lineTo(e.p.x + s, e.p.y); ctx.moveTo(e.p.x, e.p.y - s); ctx.lineTo(e.p.x, e.p.y + s); ctx.stroke();
        break;
      }
      case 'text': this.drawText(ctx, e.p, e.h, e.rot || 0, String(e.s), e.align || 'L', e.valign || 'B', px); break;
      case 'mtext': {
        var lines = String(e.s).split('\n'), bx = Model.textBox(e), col = ((e.attach || 1) - 1) % 3;
        var wd = G.dist(bx[0], bx[1]);
        for (var i = 0; i < lines.length; i++) {
          var local = G.v(col * wd / 2, -i * e.h * 1.667 - e.h);
          this.drawText(ctx, G.add(bx[3], G.rotate(local, G.v(0, 0), e.rot || 0)), e.h, e.rot || 0, lines[i], col === 0 ? 'L' : col === 1 ? 'C' : 'R', 'B', px);
        }
        break;
      }
      case 'dim': {
        var dg = Model.dimGeom(e, doc);
        ctx.setLineDash([]);
        ctx.beginPath();
        dg.lines.forEach(function (l) { ctx.moveTo(l[0].x, l[0].y); ctx.lineTo(l[1].x, l[1].y); });
        ctx.stroke();
        dg.arrows.forEach(function (t) { ctx.beginPath(); ctx.moveTo(t[0].x, t[0].y); ctx.lineTo(t[1].x, t[1].y); ctx.lineTo(t[2].x, t[2].y); ctx.closePath(); ctx.fill(); });
        if (dg.text) this.drawText(ctx, dg.text.p, dg.text.h, dg.text.rot, dg.text.s, 'C', 'B', px);
        break;
      }
      case 'insert': {
        var blk = doc.blocks[e.name];
        if (!blk || (parent && parent.depth > 8)) break;
        var m = Model.insertMatrix(e, blk);
        ctx.save();
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        var k = unit * G.M.scaleOf(m) || unit;
        var par = { e: e, parent: parent, depth: parent ? parent.depth + 1 : 1 };
        for (var j = 0; j < blk.ents.length; j++) this.drawEnt(ctx, doc, blk.ents[j], par, hi, k, faded);
        ctx.restore();
        break;
      }
    }
    ctx.globalAlpha = 1;
  };
  Renderer.prototype.pathPoly = function (ctx, pts, closed) {
    if (!pts.length) return;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    var n = pts.length, last = closed ? n : n - 1;
    for (var i = 0; i < last; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      if (a.bulge) {
        var arc = G.bulgeArc(a, b, a.bulge);
        if (arc) { ctx.arc(arc.c.x, arc.c.y, arc.r, arc.a0, arc.a1, !arc.ccw); continue; }
      }
      ctx.lineTo(b.x, b.y);
    }
    if (closed) ctx.closePath();
  };
  Renderer.prototype.drawText = function (ctx, p, h, rot, s, align, valign, px) {
    if (!s) return;
    if (h / px < 1.2) { // 너무 작으면 선으로만
      var w = Model.textWidth(s, h), d = G.v(Math.cos(rot), Math.sin(rot));
      var x0 = align === 'C' ? -w / 2 : align === 'R' ? -w : 0;
      ctx.beginPath(); ctx.moveTo(p.x + d.x * x0, p.y + d.y * x0); ctx.lineTo(p.x + d.x * (x0 + w), p.y + d.y * (x0 + w)); ctx.stroke();
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(rot); ctx.scale(1, -1);
    // 글꼴 크기는 너무 작거나 크면 브라우저가 무시하므로 100px로 그리고 배율을 곱한다
    var k = h / 100;
    ctx.scale(k, k);
    ctx.font = '100px ' + NS.FONT;
    ctx.textAlign = align === 'C' ? 'center' : align === 'R' ? 'right' : 'left';
    ctx.textBaseline = valign === 'M' ? 'middle' : valign === 'T' ? 'top' : 'alphabetic';
    ctx.setLineDash([]);
    ctx.fillText(s, 0, 0);
    ctx.restore();
  };

  Renderer.prototype.drawGrid = function (doc, C) {
    var ctx = this.ctx, step = doc.settings.grid || 10, sc = this.view.scale;
    while (step * sc < 8) step *= step * sc < 2 ? 10 : 5;
    var vb = this.viewBox(), d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.lineWidth = 1;
    var x0 = Math.floor(vb.x0 / step), x1 = Math.ceil(vb.x1 / step), y0 = Math.floor(vb.y0 / step), y1 = Math.ceil(vb.y1 / step);
    if ((x1 - x0) * (y1 - y0) > 400000) return;
    for (var pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? C.gridMajor : C.grid;
      ctx.beginPath();
      for (var i = x0; i <= x1; i++) {
        if ((i % 10 === 0) !== !!pass) continue;
        var sx = Math.round(this.toScreen({ x: i * step, y: 0 }).x) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, this.h);
      }
      for (var j = y0; j <= y1; j++) {
        if ((j % 10 === 0) !== !!pass) continue;
        var sy = Math.round(this.toScreen({ x: 0, y: j * step }).y) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(this.w, sy);
      }
      ctx.stroke();
    }
  };
  Renderer.prototype.drawAxes = function (C) {
    var ctx = this.ctx, o = this.toScreen({ x: 0, y: 0 });
    var inside = o.x > 0 && o.x < this.w && o.y > 0 && o.y < this.h;
    var p = inside ? o : { x: 28, y: this.h - 28 };
    ctx.setLineDash([]); ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.axisX; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 26, p.y); ctx.stroke();
    ctx.strokeStyle = C.axisY; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 26); ctx.stroke();
    ctx.font = '10px sans-serif'; ctx.fillStyle = C.axisX; ctx.fillText('X', p.x + 28, p.y + 4);
    ctx.fillStyle = C.axisY; ctx.fillText('Y', p.x - 3, p.y - 29);
  };
  Renderer.prototype.drawCursor = function (s, C, pickMode) {
    var ctx = this.ctx;
    ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = C.cross;
    ctx.beginPath();
    if (pickMode) {
      ctx.rect(s.x - 5.5, s.y - 5.5, 11, 11);
    } else {
      ctx.moveTo(s.x - 30, s.y + 0.5); ctx.lineTo(s.x + 30, s.y + 0.5);
      ctx.moveTo(s.x + 0.5, s.y - 30); ctx.lineTo(s.x + 0.5, s.y + 30);
      ctx.rect(s.x - 4.5, s.y - 4.5, 9, 9);
    }
    ctx.stroke();
  };
  Renderer.prototype.drawSnap = function (sn, C) {
    var ctx = this.ctx, s = this.toScreen(sn.p), r = 6;
    ctx.setLineDash([]); ctx.lineWidth = 2; ctx.strokeStyle = C.snap;
    ctx.beginPath();
    switch (sn.kind) {
      case 'end': ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r); break;
      case 'mid': ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x + r, s.y + r * 0.8); ctx.lineTo(s.x - r, s.y + r * 0.8); ctx.closePath(); break;
      case 'cen': ctx.arc(s.x, s.y, r, 0, TAU); break;
      case 'qua': ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x + r, s.y); ctx.lineTo(s.x, s.y + r); ctx.lineTo(s.x - r, s.y); ctx.closePath(); break;
      case 'int': ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r); ctx.moveTo(s.x + r, s.y - r); ctx.lineTo(s.x - r, s.y + r); break;
      case 'nea': ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y - r); ctx.lineTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y + r); ctx.closePath(); break;
      case 'per': ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y + r); ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x, s.y); ctx.lineTo(s.x, s.y + r); break;
      case 'ins': ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r); ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x + r, s.y); break;
      default: ctx.arc(s.x, s.y, 2, 0, TAU);
    }
    ctx.stroke();
    var label = SNAP_LABEL[sn.kind];
    if (label && sn.kind !== 'grid') {
      ctx.font = '12px ' + NS.FONT;
      var w = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(30,30,30,0.85)'; ctx.fillRect(s.x + 10, s.y + 10, w, 18);
      ctx.fillStyle = '#ffe9a8'; ctx.fillText(label, s.x + 14, s.y + 23);
    }
  };
  Renderer.prototype.drawRubber = function (rb, C) {
    var ctx = this.ctx, a = this.toScreen(rb.a), b = this.toScreen(rb.b);
    ctx.setLineDash(rb.crossing ? [5, 4] : []); ctx.lineWidth = 1;
    ctx.fillStyle = rb.crossing ? 'rgba(80,200,120,0.12)' : 'rgba(80,140,255,0.12)';
    ctx.strokeStyle = rb.crossing ? '#50c878' : '#5a8cff';
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  };
  Renderer.prototype.drawRubberLine = function (base, cur, C) {
    var ctx = this.ctx, a = this.toScreen(base), b = this.toScreen(cur);
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = C.preview;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };
  Renderer.prototype.drawGrips = function (grips, hot, C) {
    var ctx = this.ctx;
    ctx.setLineDash([]); ctx.lineWidth = 1;
    grips.forEach(function (gp, i) {
      var s = this.toScreen(gp.p);
      ctx.fillStyle = i === hot ? '#ff5050' : '#3c7cff';
      ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
      ctx.strokeStyle = '#ffffff'; ctx.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
    }, this);
  };

  // ---- 그림 파일로 (PNG용 캔버스, 흰 바탕) ----
  Renderer.prototype.renderTo = function (canvas, doc, box, pxPerMm, mono) {
    var r = new Renderer(canvas);
    var w = Math.max(1, Math.round((box.x1 - box.x0) * pxPerMm)), h = Math.max(1, Math.round((box.y1 - box.y0) * pxPerMm));
    canvas.width = w; canvas.height = h;
    r.w = w; r.h = h; r.dpr = 1; r.dark = false;
    r.view = { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, scale: pxPerMm };
    var ctx = r.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    r.worldTransform(ctx);
    doc.ents.forEach(function (e) {
      var l = Model.layerOf(doc, e.layer);
      if (l && !l.visible) return;
      r.drawEnt(ctx, doc, e, null, mono ? { color: '#000000', width: 1, keepLtype: true } : null, 1);
    });
    return canvas;
  };

  NS.Renderer = Renderer;
  NS.SNAP_LABEL = SNAP_LABEL;
})(typeof globalThis !== 'undefined' ? globalThis : this);
