import { useState } from 'react';
import { I } from './Icons';
import { useToast } from './Toast';
import { api, qk, useInvalidate, useRoutines } from '../data/api';
import { GROUP_COLORS, isOpen, type Model } from '../data/model';
import { dayDiff } from '../lib/format';
import { errMsg, sb } from '../lib/supabase';
import { useUI, type View } from '../ui';

const VIEWS: { id: View; label: string; icon: () => React.JSX.Element }[] = [
  { id: 'hoje', label: 'Hoje', icon: I.cal },
  { id: 'calendario', label: 'Calendário', icon: I.grid },
  { id: 'demandas', label: 'Demandas', icon: I.list },
  { id: 'rotinas', label: 'Rotinas', icon: I.repeat },
  { id: 'foco', label: 'Foco', icon: I.timer },
];

export function Nav({ m }: { m: Model }) {
  const ui = useUI();
  const routines = useRoutines();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const open = m.demands.filter(isOpen);
  const counts: Record<View, number | ''> = {
    hoje: open.filter((d) => d.due_date && dayDiff(d.due_date) <= 0).length,
    demandas: open.filter((d) => !d.parent_id).length,
    rotinas: (routines.data ?? []).filter((r) => r.active).length,
    foco: '',
    calendario: '',
  };

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      await api.addGroup(n, GROUP_COLORS[m.groups.length % GROUP_COLORS.length], m.groups.length);
      setName(''); setAdding(false);
      await invalidate(qk.groups);
    } catch (err) { toast(errMsg(err)); }
  }

  return (
    <nav className="nav" aria-label="Navegação principal">
      <div className="brand"><i />Pauta</div>
      <div className="navlist">
        {VIEWS.map((v) => (
          <button key={v.id} className="navbtn" aria-current={ui.view === v.id && !ui.groupFilter ? 'page' : undefined} onClick={() => ui.go(v.id)}>
            <v.icon />{v.label}<span className="count">{counts[v.id]}</span>
          </button>
        ))}
      </div>
      <div className="groups">
        <div className="navhead">Grupos</div>
        <div className="navlist">
          {m.groups.map((g, i) => (
            <button key={g.id} className="navbtn" aria-current={ui.view === 'demandas' && ui.groupFilter === g.id ? 'page' : undefined} onClick={() => ui.go('demandas', g.id)}>
              <span className="dot" style={{ background: m.groupColor(g, i) }} />{g.name}
              <span className="count">{open.filter((d) => d.group_id === g.id && !d.parent_id).length}</span>
            </button>
          ))}
          {adding
            ? <form className="addgroup" onSubmit={addGroup}>
                <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do grupo" aria-label="Nome do grupo"
                  onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
              </form>
            : <button className="navbtn" onClick={() => setAdding(true)}><I.plus />Novo grupo</button>}
        </div>
      </div>
      <div className="navfoot">
        <button className="navbtn" onClick={() => sb().auth.signOut()} title="Sair da conta"><I.out />Sair</button>
      </div>
    </nav>
  );
}
