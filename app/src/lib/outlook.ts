// Calendário do Outlook no renderer: ponte com o processo principal (electron/outlook.cjs),
// eventos por dia local e o hook usado pelas telas. Fora do Electron fica indisponível.
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, hm, isoDate, parseDate } from './format';
import type { Meeting } from './types';

export interface OutlookEvent {
  id: string;
  title: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
  allDay: boolean;
  showAs: string;
  webLink: string | null;
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

/** Eventos -> reuniões por dia local ("yyyy-mm-dd"), recortando o que passa da meia-noite. */
export function toDayMeetings(events: OutlookEvent[]): Map<string, Meeting[]> {
  const out = new Map<string, Meeting[]>();
  for (const e of events) {
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

export function useCalendar(): Calendar {
  const b = outlook();
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: calKeys.status, queryFn: () => b!.status(), enabled: !!b, staleTime: Infinity });
  const connected = !!statusQ.data?.connected;
  const today = isoDate(new Date());
  const eventsQ = useQuery({
    queryKey: [...calKeys.events, today],
    enabled: connected,
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const from = addDays(parseDate(today), -WINDOW_BEFORE), to = addDays(parseDate(today), WINDOW_AFTER);
      try {
        return await b!.events(from.toISOString(), to.toISOString());
      } catch (e) {
        qc.invalidateQueries({ queryKey: calKeys.status }); // o login pode ter expirado
        throw e;
      }
    },
  });
  const byDay = useMemo(() => toDayMeetings(eventsQ.data ?? []), [eventsQ.data]);
  const meetingsOn = useCallback((date: string | null | undefined) => (date ? byDay.get(date) ?? EMPTY : EMPTY), [byDay]);
  return {
    available: !!b,
    connected,
    status: statusQ.data,
    loading: connected && eventsQ.isLoading,
    error: eventsQ.error,
    updatedAt: eventsQ.dataUpdatedAt,
    meetingsOn,
  };
}
