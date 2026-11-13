'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'), html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const oracleSource=fs.readFileSync(path.join(__dirname,'reference-contract-scoped.mjs'),'utf8');
const a=oracleSource.indexOf('function dxfRecords(text)'),b=oracleSource.indexOf("test('합성 입력",a);
assert.ok(a>=0&&b>a);
const oracle=vm.createContext({assert});
vm.runInContext(oracleSource.slice(a,b)+'\nthis.layers=assertLayerSeparation;this.blocks=assertBlockLinetypeSeparation;this.scoped=scopedDxfRecords;',oracle);
function script(name) {
  const at=html.indexOf('// ---- js/'+name+'.js ----'),start=html.lastIndexOf('<script>',at),end=html.indexOf('</script>',at);
  assert.ok(at>=0&&start>=0&&end>at,name);return html.slice(start+'<script>'.length,end);
}
function runtime() {
  const ctx=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,performance});
  for(const name of ['aci','geom','model','dxf-write','dxf-read'])vm.runInContext(script(name),ctx,{filename:name+'.js'});
  return ctx;
}
function fixture(name){return JSON.parse(fs.readFileSync(path.join(root,'fixtures',name),'utf8'));}
test('actual candidate exporter preserves distinct layer color and memberships',()=>{
  const c=runtime(),d=fixture('baseline.dcad.json'),out=c.DCAD.DXF.write(d);
  oracle.layers(out);
  const reopened=c.DCAD.DXF.read(new TextEncoder().encode(out)).doc;
  assert.equal(reopened.ents.filter(e=>e.type==='line').length,4);
  const lineLayers=reopened.ents.filter(e=>e.type==='line').map(e=>e.layer);
  assert.equal(new Set(lineLayers.map(x=>x.toUpperCase())).size,4);
});
test('actual candidate exporter preserves block geometry and linetype references despite collisions',()=>{
  const c=runtime(),d=fixture('block-linetype-collision.dcad.json'),out=c.DCAD.DXF.write(d);
  oracle.blocks(out);
});
test('long Unicode names stay within 31 characters and avoid split escapes and collisions',()=>{
  const c=runtime(),d=fixture('baseline.dcad.json');
  const names=['한한한한한한한A','한한한한한한한B','한한한한한한한C','한한한한한한한D'];
  d.layers.slice(1).forEach((l,i)=>{l.name=names[i];d.ents[i].layer=names[i];});
  const out=c.DCAD.DXF.write(d),records=oracle.scoped(out);
  const layerNames=records.filter(r=>r.section==='TABLES'&&r.table==='LAYER'&&r.type==='LAYER').map(r=>r.fields.find(x=>x[0]===2)[1]);
  assert.equal(new Set(layerNames.map(n=>n.toUpperCase())).size,layerNames.length);
  for(const n of layerNames){assert.ok(n.length<=31,n);assert.doesNotMatch(n,/\\U\+[0-9A-F]{0,3}(?:_|$)/);}
});
test('stable input yields deterministic encoded names',()=>{
  const c=runtime(),d=fixture('block-linetype-collision.dcad.json');
  assert.equal(c.DCAD.DXF.write(d),c.DCAD.DXF.write(d));
});
