'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
function part(start,end){const a=main.indexOf(start),b=main.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return main.slice(a,b);}
function setup(){
 const handlers={},sent=[],dialogs=[],events={};let closed=0;
 class Window {
   constructor(options){this.options=options;this.webContents={on(){},setWindowOpenHandler(){},send:(...v)=>sent.push(v)};}
   once(){} on(name,fn){events[name]=fn;} loadFile(){} close(){closed++;}
 }
 const ctx=vm.createContext({ipcMain:{on:(name,fn)=>handlers[name]=fn},win:null,dirty:true,
   pendingRecoveryClose:null,currentStamp:null,allowClose:false,crypto,Buffer,path,process:{env:{DCAD_NO_MAXIMIZE:'1'}},
   BrowserWindow:Window,app:{getVersion:()=> '1.4.1'},__dirname:'synthetic',PAGE:'synthetic',
   dialog:{showMessageBoxSync:()=>1,showMessageBox:(w,o)=>{dialogs.push(o);return Promise.resolve({response:0});}}});
 vm.runInContext(part("ipcMain.on('dcad:dirty'",'\nfunction createWindow() {')+
   part('function createWindow() {','\nif (!app.requestSingleInstanceLock())'),ctx);
 ctx.createWindow();
 const e={sender:ctx.win.webContents},closeEvent={preventDefault(){this.prevented=true;}};
 handlers['dcad:dirty'](e,{dirty:true,sessionId:4,revision:9});events.close(closeEvent);
 return {ctx,e,handlers,sent,dialogs,getClosed:()=>closed,closeEvent};
}
test('discard request starts recovery save rather than immediately closing',()=>{
 const s=setup();assert.equal(s.closeEvent.prevented,true);assert.equal(s.getClosed(),0);
 assert.equal(s.ctx.win.options.title,'대동 CAD 1.4.1');
 assert.equal(s.sent[0][0],'dcad:recovery-close');assert.ok(s.sent[0][1]);
});
test('failed recovery write keeps window open and reports error',()=>{
 const s=setup(),token=s.sent[0][1];
 s.handlers['dcad:recovery-close-result'](s.e,{token,ok:false,sessionId:4,revision:9});
 assert.equal(s.getClosed(),0);assert.equal(s.sent.at(-1)[0],'dcad:recovery-close-cancelled');assert.equal(s.dialogs.length,1);
});
test('stale revision keeps window open',()=>{
 const s=setup(),token=s.sent[0][1];
 s.handlers['dcad:dirty'](s.e,{dirty:true,sessionId:4,revision:10});
 s.handlers['dcad:recovery-close-result'](s.e,{token,ok:true,sessionId:4,revision:9});
 assert.equal(s.getClosed(),0);assert.equal(s.dialogs.length,1);
});
test('successful matching recovery write allows close',()=>{
 const s=setup(),token=s.sent[0][1];
 s.handlers['dcad:recovery-close-result'](s.e,{token,ok:true,sessionId:4,revision:9});
 assert.equal(s.getClosed(),1);assert.equal(s.dialogs.length,0);
});
