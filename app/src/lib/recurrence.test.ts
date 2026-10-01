import { describe, expect, it } from 'vitest';
import { describeRule, monthTargetDay, nextOccurrences, occursOn } from './recurrence';
import { isoDate } from './format';
import type { Routine } from './types';

const base: Pick<Routine, 'freq' | 'interval_n' | 'by_weekday' | 'by_monthday' | 'business_days_only' | 'start_date' | 'end_date'> = {
  freq: 'daily', interval_n: 1, by_weekday: null, by_monthday: null, business_days_only: false, start_date: '2026-09-01', end_date: null,
};
const d = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
const dates = (xs: Date[]) => xs.map(isoDate);

describe('monthTargetDay', () => {
  it('último dia do mês', () => {
    expect(isoDate(monthTargetDay(d('2026-02-10'), -1, false))).toBe('2026-02-28');
  });
  it('dia 31 em mês de 30 dias cai no último dia', () => {
    expect(isoDate(monthTargetDay(d('2026-09-05'), 31, false))).toBe('2026-09-30');
  });
  it('último dia útil antecipa sábado para sexta', () => {
    // 31/10/2026 é sábado
    expect(isoDate(monthTargetDay(d('2026-10-01'), -1, true))).toBe('2026-10-30');
  });
  it('dia 1 no domingo com dia útil vai para a segunda seguinte', () => {
    // 01/11/2026 é domingo
    expect(isoDate(monthTargetDay(d('2026-11-15'), 1, true))).toBe('2026-11-02');
  });
});

describe('occursOn', () => {
  it('diária só dias úteis pula fim de semana', () => {
    const r = { ...base, business_days_only: true };
    expect(dates(nextOccurrences(r, d('2026-10-02'), 3))).toEqual(['2026-10-02', '2026-10-05', '2026-10-06']);
  });
  it('a cada 3 dias conta a partir do início', () => {
    const r = { ...base, interval_n: 3 };
    expect(dates(nextOccurrences(r, d('2026-09-02'), 3))).toEqual(['2026-09-04', '2026-09-07', '2026-09-10']);
  });
  it('semanal em seg e sex (ISO)', () => {
    const r = { ...base, freq: 'weekly' as const, by_weekday: [1, 5] };
    expect(dates(nextOccurrences(r, d('2026-09-30'), 3))).toEqual(['2026-10-02', '2026-10-05', '2026-10-09']);
  });
  it('quinzenal alinha pela semana do início', () => {
    const r = { ...base, freq: 'weekly' as const, by_weekday: [3], interval_n: 2, start_date: '2026-09-30' };
    expect(dates(nextOccurrences(r, d('2026-09-30'), 3))).toEqual(['2026-09-30', '2026-10-14', '2026-10-28']);
  });
  it('domingo é 7', () => {
    const r = { ...base, freq: 'weekly' as const, by_weekday: [7] };
    expect(occursOn(r, d('2026-10-04'))).toBe(true);
  });
  it('mensal último dia útil', () => {
    const r = { ...base, freq: 'monthly' as const, by_monthday: [-1], business_days_only: true };
    expect(dates(nextOccurrences(r, d('2026-10-01'), 3))).toEqual(['2026-10-30', '2026-11-30', '2026-12-31']);
  });
  it('respeita início e fim', () => {
    const r = { ...base, start_date: '2026-10-01', end_date: '2026-10-03' };
    expect(dates(nextOccurrences(r, d('2026-09-28'), 10))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });
  it('anual em 29/02 cai em 28/02 nos anos comuns', () => {
    const r = { ...base, freq: 'yearly' as const, start_date: '2024-02-29' };
    expect(occursOn(r, d('2026-02-28'))).toBe(true);
  });
});

describe('describeRule', () => {
  it('frases', () => {
    expect(describeRule({ ...base, business_days_only: true, due_time: '08:30:00' })).toBe('Todo dia útil às 08:30');
    expect(describeRule({ ...base, freq: 'weekly', by_weekday: [5, 1] })).toBe('Toda semana: segunda, sexta');
    expect(describeRule({ ...base, freq: 'monthly', by_monthday: [-1], business_days_only: true, due_time: '18:00' })).toBe('Todo mês, no último dia útil às 18:00');
  });
});
