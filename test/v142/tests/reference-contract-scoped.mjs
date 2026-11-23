// Preparation-stage contracts. Default execution validates synthetic inputs and
// marks ALL product behavior tests skipped; it never imports the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const synthetic = path.join(root, 'fixtures', 'synthetic');
const handoff = path.join(root, 'fixtures', 'handoff');
const enabled = process.env.DCAD_RUN_CONTRACTS === '1';
const skip = enabled ? false : '제품 어댑터 미구현: 제품 동작 미검증';
let adapter;
if (enabled) {
  if (!process.env.DCAD_TEST_ADAPTER || !path.isAbsolute(process.env.DCAD_TEST_ADAPTER))
    throw new Error('DCAD_TEST_ADAPTER must be an absolute path to an explicit adapter.');
  const allowed = await fs.realpath(path.join(root, 'tests', 'adapters'));
  const selected = await fs.realpath(process.env.DCAD_TEST_ADAPTER);
  const relative = path.relative(allowed, selected);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error('Adapter must be inside this working copy tests/adapters directory.');
  adapter = await import(pathToFileURL(selected).href);
  assert.equal(typeof adapter.createHarness, 'function');
}
const read = (name) => fs.readFile(path.join(synthetic, name));
const doc = async (name = 'baseline.dcad.json') => JSON.parse(await read(name));
const equalState = (a, b) => assert.deepEqual(a, b, 'document/session state must not change');
const near = (a, b) => assert.ok(Math.abs(a-b) < 1e-7, `${a} != ${b}`);

async function fixture(t, name = 'baseline.dcad.json') {
  const workspace = await fs.realpath(root);
  const testDirectory = await fs.realpath(path.join(root, 'tests'));
  const testRel = path.relative(workspace, testDirectory);
  if (!testRel || testRel === '..' || testRel.startsWith('..' + path.sep) || path.isAbsolute(testRel))
    throw new Error('Test directory resolved outside the authorized working folder');
  const scratchRoot = path.join(testDirectory, '.contract-sandbox');
  await fs.mkdir(scratchRoot, { recursive: true });
  const actualRoot = await fs.realpath(scratchRoot);
  const relRoot = path.relative(workspace, actualRoot);
  if (!relRoot || relRoot === '..' || relRoot.startsWith('..' + path.sep) || path.isAbsolute(relRoot))
    throw new Error('Scratch root resolved outside the authorized working folder');
  const tmp = await fs.mkdtemp(path.join(actualRoot, 'case-'));
  let h;
  t.after(async () => {
    try { if (h) await h.close(); } finally {
      const current = await fs.realpath(tmp);
      const relative = path.relative(actualRoot, current);
      if (!relative.startsWith('case-') || relative.includes(path.sep) || path.isAbsolute(relative))
        throw new Error('Refusing to remove a non-test directory');
      await fs.rm(current, { recursive: true });
    }
  });
  h = await adapter.createHarness({ root: tmp, document: await doc(name),
    initial: { dirty: true, documentId: 'synthetic-doc', revision: 7,
      persistedRevision: 6, undo: ['synthetic-undo'], redo: ['synthetic-redo'],
      selection: [1], imageMap: { existing: 'synthetic-image-data' } } });
  return { h, tmp };
}

