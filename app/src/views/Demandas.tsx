import { useState } from 'react';
import { DemandRow } from '../components/DemandRow';
import { I } from '../components/Icons';
import { useToast } from '../components/Toast';
import { api, qk, useInvalidate } from '../data/api';
import { isOpen, type Model } from '../data/model';
import { addDays, dayDiff, dur, isoDate } from '../lib/format';
import { errMsg } from '../lib/supabase';
import type { DemandOverview } from '../lib/types';
import { useTimerCtx } from '../timer/TimerContext';
import { useUI } from '../ui';

type GroupBy = 'grupo' | 'tipo' | 'prazo' | 'status';
interface Section { name: string; color?: string; items: DemandOverview[] }

export function DemandasToolbar({ m, q, setQ, groupBy, setGroupBy, onAI }: {
  m: Model; q: string; setQ: (s: string) => void; groupBy: GroupBy; setGroupBy: (g: GroupBy) => void; onAI?: () => void;
}) {
  const ui = useUI();
  const g = ui.groupFilter ? m.groupById.get(ui.groupFilter) : undefined;
  return (
    <div className="toolbar">
      <h2>{g ? g.name : 'Demandas'}</h2>
      <input className="input" placeholder="Buscar demanda" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} aria-label="Buscar demanda" />
      <div className="seg" role="group" aria-label="Agrupar por">
        {([['grupo', 'Grupo'], ['tipo', 'Tipo'], ['prazo', 'Prazo'], ['status', 'Situação']] as const).map(([k, l]) => (
          <button key={k} aria-pressed={groupBy === k} onClick={() => setGroupBy(k)}>{l}</button>
        ))}
      </div>
      {onAI && <button className="btn ai-btn" onClick={onAI} title="Ctrl+Shift+N"><I.spark />Nova com IA</button>}
    </div>
  );
}

export function useDemandasState() {
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('grupo');
  return { q, setQ, groupBy, setGroupBy };
}

export function Demandas({ m, q, groupBy }: { m: Model; q: string; groupBy: GroupBy }) {
  const ui = useUI();
  const t = useTimerCtx();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [title, setTitle] = useState('');
  const [gid, setGid] = useState<string>('');
  const [due, setDue] = useState(isoDate(addDays(new Date(), 1)));

  const query = q.trim().toLowerCase();
  let list = m.demands.filter((d) => !d.parent_id);
  if (ui.groupFilter) list = list.filter((d) => d.group_id === ui.groupFilter);
  list = list.filter((d) => !query || d.title.toLowerCase().includes(query) || m.children(d.id).some((c) => c.title.toLowerCase().includes(query)));

  let sections: Section[];
  if (groupBy === 'grupo') {
    const gs = m.groups.filter((g) => !ui.groupFilter || g.id === ui.groupFilter);
    sections = gs.map((g, i) => ({ name: g.name, color: m.groupColor(g, i), items: list.filter((d) => d.group_id === g.id) }));
    if (!ui.groupFilter) sections.push({ name: 'Sem grupo', items: list.filter((d) => !d.group_id) });
  } else if (groupBy === 'tipo') {
    sections = [...m.types.map((ty) => ({ name: ty.name, items: list.filter((d) => d.type_id === ty.id) })),
      { name: 'Sem tipo', items: list.filter((d) => !d.type_id) }];
  } else if (groupBy === 'prazo') {
    const b = (d: DemandOverview) => d.status === 'done' ? 5 : !d.due_date ? 4 : dayDiff(d.due_date) < 0 ? 0 : dayDiff(d.due_date) === 0 ? 1 : dayDiff(d.due_date) <= 7 ? 2 : 3;
    sections = ['Atrasadas', 'Hoje', 'Próximos 7 dias', 'Mais adiante', 'Sem prazo', 'Concluídas'].map((n, i) => ({ name: n, items: list.filter((d) => b(d) === i) }));
  } else {
    sections = ([['in_progress', 'Em andamento'], ['todo', 'A fazer'], ['waiting', 'Aguardando'], ['done', 'Concluídas']] as const)
      .map(([k, n]) => ({ name: n, items: list.filter((d) => d.status === k) }));
  }
  const showEmpty = groupBy === 'grupo';

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const tt = title.trim();
    if (!tt) return;
    try {
      const d = await api.addDemand({ title: tt, group_id: (gid || ui.groupFilter) || null, due_date: due || null });
      setTitle('');
      await invalidate(qk.demands);
      ui.open(d.id);
      toast('Demanda criada.');
    } catch (err) { toast(errMsg(err)); }
  }

  const secs = (d: DemandOverview) => d.total_seconds + t.liveExtra(d.id) + m.children(d.id).reduce((a, c) => a + c.total_seconds + t.liveExtra(c.id), 0);
  const sortKey = (d: DemandOverview) => `${d.status === 'done' ? 1 : 0}${d.due_date ?? '9999'}${d.due_time ?? '99'}`;

  return (
    <>
      <form className="quickadd" onSubmit={add}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nova demanda, por exemplo: Enviar ofício à procuradoria" aria-label="Título da nova demanda" />
        <select className="input" value={gid || ui.groupFilter || ''} onChange={(e) => setGid(e.target.value)} aria-label="Grupo">
          <option value="">Sem grupo</option>
          {m.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Prazo" />
        <button className="btn primary" type="submit">Adicionar</button>
      </form>
      {m.demands.length === 0 && !m.loading && (
        <p className="empty">Nenhuma demanda ainda. Crie um grupo na barra lateral e adicione a primeira demanda acima.</p>
      )}
      {sections.map((s) => {
        if (!s.items.length && (!showEmpty || s.name === 'Sem grupo')) return null;
        const items = [...s.items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
        const total = items.reduce((a, d) => a + secs(d), 0);
        return (
          <div className="group" key={s.name}>
            <div className="grouphead">
              {s.color && <span className="dot" style={{ background: s.color }} />}
              <h3>{s.name}</h3>
              <span className="meta">{items.filter(isOpen).length} abertas · <span className="mono">{dur(total)}</span></span>
            </div>
            {!items.length && <div className="empty">Nada aqui.</div>}
            {items.map((d) => (
              <div key={d.id}>
                <DemandRow d={d} m={m} group={groupBy !== 'grupo'} />
                {m.children(d.id).sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map((c) => <DemandRow key={c.id} d={c} m={m} />)}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
