// Throwaway. Answers two questions and then can be deleted:
//
//   1. does WebGL alpha survive a transparent, frameless, always-on-top window
//      the way the Live2D canvas does
//   2. what a VRM with MToon costs on the GPU, since the companion has to be
//      affordable while a game has the card
//
// Deliberately not wired into the app: the point is to find out whether the
// idea holds before any of src/companion is touched.

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');

const MODEL = process.env.SPIKE_VRM
  || path.join(app.getPath('appData'), 'haru-desktop', 'vrm-models', '586a41f2a5392895', 'Haruhi.vrm');

function createWindow() {
  const width = 420;
  const height = 700;
  const window_ = new BrowserWindow({
    width,
    height,
    // A fixed, known corner rather than the bottom right. The companion lives
    // bottom-right in real life, but a spike has to be screenshotted, and
    // working out where the window landed under a 1.5x scale factor was two
    // wrong captures before this.
    x: 100,
    y: 100,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // The same shape as the real companion window, so the answer transfers.
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  window_.setAlwaysOnTop(true, 'screen-saver');
  window_.loadFile(path.join(__dirname, 'index.html'), {
    query: {
      model: MODEL,
      opaque: process.env.SPIKE_OPAQUE ?? '',
      premul: process.env.SPIKE_PREMUL ?? '',
      fps: process.env.SPIKE_FPS ?? '',
      action: process.env.SPIKE_ACTION ?? '',
    },
  });
  return window_;
}

app.whenReady().then(() => {
  const window_ = createWindow();
  // The page reports back rather than being asked, so a run can be read from
  // the terminal without opening devtools over the thing being measured.
  ipcMain.on('spike:report', (_event, line) => console.log(line));
  ipcMain.on('spike:done', () => { window_.close(); app.quit(); });
});

app.on('window-all-closed', () => app.quit());
