// Seletor de atividade: demandas abertas + atividades livres (E-mails etc.).
import { useState } from 'react';
import { api, qk, useInvalidate } from '../data/api';
import { isOpen, MEETING_TYPE, UNPLANNED_MEETING, type Model } from '../data/model';
import { isoDate } from '../lib/format';
import { errMsg } from '../lib/supabase';
import { useToast } from './Toast';
import type { Act } from '../timer/TimerContext';
import { useTimerCtx } from '../timer/TimerContext';

const LS = 'pauta.freeActivities';
const DEFAULT_FREE = ['E-mails', UNPLANNED_MEETING];

function loadFree(): string[] {
  try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; }
}
function saveFree(list: string[]) {
  try { localStorage.setItem(LS, JSON.stringify(list.slice(0, 20))); } catch { /* ok */ }
}

export function useFreeActivities(): string[] {
  const t = useTimerCtx();
  const recent = t.entries.map((e) => e.free_activity).filter(Boolean) as string[];
  return [...new Set([...DEFAULT_FREE, ...loadFree(), ...recent])];
}

const encode = (a: Act | null) => (!a ? '' : a.demandId ? `d:${a.demandId}` : `f:${a.free}`);

interface Props {
  m: Model;
  value: Act | null;
  onPick: (a: Act) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  title?: string;
  /** Sem os formulários (outra atividade, reunião): para a mini-janela, onde o select fica escondido. */
  compact?: boolean;
}

export function ActivityPicker({ m, value, onPick, placeholder, className = 'input', id, title, compact }: Props) {
  const free = useFreeActivities();
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const [meeting, setMeeting] = useState(false);
  const [who, setWho] = useState('');
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidate();
  const toast = useToast();
  const demands = m.demands.filter(isOpen);
  const cur = encode(value);

  // Reunião como demanda: assunto + com quem; o tempo dela conta como reunião.
  if (meeting) {
    const submit = async () => {
      const title = text.trim();
      if (!title || saving) return;
      setSaving(true);
      try {
        const typeId = m.meetingTypeId ?? (await api.addType(MEETING_TYPE)).id;
        const d = await api.addDemand({ title, type_id: typeId, external_ref: who.trim() || null, due_date: isoDate(new Date()) });
        await invalidate(qk.types, qk.demands);
        setMeeting(false); setText(''); setWho('');
        onPick({ demandId: d.id });
      } catch (e) { toast(errMsg(e)); }
      setSaving(false);
    };
    return (
      <form style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setMeeting(false); }}>
        <input className="input" style={{ flex: '2 1 140px' }} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Assunto da reunião" aria-label="Assunto da reunião" />
        <input className="input" style={{ flex: '1 1 110px' }} value={who} onChange={(e) => setWho(e.target.value)} placeholder="Com quem" aria-label="Com quem" />
        <button className="btn" type="submit" disabled={!text.trim() || saving}>Começar</button>
        <button className="btn ghost" type="button" onClick={() => setMeeting(false)}>Cancelar</button>
      </form>
    );
  }

  if (other) {
    return (
      <form style={{ display: 'flex', gap: 4 }} onSubmit={(e) => {
        e.preventDefault();
        const v = text.trim();
        if (!v) return;
        saveFree([v, ...loadFree().filter((x) => x !== v)]);
        setOther(false); setText('');
        onPick({ free: v });
      }}>
        <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Nome da atividade" aria-label="Nova atividade livre"
          onKeyDown={(e) => { if (e.key === 'Escape') setOther(false); }} />
        <button className="btn" type="submit">OK</button>
      </form>
    );
  }

  return (
    <select className={className} id={id} title={title} value={placeholder ? '' : cur}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__other') { setOther(true); return; }
        if (v === '__meeting') { setMeeting(true); return; }
        if (v.startsWith('d:')) onPick({ demandId: v.slice(2) });
        else if (v.startsWith('f:')) onPick({ free: v.slice(2) });
      }}>
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {!placeholder && !cur && <option value="" disabled>Escolha uma atividade</option>}
      <optgroup label="Demandas">
        {demands.filter((d) => !placeholder || `d:${d.id}` !== cur).map((d) => <option key={d.id} value={`d:${d.id}`}>{d.parent_id ? '↳ ' : ''}{d.title}</option>)}
      </optgroup>
      {!compact && <optgroup label="Reuniões">
        <option value="__meeting">Registrar reunião (assunto e com quem)…</option>
      </optgroup>}
      <optgroup label="Atividades livres">
        {free.filter((f) => !placeholder || `f:${f}` !== cur).map((f) => <option key={f} value={`f:${f}`}>{f}</option>)}
        {!placeholder && value?.free && !free.includes(value.free) && <option value={cur}>{value.free}</option>}
        {!compact && <option value="__other">Outra atividade…</option>}
      </optgroup>
    </select>
  );
}
