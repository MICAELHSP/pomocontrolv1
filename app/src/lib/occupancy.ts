// Ocupação do dia: tempo registrado + reuniões que não coincidem com ele, sobre a jornada.
import type { TimeEntry } from './types';
import { addDays, isoDate, parseDate } from './format';

/** Trecho de tempo registrado dentro de um dia, em minutos desde 00:00. */
export interface Seg { key: string; demandId: string | null; free: string | null; s: number; e: number }
export interface Span { s: number; e: number }

/** Quebra os trechos de tempo por dia (um trecho que passa da meia-noite vira dois). */
export function segmentsByDay(entries: TimeEntry[], now = Date.now()): Map<string, Seg[]> {
  const out = new Map<string, Seg[]>();
  for (const t of entries) {
    const a = new Date(t.started_at).getTime();
    const b = t.ended_at ? new Date(t.ended_at).getTime() : now;
    if (!(b > a)) continue;
    let day = new Date(a); day.setHours(0, 0, 0, 0);
    while (day.getTime() < b) {
      const d0 = day.getTime(), d1 = addDays(day, 1).getTime();
      const s = Math.max(a, d0), e = Math.min(b, d1);
      if (e > s) {
        const k = isoDate(day);
        const seg: Seg = {
          key: t.demand_id ?? 'free:' + (t.free_activity ?? ''),
          demandId: t.demand_id, free: t.demand_id ? null : (t.free_activity || 'Atividade livre'),
          s: Math.round((s - d0) / 60000), e: Math.round((e - d0) / 60000),
        };
        if (seg.e > seg.s) out.set(k, [...(out.get(k) ?? []), seg]);
      }
      day = addDays(day, 1);
    }
  }
  return out;
}

/** Minutos de reunião que não coincidem com nenhum trecho registrado. */
export function meetingMinutes(meetings: Span[], segs: Span[]): number {
  let n = 0;
  const minute = new Uint8Array(24 * 60);
  for (const m of meetings) for (let x = Math.max(0, m.s); x < Math.min(1440, m.e); x++) minute[x] = 1;
  for (const s of segs) for (let x = Math.max(0, s.s); x < Math.min(1440, s.e); x++) minute[x] = 0;
  for (const v of minute) n += v;
  return n;
}

export interface DayStats {
  dem: number; free: number; meet: number; used: number; J: number; pct: number; idle: number;
  byKey: Map<string, number>; byGroup: Map<string, number>;
}

export function dayStats(segs: Seg[], meetings: Span[], jornada: number, groupOf: (demandId: string) => string | null): DayStats {
  let dem = 0, free = 0;
  const byKey = new Map<string, number>(), byGroup = new Map<string, number>();
  for (const s of segs) {
    const v = s.e - s.s;
    if (s.demandId) {
      dem += v;
      const g = groupOf(s.demandId) ?? '';
      byGroup.set(g, (byGroup.get(g) ?? 0) + v);
    } else free += v;
    byKey.set(s.key, (byKey.get(s.key) ?? 0) + v);
  }
  const meet = meetingMinutes(meetings, segs);
  const used = dem + free + meet;
  const J = jornada;
  return { dem, free, meet, used, J, pct: J ? Math.round((used / J) * 100) : 0, idle: Math.max(0, J - used), byKey, byGroup };
}

export const occLabel = (pct: number) => (pct >= 95 ? 'Dia cheio' : pct >= 80 ? 'Bem ocupado' : 'Com folga');
export const occClass = (pct: number) => (pct >= 95 ? 'late' : pct >= 80 ? 'today' : 'ok');

/** Segunda-feira da semana de d. */
export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
}

export const monthDays = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
export const iso = isoDate;
export const parse = parseDate;
