// Windows 설치 파일 만들기: node build-win.js → out/DaedongCAD-Setup-<판>.exe
// Windows PC에서는 electron-builder를 그대로 쓴다. 리눅스·맥에서는 제거 프로그램을 만들 때 wine 대신
// electron-builder에 들어 있는 순수 JS 추출기(UninstallerReader, 원래 macOS 10.15+용 경로)를 쓰게 한다.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

execFileSync(process.execPath, [path.join(__dirname, 'prepare.js')], { stdio: 'inherit' });
if (process.platform !== 'win32') {
  require('app-builder-lib/out/util/macosVersion').isMacOsCatalina = () => true;
}
const builder = require('electron-builder');
builder.build({ projectDir: __dirname, publish: 'never', targets: builder.Platform.WINDOWS.createTarget('nsis', builder.Arch.x64) })
  .then((files) => console.log('만듦: ' + files.map((f) => path.relative(__dirname, f)).join(', ')))
  .catch((e) => { console.error(e); process.exit(1); });
