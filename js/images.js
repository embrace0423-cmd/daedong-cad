// 밑그림 이미지 보관소. 도면의 image 개체에는 이름표(ref)만 두고 그림 데이터는 여기 한 벌만 둔다
// (되돌리기 기록이 그림 크기만큼 불어나지 않도록). 작업 파일·자동 저장·복사할 때만 쓰인 그림을 images로 함께 담는다.
(function (g) {
  'use strict';
  var NS = g.DCAD = g.DCAD || {};
  var map = new Map(); // ref → { src: dataURL, el: 불러온 Image 또는 null }
  var onload = null;

  function hash(s, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function add(ref, src) {
    var o = { src: src, el: null };
    map.set(ref, o);
    if (typeof g.Image === 'function') {
      var im = new g.Image();
      im.onload = function () { o.el = im; if (onload) onload(ref); };
      im.src = src;
    }
    return ref;
  }
  // 그림 데이터를 넣고 이름표를 받는다. 같은 그림은 한 번만 들어간다.
  function put(src) {
    var ref = 'img_' + hash(src, 2166136261) + hash(src, 374761393) + '_' + src.length.toString(36);
    return map.has(ref) ? ref : add(ref, src);
  }
  function el(ref) { var o = map.get(ref); return o ? o.el : null; }
  function src(ref) { var o = map.get(ref); return o ? o.src : null; }

  function eachRef(doc, ents, fn) {
    var seenBlk = new Set();
    function walk(list) {
      list.forEach(function (e) {
        if (e.type === 'image' && e.ref) fn(e.ref);
        else if (e.type === 'insert' && doc && doc.blocks && doc.blocks[e.name] && !seenBlk.has(e.name)) {
          seenBlk.add(e.name);
          walk(doc.blocks[e.name].ents);
        }
      });
    }
    walk(ents || (doc ? doc.ents : []));
  }
  // 개체들이 쓰는 그림만 { ref: dataURL }로 (없으면 null)
  function pack(doc, ents) {
    var out = {}, n = 0;
    eachRef(doc, ents, function (r) { var s = src(r); if (s && !out[r]) { out[r] = s; n++; } });
    return n ? out : null;
  }
  // 저장본·복사본에 담긴 그림을 보관소에 넣고 그 칸은 지운다
  function unpack(obj) {
    if (obj && obj.images) {
      Object.keys(obj.images).forEach(function (r) { if (!map.has(r)) add(r, obj.images[r]); });
      delete obj.images;
    }
    return obj;
  }
  // 작업 파일·자동 저장용 JSON (쓰인 그림을 함께 담음)
  function serialize(doc) {
    var imgs = pack(doc);
    if (!imgs) return JSON.stringify(doc);
    var o = Object.assign({}, doc);
    o.images = imgs;
    return JSON.stringify(o);
  }

  NS.Images = {
    put: put, el: el, src: src, has: function (r) { return map.has(r); },
    pack: pack, unpack: unpack, serialize: serialize,
    onLoad: function (fn) { onload = fn; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
