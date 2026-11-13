'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const a=html.indexOf('  function saveFile(name, data, type, kind, opts) {'),b=html.indexOf('  function setFile(',a);assert.ok(a>=0&&b>a);
function setup(){const requests=[],App={file:{path:'synthetic-path',kind:'work',ours:true,token:'opaque-token'}};
 const ctx=vm.createContext({App,Blob,Promise,Desk:{save:r=>{requests.push(r);return Promise.resolve({});}}});vm.runInContext(html.slice(a,b),ctx);return{ctx,App,requests};}
test('normal work save sends the accepted document token to main process',async()=>{
 const s=setup();await s.ctx.saveFile('x','data','application/json','work',{});
 assert.equal(s.requests[0].path,'synthetic-path');assert.equal(s.requests[0].fileToken,'opaque-token');
});
test('explicit save-as does not reuse the previous document token',async()=>{
 const s=setup();await s.ctx.saveFile('x','data','application/json','work',{ask:true});
 assert.equal(s.requests[0].path,null);assert.equal(s.requests[0].fileToken,null);
});
