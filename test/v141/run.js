// 1.4.1에서 옮겨 온 시험 실행: node test/v141/run.js
// 시험 파일은 받은 그대로 두고, 시험이 찾는 src/ 자리에 이 저장소의 파일을 모아 놓은 뒤 돌린다.
//   src/app/daedong-cad.html ← dist/daedong-cad.html (node build.js로 먼저 만듦)
//   src/app/safety.js        ← js/safety.js
//   src/main.js, src/preload.js, src/atomic-store.cjs ← desktop/
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const here = __dirname, root = path.join(here, '..', '..'), src = path.join(here, 'src');
execFileSync(process.execPath, [path.join(root, 'build.js')], { stdio: 'inherit' });
fs.rmSync(src, { recursive: true, force: true });
fs.mkdirSync(path.join(src, 'app'), { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(root, from), path.join(src, to));
copy('dist/daedong-cad.html', 'app/daedong-cad.html');
copy('js/safety.js', 'app/safety.js');
copy('desktop/main.js', 'main.js');
copy('desktop/preload.js', 'preload.js');
copy('desktop/atomic-store.cjs', 'atomic-store.cjs');
const tests = fs.readdirSync(path.join(here, 'tests')).filter((f) => /\.test\.cjs$/.test(f)).sort().map((f) => path.join(here, 'tests', f));
let failed = false;
try { execFileSync(process.execPath, ['--test', ...tests], { stdio: 'inherit', cwd: here }); } catch (e) { failed = true; }
try { execFileSync(process.execPath, [path.join(here, 'tests', 'extra-validation.cjs')], { stdio: 'inherit', cwd: here }); } catch (e) { failed = true; }
if (failed) { console.error('1.4.1 시험 실패'); process.exit(1); }
console.log('1.4.1 시험 모두 통과');
