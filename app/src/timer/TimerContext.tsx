// Estado do cronômetro da atividade + pomodoro, sempre derivado do banco.
// O relógio local só interpola entre um fetch e outro; toda mudança passa
// pelas RPCs start_activity / stop_activity / start_pomodoro / finish_pomodoro.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, qk, useDemands, useInvalidate, useSettings, useTimer } from '../data/api';
import { nextPhase, phaseLabel, remainingSeconds, keyOf, type ActivityKey } from '../lib/pomodoro';
import { clock, dur, secondsBetween } from '../lib/format';
import { errMsg } from '../lib/supabase';
import type { Pomodoro, PomodoroSettings, TimeEntry } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';
import { useToast } from '../components/Toast';

export interface Act { demandId?: string; free?: string }

interface TimerCtx {
  now: number;
  settings: PomodoroSettings;
  entry: TimeEntry | null;
  pomodoro: Pomodoro | null;
  entries: TimeEntry[];
  pomodoros: Pomodoro[];
  /** atividade mostrada na barra (rodando, na fila ou a última de hoje) */
  current: Act | null;
  /** atividade está na fila do intervalo ("Próximo: …") */
  queued: boolean;
  running: boolean;
  sessionSeconds: number;
  remaining: number;
  label: string;
  busy: boolean;
  start: (a: Act) => Promise<unknown>;
  pause: () => Promise<unknown>;
  resume: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  skip: () => Promise<unknown>;
  /** segundos a somar ao total_seconds da visão para a demanda rodando */
  liveExtra: (demandId: string) => number;
  actName: (a: Act | null | undefined) => string;
}

const Ctx = createContext<TimerCtx | null>(null);
export const useTimerCtx = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('TimerProvider ausente');
  return c;
};

const clean = <T extends { id: string | null }>(x: T | null | undefined): T | null => (x && x.id ? x : null);
const sameAct = (a: Act | null, b: Act | null) => !!a && !!b && (a.demandId ?? null) === (b.demandId ?? null) && (a.free ?? null) === (b.free ?? null);
const actOf = (e: Pick<TimeEntry, 'demand_id' | 'free_activity'>): Act => (e.demand_id ? { demandId: e.demand_id } : { free: e.free_activity ?? '' });

