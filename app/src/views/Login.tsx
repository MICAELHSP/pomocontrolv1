import { useState } from 'react';
import { clearConn, errMsg, getConn, saveConn, sb } from '../lib/supabase';

export function Connect({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  return (
    <div className="login">
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!/^https:\/\/.+/.test(url.trim()) || !key.trim()) return;
        saveConn({ url: url.trim().replace(/\/$/, ''), key: key.trim() });
        onDone();
      }}>
        <h1><span className="brand"><i />Pauta</span></h1>
        <p className="note">Informe o projeto Supabase onde está o schema demandas_app (Project Settings &gt; API). Fica salvo só neste computador.</p>
        <label className="field"><span>URL do projeto</span><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></label>
        <label className="field"><span>Chave publicável (anon)</span><input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_…" /></label>
        <button className="btn primary" type="submit" style={{ justifyContent: 'center' }}>Continuar</button>
      </form>
    </div>
  );
}

export function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const fromEnv = !!import.meta.env.VITE_SUPABASE_URL;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setOk(''); setBusy(true);
    try {
      if (mode === 'in') {
        const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
      } else {
        const { data, error } = await sb().auth.signUp({ email: email.trim(), password: pw });
        if (error) throw error;
        if (!data.session) setOk('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.');
      }
    } catch (e2) {
      const m = errMsg(e2);
      setErr(/invalid login/i.test(m) ? 'E-mail ou senha incorretos.' : /not confirmed/i.test(m) ? 'Confirme seu e-mail pelo link enviado antes de entrar.' : m);
    }
    setBusy(false);
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1><span className="brand"><i />Pauta</span></h1>
        <p className="note">Demandas, rotinas, cronômetro por atividade e pomodoro.</p>
        <label className="field"><span>E-mail</span><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field"><span>Senha</span><input className="input" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        {err && <p className="err">{err}</p>}
        {ok && <p className="ok">{ok}</p>}
        <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Aguarde…' : mode === 'in' ? 'Entrar' : 'Criar conta'}</button>
        <button className="btn ghost" type="button" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); setOk(''); }}>
          {mode === 'in' ? 'Primeira vez? Criar conta' : 'Já tenho conta'}
        </button>
        {!fromEnv && getConn() && <button className="btn ghost" type="button" onClick={() => { clearConn(); location.reload(); }}>Trocar projeto Supabase</button>}
      </form>
    </div>
  );
}
