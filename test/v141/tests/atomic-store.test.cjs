'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {writeAtomic,fingerprint}=require('../src/atomic-store.cjs');
const workspace=fs.realpathSync(path.resolve(__dirname,'..'));
const parent=path.join(__dirname,'.sandbox');fs.mkdirSync(parent,{recursive:true});
const allowed=fs.realpathSync(parent), relativeRoot=path.relative(workspace,allowed);
assert.ok(relativeRoot && relativeRoot!=='..' && !relativeRoot.startsWith('..'+path.sep) && !path.isAbsolute(relativeRoot));
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(allowed,'f1-'));
  t.after(()=>{
    const real=fs.realpathSync(dir), rel=path.relative(allowed,real);
    assert.ok(rel.startsWith('f1-')&&!rel.includes(path.sep)&&!path.isAbsolute(rel));
    fs.rmSync(real,{recursive:true});
  });
  const target=path.join(dir,'drawing.dcad.json');
  const old=Buffer.from('{"format":"daedong-cad","name":"old synthetic"}');
  fs.writeFileSync(target,old);
  return {dir,target,old,expected:fingerprint(target)};
}
test('partial write ENOSPC preserves the previous target',t=>{
  const {target,old,expected}=fixture(t);
  const io={...fs,writeFileSync(fd,data){fs.writeSync(fd,Buffer.from(data).subarray(0,3));const e=new Error('injected');e.code='ENOSPC';throw e;}};
  assert.throws(()=>writeAtomic(target,'new synthetic',{expected,io}),e=>e.code==='ENOSPC');
  assert.deepEqual(fs.readFileSync(target),old);
});
test('partial backup creation error preserves target and is not labelled a verified backup',t=>{
  const {dir,target,old,expected}=fixture(t);let backupFd;
  const io={...fs,openSync(p,...args){const fd=fs.openSync(p,...args);if(String(p).includes('.dcad-backup-incomplete-'))backupFd=fd;return fd;},
    writeSync(fd,buffer,offset,length,position){if(fd===backupFd){fs.writeSync(fd,buffer,offset,Math.min(3,length),position);const e=new Error('injected');e.code='ENOSPC';throw e;}return fs.writeSync(fd,buffer,offset,length,position);}};
  for(let i=0;i<3;i++){
    assert.throws(()=>writeAtomic(target,'new',{expected,io}),e=>e.code==='ENOSPC'&&!e.backupPath);
    assert.deepEqual(fs.readFileSync(target),old);
    assert.equal(fs.readdirSync(dir).filter(n=>n.includes('.dcad-backup-incomplete-')).length,0);
  }
});
test('failed partial-backup cleanup reports its path and preserves the original target',t=>{
  const {dir,target,old,expected}=fixture(t);let backupFd;
  const io={...fs,openSync(p,...args){const fd=fs.openSync(p,...args);if(String(p).includes('.dcad-backup-incomplete-'))backupFd=fd;return fd;},
    writeSync(fd,buffer,offset,length,position){if(fd===backupFd){fs.writeSync(fd,buffer,offset,Math.min(3,length),position);const e=new Error('injected');e.code='ENOSPC';throw e;}return fs.writeSync(fd,buffer,offset,length,position);},
    unlinkSync(p){if(String(p).includes('.dcad-backup-incomplete-')){const e=new Error('cleanup denied');e.code='EACCES';throw e;}return fs.unlinkSync(p);}};
  let failure;try{writeAtomic(target,'new',{expected,io});}catch(e){failure=e;}
  assert.equal(failure.code,'ENOSPC');assert.match(failure.message,/불완전 임시 백업/);
  assert.ok(failure.incompleteBackupPath);assert.ok(fs.existsSync(failure.incompleteBackupPath));
  assert.deepEqual(fs.readFileSync(target),old);assert.equal(fs.readdirSync(dir).filter(n=>n.includes('.dcad-backup-incomplete-')).length,1);
});
test('replacement permission failure preserves target and a verified previous version',t=>{
  const {target,old,expected}=fixture(t);
  const io={...fs,renameSync(a,b){if(b===target){const e=new Error('injected');e.code='EACCES';throw e;}return fs.renameSync(a,b);}};
  let failure;try{writeAtomic(target,'new',{expected,io});}catch(e){failure=e;}
  assert.equal(failure.code,'EACCES');assert.deepEqual(fs.readFileSync(target),old);
  assert.ok(failure.backupPath);assert.deepEqual(fs.readFileSync(failure.backupPath),old);
});
test('successful replacement retains exact prior bytes and verifies new bytes',t=>{
  const {target,old,expected}=fixture(t);const saved=writeAtomic(target,'new synthetic',{expected});
  assert.equal(fs.readFileSync(target,'utf8'),'new synthetic');assert.deepEqual(fs.readFileSync(saved.backupPath),old);
  assert.deepEqual(fingerprint(target),saved.fingerprint);
});
test('known external modification is rejected without overwrite',t=>{
  const {target,expected}=fixture(t);fs.writeFileSync(target,'outside synthetic change');
  assert.throws(()=>writeAtomic(target,'new',{expected}),e=>e.code==='EEXTERNAL');
  assert.equal(fs.readFileSync(target,'utf8'),'outside synthetic change');
});
test('newly created destination after nonexistence check is not overwritten',t=>{
  const {dir}=fixture(t);const target=path.join(dir,'created.dcad.json');const expected=fingerprint(target);
  assert.equal(expected,null);fs.writeFileSync(target,'created externally');
  assert.throws(()=>writeAtomic(target,'new',{expected}),e=>e.code==='EEXTERNAL');
  assert.equal(fs.readFileSync(target,'utf8'),'created externally');
});
test('change during backup is detected before replacement',t=>{
  const {target,old,expected}=fixture(t);let sourceFd,changed=false;
  const io={...fs,openSync(p,...args){const fd=fs.openSync(p,...args);if(p===target&&args[0]==='r')sourceFd=fd;return fd;},
    readSync(fd,...args){const n=fs.readSync(fd,...args);if(fd===sourceFd&&!changed){changed=true;fs.writeFileSync(target,'concurrent synthetic change');}return n;}};
  assert.throws(()=>writeAtomic(target,'new',{expected,io}),e=>e.code==='EEXTERNAL'&&!!e.backupPath);
  assert.equal(fs.readFileSync(target,'utf8'),'concurrent synthetic change');
  assert.notDeepEqual(fs.readFileSync(target),old);
});
