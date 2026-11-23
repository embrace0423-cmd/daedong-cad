"""Only approved isolated normal-mode registration, reinstall and uninstall."""
import importlib.util, json, traceback
from pathlib import Path

spec=importlib.util.spec_from_file_location('harness',Path(__file__).with_name('installer-validation.py'))
h=importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
s=h.Suite()
s.summary['purpose']='Normal-mode retry outside sandbox only after exact scoped approval; no administrator/UAC requests or profile access'
s.summary['entryScriptSha256']=h.sha(Path(__file__))
s.summary['priorSandboxAttempt']='run-20261110T204219156244: TESTMODE33 passed; normal registration exit28, product key absent before/after; preserved'
try:
    h.need(h.sha(h.INSTALLER)==h.EXPECTED,'fixed build6 installer changed')
    for relative,expected in s.build['packagingSourceSha256'].items(): h.need(h.sha(h.R/relative)==expected,'packaging drift '+relative)
    for relative,expected in s.build['generatedInstallerSourceSha256'].items(): h.need(h.sha(h.B/relative)==expected,'generated drift '+relative)
    s.write()
    h.need(all(value is None for value in s.registry.values()),'product key preexists; no registry changes authorized')
    p=s.root/'install-normal'; p.mkdir()
    result=s.run('normal-mode-fresh',p,normal=True)
    h.need(result['exitCode']==0,'normal installation failed')
    details=s.payload_ok(p,'0')
    registered=h.reg_snapshot()
    h.need(registered['64'] is not None,'normal product registration absent')
    values={name:value for name,value,kind in registered['64']}
    h.need(values['InstallLocation']==str(p) and values['DisplayVersion']=='1.4.1','registration path/version mismatch')
    h.need(values['UninstallString']=='"'+str(p/'Uninstall DaedongCAD.exe')+'"','uninstall command mismatch')
    h.need(values['QuietUninstallString']==values['UninstallString']+' /S','quiet uninstall command mismatch')
    s.summary['normalRegistration']=registered
    s.passed('normal-mode-fresh',**details)
    before=h.inventory(p)
    result=s.run('normal-mode-same-version-reinstall',p,normal=True)
    after=h.inventory(p)
    h.save(s.evidence/'same-version-preservation.json',{'before':before,'after':after})
    h.need(result['exitCode']==0 and before==after,'normal same version reinstall differs')
    h.need(h.reg_snapshot()==registered,'normal reinstall registration changed')
    s.passed('normal-mode-same-version-reinstall',unchangedEntries=len(before))
    result=s.run('normal-mode-uninstall',p,uninstall=True)
    h.need(result['exitCode']==0,'normal uninstall failed')
    h.need(not p.exists(),'normal install directory remains')
    h.need(h.reg_snapshot()==s.registry,'normal uninstall registration not removed')
    s.passed('normal-mode-uninstall',registrationRemoved=True,installationDirectoryRemoved=True)
    s.summary.update(status='pass',finished=h.stamp(),passed=len(s.rows),registryAfter=h.reg_snapshot(),
        limitations=['Actual same1.4.1 reinstall only; no prior-version payload update claim','No product GUI launched; parent owns that test','No existing production install or profile accessed'])
    s.write()
except BaseException as ex:
    s.summary.update(status='failed',failure=repr(ex),traceback=traceback.format_exc(),finished=h.stamp(),registryAfterFailure=h.reg_snapshot())
    if s.active is not None:
        s.summary['activeOwnProcess']={'pid':s.active.pid,'poll':s.active.poll()}
        try: s.summary['activeOwnProcess']['finalExitCode']=s.active.wait(timeout=15)
        except h.subprocess.TimeoutExpired:
            s.active.kill(); s.summary['activeOwnProcess'].update(terminatedOnlyOwnHandle=True,finalExitCode=s.active.wait(timeout=15))
    s.write()
    raise
finally:
    print('SUMMARY '+str(s.evidence/'summary.json'),flush=True)
