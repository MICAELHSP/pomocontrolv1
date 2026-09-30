import { describe, expect, it } from 'vitest';
import { dayStats, meetingMinutes, mondayOf, occLabel, segmentsByDay } from './occupancy';
import type { TimeEntry } from './types';

const entry = (s: string, e: string | null, demand: string | null = 'd1'): TimeEntry => ({
  id: s, demand_id: demand, free_activity: demand ? null : 'Almoço de trabalho', pomodoro_id: null,
  started_at: new Date(s).toISOString(), ended_at: e && new Date(e).toISOString(), duration_seconds: null, note: null,
});

describe('ocupação', () => {
  it('reunião conta só a parte fora do tempo registrado', () => {
    expect(meetingMinutes([{ s: 540, e: 600 }], [{ s: 570, e: 630 }])).toBe(30);
    expect(meetingMinutes([{ s: 540, e: 600 }, { s: 550, e: 610 }], [])).toBe(70);
  });

  it('soma demandas, livres e reuniões sobre a jornada', () => {
    const segs = segmentsByDay([
      entry('2026-09-29T08:00', '2026-09-29T10:00'),
      entry('2026-09-29T13:00', '2026-09-29T14:00', null),
    ]).get('2026-09-29')!;
    const st = dayStats(segs, [{ s: 9 * 60, e: 11 * 60 }], 480, () => 'g1');
    expect(st.dem).toBe(120);
    expect(st.free).toBe(60);
    expect(st.meet).toBe(60);
    expect(st.pct).toBe(50);
    expect(st.idle).toBe(240);
    expect(st.byGroup.get('g1')).toBe(120);
    expect(occLabel(st.pct)).toBe('Com folga');
  });

  it('quebra trecho que passa da meia-noite e usa agora para o que está rodando', () => {
    const m = segmentsByDay([entry('2026-09-29T23:30', '2026-09-30T00:15')]);
    expect(m.get('2026-09-29')![0].e - m.get('2026-09-29')![0].s).toBe(30);
    expect(m.get('2026-09-30')![0].e).toBe(15);
    const r = segmentsByDay([entry('2026-09-30T08:00', null)], new Date('2026-09-30T08:40').getTime());
    expect(r.get('2026-09-30')![0].e).toBe(8 * 60 + 40);
  });

  it('segunda-feira da semana', () => {
    expect(mondayOf(new Date(2026, 8, 30)).getDate()).toBe(28);
    expect(mondayOf(new Date(2026, 9, 4)).getDate()).toBe(28);
  });
});
