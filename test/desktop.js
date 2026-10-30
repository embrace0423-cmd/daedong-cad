// 데스크톱 앱 시험 (Playwright Electron). PC 파일 열기·저장·PDF·닫기를 실제 앱으로 확인한다.
// 쓰는 법: (cd desktop && npm run dist:dir) 뒤에 xvfb-run node test/desktop.js <출력 폴더> [앱 실행 파일]
'use strict';
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const root = path.join(__dirname, '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'test-out-desktop'));
const exe = path.resolve(process.argv[3] || path.join(root, 'desktop', 'out', 'linux-unpacked', 'DaedongCAD'));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const home = path.join(outDir, 'home');
fs.mkdirSync(home);

let fails = 0;
function check(ok, label) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + label);
  if (!ok) fails++;
}
const count = (s, re) => (s.match(re) || []).length;
const LINE = /\n\s*0\r?\nLINE\r?\n/g;

async function launch(args) {
  const app = await electron.launch({
    executablePath: exe,
    args: ['--no-sandbox'].concat(args || []),
    env: Object.assign({}, process.env, { HOME: home, DCAD_NO_MAXIMIZE: '1', LANG: 'C.UTF-8' })
  });
  // 대화상자는 시험용으로 바꿔 끼운다: 저장·열기 경로와 닫기 답을 차례로 꺼내 쓴다
  await app.evaluate(({ dialog }) => {
    global.__calls = { save: 0, open: 0, box: 0 };
    global.__next = { save: [], open: [], box: [] };
    dialog.showSaveDialog = async () => { __calls.save++; const p = __next.save.shift(); return p ? { canceled: false, filePath: p } : { canceled: true, filePath: '' }; };
    dialog.showOpenDialog = async () => { __calls.open++; const p = __next.open.shift(); return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }; };
    dialog.showMessageBoxSync = () => { __calls.box++; const r = __next.box.shift(); return r === undefined ? 2 : r; };
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.DCAD && DCAD.App && DCAD.App.doc);
  return { app, page };
}
const calls = (app) => app.evaluate(() => __calls);
const plan = (app, kind, v) => app.evaluate((x, a) => { __next[a.kind].push(a.v); }, { kind, v });
async function command(page, text) {
  await page.click('#cmd');
  for (const t of text) { await page.fill('#cmd', t); await page.press('#cmd', 'Enter'); }
}
async function drawLine(page, a, b) { await command(page, ['L', a, b, '']); }
const state = (page) => page.evaluate(() => ({
  file: DCAD.App.file, dirty: DCAD.App.dirty, n: DCAD.App.doc.ents.length, name: DCAD.App.doc.name, title: document.title
}));
async function waitFile(p, pred, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) {
    try { const b = fs.readFileSync(p); if (!pred || pred(b)) return b; } catch (e) { /* 아직 없음 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

(async () => {
  console.log('데스크톱 앱: ' + exe);
  const dxf = path.join(outDir, '받은 도면.dxf');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'rich-r2018-utf8.dxf'), dxf);
  const original = fs.readFileSync(dxf, 'latin1');

  // 1) 두 번 클릭한 DXF로 시작
  let { app, page } = await launch([dxf]);
  await page.waitForFunction(() => DCAD.App.file);
  let s = await state(page);
  check(await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined' && !!window.dcadDesktop), '화면에는 Node가 없고 PC 파일 연결(dcadDesktop)만 있음');
  check(s.file && s.file.name === '받은 도면.dxf' && s.file.kind === 'dxf' && !s.file.ours && s.n > 0, '실행할 때 준 DXF를 엶 (한글·띄어쓰기 파일 이름, 개체 ' + s.n + '개)');
  check(s.title === '받은 도면.dxf - 대동 CAD', '창 제목 = 파일 이름: ' + s.title);
  check(!(await page.evaluate(() => document.getElementById('dlg-new').open)), '파일로 시작하면 새 도면 창을 띄우지 않음');
  check(await page.isVisible('[data-act=pdf]'), 'PDF 버튼이 보임 (데스크톱에서만)');

  // 2) 받은 DXF의 첫 저장은 위치를 묻는다 (원본을 R12로 덮어쓰기 전에 한 번 확인)
  await plan(app, 'save', dxf);
  await page.keyboard.press('Control+s');
  let buf = await waitFile(dxf, (b) => b.toString('latin1') !== original);
  let c = await calls(app);
  s = await state(page);
  check(c.save === 1 && buf && /AC1009/.test(buf.toString('latin1')), '받은 DXF 첫 Ctrl+S: 저장 위치를 물은 뒤 R12로 저장');
  check(s.file.ours && !s.dirty, '저장 뒤 이 파일은 바로 덮어씀으로 바뀜');

  // 3) 그린 뒤 Ctrl+S는 묻지 않고 같은 파일에 저장
  const before = count(buf.toString('latin1'), LINE);
  await drawLine(page, '0,0', '1000,0');
  s = await state(page);
  check(s.dirty && s.title.startsWith('● '), '고치면 제목에 ● 표시: ' + s.title);
  await page.keyboard.press('Control+s');
  buf = await waitFile(dxf, (b) => count(b.toString('latin1'), LINE) === before + 1);
  c = await calls(app);
  check(buf && c.save === 1, 'Ctrl+S: 묻지 않고 같은 파일에 덮어씀 (선 ' + before + ' → ' + (buf ? count(buf.toString('latin1'), LINE) : '?') + ')');
  s = await state(page);
  check(!s.dirty && !s.title.startsWith('● '), '저장 뒤 ● 표시가 사라짐');

  // 4) 작업 파일로 저장하면 그 뒤 Ctrl+S는 작업 파일에
  const work = path.join(outDir, '받은 도면.dcad.json');
  await plan(app, 'save', work);
  await page.click('[data-act=savework]');
  let wb = await waitFile(work);
  s = await state(page);
  check(wb && JSON.parse(wb.toString('utf8')).format === 'daedong-cad' && s.file.kind === 'work', '작업 파일 저장 (대화상자로 위치 고름)');
  const nWork = JSON.parse(wb.toString('utf8')).ents.length;
  await drawLine(page, '0,500', '1000,500');
  await page.keyboard.press('Control+s');
  wb = await waitFile(work, (b) => JSON.parse(b.toString('utf8')).ents.length === nWork + 1);
  c = await calls(app);
  check(wb && c.save === 2, '작업 파일을 연 상태의 Ctrl+S는 작업 파일에 바로 저장');

  // 5) 다른 이름으로 (Ctrl+Shift+S)
  const work2 = path.join(outDir, '사본.dcad.json');
  await plan(app, 'save', work2);
  await page.keyboard.press('Control+Shift+S');
  check(!!(await waitFile(work2)) && (await state(page)).file.name === '사본.dcad.json', 'Ctrl+Shift+S: 다른 이름으로 저장, 제목도 바뀜');

  // 6) 내보내기: 언제나 위치를 묻는다
  const png = path.join(outDir, '그림.png'), svg = path.join(outDir, '그림.svg'), csv = path.join(outDir, '물량.csv');
  await plan(app, 'save', png);
  await page.click('[data-act=png]');
  buf = await waitFile(png);
  check(buf && buf.slice(1, 4).toString() === 'PNG', 'PNG 내보내기');
  await plan(app, 'save', svg);
  await page.click('[data-act=svg]');
  buf = await waitFile(svg);
  check(buf && /<svg/.test(buf.toString('utf8')), 'SVG 내보내기');
  await command(page, ['QTO']);
  await page.waitForSelector('#dlg-qto[open]');
  await plan(app, 'save', csv);
  await page.click('#qto-csv');
  buf = await waitFile(csv);
  check(buf && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, '물량 CSV 저장 (엑셀용 BOM)');
  await page.evaluate(() => document.getElementById('dlg-qto').close());
  await plan(app, 'save', null);
  await page.click('[data-act=png]');
  await page.waitForFunction(() => /저장을 취소했습니다/.test(document.getElementById('history').textContent));
  check(true, '저장 대화상자에서 취소하면 아무것도 쓰지 않음');

  // 7) 새 도면, 열기 버튼, PDF (A3 = 420×297mm, 실제 축척)
  await page.click('[data-act=new]');
  await page.click('#new-ok');
  s = await state(page);
  check(s.file === null && s.title.startsWith('리모델링'), '새 도면은 파일 연결 없이 시작: ' + s.title);
  // 예시 리모델링 평면도(작업 파일)를 열어 PDF로
  const sample = path.join(outDir, '예시.dcad.json');
  fs.copyFileSync(path.join(root, 'docs', 'sample-remodel.dcad.json'), sample);
  await plan(app, 'open', sample);
  await page.click('[data-act=open]');
  await page.waitForFunction(() => DCAD.App.file && DCAD.App.file.name === '예시.dcad.json');
  const pdf = path.join(outDir, '도면.pdf');
  await plan(app, 'save', pdf);
  await page.click('[data-act=pdf]');
  buf = await waitFile(pdf, (b) => b.length > 1000, 20000);
  const box = buf && /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(buf.toString('latin1'));
  const pages = buf ? count(buf.toString('latin1'), /\/Type\s*\/Page[^s]/g) : 0;
  check(buf && buf.slice(0, 4).toString() === '%PDF' && box && Math.abs(box[1] - 1190.55) < 2 && Math.abs(box[2] - 841.89) < 2 && pages === 1,
    'PDF 저장: 종이 ' + (box ? (box[1] / 72 * 25.4).toFixed(0) + '×' + (box[2] / 72 * 25.4).toFixed(0) + 'mm' : '?') + ', ' + pages + '쪽 (A3, 도곽 범위)');

  // 8) 열기 대화상자(Ctrl+O)로 작업 파일 열기
  await plan(app, 'open', work);
  await page.keyboard.press('Control+o');
  await page.waitForFunction(() => DCAD.App.file && DCAD.App.file.name === '받은 도면.dcad.json');
  s = await state(page);
  check(s.n === nWork + 1 && s.file.kind === 'work' && s.file.ours, 'Ctrl+O로 작업 파일 열기 (개체 ' + s.n + '개)');
  check(await page.evaluate(() => DCAD.App.undo.length === 0), '다른 파일을 열면 되돌리기 기록을 비움 (엉뚱한 파일에 저장 막기)');

  // 9) 이미 열린 앱에 DXF를 또 두 번 클릭한 경우 (두 번째 실행 → 같은 창)
  await drawLine(page, '0,900', '1000,900');
  let asked = null;
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('dcad:open-path', p), dxf);
  await page.waitForTimeout(500);
  s = await state(page);
  check(asked && /저장하지 않았습니다/.test(asked) && s.file.name === '받은 도면.dcad.json' && s.dirty, '저장 안 한 도면이 있으면 바꾸기 전에 묻고, 취소하면 그대로');
  page.once('dialog', (d) => d.accept());
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('dcad:open-path', p), dxf);
  await page.waitForFunction(() => DCAD.App.file && DCAD.App.file.name === '받은 도면.dxf');
  check(true, '확인하면 새로 두 번 클릭한 DXF를 같은 창에서 엶');

  // 10) 인터넷으로 나가는 요청은 막힘
  const net = await page.evaluate(() => fetch('https://example.com/').then(() => 'ok', () => 'blocked'));
  check(net === 'blocked', '인터넷 요청 차단 (도면이 밖으로 나가지 않음)');

  // 11) 닫기: 저장 안 한 내용이 있으면 묻는다 — 취소 → 그대로, 저장 → 저장하고 닫힘
  await drawLine(page, '0,1500', '1000,1500');
  await plan(app, 'box', 2);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForTimeout(400);
  c = await calls(app);
  const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  check(c.box === 1 && wins === 1, '닫기 → "바뀐 내용을 저장할까요?" → 취소하면 창이 그대로');
  const lines0 = count(fs.readFileSync(dxf, 'latin1'), LINE);
  await plan(app, 'box', 0);
  // 이 DXF는 다시 열린 받은 파일이라 첫 저장은 위치를 묻는다
  await plan(app, 'save', dxf);
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  check(count(fs.readFileSync(dxf, 'latin1'), LINE) === lines0 + 1, '저장 → DXF에 저장한 뒤 앱이 닫힘');

  // 12) 다시 켜면 지난 작업이 이어서 나옴, 저장 안 함으로 닫기
  ({ app, page } = await launch([]));
  s = await state(page);
  check(s.name === '받은 도면' && s.n > 0 && s.file === null, '다시 켜면 지난 작업을 이어서 엶 (개체 ' + s.n + '개)');
  await drawLine(page, '0,2000', '1000,2000');
  await plan(app, 'box', 1);
  const closed2 = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed2;
  check(true, '저장 안 함 → 바로 닫힘');

  console.log(fails ? '\n실패 ' + fails + '개' : '\n모두 통과');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
