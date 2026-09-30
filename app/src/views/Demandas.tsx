import { useRef, useState, type DragEvent } from 'react';
import { DemandRow } from '../components/DemandRow';
import { I } from '../components/Icons';
import { useToast } from '../components/Toast';
import { api, qk, useInvalidate } from '../data/api';
import { useMover } from '../data/move';
import { isOpen, type Model } from '../data/model';
import { addDays, dayDiff, dur, isoDate } from '../lib/format';
import { errMsg } from '../lib/supabase';
import type { DemandOverview } from '../lib/types';
import { useTimerCtx } from '../timer/TimerContext';
import { useUI } from '../ui';

type GroupBy = 'grupo' | 'tipo' | 'prazo' | 'status';
export type SortBy = 'manual' | 'prazo' | 'nome' | 'tempo';
/** gid: seção que é um grupo (soltar no cabeçalho leva para o fim dele). null = "Sem grupo". */
interface Section { name: string; color?: string; gid?: string | null; items: DemandOverview[] }
type Over = { id: string; kind: 'before' | 'after' | 'arming' | 'ready' } | { group: string | null } | null;

export function DemandasToolbar({ m, q, setQ, groupBy, setGroupBy, sortBy, setSortBy, onAI }: {
  m: Model; q: string; setQ: (s: string) => void; groupBy: GroupBy; setGroupBy: (g: GroupBy) => void;
  sortBy: SortBy; setSortBy: (s: SortBy) => void; onAI?: () => void;
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
      <label className="toggle">Ordenar
        <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} aria-label="Ordenar por">
          {([['manual', 'Manual (arrastar)'], ['prazo', 'Prazo'], ['nome', 'Nome'], ['tempo', 'Tempo gasto']] as const).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {onAI && <button className="btn ai-btn" onClick={onAI} title="Ctrl+Shift+N"><I.spark />Nova com IA</button>}
    </div>
  );
}

export function useDemandasState() {
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('grupo');
  const [sortBy, setSortBy] = useState<SortBy>('manual');
  return { q, setQ, groupBy, setGroupBy, sortBy, setSortBy };
}

