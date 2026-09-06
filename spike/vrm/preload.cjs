const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  report: (line) => ipcRenderer.send('spike:report', line),
  done: () => ipcRenderer.send('spike:done'),
});
