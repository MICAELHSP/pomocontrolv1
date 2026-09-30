// Leituras e escritas no Supabase (schema demandas_app) via React Query.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { must, sb } from '../lib/supabase';
import { isoDate } from '../lib/format';
import type {
  ChecklistItem, Demand, DemandOverview, DemandType, DemandUpdate, Dependency, Group,
  Pomodoro, PomodoroKind, PomodoroSettings, PomodoroStatus, Routine, RoutineChecklistItem, TimeEntry,
} from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';

export const qk = {
  groups: ['groups'] as const,
  types: ['types'] as const,
  demands: ['demands'] as const,
  deps: ['deps'] as const,
  checklist: (id: string) => ['checklist', id] as const,
  updates: (id: string) => ['updates', id] as const,
  routines: ['routines'] as const,
  settings: ['settings'] as const,
  timer: ['timer'] as const,
};

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/* ------------------------------ leituras ------------------------------ */

export const useGroups = () => useQuery({
  queryKey: qk.groups,
  queryFn: async () => must(await sb().from('groups').select('*').eq('archived', false).order('position').order('name')) as Group[],
});

export const useTypes = () => useQuery({
  queryKey: qk.types,
  queryFn: async () => must(await sb().from('demand_types').select('*').order('position').order('name')) as DemandType[],
});

export const useDemands = () => useQuery({
  queryKey: qk.demands,
  queryFn: async () => must(await sb().from('demand_overview').select('*')
    .neq('status', 'canceled').order('due_date', { nullsFirst: false }).order('position')) as DemandOverview[],
});

export const useDeps = () => useQuery({
  queryKey: qk.deps,
  queryFn: async () => must(await sb().from('demand_dependencies').select('demand_id, depends_on_id')) as Dependency[],
});

export const useChecklist = (demandId: string | null) => useQuery({
  queryKey: qk.checklist(demandId ?? ''),
  enabled: !!demandId,
  queryFn: async () => must(await sb().from('checklist_items').select('*').eq('demand_id', demandId!).order('position').order('created_at')) as ChecklistItem[],
});

export const useUpdates = (demandId: string | null) => useQuery({
  queryKey: qk.updates(demandId ?? ''),
  enabled: !!demandId,
  queryFn: async () => must(await sb().from('demand_updates').select('*').eq('demand_id', demandId!).order('created_at', { ascending: false })) as DemandUpdate[],
});

export interface RoutineWithItems extends Routine { items: RoutineChecklistItem[] }

export const useRoutines = () => useQuery({
  queryKey: qk.routines,
  queryFn: async () => {
    const rs = must(await sb().from('routines').select('*').order('title')) as Routine[];
    const items = must(await sb().from('routine_checklist_items').select('*').order('position')) as RoutineChecklistItem[];
    return rs.map((r) => ({ ...r, items: items.filter((i) => i.routine_id === r.id) })) as RoutineWithItems[];
  },
});

export const useSettings = () => useQuery({
  queryKey: qk.settings,
  queryFn: async () => {
    const r = must(await sb().from('pomodoro_settings').select('*').maybeSingle()) as PomodoroSettings | null;
    return { ...DEFAULT_SETTINGS, ...(r ?? {}) } as PomodoroSettings;
  },
});

export interface TimerSnapshot {
  entry: TimeEntry | null;      // atividade rodando
  pomodoro: Pomodoro | null;    // fase rodando
  entries: TimeEntry[];         // trechos de hoje (inclui o rodando)
  pomodoros: Pomodoro[];        // fases de hoje
}

export const useTimer = () => useQuery({
  queryKey: qk.timer,
  refetchInterval: 60_000,
  queryFn: async (): Promise<TimerSnapshot> => {
    const since = startOfToday().toISOString();
    const [entries, running, pomodoros] = await Promise.all([
      sb().from('time_entries').select('*').or(`started_at.gte.${since},ended_at.gte.${since},ended_at.is.null`).order('started_at'),
      sb().from('pomodoros').select('*').eq('status', 'running').maybeSingle(),
      sb().from('pomodoros').select('*').gte('started_at', since).order('started_at'),
    ]);
    const es = must(entries) as TimeEntry[];
    return {
      entry: es.find((e) => !e.ended_at) ?? null,
      pomodoro: must(running) as Pomodoro | null,
      entries: es,
      pomodoros: must(pomodoros) as Pomodoro[],
    };
  },
});

