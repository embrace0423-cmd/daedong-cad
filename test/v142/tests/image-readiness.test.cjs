'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const safety=require('../src/app/safety.js');
const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../fixtures/image-and-dimension.dcad.json'),'utf8'));
function part(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
function setup(){
  const pending=[],messages=[];
  class FakeImage { set src(value){this.value=value;pending.push(this);} }
  const App={doc:{name:'old',ents:[{id:1}],settings:{}},file:{name:'old.dcad.json'},undo:['undo'],redo:['redo'],
    sel:new Set([1]),hover:'old',dirty:true,recovered:true,recoveryProtected:true,sessionId:4,revision:7};
  const ctx=vm.createContext({App,Image:FakeImage,Promise,TextDecoder,Uint8Array,console,performance,setTimeout,clearTimeout,
    Model:{touch(){}},Desk:{},msg:m=>messages.push(m),zoomExtents(){},refreshPanels(){},updateTitle(){},redraw(){}});
  vm.runInContext(part('// ---- js/images.js ----','</script>'),ctx);
  ctx.NS=ctx.DCAD;ctx.NS.Safety=safety;
  vm.runInContext(part('  function setDoc(doc, keepView) {','  var index = new Map();')+
    'var index = new Map();\n'+part('  function rebuildIndex() {','  function entById(')+
    part('  function replaceDoc(d, file) {','  function openAsk() {')+
    part('  function openData(name, bytes, path, token) {','  // 출력 범위:'),ctx);
  function snap(){return JSON.stringify({doc:App.doc,file:App.file,undo:App.undo,redo:App.redo,sel:[...App.sel],
    hover:App.hover,dirty:App.dirty,recovered:App.recovered,recoveryProtected:App.recoveryProtected,
    sessionId:App.sessionId,revision:App.revision,hasImage:ctx.NS.Images.has('synthetic-image')});}
  function start(input){return ctx.openData('image.dcad.json',Buffer.from(JSON.stringify(input)),'synthetic-path');}
  return {ctx,App,pending,messages,snap,start};
}
test('failed image decoding rejects a work file without replacing the current session',async()=>{
  const s=setup(),input=structuredClone(fixture);input.images['synthetic-image']='data:image/png;base64,AAAA';
  const before=s.snap(),result=s.start(input);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.pending.length,1);if(s.pending[0].onerror)s.pending[0].onerror(new Error('decode failed'));
  assert.equal(await result,false);assert.equal(s.snap(),before);assert.ok(s.messages.some(m=>m.includes('열기 실패')));
});
test('an edit while images load cancels replacement and keeps the edited document',async()=>{
  const s=setup(),result=s.start(fixture);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.pending.length,1);assert.equal(s.App.doc.name,'old');
  s.App.doc.name='edited while loading';s.App.revision++;s.App.dirty=true;
  if(s.pending[0].onload)s.pending[0].onload();
  assert.equal(await result,false);assert.equal(s.App.doc.name,'edited while loading');assert.equal(s.App.dirty,true);
  assert.equal(s.ctx.NS.Images.has('synthetic-image'),false);
});
test('successfully decoded image commits together with the candidate document',async()=>{
  const s=setup(),result=s.start(fixture);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.pending.length,1);assert.equal(s.App.doc.name,'old');
  if(s.pending[0].onload)s.pending[0].onload();
  assert.equal(await result,true);assert.equal(s.App.doc.ents.length,6);assert.equal(s.App.dirty,false);
  assert.equal(s.ctx.NS.Images.el('synthetic-image'),s.pending[0]);
});
test('a reference introduced during image loading is rechecked before committing',async()=>{
  const s=setup(),result=s.start(fixture);
  await new Promise(resolve=>setImmediate(resolve));
  s.ctx.NS.Images.unpack({images:{'synthetic-image':'data:image/png;base64,BBBB'}});
  const before=s.snap();s.pending[0].onload();
  assert.equal(await result,false);assert.equal(s.snap(),before);
  assert.equal(s.ctx.NS.Images.src('synthetic-image'),'data:image/png;base64,BBBB');
});