// This independent, intentionally narrow DXF reader is an oracle for the
// synthetic layer/color/LINE case. It is not the product parser.
function dxfRecords(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  assert.equal(lines.length % 2, 0, 'DXF code/value pairs must be complete');
  const records = []; let current;
  for (let i = 0; i < lines.length; i += 2) {
    assert.match(lines[i].trim(), /^-?\d+$/, 'DXF group code must be an integer');
    const code = Number(lines[i].trim()), value = lines[i+1].trim();
    assert.ok(Number.isInteger(code));
    if (code === 0) { current = { type: value, fields: [] }; records.push(current); }
    else if (current) current.fields.push([code, value]);
  }
  return records;
}
const field = (record, code) => record.fields.find(([c]) => c === code)?.[1];
function scopedDxfRecords(text) {
  const records = dxfRecords(text);
  let section = null, table = null, block = null, eof = false;
  for (const r of records) {
    if (r.type === 'SECTION') {
      assert.equal(section, null); section=field(r,2); assert.ok(section); continue;
    }
    if (r.type === 'ENDSEC') {
      assert.ok(section); assert.equal(table, null); assert.equal(block, null); section=null; continue;
    }
    if (r.type === 'EOF') { assert.equal(section,null); eof=true; continue; }
    assert.ok(section, `record ${r.type} outside a section`);
    if (r.type === 'TABLE') { assert.equal(section,'TABLES'); assert.equal(table,null); table=field(r,2); assert.ok(table); continue; }
    if (r.type === 'ENDTAB') { assert.ok(table); table=null; continue; }
    if (r.type === 'BLOCK') { assert.equal(section,'BLOCKS'); assert.equal(block,null); block=field(r,2); assert.ok(block); }
    r.section=section; r.table=table; r.block=block;
    if (r.type === 'ENDBLK') { assert.ok(block); block=null; }
  }
  assert.equal(section,null); assert.equal(table,null); assert.equal(block,null); assert.ok(eof);
  return records;
}
function assertLayerSeparation(text) {
  const records = scopedDxfRecords(text);
  const layers = records.filter(r => r.section === 'TABLES' && r.table === 'LAYER' && r.type === 'LAYER').map(r => ({name:field(r,2),color:Number(field(r,62))}));
  assert.ok(layers.every(x => x.name));
  assert.equal(new Set(layers.map(x => x.name.toUpperCase())).size, layers.length);
  const lines = records.filter(r => r.section === 'ENTITIES' && r.type === 'LINE');
  assert.equal(lines.length, 4);
  for (const [y, color] of [[0,1],[50,2],[100,3],[150,4]]) {
    const line = lines.find(r => Number(field(r,20)) === y);
    assert.ok(line, `missing line y=${y}`);
    assert.equal(Number(field(line,10)),0); assert.equal(Number(field(line,11)),100);
    assert.equal(Number(field(line,21)),y);
    const layer = layers.find(x => x.name === field(line,8));
    assert.ok(layer); assert.equal(Math.abs(layer.color), color);
  }
}
function assertBlockLinetypeSeparation(text) {
  const records = scopedDxfRecords(text);
  const blockRecords = records.filter(r => r.section === 'BLOCKS' && r.type === 'BLOCK');
  const blockNames = blockRecords.map(r => field(r,2)?.toUpperCase());
  assert.ok(blockNames.every(Boolean)); assert.equal(new Set(blockNames).size, blockNames.length);
  const inserted = records.filter(r => r.section === 'ENTITIES' && r.type === 'INSERT');
  assert.equal(inserted.length, 2);
  assert.equal(new Set(inserted.map(r => field(r,2)?.toUpperCase())).size, 2);
  for (const [x,expectedLength] of [[310,1],[320,2]]) {
    const insert = inserted.find(r => Number(field(r,10)) === x);
    assert.ok(insert, `missing insert x=${x}`);
    const name = field(insert,2)?.toUpperCase();
    const start = records.findIndex(r => r.section === 'BLOCKS' && r.type === 'BLOCK' && field(r,2)?.toUpperCase() === name);
    assert.ok(start >= 0);
    const end = records.findIndex((r,i) => i > start && r.type === 'ENDBLK');
    assert.ok(end > start);
    const lines = records.slice(start+1,end).filter(r => r.type === 'LINE');
    assert.equal(lines.length,1);
    const line=lines[0], dx=Number(field(line,11))-Number(field(line,10));
    const dy=Number(field(line,21))-Number(field(line,20));
    assert.equal(Math.hypot(dx,dy),expectedLength);
  }
  const definitionRecords = records.filter(r => r.section === 'TABLES' && r.table === 'LTYPE' && r.type === 'LTYPE');
  const definitionNames = definitionRecords.map(r => field(r,2)?.toUpperCase());
  assert.ok(definitionNames.every(Boolean));
  assert.equal(new Set(definitionNames).size,definitionNames.length);
  const layers = records.filter(r => r.section === 'TABLES' && r.table === 'LAYER' && r.type === 'LAYER');
  const ltypes = [1,2,3].map(color => {
    const layer = layers.find(r => Math.abs(Number(field(r,62))) === color);
    assert.ok(layer); return field(layer,6)?.toUpperCase();
  });
  assert.equal(new Set(ltypes).size, 3);
  for (let i=0;i<ltypes.length;i++) {
    const definition=definitionRecords.find(r => field(r,2)?.toUpperCase() === ltypes[i]);
    assert.ok(definition);
    const pattern=definition.fields.filter(([code]) => code===49).map(([,value])=>Number(value));
    assert.deepEqual(pattern,[i+1,-(i+1)]);
  }
}

