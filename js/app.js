// 화면 연결: 마우스·키보드·명령줄·스냅·패널·파일·되돌리기·자동 저장.
(function (g) {
  'use strict';
  var NS = g.DCAD, G = NS.G, M = G.M, Model = NS.Model, Cmd = NS.Commands, Lib = NS.Library;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var AUTOSAVE = 'daedong-cad.autosave.v1', PREFS = 'daedong-cad.prefs.v1', CLIP = 'daedong-cad.clip.v1';
  function lsGet(k) { try { return g.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { g.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  // 데스크톱 앱(desktop/, Electron)에서만 있는 PC 파일 연결. 브라우저에서는 null이고 내려받기로 저장한다.
  var Desk = g.dcadDesktop || null;

  var App = {
    doc: null, R: null, sel: new Set(), hover: null,
    undo: [], redo: [], dirty: false,
    file: null, // 데스크톱: 지금 도면의 PC 파일 { path, name, kind: 'dxf'|'work', ours: 우리가 쓴 파일이면 true }
    tog: { grid: true, snap: false, ortho: false, osnap: true, lw: true },
    osnapKinds: { end: true, mid: true, cen: true, qua: true, int: true, ins: true, per: true, nea: false },
    cursor: null, cursorWorld: null, snap: null,
    state: {}, lastCmd: null, history: [], histPos: -1
  };
  NS.App = App;

  // ---------- 메시지 ----------
  function msg(s, cls) {
    var h = $('#history'), d = document.createElement('div');
    d.textContent = s; if (cls) d.className = cls;
    h.appendChild(d);
    while (h.childNodes.length > 300) h.removeChild(h.firstChild);
    h.scrollTop = h.scrollHeight;
  }
  App.msg = msg;

  // ---------- 문서 ----------
  function setDoc(doc, keepView) {
    App.doc = doc;
    App.sel.clear(); App.hover = null;
    Model.touch();
    rebuildIndex();
    if (!keepView) zoomExtents();
    refreshPanels();
    updateTitle();
    redraw();
  }
  var index = new Map();
  function rebuildIndex() { index = new Map(); App.doc.ents.forEach(function (e) { index.set(e.id, e); }); }
  function entById(id) { return index.get(id); }
  function selectedEnts() { var out = []; App.sel.forEach(function (id) { var e = entById(id); if (e) out.push(e); }); return out; }
  function updateTitle() {
    $('#docname').textContent = (App.dirty ? '● ' : '') + (App.doc.name || '새 도면') + '  ·  1:' + G.fmt(App.doc.settings.scale || 1, 3) + (App.doc.settings.sheet ? '  ·  ' + App.doc.settings.sheet : '');
    document.title = (App.dirty ? '● ' : '') + (App.file ? App.file.name : (App.doc.name || '새 도면')) + ' - 대동 CAD';
    if (Desk) Desk.setDirty(App.dirty);
  }

  // ---------- 되돌리기 ----------
  function snapshot() { return JSON.stringify(App.doc); }
  function pushUndo() {
    App.undo.push(snapshot());
    if (App.undo.length > 60) App.undo.shift();
    App.redo.length = 0;
  }
  function markChanged() {
    Model.touch();
    App.dirty = true; updateTitle();
    scheduleAutosave();
  }
  function doUndo() {
    if (Engine.cur) Engine.cancel();
    if (!App.undo.length) { msg('되돌릴 것이 없습니다.'); return; }
    App.redo.push(snapshot());
    App.doc = JSON.parse(App.undo.pop());
    App.sel.clear(); rebuildIndex(); markChanged(); refreshPanels(); redraw(); msg('되돌렸습니다.');
  }
  function doRedo() {
    if (Engine.cur) Engine.cancel();
    if (!App.redo.length) { msg('다시 할 것이 없습니다.'); return; }
    App.undo.push(snapshot());
    App.doc = JSON.parse(App.redo.pop());
    App.sel.clear(); rebuildIndex(); markChanged(); refreshPanels(); redraw(); msg('다시 했습니다.');
  }
  var saveTimer = null;
  function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (!lsSet(AUTOSAVE, snapshot())) msg('브라우저 자동 저장 공간이 모자랍니다. 작업 파일로 저장해 주세요.', 'err');
    }, 800);
  }

  // ---------- 명령 엔진 ----------
  var ctx = {
    get doc() { return App.doc; },
    get state() { return App.state; },
    tmp: function (type, props) {
      var e = Model.mk(null, type, Model.clone(props));
      e.layer = App.doc.currentLayer;
      return e;
    },
    change: function () { if (Engine.cur) { if (!Engine.cur.changed) { pushUndo(); Engine.cur.changed = true; } } else pushUndo(); },
    modified: function () { markChanged(); },
    add: function (e) {
      ctx.change();
      if (!e.id) e.id = App.doc.nextId++;
      else if (index.has(e.id)) e.id = App.doc.nextId++;
      App.doc.ents.push(e); index.set(e.id, e);
      markChanged();
      return e;
    },
    addBehind: function (e) { // 해치처럼 다른 객체 뒤에 그릴 것
      ctx.change();
      if (!e.id || index.has(e.id)) e.id = App.doc.nextId++;
      App.doc.ents.unshift(e); index.set(e.id, e);
      markChanged();
      return e;
    },
    remove: function (list) {
      ctx.change();
      var kill = new Set(list.map(function (e) { return e.id; }));
      App.doc.ents = App.doc.ents.filter(function (e) { return !kill.has(e.id); });
      kill.forEach(function (id) { App.sel.delete(id); index.delete(id); });
      markChanged();
    },
    replace: function (old, list) {
      ctx.change();
      var i = App.doc.ents.indexOf(old);
      list.forEach(function (e) { if (!e.id || index.has(e.id)) e.id = App.doc.nextId++; });
      if (i >= 0) Array.prototype.splice.apply(App.doc.ents, [i, 1].concat(list));
      else list.forEach(function (e) { App.doc.ents.push(e); });
      App.sel.delete(old.id); index.delete(old.id);
      list.forEach(function (e) { index.set(e.id, e); });
      markChanged();
    },
    msg: function (s) { msg(s); },
    visibleEnts: function () {
      return App.doc.ents.filter(function (e) { var l = Model.layerOf(App.doc, e.layer); return !l || l.visible; });
    },
    pickTol: function () { return 7 / App.R.view.scale; },
    viewBox: function () { return App.R.viewBox(); },
    zoomExtents: function () { zoomExtents(); },
    selectedEnts: function () { var s = selectedEnts(); App.sel.clear(); return s; },
    clipboard: function () {
      if (App.clip) return App.clip;
      try { return JSON.parse(lsGet(CLIP) || 'null'); } catch (e) { return null; }
    },
    showQto: function (q, scope) { showQto(q, scope); }
  };

  var Engine = {
    cur: null, req: null,
    start: function (name, pre) {
      var key = Cmd.alias[String(name).toUpperCase()] || Cmd.alias[name];
      var def = key && Cmd.defs[key];
      if (!def) { msg('알 수 없는 명령: ' + name + '  (도움말: F1)', 'err'); return; }
      if (this.cur) this.cancel(true);
      if (key !== '_GRIP') { msg('명령: ' + def.label + ' (' + key + ')', 'me'); App.lastCmd = key; }
      this.cur = { key: key, def: def, gen: def.fn(ctx, pre), changed: false, usedSel: false };
      $$('#tools button[data-cmd]').forEach(function (b) { b.classList.toggle('active', b.dataset.cmd === key); });
      this.advance(undefined);
    },
    advance: function (v) {
      var cur = this.cur, r;
      if (!cur) return;
      try { r = cur.gen.next(v); } catch (err) { console.error(err); msg('오류: ' + err.message, 'err'); this.finish(); return; }
      if (this.cur !== cur) return;
      if (r.done) { this.finish(); return; }
      var req = r.value;
      this.req = req;
      if (req.type === 'select') {
        if (!cur.usedSel && App.sel.size) {
          cur.usedSel = true;
          var ents = selectedEnts(); App.sel.clear();
          this.advance(ents); return;
        }
        cur.usedSel = true;
        App.sel.clear();
      }
      cur.usedSel = true;
      showPrompt();
      updateHover();
      redraw();
    },
    finish: function () {
      var cur = this.cur;
      this.cur = null; this.req = null;
      App.preview = null;
      $$('#tools button[data-cmd]').forEach(function (b) { b.classList.remove('active'); });
      showPrompt();
      if (cur && cur.changed) { refreshPanels(); if (tabNow === 'lib') renderLib(); }
      refreshProps();
      redraw();
    },
    cancel: function (quiet) {
      if (!this.cur) return;
      var cur = this.cur;
      try { cur.gen.return(); } catch (e) { /* 무시 */ }
      if (!quiet) msg('*취소*');
      this.finish();
      if (cur.changed) refreshPanels();
    },
    // 타이핑 입력
    input: function (text) {
      var req = this.req, t = String(text).trim();
      if (!req) return;
      if (!t) {
        if (req.type === 'select') { var ents = selectedEnts(); App.sel.clear(); this.advance(ents); return; }
        if (req.allowNone) { this.advance(null); return; }
        if (req.def !== undefined && req.def !== null) {
          if (req.type === 'choice') this.advance({ kw: req.def }); else this.advance(req.def);
          return;
        }
        if (req.type === 'text') { this.advance(''); return; }
        msg('값을 입력하거나 화면을 클릭하세요.');
        return;
      }
      if (req.kw) {
        var up = t.toUpperCase();
        for (var k in req.kw) if (k.toUpperCase() === up || req.kw[k] === t) { this.advance({ kw: k }); return; }
      }
      switch (req.type) {
        case 'point': {
          var p = Cmd.parsePoint(t, req.base, App.cursorWorld, App.tog.ortho && !req.noOrtho, App.lastPoint);
          if (!p) { msg('좌표 형식: x,y  /  @dx,dy  /  @거리<각도  /  거리만 (커서 방향)', 'err'); return; }
          App.lastPoint = p; this.advance(p); return;
        }
        case 'number': {
          var v = Cmd.evalNum(t);
          if (!isFinite(v) && req.distFromBase) { var q = Cmd.parsePoint(t, req.base, App.cursorWorld, false, App.lastPoint); if (q) v = G.dist(req.base, q); }
          if (!isFinite(v)) { msg('숫자를 입력하세요 (예: 1200, 3000/2).', 'err'); return; }
          this.advance(v); return;
        }
        case 'angle': {
          var a = Cmd.evalNum(t);
          if (!isFinite(a)) { msg('각도를 숫자(도)로 입력하세요.', 'err'); return; }
          this.advance(a); return;
        }
        case 'text': this.advance(text); return;
        case 'choice': msg('보기 중에서 고르세요.', 'err'); return;
        case 'select':
          if (/^(ALL|전체)$/i.test(t)) { pickableEnts().forEach(function (e) { App.sel.add(e.id); }); redraw(); return; }
          msg('객체를 클릭하거나 창으로 고르고 Enter. 전체는 ALL.'); return;
        default: msg('화면에서 객체를 클릭하세요.');
      }
    },
    // 화면 클릭 입력
    clickPoint: function (p, screen) {
      var req = this.req;
      if (!req) return false;
      if (req.type === 'point') { App.lastPoint = p; this.advance(p); return true; }
      if (req.type === 'number' && req.base) { this.advance(G.dist(req.base, p)); return true; }
      if (req.type === 'angle' && req.base) { this.advance(G.deg(G.normAng(G.angle(req.base, p)))); return true; }
      if (req.type === 'entity') {
        var e = pickEnt(App.cursorWorldRaw || p, req.filter);
        if (!e) { msg('그 자리에 고를 수 있는 객체가 없습니다.'); return true; }
        this.advance({ e: e, p: App.cursorWorldRaw || p });
        return true;
      }
      return false;
    }
  };
  App.Engine = Engine;

  function showPrompt() {
    var el = $('#prompt'), req = Engine.req;
    if (!req) { el.textContent = '명령:'; return; }
    var s = req.prompt || '';
    el.textContent = '';
    el.appendChild(document.createTextNode(s + ' '));
    if (req.kw) {
      var span = document.createElement('span'); span.className = 'kw';
      span.textContent = '[' + Object.keys(req.kw).map(function (k) { return req.kw[k] + '(' + k + ')'; }).join(' / ') + '] ';
      el.appendChild(span);
    }
    if (req.def !== undefined && req.def !== null && req.type !== 'select') el.appendChild(document.createTextNode('<' + (typeof req.def === 'number' ? G.fmt(req.def, 3) : req.def) + '> '));
    el.appendChild(document.createTextNode(':'));
  }

  // ---------- 고르기 ----------
  function pickableEnts() {
    return App.doc.ents.filter(function (e) { var l = Model.layerOf(App.doc, e.layer); return !l || (l.visible && !l.locked); });
  }
  function pickEnt(p, filter) {
    var tol = 7 / App.R.view.scale, best = null, bd = Infinity, ents = App.doc.ents;
    for (var i = ents.length - 1; i >= 0; i--) {
      var e = ents[i], l = Model.layerOf(App.doc, e.layer);
      if (l && (!l.visible || l.locked)) continue;
      if (filter && !filter(e)) continue;
      var b = Model.bounds(e, App.doc);
      if (!G.boxValid(b) || !G.boxHas(G.boxGrow(b, tol), p)) continue;
      var d = Model.hitDist(e, App.doc, p);
      if (d <= tol && d < bd - 1e-12) { bd = d; best = e; }
    }
    return best;
  }
  function windowSelect(a, b, crossing) {
    var bx = G.boxFrom(a, b), n = 0;
    pickableEnts().forEach(function (e) {
      var eb = Model.bounds(e, App.doc);
      if (!G.boxValid(eb)) return;
      var ok = crossing ? Model.hitsBox(e, App.doc, bx) : G.boxInside(eb, bx);
      if (ok) { App.sel.add(e.id); n++; }
    });
    return n;
  }

  // ---------- 스냅 ----------
  function wantsPoint() {
    var r = Engine.req;
    return r && (r.type === 'point' || ((r.type === 'number' || r.type === 'angle') && r.base));
  }
  function computeSnap(w) {
    var req = Engine.req, base = req && req.base;
    if (App.tog.osnap) {
      var tol = 10 / App.R.view.scale, K = App.osnapKinds, near = [];
      var area = G.boxGrow({ x0: w.x, y0: w.y, x1: w.x, y1: w.y }, tol);
      var ents = App.doc.ents;
      for (var i = ents.length - 1; i >= 0 && near.length < 150; i--) {
        var e = ents[i], l = Model.layerOf(App.doc, e.layer);
        if ((l && !l.visible) || e.type === 'hatch') continue;
        var b = Model.bounds(e, App.doc);
        if (G.boxValid(b) && G.boxHit(b, area)) near.push(e);
      }
      var best = null, bd = Infinity, rank = { end: 0, int: 0, cen: 0, mid: 0, qua: 0, ins: 0, per: 1, nea: 2 };
      function consider(p, kind) {
        if (!K[kind]) return;
        var d = G.dist(p, w);
        if (d > tol) return;
        var score = rank[kind] * 1e9 + d;
        if (score < bd) { bd = score; best = { p: { x: p.x, y: p.y }, kind: kind }; }
      }
      near.forEach(function (e) { Model.snapsOf(e, App.doc).forEach(function (s) { consider(s.p, s.kind); }); });
      if (K.int && near.length) {
        var ps = [];
        near.slice(0, 40).forEach(function (e) {
          Model.prims(e, App.doc).forEach(function (pr) { if (pr.k !== 'T' && Model.primDist(pr, w) <= tol * 2) ps.push(pr); });
        });
        for (var a = 0; a < ps.length && a < 60; a++) for (var c = a + 1; c < ps.length && c < 60; c++) {
          Model.primInter(ps[a], ps[c]).forEach(function (q) { consider(q, 'int'); });
        }
      }
      if (base && K.per) {
        near.forEach(function (e) {
          Model.prims(e, App.doc).forEach(function (pr) {
            if (pr.k === 'L') { var f = G.projectLine(base, pr.a, pr.b); if (f.t >= 0 && f.t <= 1) consider(f.pt, 'per'); }
            else if (pr.k === 'C' || pr.k === 'A') { var q = G.polar(pr.c, pr.r, G.angle(pr.c, base)); if (pr.k === 'C' || G.angInArc(G.angle(pr.c, base), pr.a0, pr.a1)) consider(q, 'per'); }
          });
        });
      }
      if (K.nea && !best) {
        near.forEach(function (e) { Model.prims(e, App.doc).forEach(function (pr) { var q = Model.primNearest(pr, w); if (q) consider(q, 'nea'); }); });
      }
      if (best) return best;
    }
    var p = { x: w.x, y: w.y };
    if (App.tog.ortho && base && !(req && req.noOrtho)) p = Cmd.ortho(base, p);
    if (App.tog.snap) {
      var gs = App.doc.settings.grid || 10;
      if (App.tog.ortho && base) {
        if (p.y === base.y) p.x = base.x + Math.round((p.x - base.x) / gs) * gs; else p.y = base.y + Math.round((p.y - base.y) / gs) * gs;
      } else { p.x = Math.round(p.x / gs) * gs; p.y = Math.round(p.y / gs) * gs; }
      return { p: p, kind: 'grid' };
    }
    return { p: p, kind: null };
  }

  // ---------- 그리기 ----------
  var rafPending = false;
  function redraw() {
    if (rafPending) return;
    rafPending = true;
    g.requestAnimationFrame(function () { rafPending = false; drawNow(); });
  }
  function drawNow() {
    var req = Engine.req, preview = null, cw = App.snap ? App.snap.p : App.cursorWorld;
    if (req && req.preview && cw) {
      try { preview = req.preview(cw); } catch (e) { preview = null; }
    }
    var grips = null;
    if (!Engine.cur && App.sel.size && App.sel.size <= 40) {
      grips = [];
      selectedEnts().forEach(function (e) { Cmd.gripsOf(e).forEach(function (gp) { grips.push({ p: gp.p, k: gp.k, e: e }); }); });
    }
    App.grips = grips;
    App.R.draw({
      doc: App.doc, sel: App.sel, hover: App.hover, preview: preview,
      snap: App.snap && App.snap.kind ? App.snap : null,
      rubber: App.rubber, grid: App.tog.grid, cursor: App.cursor,
      grips: grips, hotGrip: App.hotGrip,
      base: req && req.base, cursorWorld: cw, rubberLine: !!(req && req.base && !preview),
      pickMode: req && (req.type === 'select' || req.type === 'entity')
    });
  }
  function zoomExtents() {
    var b = Model.extents(App.doc);
    if (!G.boxValid(b)) {
      var k = App.doc.settings.scale || 1;
      b = { x0: 0, y0: 0, x1: 420 * k, y1: 297 * k };
    }
    App.R.fit(b);
    redraw();
  }
  App.zoomExtents = zoomExtents;

  // ---------- 마우스 ----------
  var cv, drag = null;
  function screenPt(ev) { var r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function updateHover() {
    var req = Engine.req;
    var hoverMode = !req || req.type === 'select' || req.type === 'entity';
    var h = null;
    if (hoverMode && App.cursorWorldRaw && !drag) {
      var e = pickEnt(App.cursorWorldRaw, req && req.type === 'entity' ? req.filter : null);
      h = e ? e.id : null;
    }
    App.hover = h;
  }
  function onMove(ev) {
    var s = screenPt(ev);
    App.cursor = s;
    var w = App.R.toWorld(s);
    App.cursorWorldRaw = w;
    if (drag && drag.pan) {
      App.R.view.cx -= (s.x - drag.last.x) / App.R.view.scale;
      App.R.view.cy += (s.y - drag.last.y) / App.R.view.scale;
      drag.last = s; redraw(); return;
    }
    if (drag && drag.win) {
      if (Math.abs(s.x - drag.start.x) + Math.abs(s.y - drag.start.y) > 4) drag.moved = true;
      if (drag.moved) App.rubber = { a: drag.startW, b: w, crossing: s.x < drag.start.x };
    }
    if (wantsPoint()) { App.snap = computeSnap(w); App.cursorWorld = App.snap.p; }
    else { App.snap = null; App.cursorWorld = w; }
    // 그립 위인지
    App.hotGrip = null;
    if (App.grips && !Engine.cur) {
      for (var i = 0; i < App.grips.length; i++) {
        var gs = App.R.toScreen(App.grips[i].p);
        if (Math.abs(gs.x - s.x) <= 6 && Math.abs(gs.y - s.y) <= 6) { App.hotGrip = i; break; }
      }
    }
    updateHover();
    var p = App.cursorWorld;
    var dg = App.doc.settings.dim && App.doc.settings.dim.dec;
    var txt = 'X ' + G.fmt(p.x, Math.max(1, dg || 0)) + '   Y ' + G.fmt(p.y, Math.max(1, dg || 0));
    if (Engine.req && Engine.req.base) {
      var b = Engine.req.base;
      txt += '   거리 ' + G.fmt(G.dist(b, p), 1) + '  각도 ' + G.fmt(G.deg(G.normAng(G.angle(b, p))), 1) + '°';
    }
    $('#coords').textContent = txt;
    redraw();
  }
  function onDown(ev) {
    cv.focus({ preventScroll: true });
    var s = screenPt(ev), w = App.R.toWorld(s);
    if (ev.button === 1 || (ev.button === 0 && App.spaceDown)) {
      ev.preventDefault();
      drag = { pan: true, last: s };
      return;
    }
    if (ev.button !== 0) return;
    var req = Engine.req;
    if (req && req.type !== 'select') {
      if (wantsPoint()) { var sn = computeSnap(w); Engine.clickPoint(sn.p, s); }
      else if (req.type === 'entity') { App.cursorWorldRaw = w; Engine.clickPoint(w, s); }
      else msg('값을 입력하세요.');
      return;
    }
    // 그립 잡기
    if (!req && App.hotGrip !== null && App.grips && App.grips[App.hotGrip]) {
      var gp = App.grips[App.hotGrip];
      Engine.start('_GRIP', { e: gp.e, grip: { p: gp.p, k: gp.k } });
      return;
    }
    var hit = pickEnt(w);
    if (hit) {
      if (ev.shiftKey) App.sel.delete(hit.id); else App.sel.add(hit.id);
      refreshProps(); redraw();
      return;
    }
    drag = { win: true, start: s, startW: w, moved: false, shift: ev.shiftKey };
  }
  function onUp(ev) {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.win) {
      if (d.moved && App.rubber) {
        if (d.shift) {
          var bx = G.boxFrom(App.rubber.a, App.rubber.b), cr = App.rubber.crossing;
          selectedEnts().forEach(function (e) { var eb = Model.bounds(e, App.doc); if (cr ? Model.hitsBox(e, App.doc, bx) : G.boxInside(eb, bx)) App.sel.delete(e.id); });
        } else windowSelect(App.rubber.a, App.rubber.b, App.rubber.crossing);
      } else if (!Engine.req && !d.shift) { App.sel.clear(); }
      App.rubber = null;
      refreshProps(); redraw();
    }
  }
  function onWheel(ev) {
    ev.preventDefault();
    var s = screenPt(ev), f = Math.pow(1.0015, -ev.deltaY * (ev.deltaMode === 1 ? 30 : 1));
    App.R.zoomAt(s, f);
    onMove(ev);
  }
  function enterKey() {
    if (Engine.cur) { Engine.input(''); return; }
    if (App.lastCmd) Engine.start(App.lastCmd);
  }

  // ---------- 키보드 ----------
  function onKey(ev) {
    var inField = /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName) && ev.target.id !== 'cmd';
    var dlgOpen = document.querySelector('dialog[open]');
    if (dlgOpen) return;
    var k = ev.key;
    if (k === 'Escape') {
      closePops();
      if (Engine.cur) Engine.cancel(); else { App.sel.clear(); refreshProps(); redraw(); }
      $('#cmd').value = '';
      return;
    }
    if (k === 'F1') { ev.preventDefault(); openHelp(); return; }
    if (k === 'F3') { ev.preventDefault(); toggle('osnap'); return; }
    if (k === 'F7') { ev.preventDefault(); toggle('grid'); return; }
    if (k === 'F8') { ev.preventDefault(); toggle('ortho'); return; }
    if (k === 'F9') { ev.preventDefault(); toggle('snap'); return; }
    if (inField) return;
    if (ev.ctrlKey || ev.metaKey) {
      var lk = k.toLowerCase();
      if (lk === 'z') { ev.preventDefault(); ev.shiftKey ? doRedo() : doUndo(); return; }
      if (lk === 'y') { ev.preventDefault(); doRedo(); return; }
      if (lk === 's') { ev.preventDefault(); saveCurrent({ ask: ev.shiftKey }); return; }
      if (lk === 'o') { ev.preventDefault(); openAsk(); return; }
      if (lk === 'c' && ev.target.id !== 'cmd' && !window.getSelection().toString()) { ev.preventDefault(); copySel(); return; }
      if (lk === 'v' && ev.target.id !== 'cmd') { ev.preventDefault(); Engine.start('_PASTE'); return; }
      if (lk === 'a' && ev.target.id !== 'cmd') { ev.preventDefault(); pickableEnts().forEach(function (e) { App.sel.add(e.id); }); refreshProps(); redraw(); return; }
      return;
    }
    if (k === ' ' && ev.target.id !== 'cmd') { App.spaceDown = true; }
    if (k === 'Delete' && !Engine.cur && App.sel.size && ev.target.id !== 'cmd') {
      ctx.remove(selectedEnts()); refreshProps(); redraw(); return;
    }
    if (ev.target.id !== 'cmd' && k.length === 1 && !ev.altKey && k !== ' ') {
      $('#cmd').focus(); // 글자는 명령줄로
    }
    if (ev.target.id !== 'cmd' && (k === 'Enter')) { ev.preventDefault(); enterKey(); }
  }
  function onCmdKey(ev) {
    var input = ev.target, req = Engine.req;
    if (ev.key === 'Enter' || (ev.key === ' ' && !(req && req.type === 'text'))) {
      if (ev.isComposing) return;
      ev.preventDefault();
      var t = input.value; input.value = '';
      if (t.trim()) { App.history.push(t); App.histPos = App.history.length; msg('> ' + t, 'me'); }
      if (Engine.cur) Engine.input(t);
      else if (t.trim()) Engine.start(t.trim());
      else enterKey();
      cv.focus({ preventScroll: true });
      return;
    }
    if (ev.key === 'ArrowUp' && App.history.length) { ev.preventDefault(); App.histPos = Math.max(0, App.histPos - 1); input.value = App.history[App.histPos] || ''; }
    if (ev.key === 'ArrowDown' && App.history.length) { ev.preventDefault(); App.histPos = Math.min(App.history.length, App.histPos + 1); input.value = App.history[App.histPos] || ''; }
  }

  function toggle(name) {
    App.tog[name] = !App.tog[name];
    if (name === 'lw') App.R.showLw = App.tog.lw;
    syncToggles();
    msg({ grid: '격자', snap: '격자스냅', ortho: '직교', osnap: '객체스냅', lw: '선 굵기 보기' }[name] + ' ' + (App.tog[name] ? '켬' : '끔'));
    savePrefs();
    redraw();
  }
  function syncToggles() { $$('#status button[data-tog]').forEach(function (b) { b.classList.toggle('on', !!App.tog[b.dataset.tog]); }); }
  function savePrefs() { lsSet(PREFS, JSON.stringify({ tog: App.tog, osnap: App.osnapKinds, dark: App.R.dark })); }
  // 고른 객체 복사 (쓰는 블록·도면층 정의도 함께, 다른 도면에 붙여 넣을 수 있게 브라우저에도 남김)
  function copySel() {
    var list = selectedEnts();
    if (!list.length) { msg('복사할 객체를 먼저 고르세요.'); return; }
    var blocks = {}, layers = {}, b = G.box();
    function needBlocks(ents) { ents.forEach(function (e) { if (e.type === 'insert' && App.doc.blocks[e.name] && !blocks[e.name]) { blocks[e.name] = App.doc.blocks[e.name]; needBlocks(App.doc.blocks[e.name].ents); } }); }
    needBlocks(list);
    list.forEach(function (e) { var l = Model.layerOf(App.doc, e.layer); if (l) layers[l.name] = l; var eb = Model.bounds(e, App.doc); if (G.boxValid(eb)) b = G.boxUnion(b, eb); });
    App.clip = Model.clone({ ents: list, blocks: blocks, layers: Object.keys(layers).map(function (k) { return layers[k]; }), base: { x: b.x0, y: b.y0 } });
    lsSet(CLIP, JSON.stringify(App.clip));
    msg(list.length + '개를 복사했습니다. Ctrl+V로 붙여 넣습니다 (다른 도면에도 됩니다).', 'ok');
  }
  // 물량 산출 창
  function showQto(q, scope) {
    var dlg = $('#dlg-qto'), body = $('#qto-body');
    body.textContent = '';
    var p = document.createElement('p'); p.className = 'hint'; p.textContent = '범위: ' + scope + '. 숫자는 그린 도형 그대로 잰 값입니다(견적 전 현장 실측으로 확인).'; body.appendChild(p);
    function table(title, head, rows) {
      var h = document.createElement('h4'); h.textContent = title; body.appendChild(h);
      if (!rows.length) { var e = document.createElement('p'); e.className = 'hint'; e.textContent = '없음'; body.appendChild(e); return; }
      var t = document.createElement('table'); t.className = 'qto';
      var tr = document.createElement('tr'); head.forEach(function (c) { var th = document.createElement('th'); th.textContent = c; tr.appendChild(th); }); t.appendChild(tr);
      rows.forEach(function (r) { var row = document.createElement('tr'); r.forEach(function (c, i) { var td = document.createElement('td'); td.textContent = c; if (i >= head.length - 2) td.className = 'num'; row.appendChild(td); }); t.appendChild(row); });
      body.appendChild(t);
    }
    table('개수 (블록·기호)', ['이름', '블록', '개수'], q.blocks.map(function (b) { return [b.label, b.name, String(b.count)]; }));
    table('길이 (도면층별, 선·호·원·폴리선 합)', ['도면층', '길이 (m)'], q.lengths.map(function (l) { return [l.layer, G.fmt(l.m, 2)]; }));
    table('넓이 (닫힌 도형·해치)', ['도면층', '종류', '넓이 (m²)', '평'], q.areas.map(function (a) { return [a.layer, a.kind + ' ' + a.count + '개', G.fmt(a.m2, 3), G.fmt(a.m2 / 3.305785, 2)]; }));
    App.qto = { q: q, scope: scope };
    dlg.showModal();
  }

  // ---------- 패널: 도면층 ----------
  var tabNow = 'layers';
  function refreshPanels() { renderLayers(); refreshProps(); }
  function renderLayers() {
    var pane = $('#pane-layers'), doc = App.doc;
    pane.textContent = '';
    var hd = document.createElement('h4'); hd.textContent = '도면층 (' + doc.layers.length + ')'; pane.appendChild(hd);
    doc.layers.forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'layer-row' + (l.name === doc.currentLayer ? ' cur' : '');
      var rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'curlayer'; rb.checked = l.name === doc.currentLayer; rb.title = '현재 도면층';
      rb.onchange = function () { doc.currentLayer = l.name; renderLayers(); msg('현재 도면층: ' + l.name); scheduleAutosave(); };
      var sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = Model.aciRgb(Math.abs(l.color), App.R.dark); sw.title = '색 ' + l.color;
      sw.onclick = function (ev) { colorPop(ev, l.color, false, function (c) { pushUndo(); l.color = c; markChanged(); renderLayers(); redraw(); }); };
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = l.name; nm.title = l.name + ' (두 번 클릭: 이름 바꾸기)';
      nm.ondblclick = function () {
        var n = g.prompt('도면층 이름', l.name);
        if (!n || n === l.name) return;
        if (Model.layerOf(doc, n)) { msg('같은 이름의 도면층이 있습니다.', 'err'); return; }
        if (l.name === '0') { msg('0 도면층 이름은 바꿀 수 없습니다.', 'err'); return; }
        pushUndo();
        doc.ents.forEach(function (e) { if (e.layer === l.name) e.layer = n; });
        Object.keys(doc.blocks).forEach(function (bn) { doc.blocks[bn].ents.forEach(function (e) { if (e.layer === l.name) e.layer = n; }); });
        if (doc.currentLayer === l.name) doc.currentLayer = n;
        l.name = n; markChanged(); renderLayers(); redraw();
      };
      var eye = document.createElement('button'); eye.className = 'icon-toggle' + (l.visible ? '' : ' off'); eye.textContent = '◉'; eye.title = l.visible ? '보임 (누르면 숨김)' : '숨김 (누르면 보임)';
      eye.onclick = function () { l.visible = !l.visible; if (!l.visible) selectedEnts().forEach(function (e) { if (e.layer === l.name) App.sel.delete(e.id); }); markChanged(); renderLayers(); redraw(); };
      var lock = document.createElement('button'); lock.className = 'icon-toggle' + (l.locked ? '' : ' off'); lock.textContent = '🔒'; lock.title = l.locked ? '잠김 (누르면 풀림)' : '풀림 (누르면 잠금)';
      lock.onclick = function () { l.locked = !l.locked; if (l.locked) selectedEnts().forEach(function (e) { if (e.layer === l.name) App.sel.delete(e.id); }); markChanged(); renderLayers(); redraw(); };
      var lt = ltypeSelect(l.ltype || 'CONTINUOUS', false);
      lt.onchange = function () { pushUndo(); l.ltype = lt.value; Model.ensureLtype(doc, lt.value); markChanged(); redraw(); };
      var lw = lwSelect(l.lw || Model.LW_DEFAULT, false);
      lw.title = '선 굵기 (인쇄할 때 종이 mm)';
      lw.onchange = function () { pushUndo(); l.lw = parseFloat(lw.value); markChanged(); redraw(); };
      [rb, sw, nm, eye, lock, lt, lw].forEach(function (x) { row.appendChild(x); });
      pane.appendChild(row);
    });
    var act = document.createElement('div'); act.className = 'actions';
    var add = document.createElement('button'); add.textContent = '새 도면층';
    add.onclick = function () {
      var n = g.prompt('새 도면층 이름', '도면층' + doc.layers.length);
      if (!n) return;
      if (Model.layerOf(doc, n)) { msg('같은 이름이 있습니다.', 'err'); return; }
      pushUndo(); Model.ensureLayer(doc, n, 7); doc.currentLayer = n; markChanged(); renderLayers();
    };
    var del = document.createElement('button'); del.textContent = '빈 도면층 지우기';
    del.onclick = function () {
      var used = {};
      doc.ents.forEach(function (e) { used[e.layer] = true; });
      Object.keys(doc.blocks).forEach(function (bn) { doc.blocks[bn].ents.forEach(function (e) { used[e.layer] = true; }); });
      var before = doc.layers.length;
      pushUndo();
      doc.layers = doc.layers.filter(function (l) { return l.name === '0' || l.name === doc.currentLayer || used[l.name]; });
      markChanged(); renderLayers();
      msg((before - doc.layers.length) + '개 빈 도면층을 지웠습니다.');
    };
    act.appendChild(add); act.appendChild(del); pane.appendChild(act);
    var hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = '○ 현재 도면층 · 색 네모: 색 바꾸기 · ◉ 보이기 · 🔒 잠그기(잠긴 층은 고를 수 없음) · 이름을 두 번 클릭하면 이름 바꾸기';
    pane.appendChild(hint);
  }
  function lwSelect(cur, withBy) {
    var s = document.createElement('select');
    (withBy ? [['', '도면층 따름']] : []).concat(Model.LWEIGHTS.map(function (w) { return [String(w), G.fmt(w, 2)]; })).forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1];
      if (String(cur) === o[0] || (!cur && o[0] === '')) op.selected = true;
      s.appendChild(op);
    });
    return s;
  }
  function ltypeSelect(cur, withBy) {
    var s = document.createElement('select');
    var names = (withBy ? ['BYLAYER', 'BYBLOCK'] : []).concat(Object.keys(App.doc.ltypes));
    Object.keys(Model.LTYPES).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    names.forEach(function (n) {
      var o = document.createElement('option'); o.value = n;
      o.textContent = n === 'BYLAYER' ? '도면층 따름' : n === 'BYBLOCK' ? '블록 따름' : Model.LTYPES[n] ? Model.LTYPES[n].desc.split(' ')[0] : n;
      o.title = n;
      if (n === cur) o.selected = true;
      s.appendChild(o);
    });
    return s;
  }

  // 색 고르기 창
  function closePops() { $$('.pop').forEach(function (p) { p.remove(); }); }
  function colorPop(ev, cur, allowBy, done) {
    closePops();
    var pop = document.createElement('div'); pop.className = 'pop';
    var t = document.createElement('div'); t.textContent = '색 (현재 ' + (cur === 256 ? '도면층 따름' : cur === 0 ? '블록 따름' : cur) + ')'; pop.appendChild(t);
    function sw(i, parent) {
      var s = document.createElement('span'); s.style.background = Model.aciRgb(i, App.R.dark); s.title = String(i);
      s.onclick = function () { closePops(); done(i); }; parent.appendChild(s);
    }
    var base = document.createElement('div'); base.className = 'aci-base';
    for (var i = 1; i <= 9; i++) sw(i, base);
    for (var j = 250; j <= 255; j++) sw(j, base);
    pop.appendChild(base);
    var grid = document.createElement('div'); grid.className = 'aci-grid';
    for (var r = 0; r < 10; r++) for (var c = 0; c < 24; c++) sw(10 + c * 10 + r, grid);
    pop.appendChild(grid);
    if (allowBy) {
      var row = document.createElement('div'); row.className = 'actions';
      [['도면층 따름', 256], ['블록 따름', 0]].forEach(function (x) { var b = document.createElement('button'); b.textContent = x[0]; b.onclick = function () { closePops(); done(x[1]); }; row.appendChild(b); });
      pop.appendChild(row);
    }
    document.body.appendChild(pop);
    var x = Math.min(ev.clientX, g.innerWidth - 330), y = Math.min(ev.clientY + 10, g.innerHeight - 260);
    pop.style.left = Math.max(4, x) + 'px'; pop.style.top = Math.max(4, y) + 'px';
    setTimeout(function () { document.addEventListener('mousedown', function off(e2) { if (!pop.contains(e2.target)) { closePops(); document.removeEventListener('mousedown', off); } }); }, 0);
  }

  // ---------- 패널: 속성 ----------
  function field(pane, label, value, onSet, opts) {
    opts = opts || {};
    var row = document.createElement('div'); row.className = 'prop';
    var l = document.createElement('label'); l.textContent = label; row.appendChild(l);
    var el;
    if (opts.readonly) { el = document.createElement('span'); el.className = 'ro'; el.textContent = value; }
    else if (opts.options) {
      el = document.createElement('select');
      opts.options.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; if (String(o[0]) === String(value)) op.selected = true; el.appendChild(op); });
      el.onchange = function () { onSet(el.value); };
    } else if (opts.check) {
      el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!value; el.style.width = 'auto';
      el.onchange = function () { onSet(el.checked); };
    } else {
      el = document.createElement('input'); el.type = 'text'; el.value = value;
      el.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } ev.stopPropagation(); };
      el.onchange = function () {
        if (opts.text) { onSet(el.value); return; }
        var v = Cmd.evalNum(el.value);
        if (!isFinite(v)) { msg('숫자를 입력하세요.', 'err'); return; }
        onSet(v);
      };
    }
    row.appendChild(el); pane.appendChild(row);
    return el;
  }
  function edit(fn) { pushUndo(); fn(); markChanged(); refreshProps(); redraw(); }
  function refreshProps() {
    var pane = $('#pane-props'), doc = App.doc, list = selectedEnts();
    if (!pane) return;
    pane.textContent = '';
    var h = document.createElement('h4');
    if (!list.length) {
      h.textContent = '도면 설정'; pane.appendChild(h);
      var st = doc.settings;
      field(pane, '도면 이름', doc.name, function (v) { edit(function () { doc.name = v; }); updateTitle(); }, { text: true });
      field(pane, '축척 1:', G.fmt(st.scale || 1, 4), function (v) {
        if (!(v > 0)) return;
        edit(function () { Lib.applyScale(doc, v, st.dim.dec); });
        updateTitle(); msg('축척 1:' + G.fmt(v, 4) + ' — 새로 쓰는 문자·치수 크기와 선 종류 간격이 바뀝니다. 기존 치수는 그대로입니다.');
      });
      field(pane, '격자 간격', G.fmt(st.grid, 4), function (v) { if (v > 0) edit(function () { st.grid = v; }); });
      field(pane, '문자 높이', G.fmt(st.textH, 3), function (v) { if (v > 0) edit(function () { st.textH = v; App.state.textH = v; }); });
      field(pane, '치수 문자', G.fmt(st.dim.textH, 3), function (v) { if (v > 0) edit(function () { st.dim.textH = v; }); });
      field(pane, '치수 화살표', G.fmt(st.dim.arrow, 3), function (v) { if (v > 0) edit(function () { st.dim.arrow = v; }); });
      field(pane, '치수 소수', st.dim.dec, function (v) { edit(function () { st.dim.dec = Math.max(0, Math.min(6, Math.round(v))); }); });
      field(pane, '선 종류 축척', G.fmt(st.ltscale, 4), function (v) { if (v > 0) edit(function () { st.ltscale = v; }); });
      field(pane, '치수 끝', st.dim.arrowType || 'arrow', function (v) { edit(function () { st.dim.arrowType = v; }); }, { options: [['arrow', '화살표 (기계)'], ['tick', '사선 (건축)'], ['dot', '점']] });
      field(pane, '개체 수', String(doc.ents.length), null, { readonly: true });
      field(pane, '블록 정의', String(Object.keys(doc.blocks).length), null, { readonly: true });
      var hint = document.createElement('p'); hint.className = 'hint';
      hint.textContent = '객체를 클릭하면 여기에서 도면층·색·좌표·크기를 바꿀 수 있습니다. 단위는 mm입니다.';
      pane.appendChild(hint);
      return;
    }
    var TYPE = { line: '선', circle: '원', arc: '호', poly: '폴리선', ellipse: '타원', text: '문자', mtext: '여러 줄 문자', dim: '치수', insert: '블록(기호)', point: '점', hatch: '해치' };
    h.textContent = list.length === 1 ? TYPE[list[0].type] || list[0].type : list.length + '개 선택';
    pane.appendChild(h);
    var layerOpts = doc.layers.map(function (l) { return [l.name, l.name]; });
    var first = list[0];
    var same = function (k) { return list.every(function (e) { return e[k] === first[k]; }); };
    field(pane, '도면층', same('layer') ? first.layer : '', function (v) { edit(function () { list.forEach(function (e) { e.layer = v; }); }); }, { options: (same('layer') ? [] : [['', '(여러 개)']]).concat(layerOpts) });
    var crow = document.createElement('div'); crow.className = 'prop';
    var cl = document.createElement('label'); cl.textContent = '색'; crow.appendChild(cl);
    var cb = document.createElement('button'); var cc = same('color') ? first.color : null;
    cb.textContent = cc === null ? '(여러 개)' : cc === 256 ? '도면층 따름' : cc === 0 ? '블록 따름' : '색 ' + cc;
    if (cc !== null && cc !== 256 && cc !== 0) cb.style.borderLeft = '14px solid ' + Model.aciRgb(cc, App.R.dark);
    cb.onclick = function (ev) { colorPop(ev, cc === null ? 256 : cc, true, function (c) { edit(function () { list.forEach(function (e) { e.color = c; }); }); }); };
    crow.appendChild(cb); pane.appendChild(crow);
    var ltr = document.createElement('div'); ltr.className = 'prop';
    var ll = document.createElement('label'); ll.textContent = '선 종류'; ltr.appendChild(ll);
    var ls = ltypeSelect(same('ltype') ? first.ltype || 'BYLAYER' : 'BYLAYER', true);
    ls.onchange = function () { edit(function () { Model.ensureLtype(doc, ls.value); list.forEach(function (e) { e.ltype = ls.value; }); }); };
    ltr.appendChild(ls); pane.appendChild(ltr);
    var lwr = document.createElement('div'); lwr.className = 'prop';
    var lwl = document.createElement('label'); lwl.textContent = '선 굵기'; lwr.appendChild(lwl);
    var lws = lwSelect(same('lw') && typeof first.lw === 'number' ? first.lw : '', true);
    lws.onchange = function () { edit(function () { list.forEach(function (e) { if (lws.value) e.lw = parseFloat(lws.value); else delete e.lw; }); }); };
    lwr.appendChild(lws); pane.appendChild(lwr);
    if (list.length !== 1) return;
    var e = first, f = function (x) { return G.fmt(x, 3); };
    var setP = function (obj, key) { return function (v) { edit(function () { obj[key] = v; }); }; };
    switch (e.type) {
      case 'line':
        field(pane, '시작 X', f(e.a.x), setP(e.a, 'x')); field(pane, '시작 Y', f(e.a.y), setP(e.a, 'y'));
        field(pane, '끝 X', f(e.b.x), setP(e.b, 'x')); field(pane, '끝 Y', f(e.b.y), setP(e.b, 'y'));
        field(pane, '길이', f(G.dist(e.a, e.b)), function (v) { if (v > 0) edit(function () { e.b = G.add(e.a, G.mul(G.norm(G.sub(e.b, e.a)), v)); }); });
        field(pane, '각도', f(G.deg(G.normAng(G.angle(e.a, e.b)))) + '°', null, { readonly: true });
        break;
      case 'circle':
        field(pane, '중심 X', f(e.c.x), setP(e.c, 'x')); field(pane, '중심 Y', f(e.c.y), setP(e.c, 'y'));
        field(pane, '반지름', f(e.r), function (v) { if (v > 0) edit(function () { e.r = v; }); });
        field(pane, '지름', f(e.r * 2), function (v) { if (v > 0) edit(function () { e.r = v / 2; }); });
        field(pane, '넓이', G.fmt(Math.PI * e.r * e.r / 1e6, 4) + ' m²', null, { readonly: true });
        break;
      case 'arc':
        field(pane, '중심 X', f(e.c.x), setP(e.c, 'x')); field(pane, '중심 Y', f(e.c.y), setP(e.c, 'y'));
        field(pane, '반지름', f(e.r), function (v) { if (v > 0) edit(function () { e.r = v; }); });
        field(pane, '시작 각도', f(G.deg(G.normAng(e.a0))), function (v) { edit(function () { e.a0 = G.rad(v); }); });
        field(pane, '끝 각도', f(G.deg(G.normAng(e.a1))), function (v) { edit(function () { e.a1 = G.rad(v); }); });
        field(pane, '호 길이', f(e.r * G.sweep(e.a0, e.a1)), null, { readonly: true });
        break;
      case 'poly':
        field(pane, '꼭짓점', String(e.pts.length), null, { readonly: true });
        field(pane, '닫힘', e.closed, function (v) { edit(function () { e.closed = v; }); }, { check: true });
        field(pane, '길이', f(Cmd.entLength(e, doc)), null, { readonly: true });
        if (e.closed) { var a = Math.abs(Cmd.polyAreaBulge(e.pts, true)) / 1e6; field(pane, '넓이', G.fmt(a, 3) + ' m² (' + G.fmt(a / 3.305785, 2) + '평)', null, { readonly: true }); }
        break;
      case 'ellipse':
        field(pane, '중심 X', f(e.c.x), setP(e.c, 'x')); field(pane, '중심 Y', f(e.c.y), setP(e.c, 'y'));
        field(pane, '장축 반', f(G.len(e.major)), null, { readonly: true });
        field(pane, '단축 비', G.fmt(e.ratio, 4), function (v) { if (v > 0 && v <= 1) edit(function () { e.ratio = v; }); });
        break;
      case 'text': case 'mtext':
        field(pane, '내용', e.s, function (v) { edit(function () { e.s = v; }); }, { text: true });
        field(pane, '높이', f(e.h), function (v) { if (v > 0) edit(function () { e.h = v; }); });
        field(pane, '회전', f(G.deg(e.rot || 0)), function (v) { edit(function () { e.rot = G.rad(v); }); });
        field(pane, '위치 X', f(e.p.x), setP(e.p, 'x')); field(pane, '위치 Y', f(e.p.y), setP(e.p, 'y'));
        if (e.type === 'text') field(pane, '정렬', e.align || 'L', function (v) { edit(function () { e.align = v; }); }, { options: [['L', '왼쪽'], ['C', '가운데'], ['R', '오른쪽']] });
        break;
      case 'insert':
        field(pane, '블록', e.name, null, { readonly: true });
        field(pane, '위치 X', f(e.p.x), setP(e.p, 'x')); field(pane, '위치 Y', f(e.p.y), setP(e.p, 'y'));
        field(pane, '회전', f(G.deg(e.rot || 0)), function (v) { edit(function () { e.rot = G.rad(v); }); });
        field(pane, '배율 X', f(e.sx === undefined ? 1 : e.sx), function (v) { if (v) edit(function () { e.sx = v; }); });
        field(pane, '배율 Y', f(e.sy === undefined ? 1 : e.sy), function (v) { if (v) edit(function () { e.sy = v; }); });
        break;
      case 'hatch': {
        var PAT = NS.Hatch.PATTERNS, k0 = doc.settings.scale || 1;
        var regen = function () { e.solid = !!PAT[e.pat].solid; e.fams = NS.Hatch.families(e.pat, e.scale, e.ang || 0); };
        if (PAT[e.pat]) {
          field(pane, '무늬', e.pat, function (v) { edit(function () { e.pat = v; regen(); }); }, { options: Object.keys(PAT).map(function (k) { return [k, PAT[k].label]; }) });
          if (!e.solid) {
            field(pane, '무늬 축척', G.fmt(e.scale / k0, 4), function (v) { if (v > 0) edit(function () { e.scale = v * k0; regen(); }); });
            field(pane, '무늬 각도', G.fmt(G.deg(e.ang || 0), 2), function (v) { edit(function () { e.ang = G.rad(v); regen(); }); });
          }
        } else field(pane, '무늬', (e.pat || '(이름 없음)') + ' (받은 도면)', null, { readonly: true });
        var ha = 0;
        e.loops.forEach(function (l, i) { var a = Math.abs(Cmd.polyAreaBulge(l, true)); ha += i === 0 ? a : -a; });
        field(pane, '경계', e.loops.length + '개' + (e.loops.length > 1 ? ' (안쪽 섬 포함)' : ''), null, { readonly: true });
        field(pane, '넓이(대략)', G.fmt(Math.abs(ha) / 1e6, 3) + ' m² (' + G.fmt(Math.abs(ha) / 1e6 / 3.305785, 2) + '평)', null, { readonly: true });
        if (Model.prims(e, doc).dense) { var hd = document.createElement('p'); hd.className = 'hint'; hd.textContent = '무늬가 너무 촘촘해 경계만 보입니다. 무늬 축척을 키워 주세요.'; pane.appendChild(hd); }
        break;
      }
      case 'dim': {
        var dg = Model.dimGeom(e, doc);
        field(pane, '측정값', f(dg.value), null, { readonly: true });
        field(pane, '문자 바꾸기', e.text || '', function (v) { edit(function () { e.text = v ? v : undefined; }); }, { text: true });
        var hint2 = document.createElement('p'); hint2.className = 'hint'; hint2.textContent = '문자 바꾸기에서 <> 는 측정값 자리입니다 (예: <> (실측)).'; pane.appendChild(hint2);
        break;
      }
    }
  }

  // ---------- 패널: 기호 ----------
  var libCat = '문·창';
  function renderLib() {
    var pane = $('#pane-lib');
    pane.textContent = '';
    var cats = [];
    Lib.SYMBOLS.forEach(function (s) { if (cats.indexOf(s.cat) < 0) cats.push(s.cat); });
    var userBlocks = Object.keys(App.doc.blocks).filter(function (n) { return !Lib.symbolByName(n) && n.charAt(0) !== '*' && n.charAt(0) !== '_'; });
    if (userBlocks.length) cats.push('이 도면의 블록');
    var cb = document.createElement('div'); cb.className = 'lib-cats';
    cats.forEach(function (c) {
      var b = document.createElement('button'); b.textContent = c; if (c === libCat) b.className = 'on';
      b.onclick = function () { libCat = c; renderLib(); }; cb.appendChild(b);
    });
    pane.appendChild(cb);
    var list = document.createElement('div'); list.className = 'lib-list';
    var items = libCat === '이 도면의 블록' ? userBlocks.map(function (n) { return { name: n, label: n, size: '', user: true }; }) : Lib.SYMBOLS.filter(function (s) { return s.cat === libCat; });
    items.forEach(function (s) {
      var b = document.createElement('button'); b.className = 'lib-item'; b.title = s.label + (s.annot ? ' (주석 기호: 축척을 곱해 넣음)' : ' (실제 크기)');
      var c = document.createElement('canvas'); c.width = 128; c.height = 128;
      b.appendChild(c);
      var t = document.createElement('span'); t.textContent = s.label; b.appendChild(t);
      if (s.size && s.label.indexOf(s.size) < 0) { var z = document.createElement('span'); z.className = 'sz'; z.textContent = s.size; b.appendChild(z); }
      b.onclick = function () { Engine.start('INSERT', { name: s.name }); cv.focus(); };
      list.appendChild(b);
      drawThumb(c, s);
    });
    pane.appendChild(list);
    var hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = '기호를 누르고 도면에서 위치를 클릭합니다. 넣기 전에 R로 회전, F로 좌우 뒤집기. 가구·문·조경 기호는 실제 크기(mm)입니다.';
    pane.appendChild(hint);
  }
  function drawThumb(c, s) {
    var tmpDoc = Model.newDoc();
    tmpDoc.blocks = {};
    if (s.user) tmpDoc.blocks[s.name] = App.doc.blocks[s.name];
    else Lib.ensureBlock(tmpDoc, s.name);
    var ins = Model.mk(tmpDoc, 'insert', { name: s.name, p: G.v(0, 0), sx: 1, sy: 1, rot: 0 });
    tmpDoc.ents.push(ins);
    var b = Model.extents(tmpDoc);
    if (!G.boxValid(b)) return;
    var r = new NS.Renderer(c);
    r.w = c.width; r.h = c.height; r.dpr = 1; r.dark = App.R.dark;
    r.fit(b, 0.1);
    var ctx2 = c.getContext('2d');
    ctx2.clearRect(0, 0, c.width, c.height);
    r.worldTransform(ctx2);
    r.drawEnt(ctx2, tmpDoc, ins, null, { color: App.R.dark ? '#cfd6e6' : '#223', width: 1.5, keepLtype: true }, 1);
  }

  // ---------- 파일 ----------
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function baseName() { return (App.doc.name || '도면').replace(/[\\/:*?"<>|]+/g, '_').trim() || '도면'; }
  // 저장: 브라우저는 내려받기, 데스크톱은 PC에 바로 쓴다. 성공하면 { path, name }(브라우저는 이름 문자열), 취소하면 null
  function saveFile(name, data, type, kind, opts) {
    opts = opts || {};
    if (!Desk) { download(name, data, type); return Promise.resolve(name); }
    var cur = !opts.ask && App.file && App.file.kind === kind && App.file.ours ? App.file.path : null;
    var p = data instanceof Blob ? data.arrayBuffer().then(function (b) { return new Uint8Array(b); }) : Promise.resolve(data);
    return p.then(function (d) { return Desk.save({ path: cur, name: name, kind: kind, data: d }); });
  }
  function setFile(r, kind) {
    App.file = { path: r.path, name: r.name, kind: kind, ours: true };
    App.doc.name = r.name.replace(/(\.dcad)?\.json$|\.dcad$|\.dxf$/i, '') || App.doc.name;
  }
  function saved(kind, okMsg) {
    return function (r) {
      if (!r) { msg('저장을 취소했습니다.'); return false; }
      if (Desk) setFile(r, kind);
      App.dirty = false; updateTitle(); scheduleAutosave();
      msg(okMsg + (r.path || r), 'ok');
      return true;
    };
  }
  function saveFailed(what) { return function (err) { console.error(err); msg(what + ' 저장 실패: ' + (err && err.message || err), 'err'); return false; }; }
  function saveDXF(opts) {
    var data;
    try { data = NS.DXF.write(App.doc); } catch (err) { return Promise.resolve(saveFailed('DXF')(err)); }
    return saveFile(baseName() + '.dxf', data, 'application/dxf', 'dxf', opts)
      .then(saved('dxf', 'DXF(R12)로 저장했습니다 (치수·타원·여러 줄 문자는 선과 문자로 풀어서 저장): '), saveFailed('DXF'));
  }
  function saveWork(opts) {
    return saveFile(baseName() + '.dcad.json', JSON.stringify(App.doc), 'application/json', 'work', opts)
      .then(saved('work', '작업 파일로 저장했습니다 (치수·벽·블록 정보가 그대로 남습니다): '), saveFailed('작업 파일'));
  }
  // Ctrl+S: 작업 파일을 열었으면 작업 파일로, 아니면 DXF로. Ctrl+Shift+S는 다른 이름으로
  function saveCurrent(opts) { return App.file && App.file.kind === 'work' ? saveWork(opts) : saveDXF(opts); }
  // 그림·표 내보내기 (데스크톱은 언제나 저장 위치를 묻는다)
  function exportFile(name, data, type, kind, what) {
    return saveFile(name, data, type, kind, { ask: true }).then(function (r) {
      if (!r) { msg('저장을 취소했습니다.'); return false; }
      msg(what + ': ' + (r.path || r), 'ok');
      return true;
    }, saveFailed(what));
  }
  // 데스크톱에서 저장하지 않은 도면을 두고 다른 도면을 열 때 묻기 (브라우저는 되돌리기로 돌아갈 수 있어 묻지 않음)
  function okToReplace() {
    if (!Desk || !App.dirty) return true;
    return g.confirm('지금 도면의 바뀐 내용을 아직 저장하지 않았습니다.\n저장하지 않고 다른 도면으로 바꿀까요?');
  }
  function replaceDoc(d, file) {
    if (Desk) { App.undo.length = 0; App.redo.length = 0; } else pushUndo();
    App.file = file;
    setDoc(d); App.dirty = false; updateTitle();
  }
  function openAsk() {
    if (!Desk) { $('#file').click(); return; }
    if (!okToReplace()) return;
    Desk.open().then(function (f) { if (f) openData(f.name, f.data, f.path); }, function (err) { msg('열기 실패: ' + (err && err.message || err), 'err'); });
  }
  function openPath(p) {
    if (!okToReplace()) return;
    Desk.read(p).then(function (f) { openData(f.name, f.data, f.path); }, function (err) { msg('열기 실패: ' + (err && err.message || err), 'err'); });
  }
  function openFile(file) {
    var fp = Desk && Desk.pathOf(file);
    if (fp) { openPath(fp); return; }
    if (!okToReplace()) return;
    var name = file.name || '', reader = new FileReader();
    reader.onerror = function () { msg('파일을 읽지 못했습니다.', 'err'); };
    reader.onload = function () { openData(name, new Uint8Array(reader.result), null); };
    reader.readAsArrayBuffer(file);
  }
  function openData(name, bytes, path) {
    if (/\.json$|\.dcad$/i.test(name)) {
      try {
        var d = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        if (d.format !== 'daedong-cad') throw new Error('대동 CAD 작업 파일이 아닙니다.');
        replaceDoc(d, path ? { path: path, name: name, kind: 'work', ours: true } : null);
        msg('열었습니다: ' + (path || name), 'ok');
      } catch (err) { msg('열기 실패: ' + err.message, 'err'); }
      return;
    }
    try {
      var t0 = performance.now();
      var r = NS.DXF.read(bytes);
      r.doc.name = name.replace(/\.dxf$/i, '');
      // 받은 DXF는 처음 저장할 때 한 번 묻는다 (R12로 다시 쓰면 원본의 일부 정보가 풀리므로)
      replaceDoc(r.doc, path ? { path: path, name: name, kind: 'dxf', ours: false } : null);
      var sk = Object.keys(r.report.skipped);
      msg('열었습니다: ' + (path || name) + ' (' + (r.report.ver || '버전 미상') + ', 개체 ' + r.doc.ents.length + '개, ' + Math.round(performance.now() - t0) + 'ms)', 'ok');
      if (sk.length) msg('읽지 못한 개체: ' + sk.map(function (k) { return k + ' ' + r.report.skipped[k] + '개'; }).join(', ') + ' (해치 등은 아직 지원하지 않습니다)', 'err');
      r.report.warnings.forEach(function (w) { msg(w, 'err'); });
    } catch (err) { console.error(err); msg('DXF 열기 실패: ' + err.message, 'err'); }
  }
  // 출력 범위: 도곽(표제란 층의 가장 큰 사각형)이 있으면 그 범위, 없으면 전체
  function sheetBox() {
    var best = null, ba = 0;
    App.doc.ents.forEach(function (e) {
      if (e.type === 'poly' && e.closed && e.layer === '표제란' && e.pts.length === 4) {
        var b = Model.bounds(e, App.doc), a = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (a > ba) { ba = a; best = b; }
      }
    });
    return best;
  }
  function exportPNG() {
    var box = sheetBox() || G.boxGrow(Model.extents(App.doc), 1);
    if (!G.boxValid(box)) { msg('그릴 것이 없습니다.'); return; }
    var k = App.doc.settings.scale || 1, ppm = (200 / 25.4) / k; // 종이 200dpi
    var W = (box.x1 - box.x0) * ppm, H = (box.y1 - box.y0) * ppm, lim = 8000;
    if (Math.max(W, H) > lim) ppm *= lim / Math.max(W, H);
    var c = document.createElement('canvas');
    App.R.renderTo(c, App.doc, box, ppm, false);
    c.toBlob(function (b) { exportFile(baseName() + '.png', b, 'image/png', 'png', 'PNG로 내보냈습니다 (' + c.width + '×' + c.height + ')'); }, 'image/png');
  }
  function exportSVG() {
    var box = sheetBox();
    var svg = NS.SVG.toSVG(App.doc, { box: box || undefined, pad: box ? 0 : (App.doc.settings.scale || 1) * 5 });
    exportFile(baseName() + '.svg', svg, 'image/svg+xml', 'svg', 'SVG로 내보냈습니다' + (box ? ' (도곽 범위, 종이 크기 = 실제 축척)' : ' (전체 범위)'));
  }
  // 인쇄·PDF 준비: 도곽 범위를 흑백 SVG로 #printarea에 넣고 종이 크기를 맞춘다
  function preparePrint() {
    var box = sheetBox();
    var svg = NS.SVG.toSVG(App.doc, { box: box || undefined, pad: box ? 0 : (App.doc.settings.scale || 1) * 5, mono: true });
    var pa = $('#printarea');
    pa.innerHTML = svg;
    var st = document.getElementById('page-style') || document.createElement('style');
    st.id = 'page-style';
    var sv = pa.querySelector('svg'), w = parseFloat(sv.getAttribute('width')), h = parseFloat(sv.getAttribute('height'));
    st.textContent = '@media print { @page { size: ' + w + 'mm ' + h + 'mm; margin: 0; } #printarea { width: ' + w + 'mm; height: ' + h + 'mm; overflow: hidden; } #printarea svg { width: ' + w + 'mm; height: ' + h + 'mm; } }';
    document.head.appendChild(st);
    return { w: w, h: h, box: box };
  }
  function printDoc() {
    var pp = preparePrint();
    msg('인쇄 창을 엽니다. 종이 크기는 ' + G.fmt(pp.w, 0) + '×' + G.fmt(pp.h, 0) + 'mm (흑백)' + (pp.box ? '' : ' — 도곽이 없어 전체 범위입니다') + '. 인쇄 설정에서 "실제 크기(100%)"를 고르세요.');
    setTimeout(function () { g.print(); }, 50);
  }
  // PDF 저장 (데스크톱): 인쇄와 같은 그림을 종이 크기 그대로 PDF로
  function exportPDF() {
    if (!Desk) { printDoc(); return; }
    var pp = preparePrint();
    Desk.pdf({ name: baseName() + '.pdf' }).then(function (r) {
      if (!r) { msg('저장을 취소했습니다.'); return; }
      msg('PDF로 저장했습니다 (' + G.fmt(pp.w, 0) + '×' + G.fmt(pp.h, 0) + 'mm, 흑백, 실제 축척' + (pp.box ? '' : ', 도곽이 없어 전체 범위') + '): ' + r.path, 'ok');
    }, saveFailed('PDF'));
  }

  // ---------- 새 도면 ----------
  var tplSel = 'remodel';
  function openNew() {
    var grid = $('#tpl-grid');
    grid.textContent = '';
    Lib.TEMPLATES.forEach(function (t) {
      var b = document.createElement('button'); b.className = 'tpl' + (t.id === tplSel ? ' on' : '');
      var bb = document.createElement('b'); bb.textContent = t.name; b.appendChild(bb);
      var sp = document.createElement('span'); sp.textContent = (t.sheet ? t.sheet + ' · ' : '') + '1:' + t.scale + (t.note ? ' · ' + t.note : ''); b.appendChild(sp);
      b.onclick = function () { tplSel = t.id; fillNew(t); $$('.tpl').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); };
      grid.appendChild(b);
    });
    fillNew(Lib.TEMPLATES.filter(function (t) { return t.id === tplSel; })[0]);
    $('#dlg-new').showModal();
  }
  function fillNew(t) {
    $('#new-title').value = t.name;
    $('#new-sheet').value = t.sheet;
    $('#new-scale').value = t.scale;
    var ls = t.layers ? Lib.LAYERSETS[t.layers].map(function (l) { return l[0]; }).join(', ') : '0 도면층만';
    $('#tpl-note').textContent = '도면층: ' + ls;
  }
  function createNew() {
    var k = parseFloat($('#new-scale').value);
    var d = Lib.newFromTemplate(tplSel, {
      scale: k > 0 ? k : undefined, sheet: $('#new-sheet').value, title: $('#new-title').value,
      date: new Date().toISOString().slice(0, 10), company: $('#new-company').value
    });
    d.name = $('#new-title').value || d.name;
    if (!okToReplace()) return;
    if (Desk) { App.undo.length = 0; App.redo.length = 0; } else if (App.doc && App.doc.ents.length) pushUndo();
    App.file = null;
    setDoc(d);
    App.dirty = false; updateTitle(); scheduleAutosave();
    $('#dlg-new').close();
    msg('새 도면: ' + d.name + ' (1:' + G.fmt(d.settings.scale, 3) + (d.settings.sheet ? ', ' + d.settings.sheet : '') + '). 도움말은 F1.', 'ok');
    renderLib();
  }

  // ---------- 도움말 ----------
  function openHelp() {
    var body = $('#help-body');
    if (!body.childNodes.length) {
      var groups = [
        ['그리기', ['LINE', 'PLINE', 'RECT', 'CIRCLE', 'ARC', 'ELLIPSE', 'WALL', 'TEXT', 'HATCH', 'INSERT', 'BLOCK', 'SHEET']],
        ['치수', ['DIMLIN', 'DIMALI', 'DIMRAD', 'DIMDIA', 'DIMANG', 'EDITTEXT']],
        ['수정', ['MOVE', 'COPY', 'ROTATE', 'MIRROR', 'SCALE', 'STRETCH', 'OFFSET', 'TRIM', 'EXTEND', 'BREAK', 'FILLET', 'CHAMFER', 'ARRAY', 'ARRAYPOLAR', 'JOIN', 'EXPLODE', 'ERASE']],
        ['재기·보기', ['DIST', 'AREA', 'QTO', 'ZOOMEXT']]
      ];
      var html = '<div class="help-cols">';
      groups.forEach(function (gr) {
        html += '<table><tr><td colspan="2"><b>' + gr[0] + '</b></td></tr>';
        gr[1].forEach(function (k) { var d = Cmd.defs[k]; html += '<tr><td>' + d.label + '</td><td>' + d.aliases.map(function (a) { return '<kbd>' + a + '</kbd>'; }).join(' ') + '</td></tr>'; });
        html += '</table>';
      });
      html += '</div>';
      html += '<p><b>입력</b> 명령줄에 명령 이름(한글·영문 약자)을 치고 Enter 또는 스페이스. 빈 Enter·오른쪽 클릭 = 끝내기 / 직전 명령 다시. Esc = 취소.</p>';
      html += '<p><b>좌표</b> <kbd>1200,800</kbd> 절대 · <kbd>@3000,0</kbd> 앞 점에서 상대 · <kbd>@1500&lt;45</kbd> 거리와 각도 · 숫자만 치면 커서 방향으로 그 거리 (직교 F8과 같이 쓰면 편함). 식도 됩니다: <kbd>3000/2</kbd>, <kbd>900+200</kbd>.</p>';
      html += '<p><b>선택</b> 클릭으로 하나씩 더하기 · Shift+클릭 빼기 · 왼쪽→오른쪽 끌기 = 창 안에 다 든 것 · 오른쪽→왼쪽 끌기 = 걸친 것까지 · Ctrl+A 전체 · Delete 지우기. 선택한 객체의 파란 네모(그립)를 클릭하면 그 점을 옮깁니다.</p>';
      html += '<p><b>보기</b> 휠 = 확대·축소 · 휠 누르고 끌기(또는 스페이스+끌기) = 이동 · 휠 두 번 클릭 = 전체 보기.</p>';
      html += '<p><b>단축키</b> <kbd>F3</kbd> 객체스냅 · <kbd>F7</kbd> 격자 · <kbd>F8</kbd> 직교 · <kbd>F9</kbd> 격자스냅 · <kbd>Ctrl+Z/Y</kbd> 되돌리기/다시 · <kbd>Ctrl+S</kbd> DXF 저장 · <kbd>Ctrl+O</kbd> 열기 · <kbd>Ctrl+C/V</kbd> 복사·붙여넣기(다른 도면에도). 객체스냅 버튼을 오른쪽 클릭하면 끝점·중간점·교차점 등을 고릅니다.</p>';
      html += '<p><b>파일</b> DXF(R12)는 오토캐드 등 대부분의 CAD에서 열립니다. 치수·타원·여러 줄 문자는 선·문자로 풀어서 저장하므로, 계속 고칠 원본은 <b>작업 파일 저장</b>(.dcad.json)으로 함께 보관하세요. 브라우저에도 자동 저장되지만 지워질 수 있습니다.</p>';
      html += '<p><b>넓이</b> AA 명령은 m²와 평(1평 = 3.305785 m²)으로 알려 줍니다.</p>';
      body.innerHTML = html;
    }
    $('#dlg-help').showModal();
  }

  // ---------- 시작 ----------
  function init() {
    cv = $('#cv');
    App.R = new NS.Renderer(cv);
    var prefs = null;
    try { prefs = JSON.parse(lsGet(PREFS) || 'null'); } catch (e) { prefs = null; }
    if (prefs) {
      if (prefs.tog) Object.assign(App.tog, prefs.tog);
      if (prefs.osnap) Object.assign(App.osnapKinds, prefs.osnap);
      if (prefs.dark === false) App.R.dark = false;
    }
    document.body.classList.toggle('light', !App.R.dark);
    $('[data-act=theme]').textContent = App.R.dark ? '밝게' : '어둡게';
    App.R.showLw = !!App.tog.lw;
    App.R.resize();
    g.addEventListener('resize', function () { App.R.resize(); redraw(); });
    if (g.ResizeObserver) new ResizeObserver(function () { App.R.resize(); redraw(); }).observe($('#stage'));

    cv.addEventListener('mousemove', onMove);
    cv.addEventListener('mousedown', onDown);
    g.addEventListener('mouseup', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('mouseleave', function () { App.cursor = null; App.snap = null; App.hover = null; redraw(); });
    cv.addEventListener('contextmenu', function (ev) { ev.preventDefault(); enterKey(); });
    cv.addEventListener('auxclick', function (ev) { if (ev.button === 1) ev.preventDefault(); });
    cv.addEventListener('dblclick', function (ev) {
      if (Engine.cur) return;
      var w = App.R.toWorld(screenPt(ev)), e = pickEnt(w);
      if (e && (e.type === 'text' || e.type === 'mtext' || e.type === 'dim')) { App.sel.clear(); Engine.start('EDITTEXT', { e: e, p: w }); }
    });
    var lastMid = 0;
    cv.addEventListener('mousedown', function (ev) { if (ev.button === 1) { var t = Date.now(); if (t - lastMid < 350) zoomExtents(); lastMid = t; } });
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', function (ev) { if (ev.key === ' ') App.spaceDown = false; });
    $('#cmd').addEventListener('keydown', onCmdKey);

    $$('#tools button[data-cmd]').forEach(function (b) { b.addEventListener('click', function () { Engine.start(b.dataset.cmd); cv.focus(); }); });
    $$('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        switch (b.dataset.act) {
          case 'new': openNew(); break;
          case 'open': openAsk(); break;
          case 'save': saveDXF(); break;
          case 'savework': saveWork(); break;
          case 'png': exportPNG(); break;
          case 'svg': exportSVG(); break;
          case 'print': printDoc(); break;
          case 'pdf': exportPDF(); break;
          case 'undo': doUndo(); break;
          case 'redo': doRedo(); break;
          case 'zoomext': zoomExtents(); break;
          case 'help': openHelp(); break;
          case 'symbols': showTab('lib'); break;
          case 'theme':
            App.R.dark = !App.R.dark; document.body.classList.toggle('light', !App.R.dark);
            b.textContent = App.R.dark ? '밝게' : '어둡게'; savePrefs(); renderLayers(); renderLib(); redraw(); break;
        }
      });
    });
    $$('#status button[data-tog]').forEach(function (b) {
      b.addEventListener('click', function () { toggle(b.dataset.tog); });
      if (b.dataset.tog === 'osnap') b.addEventListener('contextmenu', function (ev) { ev.preventDefault(); osnapPop(ev); });
    });
    syncToggles();
    $$('#side .tabs button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });
    $$('dialog [data-close]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
    $('#new-ok').addEventListener('click', createNew);
    $('#qto-csv').addEventListener('click', function () {
      if (!App.qto) return;
      exportFile(baseName() + '-물량.csv', Cmd.quantitiesCSV(App.qto.q, (App.doc.name || '도면') + ' 물량 (' + App.qto.scope + ')'), 'text/csv', 'csv', '물량표를 CSV로 저장했습니다 (엑셀에서 열림)');
    });
    $('#file').addEventListener('change', function () { var f = this.files[0]; if (f) openFile(f); this.value = ''; });
    // 끌어다 놓기
    var stage = $('#stage');
    stage.addEventListener('dragover', function (ev) { ev.preventDefault(); $('#drop').classList.add('show'); });
    stage.addEventListener('dragleave', function () { $('#drop').classList.remove('show'); });
    stage.addEventListener('drop', function (ev) { ev.preventDefault(); $('#drop').classList.remove('show'); var f = ev.dataTransfer.files[0]; if (f) openFile(f); });
    g.addEventListener('beforeunload', function () { if (App.doc) lsSet(AUTOSAVE, snapshot()); });

    // 자동 저장본이 있으면 이어서, 없으면 새 도면 고르기
    var saved = lsGet(AUTOSAVE), restored = false;
    if (saved) {
      try { var d = JSON.parse(saved); if (d && d.format === 'daedong-cad') { setDoc(d); restored = true; msg('지난 작업을 이어서 엽니다: ' + (d.name || '도면') + '. 새로 시작하려면 [새 도면].', 'ok'); } } catch (e) { restored = false; }
    }
    if (!restored) {
      setDoc(Lib.newFromTemplate('remodel', { date: new Date().toISOString().slice(0, 10) }));
      msg('대동 CAD를 시작합니다. 양식을 고르세요 (나중에 [새 도면]으로 바꿀 수 있습니다).');
      openNew();
    }
    renderLib();
    showPrompt();
    redraw();
    if (Desk) initDesktop();
  }
  // 데스크톱 앱: PDF 버튼, 두 번 클릭한 파일 열기, 닫을 때 저장
  function initDesktop() {
    document.body.classList.add('desktop');
    $$('[data-desktop]').forEach(function (b) { b.hidden = false; });
    Desk.onOpenPath(function (p) { openPath(p); });
    Desk.onSaveAndClose(function () { saveCurrent().then(function (ok) { if (ok) Desk.closeNow(); }); });
    Desk.initialFile().then(function (f) {
      if (!f) return;
      if ($('#dlg-new').open) $('#dlg-new').close();
      openData(f.name, f.data, f.path);
    }, function (err) { msg('열기 실패: ' + (err && err.message || err), 'err'); });
  }
  function showTab(name) {
    tabNow = name;
    $$('#side .tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    $$('#side .pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + name); });
    if (name === 'lib') renderLib();
    if (name === 'props') refreshProps();
  }
  function osnapPop(ev) {
    closePops();
    var pop = document.createElement('div'); pop.className = 'pop osnap-list';
    var names = { end: '끝점', mid: '중간점', cen: '중심', qua: '사분점', int: '교차점', ins: '삽입점', per: '수직점', nea: '근처점' };
    Object.keys(names).forEach(function (k) {
      var l = document.createElement('label'), c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!App.osnapKinds[k];
      c.onchange = function () { App.osnapKinds[k] = c.checked; savePrefs(); };
      l.appendChild(c); l.appendChild(document.createTextNode(' ' + names[k])); pop.appendChild(l);
    });
    document.body.appendChild(pop);
    pop.style.left = Math.min(ev.clientX, g.innerWidth - 160) + 'px'; pop.style.top = Math.max(4, ev.clientY - 220) + 'px';
    setTimeout(function () { document.addEventListener('mousedown', function off(e2) { if (!pop.contains(e2.target)) { closePops(); document.removeEventListener('mousedown', off); } }); }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
