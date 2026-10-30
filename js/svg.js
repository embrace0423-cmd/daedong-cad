// SVG 내보내기. 종이 크기 = 도면 범위 ÷ 축척 (mm), 선 굵기는 종이 0.25mm.
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var G = NS.G, Model = NS.Model, TAU = G.TAU;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function n(x) { return G.fmt(x, 4); }

  function arcPath(c, r, a0, a1) {
    var sw = G.sweep(a0, a1);
    if (sw >= TAU - 1e-9) {
      var p = G.polar(c, r, a0), q = G.polar(c, r, a0 + Math.PI);
      return 'M' + n(p.x) + ' ' + n(p.y) + 'A' + n(r) + ' ' + n(r) + ' 0 1 1 ' + n(q.x) + ' ' + n(q.y) + 'A' + n(r) + ' ' + n(r) + ' 0 1 1 ' + n(p.x) + ' ' + n(p.y);
    }
    var s = G.polar(c, r, a0), e = G.polar(c, r, a1);
    return 'M' + n(s.x) + ' ' + n(s.y) + 'A' + n(r) + ' ' + n(r) + ' 0 ' + (sw > Math.PI ? 1 : 0) + ' 1 ' + n(e.x) + ' ' + n(e.y);
  }
  function polyPath(pts, closed) {
    if (!pts.length) return '';
    var d = 'M' + n(pts[0].x) + ' ' + n(pts[0].y), m = pts.length, last = closed ? m : m - 1;
    for (var i = 0; i < last; i++) {
      var a = pts[i], b = pts[(i + 1) % m];
      if (a.bulge) {
        var arc = G.bulgeArc(a, b, a.bulge);
        if (arc) { d += 'A' + n(arc.r) + ' ' + n(arc.r) + ' 0 ' + (Math.abs(arc.th) > Math.PI ? 1 : 0) + ' ' + (a.bulge > 0 ? 1 : 0) + ' ' + n(b.x) + ' ' + n(b.y); continue; }
      }
      d += 'L' + n(b.x) + ' ' + n(b.y);
    }
    return d + (closed ? 'Z' : '');
  }

  function toSVG(doc, opts) {
    opts = opts || {};
    var k = doc.settings.scale || 1, box = opts.box || Model.extents(doc);
    if (!G.boxValid(box)) box = { x0: 0, y0: 0, x1: 100, y1: 100 };
    var pad = opts.pad === undefined ? 0 : opts.pad;
    box = G.boxGrow(box, pad);
    var W = box.x1 - box.x0, H = box.y1 - box.y0, sw = 0.25 * k, mono = !!opts.mono;
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + n(W / k) + 'mm" height="' + n(H / k) + 'mm" viewBox="' + n(box.x0) + ' ' + n(-box.y1) + ' ' + n(W) + ' ' + n(H) + '">');
    out.push('<rect x="' + n(box.x0) + '" y="' + n(-box.y1) + '" width="' + n(W) + '" height="' + n(H) + '" fill="#fff"/>');
    out.push('<g transform="scale(1,-1)" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="' + n(sw) + '" font-family="Malgun Gothic, Noto Sans KR, sans-serif">');

    function color(e, parent) {
      if (mono) return '#000';
      var c = Model.aciRgb(Model.entAci(e, doc, parent), false);
      return c.toLowerCase() === '#ffff00' ? '#b8a000' : c; // 흰 종이에 노란색은 어둡게
    }
    function dash(e, parent, unit) {
      var lt = doc.ltypes[Model.entLtype(e, doc, parent)];
      if (!lt || !lt.pat || !lt.pat.length) return '';
      var ls = (doc.settings.ltscale || 1) / unit;
      var arr = lt.pat.map(function (x) { return n(Math.max(Math.abs(x) * ls, x === 0 ? sw * 0.5 / unit : 0)); });
      if (arr.length % 2) arr = arr.concat(arr);
      return ' stroke-dasharray="' + arr.join(' ') + '"';
    }
    function text(p, h, rot, s, align, valign, fill) {
      var anchor = align === 'C' ? 'middle' : align === 'R' ? 'end' : 'start';
      var base = valign === 'M' ? 'central' : valign === 'T' ? 'hanging' : 'alphabetic';
      return '<text transform="translate(' + n(p.x) + ' ' + n(p.y) + ') rotate(' + n(G.deg(rot || 0)) + ') scale(1,-1)" font-size="' + n(h) + '" text-anchor="' + anchor + '" dominant-baseline="' + base + '" fill="' + fill + '" stroke="none">' + esc(s) + '</text>';
    }
    function ent(e, parent, unit, depth) {
      var col = color(e, parent), st = ' stroke="' + col + '"' + dash(e, parent, unit) + (unit !== 1 ? ' stroke-width="' + n(sw / unit) + '"' : '');
      switch (e.type) {
        case 'line': return '<path d="M' + n(e.a.x) + ' ' + n(e.a.y) + 'L' + n(e.b.x) + ' ' + n(e.b.y) + '"' + st + '/>';
        case 'circle': return '<circle cx="' + n(e.c.x) + '" cy="' + n(e.c.y) + '" r="' + n(e.r) + '"' + st + '/>';
        case 'arc': return '<path d="' + arcPath(e.c, e.r, e.a0, e.a1) + '"' + st + '/>';
        case 'poly': return '<path d="' + polyPath(e.pts, e.closed) + '"' + st + (e.fill ? ' fill="' + col + '"' : '') + '/>';
        case 'ellipse': { var ep = Model.ellipsePoints(e, 96); return '<path d="' + polyPath(ep.pts, ep.full) + '"' + st + '/>'; }
        case 'hatch': {
          var hpr = Model.prims(e, doc);
          if (e.solid) return '<path d="' + hpr.filter(function (q) { return q.hb; }).map(function (q) { return polyPath(q.pts, true); }).join('') + '" fill="' + col + '" fill-rule="evenodd" stroke="none"/>';
          var segs = hpr.filter(function (q) { return q.hp; });
          if (!segs.length) return '';
          return '<path d="' + segs.map(function (q) { return 'M' + n(q.a.x) + ' ' + n(q.a.y) + 'L' + n(q.b.x) + ' ' + n(q.b.y); }).join('') + '" stroke="' + col + '"' + (unit !== 1 ? ' stroke-width="' + n(sw / unit) + '"' : '') + '/>';
        }
        case 'point': return '<circle cx="' + n(e.p.x) + '" cy="' + n(e.p.y) + '" r="' + n(sw) + '" fill="' + col + '" stroke="none"/>';
        case 'text': return text(e.p, e.h, e.rot, e.s, e.align, e.valign, col);
        case 'mtext': return (Model.explode(e, { nextId: 0, blocks: doc.blocks, settings: doc.settings, layers: doc.layers }) || []).map(function (t) { return text(t.p, t.h, t.rot, t.s, t.align, t.valign, col); }).join('');
        case 'dim': {
          var dg = Model.dimGeom(e, doc), s = '<path d="' + dg.lines.map(function (l) { return 'M' + n(l[0].x) + ' ' + n(l[0].y) + 'L' + n(l[1].x) + ' ' + n(l[1].y); }).join('') + '" stroke="' + col + '"/>';
          dg.arrows.forEach(function (t) { s += '<path d="' + polyPath(t, true) + '" fill="' + col + '" stroke="none"/>'; });
          if (dg.text) s += text(dg.text.p, dg.text.h, dg.text.rot, dg.text.s, 'C', 'B', col);
          return s;
        }
        case 'insert': {
          var blk = doc.blocks[e.name];
          if (!blk || depth > 8) return '';
          var m = Model.insertMatrix(e, blk), u = unit * G.M.scaleOf(m) || unit;
          var par = { e: e, parent: parent };
          return '<g transform="matrix(' + [m.a, m.b, m.c, m.d, m.e, m.f].map(n).join(' ') + ')">' + blk.ents.map(function (b) { return ent(b, par, u, depth + 1); }).join('') + '</g>';
        }
      }
      return '';
    }
    doc.ents.forEach(function (e) {
      var l = Model.layerOf(doc, e.layer);
      if (l && !l.visible) return;
      if (opts.box && !G.boxHit(Model.bounds(e, doc), box)) return;
      out.push(ent(e, null, 1, 0));
    });
    out.push('</g></svg>');
    return out.join('\n');
  }

  NS.SVG = { toSVG: toSVG };
})(typeof globalThis !== 'undefined' ? globalThis : this);
