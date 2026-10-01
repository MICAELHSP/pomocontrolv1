// Mini-janela flutuante: aparece ao minimizar o app, fica sempre no topo e lembra a posição.
const { app, BrowserWindow, ipcMain, nativeTheme, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const W = 300, H = 92;
const file = () => path.join(app.getPath('userData'), 'mini.json');

function load() {
  try { return { enabled: true, pinned: false, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { return { enabled: true, pinned: false }; }
}
function save(s) {
  try { fs.writeFileSync(file(), JSON.stringify(s)); } catch { /* sem disco: só não lembra */ }
}

/** Posição salva, se ainda couber em algum monitor; senão, canto inferior direito do monitor principal. */
function position(s) {
  if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
    const ok = screen.getAllDisplays().some(({ workArea: a }) => s.x >= a.x - W / 2 && s.x <= a.x + a.width - W / 2 && s.y >= a.y && s.y <= a.y + a.height - 30);
    if (ok) return { x: s.x, y: s.y };
  }
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - W - 16, y: a.y + a.height - H - 16 };
}

function setupMini(main, { preload, load: loadPage }) {
  let state = load();
  let mini = null;

  const create = () => {
    mini = new BrowserWindow({
      width: W, height: H, ...position(state),
      frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Pauta (mini)',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#141C21' : '#FFFFFF',
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mini.webContents.on('will-navigate', (e) => e.preventDefault());
    mini.setAlwaysOnTop(true, 'floating');
    mini.setVisibleOnAllWorkspaces(true);
    mini.on('moved', () => { const [x, y] = mini.getPosition(); state = { ...state, x, y }; save(state); });
    mini.on('closed', () => { mini = null; });
    loadPage(mini, 'mini');
  };

  const show = () => {
    if (!mini) create();
    const reveal = () => mini && mini.showInactive();
    if (mini.webContents.isLoading()) mini.webContents.once('did-finish-load', reveal); else reveal();
  };
  const hide = () => { if (mini && mini.isVisible()) mini.hide(); };

  main.on('minimize', () => { if (state.enabled) show(); });
  for (const ev of ['restore', 'show', 'focus']) main.on(ev, () => { if (!state.pinned) hide(); });
  main.on('closed', () => { if (mini) mini.destroy(); });

  ipcMain.handle('mini:get', () => ({ ok: { enabled: state.enabled, pinned: state.pinned } }));
  ipcMain.handle('mini:set', (_e, patch) => {
    state = { ...state, ...(patch || {}) };
    save(state);
    if (patch && patch.pinned === false && !main.isMinimized()) hide();
    return { ok: { enabled: state.enabled, pinned: state.pinned } };
  });
  ipcMain.handle('mini:show', () => { show(); return { ok: true }; });
  ipcMain.handle('mini:hide', () => { hide(); return { ok: true }; });
  ipcMain.handle('mini:openMain', () => {
    if (main.isMinimized()) main.restore();
    main.show(); main.focus();
    return { ok: true };
  });
  // Uma janela mudou o cronômetro: as outras releem os dados.
  ipcMain.on('pauta:changed', (e) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== e.sender) w.webContents.send('pauta:changed');
  });
}

module.exports = { setupMini };
