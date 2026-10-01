// Formatação de datas, horas e durações em pt-BR.

export const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WDL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const MON = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Date local -> "yyyy-mm-dd". */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "yyyy-mm-dd" -> Date local (meia-noite). */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Diferença em dias entre a data s e hoje (negativo = passado). */
export function dayDiff(s: string, today: Date = new Date()): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((parseDate(s).getTime() - t.getTime()) / 864e5);
}

export const ddmm = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

/** "hh:mm[:ss]" -> minutos desde 00:00. */
export function toMinutes(hm: string | null | undefined): number | null {
  if (!hm) return null;
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** "15:00:00" -> "15:00". */
export const shortTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** Relógio compacto: 4:05, 1:02:03. */
export function clock(s: number): string {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + pad(x);
}

/** Relógio fixo: 00:04:05. */
export function clockHMS(s: number): string {
  s = Math.max(0, Math.floor(s));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(pad).join(':');
}

/** Duração legível: 0 min, 12 min, 1h 05. */
export function dur(s: number): string {
  const m = Math.round(s / 60);
  if (m < 1) return '0 min';
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + pad(m % 60) : '');
}

/** Horário local de um timestamp ISO: "09:35". */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Segundos entre dois instantes (fim nulo = agora). */
export function secondsBetween(start: string, end: string | null, now: number = Date.now()): number {
  return Math.max(0, ((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 1000);
}

export function longDate(d: Date): string {
  const w = WDL[d.getDay()];
  const wd = w.charAt(0).toUpperCase() + w.slice(1) + (d.getDay() > 0 && d.getDay() < 6 ? '-feira' : '');
  return `${wd}, ${d.getDate()} de ${MON[d.getMonth()]}`;
}
