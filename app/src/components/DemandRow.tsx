import type { MouseEvent } from 'react';
import { I } from './Icons';
import { useToast } from './Toast';
import { api, qk, useInvalidate } from '../data/api';
import { isOpen, type Model } from '../data/model';
import { meetingAt } from '../lib/conflict';
import { dayDiff, ddmm, dur, parseDate, shortTime, WD } from '../lib/format';
import { errMsg } from '../lib/supabase';
import type { DemandOverview } from '../lib/types';
import { useTimerCtx } from '../timer/TimerContext';
import { useUI } from '../ui';

/** Reunião do Outlook no dia e hora do prazo (demandas abertas, de hoje em diante). */
export function conflictOf(d: DemandOverview, m: Pick<Model, 'meetingsOn'>) {
  if (!d.due_time || !d.due_date || !isOpen(d) || dayDiff(d.due_date) < 0) return null;
  return meetingAt(d.due_time, m.meetingsOn(d.due_date));
}

export function DueChip({ d }: { d: DemandOverview }) {
  if (d.status === 'done') return <span className="chip ok"><I.check />Concluída</span>;
  if (!d.due_date) return null;
  const diff = dayDiff(d.due_date), dt = parseDate(d.due_date), t = shortTime(d.due_time);
  if (diff < 0) return <span className="chip late">Atrasada · {ddmm(dt)}</span>;
  if (diff === 0) return <span className="chip today">Hoje{t ? ', ' + t : ''}</span>;
  if (diff === 1) return <span className="chip">Amanhã{t ? ', ' + t : ''}</span>;
  return <span className="chip">{WD[dt.getDay()]}, {ddmm(dt)}{t ? ' · ' + t : ''}</span>;
}

export function Chips({ d, m, withGroup }: { d: DemandOverview; m: Model; withGroup?: boolean }) {
  const kids = m.children(d.id);
  const openKids = kids.filter(isOpen).length;
  const od = isOpen(d) ? m.openDeps(d.id) : [];
  const c = conflictOf(d, m);
  const g = d.group_id ? m.groupById.get(d.group_id) : undefined;
  const cut = (s: string) => (s.length > 30 ? s.slice(0, 30) + '…' : s);
  return (
    <>
      <DueChip d={d} />
      {d.status === 'waiting' && <span className="chip">Aguardando</span>}
      {kids.length > 0 && <span className={`chip ${openKids ? 'block' : ''}`}>{openKids ? <I.lock /> : <I.sub />}Subtarefas {kids.length - openKids}/{kids.length}</span>}
      {d.checklist_total > 0 && <span className="chip"><I.cl />{d.checklist_done}/{d.checklist_total}</span>}
      {od.length > 0 && <span className="chip block"><I.lock />Depende de: {cut(od[0].title)}{od.length > 1 ? ` +${od.length - 1}` : ''}</span>}
      {c && <span className="chip conf"><I.warn />Conflito: {c.title}</span>}
      {d.routine_id && <span className="chip rot"><I.repeat />Rotina</span>}
      {d.type_name && <span className="chip">{d.type_name}</span>}
      {withGroup && g && <span className="chip"><span className="dot" style={{ background: m.colorOf(d) }} />{g.name}</span>}
    </>
  );
}

/** Concluir/reabrir com a regra de bloqueio (o banco também recusa). */
export function useToggleDone(m: Model) {
  const toast = useToast();
  const invalidate = useInvalidate();
  return async (d: DemandOverview, el?: HTMLElement | null) => {
    if (d.status === 'done') {
      try { await api.setStatus(d.id, 'todo'); } catch (e) { toast(errMsg(e)); }
      await invalidate(qk.demands);
      return;
    }
    const open = m.blockers(d.id);
    if (open.length) {
      if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
      toast(`Ainda não dá para concluir. Falta: ${open.map((o) => o.title).join(', ')}.`);
      return;
    }
    try {
      await api.setStatus(d.id, 'done');
      const pend = d.checklist_total - d.checklist_done;
      const parent = d.parent_id ? m.byId.get(d.parent_id) : undefined;
      if (pend) toast(`Concluída. O checklist tinha ${pend} ${pend > 1 ? 'itens pendentes' : 'item pendente'}.`);
      else if (parent && m.children(parent.id).filter((k) => k.id !== d.id && isOpen(k)).length === 0 && m.openDeps(parent.id).length === 0)
        toast(`Todas as subtarefas feitas. ${parent.title} já pode ser concluída.`);
    } catch (e) { toast(errMsg(e)); }
    await invalidate(qk.demands, qk.timer);
  };
}

export function DemandRow({ d, m, group, noTime }: { d: DemandOverview; m: Model; group?: boolean; noTime?: boolean }) {
  const ui = useUI();
  const t = useTimerCtx();
  const toggle = useToggleDone(m);
  const locked = isOpen(d) && m.blockers(d.id).length > 0;
  const running = t.entry?.demand_id === d.id;
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <div className={`row ${d.parent_id ? 'child' : ''} ${d.status === 'done' ? 'done' : ''} ${ui.sel === d.id ? 'sel' : ''} ${running ? 'running' : ''}`}
      onClick={() => ui.open(d.id)}>
      <button className={`check ${locked ? 'locked' : ''}`} role="checkbox" aria-checked={d.status === 'done'}
        aria-label={`Concluir ${d.title}`} title={locked ? 'Bloqueada por subtarefas ou dependências abertas' : 'Concluir'}
        onClick={(e) => { stop(e); toggle(d, e.currentTarget); }}><I.check /></button>
      <div className="body"><div className="title">{d.title}</div><div className="chips"><Chips d={d} m={m} withGroup={group} /></div></div>
      {!noTime && (() => {
        // Principal mostra o total com as subtarefas; o próprio tempo fica na dica.
        const own = d.total_seconds + t.liveExtra(d.id);
        const kids = d.parent_id ? [] : m.children(d.id);
        const sub = kids.reduce((n, k) => n + k.total_seconds + t.liveExtra(k.id), 0);
        return <div className="time mono" title={kids.length ? `Própria ${dur(own)} + subtarefas ${dur(sub)}` : undefined}>{dur(own + sub)}</div>;
      })()}
      {d.status === 'done' ? <span style={{ width: 30 }} /> : running
        ? <button className="iconbtn" aria-label="Pausar" title="Pausar" disabled={t.busy} onClick={(e) => { stop(e); t.pause(); }}><I.pause /></button>
        : <button className="iconbtn play" aria-label="Iniciar cronômetro" title="Iniciar cronômetro" disabled={t.busy} onClick={(e) => { stop(e); t.start({ demandId: d.id }); }}><I.play /></button>}
    </div>
  );
}
