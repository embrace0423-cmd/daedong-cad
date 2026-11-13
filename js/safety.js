(function (g) {
  'use strict';
  // Includes embedded images. Rejection preserves the existing document and source file.
  const MAX_WORK_BYTES = 64 * 1024 * 1024;
  function fail(message) { throw new Error('작업 파일 오류: ' + message); }
  function validateWorkSize(size) {
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_WORK_BYTES) fail('파일 크기가 64 MiB 한도를 넘거나 올바르지 않습니다.');
    return size;
  }
  function utf8LengthUpTo(text, limit) {
    if (typeof text !== 'string' || !Number.isSafeInteger(limit) || limit < 0) fail('작업 데이터 크기를 확인할 수 없습니다.');
    let bytes=0;
    for (let i=0;i<text.length;i++) {
      const c=text.charCodeAt(i);
      if (c<0x80) bytes++;
      else if (c<0x800) bytes+=2;
      else if (c>=0xd800 && c<=0xdbff && i+1<text.length && text.charCodeAt(i+1)>=0xdc00 && text.charCodeAt(i+1)<=0xdfff) { bytes+=4;i++; }
      else bytes+=3;
      if (bytes>limit) return bytes;
    }
    return bytes;
  }
  function validateWorkTextSize(text) { return validateWorkSize(utf8LengthUpTo(text,MAX_WORK_BYTES)); }
  function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function point(p,label) {
    if (!object(p) || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) fail(label + ' 좌표가 올바르지 않습니다.');
  }
  function validateWork(doc) {
    if (!object(doc) || doc.format !== 'daedong-cad') fail('대동 CAD 작업 파일 형식이 아닙니다.');
    if (doc.version !== undefined && doc.version !== 1) fail('지원하지 않는 작업 파일 버전입니다.');
    if (!Array.isArray(doc.ents) || !Array.isArray(doc.layers) || !object(doc.blocks) || !object(doc.ltypes) || !object(doc.settings)) fail('필수 도면 목록 또는 설정이 없습니다.');
    if (!Number.isSafeInteger(doc.nextId) || doc.nextId < 1) fail('다음 개체 번호가 올바르지 않습니다.');
    // Traverse all parsed numbers, including styles and nested geometry.
    const stack=[doc]; let visited=0;
    while (stack.length) {
      const v=stack.pop();
      if (++visited > 2000000) fail('작업 파일 구조가 너무 큽니다.');
      if (typeof v === 'number' && !Number.isFinite(v)) fail('유한하지 않은 숫자가 있습니다.');
      if (v && typeof v === 'object') for (const x of Object.values(v)) stack.push(x);
    }
    const layerNames=new Set();
    for (const layer of doc.layers) {
      if (!object(layer) || typeof layer.name !== 'string' || !layer.name || layerNames.has(layer.name)) fail('도면층 이름이 비어 있거나 중복됩니다.');
      layerNames.add(layer.name);
    }
    if (!layerNames.has('0') || !layerNames.has(doc.currentLayer)) fail('기본 또는 현재 도면층이 없습니다.');
    if (doc.images !== undefined && !object(doc.images)) fail('이미지 목록이 올바르지 않습니다.');
    if (doc.images) for (const data of Object.values(doc.images)) {
      if (typeof data !== 'string' || !/^data:image\/(?:png|jpe?g|gif|bmp|webp);base64,[a-z0-9+/=\r\n]+$/i.test(data)) fail('이미지 데이터가 올바르지 않습니다.');
    }
    const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
    const supported=new Set(['line','circle','arc','poly','ellipse','point','text','mtext','image','dim','hatch','insert']);
    const ids=new Set(); let maxId=0;
    function entity(e) {
      if (!object(e) || !supported.has(e.type) || !Number.isSafeInteger(e.id) || e.id < 1 || ids.has(e.id)) fail('개체 종류 또는 번호가 잘못됐거나 중복됩니다.');
      ids.add(e.id);maxId=Math.max(maxId,e.id);
      if (e.layer !== undefined && !layerNames.has(e.layer)) fail('존재하지 않는 도면층을 참조합니다.');
      switch (e.type) {
        case 'line': point(e.a,'선 시작');point(e.b,'선 끝');break;
        case 'circle': case 'arc':
          point(e.c,'중심'); if (typeof e.r !== 'number' || e.r <= 0) fail('반지름이 올바르지 않습니다.');
          if (e.type==='arc' && (typeof e.a0!=='number' || typeof e.a1!=='number')) fail('호 각도가 없습니다.');break;
        case 'poly':
          if (!Array.isArray(e.pts) || !e.pts.length) fail('폴리선 점 목록이 없습니다.');
          e.pts.forEach(p=>point(p,'폴리선'));break;
        case 'ellipse': point(e.c,'타원 중심');point(e.major,'타원 축');if (typeof e.ratio!=='number' || e.ratio<=0) fail('타원 비율이 올바르지 않습니다.');break;
        case 'point': case 'text': case 'mtext': point(e.p,'삽입점');break;
        case 'image':
          point(e.p,'이미지');point(e.u,'이미지 축');point(e.v,'이미지 축');
          if (typeof e.ref!=='string' || !e.ref || !doc.images || !has(doc.images,e.ref)) fail('이미지 원본이 누락됐습니다.');break;
        case 'dim':
          if (e.kind==='lin') {point(e.p1,'치수');point(e.p2,'치수');point(e.loc,'치수 위치');}
          else if (e.kind==='ang') {point(e.c,'치수 중심');point(e.p1,'치수');point(e.p2,'치수');point(e.loc,'치수 위치');}
          else {point(e.c,'치수 중심');point(e.p,'치수');} break;
        case 'hatch':
          if (!Array.isArray(e.loops)) fail('해치 경계가 없습니다.');
          e.loops.forEach(loop=>{if (!Array.isArray(loop)) fail('해치 경계가 올바르지 않습니다.');loop.forEach(p=>point(p,'해치'));});break;
        case 'insert':
          point(e.p,'블록 삽입');if (typeof e.name!=='string' || !has(doc.blocks,e.name)) fail('존재하지 않는 블록을 참조합니다.');break;
      }
    }
    doc.ents.forEach(entity);
    for (const [name,block] of Object.entries(doc.blocks)) {
      if (!name || !object(block) || !Array.isArray(block.ents)) fail('블록 정의가 올바르지 않습니다.');
      point(block.base,'블록 기준');block.ents.forEach(entity);
    }
    if (doc.nextId <= maxId) fail('다음 개체 번호가 기존 번호와 겹칩니다.');
    const visiting=new Set(), visitedBlocks=new Set();
    function visit(name) {
      if (visiting.has(name)) fail('블록 참조가 순환합니다.');
      if (visitedBlocks.has(name)) return;
      visiting.add(name);
      for (const e of doc.blocks[name].ents) if (e.type==='insert') visit(e.name);
      visiting.delete(name);visitedBlocks.add(name);
    }
    Object.keys(doc.blocks).forEach(visit);
    return doc;
  }
  function convertDxfUnits(doc, unit, report, Model, G) {
    if (unit !== 'mm' && unit !== 'inch') fail('도면 단위를 선택해야 합니다.');
    if (unit === 'inch') {
      const factor=25.4, matrix=G.M.scale(factor,factor);
      function scaleEntity(e) {
        if (e.type === 'insert') { e.p.x *= factor; e.p.y *= factor; }
        else Model.transform(e,matrix);
      }
      doc.ents.forEach(scaleEntity);
      for (const block of Object.values(doc.blocks)) {
        block.base.x *= factor;block.base.y *= factor;block.ents.forEach(scaleEntity);
      }
      for (const name of report.importedLtypes || []) {
        if (doc.ltypes[name] && Array.isArray(doc.ltypes[name].pat))
          doc.ltypes[name].pat=doc.ltypes[name].pat.map(x=>x*factor);
      }
      if (report.textSizeExplicit) doc.settings.textH *= factor;
      Model.touch();
    }
    report.inputUnit=unit;report.outputUnit='mm';
    return doc;
  }
  function dxfLosses(doc) {
    const fields=['imagesOmitted','dimensionsConverted','ellipsesConverted','multilineTextConverted','hatchesConverted','missingBlocks','unsupportedEntities'];
    const empty=()=>Object.fromEntries(fields.map(k=>[k,0]));
    const memo=new Map(), active=new Set();
    const handled=new Set(['line','circle','arc','poly','point','text']);
    function add(to,from) {
      for (const k of fields) {
        to[k]+=from[k];
        if (!Number.isSafeInteger(to[k])) fail('중첩 블록의 변환 건수가 너무 커 안전하게 계산할 수 없습니다.');
      }
    }
    function block(name) {
      if (!Object.prototype.hasOwnProperty.call(doc.blocks || {},name)) { const x=empty();x.missingBlocks=1;return x; }
      if (active.has(name)) fail('블록 참조가 순환하여 내보낼 수 없습니다.');
      if (memo.has(name)) return memo.get(name);
      active.add(name); const result=count(doc.blocks[name].ents);active.delete(name);memo.set(name,result);return result;
    }
    function count(entities) {
      if (!Array.isArray(entities)) fail('블록 개체 목록이 올바르지 않습니다.');
      const result=empty();
      for (const e of entities) {
        if (!e || typeof e.type!=='string') {result.unsupportedEntities++;continue;}
        if (e.type==='image') result.imagesOmitted++;
        else if (e.type==='dim') result.dimensionsConverted++;
        else if (e.type==='ellipse') result.ellipsesConverted++;
        else if (e.type==='mtext') result.multilineTextConverted++;
        else if (e.type==='hatch') result.hatchesConverted++;
        else if (e.type==='insert') add(result,block(e.name));
        else if (!handled.has(e.type)) result.unsupportedEntities++;
      }
      return result;
    }
    return count(doc.ents);
  }
  const api={MAX_WORK_BYTES,validateWorkSize,utf8LengthUpTo,validateWorkTextSize,validateWork,convertDxfUnits,dxfLosses};
  if (typeof module === 'object' && module.exports) module.exports=api;
  else { g.DCAD=g.DCAD||{};g.DCAD.Safety=api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
