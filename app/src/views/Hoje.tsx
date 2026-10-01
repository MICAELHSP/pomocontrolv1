import { useRef, useState } from 'react';
import { conflictOf, DemandRow } from '../components/DemandRow';
import { I } from '../components/Icons';
import { isOpen, type Model } from '../data/model';
import { dayDiff, dur, hm, isoDate, longDate, shortTime, toMinutes } from '../lib/format';
import { entriesByDay } from '../lib/occupancy';
import { secondsByActivity } from '../lib/pomodoro';
import { useFitHeight } from '../lib/useFit';
import { useIcsDrop } from '../lib/icsDrop';
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
  const ics = useIcsDrop();
  const START = 8 * 60, END = 18 * 60;
  // A agenda ocupa a altura que sobra na tela (sem rolagem); mínimo de 28 px por hora.
  const tlRef = useRef<HTMLDivElement>(null);
  const fit = useFitHeight(tlRef, 560, 48);
  const PX = Math.max(28, Math.floor((fit - 16) / ((END - START) / 60)));
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

  // Tempo trabalhado hoje, em blocos (trechos seguidos da mesma atividade viram um só).
  const worked: { key: string; start: number; end: number }[] = [];
  for (const g of entriesByDay(t.entries, t.now).get(isoDate(nowD)) ?? []) {
    const last = worked[worked.length - 1];
    if (last && last.key === g.key && g.start - last.end <= 2) last.end = Math.max(last.end, g.end);
    else worked.push({ ...g });
  }

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
        <div className={`panel icsdrop ${ics.over ? 'over' : ''}`} {...ics.dropProps}>
          {(ics.over || ics.busy) && <div className="dropmsg">{ics.busy ? 'Importando…' : 'Solte o arquivo .ics para importar'}</div>}
          <h3>Agenda do dia <CalendarSource onOpen={() => setCalOpen(true)} /></h3>
          <div className="tlwrap" ref={tlRef}><div className="tl" style={{ height: ((END - START) / 60) * PX + 4 }}>
            {hours.map((h) => <div key={h} className="hr" style={{ top: y(h * 60) }}><span className="mono">{String(h).padStart(2, '0')}:00</span></div>)}
            {worked.map((w) => {
              const h = y(w.end) - y(w.start);
              const d = w.key.startsWith('d:') ? m.byId.get(w.key.slice(2)) : undefined;
              const label = `${nameOf(w.key)} · ${hm(w.start)}–${hm(w.end)} (${dur((w.end - w.start) * 60)})`;
              return (
                <div key={w.key + w.start} className="ev work" title={`Trabalhado: ${label}`} onClick={() => d && ui.open(d.id)}
                  style={{ top: y(w.start), height: Math.max(4, h - 2), borderLeftColor: d ? m.colorOf(d) : 'var(--muted)', background: `color-mix(in srgb, ${d ? m.colorOf(d) : 'var(--muted)'} 22%, var(--surface))`, padding: h < 20 ? '0 8px' : undefined }}>
                  {h >= 20 && <><b>{nameOf(w.key)}</b><span className="mono">{hm(w.start)}–{hm(w.end)}</span></>}
                </div>
              );
            })}
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