test('합성 입력의 충돌·무한 좌표·단위 예시가 의도와 일치', async () => {
  const d = await doc();
  assert.deepEqual(d.layers.map(x => x.name).slice(1), ['A B', 'A_B', 'a_b', '층/검토']);
  assert.equal(new Set(d.ents.map(x => x.id)).size, 4);
  const bad = JSON.parse(await read('invalid-nonfinite.dcad.json'));
  assert.ok(bad.ents.some(e => !Number.isFinite(e.a.x) || !Number.isFinite(e.b.x)));
  const inch = await fs.readFile(path.join(synthetic, 'square-one-inch.dxf'), 'utf8');
  assert.match(inch, /\$INSUNITS\n70\n1\n/);
  assert.equal(dxfRecords(inch).filter(r => r.type === 'LINE').length, 4);
});

test('합성 이미지·치수와 기본 손상 입력의 형식 확인', async () => {
  const d = await doc('image-and-dimension.dcad.json');
  assert.equal(d.ents.filter(x => x.type === 'image').length, 1);
  assert.equal(d.ents.filter(x => x.type === 'dim').length, 1);
  assert.deepEqual([...Buffer.from(d.images['synthetic-image'].split(',')[1], 'base64').subarray(0,8)],
                   [137,80,78,71,13,10,26,10]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(handoff, 'invalid-format-only.dcad.json'))),
                   { format: 'daedong-cad' });
});
test('합성 중복 ID·누락 층·순환 블록 입력 확인', async () => {
  const duplicate = await doc('invalid-duplicate-id.dcad.json');
  assert.ok(new Set(duplicate.ents.map(e => e.id)).size < duplicate.ents.length);
  const missing = await doc('invalid-missing-layer.dcad.json');
  assert.ok(!missing.layers.some(l => l.name === missing.ents[0].layer));
  const cycle = await doc('invalid-cyclic-blocks.dcad.json');
  assert.equal(cycle.blocks.A.ents[0].name, 'B'); assert.equal(cycle.blocks.B.ents[0].name, 'A');
});
test('합성 블록과 선 종류 충돌 입력 확인', async () => {
  const d = await doc('block-linetype-collision.dcad.json');
  assert.deepEqual(Object.keys(d.blocks).sort(), ['B B','B_B']);
  assert.deepEqual(d.layers.slice(1,4).map(l => l.ltype), ['A B','A_B','a_b']);
  assert.equal(d.ents.filter(e => e.type === 'insert').length, 2);
});
test('독립 DXF 층 오라클은 의도된 충돌과 잘못된 소속을 거부', () => {
  const layer = (name,color) => `0\nLAYER\n2\n${name}\n62\n${color}\n`;
  const line = (name,y) => `0\nLINE\n8\n${name}\n10\n0\n20\n${y}\n11\n100\n21\n${y}\n`;
  const section=(name,content)=>`0\nSECTION\n2\n${name}\n${content}0\nENDSEC\n`;
  const table=(name,content)=>`0\nTABLE\n2\n${name}\n${content}0\nENDTAB\n`;
  const good = section('TABLES',table('LAYER',layer('L1',1)+layer('L2',2)+layer('L3',3)+layer('L4',4)))+
    section('ENTITIES',line('L1',0)+line('L2',50)+line('L3',100)+line('L4',150))+'0\nEOF\n';
  assertLayerSeparation(good);
  assert.throws(() => assertLayerSeparation(good.replace(layer('L2',2),layer('L1',2))));
  assert.throws(() => assertLayerSeparation(good.replace(line('L2',50),line('L1',50))));
  assert.throws(() => assertLayerSeparation(good.replace('11\n100\n21\n50','11\n99\n21\n50')));
  assert.throws(() => assertLayerSeparation(good.replace(layer('L2',2),'')+layer('L2',2)));
});
test('독립 DXF 블록·선 종류 오라클은 충돌과 누락 참조를 거부', () => {
  const record = (type,name) => `0\n${type}\n2\n${name}\n`;
  const layer = (name,color,ltype) => `0\nLAYER\n2\n${name}\n62\n${color}\n6\n${ltype}\n`;
  const block = (name,length) => record('BLOCK',name)+`0\nLINE\n10\n0\n20\n0\n11\n${length}\n21\n0\n0\nENDBLK\n`;
  const insert = (name,x) => record('INSERT',name)+`10\n${x}\n`;
  const ltype = (name,length) => record('LTYPE',name)+`49\n${length}\n49\n-${length}\n`;
  const section=(name,content)=>`0\nSECTION\n2\n${name}\n${content}0\nENDSEC\n`;
  const table=(name,content)=>`0\nTABLE\n2\n${name}\n${content}0\nENDTAB\n`;
  const definitions=ltype('T1',1)+ltype('T2',2)+ltype('T3',3);
  const blocks=block('B1',1)+block('B2',2);
  const good = section('TABLES',table('LTYPE',definitions)+table('LAYER',layer('L1',1,'T1')+layer('L2',2,'T2')+layer('L3',3,'T3')))+
    section('BLOCKS',blocks)+section('ENTITIES',insert('B1',310)+insert('B2',320))+'0\nEOF\n';
  assertBlockLinetypeSeparation(good);
  assert.throws(() => assertBlockLinetypeSeparation(good.replace('6\nT2', '6\nT1')));
  assert.throws(() => assertBlockLinetypeSeparation(good.replace('0\nINSERT\n2\nB2', '0\nINSERT\n2\nMISSING')));
  const swappedBlocks=good.replace(insert('B1',310),insert('B2',310)).replace(insert('B2',320),insert('B1',320));
  assert.throws(() => assertBlockLinetypeSeparation(swappedBlocks));
  const swappedTypes=good.replace(layer('L1',1,'T1'),layer('L1',1,'T2')).replace(layer('L2',2,'T2'),layer('L2',2,'T1'));
  assert.throws(() => assertBlockLinetypeSeparation(swappedTypes));
  assert.throws(() => assertBlockLinetypeSeparation(good.replace(table('LTYPE',definitions),table('LTYPE',definitions+ltype('T1',1)))));
  assert.throws(() => assertBlockLinetypeSeparation(good.replace(section('BLOCKS',blocks),section('BLOCKS',blocks+block('B1',1)))));
  assert.throws(() => assertBlockLinetypeSeparation(good.replace(ltype('T2',2),'')));
});

