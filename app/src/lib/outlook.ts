// Calendário do Outlook no renderer: ponte com o processo principal (electron/outlook.cjs),
// eventos por dia local e o hook usado pelas telas. Fora do Electron fica indisponível.
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, hm, isoDate, parseDate } from './format';
import { must, sb } from './supabase';
import type { Meeting } from './types';

export interface OutlookEvent {
  id: string;
  title: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
  allDay: boolean;
  showAs: string;
  webLink: string | null;
  location?: string | null;
}

export interface OutlookStatus {
  available: boolean;
  clientId: string;
  tenant: string;
  connected: boolean;
  account: { name: string; email: string } | null;
  /** false = o sistema não cifra o token; é preciso conectar a cada abertura. */
  persistent: boolean;
}

interface OutlookBridge {
  status(): Promise<OutlookStatus>;
  connect(clientId: string, tenant: string): Promise<OutlookStatus>;
  cancel(): Promise<boolean>;
  disconnect(): Promise<OutlookStatus>;
  events(from: string, to: string): Promise<OutlookEvent[]>;
}

declare global {
  interface Window { pauta?: { platform: string; isElectron: boolean; outlook?: OutlookBridge } }
}

export const outlook = (): OutlookBridge | undefined => (typeof window === 'undefined' ? undefined : window.pauta?.outlook);

export const calKeys = { status: ['outlook', 'status'] as const, events: ['outlook', 'events'] as const };

/** Janela lida do Outlook: de ontem até 60 dias à frente. */
export const WINDOW_BEFORE = 1, WINDOW_AFTER = 61;

/** Ocupa a agenda: eventos "livre" e de dia inteiro não contam (igual a daily_occupancy no banco). */
export const blocksTime = (e: Pick<OutlookEvent, 'allDay' | 'showAs'>) => !e.allDay && e.showAs !== 'free';

/** Eventos -> reuniões por dia local ("yyyy-mm-dd"), recortando o que passa da meia-noite. */
export function toDayMeetings(events: OutlookEvent[]): Map<string, Meeting[]> {
  const out = new Map<string, Meeting[]>();
  for (const e of events) {
    if (!blocksTime(e)) continue;
    const s = new Date(e.start), en = new Date(e.end);
    if (isNaN(+s) || isNaN(+en) || en <= s) continue;
    let day = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    for (let guard = 0; day < en && guard < 60; guard++) {
      const next = addDays(day, 1);
      const a = s > day ? s : day, b = en < next ? en : next;
      const am = Math.round((+a - +day) / 60000), bm = Math.round((+b - +day) / 60000);
      if (bm > am) {
        const key = isoDate(day);
        out.set(key, [...(out.get(key) ?? []), { id: e.id, title: e.title, date: key, start: hm(am), end: hm(bm), webLink: e.webLink }]);
      }
      day = next;
    }
  }
  for (const list of out.values()) list.sort((x, y) => x.start.localeCompare(y.start));
  return out;
}

/* ------------------- cópia no banco (demandas_app.calendar_events) ------------------- */
// Com o Outlook conectado, cada leitura grava as reuniões do intervalo no Supabase (autorizado
// pelo usuário em 01/10/2026), para o cálculo de ocupação no banco (daily_occupancy) e para ver o
// histórico mesmo sem o Outlook conectado.

interface EventRow {
  external_id: string; subject: string | null; starts_at: string; ends_at: string;
  is_all_day: boolean; show_as: string | null; location: string | null; web_link: string | null;
}

const toRow = (e: OutlookEvent): EventRow => ({
  external_id: e.id, subject: e.title, starts_at: e.start, ends_at: e.end,
  is_all_day: e.allDay, show_as: e.showAs, location: e.location ?? null, web_link: e.webLink,
});

export const fromRow = (r: EventRow): OutlookEvent => ({
  id: r.external_id, title: r.subject || '(sem assunto)', start: r.starts_at, end: r.ends_at,
  allDay: r.is_all_day, showAs: r.show_as || 'busy', webLink: r.web_link, location: r.location,
});

