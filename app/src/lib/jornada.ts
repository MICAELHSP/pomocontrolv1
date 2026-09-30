// Jornada de trabalho e feriados nacionais: base da ocupação no Calendário.
// Fica neste computador (localStorage); o padrão é 08:00–17:00, 60 min de almoço, seg–sex.
import { addDays, isoDate, toMinutes } from './format';

export interface Jornada { start: string; end: string; lunch: number; days: number[] } // days: 0=dom..6=sáb

export const DEFAULT_JORNADA: Jornada = { start: '08:00', end: '17:00', lunch: 60, days: [1, 2, 3, 4, 5] };
const LS = 'pauta.jornada';

export function loadJornada(): Jornada {
  try {
    const j = JSON.parse(localStorage.getItem(LS) || 'null');
    if (j && typeof j.start === 'string') return { ...DEFAULT_JORNADA, ...j };
  } catch { /* sem armazenamento */ }
  return DEFAULT_JORNADA;
}

export function saveJornada(j: Jornada) {
  try { localStorage.setItem(LS, JSON.stringify(j)); } catch { /* ok */ }
}

/** Minutos de trabalho por dia. */
export const jornadaMinutes = (j: Jornada) => Math.max(0, (toMinutes(j.end) ?? 0) - (toMinutes(j.start) ?? 0) - j.lunch);

/** Domingo de Páscoa (algoritmo de Meeus). */
export function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Feriados nacionais do Brasil no ano: data -> nome. */
export function holidays(year: number): Record<string, string> {
  const fixed: [string, string][] = [
    ['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'], ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'], ['11-20', 'Dia da Consciência Negra'], ['12-25', 'Natal'],
  ];
  const out: Record<string, string> = {};
  for (const [md, name] of fixed) out[`${year}-${md}`] = name;
  out[isoDate(addDays(easter(year), -2))] = 'Sexta-feira Santa';
  return out;
}

export function holidayName(date: string): string | undefined {
  return holidays(Number(date.slice(0, 4)))[date];
}

export const isWorkday = (d: Date, j: Jornada) => j.days.includes(d.getDay()) && !holidayName(isoDate(d));
