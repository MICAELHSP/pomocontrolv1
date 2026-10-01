// Ocupação do dia para o Calendário: tempo registrado + reuniões, sobre a jornada de trabalho.
// Regra (especificacao-telas.md, item 8): ocupação = (tempo registrado + reuniões que não
// coincidem com tempo registrado) ÷ jornada. Feriados nacionais ficam fora da jornada.
import { addDays, isoDate, toMinutes } from './format';
import type { Meeting, TimeEntry } from './types';

/* ------------------------------ jornada ------------------------------ */

export interface Jornada { start: string; end: string; lunch: number; days: number[] }

export const DEFAULT_JORNADA: Jornada = { start: '08:00', end: '17:00', lunch: 60, days: [1, 2, 3, 4, 5] };

export const jornadaMinutes = (j: Jornada) => Math.max(0, (toMinutes(j.end) ?? 0) - (toMinutes(j.start) ?? 0) - j.lunch);

/* ------------------------------ feriados ------------------------------ */

/** Domingo de Páscoa (algoritmo de Meeus/Butcher). */
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const holidayCache = new Map<number, Map<string, string>>();

/** Feriados nacionais do Brasil ("yyyy-mm-dd" -> nome). */
export function holidaysBR(y: number): Map<string, string> {
  let h = holidayCache.get(y);
  if (h) return h;
  const p = (m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  h = new Map([
    [p(1, 1), 'Confraternização Universal'],
    [isoDate(addDays(easter(y), -2)), 'Sexta-feira Santa'],
    [p(4, 21), 'Tiradentes'],
    [p(5, 1), 'Dia do Trabalho'],
    [p(9, 7), 'Independência do Brasil'],
    [p(10, 12), 'Nossa Senhora Aparecida'],
    [p(11, 2), 'Finados'],
    [p(11, 15), 'Proclamação da República'],
    [p(12, 25), 'Natal'],
  ]);
  if (y >= 2024) h.set(p(11, 20), 'Dia da Consciência Negra');
  holidayCache.set(y, h);
  return h;
}

export const holidayOf = (date: string) => holidaysBR(Number(date.slice(0, 4))).get(date) ?? null;

/* ------------------------------ sessões por dia ------------------------------ */

/** Trecho de tempo registrado num dia local, em minutos desde 00:00. key = "d:<id>" ou "f:<atividade>". */
export interface Seg { key: string; start: number; end: number }

export const entryKey = (e: Pick<TimeEntry, 'demand_id' | 'free_activity'>) => (e.demand_id ? `d:${e.demand_id}` : `f:${e.free_activity ?? ''}`);

/** Sessões de tempo -> trechos por dia local; a sessão rodando vai até agora. */
export function entriesByDay(entries: TimeEntry[], now: number = Date.now()): Map<string, Seg[]> {
  const out = new Map<string, Seg[]>();
  for (const e of entries) {
    const s = new Date(e.started_at), en = new Date(e.ended_at ?? now);
    if (isNaN(+s) || isNaN(+en) || en <= s) continue;
    let day = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    for (let guard = 0; day < en && guard < 60; guard++) {
      const next = addDays(day, 1);
      const a = s > day ? s : day, b = en < next ? en : next;
      const am = Math.floor((+a - +day) / 60000), bm = Math.ceil((+b - +day) / 60000);
      if (bm > am) {
        const k = isoDate(day);
        out.set(k, [...(out.get(k) ?? []), { key: entryKey(e), start: am, end: Math.min(bm, 1440) }]);
      }
      day = next;
    }
  }
  for (const list of out.values()) list.sort((x, y) => x.start - y.start);
  return out;
}

/* ------------------------------ estatística do dia ------------------------------ */

export interface DayStats {
  dem: number; free: number; meet: number; used: number;
  /** Jornada do dia em minutos (0 em fim de semana, feriado ou dia fora da jornada). */
  J: number;
  pct: number | null;
  idle: number;
  byKey: Map<string, number>;
  byGroup: Map<string, number>; // grupo da demanda ("" = sem grupo)
}

/**
 * Minutos por tipo no dia. Demandas e livres somam o registrado; reunião conta só os
 * minutos sem tempo registrado (e reuniões sobrepostas contam uma vez).
 */
export function dayStats(date: string, segs: Seg[], meetings: Meeting[], j: Jornada, groupOf: (demandId: string) => string): DayStats {
  let dem = 0, free = 0;
  const byKey = new Map<string, number>(), byGroup = new Map<string, number>();
  const busy = new Uint8Array(1440);
  for (const s of segs) {
    const v = s.end - s.start;
    if (s.key.startsWith('d:')) {
      dem += v;
      const g = groupOf(s.key.slice(2));
      byGroup.set(g, (byGroup.get(g) ?? 0) + v);
    } else free += v;
    byKey.set(s.key, (byKey.get(s.key) ?? 0) + v);
    busy.fill(1, s.start, s.end);
  }
  let meet = 0;
  for (const m of meetings) {
    const a = toMinutes(m.start)!, b = Math.min(toMinutes(m.end)!, 1440);
    for (let x = a; x < b; x++) if (!busy[x]) { busy[x] = 2; meet++; }
  }
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  const workday = j.days.includes(d.getDay()) && !holidayOf(date);
  const J = workday ? jornadaMinutes(j) : 0;
  const used = dem + free + meet;
  return { dem, free, meet, used, J, pct: J ? Math.round((used / J) * 100) : null, idle: Math.max(0, J - used), byKey, byGroup };
}

export const occLabel = (pct: number) => (pct >= 95 ? 'Dia cheio' : pct >= 80 ? 'Bem ocupado' : 'Com folga');

/** "45 min", "2h", "2h 05". */
export const hmin = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + String(Math.round(m % 60)).padStart(2, '0') : ''}`);
