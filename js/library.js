// 도면 양식(6종)과 기호 라이브러리. 기호는 실제 크기(mm)로 그린 블록이다.
// 주석 기호(방위표 등)는 도면 축척을 곱해 넣는다.
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var G = NS.G, Model = NS.Model;

  // ---- 블록을 그리는 짧은 도구 ----
  function L(x1, y1, x2, y2) { return { type: 'line', layer: '0', color: 256, ltype: 'BYLAYER', a: G.v(x1, y1), b: G.v(x2, y2) }; }
  function R(x, y, w, h) { return PL([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true); }
  function C(x, y, r) { return { type: 'circle', layer: '0', color: 256, ltype: 'BYLAYER', c: G.v(x, y), r: r }; }
  function A(x, y, r, d0, d1) { return { type: 'arc', layer: '0', color: 256, ltype: 'BYLAYER', c: G.v(x, y), r: r, a0: G.rad(d0), a1: G.rad(d1) }; }
  function PL(pts, closed) {
    return { type: 'poly', layer: '0', color: 256, ltype: 'BYLAYER', closed: !!closed, pts: pts.map(function (p) { var o = { x: p[0], y: p[1] }; if (p[2]) o.bulge = p[2]; return o; }) };
  }
  function T(x, y, h, s, align) { return { type: 'text', layer: '0', color: 256, ltype: 'BYLAYER', p: G.v(x, y), h: h, s: s, rot: 0, align: align || 'C', valign: 'M' }; }
  // 둥근 모서리 사각형 (반지름 r) - 볼록값 tan(22.5°)
  function RR(x, y, w, h, r) {
    var b = Math.tan(Math.PI / 8);
    return PL([[x + r, y], [x + w - r, y, b], [x + w, y + r], [x + w, y + h - r, b], [x + w - r, y + h], [x + r, y + h, b], [x, y + h - r], [x, y + r, b]], true);
  }
  // 구름 모양 (관목·생울타리)
  function cloud(cx, cy, r, n) {
    var pts = [];
    for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 0.6]); }
    return PL(pts, true);
  }
  function hexagon(cx, cy, s) { // s: 맞변 거리
    var R0 = s / Math.sqrt(3), pts = [];
    for (var i = 0; i < 6; i++) { var a = i * Math.PI / 3; pts.push([cx + R0 * Math.cos(a), cy + R0 * Math.sin(a)]); }
    return PL(pts, true);
  }
  function chair(x, y, rot) { // 450×450 의자, (x,y)는 가운데
    var ents = [RR(-225, -225, 450, 450, 40), L(-225, 160, 225, 160)];
    return ents.map(function (e) { var c = Model.clone(e); Model.transform(c, G.M.mul(G.M.move(x, y), G.M.rot(G.rad(rot || 0)))); return c; });
  }

  // ---- 기호 정의 ----
  // cat: 분류, name: 블록 이름(영문, DXF 호환), label: 한글 이름, size: 설명, annot: 주석 기호(축척 곱함)
  var SYMBOLS = [
    // 문·창 (벽 두께 200 기준, 기준점은 문틀 왼쪽 아래)
    { cat: '문·창', name: 'DOOR_900', label: '여닫이문 900', size: '900', ents: function () { return [L(0, 0, 0, 900), A(0, 0, 900, 0, 90), L(0, 0, 900, 0)]; } },
    { cat: '문·창', name: 'DOOR_800', label: '여닫이문 800 (욕실)', size: '800', ents: function () { return [L(0, 0, 0, 800), A(0, 0, 800, 0, 90), L(0, 0, 800, 0)]; } },
    { cat: '문·창', name: 'DOOR_DOUBLE_1600', label: '양개문 1600', size: '1600', ents: function () { return [L(0, 0, 0, 800), A(0, 0, 800, 0, 90), L(1600, 0, 1600, 800), A(1600, 0, 800, 90, 180), L(0, 0, 1600, 0)]; } },
    { cat: '문·창', name: 'DOOR_SLIDING_1800', label: '미닫이문 1800', size: '1800×200', ents: function () { return [R(0, 60, 950, 40), R(850, 100, 950, 40), L(0, 0, 0, 200), L(1800, 0, 1800, 200)]; } },
    { cat: '문·창', name: 'WINDOW_1200', label: '창 1200', size: '1200×200', ents: function () { return [R(0, 0, 1200, 200), L(0, 90, 1200, 90), L(0, 110, 1200, 110)]; } },
    { cat: '문·창', name: 'WINDOW_1800', label: '창 1800', size: '1800×200', ents: function () { return [R(0, 0, 1800, 200), L(0, 90, 1800, 90), L(0, 110, 1800, 110), L(900, 90, 900, 110)]; } },
    { cat: '문·창', name: 'WINDOW_2400', label: '창 2400 (거실)', size: '2400×200', ents: function () { return [R(0, 0, 2400, 200), L(0, 90, 2400, 90), L(0, 110, 2400, 110), L(1200, 60, 1200, 140)]; } },
    { cat: '문·창', name: 'NORTH', label: '방위표', size: '도면 15mm', annot: true, ents: function () { return [C(0, 0, 7.5), PL([[0, 7.5], [-3, -5], [0, -2.5], [3, -5]], true), T(0, 11, 4, 'N')]; } },

    // 가구 (기준점은 왼쪽 아래)
    { cat: '가구', name: 'BED_SINGLE', label: '침대 싱글', size: '1000×2000', ents: function () { return [R(0, 0, 1000, 2000), RR(100, 1600, 800, 300, 60), L(0, 1500, 1000, 1500)]; } },
    { cat: '가구', name: 'BED_QUEEN', label: '침대 퀸', size: '1500×2000', ents: function () { return [R(0, 0, 1500, 2000), RR(100, 1600, 600, 300, 60), RR(800, 1600, 600, 300, 60), L(0, 1500, 1500, 1500)]; } },
    { cat: '가구', name: 'BED_KING', label: '침대 킹', size: '1600×2000', ents: function () { return [R(0, 0, 1600, 2000), RR(100, 1600, 650, 300, 60), RR(850, 1600, 650, 300, 60), L(0, 1500, 1600, 1500)]; } },
    { cat: '가구', name: 'SOFA_3', label: '소파 3인', size: '2100×900', ents: function () { return [RR(0, 0, 2100, 900, 60), L(0, 700, 2100, 700), L(200, 0, 200, 700), L(1900, 0, 1900, 700), L(766, 0, 766, 700), L(1333, 0, 1333, 700)]; } },
    { cat: '가구', name: 'SOFA_1', label: '소파 1인', size: '900×900', ents: function () { return [RR(0, 0, 900, 900, 60), L(0, 700, 900, 700), L(150, 0, 150, 700), L(750, 0, 750, 700)]; } },
    { cat: '가구', name: 'TABLE_4', label: '식탁 4인', size: '1400×800', ents: function () { return [R(150, 400, 1400, 800)].concat(chair(500, 175, 0), chair(1200, 175, 0), chair(500, 1425, 180), chair(1200, 1425, 180)); } },
    { cat: '가구', name: 'TABLE_6', label: '식탁 6인', size: '1800×900', ents: function () { return [R(150, 400, 1800, 900)].concat(chair(450, 175, 0), chair(1050, 175, 0), chair(1650, 175, 0), chair(450, 1525, 180), chair(1050, 1525, 180), chair(1650, 1525, 180)); } },
    { cat: '가구', name: 'DESK', label: '책상+의자', size: '1200×600', ents: function () { return [R(0, 250, 1200, 600)].concat(chair(600, 25, 0)); } },
    { cat: '가구', name: 'WARDROBE', label: '붙박이장 1200', size: '1200×600', ents: function () { return [R(0, 0, 1200, 600), L(0, 50, 1200, 50), L(600, 50, 600, 600)]; } },
    { cat: '가구', name: 'TV_STAND', label: 'TV장', size: '1800×450', ents: function () { return [R(0, 0, 1800, 450), R(300, 380, 1200, 50)]; } },
    { cat: '가구', name: 'FRIDGE', label: '냉장고', size: '900×750', ents: function () { return [R(0, 0, 900, 750), L(450, 0, 450, 750), L(0, 0, 450, 750), L(450, 750, 900, 0)]; } },
    { cat: '가구', name: 'SINK_2400', label: '싱크대 2400', size: '2400×600', ents: function () { return [R(0, 0, 2400, 600), RR(300, 80, 800, 440, 50), C(1600, 200, 120), C(1600, 420, 90), C(1950, 200, 90), C(1950, 420, 120), L(1400, 0, 1400, 600)]; } },
    { cat: '가구', name: 'TOILET', label: '양변기', size: '400×700', ents: function () {
      var bowl = Model.mk(null, 'ellipse', { c: G.v(200, 380), major: G.v(0, 200), ratio: 0.85 }); bowl.layer = '0';
      return [R(0, 0, 400, 180), bowl];
    } },
    { cat: '가구', name: 'BASIN', label: '세면대', size: '500×400', ents: function () {
      var b = Model.mk(null, 'ellipse', { c: G.v(250, 220), major: G.v(170, 0), ratio: 0.7 }); b.layer = '0';
      return [R(0, 0, 500, 400), b, C(250, 360, 15)];
    } },
    { cat: '가구', name: 'BATHTUB', label: '욕조', size: '1500×750', ents: function () { return [R(0, 0, 1500, 750), RR(80, 80, 1340, 590, 200), C(1300, 375, 30)]; } },
    { cat: '가구', name: 'SHOWER', label: '샤워부스', size: '900×900', ents: function () { return [R(0, 0, 900, 900), L(0, 0, 900, 900), L(0, 900, 900, 0), C(450, 450, 40)]; } },
    { cat: '가구', name: 'WASHER', label: '세탁기', size: '600×600', ents: function () { return [R(0, 0, 600, 600), C(300, 280, 200), R(50, 520, 500, 50)]; } },

    // 조경 (기준점은 가운데)
    { cat: '조경', name: 'TREE_L', label: '교목 Ø3000', size: 'Ø3000', ents: function () {
      var e = [C(0, 0, 1500), C(0, 0, 100)];
      for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; e.push(L(130 * Math.cos(a), 130 * Math.sin(a), 1100 * Math.cos(a), 1100 * Math.sin(a))); }
      return e;
    } },
    { cat: '조경', name: 'TREE_M', label: '교목 Ø2000', size: 'Ø2000', ents: function () {
      var e = [C(0, 0, 1000), C(0, 0, 80)];
      for (var i = 0; i < 6; i++) { var a = i * Math.PI / 3; e.push(L(100 * Math.cos(a), 100 * Math.sin(a), 700 * Math.cos(a), 700 * Math.sin(a))); }
      return e;
    } },
    { cat: '조경', name: 'SHRUB', label: '관목 Ø1000', size: 'Ø1000', ents: function () { return [cloud(0, 0, 450, 9), C(0, 0, 40)]; } },
    { cat: '조경', name: 'HEDGE_3000', label: '생울타리 3000', size: '3000×600', ents: function () {
      var pts = [], n = 10, w = 3000;
      for (var i = 0; i < n; i++) pts.push([i * w / n, 0, 0.5]);
      pts.push([w, 0]); pts.push([w, 600, 0]);
      for (var j = n; j > 0; j--) pts.push([j * w / n, 600, 0.5]);
      pts.push([0, 600]);
      return [PL(pts, true)];
    } },
    { cat: '조경', name: 'STEPPING_STONE', label: '디딤돌', size: '600×400', ents: function () {
      var s = Model.mk(null, 'ellipse', { c: G.v(0, 0), major: G.v(300, 0), ratio: 0.66 }); s.layer = '0';
      return [s];
    } },
    { cat: '조경', name: 'BENCH', label: '벤치 1800', size: '1800×450', ents: function () { return [R(-900, -225, 1800, 450), L(-900, -75, 900, -75), L(-900, 75, 900, 75)]; } },
    { cat: '조경', name: 'GARDEN_LAMP', label: '정원등', size: 'Ø300', ents: function () { return [C(0, 0, 150), L(-210, 0, 210, 0), L(0, -210, 0, 210)]; } },
    { cat: '조경', name: 'PLANTER', label: '화분 Ø600', size: 'Ø600', ents: function () { return [C(0, 0, 300), C(0, 0, 250), cloud(0, 0, 150, 6)]; } },
    { cat: '조경', name: 'PARKING', label: '주차칸 2500×5000', size: '2500×5000', ents: function () { return [L(0, 0, 0, 5000), L(2500, 0, 2500, 5000), L(0, 0, 2500, 0)]; } },

    // 기계 (기준점은 중심)
    { cat: '기계', name: 'HEX_NUT_M10', label: '육각너트 M10 (맞변 17)', size: '17', ents: function () { return [hexagon(0, 0, 17), C(0, 0, 8.5), C(0, 0, 5)]; } },
    { cat: '기계', name: 'HEX_NUT_M12', label: '육각너트 M12 (맞변 19)', size: '19', ents: function () { return [hexagon(0, 0, 19), C(0, 0, 9.5), C(0, 0, 6)]; } },
    { cat: '기계', name: 'HEX_NUT_M16', label: '육각너트 M16 (맞변 24)', size: '24', ents: function () { return [hexagon(0, 0, 24), C(0, 0, 12), C(0, 0, 8)]; } },
    { cat: '기계', name: 'HOLE_10', label: '구멍 Ø10 + 중심선', size: 'Ø10', ents: function () { var c = [C(0, 0, 5), L(-8, 0, 8, 0), L(0, -8, 0, 8)]; c[1].ltype = 'CENTER'; c[2].ltype = 'CENTER'; return c; } },
    { cat: '기계', name: 'BEARING_6204', label: '베어링 6204 (정면)', size: 'Ø47/Ø20', ents: function () { return [C(0, 0, 23.5), C(0, 0, 19), C(0, 0, 13.5), C(0, 0, 10)]; } },
    { cat: '기계', name: 'ROUGHNESS', label: '표면 거칠기 기호', size: '도면 5mm', annot: true, ents: function () { return [PL([[-3, 5.2], [0, 0], [6, 10.4]], false), L(-3, 5.2, 3, 5.2)]; } },
    { cat: '기계', name: 'SECTION_MARK', label: '단면 표시 화살표', size: '도면 10mm', annot: true, ents: function () { return [L(0, 0, 0, 8), PL([[0, 0], [-1.5, 3], [1.5, 3]], true), T(0, 11, 3.5, 'A')]; } },

    // 화덕·식품기계 (기준점은 중심, 일반 부품만)
    { cat: '화덕·식품기계', name: 'GAS_BURNER_300', label: '가스버너 Ø300', size: 'Ø300', ents: function () {
      var e = [C(0, 0, 150), C(0, 0, 110), C(0, 0, 40)];
      for (var i = 0; i < 12; i++) { var a = i * Math.PI / 6; e.push(L(45 * Math.cos(a), 45 * Math.sin(a), 105 * Math.cos(a), 105 * Math.sin(a))); }
      return e;
    } },
    { cat: '화덕·식품기계', name: 'GRILL_GRATE_600', label: '석쇠 600×400', size: '600×400', ents: function () {
      var e = [R(-300, -200, 600, 400)];
      for (var i = 1; i < 12; i++) e.push(L(-300 + i * 50, -200, -300 + i * 50, 200));
      return e;
    } },
    { cat: '화덕·식품기계', name: 'CASTER_100', label: '캐스터 Ø100 (측면)', size: 'Ø100', ents: function () { return [C(0, 0, 50), C(0, 0, 10), R(-45, 50, 90, 25), L(0, 75, 0, 110)]; } },
    { cat: '화덕·식품기계', name: 'VALVE', label: '밸브 기호', size: '도면 6mm', annot: true, ents: function () { return [PL([[-3, -2], [3, 2], [3, -2], [-3, 2]], true), L(0, 0, 0, 4), L(-1.5, 4, 1.5, 4)]; } },
    { cat: '화덕·식품기계', name: 'THERMO', label: '온도센서 기호', size: '도면 6mm', annot: true, ents: function () { return [C(0, 0, 3), T(0, 0, 2.5, 'T')]; } },
    { cat: '화덕·식품기계', name: 'EXHAUST_FAN', label: '배기팬 기호', size: '도면 8mm', annot: true, ents: function () { return [C(0, 0, 4), A(1.3, 0, 1.3, 0, 180), A(-1.3, 0, 1.3, 180, 360), L(-4, -4, 4, 4)]; } }
  ];

  function symbolByName(name) {
    for (var i = 0; i < SYMBOLS.length; i++) if (SYMBOLS[i].name === name) return SYMBOLS[i];
    return null;
  }
  // 문서에 블록 정의가 없으면 넣는다
  function ensureBlock(doc, name) {
    if (doc.blocks[name]) return doc.blocks[name];
    var s = symbolByName(name);
    if (!s) return null;
    var ents = s.ents().map(function (e) { var c = Model.clone(e); c.id = doc.nextId++; return c; });
    doc.blocks[name] = { name: name, base: G.v(0, 0), ents: ents };
    Model.touch();
    return doc.blocks[name];
  }

  // ---- 도면 양식 ----
  var LAYERSETS = {
    building: [
      ['벽체', 7], ['기존벽', 8], ['철거', 1, 'DASHED'], ['신설벽', 5], ['문창', 4], ['가구', 3], ['위생설비', 6], ['전기', 30],
      ['치수', 2], ['문자', 7], ['중심선', 1, 'CENTER'], ['표제란', 7]
    ],
    furniture: [
      ['벽체', 7], ['문창', 4], ['가구-거실', 3], ['가구-침실', 92], ['가구-주방', 40], ['가구-욕실', 140], ['가구-신규', 6],
      ['치수', 2], ['문자', 7], ['중심선', 1, 'CENTER'], ['표제란', 7]
    ],
    landscape: [
      ['대지경계', 1, 'PHANTOM'], ['건물', 7], ['포장', 8], ['잔디', 3], ['수목-교목', 94], ['수목-관목', 62], ['수경', 5],
      ['시설물', 6], ['치수', 2], ['문자', 7], ['표제란', 7]
    ],
    machine: [
      ['외형선', 7], ['숨은선', 3, 'HIDDEN'], ['중심선', 1, 'CENTER'], ['가상선', 6, 'PHANTOM'], ['단면', 8], ['치수', 4],
      ['문자', 7], ['표제란', 7]
    ],
    food: [
      ['외형선', 7], ['숨은선', 3, 'HIDDEN'], ['중심선', 1, 'CENTER'], ['단열재', 8, 'DASHED'], ['배관-가스', 1, 'DASHDOT'],
      ['배관-물·스팀', 5, 'DASHED'], ['전기', 30], ['치수', 4], ['문자', 7], ['표제란', 7]
    ]
  };

  var TEMPLATES = [
    { id: 'remodel', name: '리모델링 평면도', layers: 'building', scale: 50, sheet: 'A3', grid: 100, dec: 0, current: '벽체', note: '벽 두께 200(콘크리트)·100(경량), 철거는 파선' },
    { id: 'furniture', name: '가구 배치도', layers: 'furniture', scale: 50, sheet: 'A3', grid: 50, dec: 0, current: '가구-거실', note: '가구 기호는 실제 크기' },
    { id: 'landscape', name: '조경 배치도', layers: 'landscape', scale: 100, sheet: 'A3', grid: 500, dec: 0, current: '수목-교목', note: '수목은 수관 폭 기준' },
    { id: 'vehicle', name: '차량부품 설계도', layers: 'machine', scale: 1, sheet: 'A3', grid: 1, dec: 1, current: '외형선', note: '1:1, 치수 소수 1자리' },
    { id: 'machine', name: '건설기계 설계도', layers: 'machine', scale: 10, sheet: 'A2', grid: 10, dec: 0, current: '외형선', note: '1:10' },
    { id: 'food', name: '화덕·식품기계 설계도', layers: 'food', scale: 5, sheet: 'A3', grid: 5, dec: 0, current: '외형선', note: '가스·물·전기 배관층 구분' },
    { id: 'blank', name: '빈 도면', layers: null, scale: 1, sheet: '', grid: 10, dec: 2, current: '0', note: '' }
  ];
  var SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };

  // 축척 k (1:k)에 맞춘 문서 설정
  function applyScale(doc, k, dec) {
    var st = doc.settings;
    st.scale = k;
    st.ltscale = k;
    st.textH = 3.5 * k;
    st.dim = { textH: 2.5 * k, arrow: 2.5 * k, exo: 1 * k, exe: 1.25 * k, gap: 0.8 * k, dec: dec === undefined ? st.dim.dec : dec };
  }

  function newFromTemplate(id, opts) {
    opts = opts || {};
    var t = null;
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) t = TEMPLATES[i];
    t = t || TEMPLATES[TEMPLATES.length - 1];
    var doc = Model.newDoc();
    var k = opts.scale || t.scale;
    doc.name = t.name;
    doc.settings.type = t.id;
    doc.settings.sheet = opts.sheet !== undefined ? opts.sheet : t.sheet;
    doc.settings.grid = t.grid;
    applyScale(doc, k, t.dec);
    if (t.layers) LAYERSETS[t.layers].forEach(function (l) { Model.ensureLayer(doc, l[0], l[1], l[2] || 'CONTINUOUS'); });
    doc.currentLayer = Model.layerOf(doc, t.current) ? t.current : '0';
    if (doc.settings.sheet && opts.frame !== false) addSheet(doc, doc.settings.sheet, k, { title: opts.title || t.name, date: opts.date || '', company: opts.company || '' });
    Model.touch();
    return doc;
  }

  // 도곽(테두리)과 표제란. 종이 크기 × 축척으로 원점 기준에 그린다.
  function addSheet(doc, sheet, k, f) {
    var sz = SHEETS[sheet];
    if (!sz) return [];
    f = f || {};
    var lay = Model.layerOf(doc, '표제란') ? '표제란' : (Model.ensureLayer(doc, '표제란', 7), '표제란');
    var W = sz[0] * k, H = sz[1] * k, out = [];
    function add(type, props) { var e = Model.mk(doc, type, props); e.layer = lay; out.push(e); doc.ents.push(e); return e; }
    function rect(x, y, w, h) { return add('poly', { pts: [G.v(x, y), G.v(x + w, y), G.v(x + w, y + h), G.v(x, y + h)], closed: true }); }
    function line(x1, y1, x2, y2) { return add('line', { a: G.v(x1, y1), b: G.v(x2, y2) }); }
    function txt(x, y, h, s, al) { return add('text', { p: G.v(x, y), h: h, s: s, rot: 0, align: al || 'L', valign: 'M' }); }
    var ml = 20 * k, m = 10 * k;
    rect(0, 0, W, H).color = 8;
    rect(ml, m, W - ml - m, H - 2 * m);
    // 표제란 170 × 45 (종이 mm)
    var tw = 170 * k, th = 45 * k, x0 = W - m - tw, y0 = m, rh = 9 * k, lw = 25 * k;
    rect(x0, y0, tw, th);
    for (var r = 1; r < 5; r++) line(x0, y0 + r * rh, x0 + tw, y0 + r * rh);
    line(x0 + lw, y0, x0 + lw, y0 + th);
    line(x0 + lw + 60 * k, y0, x0 + lw + 60 * k, y0 + 3 * rh);
    line(x0 + 2 * lw + 60 * k, y0, x0 + 2 * lw + 60 * k, y0 + 3 * rh);
    var lab = 3 * k, val = 3.5 * k, cx = function (row) { return y0 + rh * row + rh / 2; };
    var rows = [['회사명', f.company || ''], ['도면명', f.title || '']];
    txt(x0 + lw / 2, cx(4), lab, rows[0][0], 'C'); txt(x0 + lw + 3 * k, cx(4), val, rows[0][1]);
    txt(x0 + lw / 2, cx(3), lab, rows[1][0], 'C'); txt(x0 + lw + 3 * k, cx(3), 5 * k, rows[1][1]);
    var c2 = x0 + lw + 60 * k, c3 = c2 + lw;
    txt(x0 + lw / 2, cx(2), lab, '도면번호', 'C'); txt(x0 + lw + 3 * k, cx(2), val, f.number || '');
    txt(c2 + lw / 2, cx(2), lab, '축척', 'C'); txt(c3 + 3 * k, cx(2), val, '1:' + G.fmt(k, 3));
    txt(x0 + lw / 2, cx(1), lab, '작성일', 'C'); txt(x0 + lw + 3 * k, cx(1), val, f.date || '');
    txt(c2 + lw / 2, cx(1), lab, '단위', 'C'); txt(c3 + 3 * k, cx(1), val, 'mm');
    txt(x0 + lw / 2, cx(0), lab, '작성', 'C'); txt(x0 + lw + 3 * k, cx(0), val, f.author || '');
    txt(c2 + lw / 2, cx(0), lab, '검토', 'C'); txt(c3 + 3 * k, cx(0), val, '');
    Model.touch();
    return out;
  }

  NS.Library = {
    SYMBOLS: SYMBOLS, TEMPLATES: TEMPLATES, SHEETS: SHEETS, LAYERSETS: LAYERSETS,
    symbolByName: symbolByName, ensureBlock: ensureBlock, newFromTemplate: newFromTemplate,
    addSheet: addSheet, applyScale: applyScale
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