for (const [id, name] of [['T01.01','invalid-format-only.dcad.json'], ['T01.02','invalid-duplicate-id.dcad.json'],
  ['T01.03','invalid-missing-layer.dcad.json'], ['T01.04','invalid-cyclic-blocks.dcad.json'], ['T01.05','invalid-nonfinite.dcad.json']]) {
  test(`${id}: ${name} 거부 시 전체 세션 불변`, { skip }, async (t) => {
    const { h } = await fixture(t); const before = await h.snapshot();
    const bytes = name === 'invalid-format-only.dcad.json'
      ? await fs.readFile(path.join(handoff, name)) : await read(name);
    const result = await h.openWorkBytes(bytes);
    assert.equal(result.ok, false); assert.ok(result.code);
    equalState(await h.snapshot(), before);
  });
}
test('T01.06: 이미지 준비 실패도 문서·이력·이미지맵을 바꾸지 않음', { skip }, async (t) => {
  const { h } = await fixture(t); const before = await h.snapshot();
  const result = await h.openWorkBytes(await read('image-and-dimension.dcad.json'),
                                       { injectFailureAt: 'prepare-image' });
  assert.equal(result.ok, false); equalState(await h.snapshot(), before);
});

for (const [id, stage, code] of [['T02.01','temp-write','ENOSPC'], ['T02.02','before-replace','EACCES'], ['T02.03','replace','EACCES']]) {
  test(`${id}: ${stage}/${code} 저장 실패 때 이전 파일 보존`, { skip }, async (t) => {
    const { h, tmp } = await fixture(t); const target = path.join(tmp, 'drawing.dcad.json');
    const old = Buffer.from(JSON.stringify(await doc())); await fs.writeFile(target, old);
    await h.bindTarget(target); const before = await h.snapshot();
    const result = await h.saveWork({ path: target, injectFailureAt: stage, failureCode: code });
    assert.equal(result.ok, false); assert.deepEqual(await fs.readFile(target), old);
    const after = await h.snapshot();
    assert.equal(after.dirty, true); assert.equal(after.documentId, before.documentId);
    assert.equal(after.persistedRevision, before.persistedRevision);
  });
}
test('T02.04: 외부 수정 감지 후 새 외부 데이터를 덮지 않음', { skip }, async (t) => {
  const { h, tmp } = await fixture(t); const target = path.join(tmp, 'drawing.dcad.json');
  await fs.writeFile(target, 'OLD'); await h.bindTarget(target);
  await fs.writeFile(target, 'SYNTHETIC-EXTERNAL-UPDATE');
  const result = await h.saveWork({ path: target });
  assert.equal(result.ok, false); assert.equal(result.code, 'conflict');
  assert.equal(await fs.readFile(target, 'utf8'), 'SYNTHETIC-EXTERNAL-UPDATE');
  assert.equal((await h.snapshot()).dirty, true);
});
test('T02.05: 저장 중 새 편집은 저장 완료 후에도 dirty', { skip }, async (t) => {
  const { h, tmp } = await fixture(t); const target = path.join(tmp, 'drawing.dcad.json');
  await fs.writeFile(target, 'OLD'); await h.bindTarget(target);
  const tx = await h.beginPausedSave({ path: target, pauseAt: 'before-replace' });
  await tx.reached; await h.edit('append-synthetic-line'); tx.release();
  const result = await tx.result, after = await h.snapshot();
  assert.equal(result.ok, true); assert.equal(after.documentId, 'synthetic-doc');
  assert.equal(after.persistedRevision, 7); assert.equal(after.revision, 8); assert.equal(after.dirty, true);
});
test('T02.06: 성공한 저장 뒤 이전 파일의 정확한 사본 보존', { skip }, async (t) => {
  const { h, tmp } = await fixture(t); const target = path.join(tmp, 'drawing.dcad.json');
  const old = Buffer.from(JSON.stringify(await doc())); await fs.writeFile(target, old); await h.bindTarget(target);
  const result = await h.saveWork({ path: target });
  assert.equal(result.ok, true); assert.ok(result.previousVersionPath);
  const backup = await fs.realpath(result.previousVersionPath), relative = path.relative(tmp, backup);
  assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
  assert.deepEqual(await fs.readFile(backup), old);
});

