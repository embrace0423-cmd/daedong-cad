'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const project=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const ref=fs.readFileSync(path.join(__dirname,'reference-contract-v3.mjs'),'utf8');
const start=ref.indexOf('function dxfRecords(text)'), end=ref.indexOf('// For the axis-aligned',start);
assert.ok(start>=0 && end>start);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const oracle=vm.createContext({assert,near});
vm.runInContext(ref.slice(start,end)+'\nthis.check=assertBlockLinetypeSeparation;',oracle);
function script(name) {
  const at=html.indexOf('// ---- js/'+name+'.js ----'), a=html.lastIndexOf('<script>',at), b=html.indexOf('</script>',at);
  assert.ok(at>=0 && a>=0 && b>at); return html.slice(a+8,b);
}
test('candidate DXF preserves fixture block endpoints, bases, INSERT transforms and linetypes',()=>{
  const c=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,performance});
  for(const name of ['aci','geom','model','dxf-write']) vm.runInContext(script(name),c);
  const input=JSON.parse(fs.readFileSync(path.join(project,'fixtures/block-linetype-collision.dcad.json'),'utf8'));
  oracle.check(c.DCAD.DXF.write(input));
});
