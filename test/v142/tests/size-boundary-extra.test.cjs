'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Safety=require('../src/app/safety.js'),source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
const a=source.indexOf('function readBoundedWork('),b=source.indexOf('function readDoc(',a);assert.ok(a>=0&&b>a);
test('bounded reader accepts the exact limit and rejects one byte over before reading',()=>{
 let size=128,reads=0;const bytes=Buffer.alloc(129,32);bytes.write('{"x":1}');
 const io={openSync:()=>7,fstatSync:()=>({size}),readSync(fd,buf,offset,length,pos){reads++;return bytes.copy(buf,offset,pos,pos+length);},closeSync(){}};
 const ctx=vm.createContext({fs:io,Buffer,MAX_WORK_BYTES:128});vm.runInContext(source.slice(a,b)+'\nthis.read=readBoundedWork;',ctx);
 const data=ctx.read('synthetic');assert.equal(data.length,128);assert.equal(JSON.parse(data.toString()).x,1);assert.equal(reads,1);
 size=129;reads=0;assert.throws(()=>ctx.read('synthetic'),e=>e.code==='EWORKTOOLARGE');assert.equal(reads,0);
});
test('a valid work document with over 1 MiB of multibyte text reads and validates',t=>{
 const parent=path.join(__dirname,'.sandbox');fs.mkdirSync(parent,{recursive:true});const allowed=fs.realpathSync(parent),dir=fs.mkdtempSync(path.join(allowed,'size-'));
 t.after(()=>{const real=fs.realpathSync(dir),rel=path.relative(allowed,real);assert.ok(rel.startsWith('size-')&&!rel.includes(path.sep)&&!path.isAbsolute(rel));fs.rmSync(real,{recursive:true});});
 const doc=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../fixtures/baseline.dcad.json'),'utf8'));
 doc.syntheticPadding='가'.repeat(350000);const raw=JSON.stringify(doc),file=path.join(dir,'valid-large.dcad.json');fs.writeFileSync(file,raw);
 assert.ok(fs.statSync(file).size>1024*1024);const ctx=vm.createContext({fs,Buffer,MAX_WORK_BYTES:Safety.MAX_WORK_BYTES});
 vm.runInContext(source.slice(a,b)+'\nthis.read=readBoundedWork;',ctx);const bytes=ctx.read(file);
 assert.equal(bytes.toString('utf8'),raw);Safety.validateWorkSize(bytes.byteLength);Safety.validateWork(JSON.parse(bytes));
});