function notify(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission !== 'denied') new Notification(title, { body, silent: false });
  } catch { /* sem notificações */ }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const timer = useTimer();
  const settingsQ = useSettings();
  const demandsQ = useDemands();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState<Act | null>(null);
  const advancing = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }, []);

  const settings = settingsQ.data ?? DEFAULT_SETTINGS;
  const entry = clean(timer.data?.entry);
  const pomodoro = clean(timer.data?.pomodoro);
  const entries = timer.data?.entries ?? [];
  const pomodoros = timer.data?.pomodoros ?? [];

  const demandTitle = useCallback((id: string) => demandsQ.data?.find((d) => d.id === id)?.title ?? 'Demanda', [demandsQ.data]);
  const actName = useCallback((a: Act | null | undefined) => (!a ? 'Nenhuma atividade' : a.demandId ? demandTitle(a.demandId) : a.free || 'Atividade livre'), [demandTitle]);

  const queuedAct: Act | null = pomodoro && (pomodoro.queued_demand_id || pomodoro.queued_free_activity)
    ? (pomodoro.queued_demand_id ? { demandId: pomodoro.queued_demand_id } : { free: pomodoro.queued_free_activity! })
    : null;
  const last = entries.length ? entries[entries.length - 1] : null;
  const current: Act | null = entry ? actOf(entry) : queuedAct ?? paused ?? (last ? actOf(last) : null);
  const queued = !entry && !!queuedAct;
  const running = !!entry || !!pomodoro;

  // Sessão = trechos seguidos da mesma atividade (o foco novo reabre o trecho).
  const sessionSeconds = useMemo(() => {
    if (!entry) return 0;
    const k: ActivityKey = keyOf(entry);
    let total = secondsBetween(entry.started_at, null, now);
    let startOf = new Date(entry.started_at).getTime();
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.id === entry.id || !e.ended_at) continue;
      if (keyOf(e) !== k) break;
      if (Math.abs(new Date(e.ended_at).getTime() - startOf) > 5000) break;
      total += secondsBetween(e.started_at, e.ended_at);
      startOf = new Date(e.started_at).getTime();
    }
    return total;
  }, [entry, entries, now]);

  const remaining = pomodoro ? remainingSeconds(pomodoro, now) : settings.focus_minutes * 60;
  const label = pomodoro ? phaseLabel(pomodoro.kind, pomodoro.cycle, settings.cycles_before_long) : 'Pomodoro parado';

  const refresh = useCallback(() => invalidate(qk.timer, qk.demands), [invalidate]);

  /** Executa uma ação do cronômetro; devolve false se falhou (o erro vira toast). */
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try { await fn(); return true; } catch (e) { toast(errMsg(e)); return false; } finally { await refresh(); setBusy(false); }
  }, [refresh, toast]);

  /** Ciclo do próximo foco quando não há pomodoro rodando. */
  const nextFocusCycle = useCallback(() => {
    const lastP = [...pomodoros].reverse().find((p) => p.status !== 'running');
    if (!lastP) return 1;
    if (lastP.kind !== 'focus') return nextPhase(lastP, settings).cycle;
    return lastP.status === 'completed' ? (lastP.cycle % settings.cycles_before_long) + 1 : lastP.cycle;
  }, [pomodoros, settings]);

  const start = useCallback((a: Act) => run(async () => {
    const prev = entry ? actOf(entry) : null;
    const switching = !!prev && !sameAct(prev, a);
    let p = pomodoro;
    if (settings.enabled && !p) p = await api.startPomodoro('focus', nextFocusCycle());
    const res = await api.startActivity(a);
    setPaused(null);
    const name = actName(a);
    if (!clean(res) && p && p.kind !== 'focus') {
      toast(`Você está no intervalo. O tempo em ${name} começa a contar no próximo foco.`);
    } else if (switching && p && p.kind === 'focus' && pomodoro) {
      if (settings.on_switch === 'restart') toast(`Novo foco de ${settings.focus_minutes} min para ${name}. O foco anterior ficou registrado como interrompido.`);
      else toast(`O foco continua (faltam ${clock(remainingSeconds(p))}). A partir de agora o tempo conta para ${name}.`);
    }
  }), [run, entry, pomodoro, settings, nextFocusCycle, actName, toast]);

  // Pausar: grava o trecho e interrompe a fase (um pomodoro não se divide no tempo).
  const pause = useCallback(() => run(async () => {
    if (current) setPaused(current);
    await api.stopActivity();
    if (pomodoro) await api.finishPomodoro('interrupted');
  }), [run, current, pomodoro]);

  const resume = useCallback(async () => {
    if (current) return start(current);
    toast('Escolha uma demanda ou atividade para começar.');
  }, [current, start, toast]);

  const stop = useCallback(() => run(async () => {
    const secs = sessionSeconds;
    const name = actName(current);
    await api.stopActivity();
    if (pomodoro) await api.finishPomodoro(null);
    setPaused(null);
    if (secs >= 30) toast(`Sessão de ${dur(secs)} gravada em ${name}.`);
  }), [run, sessionSeconds, actName, current, pomodoro, toast]);

  const skip = useCallback(() => run(async () => {
    if (!pomodoro) return;
    const n = nextPhase(pomodoro, settings);
    await api.startPomodoro(n.kind, n.cycle);
  }), [run, pomodoro, settings]);

  // Fim da fase: passa sozinho para a próxima (foco -> intervalo -> foco).
  useEffect(() => {
    if (!pomodoro || busy || remaining > 0 || advancing.current === pomodoro.id) return;
    advancing.current = pomodoro.id;
    const n = nextPhase(pomodoro, settings);
    const msg = pomodoro.kind === 'focus'
      ? (n.kind === 'long_break' ? `${settings.cycles_before_long} focos concluídos. Pausa longa.` : 'Foco concluído. Hora do intervalo.')
      : 'Intervalo encerrado. Novo foco começou.';
    run(async () => { await api.startPomodoro(n.kind, n.cycle); }).then((ok) => {
      if (ok) { toast(msg); notify('Pauta', msg); return; }
      // Falhou (rede, token): libera nova tentativa em 15 s em vez de travar em 00:00.
      setTimeout(() => { if (advancing.current === pomodoro.id) advancing.current = null; }, 15_000);
    });
  }, [pomodoro, busy, remaining, settings, run, toast]);

  // Pomodoro desligado nos ajustes: encerra a fase que estiver rodando.
  useEffect(() => {
    if (settingsQ.data && !settings.enabled && pomodoro && !busy) run(() => api.finishPomodoro(null));
  }, [settingsQ.data, settings.enabled, pomodoro, busy, run]);

  const liveExtra = useCallback((demandId: string) => {
    if (!entry || entry.demand_id !== demandId) return 0;
    const fetched = demandsQ.dataUpdatedAt || now;
    const from = Math.max(fetched, new Date(entry.started_at).getTime());
    return Math.max(0, (now - from) / 1000);
  }, [entry, demandsQ.dataUpdatedAt, now]);

  const value: TimerCtx = {
    now, settings, entry, pomodoro, entries, pomodoros, current, queued, running,
    sessionSeconds, remaining, label, busy, start, pause, resume, stop, skip, liveExtra, actName,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
