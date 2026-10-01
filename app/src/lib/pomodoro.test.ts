import { describe, expect, it } from 'vitest';
import { nextPhase, remainingSeconds, secondsByActivity, splitOfPomodoro } from './pomodoro';
import { meetingAt, nextFreeTime } from './conflict';
import { clock, dur } from './format';
import type { TimeEntry } from './types';

const e = (p: Partial<TimeEntry>): TimeEntry => ({ id: Math.random().toString(), demand_id: null, free_activity: null, pomodoro_id: null, started_at: '', ended_at: null, duration_seconds: null, note: null, ...p });

describe('nextPhase', () => {
  const st = { cycles_before_long: 4 };
  it('foco -> intervalo, e pausa longa no 4º', () => {
    expect(nextPhase({ kind: 'focus', cycle: 1 }, st)).toEqual({ kind: 'short_break', cycle: 1 });
    expect(nextPhase({ kind: 'focus', cycle: 4 }, st)).toEqual({ kind: 'long_break', cycle: 4 });
  });
  it('intervalo -> próximo foco, volta ao 1 depois da longa', () => {
    expect(nextPhase({ kind: 'short_break', cycle: 2 }, st)).toEqual({ kind: 'focus', cycle: 3 });
    expect(nextPhase({ kind: 'long_break', cycle: 4 }, st)).toEqual({ kind: 'focus', cycle: 1 });
  });
});

describe('divisão do foco entre atividades', () => {
  const t0 = Date.parse('2026-09-30T13:00:00Z');
  const at = (min: number) => new Date(t0 + min * 60000).toISOString();
  const entries = [
    e({ demand_id: 'A', pomodoro_id: 'P1', started_at: at(0), ended_at: at(10) }),
    e({ free_activity: 'E-mails', pomodoro_id: 'P1', started_at: at(10), ended_at: at(15) }),
    e({ demand_id: 'A', pomodoro_id: 'P1', started_at: at(15), ended_at: null }),
    e({ demand_id: 'B', pomodoro_id: 'P0', started_at: at(-30), ended_at: at(-5) }),
  ];
  it('soma por atividade dentro do pomodoro, com o trecho rodando', () => {
    expect(splitOfPomodoro('P1', entries, t0 + 20 * 60000)).toEqual([
      { key: 'd:A', seconds: 15 * 60 },
      { key: 'f:E-mails', seconds: 5 * 60 },
    ]);
  });
  it('tempo do dia corta trechos que começaram antes', () => {
    const m = secondsByActivity(entries, new Date(t0 - 10 * 60000), t0 + 20 * 60000);
    expect(m.get('d:B')).toBe(5 * 60);
    expect(m.get('d:A')).toBe(15 * 60);
  });
  it('tempo restante da fase', () => {
    expect(remainingSeconds({ planned_minutes: 25, started_at: at(0) }, t0 + 60000)).toBe(24 * 60);
  });
  it('tempo pausado não conta: a fase fica parada e retoma de onde estava', () => {
    // começou há 10 min, pausou aos 4 min (pausa em curso)
    expect(remainingSeconds({ planned_minutes: 25, started_at: at(0), paused_at: at(4), paused_seconds: 0 }, t0 + 600000)).toBe(21 * 60);
    // já retomado, com 6 min de pausas anteriores
    expect(remainingSeconds({ planned_minutes: 25, started_at: at(0), paused_at: null, paused_seconds: 360 }, t0 + 600000)).toBe(21 * 60);
  });
});

describe('conflito com reunião', () => {
  const meetings = [{ title: 'Daily', start: '09:00', end: '09:30' }, { title: 'Comitê', start: '09:30', end: '10:00' }];
  it('detecta e encadeia reuniões seguidas', () => {
    expect(meetingAt('09:15:00', meetings)?.title).toBe('Daily');
    expect(meetingAt('10:00', meetings)).toBeNull();
    expect(nextFreeTime('09:10', meetings)).toBe('10:00');
  });
});

describe('formatação', () => {
  it('relógios e durações', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(3723)).toBe('1:02:03');
    expect(dur(20)).toBe('0 min');
    expect(dur(3900)).toBe('1h 05');
  });
});
