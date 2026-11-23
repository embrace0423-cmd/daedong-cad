"""Terminate only four directly created, instrumented synthetic Node children.

The operating-system child termination is real. Stage placement is test-only I/O
instrumentation, not a physical power loss or the production Electron UI.
"""
import ctypes
from ctypes import wintypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import threading

ROOT=Path(__file__).resolve().parent.parent
NODE=ROOT.parents[1]/'.build-tools/rea/runtime/node_modules/node-win-x64/bin/node.exe'
MODULE=ROOT/'src/atomic-store.cjs'
CHILD=ROOT/'tests/kill-checkpoint-child.cjs'
RUN=ROOT/'verification/extra-validation'/('kill-'+datetime.datetime.now().strftime('%Y%m%dT%H%M%S%f'))
RUN.mkdir(parents=True,exist_ok=False)
OLD=b'synthetic original document before checkpoint\n'
NEW=b'synthetic new document after durable store checkpoints\n'
def sha(p):
    with p.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def save(p,obj):p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def identify(proc):
    assert os.name=='nt'
    k=ctypes.WinDLL('kernel32',use_last_error=True)
    k.QueryFullProcessImageNameW.argtypes=[wintypes.HANDLE,wintypes.DWORD,wintypes.LPWSTR,ctypes.POINTER(wintypes.DWORD)]
    k.QueryFullProcessImageNameW.restype=wintypes.BOOL
    k.GetProcessTimes.argtypes=[wintypes.HANDLE,*([ctypes.POINTER(wintypes.FILETIME)]*4)]
    k.GetProcessTimes.restype=wintypes.BOOL
    buf=ctypes.create_unicode_buffer(32768);size=wintypes.DWORD(len(buf))
    assert k.QueryFullProcessImageNameW(int(proc._handle),0,buf,ctypes.byref(size))
    assert os.path.normcase(buf.value)==os.path.normcase(str(NODE.resolve()))
    created,exited,kernel,user=[wintypes.FILETIME() for _ in range(4)]
    assert k.GetProcessTimes(int(proc._handle),ctypes.byref(created),ctypes.byref(exited),ctypes.byref(kernel),ctypes.byref(user))
    return {'pid':proc.pid,'image':buf.value,'creationTime100nsSince1601':(created.dwHighDateTime<<32)|created.dwLowDateTime}

results=[]
for stage in ['temp-flushed','backup-flushed','backup-published','target-replaced']:
    case=RUN/stage;case.mkdir();target=case/'drawing.dcad.json';target.write_bytes(OLD)
    args=[str(NODE),str(CHILD),str(MODULE),str(target),stage]
    stderr=(case/'child-stderr.log').open('wb')
    proc=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=stderr,cwd=ROOT,creationflags=subprocess.CREATE_NO_WINDOW)
    identity=identify(proc)
    started={'sourceSha256':sha(MODULE),'childSha256':sha(CHILD),'nodeSha256':sha(NODE),'command':args,'process':identity,'terminationAuthorized':'root approved directly spawned synthetic child only','checkpointInstrumentation':True}
    save(case/'launch.json',started)
    received=queue.Queue()
    threading.Thread(target=lambda:received.put(proc.stdout.readline()),daemon=True).start()
    try:
        line=received.get(timeout=30)
        checkpoint=json.loads(line)
        assert checkpoint['pid']==proc.pid and checkpoint['checkpoint']==stage and checkpoint['moduleSha256']==started['sourceSha256']
        assert Path(checkpoint['target']).resolve()==target.resolve()
        assert proc.poll() is None and identify(proc)==identity
        save(case/'checkpoint.json',checkpoint)
        proc.kill()  # uses this Popen process handle; no global PID/name matching.
        code=proc.wait(timeout=10)
        stderr.close()
        inventory=[]
        for p in sorted(case.iterdir()):
            if p.name=='drawing.dcad.json' or '.dcad-' in p.name:
                inventory.append({'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)})
        content=target.read_bytes()
        expected=NEW if stage=='target-replaced' else OLD
        assert content==expected
        backups=list(case.glob('*.dcad-backup-*'))
        completed=[p for p in backups if '.dcad-backup-incomplete-' not in p.name]
        if stage in ('backup-published','target-replaced'):
            assert len(completed)==1 and completed[0].read_bytes()==OLD
        else:assert not completed
        if stage=='target-replaced':assert not list(case.glob('*.dcad-tmp-*'))
        row={'stage':stage,'status':'pass','exitCode':code,'originalOrNewWholeFile':content==expected,'publishedBackupCount':len(completed),'filesAfterTermination':inventory,'realOSChildTermination':True,'powerLossTest':False}
        save(case/'result.json',row);results.append(row)
    except BaseException:
        # Only our still-owned child may be ended to avoid leaving the deliberate wait.
        if proc.poll() is None:
            assert identify(proc)==identity
            proc.kill();proc.wait(timeout=10)
        stderr.close()
        raise
assert sha(MODULE)==started['sourceSha256']
summary={'status':'pass','cases':len(results),'runDirectory':str(RUN),'productModuleSha256':sha(MODULE),'results':results,'limits':['real owned Node child termination at instrumented fs boundaries','not whole-PC power loss, kernel/filesystem crash, GUI process or durability certification','temp/incomplete fragments may remain after process kill; never labelled a verified backup']}
save(RUN/'summary.json',summary)
print(json.dumps({'status':'pass','cases':len(results),'runDirectory':str(RUN)},ensure_ascii=False))
