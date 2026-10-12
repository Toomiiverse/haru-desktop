const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  report: (line) => ipcRenderer.send('spike:report', line),
  done: () => ipcRenderer.send('spike:done'),
  // The page cannot write files, so a bake goes over the bridge as bytes.
  bake: (buffer, out) => ipcRenderer.send('spike:bake', new Uint8Array(buffer), out),
});
