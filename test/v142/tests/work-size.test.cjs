'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8'),Safety=require('../src/app/safety.js');
function part(a,b){const x=html.indexOf(a),y=html.indexOf(b,x+a.length);assert.ok(x>=0&&y>x);return html.slice(x,y);}
test('UTF-8 byte count handles Korean, surrogate pairs, lone surrogates and stops at the limit',()=>{
 for(const s of ['ASCII','한글','😀','a\ud800b','\udc00'])assert.equal(Safety.utf8LengthUpTo(s,100),Buffer.byteLength(s,'utf8'));
 assert.equal(Safety.utf8LengthUpTo('abcdef',3),4);
 assert.equal(Safety.validateWorkTextSize('한😀'),Buffer.byteLength('한😀','utf8'));
});
test('oversized work bytes are rejected before UTF-8 decode and preserve current document',()=>{
 const messages=[],App={doc:{name:'original'},dirty:true,sessionId:1,revision:2};
 const ctx=vm.createContext({NS:{Safety},App,TextDecoder:class{constructor(){throw Error('must not decode');}},msg:s=>messages.push(s)});
 vm.runInContext(part('  function openData(name, bytes, path, token) {','  function chooseDxfUnit('),ctx);
 assert.equal(ctx.openData('large.dcad.json',{byteLength:Safety.MAX_WORK_BYTES+1},null),false);
 assert.equal(App.doc.name,'original');assert.equal(App.dirty,true);assert.ok(messages.some(s=>s.includes('64 MiB')));
});
test('oversized browser work file is rejected before constructing FileReader',()=>{
 let constructed=0,confirmed=0;const messages=[];
 const ctx=vm.createContext({NS:{Safety},Desk:null,isImageFile:()=>false,FileReader:class{constructor(){constructed++;}},
   msg:s=>messages.push(s),openingStamp:()=>({}),openingCurrent:()=>true,okToReplace:()=>{confirmed++;return Promise.resolve(true);}});
 vm.runInContext(part('  function openFile(file) {','  function openData('),ctx);
 ctx.openFile({name:'large.dcad.json',size:Safety.MAX_WORK_BYTES+1});
 assert.equal(constructed,0);assert.equal(confirmed,0);assert.ok(messages.some(s=>s.includes('64 MiB')));
});
