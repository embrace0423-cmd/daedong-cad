"""Fixed build6 isolated real NSIS/NTFS tests. Never launches product GUI."""
import argparse, ctypes, hashlib, json, os, shutil, subprocess, sys, threading, time, traceback, winreg
from ctypes import wintypes as W
from datetime import datetime, timezone
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

R = Path(__file__).resolve().parent.parent
B = R / 'builds/smoke-build6'
INSTALLER = B / 'DaedongCAD-Setup-1.4.1.exe'
EXPECTED = '2c441f64bc547e4c925140e85ef2218a8ca041a69e4ae3805467feab72855f9f'
MAGIC = 'DaedongCAD-Release-Owned-v1-6aa09747'
KEY = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\com.daedongcad.desktop.release'
PS = r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
K = ctypes.WinDLL('kernel32', use_last_error=True)
K.CreateFileW.argtypes = [W.LPCWSTR,W.DWORD,W.DWORD,W.LPVOID,W.DWORD,W.DWORD,W.HANDLE]
K.CreateFileW.restype = W.HANDLE
K.CloseHandle.argtypes = [W.HANDLE]
K.GetProcessTimes.argtypes = [W.HANDLE,*([ctypes.POINTER(W.FILETIME)]*4)]
K.QueryFullProcessImageNameW.argtypes = [W.HANDLE,W.DWORD,W.LPWSTR,ctypes.POINTER(W.DWORD)]
INVALID = ctypes.c_void_p(-1).value

def need(ok, text):
    if not ok: raise AssertionError(text)

def sha(p):
    with p.open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()

def save(p, value):
    p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def stamp(): return datetime.now(timezone.utc).isoformat()

def inventory(p):
    rows = {}
    if not p.exists(): return rows
    def visit(d):
        for f in sorted(d.iterdir()):
            rel = f.relative_to(p).as_posix()
            st = f.lstat()
            if st.st_file_attributes & 0x400:
                rows[rel] = {'reparse':True,'target':os.readlink(f)}
            elif f.is_dir():
                rows[rel] = {'directory':True}
                visit(f)
            else: rows[rel] = {'bytes':st.st_size,'sha256':sha(f)}
    visit(p)
    return rows

def reg_snapshot():
    result = {}
    for view,flag in [('64',winreg.KEY_WOW64_64KEY),('32',winreg.KEY_WOW64_32KEY)]:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,KEY,0,winreg.KEY_READ|flag) as k:
                values=[]
                i=0
                while True:
                    try: values.append(winreg.EnumValue(k,i)); i+=1
                    except OSError: break
                result[view]=values
        except FileNotFoundError: result[view]=None
    return result

def lock(p):
    # Actual NTFS read handle permits reads but denies write and delete sharing.
    h=K.CreateFileW(str(p),0x80000000,1,None,3,0x80,None)
    need(h!=INVALID, 'lock failed '+str(ctypes.get_last_error())+' '+str(p))
    return h

def process_identity(proc):
    buf=ctypes.create_unicode_buffer(32768); size=W.DWORD(len(buf))
    need(K.QueryFullProcessImageNameW(int(proc._handle),0,buf,ctypes.byref(size)), 'process image query')
    times=[W.FILETIME() for _ in range(4)]
    need(K.GetProcessTimes(int(proc._handle),*[ctypes.byref(t) for t in times]),'process start time query')
    return {'pid':proc.pid,'image':buf.value,'creationFiletime':(times[0].dwHighDateTime<<32)|times[0].dwLowDateTime}

