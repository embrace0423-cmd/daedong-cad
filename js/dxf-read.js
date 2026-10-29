// DXF 읽기: ASCII DXF(R12 ~ 최신)를 도면 모델로.
// 읽는 개체: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE(2D·3D), TEXT, MTEXT, INSERT(+ATTRIB, MINSERT),
// DIMENSION(블록 그림으로), ELLIPSE, SPLINE(점열 근사), POINT, SOLID/TRACE/3DFACE, LEADER.
// HATCH 등 나머지는 건너뛰고 개수를 알려 준다.
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var G = NS.G, Model = NS.Model, TAU = G.TAU;

  // ---- 글자 인코딩 ----
  function sniff(bytes) {
    var head = '';
    var n = Math.min(bytes.length, 6000);
    for (var i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
    if (head.indexOf('AutoCAD Binary DXF') === 0) return { binary: true };
    var ver = (/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)/.exec(head) || [])[1] || '';
    var cp = (/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head) || [])[1] || '';
    return { ver: ver, cp: cp.toUpperCase() };
  }
  var CP = { ANSI_949: 'euc-kr', ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_950: 'big5', ANSI_1252: 'windows-1252', ANSI_1251: 'windows-1251', ANSI_1250: 'windows-1250' };
  function decodeBytes(bytes) {
    var info = sniff(bytes);
    if (info.binary) throw new Error('바이너리 DXF는 읽지 못합니다. ASCII DXF로 저장해 주세요.');
    var verNum = parseInt((info.ver || 'AC1009').slice(2), 10);
    var tries = [];
    if (verNum >= 1021) tries.push('utf-8');
    if (CP[info.cp]) tries.push(CP[info.cp]);
    tries.push('utf-8', 'euc-kr', 'windows-1252');
    for (var i = 0; i < tries.length; i++) {
      try { return new TextDecoder(tries[i], { fatal: true }).decode(bytes); } catch (e) { /* 다음 인코딩 */ }
    }
    return new TextDecoder('windows-1252').decode(bytes);
  }

  // \U+XXXX, %%c 등 풀기
  function decodeStr(s) {
    s = String(s);
    s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
    s = s.replace(/\\M\+[0-9A-Fa-f]{5}/g, '?');
    s = s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%');
    s = s.replace(/%%(\d{3})/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); });
    return s;
  }
  // MTEXT 서식 코드 지우기
  function plainMtext(s) {
    s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ');
    s = s.replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '');
    s = s.replace(/\\S([^;^/#]*)[\^/#]([^;]*);/g, '$1/$2');
    s = s.replace(/\\[LlOoKkN]/g, '');
    s = s.replace(/\\([\\{}])/g, '\u0001$1');
    s = s.replace(/[{}]/g, '').replace(/\u0001/g, '');
    return decodeStr(s);
  }

  // ---- 토큰 ----
  function tokenize(text) {
    var lines = text.split(/\r\n|\r|\n/), out = [];
    for (var i = 0; i + 1 < lines.length; i += 2) {
      var code = parseInt(lines[i], 10);
      if (isNaN(code)) { i--; continue; }
      out.push([code, lines[i + 1]]);
    }
    return out;
  }

  // 한 개체의 그룹 코드들을 모은다: [[code, value], ...]
  function f(tags, code, def) {
    for (var i = 0; i < tags.length; i++) if (tags[i][0] === code) return parseFloat(tags[i][1]);
    return def;
  }
  function s(tags, code, def) {
    for (var i = 0; i < tags.length; i++) if (tags[i][0] === code) return tags[i][1].trim ? tags[i][1].replace(/^\s+/, '') : tags[i][1];
    return def;
  }
  function all(tags, code) { var r = []; for (var i = 0; i < tags.length; i++) if (tags[i][0] === code) r.push(tags[i][1]); return r; }

  function read(input) {
    var text = typeof input === 'string' ? input : decodeBytes(input);
    var tk = tokenize(text);
    var doc = Model.newDoc();
    doc.layers = [];
    doc.ltypes = {};
    var report = { skipped: {}, count: 0, ver: '', warnings: [] };
    var pos = 0;

    function skipTo(code, val) { while (pos < tk.length && !(tk[pos][0] === code && tk[pos][1].trim() === val)) pos++; }
    // 다음 0 코드 전까지의 태그
    function entityTags() {
      var tags = [];
      pos++;
      while (pos < tk.length && tk[pos][0] !== 0) { tags.push(tk[pos]); pos++; }
      return tags;
    }

    while (pos < tk.length) {
      var t = tk[pos];
      if (t[0] === 0 && t[1].trim() === 'SECTION') {
        var name = tk[pos + 1] ? tk[pos + 1][1].trim() : '';
        pos += 2;
        if (name === 'HEADER') readHeader();
        else if (name === 'TABLES') readTables();
        else if (name === 'BLOCKS') readBlocks();
        else if (name === 'ENTITIES') { var ents = readEntities(); ents.forEach(function (e) { doc.ents.push(e); }); }
        else skipTo(0, 'ENDSEC');
      } else if (t[0] === 0 && t[1].trim() === 'EOF') break;
      else pos++;
    }

    function readHeader() {
      while (pos < tk.length && !(tk[pos][0] === 0 && tk[pos][1].trim() === 'ENDSEC')) {
        if (tk[pos][0] === 9) {
          var v = tk[pos][1].trim(), val = tk[pos + 1] ? tk[pos + 1][1].trim() : '';
          if (v === '$ACADVER') report.ver = val;
          else if (v === '$LTSCALE') doc.settings.ltscale = parseFloat(val) || 1;
          else if (v === '$TEXTSIZE') doc.settings.textH = parseFloat(val) || 2.5;
          else if (v === '$INSUNITS') report.insunits = parseInt(val, 10);
          else if (v === '$CLAYER') doc.currentLayer = decodeStr(val);
        }
        pos++;
      }
    }

    function readTables() {
      while (pos < tk.length && !(tk[pos][0] === 0 && tk[pos][1].trim() === 'ENDSEC')) {
        if (tk[pos][0] === 0) {
          var kind = tk[pos][1].trim();
          if (kind === 'LAYER' || kind === 'LTYPE') {
            var tags = entityTags();
            if (kind === 'LAYER') {
              var nm = decodeStr(s(tags, 2, '0'));
              var col = f(tags, 62, 7), flags = f(tags, 70, 0);
              var lt = (s(tags, 6, 'CONTINUOUS') || 'CONTINUOUS').toUpperCase();
              if (!Model.layerOf(doc, nm)) {
                doc.layers.push({ name: nm, color: Math.abs(col) || 7, ltype: lt, visible: col >= 0 && !(flags & 1), locked: !!(flags & 4) });
              }
            } else {
              var ln = decodeStr(s(tags, 2, '')).toUpperCase();
              if (ln && ln !== 'BYLAYER' && ln !== 'BYBLOCK') {
                doc.ltypes[ln] = { desc: decodeStr(s(tags, 3, ln)), pat: all(tags, 49).map(parseFloat) };
              }
            }
            continue;
          }
        }
        pos++;
      }
    }

    function readBlocks() {
      while (pos < tk.length && !(tk[pos][0] === 0 && tk[pos][1].trim() === 'ENDSEC')) {
        if (tk[pos][0] === 0 && tk[pos][1].trim() === 'BLOCK') {
          var tags = entityTags();
          var nm = decodeStr(s(tags, 2, ''));
          var base = G.v(f(tags, 10, 0), f(tags, 20, 0));
          var ents = readEntities('ENDBLK');
          if (nm && !/^[*$](model|paper)_space/i.test(nm)) doc.blocks[nm] = { name: nm, base: base, ents: ents };
          if (pos < tk.length && tk[pos][1].trim() === 'ENDBLK') entityTags();
          continue;
        }
        pos++;
      }
    }

    // ENTITIES 또는 블록 본문
    function readEntities(stopAt) {
      var out = [];
      while (pos < tk.length) {
        var t = tk[pos];
        if (t[0] !== 0) { pos++; continue; }
        var type = t[1].trim();
        if (type === 'ENDSEC' || type === stopAt) break;
        var tags = entityTags();
        if (f(tags, 67, 0) === 1 && !stopAt) { skipSeq(type, tags); continue; } // 배치(종이) 공간은 건너뜀
        var made = convert(type, tags);
        if (made === null) { report.skipped[type] = (report.skipped[type] || 0) + 1; continue; }
        made.forEach(function (e) { out.push(e); });
      }
      return out;
    }
    function skipSeq(type, tags) {
      if (type === 'POLYLINE' || (type === 'INSERT' && f(tags, 66, 0) === 1)) {
        while (pos < tk.length && !(tk[pos][0] === 0 && tk[pos][1].trim() === 'SEQEND')) pos++;
        if (pos < tk.length) entityTags();
      }
    }

    function base(tags, type) {
      var e = Model.mk(doc, type, {});
      e.layer = decodeStr(s(tags, 8, '0'));
      var lt = s(tags, 6, null);
      if (lt) e.ltype = lt.toUpperCase();
      var c = f(tags, 62, 256);
      e.color = c < 0 ? Math.abs(c) : c;
      if (!Model.layerOf(doc, e.layer)) Model.ensureLayer(doc, e.layer, 7);
      return e;
    }
    // OCS가 -Z면 X를 뒤집는다 (대칭한 호·원 등)
    function flipX(tags) { return f(tags, 230, 1) < -0.5; }
    function P(tags, cx, cy, flip) { var x = f(tags, cx, 0), y = f(tags, cy, 0); return G.v(flip ? -x : x, y); }

    function convert(type, tags) {
      var e, fl = flipX(tags);
      report.count++;
      switch (type) {
        case 'LINE':
          e = base(tags, 'line'); e.a = P(tags, 10, 20); e.b = P(tags, 11, 21); return [e];
        case 'CIRCLE':
          e = base(tags, 'circle'); e.c = P(tags, 10, 20, fl); e.r = f(tags, 40, 1); return [e];
        case 'ARC': {
          e = base(tags, 'arc'); e.c = P(tags, 10, 20, fl); e.r = f(tags, 40, 1);
          var a0 = G.rad(f(tags, 50, 0)), a1 = G.rad(f(tags, 51, 360));
          if (fl) { e.a0 = G.normAng(Math.PI - a1); e.a1 = G.normAng(Math.PI - a0); } else { e.a0 = a0; e.a1 = a1; }
          return [e];
        }
        case 'POINT':
          e = base(tags, 'point'); e.p = P(tags, 10, 20); return [e];
        case 'LWPOLYLINE': {
          e = base(tags, 'poly');
          var pts = [], cur = null;
          tags.forEach(function (tg) {
            if (tg[0] === 10) { cur = { x: parseFloat(tg[1]), y: 0 }; if (fl) cur.x = -cur.x; pts.push(cur); }
            else if (tg[0] === 20 && cur) cur.y = parseFloat(tg[1]);
            else if (tg[0] === 42 && cur) { var b = parseFloat(tg[1]); if (b) cur.bulge = fl ? -b : b; }
          });
          e.pts = pts; e.closed = !!(f(tags, 70, 0) & 1);
          return pts.length ? [e] : [];
        }
        case 'POLYLINE': {
          var flags = f(tags, 70, 0);
          var verts = [];
          while (pos < tk.length && tk[pos][0] === 0 && tk[pos][1].trim() === 'VERTEX') {
            var vt = entityTags(), vf = f(vt, 70, 0);
            if (vf & 16) continue; // 스플라인 뼈대 점
            var vp = P(vt, 10, 20, fl), bl = f(vt, 42, 0);
            if (bl) vp.bulge = fl ? -bl : bl;
            verts.push(vp);
          }
          if (pos < tk.length && tk[pos][1].trim() === 'SEQEND') entityTags();
          if (flags & (16 | 64)) { report.skipped['POLYLINE(망·면)'] = (report.skipped['POLYLINE(망·면)'] || 0) + 1; return []; }
          e = base(tags, 'poly'); e.pts = verts; e.closed = !!(flags & 1);
          return verts.length ? [e] : [];
        }
        case 'SOLID': case 'TRACE': case '3DFACE': {
          e = base(tags, 'poly');
          var q = [P(tags, 10, 20, fl), P(tags, 11, 21, fl), P(tags, 12, 22, fl), P(tags, 13, 23, fl)];
          var ordered = type === '3DFACE' ? q : [q[0], q[1], q[3], q[2]];
          var uniq = [];
          ordered.forEach(function (p) { if (!uniq.length || !G.eq(uniq[uniq.length - 1], p, 1e-9)) uniq.push(p); });
          if (uniq.length > 1 && G.eq(uniq[0], uniq[uniq.length - 1], 1e-9)) uniq.pop();
          e.pts = uniq; e.closed = true; e.fill = type !== '3DFACE';
          return [e];
        }
        case 'TEXT': case 'ATTRIB': {
          e = base(tags, 'text');
          var ha = f(tags, 72, 0), va = f(tags, type === 'ATTRIB' ? 74 : 73, 0);
          var useAlign = (ha || va) && tags.some(function (tg) { return tg[0] === 11; });
          e.p = useAlign ? P(tags, 11, 21, fl) : P(tags, 10, 20, fl);
          e.h = f(tags, 40, doc.settings.textH);
          e.s = decodeStr(s(tags, 1, ''));
          var r = G.rad(f(tags, 50, 0));
          e.rot = fl ? G.normAng(Math.PI - r) : r;
          e.align = ha === 1 || ha === 4 ? 'C' : ha === 2 ? 'R' : 'L';
          e.valign = ha === 4 ? 'M' : va === 2 ? 'M' : va === 3 ? 'T' : 'B';
          if (type === 'ATTRIB' && (f(tags, 70, 0) & 1)) return []; // 숨김 속성
          return e.s ? [e] : [];
        }
        case 'ATTDEF':
          return []; // 블록 정의 안의 속성 정의는 그리지 않는다
        case 'MTEXT': {
          e = base(tags, 'mtext');
          e.p = P(tags, 10, 20, fl); e.h = f(tags, 40, doc.settings.textH);
          var parts = all(tags, 3).concat(all(tags, 1));
          e.s = plainMtext(parts.join(''));
          e.attach = f(tags, 71, 1);
          var hasDir = tags.some(function (tg) { return tg[0] === 11; });
          e.rot = hasDir ? Math.atan2(f(tags, 21, 0), f(tags, 11, 1)) : G.rad(f(tags, 50, 0));
          if (f(tags, 41, 0)) e.width = f(tags, 41, 0);
          return e.s ? [e] : [];
        }
        case 'INSERT': case 'DIMENSION': {
          var nm = decodeStr(s(tags, 2, ''));
          var res = [];
          if (type === 'INSERT' && f(tags, 66, 0) === 1) {
            while (pos < tk.length && tk[pos][0] === 0 && tk[pos][1].trim() === 'ATTRIB') {
              var at = entityTags(), made = convert('ATTRIB', at);
              if (made) made.forEach(function (x) { res.push(x); });
              report.count--;
            }
            if (pos < tk.length && tk[pos][1].trim() === 'SEQEND') entityTags();
          }
          if (!nm) return res;
          var isIns = type === 'INSERT';
          var cols = isIns ? Math.max(1, f(tags, 70, 1)) : 1, rows = isIns ? Math.max(1, f(tags, 71, 1)) : 1;
          var dx = f(tags, 44, 0), dy = f(tags, 45, 0);
          var p0 = type === 'DIMENSION' ? G.v(0, 0) : P(tags, 10, 20, fl);
          var rot = type === 'DIMENSION' ? 0 : G.rad(f(tags, 50, 0));
          var sx = type === 'DIMENSION' ? 1 : f(tags, 41, 1), sy = type === 'DIMENSION' ? 1 : f(tags, 42, 1);
          if (fl) { rot = -rot; sx = -sx; }
          for (var ci = 0; ci < cols; ci++) {
            for (var ri = 0; ri < rows; ri++) {
              var off = G.rotate(G.v(ci * dx, ri * dy), G.v(0, 0), rot);
              e = base(tags, 'insert');
              e.name = nm; e.p = G.add(p0, off); e.rot = rot; e.sx = sx; e.sy = sy;
              res.push(e);
            }
          }
          return res;
        }
        case 'ELLIPSE': {
          e = base(tags, 'ellipse');
          e.c = P(tags, 10, 20); e.major = G.v(f(tags, 11, 1), f(tags, 21, 0)); e.ratio = f(tags, 40, 1);
          e.t0 = f(tags, 41, 0); e.t1 = f(tags, 42, TAU);
          if (f(tags, 230, 1) < -0.5) {
            // -Z 방향 타원: 중심·장축은 WCS 그대로, 단축 방향만 반대라 매개변수 방향을 뒤집는다
            var t0 = e.t0, t1 = e.t1;
            if (G.sweep(t0, t1) < TAU - 1e-9) { e.t0 = G.normAng(-t1); e.t1 = G.normAng(-t0); }
          }
          return [e];
        }
        case 'SPLINE': {
          var pl = splinePoints(tags);
          if (!pl.length) return [];
          e = base(tags, 'poly'); e.pts = pl; e.closed = false;
          return [e];
        }
        case 'LEADER': {
          e = base(tags, 'poly');
          var lp = [], lc = null;
          tags.forEach(function (tg) {
            if (tg[0] === 10) { lc = { x: parseFloat(tg[1]), y: 0 }; lp.push(lc); }
            else if (tg[0] === 20 && lc) lc.y = parseFloat(tg[1]);
          });
          e.pts = lp; e.closed = false;
          return lp.length > 1 ? [e] : [];
        }
        case 'VIEWPORT': case 'SEQEND': case 'VERTEX':
          report.count--; return [];
      }
      report.count--;
      return null;
    }

    // 스플라인: 맞춤점이 있으면 그대로, 없으면 조정점으로 de Boor 계산
    function splinePoints(tags) {
      var deg = f(tags, 71, 3), knots = all(tags, 40).map(parseFloat), w = all(tags, 41).map(parseFloat);
      var ctrl = [], fit = [], cur = null, fc = null;
      tags.forEach(function (tg) {
        if (tg[0] === 10) { cur = { x: parseFloat(tg[1]), y: 0 }; ctrl.push(cur); }
        else if (tg[0] === 20 && cur) cur.y = parseFloat(tg[1]);
        else if (tg[0] === 11) { fc = { x: parseFloat(tg[1]), y: 0 }; fit.push(fc); }
        else if (tg[0] === 21 && fc) fc.y = parseFloat(tg[1]);
      });
      if (ctrl.length < 2) return fit;
      if (knots.length !== ctrl.length + deg + 1) {
        knots = [];
        for (var i = 0; i < ctrl.length + deg + 1; i++) knots.push(i <= deg ? 0 : i >= ctrl.length ? ctrl.length - deg : i - deg);
      }
      var lo = knots[deg], hi = knots[ctrl.length], n = Math.max(16, ctrl.length * 12), out = [];
      for (var k = 0; k <= n; k++) {
        var u = lo + (hi - lo) * k / n;
        out.push(deBoor(deg, knots, ctrl, w, Math.min(u, hi - 1e-12 * (hi - lo || 1))));
      }
      out[out.length - 1] = deBoor(deg, knots, ctrl, w, hi - 1e-9 * (hi - lo || 1));
      return out;
    }
    function deBoor(p, U, P, W, u) {
      var n = P.length - 1, k = p;
      for (var i = p; i <= n; i++) if (u >= U[i] && u < U[i + 1]) { k = i; break; }
      var d = [];
      for (var j = 0; j <= p; j++) {
        var idx = k - p + j, wt = W.length === P.length ? W[idx] : 1;
        d.push({ x: P[idx].x * wt, y: P[idx].y * wt, w: wt });
      }
      for (var r = 1; r <= p; r++) {
        for (var jj = p; jj >= r; jj--) {
          var ii = k - p + jj, den = U[ii + p - r + 1] - U[ii], a = den ? (u - U[ii]) / den : 0;
          d[jj] = { x: (1 - a) * d[jj - 1].x + a * d[jj].x, y: (1 - a) * d[jj - 1].y + a * d[jj].y, w: (1 - a) * d[jj - 1].w + a * d[jj].w };
        }
      }
      return { x: d[p].x / d[p].w, y: d[p].y / d[p].w };
    }

    // 마무리
    if (!doc.layers.length || !Model.layerOf(doc, '0')) doc.layers.unshift({ name: '0', color: 7, ltype: 'CONTINUOUS', visible: true, locked: false });
    if (!doc.ltypes.CONTINUOUS) doc.ltypes.CONTINUOUS = { desc: '실선', pat: [] };
    Object.keys(Model.LTYPES).forEach(function (k) { if (!doc.ltypes[k]) doc.ltypes[k] = JSON.parse(JSON.stringify(Model.LTYPES[k])); });
    if (!Model.layerOf(doc, doc.currentLayer)) doc.currentLayer = '0';
    // 단위: 인치 도면이면 알림만
    if (report.insunits === 1) report.warnings.push('이 도면은 인치 단위로 저장되어 있습니다. 숫자는 그대로 mm로 읽었습니다.');
    Model.touch();
    return { doc: doc, report: report };
  }

  NS.DXF = NS.DXF || {};
  NS.DXF.read = read;
  NS.DXF.decodeStr = decodeStr;
  NS.DXF.plainMtext = plainMtext;
})(typeof globalThis !== 'undefined' ? globalThis : this);
