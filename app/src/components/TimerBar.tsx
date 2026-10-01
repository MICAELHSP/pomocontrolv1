import { I } from './Icons';
import { ActivityPicker } from './ActivityPicker';
import type { Model } from '../data/model';
import { clock, clockHMS } from '../lib/format';
import { useTimerCtx } from '../timer/TimerContext';

export function TimerBar({ m }: { m: Model }) {
  const t = useTimerCtx();
  const p = t.pomodoro;
  const pomoCls = !t.settings.enabled || !p ? 'idle' : p.kind === 'focus' ? '' : 'brk';
  const status = t.entry ? 'Em andamento' : t.queued ? 'Pausado no intervalo' : 'Atividade atual';
  return (
    <footer className="timerbar">
      <div className={`tb-act ${t.entry ? 'running' : ''}`}>
        <span className={`tb-pomo ${pomoCls} ${p ? 'running' : ''}`} title="Pomodoro">
          <span className="pulse" />
          <span>{!t.settings.enabled ? 'Pomodoro desligado' : p ? `${t.label} · ${clock(t.remaining)}` : `Foco · ${clock(t.settings.focus_minutes * 60)}`}</span>
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl">{status}</div>
          <div className="name" title={t.actName(t.current)}>{t.queued ? 'Próximo: ' : ''}{t.actName(t.current)}</div>
        </div>
      </div>
      <div className="mono tb-clock" title="Tempo desta sessão">{clockHMS(t.sessionSeconds)}</div>
      <div className="tb-ctrl">
        {t.running
          ? <button className="btn" disabled={t.busy} onClick={t.pause}><I.pause />Pausar</button>
          : <button className="btn focus" disabled={t.busy} onClick={t.resume}><I.play />Iniciar</button>}
        <button className="iconbtn" disabled={t.busy || (!t.running && !t.paused)} onClick={t.stop} title="Parar e gravar sessão" aria-label="Parar e gravar sessão"><I.stop /></button>
        <label className="tb-switch"><span className="sr">Trocar atividade</span>
          <ActivityPicker m={m} value={t.current} placeholder="Trocar para…" title="Trocar atividade sem parar o pomodoro" onPick={(a) => t.start(a)} />
        </label>
      </div>
    </footer>
  );
}
