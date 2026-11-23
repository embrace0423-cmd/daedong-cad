'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const Safety=require('../src/app/safety.js');
function part(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
function setup({confirm=true,reject=false,deferred=false,tooLarge=false}={}) {
  let wrote=0, requested=[],resolveSave,messages=[],confirmText='';
  const pending=new Promise(resolve=>resolveSave=resolve);
  const ctx=vm.createContext({
    App:{doc:{name:'original name',ents:[{type:'image'},{type:'dim'}],blocks:{}},dirty:true,recovered:true,
         sessionId:1,revision:7,file:{kind:'work',name:'old.dcad.json',path:'synthetic-old'}},
    NS:{Safety:tooLarge?{...Safety,validateWorkTextSize(){throw Error('64 MiB 한도');}}:Safety,DXF:{write(){wrote++;return 'synthetic dxf';}},Images:{serialize(d){return JSON.stringify(d);}}},
    g:{confirm(s){confirmText=s;return confirm;}},Desk:{},Promise,console:{error(){}},
    baseName:()=> 'synthetic',updateTitle(){},scheduleAutosave(){},msg:s=>messages.push(s),
    saveFile(name,data,type,kind,opts){requested.push({name,kind,opts});if(reject)return Promise.reject(Error('synthetic'));
      if(deferred)return pending;return Promise.resolve({name,path:'synthetic-output'});}
  });
  vm.runInContext(part('  function setFile(r, kind) {','  // 그림·표 내보내기'),ctx);
  return {ctx,requested,messages,getWrote:()=>wrote,getConfirm:()=>confirmText,resolveSave};
}
test('DXF export advertises loss and leaves work path and dirty unchanged',async()=>{
  const s=setup(),before=JSON.stringify(s.ctx.App);
  assert.equal(await s.ctx.saveDXF(),true);assert.equal(JSON.stringify(s.ctx.App),before);
  assert.equal(s.requested[0].kind,'dxf');assert.equal(s.requested[0].opts.ask,true);
  assert.match(s.getConfirm(),/밑그림 제외: 1개/);assert.match(s.getConfirm(),/치수 분해: 1개/);
});
test('cancelling loss confirmation writes nothing and preserves session',async()=>{
  const s=setup({confirm:false}),before=JSON.stringify(s.ctx.App);
  assert.equal(await s.ctx.saveDXF(),false);assert.equal(s.getWrote(),0);assert.equal(s.requested.length,0);
  assert.equal(JSON.stringify(s.ctx.App),before);
});
test('Ctrl+S saves work instead of DXF, preserving serialized document name',async()=>{
  const s=setup();assert.equal(await s.ctx.saveCurrent({}),true);
  assert.equal(s.requested[0].kind,'work');assert.equal(s.ctx.App.dirty,false);
  assert.equal(s.ctx.App.doc.name,'original name');assert.equal(s.ctx.App.recovered,false);
});
test('edit while save dialog is pending remains dirty and cannot close',async()=>{
  const s=setup({deferred:true}),pending=s.ctx.saveWork({});
  s.ctx.App.revision=8;s.ctx.App.dirty=true;s.resolveSave({name:'new.dcad.json',path:'synthetic-new'});
  assert.equal(await pending,false);assert.equal(s.ctx.App.dirty,true);assert.equal(s.ctx.App.revision,8);
});
test('switching documents during save never rewrites the new document path/state',async()=>{
  const s=setup({deferred:true}),pending=s.ctx.saveWork({});
  s.ctx.App.sessionId=2;s.ctx.App.revision=2;s.ctx.App.doc={name:'other',ents:[]};
  s.ctx.App.file={kind:'work',name:'other.dcad.json',path:'synthetic-other'};const before=JSON.stringify(s.ctx.App);
  s.resolveSave({name:'new.dcad.json',path:'synthetic-new'});
  assert.equal(await pending,false);assert.equal(JSON.stringify(s.ctx.App),before);
});
test('save failure leaves unsaved state and file identity intact',async()=>{
  const s=setup({reject:true}),before=JSON.stringify(s.ctx.App);
  assert.equal(await s.ctx.saveWork({}),false);assert.equal(JSON.stringify(s.ctx.App),before);
});
test('oversized work data is rejected before save and remains dirty',async()=>{
  const s=setup({tooLarge:true}),before=JSON.stringify(s.ctx.App);
  assert.equal(await s.ctx.saveWork({}),false);assert.equal(JSON.stringify(s.ctx.App),before);
  assert.equal(s.requested.length,0);assert.ok(s.messages.some(m=>m.includes('64 MiB')));
});
test('loss report counts repeated and nested block instances without claiming false zero',async()=>{
  const s=setup({confirm:false});
  s.ctx.App.doc.blocks={
    B:{ents:[{type:'image'},{type:'dim'},{type:'ellipse'},{type:'mtext'}]},
    A:{ents:[{type:'dim'},{type:'insert',name:'B'},{type:'insert',name:'B'}]}
  };
  s.ctx.App.doc.ents=[{type:'image'},{type:'dim'},{type:'insert',name:'A'},{type:'insert',name:'A'}];
  assert.equal(await s.ctx.saveDXF(),false);const m=s.getConfirm();
  assert.match(m,/중첩 블록/);assert.match(m,/밑그림 제외: 5개/);assert.match(m,/치수 분해: 7개/);
  assert.match(m,/타원 변환: 4개/);assert.match(m,/여러 줄 문자 분해: 4개/);
});
test('cyclic block loss report fails closed without invoking export or showing false counts',async()=>{
  const s=setup();s.ctx.App.doc.blocks={A:{ents:[{type:'insert',name:'A'}]}};
  s.ctx.App.doc.ents=[{type:'insert',name:'A'}];
  assert.equal(await s.ctx.saveDXF(),false);assert.equal(s.getWrote(),0);assert.equal(s.getConfirm(),'');
  assert.ok(s.messages.some(m=>m.includes('계산하지 못했습니다')));
});
