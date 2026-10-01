import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import core from './outlook-core.cjs';

describe('outlook-core', () => {
  it('PKCE: desafio é o SHA-256 base64url do verificador', () => {
    const { verifier, challenge } = core.pkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('URL de login pede só leitura do calendário, com PKCE e localhost', () => {
    const u = new URL(core.authorizeUrl({ clientId: 'abc', tenant: 'common', redirectUri: 'http://localhost:5555', challenge: 'ch', state: 'st' }));
    expect(u.origin + u.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(u.searchParams.get('scope')).toBe('offline_access User.Read Calendars.Read');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:5555');
    expect(u.searchParams.get('state')).toBe('st');
  });

  it('calendarView usa o intervalo e só os campos necessários', () => {
    const u = new URL(core.calendarViewUrl('2026-09-29T03:00:00.000Z', '2026-11-30T03:00:00.000Z'));
    expect(u.pathname).toBe('/v1.0/me/calendarView');
    expect(u.searchParams.get('startDateTime')).toBe('2026-09-29T03:00:00.000Z');
    expect(u.searchParams.get('$select')).toContain('showAs');
  });

  it('evento do Graph em UTC sem "Z" vira ISO UTC', () => {
    const e = core.mapEvent({ id: '1', subject: 'Daily', start: { dateTime: '2026-09-30T12:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-09-30T12:30:00.0000000', timeZone: 'UTC' }, showAs: 'busy' });
    expect(e).toMatchObject({ id: '1', title: 'Daily', start: '2026-09-30T12:00:00.000Z', end: '2026-09-30T12:30:00.000Z', allDay: false });
    expect(core.mapEvent({ id: '2', start: null, end: null }).title).toBe('(sem assunto)');
  });

  it('canceladas e recusadas ficam de fora', () => {
    expect(core.isReal({ showAs: 'busy' })).toBe(true);
    expect(core.isReal({ showAs: 'free', isAllDay: true })).toBe(true);
    expect(core.isReal({ isCancelled: true })).toBe(false);
    expect(core.isReal({ responseStatus: { response: 'declined' } })).toBe(false);
    expect(core.isReal({ responseStatus: { response: 'tentativelyAccepted' } })).toBe(true);
  });

  it('local da reunião vem do displayName', () => {
    expect(core.mapEvent({ id: '3', location: { displayName: 'Sala 2' } }).location).toBe('Sala 2');
  });

  it('erros do Azure viram dica em português', () => {
    expect(core.friendlyError({ error_description: 'AADSTS50011: The redirect URI ... does not match' })).toMatch(/Aplicativos móveis e da área de trabalho/);
    expect(core.friendlyError('invalid_grant')).toMatch(/Conecte de novo/);
  });
});
