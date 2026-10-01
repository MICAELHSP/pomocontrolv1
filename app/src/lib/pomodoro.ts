// Regras do pomodoro no cliente. O ritmo não pertence a uma demanda:
// a fase roda em demandas_app.pomodoros e cada trecho de atividade feito
// durante um foco aponta para ele (time_entries.pomodoro_id).
import type { Pomodoro, PomodoroKind, PomodoroSettings, TimeEntry } from './types';
import { secondsBetween } from './format';

export function phaseMinutes(kind: PomodoroKind, st: PomodoroSettings): number {
  return kind === 'focus' ? st.focus_minutes : kind === 'short_break' ? st.short_break_minutes : st.long_break_minutes;
}

/** Tempo que falta na fase; o tempo pausado não conta (e a fase pausada fica parada). */
export function remainingSeconds(p: Pick<Pomodoro, 'planned_minutes' | 'started_at' | 'paused_at' | 'paused_seconds'>, now = Date.now()): number {
  const stopped = (p.paused_seconds ?? 0) + (p.paused_at ? secondsBetween(p.paused_at, null, now) : 0);
  return p.planned_minutes * 60 - (secondsBetween(p.started_at, null, now) - stopped);
}

/** Fase seguinte: foco -> intervalo (ou pausa longa no último ciclo) -> foco do próximo ciclo. */
export function nextPhase(cur: Pick<Pomodoro, 'kind' | 'cycle'>, st: Pick<PomodoroSettings, 'cycles_before_long'>): { kind: PomodoroKind; cycle: number } {
  const n = Math.max(1, st.cycles_before_long);
  if (cur.kind === 'focus') return { kind: cur.cycle % n === 0 ? 'long_break' : 'short_break', cycle: cur.cycle };
  return { kind: 'focus', cycle: (cur.cycle % n) + 1 };
}

export function phaseLabel(kind: PomodoroKind, cycle: number, n: number): string {
  return kind === 'focus' ? `Foco ${cycle}/${n}` : kind === 'long_break' ? 'Pausa longa' : 'Intervalo';
}

export type ActivityKey = string; // "d:<uuid>" ou "f:<texto>"
export const keyOf = (e: Pick<TimeEntry, 'demand_id' | 'free_activity'>): ActivityKey =>
  e.demand_id ? `d:${e.demand_id}` : `f:${e.free_activity ?? ''}`;

/** Segundos de cada atividade dentro de um pomodoro, na ordem em que apareceram. */
export function splitOfPomodoro(pomodoroId: string, entries: TimeEntry[], now = Date.now()): { key: ActivityKey; seconds: number }[] {
  const acc = new Map<ActivityKey, number>();
  for (const e of entries
    .filter((x) => x.pomodoro_id === pomodoroId)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const k = keyOf(e);
    acc.set(k, (acc.get(k) ?? 0) + secondsBetween(e.started_at, e.ended_at, now));
  }
  return [...acc].map(([key, seconds]) => ({ key, seconds }));
}

/** Segundos por atividade a partir de "since" (trechos cortados no início). */
export function secondsByActivity(entries: TimeEntry[], since: Date, now = Date.now()): Map<ActivityKey, number> {
  const acc = new Map<ActivityKey, number>();
  const s = since.getTime();
  for (const e of entries) {
    const start = Math.max(new Date(e.started_at).getTime(), s);
    const end = e.ended_at ? new Date(e.ended_at).getTime() : now;
    if (end <= start) continue;
    const k = keyOf(e);
    acc.set(k, (acc.get(k) ?? 0) + (end - start) / 1000);
  }
  return acc;
}
