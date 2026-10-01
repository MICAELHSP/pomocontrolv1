// Processo principal do Electron: abre a janela do Pauta.
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');
const { registerOutlook } = require('./outlook.cjs');
const { setupMini } = require('./mini.cjs');

const devUrl = process.env.VITE_DEV_SERVER_URL;
const preload = path.join(__dirname, 'preload.cjs');
let mainWin = null;

/** Carrega a interface; `hash` escolhe a tela (ex.: "mini"). */
function loadPage(win, hash) {
  if (devUrl) win.loadURL(hash ? `${devUrl}#${hash}` : devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), hash ? { hash } : undefined);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    title: 'Pauta',
    backgroundColor: '#E9EDEF',
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Minimizado, o relógio do pomodoro precisa continuar virando de fase.
      backgroundThrottling: false,
    },
  });
  mainWin = win;
  win.on('closed', () => { mainWin = null; });

  // Links externos abrem no navegador, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    if (!url.startsWith('file://')) e.preventDefault();
  });

  setupMini(win, { preload, load: loadPage });
  loadPage(win);
}

app.setAppUserModelId('br.micael.pauta');
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = mainWin;
    if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  });
  app.whenReady().then(() => {
    // No mac o menu padrão é o que dá Cmd+C/Cmd+V; nos outros some.
    if (!devUrl && process.platform !== 'darwin') Menu.setApplicationMenu(null);
    registerOutlook();
    createWindow();
    app.on('activate', () => { if (!mainWin) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
