// DXF 쓰기: AutoCAD R12(AC1009) 형식의 ASCII DXF.
// R12는 거의 모든 CAD 프로그램이 읽는다. 한글 등 ASCII 밖의 글자는 \U+XXXX로 적는다.
// 치수·타원·여러 줄 문자는 선·폴리선·문자로 풀어서 쓴다(R12에 없는 개체이거나 호환성 때문).
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var G = NS.G, Model = NS.Model;

  function num(n) {
    if (!isFinite(n) || Math.abs(n) < 1e-10) return '0.0';
    var s = n.toFixed(10);
    s = s.replace(/0+$/, '');
    if (s.charAt(s.length - 1) === '.') s += '0';
    return s;
  }
  // 문자열: 특수 기호는 %% 코드, 그 밖의 비ASCII는 \U+XXXX
  function str(s) {
    s = String(s === undefined || s === null ? '' : s).replace(/[\r\n]+/g, ' ');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), c = s.charCodeAt(i);
      if (ch === 'Ø' || ch === 'ø' || ch === '⌀') out += '%%c';
      else if (ch === '°') out += '%%d';
      else if (ch === '±') out += '%%p';
      else if (c >= 0xd800 && c <= 0xdbff) { out += '?'; i++; }
      else if (c < 32) out += ' ';
      else if (c < 128) out += ch;
      else out += '\\U+' + ('0000' + c.toString(16).toUpperCase()).slice(-4);
    }
    return out;
  }
  // 이름(도면층·블록·선 종류): R12에서 쓸 수 있는 글자로. 한글은 \U+로 남긴다.
  function nameOf(s) {
    s = String(s || '0');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), c = s.charCodeAt(i);
      if (/[A-Za-z0-9_\-$]/.test(ch)) out += ch.toUpperCase();
      else if (c > 127 && !(c >= 0xd800 && c <= 0xdfff)) out += '\\U+' + ('0000' + c.toString(16).toUpperCase()).slice(-4);
      else out += '_';
    }
    return out || '_';
  }

  function Writer() { this.lines = []; }
  Writer.prototype.w = function (code, val) {
    this.lines.push((code < 10 ? '  ' : code < 100 ? ' ' : '') + code);
    this.lines.push(typeof val === 'number' ? (Number.isInteger(val) && code >= 60 && code < 100 ? String(val) : num(val)) : String(val));
  };
  Writer.prototype.int = function (code, val) { this.lines.push((code < 10 ? '  ' : code < 100 ? ' ' : '') + code); this.lines.push(String(Math.round(val))); };
  Writer.prototype.pt = function (base, p) { this.w(base, p.x); this.w(base + 10, p.y); this.w(base + 20, 0); };

  function ltypeElems(pat) { return pat || []; }
  var hatchNames = null; // 해치 개체 → 블록 이름 (쓰는 동안만)

  function writeDXF(doc) {
    var W = new Writer();
    var names = { layer: {}, block: {}, used: {} };
    function lname(n) { return names.layer[n] || (names.layer[n] = nameOf(n)); }
    // 블록 이름: 겹치지 않게
    function bname(n) {
      if (names.block[n]) return names.block[n];
      var base = nameOf(n), s = base, i = 2;
      while (names.used[s]) s = base + '_' + (i++);
      names.used[s] = true;
      return (names.block[n] = s);
    }

    var ext = Model.extents(doc);
    if (!G.boxValid(ext)) ext = { x0: 0, y0: 0, x1: 420, y1: 297 };
    var st = doc.settings || {};

    // ---- HEADER ----
    W.w(0, 'SECTION'); W.w(2, 'HEADER');
    W.w(9, '$ACADVER'); W.w(1, 'AC1009');
    W.w(9, '$DWGCODEPAGE'); W.w(3, 'ANSI_949');
    W.w(9, '$INSBASE'); W.pt(10, G.v(0, 0));
    W.w(9, '$EXTMIN'); W.pt(10, G.v(ext.x0, ext.y0));
    W.w(9, '$EXTMAX'); W.pt(10, G.v(ext.x1, ext.y1));
    W.w(9, '$LIMMIN'); W.w(10, ext.x0); W.w(20, ext.y0);
    W.w(9, '$LIMMAX'); W.w(10, ext.x1); W.w(20, ext.y1);
    W.w(9, '$LTSCALE'); W.w(40, st.ltscale || 1);
    W.w(9, '$TEXTSIZE'); W.w(40, st.textH || 2.5);
    W.w(9, '$TEXTSTYLE'); W.w(7, 'STANDARD');
    W.w(9, '$CLAYER'); W.w(8, lname(doc.currentLayer || '0'));
    W.w(0, 'ENDSEC');

    // ---- TABLES ----
    W.w(0, 'SECTION'); W.w(2, 'TABLES');
    // 처음 열릴 때의 화면
    W.w(0, 'TABLE'); W.w(2, 'VPORT'); W.int(70, 1);
    W.w(0, 'VPORT'); W.w(2, '*ACTIVE'); W.int(70, 0);
    W.w(10, 0); W.w(20, 0); W.w(11, 1); W.w(21, 1);
    W.w(12, (ext.x0 + ext.x1) / 2); W.w(22, (ext.y0 + ext.y1) / 2);
    W.w(13, 0); W.w(23, 0); W.w(14, 10); W.w(24, 10); W.w(15, 10); W.w(25, 10);
    W.w(16, 0); W.w(26, 0); W.w(36, 1); W.w(17, 0); W.w(27, 0); W.w(37, 0);
    W.w(40, Math.max(1, (ext.y1 - ext.y0) * 1.1)); W.w(41, 1.6); W.w(42, 50);
    W.w(43, 0); W.w(44, 0); W.w(50, 0); W.w(51, 0);
    W.int(71, 0); W.int(72, 100); W.int(73, 1); W.int(74, 3); W.int(75, 0); W.int(76, 0); W.int(77, 0); W.int(78, 0);
    W.w(0, 'ENDTAB');

    // 선 종류
    var lts = Object.keys(doc.ltypes || {});
    if (lts.indexOf('CONTINUOUS') < 0) lts.unshift('CONTINUOUS');
    W.w(0, 'TABLE'); W.w(2, 'LTYPE'); W.int(70, lts.length);
    lts.forEach(function (n) {
      var lt = doc.ltypes[n] || Model.LTYPES[n] || { pat: [] }, el = ltypeElems(lt.pat);
      var total = el.reduce(function (s, x) { return s + Math.abs(x); }, 0);
      W.w(0, 'LTYPE'); W.w(2, nameOf(n)); W.int(70, 0);
      W.w(3, el.length ? str(n + ' ' + el.map(function (x) { return x > 0 ? '__' : x === 0 ? '.' : ' '; }).join('')) : 'Solid line');
      W.int(72, 65); W.int(73, el.length); W.w(40, total);
      el.forEach(function (x) { W.w(49, x); });
    });
    W.w(0, 'ENDTAB');

    // 도면층
    W.w(0, 'TABLE'); W.w(2, 'LAYER'); W.int(70, doc.layers.length);
    doc.layers.forEach(function (l) {
      W.w(0, 'LAYER'); W.w(2, lname(l.name)); W.int(70, l.locked ? 4 : 0);
      var col = Math.max(1, Math.min(255, Math.abs(l.color) || 7));
      W.int(62, l.visible === false ? -col : col);
      W.w(6, nameOf(l.ltype || 'CONTINUOUS'));
    });
    W.w(0, 'ENDTAB');

    // 문자 유형: 한글이 보이도록 맑은 고딕
    W.w(0, 'TABLE'); W.w(2, 'STYLE'); W.int(70, 1);
    W.w(0, 'STYLE'); W.w(2, 'STANDARD'); W.int(70, 0); W.w(40, 0); W.w(41, 1); W.w(50, 0); W.int(71, 0);
    W.w(42, st.textH || 2.5); W.w(3, 'malgun.ttf'); W.w(4, '');
    W.w(0, 'ENDTAB');

    W.w(0, 'TABLE'); W.w(2, 'APPID'); W.int(70, 1);
    W.w(0, 'APPID'); W.w(2, 'ACAD'); W.int(70, 0);
    W.w(0, 'ENDTAB');
    W.w(0, 'ENDSEC');

    // ---- BLOCKS: 쓰인 블록만 (중첩 포함) ----
    var need = [], seen = {};
    function collect(ents) {
      ents.forEach(function (e) {
        if (e.type === 'insert' && doc.blocks[e.name] && !seen[e.name]) {
          seen[e.name] = true; collect(doc.blocks[e.name].ents); need.push(e.name);
        }
      });
    }
    collect(doc.ents);
    // 해치는 R12에 없어 블록(선·SOLID 묶음)으로 쓰고 한 번 끼워 넣는다
    hatchNames = new Map();
    var hatchList = [];
    function hatchName() { // 사용자 블록 이름과 겹치지 않게
      var i = hatchList.length + 1, nm = 'DCAD_HATCH_' + i;
      while (names.used[nm] || doc.blocks[nm]) nm = 'DCAD_HATCH_' + (++i) + '_' + hatchList.length;
      names.used[nm] = true;
      return nm;
    }
    function findHatch(ents) { ents.forEach(function (e) { if (e.type === 'hatch' && !hatchNames.has(e)) { hatchNames.set(e, hatchName()); hatchList.push(e); } }); }
    findHatch(doc.ents);
    Object.keys(doc.blocks).forEach(function (k) { findHatch(doc.blocks[k].ents); });
    W.w(0, 'SECTION'); W.w(2, 'BLOCKS');
    hatchList.forEach(function (h) {
      var hn = hatchNames.get(h);
      W.w(0, 'BLOCK'); W.w(8, '0'); W.w(2, hn); W.int(70, 0); W.pt(10, G.v(0, 0)); W.w(3, hn); W.w(1, '');
      (Model.explode(h, { nextId: 0, blocks: doc.blocks, settings: doc.settings, layers: doc.layers }) || []).forEach(function (pe) {
        pe.layer = '0'; pe.color = 0; pe.ltype = 'CONTINUOUS';
        writeEnt(W, pe, doc, lname, bname);
      });
      W.w(0, 'ENDBLK'); W.w(8, '0');
    });
    need.forEach(function (n) {
      var b = doc.blocks[n], bn = bname(n);
      W.w(0, 'BLOCK'); W.w(8, '0'); W.w(2, bn); W.int(70, 0); W.pt(10, b.base); W.w(3, bn); W.w(1, '');
      b.ents.forEach(function (e) { writeEnt(W, e, doc, lname, bname); });
      W.w(0, 'ENDBLK'); W.w(8, '0');
    });
    W.w(0, 'ENDSEC');

    // ---- ENTITIES ----
    W.w(0, 'SECTION'); W.w(2, 'ENTITIES');
    doc.ents.forEach(function (e) { writeEnt(W, e, doc, lname, bname); });
    W.w(0, 'ENDSEC');
    W.w(0, 'EOF');
    hatchNames = null;
    return W.lines.join('\r\n') + '\r\n';
  }

  function common(W, type, e, lname) {
    W.w(0, type);
    W.w(8, lname(e.layer || '0'));
    if (e.ltype && e.ltype !== 'BYLAYER') W.w(6, e.ltype === 'BYBLOCK' ? 'BYBLOCK' : nameOf(e.ltype));
    if (e.color !== undefined && e.color !== 256) W.int(62, e.color);
  }

  function writeEnt(W, e, doc, lname, bname) {
    switch (e.type) {
      case 'line':
        common(W, 'LINE', e, lname); W.pt(10, e.a); W.pt(11, e.b); break;
      case 'circle':
        common(W, 'CIRCLE', e, lname); W.pt(10, e.c); W.w(40, e.r); break;
      case 'arc':
        common(W, 'ARC', e, lname); W.pt(10, e.c); W.w(40, e.r);
        W.w(50, G.deg(G.normAng(e.a0))); W.w(51, G.deg(G.normAng(e.a1))); break;
      case 'point':
        common(W, 'POINT', e, lname); W.pt(10, e.p); break;
      case 'poly':
        if (e.fill && e.pts.length >= 3 && e.pts.length <= 4 && !e.pts.some(function (p) { return p.bulge; })) {
          var q = e.pts;
          common(W, 'SOLID', e, lname);
          W.pt(10, q[0]); W.pt(11, q[1]); W.pt(12, q.length === 4 ? q[3] : q[2]); W.pt(13, q[2]);
          break;
        }
        writePoly(W, e, e.pts, !!e.closed, lname);
        break;
      case 'ellipse': {
        var ep = Model.ellipsePoints(e, 72);
        var pts = ep.full ? ep.pts.slice(0, -1) : ep.pts;
        writePoly(W, e, pts, ep.full, lname);
        break;
      }
      case 'text': {
        common(W, 'TEXT', e, lname);
        W.pt(10, e.p); W.w(40, e.h); W.w(1, str(e.s));
        if (e.rot) W.w(50, G.deg(G.normAng(e.rot)));
        W.w(7, 'STANDARD');
        var ha = e.align === 'C' ? 1 : e.align === 'R' ? 2 : 0;
        var va = e.valign === 'M' ? 2 : e.valign === 'T' ? 3 : 0;
        if (ha) W.int(72, ha);
        if (ha || va) W.pt(11, e.p);
        if (va) W.int(73, va);
        break;
      }
      case 'mtext': case 'dim': {
        var parts = Model.explode(e, { nextId: 0, blocks: doc.blocks, settings: doc.settings, layers: doc.layers });
        (parts || []).forEach(function (p) { writeEnt(W, p, doc, lname, bname); });
        break;
      }
      case 'hatch': {
        var hn2 = hatchNames && hatchNames.get(e);
        if (!hn2) break;
        common(W, 'INSERT', e, lname); W.w(2, hn2); W.pt(10, G.v(0, 0));
        W.w(41, 1); W.w(42, 1); W.w(43, 1); W.w(50, 0);
        break;
      }
      case 'insert':
        if (!doc.blocks[e.name]) break;
        common(W, 'INSERT', e, lname); W.w(2, bname(e.name)); W.pt(10, e.p);
        W.w(41, e.sx === undefined ? 1 : e.sx); W.w(42, e.sy === undefined ? 1 : e.sy); W.w(43, 1);
        W.w(50, G.deg(G.normAng(e.rot || 0)));
        break;
    }
  }
  function writePoly(W, e, pts, closed, lname) {
    common(W, 'POLYLINE', e, lname);
    W.int(66, 1); W.pt(10, G.v(0, 0)); W.int(70, closed ? 1 : 0);
    pts.forEach(function (p) {
      W.w(0, 'VERTEX'); W.w(8, lname(e.layer || '0')); W.pt(10, p);
      if (p.bulge) W.w(42, p.bulge);
      W.int(70, 0);
    });
    W.w(0, 'SEQEND'); W.w(8, lname(e.layer || '0'));
  }

  NS.DXF = NS.DXF || {};
  NS.DXF.write = writeDXF;
  NS.DXF.encodeStr = str;
  NS.DXF.encodeName = nameOf;
})(typeof globalThis !== 'undefined' ? globalThis : this);
