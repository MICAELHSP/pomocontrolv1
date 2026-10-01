import { useEffect, useState } from 'react';
import { ActivityPicker } from '../components/ActivityPicker';
import { I } from '../components/Icons';
import { useToast } from '../components/Toast';
import { api, qk, useInvalidate } from '../data/api';
import type { Model } from '../data/model';
import { clock, clockHMS, dur } from '../lib/format';
import { phaseMinutes, splitOfPomodoro, type ActivityKey } from '../lib/pomodoro';
import { errMsg } from '../lib/supabase';
import type { PomodoroSettings } from '../lib/types';
import { useTimerCtx } from '../timer/TimerContext';

export function Foco({ m }: { m: Model }) {
  const t = useTimerCtx();
  const toast = useToast();
  const invalidate = useInvalidate();
  const p = t.pomodoro;
  const st = t.settings;
  const n = st.cycles_before_long;
  const kind = p?.kind ?? 'focus';
  const total = (p?.planned_minutes ?? phaseMinutes('focus', st)) * 60;
  const C = 2 * Math.PI * 90;
  const off = C * (1 - Math.max(0, t.remaining) / total);
  const cycle = p?.cycle ?? 1;

  const nameOf = (k: ActivityKey) => (k.startsWith('d:') ? m.byId.get(k.slice(2))?.title ?? 'Demanda' : k.slice(2) || 'Atividade livre');
  const colorOf = (k: ActivityKey) => (k.startsWith('d:') ? m.colorOf(m.byId.get(k.slice(2))) : 'var(--muted)');

  const split = p && p.kind === 'focus' ? splitOfPomodoro(p.id, t.entries, t.now) : [];
  const focusLog = t.pomodoros.filter((x) => x.kind === 'focus' && x.status !== 'running');
  const doneCount = focusLog.filter((x) => x.status === 'completed').length;

  const cur = t.current;
  const curTotal = cur?.demandId ? (m.byId.get(cur.demandId)?.total_seconds ?? 0) + t.liveExtra(cur.demandId) : null;

  const [draft, setDraft] = useState({ f: st.focus_minutes, s: st.short_break_minutes, l: st.long_break_minutes });
  useEffect(() => setDraft({ f: st.focus_minutes, s: st.short_break_minutes, l: st.long_break_minutes }), [st.focus_minutes, st.short_break_minutes, st.long_break_minutes]);

  const save = async (s: Partial<PomodoroSettings>) => {
    try { await api.saveSettings(s); } catch (e) { toast(errMsg(e)); }
    await invalidate(qk.settings);
  };
  const num = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v) || lo));

  return (
    <div className="foco">
      <div className="panel ringbox">
        <div className={`ring ${kind === 'focus' ? '' : 'brk'}`}>
          <svg viewBox="0 0 200 200"><circle className="track" cx="100" cy="100" r="90" /><circle className="prog" cx="100" cy="100" r="90" strokeDasharray={C} strokeDashoffset={p ? off : 0} /></svg>
          <div className="center">
            <span className="mode">{kind === 'focus' ? 'Foco' : kind === 'long_break' ? 'Pausa longa' : 'Intervalo'}</span>
            <span className="big mono">{clock(p ? t.remaining : st.focus_minutes * 60)}</span>
            <span className="note ringact">{t.queued ? 'Próximo: ' : ''}{t.actName(cur)}</span>
          </div>
        </div>
        <div className="cycles" aria-label={`Ciclo ${cycle} de ${n}`}>
          {Array.from({ length: n }, (_, i) => i + 1).map((i) => <i key={i} className={i < cycle || (i === cycle && kind !== 'focus') ? 'on' : ''} />)}
          <span>Ciclo {cycle} de {n} · {doneCount} concluído{doneCount === 1 ? '' : 's'} hoje</span>
        </div>
        <div className="ctrls">
          {t.running
            ? <button className="btn" disabled={t.busy} onClick={t.pause}><I.pause />Pausar</button>
            : <button className="btn focus" disabled={t.busy} onClick={t.resume}><I.play />Iniciar foco</button>}
          <button className="btn" disabled={t.busy || !p} onClick={t.skip}><I.skip />Pular fase</button>
          <button className="btn" disabled={t.busy || (!t.running && !t.paused)} onClick={t.stop}><I.stop />Parar e gravar</button>
        </div>
        {!st.enabled && <p className="note">Pomodoro desligado: só o cronômetro da atividade conta.</p>}
      </div>

      <div className="stack">
        <div className="panel stack" style={{ gap: 12 }}>
          <label className="field"><span>Trabalhando em</span>
            <ActivityPicker m={m} value={cur} onPick={(a) => t.start(a)} />
          </label>
          <div className="actclock">
            <span className="mono" style={{ fontSize: 28, fontWeight: 600 }}>{clockHMS(t.sessionSeconds)}</span>
            <span className="note">nesta sessão{curTotal != null && <> · <span className="mono">{dur(curTotal)}</span> no total da demanda</>}</span>
          </div>
          <p className="note">O relógio da atividade conta o tempo real gasto, com ou sem pomodoro. Trocar de atividade grava o trecho atual e segue o mesmo foco.</p>
        </div>

        <div className="panel stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Este foco</h3>
          {!p || p.kind !== 'focus'
            ? <p className="note">{p ? 'Intervalo. O próximo foco começa um novo registro.' : 'Nenhum foco rodando.'}</p>
            : !split.length
              ? <p className="note">Nenhum tempo neste foco ainda. Se você trocar de atividade no meio, o foco é dividido entre elas.</p>
              : <>
                  <div className="split" aria-label="Divisão do foco atual">
                    {split.map((s) => <i key={s.key} style={{ width: `${(s.seconds / total) * 100}%`, background: colorOf(s.key) }} title={nameOf(s.key)} />)}
                  </div>
                  {split.map((s) => (
                    <div className="srow" key={s.key}><span className="dot" style={{ background: colorOf(s.key) }} /><span>{nameOf(s.key)}</span><span className="mono">{clock(s.seconds)}</span></div>
                  ))}
                </>}
        </div>

        <div className="panel stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Pomodoros de hoje <span className="src">{doneCount} concluídos</span></h3>
          {[...focusLog].reverse().map((x, i) => {
            const segs = splitOfPomodoro(x.id, t.entries, t.now);
            const tot = segs.reduce((a, s) => a + s.seconds, 0) || 1;
            return (
              <div className="plog" key={x.id}>
                <span className={`pn ${x.status === 'completed' ? '' : 'int'}`}>{focusLog.length - i}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="split sm">{segs.map((s) => <i key={s.key} style={{ width: `${(s.seconds / tot) * 100}%`, background: colorOf(s.key) }} />)}</div>
                  <div className="note">{segs.map((s) => `${nameOf(s.key)} ${dur(s.seconds)}`).join(' · ') || 'Sem atividade registrada'}{x.status === 'completed' ? '' : ' · interrompido'}</div>
                </div>
              </div>
            );
          })}
          {!focusLog.length && <p className="note">Nenhum pomodoro hoje.</p>}
        </div>

        <div className="panel stack" style={{ gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Ajustes do pomodoro</h3>
          <div className="form" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
            <label className="field"><span>Foco (min)</span><input className="input mono" type="number" min={1} max={240} value={draft.f}
              onChange={(e) => setDraft({ ...draft, f: +e.target.value })} onBlur={() => save({ focus_minutes: num(draft.f, 1, 240) })} /></label>
            <label className="field"><span>Intervalo</span><input className="input mono" type="number" min={1} max={120} value={draft.s}
              onChange={(e) => setDraft({ ...draft, s: +e.target.value })} onBlur={() => save({ short_break_minutes: num(draft.s, 1, 120) })} /></label>
            <label className="field"><span>Pausa longa</span><input className="input mono" type="number" min={1} max={240} value={draft.l}
              onChange={(e) => setDraft({ ...draft, l: +e.target.value })} onBlur={() => save({ long_break_minutes: num(draft.l, 1, 240) })} /></label>
          </div>
          <label className="toggle"><input type="checkbox" checked={st.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Usar pomodoro junto com o cronômetro</label>
          <label className="toggle"><input type="checkbox" checked={st.pause_demand_on_break} onChange={(e) => save({ pause_demand_on_break: e.target.checked })} /> Pausar o tempo da demanda durante os intervalos</label>
          <div className="field"><span>Ao trocar de atividade no meio de um foco</span>
            <div className="seg" role="group" aria-label="Ao trocar de atividade">
              {([['continue', 'Continuar o foco'], ['restart', 'Começar foco novo']] as const).map(([k, l]) => (
                <button key={k} aria-pressed={st.on_switch === k} onClick={() => save({ on_switch: k })}>{l}</button>
              ))}
            </div>
          </div>
          <p className="note">Mudanças no tempo valem a partir da próxima fase.</p>
        </div>
      </div>
    </div>
  );
}
