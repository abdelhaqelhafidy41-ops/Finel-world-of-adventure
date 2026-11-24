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
  worldStorage: {
    listWorlds: () => ipcRenderer.invoke('worldStorage:listWorlds'),
    readBundle: (worldId) => ipcRenderer.invoke('worldStorage:readBundle', worldId),
    writeBundle: (worldId, bundle) => ipcRenderer.invoke('worldStorage:writeBundle', worldId, bundle),
    deleteWorld: (worldId) => ipcRenderer.invoke('worldStorage:deleteWorld', worldId),
  },
  settingsStorage: {
    readAll: () => ipcRenderer.invoke('settingsStorage:readAll'),
    writeSetting: (settingKey, payload) =>
      ipcRenderer.invoke('settingsStorage:writeSetting', settingKey, payload),
    readProfile: () => ipcRenderer.invoke('settingsStorage:readProfile'),
    writeProfile: (payload) => ipcRenderer.invoke('settingsStorage:writeProfile', payload),
  },
  modStorage: {
    getInfo: () => ipcRenderer.invoke('modStorage:getInfo'),
    discoverMods: () => ipcRenderer.invoke('modStorage:discoverMods'),
    readState: () => ipcRenderer.invoke('modStorage:readState'),
    writeState: (payload) => ipcRenderer.invoke('modStorage:writeState', payload),
    readAsset: (sourceId, relativePath) =>
      ipcRenderer.invoke('modStorage:readAsset', sourceId, relativePath),
    deleteMod: (sourceId) => ipcRenderer.invoke('modStorage:deleteMod', sourceId),
    importPackage: (fileName, payload, options) =>
      ipcRenderer.invoke('modStorage:importPackage', fileName, payload, options),
    onInstallProgress: (listener) => {
      if (typeof listener !== 'function') return () => {};
      const handler = (_event, progress) => listener(progress);
      ipcRenderer.on('modStorage:installProgress', handler);
      return () => ipcRenderer.removeListener('modStorage:installProgress', handler);
    },
    openModsFolder: () => ipcRenderer.invoke('modStorage:openModsFolder'),
  },
});
