"""Read-only exact-code cross-check and scoped installer evidence aggregation."""
import hashlib, json, re
from pathlib import Path

R=Path(__file__).resolve().parent.parent
BASE=R/'test-runs/installer-validation-20261111'
TEST=BASE/'run-20261110T204219156244/evidence'
NORMAL=BASE/'run-20261110T204800900012/evidence'
OUT=R/'verification/extra-validation'
EXPECTED='2c441f64bc547e4c925140e85ef2218a8ca041a69e4ae3805467feab72855f9f'

def read(p): return json.loads(p.read_text(encoding='utf-8'))
def sha(p):
    with p.open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()
def require(ok,msg):
    if not ok: raise AssertionError(msg)

ts=read(TEST/'summary.json'); ns=read(NORMAL/'summary.json')
require(len(ts['tests'])==33 and all(r['status']=='pass' for r in ts['tests']),'TESTMODE cases')
require(ts['status']=='failed' and ts['failure']=="AssertionError('normal mode install failed')",'preserve original suite failure')
require(read(TEST/'34-normal-mode-fresh.json')['exitCode']==28,'original normal failure code')
require(ns['status']=='pass' and len(ns['tests'])==3,'normal cases')
require(ns['registryBefore']==ns['registryAfter']=={'64':None,'32':None},'normal registry restore')
require(ts['registryBefore']==ts['testModeRegistryAfter']==ts['registryAfterFailure']=={'64':None,'32':None},'TESTMODE no registration')
codes={'lock-exe-install':17,'lock-exe-uninstall':16,'lock-asar-install':17,'lock-asar-uninstall':17,
    'lock-marker-install':17,'lock-marker-uninstall':17,'unknown-nonempty':22,'marker-wrong-magic':14,
    'marker-wrong-path':14,'marker-wrong-mode':19,'marker-empty-version':15,'marker-missing-version':14,
    'marker-nonnumeric':15,'marker-out-of-range':15,'marker-missing-segment':15,'downgrade-refused':20,
    'marker-empty':14,'nested-reparse-install':12,'nested-reparse-uninstall':12,
    'postpreflight-marker-rollback':25,'unknown-previous-blocks-reinstall':24}
cases=[]
for folder,summary in [(TEST,ts),(NORMAL,ns)]:
    records={}
    for p in folder.glob('*.json'):
        if re.match(r'^\d\d-',p.name):
            rec=read(p); records[rec['label']]=(p,rec)
    for row in summary['tests']:
        label=row['label']; p,rec=records[label]
        expected=24 if label.startswith('pending-') else codes.get(label,0)
        require(rec['exitCode']==expected,'unexpected code '+label)
        if 'executableSha256' in rec and not label.endswith('-uninstall') and label!='uninstall-preserves-unknown':
            require(rec['executableSha256']==EXPECTED,'installer mismatch '+label)
        require(rec['process']['pid']>0 and rec['process']['creationFiletime']>0,'process identity '+label)
        cases.append({'case':label,'expectedExitCode':expected,'observedExitCode':rec['exitCode'],
            'result':str(p.relative_to(R)),'resultSha256':sha(p)})
require(len(cases)==36,'case count')
installer=R/'builds/smoke-build6/DaedongCAD-Setup-1.4.1.exe'
require(sha(installer)==EXPECTED,'current installer drift')
report={'status':'pass_for_36_scoped_installer_cases','version':'1.4.1','installerSha256':EXPECTED,
    'testModeCases':33,'normalModeCases':3,'totalCases':36,'cases':cases,
    'retainedUIPath':ts['retainedUIPath'],'normalModeFinalRegistration':ns['registryAfter'],
    'retainedUIFiles':{name:sha(Path(ts['retainedUIPath'])/'app'/name) for name in ['DaedongCAD.exe','resources/app.asar']},
    'excludedPreservedAttempts':[
        {'run':'run-20261110T203643429043','build':'smoke-build4','result':'first empty install preflight exit2; no staged payload; superseded by build6'},
        {'run':'run-20261110T204219156244','case':'normal-mode-fresh','result':'restricted execution exit28, product key absent; partial own install preserved; successful normal-only follow-up separate'}],
    'scope':['Actual installer/uninstaller processes and Windows read-share/no-delete file locks',
        'Actual same-version1.4.1 reinstall; marker1.4.2 refusal is policy only, not previous-version update',
        'Post-preflight marker lock observed exit25 and original byte inventory unchanged; staged new files preserved',
        'No application GUI or existing production installer/profile changed by this child',
        'No registry failure, machine crash/power-loss or hostile concurrent path-mutation guarantees'],
    'evidenceFiles':[{'path':str(p.relative_to(R)),'sha256':sha(p)} for folder in [TEST,NORMAL] for p in sorted(folder.glob('*.json'))],
    'harnessFiles':[{'path':str(p.relative_to(R)),'sha256':sha(p)} for p in [Path(__file__).with_name('installer-validation.py'),Path(__file__).with_name('installer-normal-mode.py'),Path(__file__)]],
    'liveApplicationRunningRefusal':'Parent task, not included in these36 cases'}
(OUT/'installer-build6-evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':report['status'],'cases':len(cases),'output':str(OUT/'installer-build6-evidence.json')},ensure_ascii=False))
