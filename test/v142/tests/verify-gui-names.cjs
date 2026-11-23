'use strict';
// Read an actual GUI-produced synthetic DXF with two independent fixture oracles.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const file=process.argv[2];if(!file)throw new Error('Synthetic DXF path required');
function load(ref,finalMarker,extra) {
  const source=fs.readFileSync(path.join(__dirname,ref),'utf8');
  const a=source.indexOf('function dxfRecords(text)'),b=source.indexOf(finalMarker,a);
  assert.ok(a>=0&&b>a);
  const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-7,`${x} != ${y}`);
  const ctx=vm.createContext({assert,near});vm.runInContext(source.slice(a,b)+'\n'+extra,ctx);return ctx;
}
const scoped=load('reference-contract-scoped.mjs',"test('합성 입력",'this.check=assertLayerSeparation;');
const revised=load('reference-contract-v3.mjs','// For the axis-aligned','this.check=assertBlockLinetypeSeparation;');
const data=fs.readFileSync(file),text=data.toString('utf8');scoped.check(text);revised.check(text);
console.log(JSON.stringify({file,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),
  layers:'fixture layer names, colors and membership verified',blocks:'fixture geometry, bases, inserts and linetypes verified',
  scope:'synthetic DXF output from GUI; not general external CAD interoperability'}));
