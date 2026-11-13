'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../src/app/daedong-cad.html'),'utf8');
const Safety=require('../src/app/safety.js'), fixtures=path.resolve(__dirname,'../fixtures');
function script(name){const at=html.indexOf('// ---- js/'+name+'.js ----'),a=html.lastIndexOf('<script>',at),b=html.indexOf('</script>',at);assert.ok(at>=0&&a>=0&&b>at);return html.slice(a+8,b);}
function runtime(){const c=vm.createContext({console,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,performance});for(const n of ['aci','geom','model','dxf-read'])vm.runInContext(script(n),c);return c;}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);
const reference=fs.readFileSync(path.join(__dirname,'reference-contract-v2.mjs'),'utf8');
const oa=reference.indexOf('function assertConvertedSquare(lines) {'),ob=reference.indexOf("test('합성 입력",oa);
assert.ok(oa>=0&&ob>oa);const oracle=vm.createContext({assert,near});
vm.runInContext(reference.slice(oa,ob)+'\nthis.square=assertConvertedSquare;',oracle);
test('actual DXF reader and conversion preserve 1 inch square as 25.4mm and 645.16mm²',()=>{
 const c=runtime(),r=c.DCAD.DXF.read(fs.readFileSync(path.join(fixtures,'square-one-inch.dxf')));
 assert.equal(r.report.insunits,1);Safety.convertDxfUnits(r.doc,'inch',r.report,c.DCAD.Model,c.DCAD.G);
 Safety.validateWork(r.doc);
 const lines=r.doc.ents.filter(e=>e.type==='line');oracle.square(lines);assert.equal(r.report.outputUnit,'mm');
});
test('square oracle rejects a degenerate diagonal even if its bounding box is correct',()=>{
 const bad=Array.from({length:4},()=>({a:{x:0,y:0},b:{x:25.4,y:25.4}}));
 assert.throws(()=>oracle.square(bad));
});
test('mm data is unchanged and unknown decision is rejected',()=>{
 const c=runtime(),r=c.DCAD.DXF.read(fs.readFileSync(path.join(fixtures,'square-unit-unknown.dxf')));
 const before=JSON.stringify(r.doc);Safety.convertDxfUnits(r.doc,'mm',r.report,c.DCAD.Model,c.DCAD.G);
 assert.equal(JSON.stringify(r.doc),before);assert.throws(()=>Safety.convertDxfUnits(r.doc,'unknown',r.report,c.DCAD.Model,c.DCAD.G));
});
test('nested block geometry and insertion are scaled once, preserving dimensionless insert scale',()=>{
 const c=runtime(),d=c.DCAD.Model.newDoc();
 d.blocks={ B:{name:'B',base:{x:1,y:0},ents:[{id:1,type:'line',layer:'0',a:{x:1,y:0},b:{x:2,y:0}}]},
            A:{name:'A',base:{x:0,y:0},ents:[{id:2,type:'insert',layer:'0',name:'B',p:{x:2,y:0},sx:2,sy:2,rot:0}]} };
 d.ents=[{id:3,type:'insert',layer:'0',name:'A',p:{x:5,y:0},sx:3,sy:3,rot:0}];d.nextId=4;
 const before=c.DCAD.Model.prims(d.ents[0],d).find(x=>x.k==='L');
 const lengthBefore=Math.hypot(before.b.x-before.a.x,before.b.y-before.a.y);
 Safety.convertDxfUnits(d,'inch',{importedLtypes:[],textSizeExplicit:false},c.DCAD.Model,c.DCAD.G);
 const after=c.DCAD.Model.prims(d.ents[0],d).find(x=>x.k==='L');
 near(Math.hypot(after.b.x-after.a.x,after.b.y-after.a.y),lengthBefore*25.4);
 assert.equal(d.ents[0].sx,3);assert.equal(d.blocks.A.ents[0].sx,2);
});
test('only explicitly imported linetypes and explicit text size are scaled',()=>{
 const c=runtime(),d=c.DCAD.Model.newDoc();
 d.ltypes.CUSTOM={pat:[1,-0.5],desc:'custom'};const defaultPattern=JSON.stringify(d.ltypes.DASHED.pat);
 d.settings.textH=1;Safety.convertDxfUnits(d,'inch',{importedLtypes:['CUSTOM'],textSizeExplicit:true},c.DCAD.Model,c.DCAD.G);
 near(d.ltypes.CUSTOM.pat[0],25.4);near(d.ltypes.CUSTOM.pat[1],-12.7);
 assert.equal(JSON.stringify(d.ltypes.DASHED.pat),defaultPattern);near(d.settings.textH,25.4);
});
test('unsupported unit code rejects and unknown selection can be cancelled',async()=>{
 const a=html.indexOf('  function chooseDxfUnit(report) {'),b=html.indexOf('  function openRecoveryArchive()',a);assert.ok(a>=0&&b>a);
 const c=vm.createContext({Promise,Desk:{chooseUnits:async()=> 'cancel'},g:{confirm:()=>false}});
 vm.runInContext(html.slice(a,b),c);
 await assert.rejects(c.chooseDxfUnit({insunits:2}),/지원하지 않습니다/);
 assert.equal(await c.chooseDxfUnit({insunits:0}),'cancel');assert.equal(await c.chooseDxfUnit({insunits:4}),'mm');
});
