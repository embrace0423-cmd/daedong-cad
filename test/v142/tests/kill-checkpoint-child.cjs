'use strict';
// Test-only I/O wrapper around the unchanged product module. Wait for parent kill.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [modulePath,target,stage]=process.argv.slice(2);
const allowed=new Set(['temp-flushed','backup-flushed','backup-published','target-replaced']);
if(!allowed.has(stage))throw Error('Unexpected checkpoint');
const product=require(modulePath),newBytes=Buffer.from('synthetic new document after durable store checkpoints\n');
const fds=new Map();let checkpointReached=false;
function checkpoint(name){if(name!==stage)return;checkpointReached=true;fs.writeSync(1,JSON.stringify({pid:process.pid,checkpoint:name,moduleSha256:crypto.createHash('sha256').update(fs.readFileSync(modulePath)).digest('hex'),target:path.resolve(target)})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);throw Error('Checkpoint unexpectedly resumed');}
const io={...fs,openSync(p,...args){const fd=fs.openSync(p,...args);fds.set(fd,String(p));return fd;},closeSync(fd){fds.delete(fd);return fs.closeSync(fd);},
 fsyncSync(fd){fs.fsyncSync(fd);const p=fds.get(fd)||'';if(p.includes('.dcad-tmp-'))checkpoint('temp-flushed');if(p.includes('.dcad-backup-incomplete-'))checkpoint('backup-flushed');},
 renameSync(a,b){fs.renameSync(a,b);if(String(a).includes('.dcad-backup-incomplete-'))checkpoint('backup-published');if(path.resolve(b)===path.resolve(target))checkpoint('target-replaced');}};
product.writeAtomic(target,newBytes,{expected:product.fingerprint(target),io});
throw Error('Expected checkpoint not reached: '+checkpointReached);
