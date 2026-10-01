import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { Nav } from './components/Nav';
import { TimerBar } from './components/TimerBar';
import { useToast } from './components/Toast';
import { api, qk, useAiSettings, useInvalidate } from './data/api';
import { useModel } from './data/model';
import { errMsg, getConn, sb } from './lib/supabase';
import { useMeetingReminders } from './lib/reminders';
import { TimerProvider } from './timer/TimerContext';
import { UIProvider, useUI } from './ui';
import { AiCapture } from './views/AiCapture';
import { Configuracoes } from './views/Configuracoes';
import { Demandas, DemandasToolbar, useDemandasState } from './views/Demandas';
import { Calendario, CalendarioToolbar, type CalMode } from './views/Calendario';
import { Detail } from './views/Detail';
import { Foco } from './views/Foco';
import { Hoje, HojeToolbar } from './views/Hoje';
import { Mini } from './views/Mini';
import { Connect, Login } from './views/Login';
import { Rotinas, RotinasToolbar } from './views/Rotinas';

const isMini = window.location.hash === '#mini';
if (isMini) document.documentElement.classList.add('is-mini');

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

  if (isMini) {
    if (!conn || !session) return <div className="mw"><span className="mini-task">{session === undefined && conn ? 'Carregando…' : 'Abra o Pulso Control e entre na sua conta.'}</span></div>;
    return <TimerProvider lead={false}><Mini /></TimerProvider>;
  }
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
  // Arquivo solto fora da agenda: não deixa a janela abrir o arquivo no lugar do app.
  useEffect(() => {
    const block = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => { window.removeEventListener('dragover', block); window.removeEventListener('drop', block); };
  }, []);
  const ai = useAiSettings();
  const openAI = () => (ai.isSuccess && !ai.data?.key_hint ? ui.openConfig('ia', true) : ui.setAiOpen(true));
  const [calMode, setCalMode] = useState<CalMode>('semana');
  useMeetingReminders(m.meetingsOn);

  // Ao abrir (e a cada 6 h): gera as ocorrências das rotinas para os próximos dias.
  useEffect(() => {
    const gen = () => api.generateRoutines().then((n) => { if (n) invalidate(qk.demands); }).catch((e) => toast(errMsg(e)));
    gen();
    const id = setInterval(gen, 6 * 3600 * 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ui.sel && !ui.aiOpen) ui.open(null);
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); openAI(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui, ai.data, ai.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <Nav m={m} />
      <section className="main">
        {ui.view === 'hoje' && <HojeToolbar onAI={openAI} />}
        {ui.view === 'calendario' && <CalendarioToolbar mode={calMode} setMode={setCalMode} />}
        {ui.view === 'demandas' && <DemandasToolbar m={m} {...dem} onAI={openAI} />}
        {ui.view === 'rotinas' && <RotinasToolbar onNew={() => setNewRoutine((x) => x + 1)} />}
        {ui.view === 'foco' && <div className="toolbar"><h2>Foco</h2></div>}
        {ui.view === 'config' && <div className="toolbar"><h2>Configurações</h2></div>}
        <div className="view">
          {m.error ? <div className="cfgbanner">Não foi possível ler os dados: {errMsg(m.error)}. Confira se o schema demandas_app está em Project Settings &gt; API &gt; Exposed schemas.</div> : null}
          {ui.view === 'hoje' && <Hoje m={m} />}
          {ui.view === 'calendario' && <Calendario m={m} mode={calMode} />}
          {ui.view === 'demandas' && <Demandas m={m} q={dem.q} groupBy={dem.groupBy} sortBy={dem.sortBy} setSortBy={dem.setSortBy} />}
          {ui.view === 'rotinas' && <Rotinas m={m} newTick={newRoutine} />}
          {ui.view === 'foco' && <Foco m={m} />}
          {ui.view === 'config' && <Configuracoes />}
        </div>
        <Detail m={m} />
      </section>
      <TimerBar m={m} />
      {ui.aiOpen && <AiCapture m={m} />}
    </div>
  );
}
