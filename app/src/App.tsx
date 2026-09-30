import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { Nav } from './components/Nav';
import { TimerBar } from './components/TimerBar';
import { useToast } from './components/Toast';
import { api, qk, useInvalidate } from './data/api';
import { useModel } from './data/model';
import { errMsg, getConn, sb } from './lib/supabase';
import { TimerProvider } from './timer/TimerContext';
import { UIProvider, useUI } from './ui';
import { Demandas, DemandasToolbar, useDemandasState } from './views/Demandas';
import { Calendario, CalendarioToolbar, type CalMode } from './views/Calendario';
import { Detail } from './views/Detail';
import { Foco } from './views/Foco';
import { Hoje, HojeToolbar } from './views/Hoje';
import { Connect, Login } from './views/Login';
import { Rotinas, RotinasToolbar } from './views/Rotinas';

export default function App() {
  const [conn, setConn] = useState(() => getConn());
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const qc = useQueryClient();

  useEffect(() => {
    if (!conn) return;
    sb().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb().auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [conn, qc]);

  if (!conn) return <Connect onDone={() => setConn(getConn())} />;
  if (session === undefined) return <div className="loading">Carregando…</div>;
  if (!session) return <Login />;
  return (
    <UIProvider>
      <TimerProvider>
        <Shell />
      </TimerProvider>
    </UIProvider>
  );
}

function Shell() {
  const ui = useUI();
  const m = useModel();
  const toast = useToast();
  const invalidate = useInvalidate();
  const dem = useDemandasState();
  const [newRoutine, setNewRoutine] = useState(0);
  const [calMode, setCalMode] = useState<CalMode>('semana');

  // Ao abrir (e a cada 6 h): gera as ocorrências das rotinas para os próximos dias.
  useEffect(() => {
    const gen = () => api.generateRoutines().then((n) => { if (n) invalidate(qk.demands); }).catch((e) => toast(errMsg(e)));
    gen();
    const id = setInterval(gen, 6 * 3600 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && ui.sel) ui.open(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui]);

  return (
    <div className="app">
      <Nav m={m} />
      <section className="main">
        {ui.view === 'hoje' && <HojeToolbar />}
        {ui.view === 'calendario' && <CalendarioToolbar mode={calMode} setMode={setCalMode} />}
        {ui.view === 'demandas' && <DemandasToolbar m={m} {...dem} />}
        {ui.view === 'rotinas' && <RotinasToolbar onNew={() => setNewRoutine((x) => x + 1)} />}
        {ui.view === 'foco' && <div className="toolbar"><h2>Foco</h2></div>}
        <div className="view">
          {m.error ? <div className="cfgbanner">Não foi possível ler os dados: {errMsg(m.error)}. Confira se o schema demandas_app está em Project Settings &gt; API &gt; Exposed schemas.</div> : null}
          {ui.view === 'hoje' && <Hoje m={m} />}
          {ui.view === 'calendario' && <Calendario m={m} mode={calMode} />}
          {ui.view === 'demandas' && <Demandas m={m} q={dem.q} groupBy={dem.groupBy} />}
          {ui.view === 'rotinas' && <Rotinas m={m} newTick={newRoutine} />}
          {ui.view === 'foco' && <Foco m={m} />}
        </div>
        <Detail m={m} />
      </section>
      <TimerBar m={m} />
    </div>
  );
}
