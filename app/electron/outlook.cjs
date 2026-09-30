// Integração com o calendário do Outlook (Microsoft Graph, só leitura), no processo principal.
// Login: OAuth 2.0 com PKCE no navegador do sistema e retorno em http://localhost:<porta>.
// O token de renovação fica cifrado com o safeStorage do sistema em <userData>/outlook.json;
// o de acesso só em memória. Os eventos não são gravados em lugar nenhum.
const { app, ipcMain, safeStorage, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const core = require('./outlook-core.cjs');

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const file = () => path.join(app.getPath('userData'), 'outlook.json');

function readCfg() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
}
function writeCfg(cfg) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

let cfg = null; // { clientId, tenant, refreshEnc, account }
let sessionRefresh = null; // quando o sistema não cifra, o token vive só nesta sessão
let access = null; // { token, exp }
let pendingLogin = null;

const conf = () => (cfg ??= readCfg());
const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };

function getRefresh() {
  if (sessionRefresh) return sessionRefresh;
  const enc = conf().refreshEnc;
  if (!enc || !canEncrypt()) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
}
function setRefresh(rt) {
  const c = conf();
  if (rt && canEncrypt()) {
    c.refreshEnc = safeStorage.encryptString(rt).toString('base64');
    sessionRefresh = null;
  } else {
    delete c.refreshEnc;
    sessionRefresh = rt || null;
  }
  writeCfg(c);
}

function status() {
  const c = conf();
  return {
    available: true,
    clientId: c.clientId || '',
    tenant: c.tenant || 'common',
    connected: !!(c.clientId && getRefresh()),
    account: c.account || null,
    persistent: canEncrypt(),
  };
}

async function postToken(tenant, body) {
  const res = await fetch(core.tokenUrl(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(core.friendlyError(json.error_description ? json : json.error || `HTTP ${res.status}`));
  return json;
}

function keep(tok) {
  access = { token: tok.access_token, exp: Date.now() + (Number(tok.expires_in) || 3600) * 1000 - 60_000 };
  if (tok.refresh_token) setRefresh(tok.refresh_token);
}

async function accessToken() {
  if (access && access.exp > Date.now()) return access.token;
  const c = conf();
  const rt = getRefresh();
  if (!c.clientId || !rt) throw new Error('Outlook não conectado.');
  try {
    keep(await postToken(c.tenant, core.refreshBody({ clientId: c.clientId, refreshToken: rt })));
  } catch (e) {
    if (/expirou|revogado|AADSTS700082|AADSTS70000/.test(e.message)) { setRefresh(null); access = null; }
    throw e;
  }
  return access.token;
}

async function graph(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await accessToken()}`, Prefer: 'outlook.timezone="UTC"' },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) access = null;
  if (!res.ok) throw new Error(core.friendlyError(json.error?.message || `Microsoft Graph respondeu ${res.status}`));
  return json;
}

const page = (html) => `<!doctype html><meta charset="utf-8"><title>Pauta</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#15222B">
<div style="text-align:center"><h2>${html}</h2><p>Pode fechar esta aba e voltar ao Pauta.</p></div></body>`;

/** Abre o login da Microsoft no navegador e espera o retorno no localhost. */
function login(clientId, tenant) {
  return new Promise((resolve, reject) => {
    const { verifier, challenge } = core.pkce();
    const state = core.b64url(crypto.randomBytes(16));
    let redirectUri = '';
    let timer = null;
    const done = (err, val) => {
      clearTimeout(timer);
      server.close();
      pendingLogin = null;
      if (err) reject(err); else resolve(val);
    };
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname !== '/') { res.writeHead(404).end(); return; }
      const p = u.searchParams;
      if (p.get('state') !== state) { res.writeHead(400).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (p.get('error')) {
        res.end(page('Não foi possível conectar.'));
        done(new Error(core.friendlyError(p.get('error_description') || p.get('error'))));
        return;
      }
      try {
        const tok = await postToken(tenant, core.codeBody({ clientId, code: p.get('code'), redirectUri, verifier }));
        res.end(page('Outlook conectado ao Pauta.'));
        done(null, tok);
      } catch (e) {
        res.end(page('Não foi possível conectar.'));
        done(e);
      }
    });
    server.on('error', (e) => done(e));
    // Igual ao MSAL: escuta só no 127.0.0.1 e registra http://localhost (a porta é livre no Azure).
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://localhost:${server.address().port}`;
      timer = setTimeout(() => done(new Error('O login não foi concluído em 5 minutos.')), LOGIN_TIMEOUT_MS);
      pendingLogin = () => done(new Error('Login cancelado.'));
      shell.openExternal(core.authorizeUrl({ clientId, tenant, redirectUri, challenge, state }));
    });
  });
}

async function connect({ clientId, tenant } = {}) {
  clientId = String(clientId || '').trim();
  tenant = String(tenant || '').trim() || 'common';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new Error('O ID do aplicativo tem o formato 00000000-0000-0000-0000-000000000000. Copie de "Visão geral" no registro do Azure.');
  }
  if (!/^[\w.-]+$/.test(tenant)) throw new Error('Locatário inválido. Deixe "common" ou use o domínio/ID da sua empresa.');
  if (pendingLogin) pendingLogin();
  const tok = await login(clientId, tenant);
  cfg = { ...conf(), clientId, tenant, account: null };
  keep(tok);
  try {
    const me = await graph(`${core.GRAPH}/me?$select=displayName,mail,userPrincipalName`);
    cfg.account = { name: me.displayName || '', email: me.mail || me.userPrincipalName || '' };
  } catch { /* conta é só rótulo */ }
  writeCfg(cfg);
  return status();
}

function disconnect() {
  access = null;
  const c = conf();
  delete c.account;
  setRefresh(null);
  return status();
}

async function events({ from, to } = {}) {
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b) || b <= a || b - a > 120 * 864e5) throw new Error('Intervalo de datas inválido.');
  let url = core.calendarViewUrl(a.toISOString(), b.toISOString());
  const out = [];
  for (let i = 0; url && i < 20; i++) {
    const json = await graph(url);
    for (const e of json.value || []) if (core.blocksTime(e)) out.push(core.mapEvent(e));
    url = json['@odata.nextLink'];
  }
  return out;
}

// Erros viram { error } para a mensagem chegar inteira ao renderer.
const wrap = (fn) => async (_e, arg) => {
  try { return { ok: await fn(arg) }; } catch (e) { return { error: e?.message || String(e) }; }
};

function registerOutlook() {
  ipcMain.handle('outlook:status', wrap(status));
  ipcMain.handle('outlook:connect', wrap(connect));
  ipcMain.handle('outlook:cancel', wrap(() => { if (pendingLogin) pendingLogin(); return true; }));
  ipcMain.handle('outlook:disconnect', wrap(disconnect));
  ipcMain.handle('outlook:events', wrap(events));
}

module.exports = { registerOutlook };
