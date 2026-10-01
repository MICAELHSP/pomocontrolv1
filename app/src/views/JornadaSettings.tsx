// Configurações > Jornada de trabalho: base da ocupação no Calendário (tabela work_settings).
// Painel independente; vai na aba de Configurações quando ela existir.
import { useEffect, useState } from 'react';
import { useJornada, useSaveJornada } from '../data/jornada';
import { hmin, jornadaMinutes, type Jornada } from '../lib/occupancy';
import { toMinutes, WD } from '../lib/format';
import { errMsg } from '../lib/supabase';

export function JornadaSettings() {
  const saved = useJornada();
  const save = useSaveJornada();
  const [j, setJ] = useState<Jornada>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setJ(saved), [saved]);

  const set = (p: Partial<Jornada>) => { setJ({ ...j, ...p }); setMsg(null); };
  const span = (toMinutes(j.end) ?? 0) - (toMinutes(j.start) ?? 0);
  const problem = span <= 0 ? 'O fim precisa ser depois do início.'
    : span <= j.lunch ? 'O almoço não pode ocupar a jornada inteira.'
    : !j.days.length ? 'Escolha pelo menos um dia.' : '';
  const changed = JSON.stringify(j) !== JSON.stringify(saved);

  const submit = async () => {
    setBusy(true);
    try { await save(j); setMsg({ ok: true, text: 'Jornada salva.' }); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    setBusy(false);
  };

  return (
    <div className="cal-set">
      <div><h3>Jornada de trabalho</h3><p className="note">Base para calcular a ocupação de cada dia no Calendário.</p></div>
      <div className="form" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        <label className="field"><span>Início</span><input className="input mono" type="time" value={j.start} onChange={(e) => e.target.value && set({ start: e.target.value })} /></label>
        <label className="field"><span>Fim</span><input className="input mono" type="time" value={j.end} onChange={(e) => e.target.value && set({ end: e.target.value })} /></label>
        <label className="field"><span>Almoço (min)</span><input className="input mono" type="number" min={0} max={180} value={j.lunch}
          onChange={(e) => set({ lunch: Math.max(0, Math.min(180, Number(e.target.value) || 0)) })} /></label>
      </div>
      <div className="field"><span>Dias de trabalho</span>
        <div className="days">{[1, 2, 3, 4, 5, 6, 0].map((i) => (
          <button key={i} aria-pressed={j.days.includes(i)} onClick={() => set({ days: j.days.includes(i) ? j.days.filter((x) => x !== i) : [...j.days, i] })}>{WD[i]}</button>
        ))}</div>
      </div>
      {problem ? <p className="err">{problem}</p> : <div className="sentence">Jornada de {hmin(jornadaMinutes(j))} por dia</div>}
      <div className="ai-row">
        <button className="btn primary" disabled={!!problem || !changed || busy} onClick={submit}>{busy ? 'Salvando…' : 'Salvar jornada'}</button>
        {msg && <span className={msg.ok ? 'note' : 'err'}>{msg.text}</span>}
      </div>
      <p className="note">Feriados nacionais ficam fora da jornada automaticamente.</p>
    </div>
  );
}
