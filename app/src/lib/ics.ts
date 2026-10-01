// Importação de arquivo .ics (iCalendar): eventos de qualquer calendário exportado (Outlook,
// Google, Teams...). Ficam em demandas_app.calendar_events com source 'ics' e entram na agenda,
// na ocupação e nos avisos junto com as reuniões do Outlook.
import ICAL from 'ical.js';
import { addDays } from './format';
import type { OutlookEvent } from './outlook';
import { must, sb } from './supabase';

/** Ocorrências importadas: de 1 ano atrás até 1 ano à frente (repetições sem fim param aí). */
export const ICS_BEFORE_DAYS = 365, ICS_AFTER_DAYS = 365;
const MAX_EVENTS = 5000;

// X-MICROSOFT-CDO-BUSYSTATUS (Outlook) -> showAs do Graph.
const BUSY: Record<string, string> = { FREE: 'free', TENTATIVE: 'tentative', BUSY: 'busy', OOF: 'oof', WORKINGELSEWHERE: 'workingElsewhere' };

function showAsOf(ev: ICAL.Component): string {
  const ms = String(ev.getFirstPropertyValue('x-microsoft-cdo-busystatus') ?? '').toUpperCase();
  if (BUSY[ms]) return BUSY[ms];
  if (String(ev.getFirstPropertyValue('transp') ?? '').toUpperCase() === 'TRANSPARENT') return 'free';
  if (String(ev.getFirstPropertyValue('status') ?? '').toUpperCase() === 'TENTATIVE') return 'tentative';
  return 'busy';
}

const text = (v: unknown) => (v == null ? null : String(v).trim() || null);
const cancelled = (c: ICAL.Component) => String(c.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';

/**
 * Lê o texto de um .ics e devolve os eventos entre `from` e `to`, com as repetições expandidas.
 * id = UID + início da ocorrência, para reimportar o mesmo arquivo sem duplicar.
 */
export function parseIcs(ics: string, from: Date, to: Date): OutlookEvent[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(ics));
  } catch {
    throw new Error('O arquivo não é um calendário .ics válido.');
  }
  const cal = root.name === 'vcalendar' ? root : root.getFirstSubcomponent('vcalendar');
  if (!cal) throw new Error('O arquivo não é um calendário .ics válido.');
  for (const tz of cal.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* fuso desconhecido vira hora local */ }
  }

  // Exceções de uma série (RECURRENCE-ID) se juntam ao evento principal pelo UID.
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const c of cal.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(c);
    if (!e.uid || !e.startDate) continue;
    if (e.isRecurrenceException()) exceptions.push(e);
    else masters.set(e.uid, e);
  }
  for (const x of exceptions) {
    const m = masters.get(x.uid);
    if (m) m.relateException(x); else masters.set(`${x.uid}|${x.recurrenceId}`, x);
  }

  const out: OutlookEvent[] = [];
  const push = (ev: ICAL.Event, comp: ICAL.Component, start: ICAL.Time, end: ICAL.Time | null) => {
    if (cancelled(comp)) return;
    const s = start.toJSDate();
    let e = end ? end.toJSDate() : start.isDate ? addDays(s, 1) : s;
    if (e < s) e = s;
    if (e <= from || s >= to) return;
    out.push({
      id: `${ev.uid}|${s.toISOString()}`,
      title: text(ev.summary) ?? '(sem assunto)',
      start: s.toISOString(),
      end: e.toISOString(),
      allDay: start.isDate,
      showAs: showAsOf(comp),
      webLink: text(comp.getFirstPropertyValue('url')),
      location: text(ev.location),
    });
  };

  for (const ev of masters.values()) {
    if (out.length >= MAX_EVENTS) break;
    if (!ev.isRecurring()) { push(ev, ev.component, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    for (let next = it.next(), n = 0; next && n < 20000 && out.length < MAX_EVENTS; next = it.next(), n++) {
      if (next.toJSDate() >= to) break;
      const o = ev.getOccurrenceDetails(next);
      push(o.item, o.item.component, o.startDate, o.endDate);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Janela importada a partir de hoje. */
export function icsWindow(now = new Date()): [Date, Date] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return [addDays(today, -ICS_BEFORE_DAYS), addDays(today, ICS_AFTER_DAYS)];
}

/** Grava os eventos do arquivo no banco (upsert pelo id; reimportar atualiza em vez de duplicar). */
export async function importIcs(ics: string): Promise<number> {
  const [from, to] = icsWindow();
  const events = parseIcs(ics, from, to);
  const now = new Date().toISOString();
  const rows = events.map((e) => ({
    source: 'ics', external_id: e.id, subject: e.title, starts_at: e.start, ends_at: e.end,
    is_all_day: e.allDay, show_as: e.showAs, location: e.location ?? null, web_link: e.webLink, synced_at: now,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    must(await sb().from('calendar_events').upsert(rows.slice(i, i + 200), { onConflict: 'owner_id,source,external_id' }));
  }
  return events.length;
}

export async function countIcs(): Promise<number> {
  const r = await sb().from('calendar_events').select('id', { count: 'exact', head: true }).eq('source', 'ics');
  if (r.error) throw r.error;
  return r.count ?? 0;
}

/** Apaga todos os eventos importados de .ics (as reuniões do Outlook ficam). */
export async function clearIcs() {
  must(await sb().from('calendar_events').delete().eq('source', 'ics'));
}