/* ------------------------------ escritas ------------------------------ */

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: (readonly unknown[])[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

export const api = {
  async addDemand(d: Partial<Demand> & { title: string }) {
    return must(await sb().from('demands').insert(d).select().single()) as Demand;
  },
  async updateDemand(id: string, patch: Partial<Demand>) {
    must(await sb().from('demands').update(patch).eq('id', id));
  },
  async deleteDemand(id: string) {
    must(await sb().from('demands').delete().eq('id', id));
  },
  async setStatus(id: string, status: Demand['status']) {
    must(await sb().from('demands').update({ status }).eq('id', id));
  },
  async addDependency(demandId: string, dependsOn: string) {
    must(await sb().from('demand_dependencies').insert({ demand_id: demandId, depends_on_id: dependsOn }));
  },
  async removeDependency(demandId: string, dependsOn: string) {
    must(await sb().from('demand_dependencies').delete().eq('demand_id', demandId).eq('depends_on_id', dependsOn));
  },
  async addChecklist(demandId: string, title: string, position: number) {
    must(await sb().from('checklist_items').insert({ demand_id: demandId, title, position }));
  },
  async toggleChecklist(item: ChecklistItem) {
    must(await sb().from('checklist_items').update({ done: !item.done, done_at: item.done ? null : new Date().toISOString() }).eq('id', item.id));
  },
  async deleteChecklist(id: string) {
    must(await sb().from('checklist_items').delete().eq('id', id));
  },
  async addUpdate(demandId: string, body: string) {
    must(await sb().from('demand_updates').insert({ demand_id: demandId, body }));
  },
  async addGroup(name: string, color: string, position: number) {
    return must(await sb().from('groups').insert({ name, color, position }).select().single()) as Group;
  },
  async addType(name: string) {
    return must(await sb().from('demand_types').insert({ name }).select().single()) as DemandType;
  },
  async saveRoutine(r: Partial<Routine>, items: string[]) {
    const { id, ...rest } = r;
    const saved = id
      ? must(await sb().from('routines').update(rest).eq('id', id).select().single()) as Routine
      : must(await sb().from('routines').insert(rest).select().single()) as Routine;
    must(await sb().from('routine_checklist_items').delete().eq('routine_id', saved.id));
    const rows = items.map((title, position) => ({ routine_id: saved.id, title, position })).filter((x) => x.title.trim());
    if (rows.length) must(await sb().from('routine_checklist_items').insert(rows));
    return saved;
  },
  async deleteRoutine(id: string) {
    must(await sb().from('routines').delete().eq('id', id));
  },
  async generateRoutines(until?: Date) {
    return must(await sb().rpc('generate_routine_demands', until ? { p_until: isoDate(until) } : {})) as number;
  },
  async saveSettings(s: Partial<PomodoroSettings>) {
    const { data: { user } } = await sb().auth.getUser();
    must(await sb().from('pomodoro_settings').upsert({ owner_id: user!.id, ...s }));
  },
  /* cronômetro + pomodoro: sempre pelas RPCs, que guardam as regras */
  async startActivity(a: { demandId?: string; free?: string }) {
    return must(await sb().rpc('start_activity', { p_demand_id: a.demandId ?? null, p_free_activity: a.free ?? null })) as TimeEntry | null;
  },
  async stopActivity() {
    return must(await sb().rpc('stop_activity')) as TimeEntry | null;
  },
  async startPomodoro(kind: PomodoroKind, cycle: number) {
    return must(await sb().rpc('start_pomodoro', { p_kind: kind, p_cycle: cycle })) as Pomodoro;
  },
  async finishPomodoro(status: PomodoroStatus | null) {
    return must(await sb().rpc('finish_pomodoro', { p_status: status })) as Pomodoro | null;
  },
};
