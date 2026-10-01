import { describe, expect, it } from 'vitest';
import { parseIcs } from './ics';
import { mergeEvents } from './outlook';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:Microsoft Exchange Server 2010
BEGIN:VTIMEZONE
TZID:E. South America Standard Time
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:-0300
TZOFFSETTO:-0300
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:semanal@x
SUMMARY:Reunião semanal
LOCATION:Sala 2
DTSTART;TZID=E. South America Standard Time:20261005T100000
DTEND;TZID=E. South America Standard Time:20261005T110000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=E. South America Standard Time:20261012T100000
X-MICROSOFT-CDO-BUSYSTATUS:BUSY
END:VEVENT
BEGIN:VEVENT
UID:semanal@x
RECURRENCE-ID;TZID=E. South America Standard Time:20261019T100000
SUMMARY:Reunião semanal (remarcada)
DTSTART;TZID=E. South America Standard Time:20261019T140000
DTEND;TZID=E. South America Standard Time:20261019T150000
END:VEVENT
BEGIN:VEVENT
UID:cancelada@x
SUMMARY:Cancelada
STATUS:CANCELLED
DTSTART:20261006T130000Z
DTEND:20261006T140000Z
END:VEVENT
BEGIN:VEVENT
UID:feriado@x
SUMMARY:Folga
DTSTART;VALUE=DATE:20261007
DTEND;VALUE=DATE:20261008
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
UID:livre@x
SUMMARY:Bloqueio livre
DTSTART:20261008T120000Z
DTEND:20261008T130000Z
X-MICROSOFT-CDO-BUSYSTATUS:FREE
END:VEVENT
END:VCALENDAR`;

const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-10-27T00:00:00Z');

describe('parseIcs', () => {
  const ev = parseIcs(ICS, from, to);

  it('expande a repetição, respeita EXDATE e a ocorrência remarcada', () => {
    const w = ev.filter((e) => e.id.startsWith('semanal@x'));
    expect(w.map((e) => [e.start, e.title])).toEqual([
      ['2026-10-05T13:00:00.000Z', 'Reunião semanal'],
      ['2026-10-19T17:00:00.000Z', 'Reunião semanal (remarcada)'],
      ['2026-10-26T13:00:00.000Z', 'Reunião semanal'],
    ]);
    expect(w[0]).toMatchObject({ end: '2026-10-05T14:00:00.000Z', location: 'Sala 2', showAs: 'busy', allDay: false });
  });

  it('ignora cancelados e marca dia inteiro e livre', () => {
    expect(ev.some((e) => e.title === 'Cancelada')).toBe(false);
    expect(ev.find((e) => e.title === 'Folga')).toMatchObject({ allDay: true, showAs: 'free' });
    expect(ev.find((e) => e.title === 'Bloqueio livre')?.showAs).toBe('free');
  });

  it('ids estáveis para reimportar sem duplicar', () => {
    expect(parseIcs(ICS, from, to).map((e) => e.id)).toEqual(ev.map((e) => e.id));
    expect(new Set(ev.map((e) => e.id)).size).toBe(ev.length);
  });

  it('recusa arquivo que não é calendário', () => {
    expect(() => parseIcs('olá', from, to)).toThrow(/não é um calendário/);
  });
});

describe('mergeEvents', () => {
  it('não repete o mesmo evento vindo do Outlook e do .ics', () => {
    const a = { id: 'o1', title: 'Daily', start: '2026-10-05T13:00:00Z', end: '2026-10-05T13:15:00Z', allDay: false, showAs: 'busy', webLink: null };
    const b = { ...a, id: 'i1', title: 'daily ', start: '2026-10-05T13:00:00.000Z', end: '2026-10-05T13:15:00.000Z' };
    expect(mergeEvents([a], [b, { ...b, id: 'i2', start: '2026-10-06T13:00:00Z', end: '2026-10-06T13:15:00Z' }]).map((e) => e.id)).toEqual(['o1', 'i2']);
  });
});
