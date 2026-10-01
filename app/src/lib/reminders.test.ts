import { describe, expect, it } from 'vitest';
import { dueReminders, reminderKey, reminderText } from './reminders';
import type { Meeting } from './types';

const mt = (title: string, start: string, end = '23:59', date = '2026-10-01'): Meeting => ({ id: title, title, date, start, end });
const at = (h: number, m: number) => +new Date(2026, 9, 1, h, m);

describe('dueReminders', () => {
  const list = [mt('Daily', '09:00', '09:30'), mt('Comitê', '14:00', '15:00')];
  it('avisa só dentro da antecedência e antes de começar', () => {
    expect(dueReminders(list, at(8, 49), 10, new Set())).toEqual([]);
    expect(dueReminders(list, at(8, 50), 10, new Set()).map((m) => m.title)).toEqual(['Daily']);
    expect(dueReminders(list, at(8, 58), 10, new Set()).map((m) => m.title)).toEqual(['Daily']); // app aberto em cima da hora
    expect(dueReminders(list, at(9, 0), 10, new Set())).toEqual([]); // já começou
    expect(dueReminders(list, at(13, 45), 15, new Set()).map((m) => m.title)).toEqual(['Comitê']);
  });
  it('não repete o mesmo aviso, mas avisa de novo se a reunião for remarcada', () => {
    const sent = new Set([reminderKey(list[0])]);
    expect(dueReminders(list, at(8, 55), 10, sent)).toEqual([]);
    expect(dueReminders([mt('Daily', '09:05', '09:30')], at(8, 55), 10, sent).map((m) => m.start)).toEqual(['09:05']);
  });
  it('texto do aviso', () => {
    expect(reminderText({ ...list[0], location: 'Sala 2' }, at(8, 50))).toEqual({ title: 'Daily em 10 min', body: '09:00–09:30 · Sala 2' });
  });
});
