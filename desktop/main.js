// 대동 CAD 데스크톱 앱 (Electron). 화면은 dist/daedong-cad.html을 그대로 쓰고,
// 파일 열기·저장·PDF만 PC에 직접 한다. 인터넷으로 나가는 요청은 모두 막는다.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const atomicStore = require('./atomic-store.cjs');
const { MAX_WORK_BYTES } = require('./app/safety.js');

// The release uses its own profile; the original 1.4.0 profile is never migrated
// or overwritten implicitly. An explicit test path isolates release validation.
const testProfile = process.env.DCAD_TEST_PROFILE;
if (testProfile && !path.isAbsolute(testProfile)) throw new Error('격리 시험 프로필은 절대 경로여야 합니다.');
const profilePath = testProfile || path.join(app.getPath('appData'), 'DaedongCAD-Release');
fs.mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);
app.setPath('sessionData', profilePath);
app.commandLine.appendSwitch('user-data-dir', profilePath);
if (process.platform === 'win32') app.setAppUserModelId('com.daedongcad.desktop.release');

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
let pendingRecoveryClose = null;
let currentStamp = null;
let lastDir = null;
let firstFile = fileArg(process.argv);
// Each open/save yields an opaque, path-bound snapshot token; a failed open never changes an existing token.
const fileTokens = new Map();
const MAX_FILE_TOKENS = 4096;

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
  if (process.platform === 'win32' && !testProfile) app.addRecentDocument(p);
}