/** Ids do banco que sumiram do Outlook no intervalo (cancelados, recusados ou excluídos). */
export function staleIds(existing: { id: string; external_id: string }[], events: OutlookEvent[]): string[] {
  const keep = new Set(events.map((e) => e.id));
  return existing.filter((r) => !keep.has(r.external_id)).map((r) => r.id);
}

/** Grava os eventos do intervalo [from, to) e apaga do banco os que sumiram do Outlook. */
export async function syncEvents(events: OutlookEvent[], from: Date, to: Date) {
  const now = new Date().toISOString();
  const rows = events.map((e) => ({ ...toRow(e), source: 'outlook', synced_at: now }));
  for (let i = 0; i < rows.length; i += 200) {
    must(await sb().from('calendar_events').upsert(rows.slice(i, i + 200), { onConflict: 'owner_id,source,external_id' }));
  }
  const existing = must(await sb().from('calendar_events').select('id, external_id')
    .eq('source', 'outlook').gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())) as { id: string; external_id: string }[];
  const stale = staleIds(existing, events);
  for (let i = 0; i < stale.length; i += 100) {
    must(await sb().from('calendar_events').delete().in('id', stale.slice(i, i + 100)));
  }
}

async function eventsFromDb(from: Date, to: Date): Promise<OutlookEvent[]> {
  const rows = must(await sb().from('calendar_events').select('external_id, subject, starts_at, ends_at, is_all_day, show_as, location, web_link')
    .lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()).order('starts_at')) as EventRow[];
  return rows.map(fromRow);
}

/** Outlook conectado: lê do Graph e grava a cópia. Senão: lê a última cópia do banco. */
async function loadEvents(b: OutlookBridge | undefined, connected: boolean, from: Date, to: Date): Promise<OutlookEvent[]> {
  if (!b || !connected) return eventsFromDb(from, to);
  const events = await b.events(from.toISOString(), to.toISOString());
  try { await syncEvents(events, from, to); } catch (e) { console.warn('Não foi possível gravar as reuniões no banco:', e); }
  return events;
}

const EMPTY: Meeting[] = [];

export interface Calendar {
  /** Rodando no Electron (tem a ponte com o Outlook). */
  available: boolean;
  connected: boolean;
  status: OutlookStatus | undefined;
  loading: boolean;
  error: unknown;
  updatedAt: number;
  meetingsOn: (date: string | null | undefined) => Meeting[];
}

/** Reuniões de um intervalo (padrão: de ontem a 60 dias), por dia local. */
export function useMeetingsBetween(from?: Date, to?: Date): Calendar {
  const b = outlook();
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: calKeys.status, queryFn: () => b!.status(), enabled: !!b, staleTime: Infinity });
  const connected = !!statusQ.data?.connected;
  const ready = !b || statusQ.isFetched; // fora do Electron lê direto a cópia do banco
  const today = isoDate(new Date());
  const f = from ?? addDays(parseDate(today), -WINDOW_BEFORE), t = to ?? addDays(parseDate(today), WINDOW_AFTER);
  const q = useQuery({
    queryKey: [...calKeys.events, connected, f.toISOString(), t.toISOString()],
    enabled: ready,
    staleTime: 2 * 60_000,
    refetchInterval: connected ? 5 * 60_000 : false,
    queryFn: async () => {
      try {
        return await loadEvents(b, connected, f, t);
      } catch (e) {
        if (connected) qc.invalidateQueries({ queryKey: calKeys.status }); // o login pode ter expirado
        throw e;
      }
    },
  });
  const byDay = useMemo(() => toDayMeetings(q.data ?? []), [q.data]);
  const meetingsOn = useCallback((date: string | null | undefined) => (date ? byDay.get(date) ?? EMPTY : EMPTY), [byDay]);
  return { available: !!b, connected, status: statusQ.data, loading: q.isLoading, error: q.error, updatedAt: q.dataUpdatedAt, meetingsOn };
}

/** Janela padrão: conflitos de prazo, agenda de Hoje e rotinas. */
export const useCalendar = (): Calendar => useMeetingsBetween();
