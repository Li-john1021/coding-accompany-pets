const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenshot', {
  onInit: (callback) => ipcRenderer.on('v2p:screenshot:init', (_event, payload) => callback(payload)),
  onSelection: (callback) => ipcRenderer.on('v2p:screenshot:selection', (_event, rect) => callback(rect)),
  onCompose: (callback) => ipcRenderer.on('v2p:screenshot:compose', (_event, payload) => callback(payload)),
  ready: (payload) => ipcRenderer.send('v2p:screenshot:ready', payload),
  pointer: (payload) => ipcRenderer.send('v2p:screenshot:pointer', payload),
  cancel: (payload) => ipcRenderer.send('v2p:screenshot:cancel', payload),
  composed: (payload) => ipcRenderer.send('v2p:screenshot:composed', payload)
});
