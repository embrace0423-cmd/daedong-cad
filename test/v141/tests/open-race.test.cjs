'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const a=html.indexOf('  function openAsk() {'),b=html.indexOf('  // 그림 파일인지',a);assert.ok(a>=0&&b>a);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup({deferConfirmation=false}={}){
  const opened=[],messages=[];let resolveRead,resolveDialog,resolveConfirm,reads=0,dialogs=0;
  const App={sessionId:4,revision:7,doc:{name:'existing'},dirty:true};
  const ctx=vm.createContext({App,Promise,msg:m=>messages.push(m),
    okToReplace:()=>deferConfirmation?new Promise(resolve=>{resolveConfirm=resolve;}):Promise.resolve(true),
    Desk:{read:()=>{reads++;return new Promise(resolve=>{resolveRead=resolve;});},
          open:()=>{dialogs++;return new Promise(resolve=>{resolveDialog=resolve;});}},
    openData:(name,data,p)=>{opened.push({name,p});App.doc={name};return true;}});
  vm.runInContext(html.slice(a,b),ctx);
  return {ctx,App,opened,messages,getReads:()=>reads,getDialogs:()=>dialogs,
          resolveRead:()=>resolveRead({name:'new.dcad.json',data:'synthetic',path:'new'}),
          resolveDialog:()=>resolveDialog({name:'new.dcad.json',data:'synthetic',path:'new'}),
          resolveConfirm:()=>resolveConfirm(true)};
}
test('an edit while a selected file is being read prevents replacement',async()=>{
  const s=setup();s.ctx.openPath('synthetic');await flush();assert.equal(s.getReads(),1);
  s.App.revision++;s.App.doc.name='new edit';s.resolveRead();await flush();
  assert.equal(s.opened.length,0);assert.equal(s.App.doc.name,'new edit');
});
test('an edit during a file selection dialog prevents replacement',async()=>{
  const s=setup();s.ctx.openAsk();await flush();assert.equal(s.getDialogs(),1);
  s.App.revision++;s.App.doc.name='new edit';s.resolveDialog();await flush();
  assert.equal(s.opened.length,0);assert.equal(s.App.doc.name,'new edit');
});
test('a document switch during a file read prevents replacement',async()=>{
  const s=setup();s.ctx.openPath('synthetic');await flush();s.App.sessionId++;s.App.doc={name:'other'};
  s.resolveRead();await flush();assert.equal(s.opened.length,0);assert.equal(s.App.doc.name,'other');
});
test('an edit while the unsaved-work confirmation is pending prevents starting the read',async()=>{
  const s=setup({deferConfirmation:true});s.ctx.openPath('synthetic');s.App.revision++;s.resolveConfirm();await flush();
  assert.equal(s.getReads(),0);assert.equal(s.opened.length,0);
});
test('unchanged document permits the selected file to open',async()=>{
  const s=setup();s.ctx.openPath('synthetic');await flush();s.resolveRead();await flush();
  assert.equal(s.opened.length,1);assert.equal(s.App.doc.name,'new.dcad.json');
});
