// 대동 CAD 데스크톱 앱 (Electron). 화면은 dist/daedong-cad.html을 그대로 쓰고,
// 파일 열기·저장·PDF만 PC에 직접 한다. 인터넷으로 나가는 요청은 모두 막는다.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, 'app', 'daedong-cad.html');
const OPENABLE = /\.(dxf|json|dcad)$/i;
const FILTERS = {
  open: [{ name: '도면 (DXF, 작업 파일)', extensions: ['dxf', 'json', 'dcad'] }, { name: '모든 파일', extensions: ['*'] }],
  dxf: [{ name: 'DXF 도면', extensions: ['dxf'] }],
  work: [{ name: '대동 CAD 작업 파일', extensions: ['json'] }],
  png: [{ name: 'PNG 그림', extensions: ['png'] }],
  svg: [{ name: 'SVG 그림', extensions: ['svg'] }],
  csv: [{ name: 'CSV (엑셀)', extensions: ['csv'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }]
};

let win = null;
let dirty = false;
let allowClose = false;
let lastDir = null;
let firstFile = fileArg(process.argv);
// 대화상자로 고르거나 연 파일만 묻지 않고 덮어쓴다
const known = new Set();

// 실행 인자에서 열 파일 찾기 (DXF를 두 번 클릭하면 경로가 들어온다)
function fileArg(argv) {
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-') || !OPENABLE.test(a)) continue;
    try { if (fs.statSync(a).isFile()) return path.resolve(a); } catch (e) { /* 없는 파일 */ }
  }
  return null;
}

// 최근 도면 (열거나 저장한 DXF·작업 파일, 10개까지). 앱 자료 폴더의 recent.json에 둔다
const RECENT_MAX = 10;
function recentPath() { return path.join(app.getPath('userData'), 'recent.json'); }
function loadRecent() {
  try { return JSON.parse(fs.readFileSync(recentPath(), 'utf8')).filter((p) => typeof p === 'string'); } catch (e) { return []; }
}
function pushRecent(p) {
  if (!OPENABLE.test(p)) return;
  const list = [p].concat(loadRecent().filter((q) => q.toLowerCase() !== p.toLowerCase())).slice(0, RECENT_MAX);
  try { fs.writeFileSync(recentPath(), JSON.stringify(list)); } catch (e) { /* 기록 실패는 무시 */ }
  if (process.platform === 'win32') app.addRecentDocument(p);
}

function readDoc(p) {
  const data = fs.readFileSync(p);
  known.add(p);
  lastDir = path.dirname(p);
  pushRecent(p);
  return { path: p, name: path.basename(p), data };
}

function defaultDir() {
  return lastDir || app.getPath('documents');
}

async function askSavePath(name, kind, cur) {
  const r = await dialog.showSaveDialog(win, {
    title: '저장',
    defaultPath: cur || path.join(defaultDir(), name),
    filters: FILTERS[kind] || FILTERS.open
  });
  if (r.canceled || !r.filePath) return null;
  return r.filePath;
}

function writeOut(p, data) {
  fs.writeFileSync(p, typeof data === 'string' ? data : Buffer.from(data));
  known.add(p);
  lastDir = path.dirname(p);
  pushRecent(p);
  return { path: p, name: path.basename(p) };
}

ipcMain.handle('dcad:info', () => ({ version: app.getVersion() }));
ipcMain.handle('dcad:recent', () => loadRecent()
  .filter((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })
  .map((p) => ({ path: p, name: path.basename(p), dir: path.dirname(p) })));
ipcMain.handle('dcad:initial', () => {
  const f = firstFile;
  firstFile = null;
  return f ? readDoc(f) : null;
});
ipcMain.handle('dcad:read', (e, p) => {
  const f = path.resolve(String(p));
  if (!OPENABLE.test(f)) throw new Error('DXF나 작업 파일(.dcad.json)만 열 수 있습니다.');
  return readDoc(f);
});
ipcMain.handle('dcad:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: '열기', defaultPath: defaultDir(), filters: FILTERS.open, properties: ['openFile'] });
  if (r.canceled || !r.filePaths.length) return null;
  return readDoc(r.filePaths[0]);
});
ipcMain.handle('dcad:save', async (e, req) => {
  const cur = req.path && known.has(req.path) ? req.path : null;
  const p = cur || await askSavePath(String(req.name || '도면'), req.kind, req.path || null);
  return p ? writeOut(p, req.data) : null;
});
ipcMain.handle('dcad:pdf', async (e, req) => {
  const p = await askSavePath(String(req.name || '도면.pdf'), 'pdf', null);
  if (!p) return null;
  const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: false, margins: { marginType: 'none' } });
  return writeOut(p, pdf);
});
ipcMain.on('dcad:dirty', (e, d) => { dirty = !!d; });
ipcMain.on('dcad:close-now', () => { allowClose = true; if (win) win.close(); });

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '대동 CAD',
    backgroundColor: '#15171c',
    icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => {
    if (!process.env.DCAD_NO_MAXIMIZE) win.maximize();
    win.show();
  });
  // 다른 페이지로 넘어가거나 새 창을 여는 일은 없다 (파일을 엉뚱한 곳에 떨어뜨려도 그대로)
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', (e) => {
    if (allowClose || !dirty) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: '대동 CAD',
      message: '바뀐 내용을 저장할까요?',
      detail: '저장하지 않아도 지금 작업은 프로그램 안에 보관되어, 다음에 열면 이어서 나옵니다.'
    });
    if (r === 1) { allowClose = true; win.close(); } else if (r === 0) win.webContents.send('dcad:save-and-close');
  });
  win.on('closed', () => { win = null; });
  win.loadFile(PAGE);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 이미 열려 있을 때 DXF를 또 두 번 클릭하면 그 창에서 연다
  app.on('second-instance', (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = fileArg(argv);
    if (f) win.webContents.send('dcad:open-path', f);
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|blob|data|devtools):/i.test(d.url) }));
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
