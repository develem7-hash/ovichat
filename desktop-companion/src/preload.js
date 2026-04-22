const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companionAPI', {
  getDeviceInfo: () => ipcRenderer.invoke('companion:get-device-info')
});
