import { useEffect, useState } from 'react';
import { I } from '../components/Icons';
import { useToast } from '../components/Toast';
import { api, qk, useInvalidate, useRoutines, type RoutineWithItems } from '../data/api';
import { MEETINGS, type Model } from '../data/model';
import { meetingAt } from '../lib/conflict';
import { ddmm, isoDate, shortTime, WD, WDL } from '../lib/format';
import { describeRule, nextOccurrences } from '../lib/recurrence';
import { errMsg } from '../lib/supabase';
import type { Routine } from '../lib/types';

type Mode = 'diaria' | 'semanal' | 'mensal' | 'intervalo' | 'anual';
type Draft = Omit<Routine, 'id' | 'generated_until' | 'description' | 'type_id' | 'priority' | 'estimated_minutes' | 'lead_days'> & { id?: string; items: string[] };

const blank = (): Draft => ({
  title: 'Nova rotina', group_id: null, freq: 'weekly', interval_n: 1, by_weekday: [1], by_monthday: null,
  business_days_only: false, start_date: isoDate(new Date()), end_date: null, due_time: '09:00', active: true, items: [],
});
const toDraft = (r: RoutineWithItems): Draft => ({
  id: r.id, title: r.title, group_id: r.group_id, freq: r.freq, interval_n: r.interval_n, by_weekday: r.by_weekday, by_monthday: r.by_monthday,
  business_days_only: r.business_days_only, start_date: r.start_date, end_date: r.end_date, due_time: r.due_time ? shortTime(r.due_time) : null,
  active: r.active, items: r.items.map((i) => i.title),
});
const modeOf = (d: Draft): Mode => d.freq === 'daily' ? (d.interval_n > 1 ? 'intervalo' : 'diaria') : d.freq === 'weekly' ? 'semanal' : d.freq === 'monthly' ? 'mensal' : 'anual';

function withMode(d: Draft, m: Mode): Draft {
  switch (m) {
    case 'diaria': return { ...d, freq: 'daily', interval_n: 1 };
    case 'intervalo': return { ...d, freq: 'daily', interval_n: Math.max(2, d.interval_n), business_days_only: false };
    case 'semanal': return { ...d, freq: 'weekly', interval_n: 1, by_weekday: d.by_weekday?.length ? d.by_weekday : [1] };
    case 'mensal': return { ...d, freq: 'monthly', interval_n: 1, by_monthday: d.by_monthday?.length ? d.by_monthday : [new Date().getDate()] };
    case 'anual': return { ...d, freq: 'yearly', interval_n: 1 };
  }
}

export function RotinasToolbar({ onNew }: { onNew: () => void }) {
  return <div className="toolbar"><h2>Rotinas</h2><button className="btn primary" onClick={onNew}>+ Nova rotina</button></div>;
}

