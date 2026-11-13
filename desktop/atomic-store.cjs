'use strict';
// Same-directory staged writes with verified old-file backup. This is not a
// cross-process mandatory lock or a promise of crash durability on every FS.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
function fingerprint(p, io = fs) {
  try {
    const stat = io.statSync(p);
    if (!stat.isFile()) { const e=new Error('저장 대상이 일반 파일이 아닙니다.'); e.code='EINVALIDTARGET'; throw e; }
    const data = io.readFileSync(p);
    return { size: data.length, sha256: digest(data) };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
function equal(a,b) {
  return a===null ? b===null : !!b && a.size===b.size && a.sha256===b.sha256;
}
function conflict() {
  const e=new Error('저장 대상이 외부에서 변경되었습니다. 기존 파일을 확인한 뒤 다른 이름으로 저장하세요.');
  e.code='EEXTERNAL'; return e;
}
function writeAtomic(target, input, options = {}) {
  const io=options.io || fs;
  const bytes=typeof input==='string' ? Buffer.from(input,'utf8') : Buffer.from(input);
  const original=fingerprint(target,io);
  const expected=Object.prototype.hasOwnProperty.call(options,'expected') ? options.expected : original;
  if (!equal(expected,original)) throw conflict();
  const dir=path.dirname(target), base=path.basename(target);
  const unique=crypto.randomBytes(12).toString('hex');
  const temp=path.join(dir,'.'+base+'.dcad-tmp-'+unique);
  let backupPath=null, backupValid=false, fd=null, tempCreated=false;
  let pendingBackup=null, pendingOwned=false, pendingIdentity=null, backupFd=null, sourceFd=null;
  try {
    fd=io.openSync(temp,'wx',0o600);tempCreated=true;
    io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=null;
    if (!equal(fingerprint(temp,io),{size:bytes.length,sha256:digest(bytes)})) {
      const e=new Error('임시 저장 파일 검증에 실패했습니다.');e.code='EVERIFY';throw e;
    }
    if (original !== null) {
      pendingBackup=path.join(dir,'.'+base+'.dcad-backup-incomplete-'+unique);
      backupFd=io.openSync(pendingBackup,'wx',0o600);pendingOwned=true;pendingIdentity=io.fstatSync(backupFd);
      sourceFd=io.openSync(target,'r');
      const chunk=Buffer.allocUnsafe(1024*1024);let count;
      while ((count=io.readSync(sourceFd,chunk,0,chunk.length,null))>0) {
        let written=0;
        while (written<count) {
          const n=io.writeSync(backupFd,chunk,written,count-written,null);
          if (!n) { const e=new Error('이전본 백업 쓰기가 중단됐습니다.');e.code='EWRITE';throw e; }
          written+=n;
        }
      }
      io.closeSync(sourceFd);sourceFd=null;io.fsyncSync(backupFd);io.closeSync(backupFd);backupFd=null;
      if (!equal(fingerprint(pendingBackup,io),original)) throw conflict();
      backupPath=path.join(dir,base+'.dcad-backup-'+unique);
      io.renameSync(pendingBackup,backupPath);pendingOwned=false;backupValid=true;
    }
    if (!equal(fingerprint(target,io),original)) throw conflict();
    io.renameSync(temp,target);tempCreated=false;
    const saved=fingerprint(target,io);
    if (!equal(saved,{size:bytes.length,sha256:digest(bytes)})) {
      const e=new Error('교체 후 저장 파일 검증에 실패했습니다. 이전 백업을 확인하세요.');e.code='EVERIFY';throw e;
    }
    return { fingerprint:saved, backupPath };
  } catch (error) {
    if (fd!==null) { try { io.closeSync(fd); } catch (_) {} }
    if (sourceFd!==null) { try { io.closeSync(sourceFd); } catch (_) {} }
    if (backupFd!==null) { try { io.closeSync(backupFd); } catch (_) {} }
    if (tempCreated) { try { io.unlinkSync(temp); } catch (_) {} }
    if (pendingOwned && pendingBackup) {
      try {
        const current=io.lstatSync(pendingBackup);
        if (!pendingIdentity || !pendingIdentity.ino || current.dev!==pendingIdentity.dev || current.ino!==pendingIdentity.ino) {
          const e=new Error('백업 임시 파일의 소유를 확인할 수 없습니다.');e.code='EIDENTITY';throw e;
        }
        io.unlinkSync(pendingBackup);
      } catch (cleanupError) {
        if (cleanupError.code!=='ENOENT') {
          error.incompleteBackupPath=pendingBackup;
          error.message += ' 불완전 임시 백업을 정리하지 못했습니다. 확인 경로: '+pendingBackup;
        }
      }
    }
    if (backupValid) error.backupPath=backupPath;
    throw error;
  }
}
module.exports={writeAtomic,fingerprint,digest};