test('T02.07: 저장 도중 다른 문서로 전환해도 새 문서 경로와 상태 불변', { skip }, async (t) => {
  const { h, tmp } = await fixture(t); const target = path.join(tmp, 'drawing.dcad.json');
  await fs.writeFile(target, 'OLD'); await h.bindTarget(target);
  const tx = await h.beginPausedSave({ path: target, pauseAt: 'before-replace' });
  await tx.reached;
  await h.switchDocument({ document: await doc(), documentId: 'other-doc', revision: 3, persistedRevision: null });
  const before = await h.snapshot(); tx.release(); const result = await tx.result;
  assert.equal(result.ok, true); const after = await h.snapshot();
  assert.equal(after.documentId, 'other-doc'); assert.equal(after.revision, before.revision);
  assert.equal(after.persistedRevision, before.persistedRevision); assert.deepEqual(after.file, before.file);
  assert.equal(after.dirty, before.dirty); assert.deepEqual(after.doc, before.doc);
});

test('T03.01: 복구본은 정식 저장 전까지 dirty', { skip }, async (t) => {
  const { h } = await fixture(t);
  await h.stageRecovery({ document: await doc(), revision: 12 });
  const result = await h.startRecovery({ choice: 'restore' });
  assert.equal(result.ok, true); const after = await h.snapshot();
  assert.equal(after.dirty, true); assert.equal(after.persistedRevision, null);
  assert.equal(after.recoveryStatus, 'restored-needs-save');
});
test('T03.02: 복구 선택 취소 시 복구 세대와 현재 세션 보존', { skip }, async (t) => {
  const { h } = await fixture(t); await h.stageRecovery({ document: await doc(), revision: 12 });
  const before = await h.snapshot(); const generations = await h.recoveryGenerations();
  assert.equal((await h.startRecovery({ choice: 'cancel' })).ok, false);
  equalState(await h.snapshot(), before); assert.deepEqual(await h.recoveryGenerations(), generations);
});
test('T03.03: 자동 복구 보관 실패를 성공으로 표시하지 않음', { skip }, async (t) => {
  const { h } = await fixture(t);
  const result = await h.writeRecovery({ injectFailureAt: 'write', failureCode: 'ENOSPC' });
  assert.equal(result.ok, false); assert.equal((await h.snapshot()).recoveryStatus, 'error');
});

