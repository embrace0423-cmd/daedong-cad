// 화면(daedong-cad.html)에 PC 파일 기능만 좁게 열어 준다. 화면에서는 window.dcadDesktop으로 쓴다.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dcadDesktop', {
  info: () => ipcRenderer.invoke('dcad:info'),
  initialFile: () => ipcRenderer.invoke('dcad:initial'),
  open: () => ipcRenderer.invoke('dcad:open-dialog'),
  recent: () => ipcRenderer.invoke('dcad:recent'),
  read: (p) => ipcRenderer.invoke('dcad:read', p),
  save: (req) => ipcRenderer.invoke('dcad:save', req),
  pdf: (req) => ipcRenderer.invoke('dcad:pdf', req),
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
  setDirty: (d) => ipcRenderer.send('dcad:dirty', !!d),
  closeNow: () => ipcRenderer.send('dcad:close-now'),
  onOpenPath: (fn) => { ipcRenderer.on('dcad:open-path', (e, p) => fn(p)); },
  onSaveAndClose: (fn) => { ipcRenderer.on('dcad:save-and-close', () => fn()); }
});
