import { useEffect, useState } from 'react';
import { conflictOf, DueChip, useToggleDone } from '../components/DemandRow';
import { I } from '../components/Icons';
import { useToast } from '../components/Toast';
import { api, qk, useChecklist, useInvalidate, useRoutines, useUpdates } from '../data/api';
import { useMover } from '../data/move';
import { isOpen, type Model } from '../data/model';
import { nextFreeTime } from '../lib/conflict';
import { clockHMS, dur, secondsBetween, shortTime, timeOf } from '../lib/format';
import { errMsg } from '../lib/supabase';
import type { Demand, DemandStatus } from '../lib/types';
import { useTimerCtx } from '../timer/TimerContext';
import { useUI } from '../ui';

const STATUS: [DemandStatus, string][] = [['todo', 'A fazer'], ['in_progress', 'Em andamento'], ['waiting', 'Aguardando terceiros']];
const PRI = ['Nenhuma', 'Baixa', 'Média', 'Alta', 'Urgente'];

export function Detail({ m }: { m: Model }) {
  const ui = useUI();
  const t = useTimerCtx();
  const toast = useToast();
  const invalidate = useInvalidate();
  const toggle = useToggleDone(m);
  const mover = useMover(m);
  const d = ui.sel ? m.byId.get(ui.sel) : undefined;
  const cl = useChecklist(d?.id ?? null);
  const upd = useUpdates(d?.id ?? null);
  const routines = useRoutines();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [sub, setSub] = useState('');
  const [item, setItem] = useState('');
  const [andamento, setAndamento] = useState('');
  const [newType, setNewType] = useState<string | null>(null);

  useEffect(() => { setTitle(d?.title ?? ''); setNotes(d?.description ?? ''); setNewType(null); }, [d?.id, d?.title, d?.description]);

  if (!ui.sel) return null;
  if (!d) return null;

  const act = async (fn: () => Promise<unknown>, ...keys: (readonly unknown[])[]) => {
    try { await fn(); } catch (e) { toast(errMsg(e)); }
    await invalidate(qk.demands, ...keys);
  };
  const patch = (p: Partial<Demand>) => act(() => api.updateDemand(d.id, p));

  const kids = m.children(d.id);
  const openKids = kids.filter(isOpen);
  // A principal soma o próprio tempo/estimativa com o das subtarefas (um nível só).
  const ownSecs = d.total_seconds + t.liveExtra(d.id);
  const kidsSecs = kids.reduce((n, k) => n + k.total_seconds + t.liveExtra(k.id), 0);
  const kidsEst = kids.reduce((n, k) => n + (k.estimated_minutes ?? 0), 0);
  const deps = m.depsOf(d.id);
  const blockers = m.blockers(d.id);
  const c = conflictOf(d, m);
  const dayMeetings = m.meetingsOn(d.due_date);
  const items = cl.data ?? [];
  const clDone = items.filter((x) => x.done).length;
  const running = t.entry?.demand_id === d.id;
  const sessions = t.entries.filter((e) => e.demand_id === d.id);
  const routine = d.routine_id ? routines.data?.find((r) => r.id === d.routine_id) : undefined;
  const parent = d.parent_id ? m.byId.get(d.parent_id) : undefined;
  const depCandidates = m.demands.filter((x) => x.id !== d.id && isOpen(x) && !deps.some((y) => y.id === x.id) && x.parent_id !== d.id);

  return (
    <aside className="detail" aria-label="Detalhe da demanda">
      <header>
        <button className={`check ${blockers.length && isOpen(d) ? 'locked' : ''}`} role="checkbox" aria-checked={d.status === 'done'} aria-label="Concluir"
          style={{ marginTop: 3 }} onClick={(e) => toggle(d, e.currentTarget)}><I.check /></button>
        <h3 style={{ display: 'flex' }}>
          <input className="input" style={{ flex: 1, fontWeight: 600, fontSize: 16, border: '1px solid transparent', background: 'none', padding: '0 4px' }}
            value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título"
            onBlur={() => { const v = title.trim(); if (v && v !== d.title) patch({ title: v }); else setTitle(d.title); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </h3>
        <button className="iconbtn" onClick={() => ui.open(null)} aria-label="Fechar detalhe"><I.x /></button>
      </header>
      <div className="dbody">
        <dl className="facts">
          <dt>Grupo</dt>
          <dd>
            <select className="input" value={d.group_id ?? ''} onChange={(e) => patch({ group_id: e.target.value || null })} aria-label="Grupo">
              <option value="">Sem grupo</option>
              {m.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {routine && <span className="chip rot"><I.repeat />{routine.title}</span>}
          </dd>
          <dt>Tipo</dt>
          <dd>
            {newType === null
              ? <select className="input" value={d.type_id ?? ''} aria-label="Tipo"
                  onChange={(e) => { if (e.target.value === '__new') setNewType(''); else patch({ type_id: e.target.value || null }); }}>
                  <option value="">Sem tipo</option>
                  {m.types.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}
                  <option value="__new">+ Novo tipo…</option>
                </select>
              : <form style={{ display: 'flex', gap: 4, flex: 1 }} onSubmit={async (e) => {
                  e.preventDefault();
                  const n = newType.trim(); if (!n) return;
                  await act(async () => { const ty = await api.addType(n); await api.updateDemand(d.id, { type_id: ty.id }); }, qk.types);
                  setNewType(null);
                }}>
                  <input className="input" autoFocus value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Ex.: Processo, Entrega" aria-label="Novo tipo"
                    onKeyDown={(e) => { if (e.key === 'Escape') setNewType(null); }} />
                  <button className="btn" type="submit">OK</button>
                </form>}
          </dd>
          <dt>Situação</dt>
          <dd>
            {d.status === 'done' ? <DueChip d={d} /> :
              <select className="input" value={d.status} onChange={(e) => patch({ status: e.target.value as DemandStatus })} aria-label="Situação">
                {STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>}
          </dd>
          <dt>Prazo</dt>
          <dd>
            <input className="input" type="date" value={d.due_date ?? ''} aria-label="Data do prazo"
              onChange={(e) => patch(e.target.value ? { due_date: e.target.value } : { due_date: null, due_time: null })} />
            <input className="input mono" type="time" value={shortTime(d.due_time)} disabled={!d.due_date} aria-label="Hora do prazo" style={{ flex: '0 0 96px' }}
              onChange={(e) => patch({ due_time: e.target.value || null })} />
          </dd>
          <dt>Prioridade</dt>
          <dd>
            <select className="input" value={d.priority} onChange={(e) => patch({ priority: +e.target.value })} aria-label="Prioridade">
              {PRI.map((l, i) => <option key={i} value={i}>{l}</option>)}
            </select>
          </dd>
          <dt>Referência</dt>
          <dd>
            <input className="input" defaultValue={d.external_ref ?? ''} key={d.id + (d.external_ref ?? '')} placeholder="Nº do processo, link…" aria-label="Referência externa"
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== d.external_ref) patch({ external_ref: v }); }} />
          </dd>
          {parent && <><dt>Faz parte de</dt><dd><button className="btn ghost" style={{ padding: 0 }} onClick={() => ui.open(parent.id)}>{parent.title}</button></dd></>}
          <dt>Mover</dt>
          <dd>{d.parent_id
            ? <button className="btn" onClick={() => mover.unnest(d)}>Tirar de dentro da demanda</button>
            : m.children(d.id).length
              ? <span className="note">Tem subtarefas, fica como demanda principal.</span>
              : <select className="input" value="" aria-label="Tornar subtarefa de" onChange={(e) => { const tg = m.byId.get(e.target.value); if (tg) mover.nestInto(d, tg); }}>
                  <option value="">Tornar subtarefa de…</option>
                  {m.demands.filter((x) => !x.parent_id && x.id !== d.id && isOpen(x)).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                </select>}
          </dd>
          <dt>Depende de</dt>
          <dd>
            {deps.map((x) => (
              <span key={x.id} className={`chip ${isOpen(x) ? 'block' : 'ok'}`}>
                <button className="btn ghost" style={{ padding: 0, font: 'inherit', color: 'inherit' }} onClick={() => ui.open(x.id)}>{isOpen(x) ? '🔒 ' : '✓ '}{x.title}</button>
                <button className="btn ghost" style={{ padding: 0 }} aria-label={`Remover dependência ${x.title}`} onClick={() => act(() => api.removeDependency(d.id, x.id), qk.deps)}>×</button>
              </span>
            ))}
            <select className="input" value="" aria-label="Adicionar dependência" style={{ maxWidth: 180 }}
              onChange={(e) => e.target.value && act(() => api.addDependency(d.id, e.target.value), qk.deps)}>
              <option value="">+ Só depois de…</option>
              {depCandidates.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </dd>
          <dt>Estimativa</dt>
          <dd>
            <input key={`est-${d.id}-${d.estimated_minutes ?? ''}`} className="input mono" type="number" min={1} style={{ maxWidth: 90 }} aria-label="Estimativa em minutos"
              defaultValue={d.estimated_minutes ?? ''} placeholder="min"
              onBlur={(e) => { const v = e.target.value ? Math.max(1, Math.round(+e.target.value)) : null; if (v !== d.estimated_minutes) patch({ estimated_minutes: v }); }} />
            {' '}min{kids.length > 0 && kidsEst > 0 && <span className="hint"> · com subtarefas: <b className="mono">{dur(((d.estimated_minutes ?? 0) + kidsEst) * 60)}</b></span>}
          </dd>
          <dt>Tempo total</dt>
          <dd className="mono">{dur(ownSecs + kidsSecs)}{d.pomodoros_count ? ` · ${d.pomodoros_count} pomodoro${d.pomodoros_count > 1 ? 's' : ''}` : ''}
            {kids.length > 0 && <span className="hint"> · própria {dur(ownSecs)} + subtarefas {dur(kidsSecs)}</span>}</dd>
        </dl>

        {c && d.due_time && (
          <div className="alert"><I.warn /><div>A entrega às <b>{shortTime(d.due_time)}</b> cai durante <b>{c.title}</b> ({c.start}–{c.end}).<br />
            <button className="btn" onClick={() => patch({ due_time: nextFreeTime(d.due_time!, dayMeetings) })}>Mover para {nextFreeTime(d.due_time, dayMeetings)}</button></div></div>
        )}

        {!d.parent_id && (
          <div className="sect">
            <h4><I.sub /> Subtarefas <span className="n">{kids.length - openKids.length}/{kids.length}</span></h4>
            <p className="hint">Precisam estar concluídas antes desta demanda.</p>
            {kids.map((k) => (
              <div key={k.id} className={`item ${k.status === 'done' ? 'done' : ''}`}>
                <button className={`check ${m.blockers(k.id).length && isOpen(k) ? 'locked' : ''}`} role="checkbox" aria-checked={k.status === 'done'}
                  aria-label={`Concluir ${k.title}`} onClick={(e) => toggle(k, e.currentTarget)}><I.check /></button>
                <span style={{ cursor: 'pointer' }} onClick={() => ui.open(k.id)}>{k.title}</span><DueChip d={k} />
              </div>
            ))}
            <form className="addline" onSubmit={async (e) => {
              e.preventDefault();
              const v = sub.trim(); if (!v) return;
              await act(() => api.addDemand({ title: v, parent_id: d.id, group_id: d.group_id, type_id: d.type_id, due_date: d.due_date }));
              setSub('');
            }}>
              <input className="input" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Nova subtarefa" aria-label="Nova subtarefa" />
              <button className="btn" type="submit">Adicionar</button>
            </form>
          </div>
        )}

        <div className="sect">
          <h4>Checklist <span className="n">{clDone}/{items.length}</span></h4>
          {items.length > 0 && <div className="bar" style={{ marginBottom: 6 }}><i style={{ width: `${(clDone / items.length) * 100}%` }} /></div>}
          {items.map((x) => (
            <div key={x.id} className={`item ${x.done ? 'done' : ''}`}>
              <button className="check" role="checkbox" aria-checked={x.done} aria-label={x.title} onClick={() => act(() => api.toggleChecklist(x), qk.checklist(d.id))}><I.check /></button>
              <span>{x.title}</span>
              <button className="iconbtn danger" aria-label={`Remover ${x.title}`} onClick={() => act(() => api.deleteChecklist(x.id), qk.checklist(d.id))}><I.x /></button>
            </div>
          ))}
          <form className="addline" onSubmit={async (e) => {
            e.preventDefault();
            const v = item.trim(); if (!v) return;
            await act(() => api.addChecklist(d.id, v, items.length), qk.checklist(d.id));
            setItem('');
          }}>
            <input className="input" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Novo item" aria-label="Novo item do checklist" />
            <button className="btn" type="submit">Adicionar</button>
          </form>
        </div>

        <div className="sect">
          <h4>Sessões de hoje</h4>
          <div className="sessions">
            {sessions.map((s) => (
              <div key={s.id}>
                <span className="mono">{timeOf(s.started_at)}–{s.ended_at ? timeOf(s.ended_at) : 'agora'}{s.pomodoro_id ? ' · foco' : ''}</span>
                <span className="mono">{s.ended_at ? dur(secondsBetween(s.started_at, s.ended_at)) : clockHMS(secondsBetween(s.started_at, null, t.now))}</span>
              </div>
            ))}
            {!sessions.length && <p className="note">Nenhuma sessão hoje.</p>}
          </div>
        </div>

        <div className="sect">
          <h4>Anotações</h4>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contexto, links, o que falta…" aria-label="Anotações"
            onBlur={() => { const v = notes.trim() || null; if (v !== (d.description ?? null)) patch({ description: v }); }} />
        </div>

        <div className="sect">
          <h4>Andamento <span className="n">histórico do processo</span></h4>
          <form className="addline" style={{ marginTop: 0, marginBottom: 6 }} onSubmit={async (e) => {
            e.preventDefault();
            const v = andamento.trim(); if (!v) return;
            await act(() => api.addUpdate(d.id, v), qk.updates(d.id));
            setAndamento('');
          }}>
            <input className="input" value={andamento} onChange={(e) => setAndamento(e.target.value)} placeholder="Ex.: Enviado para assinatura da diretoria" aria-label="Registrar andamento" />
            <button className="btn" type="submit">Registrar</button>
          </form>
          {(upd.data ?? []).map((u) => (
            <div key={u.id} className="upd"><time>{new Date(u.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time>{u.body}</div>
          ))}
        </div>
      </div>
      <div className="dfoot">
        {d.status !== 'done' && (running
          ? <button className="btn" disabled={t.busy} onClick={t.pause}><I.pause />Pausar</button>
          : <button className="btn focus" disabled={t.busy} onClick={() => t.start({ demandId: d.id })}><I.play />Iniciar cronômetro</button>)}
        <button className={`btn ${blockers.length && isOpen(d) ? '' : 'primary'}`} onClick={() => toggle(d)}
          title={blockers.length ? `Faltam ${blockers.length}` : undefined}>
          {d.status === 'done' ? <><I.check />Reabrir</> : blockers.length ? <><I.lock />Bloqueada ({blockers.length})</> : <><I.check />Concluir</>}
        </button>
        <button className="iconbtn danger" style={{ flex: 'none' }} title="Excluir demanda" aria-label="Excluir demanda" onClick={async () => {
          if (!confirm(`Excluir "${d.title}"${kids.length ? ' e suas subtarefas' : ''}? Isso não pode ser desfeito.`)) return;
          ui.open(null);
          await act(() => api.deleteDemand(d.id), qk.deps, qk.timer);
        }}><I.trash /></button>
      </div>
    </aside>
  );
}
