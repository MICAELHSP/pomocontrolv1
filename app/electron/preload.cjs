// Ponte mínima: o renderer não tem acesso ao Node.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('pauta', { platform: process.platform, isElectron: true });
