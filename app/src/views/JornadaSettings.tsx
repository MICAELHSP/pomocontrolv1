// Configurações > Jornada de trabalho: base da ocupação no Calendário.
// Painel independente (guardado neste computador); vai na aba de Configurações quando ela existir.
import { hmin, jornadaMinutes, saveJornada, useJornada } from '../lib/occupancy';
import { toMinutes, WD } from '../lib/format';

export function JornadaSettings() {
  const j = useJornada();
  const set = (p: Partial<typeof j>) => saveJornada({ ...j, ...p });
  const bad = (toMinutes(j.end) ?? 0) <= (toMinutes(j.start) ?? 0);
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
      {bad ? <p className="err">O fim precisa ser depois do início.</p> : <div className="sentence">Jornada de {hmin(jornadaMinutes(j))} por dia</div>}
      <p className="note">Feriados nacionais ficam fora da jornada automaticamente. Fica guardado neste computador.</p>
    </div>
  );
}