export function Demandas({ m, q, groupBy, sortBy, setSortBy }: { m: Model; q: string; groupBy: GroupBy; sortBy: SortBy; setSortBy: (s: SortBy) => void }) {
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
    sections = gs.map((g) => ({ name: g.name, color: m.groupColor(g, m.groups.indexOf(g)), gid: g.id, items: list.filter((d) => d.group_id === g.id) }));
    if (!ui.groupFilter) sections.push({ name: 'Sem grupo', gid: null, items: list.filter((d) => !d.group_id) });
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
  const sortFn = (a: DemandOverview, b: DemandOverview) => Number(a.status === 'done') - Number(b.status === 'done') || (
    sortBy === 'manual' ? a.sort_order - b.sort_order
    : sortBy === 'prazo' ? `${a.due_date ?? '9999'}${a.due_time ?? '99'}`.localeCompare(`${b.due_date ?? '9999'}${b.due_time ?? '99'}`)
    : sortBy === 'nome' ? a.title.localeCompare(b.title, 'pt')
    : secs(b) - secs(a));

  // ---- arrastar e soltar ----
  const mover = useMover(m, () => { if (sortBy === 'manual') return false; setSortBy('manual'); return true; });
  const drag = useRef<{ id: string; zone: Over; nest: string | null } | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [over, setOver] = useState<Over>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const reset = () => { clearTimeout(armTimer.current); drag.current = null; setOver(null); setDragging(null); };
  const setZone = (z: Over) => { if (drag.current) drag.current.zone = z; setOver(z); };

  function onRowOver(e: DragEvent, target: DemandOverview) {
    const dr = drag.current; if (!dr) return;
    e.preventDefault(); e.stopPropagation();
    if (target.id === dr.id) { clearTimeout(armTimer.current); dr.nest = null; setZone(null); return; }
    const box = e.currentTarget.getBoundingClientRect(), y = (e.clientY - box.top) / box.height;
    const src = m.byId.get(dr.id)!;
    if (y > 0.28 && y < 0.72 && !mover.whyNotNest(src, target)) {
      const cur = dr.zone as { id?: string; kind?: string } | null;
      if (cur?.id !== target.id || (cur.kind !== 'arming' && cur.kind !== 'ready')) {
        clearTimeout(armTimer.current); dr.nest = null;
        setZone({ id: target.id, kind: 'arming' });
        armTimer.current = setTimeout(() => { if (drag.current) { drag.current.nest = target.id; setZone({ id: target.id, kind: 'ready' }); } }, 1000);
      }
      return;
    }
    clearTimeout(armTimer.current); dr.nest = null;
    setZone({ id: target.id, kind: y >= 0.5 ? 'after' : 'before' });
  }

  async function onDrop(e: DragEvent) {
    const dr = drag.current; if (!dr) return;
    e.preventDefault(); e.stopPropagation();
    const z = dr.zone, src = m.byId.get(dr.id);
    reset();
    if (!src || !z) return;
    if ('group' in z) return mover.moveToGroupEnd(src, z.group);
    const target = m.byId.get(z.id); if (!target) return;
    if (z.kind === 'ready') return mover.nestInto(src, target);
    if (z.kind === 'arming') { toast('Segure um pouco mais sobre a demanda para colocar dentro dela.'); return; }
    return mover.moveNear(src, target, z.kind === 'after');
  }

  const rowCls = (id: string) => {
    const o = over && 'id' in over && over.id === id ? over.kind : null;
    return [dragging === id && 'dragging', o === 'before' && 'drop-before', o === 'after' && 'drop-after', o === 'arming' && 'nest-arming', o === 'ready' && 'nest-ready'].filter(Boolean).join(' ');
  };
  const dragRow = (d: DemandOverview, row: React.ReactNode) => (
    <div key={d.id} className={`dw ${d.parent_id ? 'child' : ''} ${rowCls(d.id)}`} data-nestlabel="Soltar para virar subtarefa" draggable
      onDragStart={(e) => {
        e.stopPropagation();
        drag.current = { id: d.id, zone: null, nest: null };
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.id);
        setTimeout(() => setDragging(d.id), 0);
      }}
      onDragOver={(e) => onRowOver(e, d)} onDrop={onDrop} onDragEnd={reset}>
      <span className="grip" title="Arraste para mover" aria-hidden="true"><I.grip /></span>
      {row}
    </div>
  );

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
      {m.demands.length > 0 && (
        <p className="draghint"><I.grip />Arraste pela alça para reordenar ou mudar de grupo. Segure 1 segundo sobre outra demanda para ela virar subtarefa.</p>
      )}
      {m.demands.length === 0 && !m.loading && (
        <p className="empty">Nenhuma demanda ainda. Crie um grupo na barra lateral e adicione a primeira demanda acima.</p>
      )}
      {sections.map((s) => {
        if (!s.items.length && (!showEmpty || s.name === 'Sem grupo')) return null;
        const items = [...s.items].sort(sortFn);
        const isGroup = s.gid !== undefined;
        const into = isGroup && over && 'group' in over && over.group === s.gid;
        const total = items.reduce((a, d) => a + secs(d), 0);
        return (
          <div className="group" key={s.name}>
            <div className={'grouphead' + (into ? ' drop-into' : '')}
              onDragOver={isGroup ? (e) => { if (!drag.current) return; e.preventDefault(); clearTimeout(armTimer.current); setZone({ group: s.gid ?? null }); } : undefined}
              onDrop={isGroup ? onDrop : undefined}>
              {s.color && <span className="dot" style={{ background: s.color }} />}
              <h3>{s.name}</h3>
              <span className="meta">{items.filter(isOpen).length} abertas · <span className="mono">{dur(total)}</span></span>
            </div>
            {!items.length && <div className="empty">Nada aqui.</div>}
            {items.map((d) => (
              <div key={d.id}>
                {dragRow(d, <DemandRow d={d} m={m} group={groupBy !== 'grupo'} />)}
                {[...m.children(d.id)].sort(sortFn).map((c) => dragRow(c, <DemandRow d={c} m={m} />))}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
