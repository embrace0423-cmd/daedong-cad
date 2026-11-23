'use strict';
// Extra release coverage on synthetic files. No GUI or production data is touched.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const run=path.join(root,'verification/extra-validation','data-'+new Date().toISOString().replace(/[^0-9]/g,''));
fs.mkdirSync(run,{recursive:true});
const store=require('../src/atomic-store.cjs'),safety=require('../src/app/safety.js');
const html=fs.readFileSync(path.join(root,'src/app/daedong-cad.html'),'utf8'),main=fs.readFileSync(path.join(root,'src/main.js'),'utf8');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const results=[];
function save(name,value){fs.writeFileSync(path.join(run,name),JSON.stringify(value,null,2)+'\n');}
async function check(name,kind,fn){try{const detail=await fn();results.push({name,kind,status:'pass',detail:detail||{}});}catch(e){results.push({name,kind,status:'fail',error:e.stack});throw e;}finally{save('results.json',{source:{htmlSha256:hash(Buffer.from(html)),mainSha256:hash(Buffer.from(main)),atomicSha256:hash(fs.readFileSync(path.join(root,'src/atomic-store.cjs')))},results});if(global.gc)global.gc();}}
function script(n){const at=html.indexOf('// ---- js/'+n+'.js ----'),a=html.lastIndexOf('<script>',at),b=html.indexOf('</script>',at);assert.ok(at>=0&&a>=0&&b>at);return html.slice(a+8,b);}
function runtime(){const c=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,performance});for(const n of ['aci','geom','model','hatch','dxf-write','dxf-read'])vm.runInContext(script(n),c);return c;}
function boundedReader(){const a=main.indexOf('function readBoundedWork('),b=main.indexOf('function readDoc(',a);assert.ok(a>=0&&b>a);const c=vm.createContext({fs,Buffer,MAX_WORK_BYTES:safety.MAX_WORK_BYTES});vm.runInContext(main.slice(a,b)+'\nthis.reader=readBoundedWork;',c);return c.reader;}
function pairRecords(text){const lines=text.trimEnd().split(/\r\n|\n/);assert.equal(lines.length%2,0);const out=[];let r;for(let i=0;i<lines.length;i+=2){const code=Number(lines[i].trim()),value=lines[i+1].trim();assert.ok(Number.isInteger(code));if(code===0){r={type:value,tags:[]};out.push(r);}else if(r)r.tags.push([code,value]);}return out;}
function val(r,k){return r.tags.find(p=>p[0]===k)?.[1];}
function fixture(name){return JSON.parse(fs.readFileSync(path.join(root,'fixtures',name),'utf8'));}
function basic(){const c=runtime(),d=c.DCAD.Model.newDoc();d.name='synthetic-extra';return {c,d};}

