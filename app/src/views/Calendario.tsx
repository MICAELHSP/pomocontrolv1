// Calendário: mapa das atividades por semana, ocupação por mês e relatório do dia.
import { useMemo, useState } from 'react';
import { I } from '../components/Icons';
import { useRange } from '../data/api';
import { MEETINGS, isOpen, type Model } from '../data/model';
import { MON, WD, WDL, addDays, ddmm, isoDate, parseDate, shortTime, toMinutes } from '../lib/format';
import { holidayName, jornadaMinutes, loadJornada } from '../lib/jornada';
import { dayStats, mondayOf, monthDays, occClass, occLabel, segmentsByDay, type DayStats, type Seg } from '../lib/occupancy';
import type { Meeting } from '../lib/types';
import { useUI } from '../ui';

type Mode = 'semana' | 'mes';
const hmin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`);
const occColor = (p: number) => `color-mix(in srgb, var(--accent) ${Math.max(4, Math.min(72, Math.round((p - 40) * 1.2)))}%, var(--surface))`;
const PX = 50, START = 8 * 60, y = (m: number) => ((m - START) / 60) * PX;

export function useCalState() {
  const [mode, setMode] = useState<Mode>('semana');
  const [day, setDay] = useState(() => isoDate(new Date()));
  return { mode, setMode, day, setDay };
}
type CalState = ReturnType<typeof useCalState>;

export function CalendarioToolbar({ mode, setMode, setDay }: CalState) {
  return (
    <div className="toolbar">
      <h2>Calendário</h2>
      <div className="seg" role="group" aria-label="Visão">
        {([['semana', 'Semana'], ['mes', 'Mês']] as const).map(([k, l]) => (
          <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
      <button className="btn" onClick={() => setDay(isoDate(new Date()))}>Hoje</button>
    </div>
  );
}

/** Reuniões de um dia. Vêm do Outlook quando a integração estiver ligada. */
function meetingsOn(k: string): (Meeting & { s: number; e: number })[] {
  const today = isoDate(new Date());
  return MEETINGS
    .filter((m) => ((m as Meeting & { date?: string }).date ?? today) === k)
    .map((m) => ({ ...m, s: toMinutes(m.start) ?? 0, e: toMinutes(m.end) ?? 0 }))
    .sort((a, b) => a.s - b.s);
}

export function Calendario({ m, mode, day, setDay }: { m: Model } & CalState) {
  const ui = useUI();
  const jor = useMemo(() => loadJornada(), []);
  const J = jornadaMinutes(jor);
  const sel = parseDate(day);
  const monday = mondayOf(sel);
  const mStart = new Date(sel.getFullYear(), sel.getMonth(), 1);
  const mEnd = new Date(sel.getFullYear(), sel.getMonth(), monthDays(sel.getFullYear(), sel.getMonth()));
  const from = isoDate(monday < mStart ? monday : mStart);
  const to = isoDate(addDays(monday, 6) > mEnd ? addDays(monday, 6) : mEnd);
  const range = useRange(from, to);
  const todayK = isoDate(new Date());

  const segs = useMemo(() => segmentsByDay(range.data ?? []), [range.data]);
  const groupOf = (id: string) => m.byId.get(id)?.group_id ?? null;
  const statsOf = (k: string): DayStats | null => {
    const d = parseDate(k);
    if (holidayName(k) || !jor.days.includes(d.getDay())) return null;
    if (k > todayK) return null;
    return dayStats(segs.get(k) ?? [], meetingsOn(k), J, groupOf);
  };
  const colorOfSeg = (s: Seg) => (s.demandId ? m.colorOf(m.byId.get(s.demandId)) : 'var(--muted)');
  const titleOfSeg = (s: Seg) => (s.demandId ? m.byId.get(s.demandId)?.title ?? 'Demanda removida' : s.free!);
  const groupColor = (gid: string) => { const g = m.groupById.get(gid); return g ? m.groupColor(g, m.groups.indexOf(g)) : 'var(--muted)'; };

  const stackBar = (st: DayStats, tall?: boolean) => {
    const tot = Math.max(st.J, st.used) || 1;
    const seg = (v: number, c: string, l: string) => (v ? <i key={l} style={{ width: `${(v / tot) * 100}%`, background: c }} title={`${l}: ${hmin(v)}`} /> : null);
    return (
      <div className={'stack-bar' + (tall ? ' tall' : '')}>
        {[...st.byGroup].map(([g, v]) => seg(v, groupColor(g), m.groupById.get(g)?.name ?? 'Sem grupo'))}
        {seg(st.free, 'var(--muted)', 'Atividades livres')}
        {seg(st.meet, 'var(--meet)', 'Reuniões')}
      </div>
    );
  };

  // ---- resumo do mês ----
  const monthKeys: string[] = [];
  for (let i = 1; i <= mEnd.getDate(); i++) {
    const d = new Date(sel.getFullYear(), sel.getMonth(), i), k = isoDate(d);
    if (jor.days.includes(d.getDay()) && !holidayName(k)) monthKeys.push(k);
  }
  const past = monthKeys.map((k) => [k, statsOf(k)] as const).filter((x): x is [string, DayStats] => !!x[1]);
  const sum = (f: (s: DayStats) => number) => past.reduce((a, [, s]) => a + f(s), 0);
  const full = past.filter(([k]) => k !== todayK);
  const avg = full.length ? Math.round(full.reduce((a, [, s]) => a + s.pct, 0) / full.length) : null;
  const summary = (
    <div className="stats" style={{ margin: 0 }}>
      <span className="chip">{MON[sel.getMonth()][0].toUpperCase() + MON[sel.getMonth()].slice(1)}: {monthKeys.length} dias úteis</span>
      <span className="chip"><I.timer />{hmin(sum((s) => s.dem + s.free))} registradas</span>
      {sum((s) => s.meet) > 0 && <span className="chip conf">{hmin(sum((s) => s.meet))} em reuniões</span>}
      {avg !== null && <span className={'chip ' + (avg >= 85 ? 'today' : 'ok')}>Ocupação média {avg}%{past.some(([k]) => k === todayK) ? ' (sem hoje)' : ''}</span>}
      {range.isLoading && <span className="note">Carregando…</span>}
      {range.error && <span className="chip late">Não foi possível ler o tempo registrado</span>}
    </div>
  );

  // ---- mês ----
  const month = () => {
    const lead = (mStart.getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(<div key={'l' + i} className="mc out" />);
    for (let i = 1; i <= mEnd.getDate(); i++) {
      const d = new Date(sel.getFullYear(), sel.getMonth(), i), k = isoDate(d);
      const hol = holidayName(k), wk = !jor.days.includes(d.getDay()), st = statsOf(k);
      cells.push(
        <button key={k} className={['mc', wk && 'wk', k === day && 'sel', k === todayK && 'today'].filter(Boolean).join(' ')}
          style={st ? { background: occColor(st.pct) } : undefined} onClick={() => setDay(k)}
          aria-label={`${i} de ${MON[d.getMonth()]}${st ? ', ocupação ' + st.pct + '%' : ''}`}>
          <span className="mcd">{i}</span>
          {hol ? <span className="mch">Feriado</span> : st ? <><span className="mcp mono">{st.pct}%</span><span className="mch mono">{hmin(st.used)}</span>{stackBar(st)}</> : null}
        </button>,
      );
    }
    const tail = (7 - ((lead + mEnd.getDate()) % 7)) % 7;
    for (let i = 0; i < tail; i++) cells.push(<div key={'t' + i} className="mc out" />);
    return (
      <div className="panel">
        <div className="wnav">
          <button className="iconbtn" aria-label="Mês anterior" onClick={() => setDay(isoDate(new Date(sel.getFullYear(), sel.getMonth() - 1, 1)))}>‹</button>
          <b>{MON[sel.getMonth()]} de {sel.getFullYear()}</b>
          <button className="iconbtn" aria-label="Próximo mês" onClick={() => setDay(isoDate(new Date(sel.getFullYear(), sel.getMonth() + 1, 1)))}>›</button>
        </div>
        <div className="mgrid">{['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((w) => <div key={w} className="mhd">{w}</div>)}{cells}</div>
        <div className="legend">
          {m.groups.map((g, i) => <span key={g.id}><i style={{ background: m.groupColor(g, i) }} />{g.name}</span>)}
          <span><i style={{ background: 'var(--muted)' }} />Atividades livres</span>
          <span><i style={{ background: 'var(--meet)' }} />Reuniões</span>
          <span className="note">Cor do dia = ocupação da jornada de {hmin(J)}</span>
        </div>
      </div>
    );
  };

  // ---- semana ----
  const week = () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i)).filter((d, i) => i < 5 || jor.days.includes(d.getDay()));
    const cols = { gridTemplateColumns: `36px repeat(${days.length},minmax(0,1fr))` };
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return (
      <div className="panel">
        <div className="wnav">
          <button className="iconbtn" aria-label="Semana anterior" onClick={() => setDay(isoDate(addDays(monday, -7)))}>‹</button>
          <b>Semana de {ddmm(days[0])} a {ddmm(days[days.length - 1])}</b>
          <button className="iconbtn" aria-label="Próxima semana" onClick={() => setDay(isoDate(addDays(monday, 7)))}>›</button>
        </div>
        <div className="wwrap"><div className="wgrid">
          <div className="whead" style={cols}>
            <div />
            {days.map((d) => {
              const k = isoDate(d), hol = holidayName(k), st = statsOf(k);
              return (
                <button key={k} className={'whd' + (k === day ? ' sel' : '')} onClick={() => setDay(k)}>
                  <b>{WD[d.getDay()]}, {ddmm(d)}</b>
                  <span className="note">{hol ? 'Feriado' : k > todayK ? 'Planejado' : st ? `${hmin(st.used)} · ${st.pct}%` : hmin((segs.get(k) ?? []).reduce((a, s) => a + s.e - s.s, 0))}</span>
                </button>
              );
            })}
          </div>
          <div className="wbody" style={cols}>
            <div className="whours">
              {Array.from({ length: 11 }, (_, i) => 8 + i).map((h) => <div key={h} className="whr" style={{ top: y(h * 60) }}><span className="mono">{String(h).padStart(2, '0')}h</span></div>)}
            </div>
            {days.map((d) => {
              const k = isoDate(d);
              const clip = (s: number, e: number) => [Math.max(START, s), Math.min(18 * 60, e)] as const;
              return (
                <div key={k} className={['wcol', holidayName(k) && 'hol', k === day && 'sel'].filter(Boolean).join(' ')} onClick={() => setDay(k)}>
                  {meetingsOn(k).map((mt, i) => {
                    const [s, e] = clip(mt.s, mt.e); if (e <= s) return null;
                    return <div key={'m' + i} className="wb meet" style={{ top: y(s), height: y(e) - y(s) - 1 }} title={`${mt.title} ${mt.start}–${mt.end}`}><span>{mt.title}</span></div>;
                  })}
                  {(segs.get(k) ?? []).map((sg, i) => {
                    const [s, e] = clip(sg.s, sg.e); if (e <= s) return null;
                    return (
                      <div key={i} className="wb" style={{ top: y(s), height: Math.max(3, y(e) - y(s) - 1), background: colorOfSeg(sg) }}
                        title={`${titleOfSeg(sg)} ${shortTime(hmStr(sg.s))}–${shortTime(hmStr(sg.e))}`}
                        onClick={(ev) => { if (sg.demandId && m.byId.has(sg.demandId)) { ev.stopPropagation(); setDay(k); ui.open(sg.demandId); } }}>
                        <span>{titleOfSeg(sg)}</span>
                      </div>
                    );
                  })}
                  {m.demands.filter((t) => isOpen(t) && t.due_date === k && t.due_time).map((t) => {
                    const mm = toMinutes(t.due_time)!; if (mm < START || mm > 18 * 60) return null;
                    return <div key={'d' + t.id} className="wdue" style={{ top: y(mm) }} title={`Entrega: ${t.title}`}><span>{shortTime(t.due_time)} entrega</span></div>;
                  })}
                  {k === todayK && nowMin >= START && nowMin <= 18 * 60 && <div className="now" style={{ top: y(nowMin) }} />}
                </div>
              );
            })}
          </div>
        </div></div>
        <p className="note">Blocos coloridos são o tempo que você registrou em cada demanda, mesmo as que nunca foram para o calendário. Clique num bloco para abrir a demanda.{MEETINGS.length ? ' Reuniões hachuradas vêm do Outlook.' : ''}</p>
      </div>
    );
  };

  // ---- relatório do dia ----
  const report = () => {
    const d = sel, k = day;
    const label = `${WDL[d.getDay()][0].toUpperCase() + WDL[d.getDay()].slice(1)}, ${ddmm(d)}`;
    const hol = holidayName(k);
    if (hol) return <div className="panel dayrep"><h3>{label}</h3><p className="note">Feriado: {hol}. Fora da jornada.</p></div>;
    const meets = meetingsOn(k);
    if (k > todayK) {
      const mm = dayStats([], meets, J, groupOf).meet;
      const due = m.demands.filter((t) => isOpen(t) && t.due_date === k && !t.parent_id);
      return (
        <div className="panel dayrep stack" style={{ gap: 10 }}>
          <h3>{label}</h3>
          <p className="note">Dia futuro. Reuniões marcadas: {meets.length} ({hmin(mm)}). Sobram {hmin(Math.max(0, J - mm))} da jornada para demandas.</p>
          {due.length > 0 && <div className="sect"><h4>Com prazo neste dia <span className="n">{due.length}</span></h4>
            {due.map((t) => <button key={t.id} className="item" onClick={() => ui.open(t.id)}><span><span className="dot" style={{ display: 'inline-block', marginRight: 6, background: m.colorOf(t) }} />{t.title}</span><span className="mono note">{shortTime(t.due_time)}</span></button>)}
          </div>}
        </div>
      );
    }
    const daySegs = segs.get(k) ?? [];
    const workday = jor.days.includes(d.getDay());
    const st = dayStats(daySegs, meets, workday ? J : 0, groupOf);
    const rows = [...st.byKey].sort((a, b) => b[1] - a[1]);
    const segOf = (key: string) => daySegs.find((s) => s.key === key)!;
    const pos = (s: number, e: number) => ({ left: `${((Math.max(START, s) - START) / 600) * 100}%`, width: `${((Math.min(18 * 60, e) - Math.max(START, s)) / 600) * 100}%` });
    return (
      <div className="panel dayrep stack" style={{ gap: 14 }}>
        <div>
          <h3>{label}{k === todayK && <span className="chip today">hoje, até agora</span>}</h3>
          {workday
            ? <div className="bigocc"><span className="mono">{st.pct}%</span><span className="note">da jornada ocupada · {hmin(st.used)} de {hmin(st.J)}</span><span className={'chip ' + occClass(st.pct)}>{occLabel(st.pct)}</span></div>
            : <p className="note">Fora dos dias de trabalho. {hmin(st.used)} registradas.</p>}
        </div>
        {workday && stackBar(st, true)}
        <dl className="occ4">
          <div><dt>Demandas</dt><dd className="mono">{hmin(st.dem)}</dd></div>
          <div><dt>Atividades livres</dt><dd className="mono">{hmin(st.free)}</dd></div>
          <div><dt>Reuniões</dt><dd className="mono">{hmin(st.meet)}</dd></div>
          <div><dt>Sem registro</dt><dd className="mono">{hmin(st.idle)}</dd></div>
        </dl>
        <div className="sect"><h4>Mapa do dia <span className="n">08h a 18h</span></h4>
          <div className="strip">
            {meets.map((mt, i) => mt.e > START && mt.s < 18 * 60 && <i key={'m' + i} className="sm" style={pos(mt.s, mt.e)} />)}
            {daySegs.map((s, i) => s.e > START && s.s < 18 * 60 && <i key={i} style={{ ...pos(s.s, s.e), background: colorOfSeg(s) }} title={titleOfSeg(s)} />)}
          </div>
          <div className="stripax mono"><span>08</span><span>10</span><span>12</span><span>14</span><span>16</span><span>18</span></div>
        </div>
        <div className="sect"><h4>Por demanda</h4>
          {rows.length === 0 && <p className="note">Nenhum tempo registrado neste dia.</p>}
          <div className="tbars">
            {rows.map(([key, v]) => {
              const s = segOf(key), c = colorOfSeg(s);
              return (
                <div key={key} className="r" style={s.demandId ? { cursor: 'pointer' } : undefined} onClick={() => s.demandId && m.byId.has(s.demandId) && ui.open(s.demandId)}>
                  <span><span className="dot" style={{ display: 'inline-block', marginRight: 6, background: c }} />{titleOfSeg(s)}</span>
                  <span className="mono" style={{ textAlign: 'right' }}>{hmin(v)}</span>
                  <div className="bar"><i style={{ width: `${(v / rows[0][1]) * 100}%`, background: c }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        {meets.length > 0 && <div className="sect"><h4>Reuniões</h4>{meets.map((mt, i) => <div key={i} className="item"><span>{mt.title}</span><span className="mono note">{mt.start}–{mt.end}</span></div>)}</div>}
        <p className="note">Reunião que coincide com tempo registrado conta uma vez só. Jornada: {jor.start}–{jor.end}, {jor.lunch} min de almoço (Configurações &gt; Jornada).</p>
      </div>
    );
  };

  return (
    <div className="calview">
      <div className="stack" style={{ gap: 14, minWidth: 0 }}>{summary}{mode === 'mes' ? month() : week()}</div>
      {report()}
    </div>
  );
}

const hmStr = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
