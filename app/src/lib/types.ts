// Tipos do schema demandas_app (ver backend/migrations).

export type DemandStatus = 'todo' | 'in_progress' | 'waiting' | 'done' | 'canceled';
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type PomodoroKind = 'focus' | 'short_break' | 'long_break';
export type PomodoroStatus = 'running' | 'completed' | 'interrupted';
export type SwitchMode = 'continue' | 'restart';

export interface Group {
  id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  position: number;
  archived: boolean;
}

export interface DemandType {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

export interface Demand {
  id: string;
  parent_id: string | null;
  group_id: string | null;
  type_id: string | null;
  routine_id: string | null;
  occurrence_date: string | null;
  title: string;
  description: string | null;
  status: DemandStatus;
  priority: number;
  planned_start: string | null;
  due_date: string | null; // yyyy-mm-dd
  due_time: string | null; // hh:mm:ss
  estimated_minutes: number | null;
  completed_at: string | null;
  position: number;
  sort_order: number; // ordem manual entre irmãos (mesmo grupo e mesma mãe)
  external_ref: string | null;
  created_at: string;
}

/** Linha da visão demand_overview. */
export interface DemandOverview extends Demand {
  group_name: string | null;
  group_color: string | null;
  type_name: string | null;
  total_seconds: number;
  focus_seconds: number;
  pomodoros_count: number;
  running_since: string | null;
  checklist_total: number;
  checklist_done: number;
  open_dependencies: number;
  open_subtasks: number;
  subtasks_total: number;
  is_blocked: boolean;
}

export interface Dependency {
  demand_id: string;
  depends_on_id: string;
}

export interface ChecklistItem {
  id: string;
  demand_id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface DemandUpdate {
  id: string;
  demand_id: string;
  body: string;
  created_at: string;
}

export interface Routine {
  id: string;
  title: string;
  description: string | null;
  group_id: string | null;
  type_id: string | null;
  priority: number;
  estimated_minutes: number | null;
  freq: RecurrenceFreq;
  interval_n: number;
  by_weekday: number[] | null; // ISO 1=seg .. 7=dom
  by_monthday: number[] | null; // 1..31, -1 = último dia
  business_days_only: boolean;
  start_date: string;
  end_date: string | null;
  due_time: string | null;
  lead_days: number;
  active: boolean;
  generated_until: string | null;
}

export interface RoutineChecklistItem {
  id: string;
  routine_id: string;
  title: string;
  position: number;
}

export interface PomodoroSettings {
  enabled: boolean;
  focus_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  cycles_before_long: number;
  pause_demand_on_break: boolean;
  on_switch: SwitchMode;
}

export interface Pomodoro {
  id: string;
  kind: PomodoroKind;
  cycle: number;
  planned_minutes: number;
  started_at: string;
  ended_at: string | null;
  status: PomodoroStatus;
  queued_demand_id: string | null;
  queued_free_activity: string | null;
}

export interface TimeEntry {
  id: string;
  demand_id: string | null;
  free_activity: string | null;
  pomodoro_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  note: string | null;
}

/** Linha da visão pomodoro_breakdown (uma por atividade dentro do pomodoro). */
export interface PomodoroBreakdownRow {
  pomodoro_id: string;
  kind: PomodoroKind;
  cycle: number;
  status: PomodoroStatus;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number;
  demand_id: string | null;
  demand_title: string | null;
  free_activity: string | null;
  seconds: number | null;
}

/** Atividade = uma demanda ou uma atividade livre (ex.: "E-mails"). */
export type Activity = { demandId: string; free?: undefined } | { free: string; demandId?: undefined };

/** Reunião do calendário (Outlook), já recortada no dia local. */
export interface Meeting {
  title: string;
  start: string; // hh:mm
  end: string; // hh:mm (24:00 quando passa da meia-noite)
  id?: string;
  date?: string; // yyyy-mm-dd
  webLink?: string | null;
}

export const DEFAULT_SETTINGS: PomodoroSettings = {
  enabled: true,
  focus_minutes: 25,
  short_break_minutes: 5,
  long_break_minutes: 15,
  cycles_before_long: 4,
  pause_demand_on_break: true,
  on_switch: 'continue',
};
