// Ponte mínima: o renderer não tem acesso ao Node.
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch, arg) => ipcRenderer.invoke(ch, arg).then((r) => {
  if (r && r.error) throw new Error(r.error);
  return r.ok;
});

contextBridge.exposeInMainWorld('pauta', {
  platform: process.platform,
  isElectron: true,
  mini: {
    get: () => call('mini:get'),
    set: (patch) => call('mini:set', patch),
    show: () => call('mini:show'),
    hide: () => call('mini:hide'),
    openMain: () => call('mini:openMain'),
  },
  /** Avisa as outras janelas que o cronômetro mudou. */
  changed: () => ipcRenderer.send('pauta:changed'),
  onChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on('pauta:changed', h);
    return () => ipcRenderer.removeListener('pauta:changed', h);
  },
  outlook: {
    status: () => call('outlook:status'),
    connect: (clientId, tenant) => call('outlook:connect', { clientId, tenant }),
    cancel: () => call('outlook:cancel'),
    disconnect: () => call('outlook:disconnect'),
    events: (from, to) => call('outlook:events', { from, to }),
  },
});
