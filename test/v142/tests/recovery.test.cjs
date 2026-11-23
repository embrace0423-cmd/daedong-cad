'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const safety=require('../src/app/safety.js');
const fixture=fs.readFileSync(path.resolve(__dirname,'../fixtures/baseline.dcad.json'),'utf8');
const imageFixture=fs.readFileSync(path.resolve(__dirname,'../fixtures/image-and-dimension.dcad.json'),'utf8');
function part(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
function setup({choice='cancel',archiveFails=false,autoWriteFails=false,raw=fixture,saveOk=false,deferImage=false}={}) {
  const storage=new Map([['auto',raw]]), messages=[],opened=[],reported=[],callbacks={};
  let resolveImage,rejectImage;
  const ctx=vm.createContext({App:{doc:null,dirty:false,recovered:false,recoveryProtected:false},
    AUTOSAVE:'auto',RECOVERY_ARCHIVE:'archive',Promise,TextEncoder,TextDecoder,Uint8Array,
    NS:{Safety:safety,Images:{capture:()=>new Map(),restore(){},unpack:d=>d,serialize:JSON.stringify,
      prepare:()=>new Promise((resolve,reject)=>{resolveImage=resolve;rejectImage=reject;}),
      commitPrepared(d){delete d.images;return d;}}},
    lsGet:k=>storage.get(k)??null,lsSet:(k,v)=>{if((k==='archive'&&archiveFails)||(k==='auto'&&autoWriteFails))return false;storage.set(k,v);return true;},
    setDoc(d){ctx.App.doc=d;},updateTitle(){},msg:m=>messages.push(m),
    g:{confirm:()=>choice==='discard',prompt:()=> '1'},$$:()=>[], $:()=>({open:false,close(){}}),
    document:{body:{inert:false,classList:{add(){}}}},openPath(){},saveCurrent:()=>Promise.resolve(saveOk),
    Lib:{newFromTemplate:()=>({name:'fallback synthetic'})},openNew(){},renderLib(){},showPrompt(){},redraw(){},
    saveWork:()=>{if(saveOk)ctx.App.dirty=false;return Promise.resolve(saveOk);},
    openData(name,data,p){opened.push({name,p});ctx.App.doc={name:'opened other'};return true;},
    Desk:{confirmReplace:()=>Promise.resolve(choice),onOpenPath(){},onSaveAndClose(){},
          onRecoveryClose(fn){callbacks.close=fn;},reportRecoveryClose(result){reported.push(result);},
          onRecoveryCloseCancelled(fn){callbacks.cancel=fn;},
          initialFile:()=>Promise.resolve({name:'start.dcad.json',data:new Uint8Array(),path:'synthetic'})}});
  const code=part('  function openingStamp() {','  // 그림 파일인지')+
    part('  function archiveCurrentRecovery() {','  function scheduleAutosave() {')+
    part('  function okToReplace() {','  function replaceDoc(')+
    'function runStartup(){\n'+part('    // 자동 저장본이 있으면 이어서,','  // 데스크톱 앱: PDF 버튼')+
    part('  function initDesktop() {','  function showTab(');
  vm.runInContext(code,ctx);
  const desk=ctx.Desk;ctx.Desk=null;ctx.runStartup();if(!deferImage)ctx.Desk=desk;
  return {ctx,storage,messages,opened,reported,callbacks,resolveImage:()=>resolveImage([]),rejectImage:()=>rejectImage(new Error('decode failed'))};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('restored original work is marked dirty and protected',()=>{
  const s=setup();assert.equal(s.ctx.App.doc.name,'합성 시험 전용');
  assert.equal(s.ctx.App.dirty,true);assert.equal(s.ctx.App.recovered,true);assert.equal(s.ctx.App.recoveryProtected,true);
});
test('cancelling initial file preserves restored document and recovery bytes',async()=>{
  const s=setup({choice:'cancel'}),before=s.storage.get('auto');s.ctx.initDesktop();await flush();
  assert.equal(s.opened.length,0);assert.equal(s.ctx.App.doc.name,'합성 시험 전용');
  assert.equal(s.ctx.App.dirty,true);assert.equal(s.storage.get('auto'),before);
});
test('choosing another startup file archives recovered document first',async()=>{
  const s=setup({choice:'discard'}),before=s.storage.get('auto');s.ctx.initDesktop();await flush();
  assert.equal(s.opened.length,1);assert.equal(JSON.parse(s.storage.get('archive'))[0].data,before);
});
test('archive quota failure prevents replacement and keeps recovery untouched',async()=>{
  const s=setup({choice:'discard',archiveFails:true}),before=s.storage.get('auto');s.ctx.initDesktop();await flush();
  assert.equal(s.opened.length,0);assert.equal(s.storage.get('auto'),before);assert.equal(s.ctx.App.recoveryProtected,true);
  assert.ok(s.messages.some(m=>m.includes('보관하지 못했습니다')));
});
test('invalid recovery is not overwritten if archive fails',()=>{
  const s=setup({raw:'invalid-json',archiveFails:true});
  s.ctx.App.doc={name:'new'};assert.equal(s.ctx.writeAutosave(),false);assert.equal(s.storage.get('auto'),'invalid-json');
});
test('failed save choice does not open another document',async()=>{
  const s=setup({choice:'save',saveOk:false});s.ctx.initDesktop();await flush();
  assert.equal(s.opened.length,0);assert.equal(s.ctx.App.dirty,true);
});
test('successful save choice allows opening only after recovery is archived',async()=>{
  const s=setup({choice:'save',saveOk:true}),before=s.storage.get('auto');s.ctx.initDesktop();await flush();
  assert.equal(s.opened.length,1);assert.equal(JSON.parse(s.storage.get('archive'))[0].data,before);
});
test('close saves latest edit separately from the original recovered generation',async()=>{
  const s=setup({choice:'cancel'}),original=s.storage.get('auto');s.ctx.initDesktop();await flush();
  s.ctx.App.doc.name='latest synthetic edit';s.ctx.App.sessionId=4;s.ctx.App.revision=9;
  s.callbacks.close('synthetic-token');
  assert.equal(s.reported[0].ok,true);assert.equal(s.reported[0].revision,9);
  assert.equal(JSON.parse(s.storage.get('archive'))[0].data,original);
  assert.equal(JSON.parse(s.storage.get('auto')).name,'latest synthetic edit');
});
test('latest edit stays open when autosave fails while closing',async()=>{
  const s=setup({choice:'cancel',autoWriteFails:true}),original=s.storage.get('auto');s.ctx.initDesktop();await flush();
  s.ctx.App.doc.name='latest unsaved edit';s.ctx.App.sessionId=4;s.ctx.App.revision=9;
  s.callbacks.close('synthetic-token');
  assert.equal(s.reported[0].ok,false);assert.equal(s.ctx.document.body.inert,false);
  assert.equal(s.ctx.App.doc.name,'latest unsaved edit');assert.equal(s.storage.get('auto'),original);
  assert.equal(JSON.parse(s.storage.get('archive'))[0].data,original);
});
test('startup recovery waits for image decoding before marking a document recovered',async()=>{
  const s=setup({raw:imageFixture,deferImage:true});
  assert.equal(s.ctx.App.doc,null);assert.equal(s.ctx.document.body.inert,true);
  s.resolveImage();await flush();
  assert.equal(s.ctx.App.doc.name,'합성 시험 전용');assert.equal(s.ctx.App.dirty,true);
  assert.equal(s.ctx.App.recovered,true);assert.equal(s.ctx.App.recoveryProtected,true);
  assert.equal(s.ctx.document.body.inert,false);assert.equal(s.storage.get('auto'),imageFixture);
});
test('startup image decode failure keeps the original recovery bytes protected',async()=>{
  const s=setup({raw:imageFixture,deferImage:true});s.rejectImage();await flush();
  assert.equal(s.ctx.App.doc.name,'fallback synthetic');assert.equal(s.ctx.App.recoveryProtected,true);
  assert.equal(s.ctx.document.body.inert,false);assert.equal(s.storage.get('auto'),imageFixture);
  assert.ok(s.messages.some(m=>m.includes('그림을 읽지 못했습니다')));
});
for (const result of [false,true]) test('archived recovery marks dirty only after async open result '+result,async()=>{
  const s=setup();let resolveOpen;
  s.ctx.App.dirty=false;s.ctx.App.recovered=false;s.ctx.App.recoveryProtected=false;s.ctx.App.sessionId=4;s.ctx.App.revision=0;
  s.storage.set('archive',JSON.stringify([{at:'synthetic',data:fixture}]));
  s.ctx.Desk.chooseRecovery=()=>Promise.resolve(0);
  s.ctx.openData=()=>new Promise(resolve=>{resolveOpen=resolve;});
  vm.runInContext(part('  function openRecoveryArchive() {','  // 출력 범위:'),s.ctx);
  s.ctx.openRecoveryArchive();await flush();assert.equal(s.ctx.App.recovered,false);
  if(result)s.ctx.App.sessionId++;resolveOpen(result);await flush();
  assert.equal(s.ctx.App.recovered,result);assert.equal(s.ctx.App.dirty,result);assert.equal(s.ctx.App.recoveryProtected,result);
});
test('an unrelated document switch after archived recovery open is not marked recovered',async()=>{
  const s=setup();let resolveOpen;
  Object.assign(s.ctx.App,{dirty:false,recovered:false,recoveryProtected:false,sessionId:4,revision:0});
  s.storage.set('archive',JSON.stringify([{at:'synthetic',data:fixture}]));s.ctx.Desk.chooseRecovery=()=>Promise.resolve(0);
  s.ctx.openData=()=>new Promise(resolve=>{resolveOpen=resolve;});
  vm.runInContext(part('  function openRecoveryArchive() {','  // 출력 범위:'),s.ctx);
  s.ctx.openRecoveryArchive();await flush();s.ctx.App.sessionId=6;resolveOpen(true);await flush();
  assert.equal(s.ctx.App.recovered,false);assert.equal(s.ctx.App.dirty,false);
});
