// Partes puras da integração com o Outlook (sem Electron nem rede), testáveis com vitest.
const crypto = require('node:crypto');

const SCOPES = ['offline_access', 'User.Read', 'Calendars.Read'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE: verificador aleatório e o desafio S256 dele. */
function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const authority = (tenant) => `https://login.microsoftonline.com/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0`;

function authorizeUrl({ clientId, tenant, redirectUri, challenge, state }) {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  });
  return `${authority(tenant)}/authorize?${q}`;
}

const tokenUrl = (tenant) => `${authority(tenant)}/token`;

function codeBody({ clientId, code, redirectUri, verifier }) {
  return new URLSearchParams({
    client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    code_verifier: verifier, scope: SCOPES.join(' '),
  });
}

function refreshBody({ clientId, refreshToken }) {
  return new URLSearchParams({
    client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPES.join(' '),
  });
}

function calendarViewUrl(fromIso, toIso) {
  const q = new URLSearchParams({
    startDateTime: fromIso,
    endDateTime: toIso,
    $select: 'id,subject,start,end,isAllDay,showAs,isCancelled,webLink',
    $orderby: 'start/dateTime',
    $top: '250',
  });
  return `${GRAPH}/me/calendarView?${q}`;
}

/** Evento do Graph (pedido com Prefer: outlook.timezone="UTC") -> evento simples em ISO UTC. */
function mapEvent(e) {
  const utc = (x) => (x && x.dateTime ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(x.dateTime) ? x.dateTime : x.dateTime + 'Z').toISOString() : null);
  return {
    id: e.id,
    title: e.subject || '(sem assunto)',
    start: utc(e.start),
    end: utc(e.end),
    allDay: !!e.isAllDay,
    showAs: e.showAs || 'busy',
    webLink: e.webLink || null,
  };
}

/** Só o que ocupa a agenda: cancelado, "livre" e dia inteiro ficam de fora. */
const blocksTime = (e) => !e.isCancelled && e.showAs !== 'free' && !e.isAllDay;

/** Erro do login/Graph -> mensagem em português com a dica do que fazer. */
function friendlyError(err) {
  const raw = String((err && (err.error_description || err.message)) || err || '');
  const code = (raw.match(/AADSTS\d+/) || [])[0];
  const hints = {
    AADSTS700016: 'O ID do aplicativo não foi encontrado. Confira o "ID do aplicativo (cliente)" copiado do Azure e o tipo de conta aceito no registro.',
    AADSTS50011: 'O endereço de retorno não confere. No registro do Azure, em Autenticação, adicione a plataforma "Aplicativos móveis e da área de trabalho" com http://localhost.',
    AADSTS7000218: 'O Azure está pedindo segredo. Em Autenticação, ative "Permitir fluxos de cliente público" e use a plataforma "Aplicativos móveis e da área de trabalho".',
    AADSTS65001: 'Falta consentimento para ler o calendário. Tente conectar de novo e aceite as permissões.',
    AADSTS90094: 'Sua empresa exige que um administrador aprove o acesso ao calendário. Peça ao TI para consentir o aplicativo.',
    AADSTS65004: 'O acesso foi recusado na tela da Microsoft.',
    AADSTS50020: 'Essa conta não é aceita pelo registro do aplicativo. No Azure, escolha contas pessoais e corporativas, ou preencha o locatário da sua empresa.',
    AADSTS70000: 'O login expirou. Conecte de novo.',
    AADSTS700082: 'O login expirou. Conecte de novo.',
  };
  if (code && hints[code]) return `${hints[code]} (${code})`;
  if (/access_denied/.test(raw)) return 'O acesso foi recusado na tela da Microsoft.';
  if (/invalid_grant/.test(raw)) return 'O login expirou ou foi revogado. Conecte de novo.';
  return raw ? raw.split('\n')[0].slice(0, 300) : 'Erro desconhecido ao falar com a Microsoft.';
}

module.exports = { SCOPES, GRAPH, pkce, authorizeUrl, tokenUrl, codeBody, refreshBody, calendarViewUrl, mapEvent, blocksTime, friendlyError, b64url };