(async()=>{
 await check('real-work-file-exact-64MiB-read-and-save','real file I/O; extracted reader and actual atomic module',()=>{
  const input=path.join(run,'exact-limit.dcad.json'),target=path.join(run,'exact-limit-saved.dcad.json');
  const d=fixture('baseline.dcad.json');d.syntheticPadding='';const raw=JSON.stringify(d),cut=raw.lastIndexOf('"}');assert.ok(cut>0);
  const fd=fs.openSync(input,'wx');try{fs.writeSync(fd,raw.slice(0,cut));let n=safety.MAX_WORK_BYTES-Buffer.byteLength(raw);const block=Buffer.alloc(1024*1024,32);while(n){const count=Math.min(n,block.length);fs.writeSync(fd,block,0,count);n-=count;}fs.writeSync(fd,raw.slice(cut));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  assert.equal(fs.statSync(input).size,safety.MAX_WORK_BYTES);
  const bytes=boundedReader()(input);safety.validateWorkSize(bytes.length);safety.validateWork(JSON.parse(bytes.toString('utf8')));
  fs.writeFileSync(target,'synthetic previous bytes');const old=fs.readFileSync(target),saved=store.writeAtomic(target,bytes,{expected:store.fingerprint(target)});
  assert.equal(saved.fingerprint.size,safety.MAX_WORK_BYTES);assert.equal(saved.fingerprint.sha256,hash(bytes));assert.deepEqual(fs.readFileSync(saved.backupPath),old);
  return {bytes:bytes.length,newSha256:saved.fingerprint.sha256,oldBackupSha256:hash(old),file:path.basename(target)};
 });
 await check('real-work-file-64MiB-plus-one-rejected','real file stat/read failure boundary',()=>{
  const p=path.join(run,'one-byte-over.dcad.json');const fd=fs.openSync(p,'wx');try{fs.ftruncateSync(fd,safety.MAX_WORK_BYTES+1);}finally{fs.closeSync(fd);}
  assert.throws(()=>boundedReader()(p),e=>e.code==='EWORKTOOLARGE');assert.equal(fs.statSync(p).size,safety.MAX_WORK_BYTES+1);
  return {bytes:fs.statSync(p).size,result:'EWORKTOOLARGE; unchanged file'};
 });
 await check('save-IPC-refuses-actual-oversize-buffer-before-dialog-or-write','real 64MiB+1 buffer; extracted IPC handler with dialog/write spies',async()=>{
  const a=main.indexOf("ipcMain.handle('dcad:save'"),b=main.indexOf("ipcMain.handle('dcad:pdf'",a);assert.ok(a>=0&&b>a);
  let handler,called=0;const c=vm.createContext({ipcMain:{handle(n,f){handler=f;}},path,Buffer,ArrayBuffer,MAX_WORK_BYTES:safety.MAX_WORK_BYTES,askSavePath(){called++;},writeOut(){called++;}});
  vm.runInContext(main.slice(a,b),c);await assert.rejects(handler({}, {kind:'work',data:Buffer.alloc(safety.MAX_WORK_BYTES+1)}),e=>e.code==='EWORKTOOLARGE');assert.equal(called,0);return {bytes:safety.MAX_WORK_BYTES+1,downstreamCalls:called};
 });
 for(const stage of ['temp-fsync','backup-fsync','backup-zero-write','target-rename'])await check('injected-storage-error-'+stage,'real synthetic files; injected EIO/ENOSPC/EWRITE/EPERM',()=>{
  const dir=path.join(run,stage);fs.mkdirSync(dir);const target=path.join(dir,'work.dcad.json'),old=Buffer.from('synthetic-original-'+stage);fs.writeFileSync(target,old);
  const descriptors=new Map();let injected=false;
  const io={...fs,openSync(p,...args){const fd=fs.openSync(p,...args);descriptors.set(fd,String(p));return fd;},closeSync(fd){descriptors.delete(fd);return fs.closeSync(fd);},
   fsyncSync(fd){const p=descriptors.get(fd)||'';if((stage==='temp-fsync'&&p.includes('.dcad-tmp-'))||(stage==='backup-fsync'&&p.includes('.dcad-backup-incomplete-'))){injected=true;const e=Error('synthetic flush failure');e.code=stage==='temp-fsync'?'EIO':'ENOSPC';throw e;}return fs.fsyncSync(fd);},
   writeSync(fd,...args){if(stage==='backup-zero-write'&&(descriptors.get(fd)||'').includes('.dcad-backup-incomplete-')){injected=true;return 0;}return fs.writeSync(fd,...args);},
   renameSync(a,b){if(stage==='target-rename'&&b===target){injected=true;const e=Error('synthetic replace failure');e.code='EPERM';throw e;}return fs.renameSync(a,b);}};
  let error;try{store.writeAtomic(target,'synthetic-new',{expected:store.fingerprint(target),io});}catch(e){error=e;}
  assert.ok(error&&injected);assert.deepEqual(fs.readFileSync(target),old);const leftovers=fs.readdirSync(dir).filter(n=>n.includes('.dcad-tmp-')||n.includes('.dcad-backup-incomplete-'));assert.deepEqual(leftovers,[]);
  if(stage==='target-rename'){assert.ok(error.backupPath);assert.deepEqual(fs.readFileSync(error.backupPath),old);}else assert.ok(!error.backupPath);
  return {error:error.code,originalSha256:hash(old),leftoverTemporaryFiles:leftovers,verifiedBackup:!!error.backupPath};
 });
 await check('DXF-core-geometry-layer-flags-and-bulge','actual in-process reader/writer; independent group-code assertions',()=>{
  const {c,d}=basic();d.layers[0]={name:'0',color:3,ltype:'CONTINUOUS',visible:false,locked:true};d.layers.push({name:'SURVEY',color:2,ltype:'CUSTOM',visible:true,locked:false});d.ltypes.CUSTOM={pat:[2,-1],desc:'custom'};
  d.ents=[{id:1,type:'line',layer:'SURVEY',a:{x:-12.5,y:9},b:{x:88.25,y:-7},ltype:'CUSTOM',color:4},{id:2,type:'circle',layer:'SURVEY',c:{x:10,y:20},r:3.25},{id:3,type:'arc',layer:'SURVEY',c:{x:30,y:40},r:4,a0:Math.PI/6,a1:Math.PI*1.5},{id:4,type:'poly',layer:'SURVEY',closed:true,pts:[{x:0,y:0,bulge:0.5},{x:10,y:0},{x:10,y:10}]}];d.nextId=5;safety.validateWork(d);
  const out=c.DCAD.DXF.write(d);fs.writeFileSync(path.join(run,'core-geometry.dxf'),out);const records=pairRecords(out),layer=records.find(r=>r.type==='LAYER'&&val(r,2)==='0');assert.equal(val(layer,62),'-3');assert.equal(val(layer,70),'4');
  const circle=records.find(r=>r.type==='CIRCLE'),arc=records.find(r=>r.type==='ARC');near(+val(circle,10),10);near(+val(circle,20),20);near(+val(circle,40),3.25);near(+val(arc,50),30);near(+val(arc,51),270);
  const read=c.DCAD.DXF.read(Buffer.from(out));safety.validateWork(read.doc);assert.deepEqual(JSON.parse(JSON.stringify(read.doc.layers.find(l=>l.name==='0'))),{name:'0',color:3,ltype:'CONTINUOUS',visible:false,locked:true});const line=read.doc.ents.find(e=>e.type==='line');near(line.a.x,-12.5);near(line.b.y,-7);assert.equal(line.color,4);assert.equal(line.ltype,'CUSTOM');near(read.doc.ents.find(e=>e.type==='poly').pts[0].bulge,0.5);return {entities:4,layer0HiddenLocked:true,customPattern:[...read.doc.ltypes.CUSTOM.pat],reportedUnit:read.report.insunits??'unspecified-R12'};
 });
 await check('DXF-nested-block-base-rotation-and-mirror','actual reader/writer; manual endpoint oracle',()=>{
  const {c,d}=basic();d.blocks={INNER:{name:'INNER',base:{x:1,y:2},ents:[{id:1,type:'line',layer:'0',a:{x:1,y:2},b:{x:4,y:2}}]},OUTER:{name:'OUTER',base:{x:2,y:1},ents:[{id:2,type:'insert',layer:'0',name:'INNER',p:{x:5,y:1},sx:2,sy:1,rot:Math.PI/2}]}};
  d.ents=[{id:3,type:'insert',layer:'0',name:'OUTER',p:{x:10,y:20},sx:-1,sy:3,rot:Math.PI/2}];d.nextId=4;safety.validateWork(d);
  // Inner endpoints after its base removal/scale/rotation/translation: (5,1),(5,7).
  // Outer removes (2,1), mirrors x, scales y3, rotates90deg, adds(10,20): (10,17),(-8,17).
  const out=c.DCAD.DXF.write(d);fs.writeFileSync(path.join(run,'nested-mirror.dxf'),out);const r=c.DCAD.DXF.read(Buffer.from(out));safety.validateWork(r.doc);const prim=c.DCAD.Model.prims(r.doc.ents[0],r.doc).find(p=>p.k==='L');assert.ok(prim);near(prim.a.x,10);near(prim.a.y,17);near(prim.b.x,-8);near(prim.b.y,17);return {endpoints:[prim.a,prim.b]};
 });
 await check('DXF-inch-conversion-circle-poly-text-and-block','actual unit conversion; fixed numeric oracle',()=>{
  const {c,d}=basic();d.ents=[{id:1,type:'circle',layer:'0',c:{x:2,y:-1},r:0.5},{id:2,type:'poly',layer:'0',pts:[{x:0,y:0,bulge:1},{x:1,y:1}],closed:false},{id:3,type:'text',layer:'0',p:{x:1,y:2},h:0.125,s:'inch',rot:0}];d.nextId=4;
  const out=c.DCAD.DXF.write(d).replace('  9\r\n$ACADVER','  9\r\n$INSUNITS\r\n 70\r\n1\r\n  9\r\n$ACADVER');const r=c.DCAD.DXF.read(Buffer.from(out));assert.equal(r.report.insunits,1);safety.convertDxfUnits(r.doc,'inch',r.report,c.DCAD.Model,c.DCAD.G);safety.validateWork(r.doc);const circle=r.doc.ents.find(e=>e.type==='circle'),poly=r.doc.ents.find(e=>e.type==='poly'),text=r.doc.ents.find(e=>e.type==='text');near(circle.c.x,50.8);near(circle.c.y,-25.4);near(circle.r,12.7);near(poly.pts[1].x,25.4);near(poly.pts[0].bulge,1);near(text.h,3.175);return {circleRadiusMm:circle.r,textHeightMm:text.h,bulgeUnchanged:poly.pts[0].bulge};
 });
 await check('DXF-losses-dimension-image-ellipse-mtext-hatch','actual conversion and loss count; work image bytes retained',()=>{
  const {c}=basic(),d=fixture('image-and-dimension.dcad.json');d.ents.push({id:7,type:'ellipse',layer:'0',c:{x:50,y:50},major:{x:8,y:0},ratio:0.5,t0:0,t1:2*Math.PI},{id:8,type:'mtext',layer:'0',p:{x:0,y:30},h:2,s:'alpha\nbeta',attach:1,rot:0},{id:9,type:'hatch',layer:'0',loops:[[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]],solid:true,pat:'SOLID',scale:1,ang:0,fams:[]});d.nextId=10;safety.validateWork(d);
  const old=JSON.stringify(d);const losses=safety.dxfLosses(d);for(const k of ['imagesOmitted','dimensionsConverted','ellipsesConverted','multilineTextConverted','hatchesConverted'])assert.equal(losses[k],1);const out=c.DCAD.DXF.write(d);assert.equal(JSON.stringify(d),old);fs.writeFileSync(path.join(run,'loss-matrix.dxf'),out);fs.writeFileSync(path.join(run,'loss-matrix.dcad.json'),old);const records=pairRecords(out);assert.ok(!records.some(r=>['IMAGE','DIMENSION','ELLIPSE','MTEXT','HATCH'].includes(r.type)));assert.ok(records.some(r=>r.type==='SOLID'));const texts=records.filter(r=>r.type==='TEXT').map(r=>val(r,1));assert.ok(texts.includes('100')&&texts.includes('alpha')&&texts.includes('beta'));const r=c.DCAD.DXF.read(Buffer.from(out));safety.validateWork(r.doc);const ellipse=r.doc.ents.find(e=>e.type==='poly'&&e.pts.length===72);assert.ok(ellipse&&ellipse.closed);for(const p of ellipse.pts)near(((p.x-50)/8)**2+((p.y-50)/4)**2,1,2e-6);return {losses,dimensionText:'100',ellipseVertices:72,originalImageHash:hash(Buffer.from(d.images['synthetic-image']))};
 });
 save('summary.json',{status:'pass',cases:results.length,runDirectory:run,sourceUnchangedDuringRun:hash(fs.readFileSync(path.join(root,'src/app/daedong-cad.html')))===hash(Buffer.from(html)),limits:['UI, external CAD and hardware power loss not exercised here','Error injection is not an actually full disk','R12 export intentionally approximates/omits advertised entity classes']});
 console.log(JSON.stringify({status:'pass',cases:results.length,runDirectory:run}));
})().catch(e=>{console.error(e.stack);console.log(JSON.stringify({status:'fail',runDirectory:run}));process.exitCode=1;});
