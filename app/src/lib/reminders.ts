// Aviso do sistema (Windows/macOS) antes de cada reunião do Outlook.
// Preferência fica neste computador: ligado/desligado e minutos de antecedência (padrão 10).
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { addDays, isoDate, parseDate, toMinutes } from './format';
import type { Meeting } from './types';

export interface ReminderPrefs { enabled: boolean; minutes: number }
export const DEFAULT_REMINDER: ReminderPrefs = { enabled: true, minutes: 10 };
export const REMINDER_OPTIONS = [5, 10, 15, 30];

const LS = 'pauta.lembreteReuniao';
const SENT = 'pauta.lembretesEnviados';
const listeners = new Set<() => void>();
let current: ReminderPrefs | null = null;

function read(): ReminderPrefs {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ReminderPrefs>;
      if (typeof p.enabled === 'boolean' && Number.isFinite(p.minutes)) return { enabled: p.enabled, minutes: Math.max(1, Math.min(120, Number(p.minutes))) };
    }
  } catch { /* sem armazenamento */ }
  return DEFAULT_REMINDER;
}

export const getReminderPrefs = () => (current ??= read());

export function saveReminderPrefs(p: ReminderPrefs) {
  current = p;
  try { localStorage.setItem(LS, JSON.stringify(p)); } catch { /* fica só nesta sessão */ }
  listeners.forEach((f) => f());
}

export function useReminderPrefs(): ReminderPrefs {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, getReminderPrefs);
}

/** Chave do aviso: muda se a reunião for remarcada, para avisar de novo no horário novo. */
export const reminderKey = (m: Meeting) => `${m.id ?? m.title}|${m.date}|${m.start}`;

/** Momento (ms) em que a reunião começa, no fuso local. */
export const startsAt = (m: Meeting) => +parseDate(m.date!) + toMinutes(m.start)! * 60_000;

/**
 * Reuniões que devem avisar agora: começam em até `minutes` minutos e ainda não começaram.
 * Se o app abrir em cima da hora, avisa assim mesmo (com os minutos que faltam).
 */
export function dueReminders(meetings: Meeting[], now: number, minutes: number, sent: Set<string>): Meeting[] {
  return meetings.filter((m) => {
    if (!m.date || sent.has(reminderKey(m))) return false;
    const s = startsAt(m);
    return s > now && s - now <= minutes * 60_000;
  });
}

export function reminderText(m: Meeting, now: number) {
  const left = Math.max(1, Math.round((startsAt(m) - now) / 60_000));
  return {
    title: `${m.title} em ${left} min`,
    body: `${m.start}–${m.end}${m.location ? ` · ${m.location}` : ''}`,
  };
}

function loadSent(): Set<string> {
  try {
    const raw = localStorage.getItem(SENT);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ok */ }
  return new Set();
}

function saveSent(sent: Set<string>, today: string) {
  // Guarda só os de hoje e amanhã, para não crescer sem fim.
  const keep = [...sent].filter((k) => k.split('|')[1] >= today).slice(-200);
  try { localStorage.setItem(SENT, JSON.stringify(keep)); } catch { /* ok */ }
}

/** Confere a cada 20 s e mostra o aviso do sistema para as reuniões que estão para começar. */
export function useMeetingReminders(meetingsOn: (date: string) => Meeting[]) {
  const prefs = useReminderPrefs();
  const sent = useRef<Set<string>>(loadSent());
  const lookup = useRef(meetingsOn);
  lookup.current = meetingsOn;

  useEffect(() => {
    if (!prefs.enabled) return;
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    const tick = () => {
      const now = Date.now(), today = isoDate(new Date(now));
      const list = [...lookup.current(today), ...lookup.current(isoDate(addDays(new Date(now), 1)))];
      const due = dueReminders(list, now, prefs.minutes, sent.current);
      if (!due.length) return;
      for (const m of due) {
        sent.current.add(reminderKey(m));
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const t = reminderText(m, now);
            const n = new Notification(t.title, { body: t.body, tag: reminderKey(m) });
            n.onclick = () => window.focus();
          }
        } catch { /* sem notificações */ }
      }
      saveSent(sent.current, today);
    };
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, [prefs.enabled, prefs.minutes]);
}
