// Ponte mínima: o renderer não tem acesso ao Node.
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch, arg) => ipcRenderer.invoke(ch, arg).then((r) => {
  if (r && r.error) throw new Error(r.error);
  return r.ok;
});

contextBridge.exposeInMainWorld('pauta', {
  platform: process.platform,
  isElectron: true,
  outlook: {
    status: () => call('outlook:status'),
    connect: (clientId, tenant) => call('outlook:connect', { clientId, tenant }),
    cancel: () => call('outlook:cancel'),
    disconnect: () => call('outlook:disconnect'),
    events: (from, to) => call('outlook:events', { from, to }),
  },
});
