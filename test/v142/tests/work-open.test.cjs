'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.resolve(__dirname,'..'), html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const safety=require('../src/app/safety.js');
const fixtures=path.join(dir,'fixtures');
function part(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
function scenario({unpackFails=false,uiFails=false}={}) {
  let imageMap=new Map([['existing','old-image']]),messages=[],throwsOnce=uiFails;
  const images={
    capture(){return new Map(imageMap);},restore(s){imageMap=new Map(s);},
    has(k){return imageMap.has(k);},src(k){return imageMap.get(k);},
    prepare(d){
      for(const [k,v] of Object.entries(d.images||{}))if(imageMap.has(k)&&imageMap.get(k)!==v)return Promise.reject(new Error('충돌'));
      return Promise.resolve(Object.entries(d.images||{}));
    },
    commitPrepared(d,prepared){for(const [k,v] of prepared)imageMap.set(k,v);
      if(unpackFails)throw new Error('injected image failure');delete d.images;return d;},
    unpack(d){for(const [k,v] of Object.entries(d.images||{}))imageMap.set(k,v);
      if(unpackFails)throw new Error('injected image failure');delete d.images;return d;}
  };
  const ctx=vm.createContext({App:{doc:{name:'old',ents:[{id:1}],settings:{}},file:{name:'old.dcad.json'},undo:['undo'],redo:['redo'],sel:new Set([1]),hover:'old',dirty:true,recovered:true,recoveryProtected:true,sessionId:4,revision:7},
    Model:{touch(){}},NS:{Safety:safety,Images:images},Desk:{},TextDecoder,Uint8Array,console,performance,
    msg:m=>messages.push(m),zoomExtents(){},refreshPanels(){if(throwsOnce){throwsOnce=false;throw Error('injected ui failure');}},
    updateTitle(){},redraw(){}});
  vm.runInContext(part('  function setDoc(doc, keepView) {','  var index = new Map();')+
    'var index = new Map();\n'+part('  function rebuildIndex() {','  function entById(')+
    part('  function replaceDoc(d, file) {','  function openAsk() {')+
    part('  function openData(name, bytes, path, token) {','  // 출력 범위:'),ctx);
  function snap(){return JSON.stringify({doc:ctx.App.doc,file:ctx.App.file,undo:ctx.App.undo,redo:ctx.App.redo,
    sel:[...ctx.App.sel],hover:ctx.App.hover,dirty:ctx.App.dirty,recovered:ctx.App.recovered,
    recoveryProtected:ctx.App.recoveryProtected,sessionId:ctx.App.sessionId,revision:ctx.App.revision,images:[...imageMap]});}
  return {ctx,snap,messages};
}
for(const [label,file] of [
  ['format only',path.join(__dirname,'fixtures/invalid-format-only.dcad.json')],
  ['duplicate id',path.join(fixtures,'invalid-duplicate-id.dcad.json')],
  ['missing layer',path.join(fixtures,'invalid-missing-layer.dcad.json')],
  ['cyclic blocks',path.join(fixtures,'invalid-cyclic-blocks.dcad.json')],
  ['nonfinite coordinates',path.join(fixtures,'invalid-nonfinite.dcad.json')]
]){
  test(label+' is rejected without changing previous document/history/images',()=>{
    const s=scenario(),before=s.snap();s.ctx.openData('test.dcad.json',fs.readFileSync(file),'synthetic');
    assert.equal(s.snap(),before);assert.ok(s.messages.some(m=>m.includes('열기 실패')));
  });
}
test('invalid UTF-8 is rejected before state changes',()=>{
  const s=scenario(),before=s.snap();
  s.ctx.openData('test.dcad.json',Buffer.from([0xff,0xfe,0x7b,0x7d]),'synthetic');
  assert.equal(s.snap(),before);assert.ok(s.messages.some(m=>m.includes('열기 실패')));
});
test('image staging failure rolls back images and current document',async()=>{
  const s=scenario({unpackFails:true}),before=s.snap();
  await s.ctx.openData('test.dcad.json',fs.readFileSync(path.join(fixtures,'image-and-dimension.dcad.json')),'synthetic');
  assert.equal(s.snap(),before);assert.ok(s.messages.some(m=>m.includes('열기 실패')));
});
test('UI preparation exception rolls back model, file, undo, redo and image map',async()=>{
  const s=scenario({uiFails:true}),before=s.snap();
  await s.ctx.openData('test.dcad.json',fs.readFileSync(path.join(fixtures,'image-and-dimension.dcad.json')),'synthetic');
  assert.equal(s.snap(),before);assert.ok(s.messages.some(m=>m.includes('열기 실패')));
});
test('valid v1 file commits and remains readable',()=>{
  const s=scenario();s.ctx.openData('test.dcad.json',fs.readFileSync(path.join(fixtures,'baseline.dcad.json')),'synthetic','trusted-read-token');
  assert.equal(s.ctx.App.doc.ents.length,4);assert.equal(s.ctx.App.file.name,'test.dcad.json');
  assert.equal(s.ctx.App.file.token,'trusted-read-token');
  assert.equal(s.ctx.App.dirty,false);assert.equal(s.ctx.App.undo.length,0);
  assert.ok(s.messages.some(m=>m.includes('열었습니다')));
});
test('image reference collision fails without replacing an existing image',async()=>{
  const input=JSON.parse(fs.readFileSync(path.join(fixtures,'image-and-dimension.dcad.json'),'utf8'));
  input.ents.find(x=>x.type==='image').ref='existing';input.images.existing=input.images['synthetic-image'];delete input.images['synthetic-image'];
  const s=scenario(),before=s.snap();await s.ctx.openData('test.dcad.json',Buffer.from(JSON.stringify(input)),'synthetic');
  assert.equal(s.snap(),before);assert.ok(s.messages.some(m=>m.includes('충돌')));
});
