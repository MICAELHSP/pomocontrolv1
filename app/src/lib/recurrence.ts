// Prévia das ocorrências de uma rotina no cliente. Espelha
// demandas_app.routine_occurs_on e month_target_day (migration 3):
// o banco é quem gera de fato; aqui só mostramos "Próximas ocorrências".
import type { Routine } from './types';
import { addDays, isoDate, parseDate, WDL } from './format';

type Rule = Pick<Routine, 'freq' | 'interval_n' | 'by_weekday' | 'by_monthday' | 'business_days_only' | 'start_date' | 'end_date'>;

const isoDow = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());
const lastDayOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 864e5);
const mondayOf = (d: Date) => addDays(d, 1 - isoDow(d));

/** Dia do mês de d em que cai a regra "dia m" (-1 = último), com ajuste de dia útil. */
export function monthTargetDay(d: Date, m: number, businessDaysOnly: boolean): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = lastDayOfMonth(d);
  const original = new Date(d.getFullYear(), d.getMonth(), m === -1 ? last : Math.min(m, last));
  let target = original;
  if (businessDaysOnly) {
    const w = isoDow(original);
    if (w === 6) target = addDays(original, -1);
    else if (w === 7) target = addDays(original, -2);
  }
  // antecipar para o mês anterior (dia 1 no fim de semana) -> segunda seguinte
  if (target < first) target = addDays(original, 8 - isoDow(original));
  return target;
}

export function occursOn(r: Rule, d: Date): boolean {
  const start = parseDate(r.start_date);
  if (d < start) return false;
  if (r.end_date && d > parseDate(r.end_date)) return false;
  const n = Math.max(1, r.interval_n);
  switch (r.freq) {
    case 'daily':
      return daysBetween(start, d) % n === 0 && (!r.business_days_only || isoDow(d) < 6);
    case 'weekly':
      return (r.by_weekday ?? []).includes(isoDow(d)) &&
        (daysBetween(mondayOf(start), mondayOf(d)) / 7) % n === 0;
    case 'monthly': {
      const months = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
      if (months % n !== 0) return false;
      return (r.by_monthday ?? []).some((m) => isoDate(monthTargetDay(d, m, r.business_days_only)) === isoDate(d));
    }
    case 'yearly':
      return d.getMonth() === start.getMonth() &&
        d.getDate() === Math.min(start.getDate(), lastDayOfMonth(d)) &&
        (d.getFullYear() - start.getFullYear()) % n === 0;
  }
}

/** Próximas n datas a partir de "from" (inclusive). */
export function nextOccurrences(r: Rule, from: Date, n = 5, horizonDays = 800): Date[] {
  const out: Date[] = [];
  const f = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < horizonDays && out.length < n; i++) {
    const d = addDays(f, i);
    if (occursOn(r, d)) out.push(d);
  }
  return out;
}

/** Frase-resumo da regra, ex.: "Todo mês, no último dia útil às 18:00". */
export function describeRule(r: Rule & { due_time?: string | null }): string {
  const h = r.due_time ? ` às ${r.due_time.slice(0, 5)}` : '';
  const n = r.interval_n;
  switch (r.freq) {
    case 'daily':
      if (n > 1) return `A cada ${n} dias${h}`;
      return (r.business_days_only ? 'Todo dia útil' : 'Todos os dias') + h;
    case 'weekly': {
      const days = [...(r.by_weekday ?? [])].sort().map((i) => WDL[i % 7]);
      if (!days.length) return 'Escolha ao menos um dia da semana';
      return (n > 1 ? `A cada ${n} semanas: ` : 'Toda semana: ') + days.join(', ') + h;
    }
    case 'monthly': {
      const md = r.by_monthday ?? [];
      const each = n > 1 ? `A cada ${n} meses` : 'Todo mês';
      if (md.includes(-1)) return `${each}, no último dia${r.business_days_only ? ' útil' : ''}${h}`;
      const day = md[0] ?? 1;
      return `${each}, no dia ${day}${day > 28 ? ' (ou no último dia, se o mês for mais curto)' : ''}` +
        (r.business_days_only ? ', antecipando fim de semana' : '') + h;
    }
    case 'yearly':
      return (n > 1 ? `A cada ${n} anos` : 'Todo ano') + ` em ${r.start_date.slice(8, 10)}/${r.start_date.slice(5, 7)}${h}`;
  }
}
