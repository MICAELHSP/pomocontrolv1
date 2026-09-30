import { useEffect, useRef, useState } from 'react';
import { I } from '../components/Icons';
import { useToast } from '../components/Toast';
import { api, qk, useAiSettings, useInvalidate } from '../data/api';
import { WD } from '../lib/format';
import { DEFAULT_JORNADA, jornadaMinutes, loadJornada, saveJornada, type Jornada } from '../lib/jornada';
import { clearConn, errMsg, getConn, sb } from '../lib/supabase';
import { useUI, type CfgTab } from '../ui';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
const hmin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`);

export function Configuracoes() {
  const ui = useUI();
  const tabs: [CfgTab, string, boolean][] = [
    ['ia', 'Inteligência artificial', true], ['jornada', 'Jornada de trabalho', true],
    ['outlook', 'Calendário (Outlook)', true], ['conta', 'Conta', true],
  ];
  return (
    <div className="cfgwrap">
      <nav className="cfgtabs" aria-label="Seções">
        {tabs.map(([k, l, on]) => <button key={k} disabled={!on} aria-current={ui.cfgTab === k} onClick={() => ui.setCfgTab(k)}>{l}</button>)}
      </nav>
      {ui.cfgTab === 'ia' && <IaPanel />}
      {ui.cfgTab === 'jornada' && <JornadaPanel />}
      {ui.cfgTab === 'outlook' && <OutlookPanel />}
      {ui.cfgTab === 'conta' && <ContaPanel />}
    </div>
  );
}

function IaPanel() {
  const ui = useUI();
  const ai = useAiSettings();
  const toast = useToast();
  const invalidate = useInvalidate();
  const saved = ai.data?.key_hint ? ai.data : null;
  const [key, setKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (saved?.model) setModel(saved.model); }, [saved?.model]);

  async function save() {
    const k = key.trim();
    if (!k) return;
    setTesting(true); setResult(null);
    try {
      await api.setAiKey(k, model.trim() || null);
      setKey(''); setShow(false);
      await invalidate(qk.ai);
      const r = await api.testAi();
      setResult(r.ok ? { ok: true, msg: `Chave funcionando (${r.modelo ?? (model || DEFAULT_MODEL)})` } : { ok: false, msg: `Chave salva, mas o teste falhou: ${r.erro ?? 'erro desconhecido'}` });
    } catch (e) {
      setResult({ ok: false, msg: errMsg(e) });
    }
    setTesting(false);
  }

  async function testSaved() {
    setTesting(true); setResult(null);
    try {
      if (saved && (model.trim() || null) !== (saved.model ?? null)) { await api.setAiModel(model.trim() || null); await invalidate(qk.ai); }
      const r = await api.testAi();
      setResult(r.ok ? { ok: true, msg: `Chave funcionando (${r.modelo ?? model})` } : { ok: false, msg: r.erro ?? 'Teste falhou' });
    } catch (e) { setResult({ ok: false, msg: errMsg(e) }); }
    setTesting(false);
  }

  async function remove() {
    try { await api.clearAiKey(); toast('Chave removida.'); } catch (e) { toast(errMsg(e)); }
    setConfirmDel(false); setResult(null);
    await invalidate(qk.ai);
  }

  return (
    <section className="panel stack" style={{ gap: 16 }}>
      <div><h3 className="cfgh">Inteligência artificial</h3><p className="note">A IA usa a sua chave do Gemini (Google) para montar demandas a partir de e-mails, prints e PDFs.</p></div>
      {ui.aiGate && !saved && <div className="ai-q"><I.warn /><span><b>Configure a chave do Gemini para usar a IA.</b> Depois de salvar, o botão "Nova com IA" abre a captura normalmente.</span></div>}
      {saved && (
        <div className="keystate">
          <span className="chip ok"><I.check />Chave salva: <span className="mono">{saved.key_hint}</span>, atualizada em {new Date(saved.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
          <span className="note">Modelo: <span className="mono">{saved.model || DEFAULT_MODEL}</span></span>
          <span className="keybtns">
            {confirmDel
              ? <><span className="note">Remover a chave? A IA para de funcionar até você salvar outra.</span>
                  <button className="btn danger" onClick={remove}>Remover</button><button className="btn ghost" onClick={() => setConfirmDel(false)}>Manter</button></>
              : <><button className="btn" disabled={testing} onClick={testSaved}>Testar</button>
                  <button className="btn" onClick={() => keyRef.current?.focus()}>Trocar chave</button>
                  <button className="btn ghost" onClick={() => setConfirmDel(true)}>Remover chave</button></>}
          </span>
        </div>
      )}
      <div className="form">
        <label className="field full"><span>Chave do Gemini {saved ? '(nova)' : ''}</span>
          <span className="pw">
            <input ref={keyRef} className="input mono" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false}
              placeholder={saved ? 'Cole outra chave para trocar' : 'AIza…'} value={key} onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
            <button className="iconbtn" onClick={() => setShow(!show)} aria-label={show ? 'Esconder chave' : 'Mostrar chave'} title={show ? 'Esconder' : 'Mostrar'}>{show ? <I.eyeoff /> : <I.eye />}</button>
          </span>
          <a className="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Onde pego a chave?</a>
        </label>
        <label className="field"><span>Modelo (opcional)</span><input className="input mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder={DEFAULT_MODEL} /></label>
      </div>
      <div className="ai-row">
        <button className="btn primary" disabled={!key.trim() || testing} onClick={save}>{testing ? <><span className="spin" />Testando…</> : 'Salvar e testar'}</button>
        {result && <span className={`res ${result.ok ? 'ok' : 'err'}`}>{result.ok ? <I.check /> : <I.warn />}{result.msg}</span>}
        {result?.ok && <button className="btn" onClick={() => { ui.go('hoje'); ui.setAiOpen(true); }}><I.spark />Abrir Nova com IA</button>}
      </div>
      <p className="note">A chave vai criptografada para o Supabase Vault e não pode ser lida de volta pelo app, só trocada ou removida.</p>
      <p className="fine">No plano gratuito, o Google pode usar o que você envia para melhorar os produtos dele. Não envie documentos sigilosos.</p>
    </section>
  );
}

function JornadaPanel() {
  const [j, setJ] = useState<Jornada>(() => loadJornada());
  const set = (p: Partial<Jornada>) => { const n = { ...j, ...p }; setJ(n); saveJornada(n); };
  return (
    <section className="panel stack" style={{ gap: 16 }}>
      <div><h3 className="cfgh">Jornada de trabalho</h3><p className="note">Base para calcular a ocupação de cada dia no Calendário. Fica salva neste computador.</p></div>
      <div className="form" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        <label className="field"><span>Início</span><input className="input mono" type="time" value={j.start} onChange={(e) => e.target.value && set({ start: e.target.value })} /></label>
        <label className="field"><span>Fim</span><input className="input mono" type="time" value={j.end} onChange={(e) => e.target.value && set({ end: e.target.value })} /></label>
        <label className="field"><span>Almoço (min)</span><input className="input mono" type="number" min={0} max={240} value={j.lunch}
          onChange={(e) => set({ lunch: Math.min(240, Math.max(0, +e.target.value || 0)) })} /></label>
      </div>
      <div className="field"><span>Dias de trabalho</span>
        <div className="days">{[1, 2, 3, 4, 5, 6, 0].map((i) => {
          const on = j.days.includes(i);
          return <button key={i} aria-pressed={on} onClick={() => set({ days: on ? j.days.filter((x) => x !== i) : [...j.days, i] })}>{WD[i]}</button>;
        })}</div>
      </div>
      <div className="sentence">Jornada de {hmin(jornadaMinutes(j))} por dia</div>
      <div className="ai-row"><button className="btn ghost" onClick={() => { setJ(DEFAULT_JORNADA); saveJornada(DEFAULT_JORNADA); }}>Voltar ao padrão (08:00–17:00, 1h de almoço)</button></div>
      <p className="note">Feriados nacionais ficam fora da jornada automaticamente.</p>
    </section>
  );
}

function OutlookPanel() {
  return (
    <section className="panel stack" style={{ gap: 12 }}>
      <div><h3 className="cfgh">Calendário (Outlook)</h3>
        <p className="note">A ligação com o calendário do Outlook está sendo feita em separado. Quando chegar, as reuniões aparecem na agenda de Hoje, no Calendário e no alerta de conflito de prazo.</p></div>
    </section>
  );
}

function ContaPanel() {
  const [email, setEmail] = useState('');
  useEffect(() => { sb().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? '')); }, []);
  const conn = getConn();
  const fromEnv = !!import.meta.env.VITE_SUPABASE_URL;
  return (
    <section className="panel stack" style={{ gap: 14 }}>
      <div><h3 className="cfgh">Conta</h3><p className="note">Seus dados ficam no Supabase, visíveis só para esta conta.</p></div>
      <dl className="facts">
        <dt>E-mail</dt><dd>{email || '—'}</dd>
        <dt>Projeto</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{conn?.url ?? '—'}</dd>
        <dt>Versão</dt><dd className="mono">{__APP_VERSION__}</dd>
      </dl>
      <div className="ai-row">
        <button className="btn" onClick={() => sb().auth.signOut()}><I.out />Sair da conta</button>
        {!fromEnv && <button className="btn ghost" onClick={() => { if (confirm('Trocar o projeto Supabase? Você vai precisar entrar de novo.')) { sb().auth.signOut().finally(() => { clearConn(); location.reload(); }); } }}>Trocar projeto Supabase</button>}
      </div>
    </section>
  );
}
