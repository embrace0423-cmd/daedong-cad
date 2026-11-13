'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const start=html.indexOf('  function setFile(r, kind) {'),end=html.indexOf('  // 그림·표 내보내기',start);
assert.ok(start>=0&&end>start);
function setup(){
  const pending=[],requests=[],messages=[];
  const c=vm.createContext({App:{doc:{name:'synthetic',value:'first'},sessionId:1,revision:1,dirty:true,recovered:false,file:null},
    NS:{Images:{serialize:JSON.stringify},Safety:{validateWorkTextSize(){}},DXF:{}},Desk:{},Promise,console:{error(){}},
    baseName:()=> 'synthetic',updateTitle(){},scheduleAutosave(){},msg:s=>messages.push(s),
    saveFile(name,data,type,kind,opts){requests.push({name,data,kind,opts});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}});
  vm.runInContext(html.slice(start,end),c);
  return {c,pending,requests,messages};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('overlapping saves of one document start and finish in request order',async()=>{
  const s=setup(),first=s.c.saveWork({});
  s.c.App.revision=2;s.c.App.doc.value='second';s.c.App.dirty=true;
  const second=s.c.saveWork({});await flush();
  assert.equal(s.requests.length,1,'second save must wait for first');
  s.pending[0].resolve({name:'synthetic.dcad.json',path:'synthetic-path'});
  assert.equal(await first,false);await flush();assert.equal(s.requests.length,2);
  assert.equal(JSON.parse(s.requests[0].data).value,'first');assert.equal(JSON.parse(s.requests[1].data).value,'second');
  s.pending[1].resolve({name:'synthetic.dcad.json',path:'synthetic-path'});
  assert.equal(await second,true);assert.equal(s.c.App.dirty,false);assert.equal(s.c.App.revision,2);
});
test('queued old-document save is skipped after switching documents',async()=>{
  const s=setup(),first=s.c.saveWork({}),second=s.c.saveWork({});await flush();
  assert.equal(s.requests.length,1);s.c.App.sessionId=2;s.c.App.doc={name:'new'};s.c.App.file={path:'new-file'};s.c.App.dirty=true;
  s.pending[0].resolve({name:'old.dcad.json',path:'old-file'});
  assert.equal(await first,false);assert.equal(await second,false);
  assert.equal(s.requests.length,1);assert.equal(s.c.App.file.path,'new-file');assert.equal(s.c.App.dirty,true);
});
test('failed earlier save does not block a later queued save',async()=>{
  const s=setup(),first=s.c.saveWork({}),second=s.c.saveWork({});await flush();
  assert.equal(s.requests.length,1);s.pending[0].reject(new Error('synthetic failure'));
  assert.equal(await first,false);await flush();assert.equal(s.requests.length,2);
  s.pending[1].resolve({name:'synthetic.dcad.json',path:'synthetic-path'});
  assert.equal(await second,true);assert.equal(s.c.App.dirty,false);
});
