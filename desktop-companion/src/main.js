const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const os = require('os');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: 'EchoLink Desktop Companion',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b111f' : '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('companion:get-device-info', async () => ({
    deviceName: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    appVersion: app.getVersion(),
    defaultServerUrl: 'http://localhost:3000',
    capabilities: {
      localApprovalUi: true,
      sessionPolling: true,
      screenCapture: false,
      nativeInputControl: false,
      auditBanner: false
    }
  }));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