export function Rotinas({ m, newTick }: { m: Model; newTick: number }) {
  const routines = useRoutines();
  const toast = useToast();
  const invalidate = useInvalidate();
  const list = routines.data ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [item, setItem] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (newTick) { setSelId(null); setDraft(blank()); } }, [newTick]);
  useEffect(() => {
    if (draft) return;
    const r = list.find((x) => x.id === selId) ?? list[0];
    if (r) { setSelId(r.id); setDraft(toDraft(r)); }
  }, [list, selId, draft]);

  const pick = (r: RoutineWithItems) => { setSelId(r.id); setDraft(toDraft(r)); };
  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  async function save() {
    if (!draft) return;
    if (!draft.title.trim()) { toast('Dê um nome à rotina.'); return; }
    if (draft.freq === 'weekly' && !draft.by_weekday?.length) { toast('Escolha ao menos um dia da semana.'); return; }
    setSaving(true);
    try {
      const { items, id, ...rest } = draft;
      const saved = await api.saveRoutine({
        ...(id ? { id } : {}), ...rest,
        title: rest.title.trim(),
        by_weekday: rest.freq === 'weekly' ? rest.by_weekday : null,
        by_monthday: rest.freq === 'monthly' ? rest.by_monthday : null,
        due_time: rest.due_time || null,
      }, items);
      const n = await api.generateRoutines();
      await invalidate(qk.routines, qk.demands);
      setSelId(saved.id); setDraft(null);
      toast(n ? `Rotina salva. ${n} demanda${n > 1 ? 's' : ''} gerada${n > 1 ? 's' : ''} para os próximos dias.` : 'Rotina salva.');
    } catch (e) { toast(errMsg(e)); }
    setSaving(false);
  }

  async function remove() {
    if (!draft?.id || !confirm(`Excluir a rotina "${draft.title}"? As demandas já geradas continuam na lista.`)) return;
    try { await api.deleteRoutine(draft.id); } catch (e) { toast(errMsg(e)); }
    setSelId(null); setDraft(null);
    await invalidate(qk.routines, qk.demands);
  }

  const groupName = (id: string | null) => (id ? m.groupById.get(id)?.name : undefined);
  const groupDot = (id: string | null) => { const g = id ? m.groupById.get(id) : undefined; return g ? m.groupColor(g, m.groups.indexOf(g)) : 'var(--muted)'; };
  const today = new Date();

  return (
    <div className="rotview">
      <div className="rlist">
        {list.map((r) => {
          const next = r.active ? nextOccurrences(r, today, 1)[0] : undefined;
          return (
            <button key={r.id} className="rcard" aria-current={r.id === selId && !!draft?.id} onClick={() => pick(r)}>
              <span className="t"><span className="dot" style={{ background: groupDot(r.group_id) }} />{r.title}{!r.active && <span className="chip">Pausada</span>}</span>
              <span className="s">{describeRule(r)}</span>
              <span className="s">Próxima: {next ? `${WD[next.getDay()]}, ${ddmm(next)}` : '—'} · {r.items.length} itens no checklist{groupName(r.group_id) ? ` · ${groupName(r.group_id)}` : ''}</span>
            </button>
          );
        })}
        {!list.length && !routines.isLoading && <p className="empty">Nenhuma rotina. Use "+ Nova rotina" para criar a primeira.</p>}
      </div>

      {draft && (() => {
        const mode = modeOf(draft);
        const md = draft.by_monthday ?? [];
        const lastDay = md.includes(-1);
        const occ = draft.active ? nextOccurrences(draft, today, 5) : [];
        return (
          <div className="panel stack" style={{ gap: 14 }}>
            <div className="form">
              <label className="field full"><span>Nome da rotina</span><input className="input" value={draft.title} onChange={(e) => set({ title: e.target.value })} /></label>
              <label className="field"><span>Grupo</span>
                <select className="input" value={draft.group_id ?? ''} onChange={(e) => set({ group_id: e.target.value || null })}>
                  <option value="">Sem grupo</option>
                  {m.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select></label>
              <label className="field"><span>Horário da entrega</span><input className="input mono" type="time" value={draft.due_time ?? ''} onChange={(e) => set({ due_time: e.target.value || null })} /></label>
              <div className="field full"><span>Repetir</span>
                <div className="seg" role="group" aria-label="Frequência">
                  {([['diaria', 'Todo dia'], ['semanal', 'Toda semana'], ['mensal', 'Todo mês'], ['intervalo', 'A cada N dias'], ['anual', 'Todo ano']] as const).map(([k, l]) => (
                    <button key={k} aria-pressed={mode === k} onClick={() => setDraft(withMode(draft, k))}>{l}</button>
                  ))}
                </div></div>
              {mode === 'diaria' && <label className="toggle full"><input type="checkbox" checked={draft.business_days_only} onChange={(e) => set({ business_days_only: e.target.checked })} /> Só dias úteis (seg a sex)</label>}
              {mode === 'semanal' && (
                <div className="field full"><span>Dias da semana</span>
                  <div className="days">{[1, 2, 3, 4, 5, 6, 7].map((i) => {
                    const on = (draft.by_weekday ?? []).includes(i);
                    return <button key={i} aria-pressed={on} title={WDL[i % 7]} onClick={() => set({ by_weekday: on ? (draft.by_weekday ?? []).filter((x) => x !== i) : [...(draft.by_weekday ?? []), i].sort() })}>{WD[i % 7]}</button>;
                  })}</div></div>
              )}
              {mode === 'mensal' && <>
                <div className="field full"><span>Quando no mês</span>
                  <div className="seg">
                    <button aria-pressed={!lastDay} onClick={() => set({ by_monthday: [lastDay ? new Date().getDate() : md[0] ?? 1] })}>No dia X</button>
                    <button aria-pressed={lastDay} onClick={() => set({ by_monthday: [-1] })}>Último dia</button>
                  </div></div>
                {!lastDay && <label className="field"><span>Dia do mês</span><input className="input mono" type="number" min={1} max={31} value={md[0] ?? 1}
                  onChange={(e) => set({ by_monthday: [Math.min(31, Math.max(1, +e.target.value || 1))] })} /></label>}
                <label className="toggle full"><input type="checkbox" checked={draft.business_days_only} onChange={(e) => set({ business_days_only: e.target.checked })} />
                  {lastDay ? 'Último dia útil (se cair no fim de semana, antecipa para sexta)' : 'Se cair no fim de semana, antecipar para sexta'}</label>
              </>}
              {mode === 'intervalo' && <label className="field"><span>Intervalo em dias</span><input className="input mono" type="number" min={2} max={365} value={draft.interval_n}
                onChange={(e) => set({ interval_n: Math.min(365, Math.max(2, +e.target.value || 2)) })} /></label>}
              <label className="field"><span>{mode === 'anual' ? 'Data (dia e mês do ano)' : 'Começa em'}</span><input className="input" type="date" value={draft.start_date} onChange={(e) => e.target.value && set({ start_date: e.target.value })} /></label>
              <label className="field"><span>Termina em (opcional)</span><input className="input" type="date" value={draft.end_date ?? ''} onChange={(e) => set({ end_date: e.target.value || null })} /></label>
            </div>
            <div className="sentence">{describeRule(draft)}</div>
            <div className="sect"><h4>Checklist padrão <span className="n">copiado para cada ocorrência</span></h4>
              {draft.items.map((c, i) => (
                <div className="item" key={i}><span>{c}</span>
                  <button className="iconbtn danger" aria-label="Remover item" onClick={() => set({ items: draft.items.filter((_, j) => j !== i) })}><I.x /></button></div>
              ))}
              <form className="addline" onSubmit={(e) => { e.preventDefault(); const v = item.trim(); if (!v) return; set({ items: [...draft.items, v] }); setItem(''); }}>
                <input className="input" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Adicionar item ao checklist" aria-label="Novo item do checklist" />
                <button className="btn" type="submit">Adicionar</button>
              </form>
            </div>
            <div className="sect"><h4>Próximas ocorrências</h4>
              <div className="occ">
                {occ.map((d) => {
                  const hit = isoDate(d) === isoDate(today) ? meetingAt(draft.due_time, MEETINGS) : null;
                  return <div key={isoDate(d)}><span>{WDL[d.getDay()]}, {ddmm(d)}/{d.getFullYear()}</span>
                    <span className="mono">{draft.due_time ?? ''}{hit && <span className="chip conf"><I.warn />{hit.title}</span>}</span></div>;
                })}
                {!occ.length && <div><span className="note">{draft.active ? 'Nenhuma data com essa regra.' : 'Rotina pausada.'}</span></div>}
              </div>
            </div>
            <label className="toggle"><input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} /> Rotina ativa (gera demandas automaticamente)</label>
            <div className="ai-row">
              <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar rotina'}</button>
              {draft.id && <button className="btn ghost" onClick={() => { const r = list.find((x) => x.id === draft.id); if (r) setDraft(toDraft(r)); }}>Desfazer mudanças</button>}
              {draft.id && <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={remove}>Excluir</button>}
            </div>
            <p className="note">As demandas são geradas para os próximos 7 dias sempre que o app abre. Mudar a regra não altera ocorrências já criadas.</p>
          </div>
        );
      })()}
    </div>
  );
}
