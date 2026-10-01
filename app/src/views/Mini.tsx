// Mini-janela flutuante (#mini): pomodoro, tarefa atual, pausar e trocar. Arrasta-se por qualquer parte vazia.
import { useEffect, useRef, useState } from 'react';
import { I } from '../components/Icons';
import { ActivityPicker } from '../components/ActivityPicker';
import { useModel } from '../data/model';
import { clock } from '../lib/format';
import type { MiniState } from '../lib/outlook';
import { useTimerCtx } from '../timer/TimerContext';

export function Mini() {
  const t = useTimerCtx();
  const m = useModel();
  const [st, setSt] = useState<MiniState>({ enabled: true, pinned: false });
  const pickRef = useRef<HTMLSpanElement>(null);
  const bridge = window.pauta?.mini;

  useEffect(() => { bridge?.get().then(setSt).catch(() => {}); }, [bridge]);
  useEffect(() => { document.title = t.pomodoro ? `${clock(t.remaining)} · Pulso Control` : 'Pulso Control'; }, [t.pomodoro, t.remaining]);

  const p = t.pomodoro;
  const phase = !t.settings.enabled ? 'off' : !p ? 'idle' : p.kind === 'focus' ? 'focus' : 'brk';
  const label = !t.settings.enabled ? 'Pomodoro desligado' : p ? t.label : 'Parado';
  const time = !t.settings.enabled ? '' : clock(p ? t.remaining : t.settings.focus_minutes * 60);

  // Abre a lista de troca direto do botão pequeno (o select fica invisível embaixo dele).
  const openPicker = () => {
    const sel = pickRef.current?.querySelector('select') as (HTMLSelectElement & { showPicker?: () => void }) | null;
    if (!sel) return;
    try { sel.showPicker ? sel.showPicker() : sel.focus(); } catch { sel.focus(); }
  };

  return (
    <div className={`mw ph-${phase}`}>
      <div className="mini-top">
        <span className="mini-phase"><i />{label}</span>
        <span className="mini-time mono" aria-label="Tempo restante da fase">{time}</span>
        <span className="mini-win">
          <button className={`mini-ic ${st.pinned ? 'on' : ''}`} aria-pressed={st.pinned}
            title={st.pinned ? 'Fixada: continua aberta com o app aberto' : 'Manter aberta mesmo com o app aberto'}
            onClick={() => bridge?.set({ pinned: !st.pinned }).then(setSt)}><I.pin /></button>
          <button className="mini-ic" title="Abrir o Pulso Control" aria-label="Abrir o Pulso Control" onClick={() => bridge?.openMain()}><I.expand /></button>
          <button className="mini-ic" title="Fechar (volta ao minimizar o app)" aria-label="Fechar mini-janela" onClick={() => bridge?.hide()}><I.x /></button>
        </span>
      </div>
      <div className="mini-bot">
        {t.running
          ? <button className="mini-btn" disabled={t.busy} onClick={t.pause} title="Pausar" aria-label="Pausar"><I.pause /></button>
          : <button className="mini-btn go" disabled={t.busy} onClick={t.resume} title="Iniciar" aria-label="Iniciar"><I.play /></button>}
        <span className="mini-task" title={t.actName(t.current)}>{t.queued ? 'Próximo: ' : ''}{t.actName(t.current)}</span>
        <span className="mini-swap" ref={pickRef}>
          <button className="mini-ic" disabled={t.busy} onClick={openPicker} title="Trocar tarefa sem parar o pomodoro" aria-label="Trocar tarefa"><I.swap /></button>
          <ActivityPicker m={m} value={t.current} placeholder="Trocar para…" className="mini-select" title="Trocar tarefa" compact onPick={(a) => t.start(a)} />
        </span>
      </div>
    </div>
  );
}
