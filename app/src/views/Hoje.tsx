import { useState } from 'react';
import { conflictOf, DemandRow } from '../components/DemandRow';
import { I } from '../components/Icons';
import { isOpen, type Model } from '../data/model';
import { dayDiff, dur, hm, isoDate, longDate, shortTime, toMinutes } from '../lib/format';
import { secondsByActivity } from '../lib/pomodoro';
import { useTimerCtx } from '../timer/TimerContext';
import { useUI } from '../ui';
import { CalendarioModal, CalendarSource } from './CalendarioSettings';

export function HojeToolbar({ onAI }: { onAI?: () => void }) {
  const t = useTimerCtx();
  const now = new Date(t.now);
  return (
    <div className="toolbar">
      <h2>{longDate(now)}</h2>
      <span className="chip">Agora {hm(now.getHours() * 60 + now.getMinutes())}</span>
      {onAI && <button className="btn ai-btn" onClick={onAI} title="Ctrl+Shift+N"><I.spark />Nova com IA</button>}
    </div>
  );
}

export function Hoje({ m }: { m: Model }) {
  const t = useTimerCtx();
  const ui = useUI();
  const [calOpen, setCalOpen] = useState(false);
  const PX = 56, START = 8 * 60, END = 18 * 60;
  const y = (min: number) => ((Math.min(Math.max(min, START), END + 60) - START) / 60) * PX;
  const nowD = new Date(t.now);
  const nowMin = nowD.getHours() * 60 + nowD.getMinutes();

  const open = m.demands.filter(isOpen);
  const late = open.filter((d) => d.due_date && dayDiff(d.due_date) < 0);
  const today = open.filter((d) => d.due_date && dayDiff(d.due_date) === 0);
  const confl = open.filter((d) => conflictOf(d, m));
  const meetings = m.meetingsOn(isoDate(nowD));
  const blocks = open.filter((d) => d.planned_start && new Date(d.planned_start).toDateString() === nowD.toDateString());

  const since = new Date(nowD); since.setHours(0, 0, 0, 0);
  const byAct = [...secondsByActivity(t.entries, since, t.now)].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...byAct.map((r) => r[1]));
  const total = byAct.reduce((a, r) => a + r[1], 0);
  const nameOf = (k: string) => (k.startsWith('d:') ? m.byId.get(k.slice(2))?.title ?? 'Demanda' : k.slice(2) || 'Atividade livre');

  const list = [...late, ...today.filter((d) => !d.parent_id)]
    .sort((a, b) => `${a.due_date}${a.due_time ?? '99'}`.localeCompare(`${b.due_date}${b.due_time ?? '99'}`));

  const hours = [];
  for (let h = 8; h <= 18; h++) hours.push(h);

  return (
    <>
      <div className="stats">
        <span className="chip today">{today.length} para hoje</span>
        <span className="chip late">{late.length} atrasada{late.length === 1 ? '' : 's'}</span>
        <span className="chip conf"><I.warn />{confl.length} conflito{confl.length === 1 ? '' : 's'} com reunião</span>
        <span className="chip"><I.timer /><span className="mono">{dur(total)}</span> registrados hoje</span>
      </div>
      <div className="hoje">
        <div className="panel">
          <h3>Agenda do dia <CalendarSource onOpen={() => setCalOpen(true)} /></h3>
          <div className="tlwrap"><div className="tl">
            {hours.map((h) => <div key={h} className="hr" style={{ top: y(h * 60) }}><span className="mono">{String(h).padStart(2, '0')}:00</span></div>)}
            {meetings.map((mt) => (
              <div key={(mt.id ?? mt.title) + mt.start} className="ev meet" title={mt.title} style={{ top: y(toMinutes(mt.start)!), height: y(toMinutes(mt.end)!) - y(toMinutes(mt.start)!) - 2 }}>
                <b>{mt.title}</b><span className="mono">{mt.start}–{mt.end}</span> · Outlook
              </div>
            ))}
            {blocks.map((d) => {
              const s = new Date(d.planned_start!); const sm = s.getHours() * 60 + s.getMinutes();
              const em = sm + (d.estimated_minutes ?? 60);
              return (
                <div key={d.id} className="ev blk" onClick={() => ui.open(d.id)} style={{ top: y(sm), height: Math.max(18, y(em) - y(sm) - 2) }}>
                  <b>Foco: {d.title}</b><span className="mono">{hm(sm)}–{hm(em)}</span>
                </div>
              );
            })}
            {today.filter((d) => d.due_time).map((d) => {
              const c = conflictOf(d, m);
              return (
                <div key={d.id} className={`due ${c ? 'conf' : ''}`} style={{ top: y(toMinutes(d.due_time)!) }}>
                  <span>{c ? 'Conflito · ' : ''}Entrega {shortTime(d.due_time)} · {d.title.length > 28 ? d.title.slice(0, 28) + '…' : d.title}</span>
                </div>
              );
            })}
            {nowMin >= START && nowMin <= END + 60 && <div className="now" style={{ top: y(nowMin) }} title="Agora" />}
          </div></div>
        </div>
        <div className="stack">
          <div className="panel"><h3>Para fazer hoje</h3>
            <div className="mini">
              {list.map((d) => <DemandRow key={d.id} d={d} m={m} noTime group />)}
              {!list.length && <div className="empty">Tudo em dia.</div>}
            </div>
          </div>
          <div className="panel"><h3>Tempo hoje por atividade</h3>
            <div className="tbars">
              {byAct.map(([k, s]) => (
                <div className="r" key={k}>
                  <span>{nameOf(k)}</span><span className="mono" style={{ textAlign: 'right' }}>{dur(s)}</span>
                  <div className="bar"><i style={{ width: `${(s / max) * 100}%`, background: k.startsWith('d:') ? m.colorOf(m.byId.get(k.slice(2))) : 'var(--muted)' }} /></div>
                </div>
              ))}
              {!byAct.length && <p className="note">Nenhum tempo registrado hoje.</p>}
              <div className="total"><span>Total</span><span className="mono">{dur(total)}</span></div>
            </div>
          </div>
        </div>
      </div>
      {calOpen && <CalendarioModal onClose={() => setCalOpen(false)} />}
    </>
  );
}
