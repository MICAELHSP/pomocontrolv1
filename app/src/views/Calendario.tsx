// Calendário: o que aconteceu em cada dia (tempo registrado nas demandas e atividades livres)
// junto com as reuniões do Outlook. Semana = mapa de atividades; Mês = ocupação; ao lado, o relatório do dia.
import { useMemo, useRef, useState } from 'react';
import { I } from '../components/Icons';
import { Modal } from '../components/Modal';
import { api, qk, useEntriesBetween, useInvalidate } from '../data/api';
import { isOpen, MEETING_TYPE, type Model } from '../data/model';
import { addDays, ddmm, isoDate, MON, parseDate, shortTime, toMinutes, WD, WDL } from '../lib/format';
import { useJornada } from '../data/jornada';
import { dayStats, entriesByDay, holidayOf, hmin, jornadaMinutes, occLabel, type DayStats, type Jornada, type Seg } from '../lib/occupancy';
import { useMeetingsBetween } from '../lib/outlook';
import { errMsg } from '../lib/supabase';
import { useToast } from '../components/Toast';
import type { Demand, Meeting } from '../lib/types';
import { useFitHeight } from '../lib/useFit';
import { useIcsDrop } from '../lib/icsDrop';
import { useTimerCtx } from '../timer/TimerContext';
import { useUI } from '../ui';
import { CalendarioModal } from './CalendarioSettings';
import { JornadaSettings } from './JornadaSettings';

export type CalMode = 'semana' | 'mes';