class Suite:
    def __init__(self):
        base=R/'test-runs/installer-validation-20261111'
        base.mkdir(parents=True,exist_ok=True)
        self.root=base/datetime.now(timezone.utc).strftime('run-%Y%m%dT%H%M%S%f')
        self.root.mkdir()
        self.evidence=self.root/'evidence'; self.evidence.mkdir()
        self.runners=self.root/'uninstaller-runners'; self.runners.mkdir()
        self.rows=[]; self.count=0; self.ui=None
        self.registry=reg_snapshot()
        self.build=json.loads((B/'build-evidence.json').read_text(encoding='utf-8'))
        self.active=None
        self.summary={'started':stamp(),'root':str(self.root),'scriptSha256':sha(Path(__file__)),
            'installer':str(INSTALLER),'installerSha256':EXPECTED,'tests':self.rows,
            'registryBefore':self.registry,
            'boundaries':['TESTMODE cases plus separately approved normal-mode case only when product key absent; no product GUI launch','Only directly spawned installer/uninstaller handles managed',
                'Only own synthetic files under test root; normal case temporarily registers exact product HKCU key then removes it; no profiles',
                'OS file locks are actual Windows handles, not mocks; no claim of live application test']}

    def write(self): save(self.evidence/'summary.json',self.summary)

    def safe(self,p):
        need(p.absolute().is_relative_to(self.root.absolute()),'outside own test root')
        need('"' not in str(p) and '\n' not in str(p),'unsafe path')

    def run(self,label,target,uninstall=False,watch=None,normal=False):
        self.safe(target)
        need(sha(INSTALLER)==EXPECTED,'fixed installer hash changed')
        self.count+=1
        ev=self.evidence/f'{self.count:02d}-{label}.json'
        if uninstall:
            origin=target/'Uninstall DaedongCAD.exe'
            exe=self.runners/f'{self.count:02d}-{label}.exe'
            shutil.copyfile(origin,exe)
            need(sha(exe)==sha(origin),'uninstaller copy differs')
            cmd='"'+str(exe)+'" /S _?='+str(target)
        else:
            exe=INSTALLER
            cmd='"'+str(exe)+'" /S '+('' if normal else '/TESTMODE ')+'/D='+str(target)
        record={'label':label,'started':stamp(),'target':str(target),'command':cmd,'executableSha256':sha(exe)}
        save(ev,record)
        proc=subprocess.Popen(cmd,cwd=str(self.root),creationflags=subprocess.CREATE_NO_WINDOW)
        self.active=proc
        record['process']=process_identity(proc)
        need(Path(record['process']['image']).resolve()==exe.resolve(),'unexpected process image')
        save(ev,record)
        if watch: watch(proc,record)
        try: code=proc.wait(timeout=180)
        except subprocess.TimeoutExpired:
            record['timeout']=True
            # Only directly owned handle, never search/kill by executable name.
            proc.kill(); code=proc.wait(timeout=15)
            record['terminatedOwnTimedOutProcess']=True
        self.active=None
        record.update(exitCode=code,finished=stamp())
        save(ev,record)
        need(not record.get('timeout'),'own installer timed out')
        return record

    def passed(self,label,**data):
        row={'label':label,'status':'pass',**data}; self.rows.append(row); self.write()
        print(json.dumps(row,ensure_ascii=False),flush=True)

    def payload_ok(self,p,mode='1'):
        observed=inventory(p/'app')
        for item in self.build['payload']:
            need(observed.get(item['path'])=={'bytes':item['bytes'],'sha256':item['sha256']},'payload differs '+item['path'])
        marker=(p/'.daedongcad-install').read_bytes().decode('utf-16le').lstrip('\ufeff').splitlines()
        need(marker==[MAGIC,str(p),mode,'1.4.1'],'marker differs '+repr(marker))
        need((p/'Uninstall DaedongCAD.exe').is_file(),'missing uninstaller')
        return {'payloadFiles':len(self.build['payload']),'appExeSha256':sha(p/'app/DaedongCAD.exe'),
            'asarSha256':sha(p/'app/resources/app.asar'),'uninstallerSha256':sha(p/'Uninstall DaedongCAD.exe')}

    def fresh(self,name):
        p=self.root/name; p.mkdir()
        result=self.run('fresh-'+name,p)
        need(result['exitCode']==0,'fresh installation failed '+name)
        details=self.payload_ok(p)
        self.passed('fresh-'+name,**details)
        return p

    def reject(self,label,p,uninstall=False):
        before=inventory(p)
        result=self.run(label,p,uninstall)
        after=inventory(p)
        save(self.evidence/(label+'-preservation.json'),{'before':before,'after':after})
        need(result['exitCode']!=0,'expected refusal '+label)
        need(before==after,'refusal modified target '+label)
        self.passed(label,exitCode=result['exitCode'],unchangedEntries=len(before))

    def marker(self,p,lines=None):
        (p/'.daedongcad-install').write_bytes(('\r\n'.join(lines or [MAGIC,str(p),'1','1.4.1'])+'\r\n').encode('utf-16le'))

    def skeleton(self,name):
        p=self.root/name; p.mkdir(); self.marker(p)
        shutil.copyfile(self.ui/'Uninstall DaedongCAD.exe',p/'Uninstall DaedongCAD.exe')
        return p

    def all(self):
        need(sha(INSTALLER)==EXPECTED,'wrong installer')
        for relative,expected in self.build['packagingSourceSha256'].items(): need(sha(R/relative)==expected,'packaging drift '+relative)
        for relative,expected in self.build['generatedInstallerSourceSha256'].items(): need(sha(B/relative)==expected,'generated drift '+relative)
        need(json.loads((R/'verification/preinstall/evidence.json').read_text(encoding='utf-8'))['status']=='verified','preinstall backup unavailable')
        self.summary['sourceReview']='Two passes of frozen generated NSI, all generated includes and build script; metadata commit/rollback, fixed owned-file preflight, UTF16LE marker, no TESTMODE registry writes.'
        self.write()
        self.ui=self.fresh('정상 설치 UI 보존')
        self.summary['retainedUIPath']=str(self.ui); self.write()
        print('RETAINED_UI '+str(self.ui),flush=True)
        work=self.fresh('normal-reinstall-uninstall')
        before=inventory(work); result=self.run('same-version-reinstall',work)
        need(result['exitCode']==0,'same version reinstall failed')
        need(before==inventory(work),'same version reinstall byte inventory differs')
        self.passed('same-version-reinstall',**self.payload_ok(work))

        for label,rel in [('exe','app/DaedongCAD.exe'),('asar','app/resources/app.asar'),('marker','.daedongcad-install')]:
            h=lock(work/rel)
            try:
                self.reject('lock-'+label+'-install',work)
                self.reject('lock-'+label+'-uninstall',work,True)
            finally: K.CloseHandle(h)

        p=self.root/'unknown-nonempty'; p.mkdir(); (p/'user drawing.txt').write_text('preserve unknown data',encoding='utf-8')
        self.reject('unknown-nonempty',p)
        cases={
            'marker-wrong-magic':['unowned',None,'1','1.4.1'],
            'marker-wrong-path':[MAGIC,str(self.root/'different-owner'),'1','1.4.1'],
            'marker-wrong-mode':[MAGIC,None,'0','1.4.1'],
            'marker-empty-version':[MAGIC,None,'1',''],
            'marker-missing-version':[MAGIC,None,'1'],
            'marker-nonnumeric':[MAGIC,None,'1','1.x.1'],
            'marker-out-of-range':[MAGIC,None,'1','65536.4.1'],
            'marker-missing-segment':[MAGIC,None,'1','1..1'],
            'downgrade-refused':[MAGIC,None,'1','1.4.2'],
        }
        for label,lines in cases.items():
            p=self.skeleton(label); self.marker(p,[str(p) if v is None else v for v in lines]); self.reject(label,p)
        p=self.skeleton('marker-empty'); (p/'.daedongcad-install').write_bytes(b''); self.reject('marker-empty',p)

        for name in ['app.new','app.previous','.uninstall.new.exe','.uninstall.previous.exe','.marker.new','.marker.previous']:
            label='pending-'+name.replace('.','_'); p=self.skeleton(label)
            if name.startswith('app.'): (p/name).mkdir(); (p/name/'sentinel.txt').write_text('keep pending')
            else: (p/name).write_text('keep pending')
            self.reject(label,p)

        p=self.skeleton('nested-reparse'); (p/'app').mkdir()
        sentinel=self.root/'junction-target'; sentinel.mkdir(); (sentinel/'app.asar').write_text('synthetic target never touched')
        command="New-Item -ItemType Junction -Path '"+str(p/'app/resources').replace("'","''")+"' -Target '"+str(sentinel).replace("'","''")+"' | Out-Null"
        junction=subprocess.run([PS,'-NoProfile','-Command',command],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
        need(junction.returncode==0,'junction creation failed '+junction.stderr.decode(errors='replace'))
        before=inventory(sentinel)
        self.reject('nested-reparse-install',p); self.reject('nested-reparse-uninstall',p,True)
        need(before==inventory(sentinel),'junction target modified')
        save(self.evidence/'junction-target-preserved.json',{'before':before,'after':inventory(sentinel)})

        rollback=self.fresh('rollback-after-preflight')
        before=inventory(rollback); holder={}
        def watcher(proc,record):
            until=time.monotonic()+120
            while time.monotonic()<until and proc.poll() is None:
                if (rollback/'app.new').exists():
                    holder['handle']=lock(rollback/'.daedongcad-install')
                    record['postPreflightLock']={'time':stamp(),'trigger':'app.new exists after all preflight checks','path':str(rollback/'.daedongcad-install'),'kind':'actual CreateFileW GENERIC_READ FILE_SHARE_READ; deny write/delete'}
                    return
                time.sleep(.005)
            raise AssertionError('missed post-preflight lock window')
        try: result=self.run('postpreflight-marker-rollback',rollback,watch=watcher)
        finally:
            if 'handle' in holder: K.CloseHandle(holder['handle'])
        need('handle' in holder,'postpreflight lock absent')
        need(result['exitCode']!=0,'commit unexpectedly succeeded with locked marker')
        after=inventory(rollback)
        need(all(after.get(k)==v for k,v in before.items()),'rollback did not restore every original entry')
        need(not (rollback/'app.previous').exists(),'old app was not restored')
        need(not (rollback/'.uninstall.previous.exe').exists(),'old uninstaller was not restored')
        need((rollback/'app.new').exists() and (rollback/'.marker.new').exists(),'staged evidence not preserved')
        save(self.evidence/'rollback-preservation.json',{'before':before,'after':after})
        self.passed('postpreflight-marker-rollback',exitCode=result['exitCode'],originalEntriesRestored=len(before),stagedFilesPreserved=True)

        root_unknown=work/'drawing.user.txt'; root_unknown.write_text('keep root unknown',encoding='utf-8')
        nested_unknown=work/'app/resources/user drawing.dcad.json'; nested_unknown.write_text('{"synthetic":"preserve"}',encoding='utf-8')
        expected_unknown=sha(nested_unknown); expected_root=sha(root_unknown)
        result=self.run('unknown-preserve-reinstall',work)
        need(result['exitCode']==0,'unknown preserve reinstall failed')
        need(sha(work/'app.previous/resources/user drawing.dcad.json')==expected_unknown,'old unknown nested file lost')
        need(sha(root_unknown)==expected_root,'root unknown lost')
        self.passed('unknown-preserve-reinstall',nestedMovedToPreservedPrevious=True)
        self.reject('unknown-previous-blocks-reinstall',work)
        current_unknown=work/'app/resources/current-user-file.txt'; current_unknown.write_text('keep current unknown',encoding='utf-8')
        expected_current=sha(current_unknown)
        result=self.run('uninstall-preserves-unknown',work,True)
        need(result['exitCode']==0,'normal uninstall failed')
        need(sha(root_unknown)==expected_root and sha(current_unknown)==expected_current and sha(work/'app.previous/resources/user drawing.dcad.json')==expected_unknown,'uninstall lost unknown')
        need(not (work/'.daedongcad-install').exists() and not (work/'Uninstall DaedongCAD.exe').exists(),'metadata remains')
        for item in self.build['payload']: need(not (work/'app'/item['path']).exists(),'owned file remains '+item['path'])
        self.passed('uninstall-preserves-unknown',remaining=inventory(work))
        afterreg=reg_snapshot(); need(afterreg==self.registry,'TESTMODE registration changed')
        self.summary['testModeRegistryAfter']=afterreg
        if any(value is not None for value in self.registry.values()):
            self.summary['normalMode']='not run: preexisting product registration; no change authorized'
        else:
            normal=self.root/'install-normal'; normal.mkdir()
            result=self.run('normal-mode-fresh',normal,normal=True)
            need(result['exitCode']==0,'normal mode install failed')
            self.payload_ok(normal,'0')
            registered=reg_snapshot()
            need(registered['64'] is not None,'normal registration absent')
            values={name:value for name,value,kind in registered['64']}
            need(values['InstallLocation']==str(normal) and values['DisplayVersion']=='1.4.1','normal registration mismatch')
            need(values['UninstallString']=='"'+str(normal/'Uninstall DaedongCAD.exe')+'"','uninstaller registration mismatch')
            self.summary['normalRegistration']=registered
            self.passed('normal-mode-fresh',**self.payload_ok(normal,'0'))
            before=inventory(normal)
            result=self.run('normal-mode-same-version-reinstall',normal,normal=True)
            need(result['exitCode']==0 and inventory(normal)==before,'normal reinstall differs')
            need(reg_snapshot()==registered,'normal reinstall registration differs')
            self.passed('normal-mode-same-version-reinstall')
            result=self.run('normal-mode-uninstall',normal,uninstall=True)
            need(result['exitCode']==0,'normal uninstall failed')
            need(not normal.exists(),'normal uninstall left files')
            need(reg_snapshot()==self.registry,'normal uninstall did not restore original absent registry key')
            self.passed('normal-mode-uninstall',registrationRemoved=True,installationDirectoryRemoved=True)
            self.summary['normalMode']='actual isolated install / reinstall / uninstall; product registration initially absent; final registration absent'
        afterreg=reg_snapshot()
        self.summary.update(status='pass',finished=stamp(),passed=len(self.rows),registryBefore=self.registry,registryAfter=afterreg,
            retainedUI=self.payload_ok(self.ui),limitations=['No product app/UI launched; EXE lock is a real OS lock surrogate',
                'No power-loss guarantee; post-preflight real file-lock rollback only','Unknown files may remain under app.previous and deliberately block another reinstall'])
        self.write()
        print('SUMMARY '+str(self.evidence/'summary.json'),flush=True)

if __name__=='__main__':
    s=Suite()
    try: s.all()
    except BaseException as ex:
        s.summary.update(status='failed',failure=repr(ex),traceback=traceback.format_exc(),finished=stamp())
        if s.active is not None:
            s.summary['activeOwnProcess']={'pid':s.active.pid,'poll':s.active.poll()}
            try: s.summary['activeOwnProcess']['finalExitCode']=s.active.wait(timeout=15)
            except subprocess.TimeoutExpired:
                s.active.kill()
                s.summary['activeOwnProcess'].update(terminatedOnlyOwnHandle=True,finalExitCode=s.active.wait(timeout=15))
        s.summary['registryAfterFailure']=reg_snapshot()
        s.write(); print(traceback.format_exc(),flush=True); print('SUMMARY '+str(s.evidence/'summary.json'),flush=True)
        raise