function issueFileToken(p, fingerprint) {
  const token = crypto.randomBytes(24).toString('hex');
  if (fileTokens.size >= MAX_FILE_TOKENS) fileTokens.delete(fileTokens.keys().next().value);
  fileTokens.set(token, { path: path.resolve(p), fingerprint });
  return token;
}
function expectedForToken(p, token) {
  const entry = typeof token === 'string' ? fileTokens.get(token) : null;
  if (!entry || entry.path !== path.resolve(p)) {
    const e = new Error('현재 작업 파일의 저장 기준을 확인할 수 없습니다. 다른 이름으로 저장하세요.');
    e.code = 'EFILETOKEN'; throw e;
  }
  return entry.fingerprint;
}
function readBoundedWork(p) {
  const fd = fs.openSync(p, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_WORK_BYTES) {
      const e = new Error('작업 파일이 64 MiB 한도를 초과합니다. 기존 도면은 유지됩니다.'); e.code = 'EWORKTOOLARGE'; throw e;
    }
    const data = Buffer.allocUnsafe(size); let offset = 0;
    while (offset < size) {
      const count = fs.readSync(fd, data, offset, size - offset, offset);
      if (!count) { const e = new Error('읽는 중 파일이 바뀌었습니다. 다시 시도하세요.'); e.code = 'EFILECHANGED'; throw e; }
      offset += count;
    }
    if (fs.fstatSync(fd).size !== size) { const e = new Error('읽는 중 파일이 바뀌었습니다. 다시 시도하세요.'); e.code = 'EFILECHANGED'; throw e; }
    return data;
  } finally { fs.closeSync(fd); }
}
function readDoc(p) {
  p = path.resolve(p);
  const data = /\.(?:json|dcad)$/i.test(p) ? readBoundedWork(p) : fs.readFileSync(p);
  const token = issueFileToken(p, { size: data.length, sha256: atomicStore.digest(data) });
  lastDir = path.dirname(p);
  pushRecent(p);
  return { path: p, name: path.basename(p), data, token };
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

function writeOut(p, data, token) {
  p = path.resolve(p);
  // No token is used only after the save dialog explicitly selected this destination.
  const expected = token === undefined ? atomicStore.fingerprint(p) : expectedForToken(p, token);
  const saved = atomicStore.writeAtomic(p, data, { expected });
  const nextToken = issueFileToken(p, saved.fingerprint);
  lastDir = path.dirname(p);
  pushRecent(p);
  return { path: p, name: path.basename(p), backupPath: saved.backupPath, token: nextToken };
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
ipcMain.handle('dcad:confirm-replace', async () => {
  const r = await dialog.showMessageBox(win, {
    type: 'question', title: '저장되지 않은 작업',
    message: '현재 작업을 저장하고 계속할까요?',
    detail: '복구된 작업은 정식 작업 파일로 저장하기 전까지 미저장 상태입니다.',
    buttons: ['작업 저장', '저장하지 않고 계속', '취소'], defaultId: 0, cancelId: 2, noLink: true
  });
  return ['save', 'discard', 'cancel'][r.response] || 'cancel';
});
ipcMain.handle('dcad:choose-units', async (e, code) => {
  const inch = code === 1;
  const r = await dialog.showMessageBox(win, {
    type: 'question', title: '도면 단위 확인',
    message: inch ? '인치 도면을 mm로 변환할까요?' : '도면의 단위를 선택해 주세요.',
    detail: inch ? '길이는 25.4배로 변환합니다.' : '단위를 알 수 없으면 취소하고 원본을 확인하세요.',
    buttons: inch ? ['인치→mm 변환', '취소'] : ['mm로 읽기', '인치→mm 변환', '취소'],
    defaultId: 0, cancelId: inch ? 1 : 2, noLink: true
  });
  return inch ? (r.response === 0 ? 'inch' : 'cancel') : (['mm', 'inch', 'cancel'][r.response] || 'cancel');
});
ipcMain.handle('dcad:choose-recovery', async (e, labels) => {
  if (!Array.isArray(labels) || !labels.length || labels.length > 3 || labels.some(x => typeof x !== 'string' || x.length > 80)) return -1;
  const r = await dialog.showMessageBox(win, {
    type: 'question', title: '복구 보관본', message: '열 복구본을 선택하세요.',
    buttons: labels.map((x, i) => (i + 1) + '. ' + x).concat('취소'),
    defaultId: 0, cancelId: labels.length, noLink: true
  });
  return r.response < labels.length ? r.response : -1;
});
ipcMain.handle('dcad:save', async (e, req) => {
  const cur = req.path ? path.resolve(String(req.path)) : null;
  if (req.kind === 'work' || (cur && /\.(?:json|dcad)$/i.test(cur))) {
    const size = typeof req.data === 'string' ? Buffer.byteLength(req.data,'utf8') :
      (ArrayBuffer.isView(req.data) || req.data instanceof ArrayBuffer ? req.data.byteLength : -1);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_WORK_BYTES) {
      const e = new Error('작업 파일이 64 MiB 한도를 초과하거나 올바르지 않아 저장하지 않았습니다.');e.code='EWORKTOOLARGE';throw e;
    }
  }
  if (cur && typeof req.fileToken !== 'string') throw new Error('현재 작업 파일의 저장 기준이 없어 다른 이름으로 저장해야 합니다.');
  const p = cur || await askSavePath(String(req.name || '도면'), req.kind, req.path || null);
  return p ? writeOut(p, req.data, cur ? req.fileToken : undefined) : null;
});
ipcMain.handle('dcad:pdf', async (e, req) => {
  const p = await askSavePath(String(req.name || '도면.pdf'), 'pdf', null);
  if (!p) return null;
  const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: false, margins: { marginType: 'none' } });
  return writeOut(p, pdf);
});
ipcMain.on('dcad:dirty', (e, d) => {
  if (!win || e.sender !== win.webContents) return;
  dirty = !!(d && typeof d === 'object' ? d.dirty : d);
  if (d && typeof d === 'object') currentStamp = { sessionId: d.sessionId, revision: d.revision };
});
ipcMain.on('dcad:close-now', () => { allowClose = true; if (win) win.close(); });
ipcMain.on('dcad:recovery-close-result', (e, result) => {
  if (!win || e.sender !== win.webContents || !pendingRecoveryClose || !result || result.token !== pendingRecoveryClose) return;
  pendingRecoveryClose = null;
  if (!result.ok || !currentStamp || result.sessionId !== currentStamp.sessionId || result.revision !== currentStamp.revision) {
    win.webContents.send('dcad:recovery-close-cancelled');
    void dialog.showMessageBox(win, {
      type: 'error', title: '작업 보관 실패', buttons: ['확인'],
      message: '최신 작업의 복구 보관을 확인하지 못해 창을 닫지 않았습니다.',
      detail: '작업 파일로 저장하거나 보관 공간을 확인한 뒤 다시 시도하세요.'
    });
    return;
  }
  allowClose = true; win.close();
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '대동 CAD ' + app.getVersion(),
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
      detail: '저장하지 않고 닫기를 선택하면 최신 복구 보관을 확인한 후 닫습니다.'
    });
    if (r === 1 && !pendingRecoveryClose) {
      pendingRecoveryClose = crypto.randomBytes(16).toString('hex');
      win.webContents.send('dcad:recovery-close', pendingRecoveryClose);
    } else if (r === 0) win.webContents.send('dcad:save-and-close');
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