export function CalendarioToolbar({ mode, setMode }: { mode: CalMode; setMode: (m: CalMode) => void }) {
  return (
    <div className="toolbar">
      <h2>Calendário</h2>
      <div className="seg" role="group" aria-label="Visão">
        {([['semana', 'Semana'], ['mes', 'Mês']] as const).map(([k, l]) => (
          <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

const mondayOf = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const occColor = (p: number) => `color-mix(in srgb, var(--accent) ${Math.max(4, Math.min(72, Math.round((p - 40) * 1.2)))}%, var(--surface))`;
const EMPTY: Seg[] = [];

interface Day { k: string; d: Date; segs: Seg[]; meetings: Meeting[]; st: DayStats; hol: string | null; future: boolean; today: boolean }

export function Calendario({ m, mode }: { m: Model; mode: CalMode }) {
  const t = useTimerCtx();
  const ui = useUI();
  const ics = useIcsDrop();
  const j = useJornada();
  // Clique numa demanda do calendário abre o detalhe dela no painel ao lado.
  const onOpen = (key: string) => { const id = key.startsWith('d:') ? key.slice(2) : ''; if (m.byId.has(id)) ui.open(id); };
  const todayK = isoDate(new Date(t.now));
  const [anchor, setAnchor] = useState(() => new Date());
  const [sel, setSel] = useState<string>(todayK);
  const [modal, setModal] = useState<'' | 'outlook' | 'jornada'>('');
  const [meetSel, setMeetSel] = useState<Meeting | null>(null);

  // Intervalo lido: o mês do âncora (grade seg–dom) mais a semana do âncora.
  const monthFirst = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthLast = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const week0 = mondayOf(anchor);
  const gridFrom = mondayOf(monthFirst), gridTo = addDays(mondayOf(monthLast), 7);
  const from = week0 < gridFrom ? week0 : gridFrom;
  const to = addDays(week0, 7) > gridTo ? addDays(week0, 7) : gridTo;
  const fromK = isoDate(from), toK = isoDate(to);
  const range = useMemo(() => [parseDate(fromK), parseDate(toK)] as const, [fromK, toK]);

  const entriesQ = useEntriesBetween(range[0], range[1]);
  const cal = useMeetingsBetween(range[0], range[1]);
  const segsByDay = useMemo(() => entriesByDay(entriesQ.data ?? [], t.now), [entriesQ.data, t.now]);

  const groupOf = (id: string) => m.byId.get(id)?.group_id ?? '';
  const colorOfKey = (key: string) => (m.isMeetingKey(key) ? 'var(--meet)' : key.startsWith('d:') ? m.colorOf(m.byId.get(key.slice(2))) : 'var(--muted)');
  const nameOfKey = (key: string) => (key.startsWith('d:') ? m.byId.get(key.slice(2))?.title ?? 'Demanda removida' : key.slice(2) || 'Atividade livre');
  const colorOfGroup = (g: string) => (g ? m.groupColor(m.groupById.get(g), m.groups.findIndex((x) => x.id === g)) : 'var(--muted)');

  const day = (d: Date): Day => {
    const k = isoDate(d), segs = segsByDay.get(k) ?? EMPTY, meetings = cal.meetingsOn(k);
    return { k, d, segs, meetings, st: dayStats(k, segs, meetings, j, groupOf, m.isMeetingKey), hol: holidayOf(k), future: k > todayK, today: k === todayK };
  };

  const dues = (k: string) => m.demands.filter((d) => isOpen(d) && d.due_date === k && d.due_time);

  const shift = (n: number) => {
    const a = new Date(anchor);
    if (mode === 'mes') a.setMonth(a.getMonth() + n, 1); else a.setDate(a.getDate() + 7 * n);
    setAnchor(a);
  };

  const monthDays: Day[] = [];
  for (let d = new Date(monthFirst); d <= monthLast; d = addDays(d, 1)) monthDays.push(day(d));
  const selDay = day(parseDate(sel));

  return (
    <div className="calview">
      <div className={`stack icsdrop ${ics.over ? 'over' : ''}`} style={{ gap: 14, minWidth: 0 }} {...ics.dropProps}>
        {(ics.over || ics.busy) && <div className="dropmsg">{ics.busy ? 'Importando…' : 'Solte o arquivo .ics para importar'}</div>}
        <MonthSummary days={monthDays} month={monthFirst} />
        {entriesQ.error ? <div className="cfgbanner">Não foi possível ler o tempo registrado: {errMsg(entriesQ.error)}</div> : null}
        {cal.available && !cal.connected && (
          <div className="cfgbanner">As reuniões do Outlook ainda não estão no calendário. <button className="linkbtn" onClick={() => setModal('outlook')}>Conectar Outlook</button></div>
        )}
        {cal.error ? <div className="cfgbanner">Erro ao ler o Outlook: {errMsg(cal.error)}</div> : null}
        {mode === 'mes'
          ? <MonthGrid days={monthDays} month={monthFirst} sel={sel} onSel={setSel} onShift={shift} colorOfGroup={colorOfGroup} m={m} jMin={jornadaMinutes(j)} jDays={j.days} nameOfKey={nameOfKey} />
          : <WeekMap days={[0, 1, 2, 3, 4].map((i) => day(addDays(week0, i)))} sel={sel} onSel={setSel} onShift={shift} now={t.now} isMeeting={m.isMeeting}
              colorOfKey={colorOfKey} nameOfKey={nameOfKey} dues={dues} onOpen={onOpen} onMeeting={setMeetSel} />}
      </div>
      <DayReport day={selDay} j={j} colorOfKey={colorOfKey} nameOfKey={nameOfKey} colorOfGroup={colorOfGroup} dues={dues} onOpen={onOpen} onMeeting={setMeetSel} isMeetingKey={m.isMeetingKey} onJornada={() => setModal('jornada')} />
      {modal === 'outlook' && <CalendarioModal onClose={() => setModal('')} />}
      {meetSel && <MeetingModal mt={meetSel} m={m} onClose={() => setMeetSel(null)} />}
      {modal === 'jornada' && <Modal label="Jornada de trabalho" onClose={() => setModal('')}><JornadaSettings /></Modal>}
    </div>
  );
}

function MonthSummary({ days, month }: { days: Day[]; month: Date }) {
  const work = days.filter((x) => x.st.J > 0);
  const past = days.filter((x) => !x.future);
  const reg = past.reduce((a, x) => a + x.st.dem + x.st.free, 0);
  const meet = days.reduce((a, x) => a + (x.future ? 0 : x.st.meet), 0);
  const full = work.filter((x) => !x.future && !x.today && x.st.pct != null);
  const avg = full.length ? Math.round(full.reduce((a, x) => a + x.st.pct!, 0) / full.length) : null;
  return (
    <div className="stats" style={{ margin: 0 }}>
      <span className="chip">{cap(MON[month.getMonth()])}: {work.length} dias úteis</span>
      <span className="chip"><I.timer />{hmin(reg)} registradas</span>
      <span className="chip conf">{hmin(meet)} em reuniões</span>
      {avg != null && <span className={`chip ${avg >= 85 ? 'today' : 'ok'}`}>Ocupação média {avg}% (sem hoje)</span>}
    </div>
  );
}

function StackBar({ st, tall, colorOfGroup }: { st: DayStats; tall?: boolean; colorOfGroup: (g: string) => string }) {
  const tot = Math.max(st.J, st.used, 1);
  const seg = (v: number, c: string, l: string) => (v ? <i key={l} style={{ width: `${(v / tot) * 100}%`, background: c }} title={`${l}: ${hmin(v)}`} /> : null);
  return (
    <div className={`stack-bar ${tall ? 'tall' : ''}`}>
      {[...st.byGroup].map(([g, v]) => seg(v, colorOfGroup(g), g || 'Sem grupo'))}
      {seg(st.free, 'var(--muted)', 'Atividades livres')}
      {seg(st.meet, 'var(--meet)', 'Reuniões')}
    </div>
  );
}

function Nav({ label, onShift }: { label: string; onShift: (n: number) => void }) {
  return (
    <div className="wnav">
      <button className="iconbtn" aria-label="Anterior" onClick={() => onShift(-1)}>‹</button>
      <b>{label}</b>
      <button className="iconbtn" aria-label="Próximo" onClick={() => onShift(1)}>›</button>
    </div>
  );
}

function MonthGrid({ days, month, sel, onSel, onShift, colorOfGroup, m, jMin, jDays, nameOfKey }: {
  days: Day[]; month: Date; sel: string; onSel: (k: string) => void; onShift: (n: number) => void;
  colorOfGroup: (g: string) => string; m: Model; jMin: number; jDays: number[]; nameOfKey: (k: string) => string;
}) {
  const lead = (month.getDay() + 6) % 7, tail = (7 - ((lead + days.length) % 7)) % 7;
  return (
    <div className="panel">
      <Nav label={`${cap(MON[month.getMonth()])} de ${month.getFullYear()}`} onShift={onShift} />
      <div className="mgrid">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((w) => <div key={w} className="mhd">{w}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} className="mc out" />)}
        {days.map((x) => {
          const off = !jDays.includes(x.d.getDay());
          const has = !x.future && (x.st.used > 0 || x.st.J > 0);
          const bg = !x.hol && !x.future && x.st.pct != null ? occColor(x.st.pct) : undefined;
          return (
            <button key={x.k} className={`mc ${off ? 'wk' : ''} ${sel === x.k ? 'sel' : ''} ${x.today ? 'today' : ''}`} style={bg ? { background: bg } : undefined}
              onClick={() => onSel(x.k)} aria-label={`${x.d.getDate()} de ${MON[month.getMonth()]}${x.st.pct != null && !x.future ? `, ocupação ${x.st.pct}%` : ''}`}>
              <span className="mcd">{x.d.getDate()}</span>
              <MeetTip x={x} m={m} nameOfKey={nameOfKey} right={x.d.getDay() === 0 || x.d.getDay() >= 5} />
              {x.hol ? <span className="mch">Feriado</span>
                : x.future ? (x.meetings.length ? <span className="mch mono">{hmin(x.st.meet)} reuniões</span> : null)
                : has ? <>
                    {x.st.pct != null && <span className="mcp mono">{x.st.pct}%</span>}
                    <span className="mch mono">{hmin(x.st.used)}</span>
                    <StackBar st={x.st} colorOfGroup={colorOfGroup} />
                  </> : null}
            </button>
          );
        })}
        {Array.from({ length: tail }, (_, i) => <div key={`t${i}`} className="mc out" />)}
      </div>
      <div className="legend">
        {m.groups.map((g, i) => <span key={g.id}><i style={{ background: m.groupColor(g, i) }} />{g.name}</span>)}
        <span><i style={{ background: 'var(--muted)' }} />Atividades livres</span>
        <span><i style={{ background: 'var(--meet)' }} />Reuniões</span>
        <span className="note">Cor do dia = ocupação da jornada de {hmin(jMin)}</span>
      </div>
    </div>
  );
}

const START = 8 * 60, END = 18 * 60;

function WeekMap({ days, sel, onSel, onShift, now, colorOfKey, nameOfKey, dues, onOpen, onMeeting, isMeeting }: {
  isMeeting: (d: Demand) => boolean;
  days: Day[]; sel: string; onSel: (k: string) => void; onShift: (n: number) => void; now: number;
  colorOfKey: (k: string) => string; nameOfKey: (k: string) => string; dues: (k: string) => Model['demands']; onOpen: (key: string) => void; onMeeting: (mt: Meeting) => void;
}) {
  const nowD = new Date(now), nowMin = nowD.getHours() * 60 + nowD.getMinutes();
  const hours = [];
  for (let h = 8; h <= 18; h++) hours.push(h);
  // Altura da hora ajustada ao espaço da tela, para a semana caber sem rolagem.
  const bodyRef = useRef<HTMLDivElement>(null);
  const fit = useFitHeight(bodyRef, 510, 88);
  const PX = Math.max(26, Math.floor((fit - 8) / ((END - START) / 60)));
  const wy = (min: number) => ((Math.min(Math.max(min, START), END) - START) / 60) * PX;
  const grid = `repeating-linear-gradient(to bottom,transparent 0 ${PX - 1}px,var(--line) ${PX - 1}px ${PX}px)`;
  return (
    <div className="panel">
      <Nav label={`Semana de ${ddmm(days[0].d)} a ${ddmm(days[4].d)}`} onShift={onShift} />
      <div className="wwrap"><div className="wgrid">
        <div className="whead"><div />
          {days.map((x) => (
            <button key={x.k} className={`whd ${sel === x.k ? 'sel' : ''}`} onClick={() => onSel(x.k)}>
              <b>{WD[x.d.getDay()]}, {ddmm(x.d)}</b>
              <span className="note">{x.hol ? 'Feriado' : x.future ? 'Planejado' : `${hmin(x.st.used)}${x.st.pct != null ? ` · ${x.st.pct}%` : ''}`}</span>
            </button>
          ))}
        </div>
        <div className="wbody" ref={bodyRef} style={{ height: ((END - START) / 60) * PX + 4 }}>
          <div className="whours">{hours.map((h) => <div key={h} className="whr" style={{ top: wy(h * 60) }}><span className="mono">{String(h).padStart(2, '0')}h</span></div>)}</div>
          {days.map((x) => (
            <div key={x.k} className={`wcol ${x.hol ? 'hol' : ''} ${sel === x.k ? 'sel' : ''}`} style={{ backgroundImage: grid }} onClick={() => onSel(x.k)}>
              {x.meetings.map((mt) => {
                const a = toMinutes(mt.start)!, b = toMinutes(mt.end)!;
                if (b <= START || a >= END) return null;
                return <div key={(mt.id ?? mt.title) + mt.start} className="wb meet link" style={{ top: wy(a), height: Math.max(3, wy(b) - wy(a) - 1) }} title={`${mt.title} ${mt.start}–${mt.end} · clique para ver`}
                  onClick={(e) => { e.stopPropagation(); onSel(x.k); onMeeting(mt); }}><span>{mt.title}</span></div>;
              })}
              {x.segs.map((s, i) => {
                if (s.end <= START || s.start >= END) return null;
                const dem = s.key.startsWith('d:');
                return <div key={i} className={`wb ${dem ? 'link' : ''}`} style={{ top: wy(s.start), height: Math.max(3, wy(s.end) - wy(s.start) - 1), background: colorOfKey(s.key) }}
                  title={`${nameOfKey(s.key)} ${hmm(s.start)}–${hmm(s.end)}${dem ? ' · clique para abrir' : ''}`}
                  onClick={dem ? (e) => { e.stopPropagation(); onSel(x.k); onOpen(s.key); } : undefined}><span>{nameOfKey(s.key)}</span></div>;
              })}
              {dues(x.k).map((d) => {
                const tm = toMinutes(d.due_time)!;
                if (tm < START || tm > END) return null;
                // Demanda-reunião aparece como bloco de reunião com a duração estimada, não como entrega.
                if (isMeeting(d)) {
                  const b = tm + (d.estimated_minutes ?? 60);
                  return <div key={d.id} className="wb meet link" style={{ top: wy(tm), height: Math.max(3, wy(b) - wy(tm) - 1) }} title={`Reunião: ${d.title}${d.external_ref ? ' · com ' + d.external_ref : ''} ${hmm(tm)}–${hmm(b)} · clique para abrir`}
                    onClick={(e) => { e.stopPropagation(); onSel(x.k); onOpen('d:' + d.id); }}><span>{d.title}</span></div>;
                }
                return <div key={d.id} className="wdue link" style={{ top: wy(tm) }} title={`Entrega: ${d.title} · clique para abrir`}
                  onClick={(e) => { e.stopPropagation(); onSel(x.k); onOpen('d:' + d.id); }}><span>{shortTime(d.due_time)} entrega</span></div>;
              })}
              {x.today && nowMin >= START && nowMin <= END && <div className="now" style={{ top: wy(nowMin) }} />}
            </div>
          ))}
        </div>
      </div></div>
      <p className="note">Blocos coloridos são o tempo que você registrou em cada demanda, mesmo as que nunca foram para o calendário. Reuniões hachuradas vêm do Outlook.</p>
    </div>
  );
}

const hmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function DayReport({ day: x, j, colorOfKey, nameOfKey, colorOfGroup, dues, onOpen, onMeeting, isMeetingKey, onJornada }: {
  day: Day; j: Jornada; colorOfKey: (k: string) => string; nameOfKey: (k: string) => string;
  colorOfGroup: (g: string) => string; dues: (k: string) => Model['demands']; onOpen: (key: string) => void;
  onMeeting: (mt: Meeting) => void; isMeetingKey: (k: string) => boolean; onJornada: () => void;
}) {
  const label = `${cap(WDL[x.d.getDay()])}, ${ddmm(x.d)}`;
  const foot = <p className="note">Reunião que coincide com tempo registrado conta uma vez só. Jornada: {j.start}–{j.end}, {j.lunch} min de almoço. <button className="linkbtn" onClick={onJornada}>Alterar jornada</button></p>;
  // Reuniões do dia: as da agenda (Outlook/.ics) e as registradas como demanda-reunião.
  const regs = meetingSegs(x, isMeetingKey);
  const meetList = (x.meetings.length > 0 || regs.length > 0) && (
    <div className="sect"><h4>Reuniões</h4>
      {x.meetings.map((mt) => (
        <div className="item link" key={(mt.id ?? mt.title) + mt.start} onClick={() => onMeeting(mt)} title="Ver a reunião">
          <span>{mt.title}</span><span className="mono note" style={{ marginLeft: 'auto' }}>{mt.start}–{mt.end}</span></div>
      ))}
      {regs.map((g) => (
        <div className={`item ${g.key.startsWith('d:') ? 'link' : ''}`} key={g.key + g.start} onClick={() => onOpen(g.key)} title={g.key.startsWith('d:') ? 'Abrir demanda' : undefined}>
          <span>{nameOfKey(g.key)} <span className="note">(registrada)</span></span><span className="mono note" style={{ marginLeft: 'auto' }}>{hmm(g.start)}–{hmm(g.end)}</span></div>
      ))}
    </div>
  );

  if (x.hol && !x.st.used) return <div className="panel dayrep"><h3>{label}</h3><p className="note">Feriado: {x.hol}. Fora da jornada.</p></div>;
  if (x.future) {
    const ds = dues(x.k);
    return (
      <div className="panel dayrep stack" style={{ gap: 12 }}>
        <h3>{label} <span className="chip">Planejado</span></h3>
        <p className="note">Reuniões marcadas: {x.meetings.length} ({hmin(x.st.meet)}).{x.st.J ? ` Sobram ${hmin(Math.max(0, x.st.J - x.st.meet))} da jornada para demandas.` : ''}</p>
        {ds.length > 0 && <div className="sect"><h4>Entregas</h4>{ds.map((d) => <div className="item link" key={d.id} onClick={() => onOpen('d:' + d.id)} title="Abrir demanda"><span>{d.title}</span><span className="mono note" style={{ marginLeft: 'auto' }}>{shortTime(d.due_time)}</span></div>)}</div>}
        {meetList}
        {foot}
      </div>
    );
  }

  const rows = [...x.st.byKey].sort((a, b) => b[1] - a[1]);
  const pct = x.st.pct;
  const PXm = 100 / (END - START);
  const pos = (a: number, b: number) => ({ left: `${(Math.max(a, START) - START) * PXm}%`, width: `${(Math.min(b, END) - Math.max(a, START)) * PXm}%` });
  return (
    <div className="panel dayrep stack" style={{ gap: 14 }}>
      <div>
        <h3>{label}{x.today && <span className="chip today">hoje, até agora</span>}</h3>
        {pct != null
          ? <div className="bigocc"><span className="mono">{pct}%</span><span className="note">da jornada ocupada · {hmin(x.st.used)} de {hmin(x.st.J)}</span>
              <span className={`chip ${pct >= 95 ? 'late' : pct >= 80 ? 'today' : 'ok'}`}>{occLabel(pct)}</span></div>
          : <div className="bigocc"><span className="mono">{hmin(x.st.used)}</span><span className="note">registradas · dia fora da jornada</span></div>}
      </div>
      <StackBar st={x.st} tall colorOfGroup={colorOfGroup} />
      <dl className="occ4">
        <div><dt>Demandas</dt><dd className="mono">{hmin(x.st.dem)}</dd></div>
        <div><dt>Atividades livres</dt><dd className="mono">{hmin(x.st.free)}</dd></div>
        <div><dt>Reuniões</dt><dd className="mono">{hmin(x.st.meet)}</dd></div>
        <div><dt>Sem registro</dt><dd className="mono">{hmin(x.st.idle)}</dd></div>
      </dl>
      <div className="sect"><h4>Mapa do dia <span className="n">08h a 18h</span></h4>
        <div className="strip">
          {x.meetings.map((mt) => { const a = toMinutes(mt.start)!, b = toMinutes(mt.end)!; return b > START && a < END ? <i key={'m' + (mt.id ?? mt.title) + mt.start} className="sm" style={pos(a, b)} /> : null; })}
          {x.segs.map((s, i) => (s.end > START && s.start < END ? <i key={i} className={s.key.startsWith('d:') ? 'link' : undefined} style={{ ...pos(s.start, s.end), background: colorOfKey(s.key) }} title={nameOfKey(s.key)} onClick={() => onOpen(s.key)} /> : null))}
        </div>
        <div className="stripax mono"><span>08</span><span>10</span><span>12</span><span>14</span><span>16</span><span>18</span></div>
      </div>
      <div className="sect"><h4>Por demanda</h4>
        <div className="tbars">
          {rows.map(([k, v]) => (
            <div className={`r ${k.startsWith('d:') ? 'link' : ''}`} key={k} onClick={() => onOpen(k)} title={k.startsWith('d:') ? 'Abrir demanda' : undefined}>
              <span><span className="dot" style={{ display: 'inline-block', marginRight: 6, background: colorOfKey(k) }} />{nameOfKey(k)}</span>
              <span className="mono" style={{ textAlign: 'right' }}>{hmin(v)}</span>
              <div className="bar"><i style={{ width: `${(v / rows[0][1]) * 100}%`, background: colorOfKey(k) }} /></div>
            </div>
          ))}
          {!rows.length && <p className="note">Nenhum tempo registrado neste dia.</p>}
        </div>
      </div>
      {meetList}
      {foot}
    </div>
  );
}

/** Trechos de tempo registrados em reunião (demanda-reunião ou "Reunião não planejada"), juntando os seguidos. */
function meetingSegs(x: Day, isMeetingKey: (k: string) => boolean): Seg[] {
  const out: Seg[] = [];
  for (const g of x.segs) {
    if (!isMeetingKey(g.key)) continue;
    const last = out[out.length - 1];
    if (last && last.key === g.key && g.start - last.end <= 2) last.end = Math.max(last.end, g.end);
    else out.push({ ...g });
  }
  return out;
}

/** Dica ao passar o mouse num dia do mês: as reuniões do dia. */
function MeetTip({ x, m, nameOfKey, right }: { x: Day; m: Model; nameOfKey: (k: string) => string; right: boolean }) {
  const regs = meetingSegs(x, m.isMeetingKey);
  if (!x.meetings.length && !regs.length) return null;
  return (
    <span className={`mtip ${right ? 'r' : ''}`} role="tooltip">
      <b>Reuniões</b>
      {x.meetings.map((mt) => <span key={(mt.id ?? mt.title) + mt.start} className="mtr"><span className="mono">{mt.start}–{mt.end}</span>{mt.title}</span>)}
      {regs.map((g) => <span key={g.key + g.start} className="mtr"><span className="mono">{hmm(g.start)}–{hmm(g.end)}</span>{nameOfKey(g.key)} (registrada)</span>)}
    </span>
  );
}

/** Demanda-reunião já criada a partir deste evento (mesmo assunto, dia e hora). */
const demandOfMeeting = (m: Model, mt: Meeting) => m.demands.find((x) => m.isMeeting(x) && x.title === mt.title
  && x.due_date === (mt.date ?? null) && (x.due_time ?? '').slice(0, 5) === mt.start);

/** Detalhe de uma reunião da agenda (Outlook ou .ics), com a opção de virar demanda-reunião. */
export function MeetingModal({ mt, m, onClose }: { mt: Meeting; m: Model; onClose: () => void }) {
  const ui = useUI();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const d = mt.date ? parseDate(mt.date) : null;
  const linked = demandOfMeeting(m, mt);

  // Cria a demanda com assunto, dia, horário e duração do evento. O tempo dela só conta se você
  // cronometrar, e o que coincidir com a reunião da agenda conta uma vez só.
  async function convert() {
    if (linked) { ui.open(linked.id); onClose(); return; }
    setBusy(true);
    try {
      const typeId = m.meetingTypeId ?? (await api.addType(MEETING_TYPE)).id;
      const [a, b] = [toMinutes(mt.start)!, toMinutes(mt.end)!];
      const start = mt.date ? new Date(`${mt.date}T${mt.start}:00`) : null;
      const dm = await api.addDemand({
        title: mt.title, type_id: typeId, due_date: mt.date ?? null, due_time: mt.start,
        planned_start: start ? start.toISOString() : null, estimated_minutes: Math.max(1, b - a),
        description: mt.location ? `Local: ${mt.location}` : null,
      });
      await invalidate(qk.types, qk.demands);
      toast('Reunião virou demanda: anote o que houve, a checklist e quem participou.');
      ui.open(dm.id);
      onClose();
    } catch (e) { toast(errMsg(e)); }
    setBusy(false);
  }

  return (
    <Modal label="Reunião" onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0, paddingRight: 32 }}>{mt.title}</h3>
        <p className="note" style={{ margin: 0 }}>{d ? `${cap(WDL[d.getDay()])}, ${ddmm(d)} · ` : ''}<span className="mono">{mt.start}–{mt.end}</span></p>
        {mt.location && <p style={{ margin: 0 }}><b>Local:</b> {/^https?:\/\//.test(mt.location) ? <a className="link" href={mt.location} target="_blank" rel="noreferrer">{mt.location}</a> : mt.location}</p>}
        <div className="ai-row">
          <button className="btn primary" disabled={busy} onClick={convert}>{linked ? 'Abrir a demanda-reunião' : busy ? 'Criando…' : 'Virar demanda-reunião'}</button>
          {mt.webLink && <a className="btn" href={mt.webLink} target="_blank" rel="noreferrer">Abrir no Outlook</a>}
          <button className="btn" onClick={onClose}>Fechar</button>
        </div>
        <p className="fine" style={{ margin: 0 }}>{linked ? 'Esta reunião já tem uma demanda para anotações e checklist.' : 'A demanda-reunião guarda anotações, checklist e com quem foi. A reunião continua na agenda.'}</p>
      </div>
    </Modal>
  );
}
