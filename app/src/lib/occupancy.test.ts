import { describe, expect, it } from 'vitest';
import { dayStats, DEFAULT_JORNADA, entriesByDay, holidayOf, hmin, jornadaMinutes } from './occupancy';
import type { TimeEntry } from './types';

const te = (id: string, demand: string | null, free: string | null, s: Date, e: Date | null): TimeEntry => ({
  id, demand_id: demand, free_activity: free, pomodoro_id: null, started_at: s.toISOString(), ended_at: e?.toISOString() ?? null, duration_seconds: null, note: null,
});
const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m); // outubro/2026, fuso local

describe('jornada e feriados', () => {
  it('jornada padrão é 8h', () => expect(jornadaMinutes(DEFAULT_JORNADA)).toBe(480));
  it('feriados nacionais, inclusive móveis', () => {
    expect(holidayOf('2026-09-07')).toBe('Independência do Brasil');
    expect(holidayOf('2026-04-03')).toBe('Sexta-feira Santa'); // Páscoa 2026 = 5/abr
    expect(holidayOf('2027-03-26')).toBe('Sexta-feira Santa'); // Páscoa 2027 = 28/mar
    expect(holidayOf('2026-11-20')).toBe('Dia da Consciência Negra');
    expect(holidayOf('2026-09-30')).toBeNull();
  });
  it('hmin', () => { expect(hmin(45)).toBe('45 min'); expect(hmin(120)).toBe('2h'); expect(hmin(125)).toBe('2h 05'); });
});

describe('entriesByDay', () => {
  it('sessão rodando vai até agora e sessão que vira a noite é dividida', () => {
    const map = entriesByDay([
      te('1', 'A', null, at(9), at(10, 30)),
      te('2', null, 'E-mails', at(23, 0, 1), at(1, 0, 2)),
      te('3', 'B', null, at(14, 0, 2), null),
    ], +at(15, 0, 2));
    expect(map.get('2026-10-01')).toEqual([{ key: 'd:A', start: 540, end: 630 }, { key: 'f:E-mails', start: 1380, end: 1440 }]);
    expect(map.get('2026-10-02')).toEqual([{ key: 'f:E-mails', start: 0, end: 60 }, { key: 'd:B', start: 840, end: 900 }]);
  });
});

describe('dayStats', () => {
  const groupOf = (id: string) => (id === 'A' ? 'g1' : '');
  it('reunião conta só o que não coincide com tempo registrado', () => {
    const st = dayStats('2026-10-01', [
      { key: 'd:A', start: 540, end: 600 }, // 09:00–10:00
      { key: 'f:E-mails', start: 600, end: 630 },
    ], [
      { title: 'Daily', start: '09:30', end: '10:30' }, // toda sobre tempo registrado
      { title: 'Outra', start: '10:15', end: '10:45' }, // só 10:30–10:45 fica livre
    ], DEFAULT_JORNADA, groupOf);
    expect(st).toMatchObject({ dem: 60, free: 30, meet: 15, used: 105, J: 480, pct: 22, idle: 375 });
    expect(st.byGroup.get('g1')).toBe(60);
    expect(st.byKey.get('f:E-mails')).toBe(30);
  });
  it('fim de semana e feriado não têm jornada', () => {
    expect(dayStats('2026-10-03', [{ key: 'd:A', start: 600, end: 660 }], [], DEFAULT_JORNADA, groupOf)).toMatchObject({ J: 0, pct: null, used: 60 });
    expect(dayStats('2026-10-12', [], [], DEFAULT_JORNADA, groupOf).J).toBe(0);
  });
});
