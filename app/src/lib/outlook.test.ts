import { describe, expect, it } from 'vitest';
import { meetingAt, nextFreeTime } from './conflict';
import { fromRow, staleIds, toDayMeetings, type OutlookEvent } from './outlook';

// Datas montadas no fuso local, para o teste valer em qualquer fuso.
const ev = (id: string, s: Date, e: Date): OutlookEvent => ({ id, title: id, start: s.toISOString(), end: e.toISOString(), allDay: false, showAs: 'busy', webLink: null });

describe('toDayMeetings', () => {
  it('agrupa por dia local e ordena pelo início', () => {
    const map = toDayMeetings([
      ev('Comitê', new Date(2026, 9, 1, 14, 0), new Date(2026, 9, 1, 15, 30)),
      ev('Daily', new Date(2026, 9, 1, 9, 0), new Date(2026, 9, 1, 9, 15)),
      ev('1:1', new Date(2026, 9, 2, 10, 0), new Date(2026, 9, 2, 10, 30)),
    ]);
    expect(map.get('2026-10-01')!.map((m) => `${m.title} ${m.start}-${m.end}`)).toEqual(['Daily 09:00-09:15', 'Comitê 14:00-15:30']);
    expect(map.get('2026-10-02')![0]).toMatchObject({ start: '10:00', end: '10:30', date: '2026-10-02' });
  });

  it('reunião que passa da meia-noite é dividida entre os dois dias', () => {
    const map = toDayMeetings([ev('Plantão', new Date(2026, 9, 1, 23, 0), new Date(2026, 9, 2, 1, 0))]);
    expect(map.get('2026-10-01')![0]).toMatchObject({ start: '23:00', end: '24:00' });
    expect(map.get('2026-10-02')![0]).toMatchObject({ start: '00:00', end: '01:00' });
  });

  it('ignora evento sem duração', () => {
    const d = new Date(2026, 9, 1, 9, 0);
    expect(toDayMeetings([ev('x', d, d)]).size).toBe(0);
  });

  it('conflito e "Mover para" usam as reuniões do dia do prazo', () => {
    const day = toDayMeetings([
      ev('Daily', new Date(2026, 9, 5, 9, 0), new Date(2026, 9, 5, 9, 30)),
      ev('Comitê', new Date(2026, 9, 5, 9, 30), new Date(2026, 9, 5, 10, 0)),
    ]).get('2026-10-05')!;
    expect(meetingAt('09:45:00', day)?.title).toBe('Comitê');
    expect(nextFreeTime('09:10', day)).toBe('10:00');
  });
});

describe('blocksTime', () => {
  it('livre e dia inteiro não entram na agenda nem nos conflitos', () => {
    const d = (h: number) => new Date(2026, 9, 7, h, 0);
    const base = ev('Reunião', d(9), d(10));
    const map = toDayMeetings([
      base,
      { ...ev('Livre', d(11), d(12)), showAs: 'free' },
      { ...ev('Feriado', d(0), d(23)), allDay: true },
      { ...ev('Talvez', d(14), d(15)), showAs: 'tentative' },
    ]);
    expect(map.get('2026-10-07')!.map((m) => m.title)).toEqual(['Reunião', 'Talvez']);
  });
});

describe('cópia no banco', () => {
  it('apaga só o que sumiu do Outlook', () => {
    const d = new Date(2026, 9, 7, 9);
    const events = [ev('a', d, new Date(+d + 3600e3)), ev('b', d, new Date(+d + 3600e3))];
    expect(staleIds([{ id: '1', external_id: 'a' }, { id: '2', external_id: 'x' }, { id: '3', external_id: 'b' }], events)).toEqual(['2']);
  });
  it('linha do banco volta como evento', () => {
    expect(fromRow({ external_id: 'e1', subject: null, starts_at: 's', ends_at: 'e', is_all_day: false, show_as: null, location: 'Sala', web_link: null }))
      .toEqual({ id: 'e1', title: '(sem assunto)', start: 's', end: 'e', allDay: false, showAs: 'busy', webLink: null, location: 'Sala' });
  });
});