test('T03.04: 복구 후 시작 파일 교체 취소 시 복구본 보존', { skip }, async (t) => {
  const { h } = await fixture(t); await h.stageRecovery({ document: await doc(), revision: 12 });
  await h.startRecovery({ choice: 'restore' }); const before = await h.snapshot();
  const generations = await h.recoveryGenerations();
  const result = await h.openStartupFile(await read('baseline.dcad.json'), { choice: 'cancel' });
  assert.equal(result.ok, false); equalState(await h.snapshot(), before);
  assert.deepEqual(await h.recoveryGenerations(), generations);
});

test('T04.01: 충돌 레이어가 DXF 독립 코드 검사에서 구분·색 유지', { skip }, async (t) => {
  const { h } = await fixture(t); const result = await h.exportDxf({ confirmed: true });
  assert.equal(result.ok, true); assertLayerSeparation(Buffer.from(result.bytes).toString('utf8'));
});
test('T04.02: 충돌 블록·선 종류의 DXF 정의와 참조가 각각 일치', { skip }, async (t) => {
  const { h } = await fixture(t, 'block-linetype-collision.dcad.json');
  const result = await h.exportDxf({ confirmed: true }); assert.equal(result.ok, true);
  assertBlockLinetypeSeparation(Buffer.from(result.bytes).toString('utf8'));
});
test('T05.01: 이미지·치수 DXF 내보내기는 작업 저장 상태를 해제하지 않음', { skip }, async (t) => {
  const { h } = await fixture(t, 'image-and-dimension.dcad.json'); const before = await h.snapshot();
  const preview = await h.previewDxf();
  assert.equal(preview.losses.imagesOmitted, 1); assert.equal(preview.losses.dimensionsConverted, 1);
  const result = await h.exportDxf({ confirmed: true }); assert.equal(result.ok, true);
  const after = await h.snapshot();
  assert.equal(after.dirty, true); assert.equal(after.persistedRevision, before.persistedRevision);
  assert.deepEqual(after.file, before.file); assert.deepEqual(after.doc, before.doc);
});
test('T05.02: 1인치 정사각형은 25.4mm 및 645.16mm²로 변환', { skip }, async (t) => {
  const { h } = await fixture(t); const result = await h.importDxf(await read('square-one-inch.dxf'), { unitDecision: 'convert-to-mm', replaceDecision: 'replace' });
  assert.equal(result.ok, true); const lines = (await h.snapshot()).doc.ents.filter(e => e.type === 'line');
  assert.equal(lines.length, 4); const xs = lines.flatMap(e => [e.a.x,e.b.x]), ys = lines.flatMap(e => [e.a.y,e.b.y]);
  const width = Math.max(...xs)-Math.min(...xs), height = Math.max(...ys)-Math.min(...ys);
  near(width,25.4); near(height,25.4); near(width*height,645.16);
});
test('T05.03: 단위 미상은 선택 전 원본 세션을 교체하지 않음', { skip }, async (t) => {
  const { h } = await fixture(t); const before = await h.snapshot();
  const result = await h.importDxf(await read('square-unit-unknown.dxf'), { unitDecision: null, replaceDecision: 'replace' });
  assert.equal(result.ok, false); assert.equal(result.code, 'unit-choice-required');
  equalState(await h.snapshot(), before);
});
