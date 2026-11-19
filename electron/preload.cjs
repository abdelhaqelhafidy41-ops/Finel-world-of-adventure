const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,
  toggleFullscreen: () => ipcRenderer.invoke('desktop:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('desktop:is-fullscreen'),
  quitApp: () => ipcRenderer.invoke('desktop:quit-app'),
  lan: {
    startHost: (opts) => ipcRenderer.invoke('lan:start-host', opts),
    stopHost: () => ipcRenderer.invoke('lan:stop-host'),
    getStatus: () => ipcRenderer.invoke('lan:get-status'),
    getLocalIp: () => ipcRenderer.invoke('lan:get-local-ip'),
    discover: (timeoutMs) => ipcRenderer.invoke('lan:discover', timeoutMs),
  },
});
