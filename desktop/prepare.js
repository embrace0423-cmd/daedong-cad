// 앱에 넣을 화면 준비: 한 파일 빌드(../build.js)를 만들고 app/에 아이콘과 함께 복사한다.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const here = __dirname;
const root = path.join(here, '..');
execFileSync(process.execPath, [path.join(root, 'build.js')], { stdio: 'inherit' });
const out = path.join(here, 'app');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'dist', 'daedong-cad.html'), path.join(out, 'daedong-cad.html'));
fs.copyFileSync(path.join(here, 'build', 'icon.png'), path.join(out, 'icon.png'));
console.log('준비: app/daedong-cad.html, app/icon.png');
