import { useRef, useState, type CSSProperties } from 'react';
import { lanes } from '../lib/lanes';
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
import { MeetingModal } from './Calendario';
import type { Meeting } from '../lib/types';

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
  const [meetSel, setMeetSel] = useState<Meeting | null>(null);
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
  // Demanda-reunião criada de um evento já aparece como a reunião da agenda; não repete como bloco de foco.
  const blocks = open.filter((d) => d.planned_start && !m.isMeeting(d) && new Date(d.planned_start).toDateString() === nowD.toDateString());

  // Demanda-reunião de hoje vira bloco de reunião com a duração estimada (a do Outlook já aparece, não repete).
  const meetDemands = today.filter((d) => m.isMeeting(d) && d.due_time
    && !meetings.some((mt) => mt.title === d.title && mt.start === shortTime(d.due_time)));
  const dueToday = today.filter((d) => d.due_time && !m.isMeeting(d));
  const dueMins = dueToday.map((d) => toMinutes(d.due_time)!);
  // Bloco que cruza um marcador de entrega deixa espaço à direita para o rótulo não cobrir o texto.
  const underDue = (a: number, b: number) => (dueMins.some((x) => x >= a - 10 && x <= b + 10) ? 96 : undefined);
  // Blocos curtos usam uma linha só (nome e horário lado a lado); bem curtos só no tooltip.
  const evSize = (h: number) => (h < 12 ? 'tiny' : h < 36 ? 'one' : h >= 56 ? 'tall' : '');

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

  // Tudo o que vai na agenda; o que acontece ao mesmo tempo fica lado a lado, sem um cobrir o outro.
  const evs: AgendaEv[] = [
    ...worked.map((w): AgendaEv => {
      const d = w.key.startsWith('d:') ? m.byId.get(w.key.slice(2)) : undefined;
      const col = m.isMeetingKey(w.key) ? 'var(--meet)' : d ? m.colorOf(d) : 'var(--muted)';
      const sub = `${hm(w.start)}–${hm(w.end)}`;
      return { id: 'w' + w.key + w.start, a: w.start, b: w.end, cls: 'work', name: nameOf(w.key), sub,
        title: `Trabalhado: ${nameOf(w.key)} · ${sub} (${dur((w.end - w.start) * 60)})`, onClick: () => d && ui.open(d.id),
        style: { borderLeftColor: col, background: `color-mix(in srgb, ${col} 22%, var(--surface))` } };
    }),
    ...meetings.map((mt): AgendaEv => ({ id: 'm' + (mt.id ?? mt.title) + mt.start, a: toMinutes(mt.start)!, b: toMinutes(mt.end)!, cls: 'meet',
      name: mt.title, sub: `${mt.start}–${mt.end} · Outlook`, title: `${mt.title} · ${mt.start}–${mt.end} · clique para ver`, onClick: () => setMeetSel(mt) })),
    ...meetDemands.map((d): AgendaEv => {
      const a = toMinutes(d.due_time)!, b = a + (d.estimated_minutes ?? 60);
      return { id: 'r' + d.id, a, b, cls: 'meet', name: d.title, sub: `${hm(a)}–${hm(b)}${d.external_ref ? ' · ' + d.external_ref : ''}`,
        title: `Reunião: ${d.title}${d.external_ref ? ' · com ' + d.external_ref : ''} · ${hm(a)}–${hm(b)}`, onClick: () => ui.open(d.id) };
    }),
    ...blocks.map((d): AgendaEv => {
      const s = new Date(d.planned_start!); const a = s.getHours() * 60 + s.getMinutes(), b = a + (d.estimated_minutes ?? 60);
      return { id: 'b' + d.id, a, b, cls: 'blk', name: `Foco: ${d.title}`, sub: `${hm(a)}–${hm(b)}`, min: 18,
        title: `Foco: ${d.title} · ${hm(a)}–${hm(b)}`, onClick: () => ui.open(d.id) };
    }),
  ];

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
            {lanes(evs).map(({ e, col, cols }) => {
              const h = y(e.b) - y(e.a);
              return (
                <div key={e.id} className={`ev ${e.cls} ${evSize(h)}`} title={e.title} onClick={e.onClick}
                  style={{ ...e.style, top: y(e.a), height: Math.max(e.min ?? 4, h - 2), paddingRight: col === cols - 1 ? underDue(e.a, e.b) : undefined,
                    left: `calc(8px + (100% - 16px) * ${col / cols})`, width: `calc((100% - 16px) / ${cols} - ${cols > 1 ? 3 : 0}px)`, right: 'auto' }}>
                  {h >= 12 && <><b>{e.name}</b><span className="mono">{e.sub}</span></>}
                </div>
              );
            })}
            {dueToday.map((d) => {
              const c = conflictOf(d, m);
              return (
                <div key={d.id} className={`due ${c ? 'conf' : ''}`} style={{ top: y(toMinutes(d.due_time)!) }}>
                  <span title={`${c ? 'Conflito com reunião · ' : ''}Entrega ${shortTime(d.due_time)} · ${d.title}`} onClick={() => ui.open(d.id)}>{c ? '⚠ ' : ''}Entrega {shortTime(d.due_time)}</span>
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
      {meetSel && <MeetingModal mt={meetSel} m={m} onClose={() => setMeetSel(null)} />}
    </>
  );
}

type AgendaEv = { id: string; a: number; b: number; cls: string; name: string; sub: string; title: string; onClick: () => void; style?: CSSProperties; min?: number };

