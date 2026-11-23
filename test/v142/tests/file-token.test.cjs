'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const atomicStore=require('../src/atomic-store.cjs'),Safety=require('../src/app/safety.js');
const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
const start=source.indexOf('function issueFileToken('),end=source.indexOf("ipcMain.handle('dcad:info'",start);assert.ok(start>=0&&end>start);
const parent=path.join(__dirname,'.sandbox');fs.mkdirSync(parent,{recursive:true});const allowed=fs.realpathSync(parent);
function setup(t){
 const dir=fs.mkdtempSync(path.join(allowed,'token-'));
 t.after(()=>{const real=fs.realpathSync(dir),rel=path.relative(allowed,real);assert.ok(rel.startsWith('token-')&&!rel.includes(path.sep)&&!path.isAbsolute(rel));fs.rmSync(real,{recursive:true});});
 const handlers={},ctx=vm.createContext({fs,path,atomicStore,crypto,Buffer,MAX_WORK_BYTES:Safety.MAX_WORK_BYTES,MAX_FILE_TOKENS:4096,
   fileTokens:new Map(),lastDir:null,pushRecent(){},app:{getPath(){throw Error('unused');}},dialog:{},win:{},FILTERS:{},
   ipcMain:{handle:(name,fn)=>{handlers[name]=fn;}}});
 vm.runInContext(source.slice(start,end)+'\nthis.reader=readDoc;this.writer=writeOut;this.bounded=readBoundedWork;',ctx);
 const x=source.indexOf("ipcMain.handle('dcad:save'"),y=source.indexOf("ipcMain.handle('dcad:pdf'",x);assert.ok(x>=0&&y>x);vm.runInContext(source.slice(x,y),ctx);
 const file=path.join(dir,'drawing.dcad.json'),initial=Buffer.from('{"format":"daedong-cad","name":"old"}');fs.writeFileSync(file,initial);
 return {ctx,dir,file,initial,handlers};
}
test('failed re-open never refreshes the original document save token',t=>{
 const s=setup(t),opened=s.ctx.reader(s.file);fs.writeFileSync(s.file,'external-invalid');
 assert.throws(()=>s.ctx.writer(s.file,'local draft',opened.token),e=>e.code==='EEXTERNAL');
 const attempted=s.ctx.reader(s.file);assert.throws(()=>JSON.parse(attempted.data.toString('utf8')));
 assert.throws(()=>s.ctx.writer(s.file,'local draft',opened.token),e=>e.code==='EEXTERNAL');
 assert.equal(fs.readFileSync(s.file,'utf8'),'external-invalid');
});
test('rejected image or canceled open keeps the prior token and detects external changes',t=>{
 const s=setup(t),opened=s.ctx.reader(s.file);fs.writeFileSync(s.file,'external-valid-json-but-image-invalid');
 const attempted=s.ctx.reader(s.file);assert.notEqual(attempted.token,opened.token);
 assert.throws(()=>s.ctx.writer(s.file,'local draft',opened.token),e=>e.code==='EEXTERNAL');
 assert.equal(fs.readFileSync(s.file,'utf8'),'external-valid-json-but-image-invalid');
});
test('explicitly accepted external version can use its new token and keeps its prior bytes',t=>{
 const s=setup(t),old=s.ctx.reader(s.file);fs.writeFileSync(s.file,'{"format":"daedong-cad","name":"new external"}');
 const accepted=s.ctx.reader(s.file);assert.equal(JSON.parse(accepted.data.toString()).name,'new external');
 assert.throws(()=>s.ctx.writer(s.file,'local',old.token),e=>e.code==='EEXTERNAL');
 const saved=s.ctx.writer(s.file,'accepted edit',accepted.token);assert.equal(fs.readFileSync(s.file,'utf8'),'accepted edit');
 assert.equal(fs.readFileSync(saved.backupPath,'utf8'),'{"format":"daedong-cad","name":"new external"}');assert.notEqual(saved.token,accepted.token);
 s.ctx.writer(s.file,'next edit',saved.token);assert.equal(fs.readFileSync(s.file,'utf8'),'next edit');
});
test('tokens are opaque, path-bound and reject missing or fabricated references',t=>{
 const s=setup(t),first=s.ctx.reader(s.file),other=path.join(s.dir,'other.dcad.json');fs.writeFileSync(other,'other');
 assert.throws(()=>s.ctx.writer(other,'bad',first.token),e=>e.code==='EFILETOKEN');
 assert.throws(()=>s.ctx.writer(s.file,'bad','invented'),e=>e.code==='EFILETOKEN');
 assert.equal(fs.readFileSync(other,'utf8'),'other');assert.deepEqual(fs.readFileSync(s.file),s.initial);
});
test('two independently opened sessions detect a conflicting save',t=>{
 const s=setup(t),a=s.ctx.reader(s.file),b=s.ctx.reader(s.file);s.ctx.writer(s.file,'first session',a.token);
 assert.throws(()=>s.ctx.writer(s.file,'second session',b.token),e=>e.code==='EEXTERNAL');
 assert.equal(fs.readFileSync(s.file,'utf8'),'first session');
});
test('actual save IPC requires the current opaque token and catches rejected re-open',async t=>{
 const s=setup(t),first=s.ctx.reader(s.file);fs.writeFileSync(s.file,'external invalid');s.ctx.reader(s.file);
 await assert.rejects(s.handlers['dcad:save']({}, {path:s.file,data:'local',fileToken:first.token}),e=>e.code==='EEXTERNAL');
 await assert.rejects(s.handlers['dcad:save']({}, {path:s.file,data:'local'}),/저장 기준/);
 assert.equal(fs.readFileSync(s.file,'utf8'),'external invalid');
});
test('save IPC rejects oversized work bytes before writing or asking for a destination',async t=>{
 const s=setup(t),opened=s.ctx.reader(s.file),large=Buffer.allocUnsafe(Safety.MAX_WORK_BYTES+1);
 await assert.rejects(s.handlers['dcad:save']({}, {path:s.file,data:large,kind:'work',fileToken:opened.token}),e=>e.code==='EWORKTOOLARGE');
 await assert.rejects(s.handlers['dcad:save']({}, {path:null,data:large,kind:'work'}),e=>e.code==='EWORKTOOLARGE');
 assert.deepEqual(fs.readFileSync(s.file),s.initial);
});
test('work-file size limit is checked before allocating or reading file content',t=>{
 const s=setup(t),file=path.join(s.dir,'oversize.dcad.json'),fd=fs.openSync(file,'w');
 try{fs.ftruncateSync(fd,Safety.MAX_WORK_BYTES+1);}finally{fs.closeSync(fd);}
 assert.throws(()=>s.ctx.reader(file),e=>e.code==='EWORKTOOLARGE');assert.equal(fs.statSync(file).size,Safety.MAX_WORK_BYTES+1);
});
test('64 MiB boundary is explicit and validates before parsing',()=>{
 assert.equal(Safety.validateWorkSize(Safety.MAX_WORK_BYTES),64*1024*1024);
 assert.throws(()=>Safety.validateWorkSize(Safety.MAX_WORK_BYTES+1),/64 MiB/);
 assert.throws(()=>Safety.validateWorkSize(-1),/올바르지/);
});
