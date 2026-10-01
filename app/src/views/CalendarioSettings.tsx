// Configurações > Calendário (Outlook): conectar a conta Microsoft para ler as reuniões.
// Painel independente: vai na aba "Calendário (Outlook)" de Configurações e, até ela existir,
// abre como janela sobre a tela Hoje (CalendarioModal).
import { useEffect, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { I } from '../components/Icons';
import { Modal } from '../components/Modal';
import { clearIcs, countIcs, importIcs } from '../lib/ics';
import { calKeys, outlook, useCalendar } from '../lib/outlook';
import { REMINDER_OPTIONS, saveReminderPrefs, useReminderPrefs } from '../lib/reminders';
import { errMsg } from '../lib/supabase';

const GUIA = 'https://github.com/MICAELHSP/pomocontrolv1/blob/main/docs/outlook.md';

export function CalendarioSettings() {
  const cal = useCalendar();
  const qc = useQueryClient();
  const st = cal.status;
  const [clientId, setClientId] = useState('');
  const [tenant, setTenant] = useState('common');
  const [busy, setBusy] = useState<'' | 'connect' | 'disconnect'>('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (st) { setClientId((v) => v || st.clientId); setTenant((v) => (v === 'common' ? st.tenant || 'common' : v)); }
  }, [st]);

  if (!cal.available) {
    return (
      <div className="cal-set">
        <h3>Calendário</h3>
        <p className="note">A conexão com o Outlook funciona só no app instalado, não no navegador.</p>
        <IcsImport />
        <ReminderSettings />
      </div>
    );
  }

  const refreshAll = () => qc.invalidateQueries({ queryKey: calKeys.events });
  const connect = async () => {
    setBusy('connect'); setErr('');
    try {
      const s = await outlook()!.connect(clientId.trim(), tenant.trim() || 'common');
      qc.setQueryData(calKeys.status, s);
      refreshAll();
    } catch (e) { setErr(errMsg(e)); }
    setBusy('');
  };
  const cancel = () => outlook()!.cancel().catch(() => undefined);
  const disconnect = async () => {
    setBusy('disconnect'); setErr('');
    try {
      qc.setQueryData(calKeys.status, await outlook()!.disconnect());
      qc.removeQueries({ queryKey: calKeys.events });
    } catch (e) { setErr(errMsg(e)); }
    setBusy('');
  };
  const updated = cal.updatedAt ? new Date(cal.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="cal-set">
      <h3>Calendário (Outlook)</h3>
      <p className="note">O Pulso Control só lê as suas reuniões para mostrar na agenda e avisar quando um prazo cai em cima de uma delas. Nada é alterado no Outlook. Uma cópia das reuniões (assunto, horário, local e link) fica no banco do Pulso Control para o Calendário e a ocupação.</p>

      {cal.connected ? (
        <div className="cal-ok">
          <span className="chip ok"><I.check />Conectado</span>
          <div><b>{st?.account?.name || 'Conta Microsoft'}</b>{st?.account?.email ? <span className="note"> · {st.account.email}</span> : null}</div>
          <p className="note">
            {cal.loading ? 'Lendo as reuniões…' : cal.error ? <span className="err">Erro ao ler o calendário: {errMsg(cal.error)}</span> : `Reuniões de ontem até os próximos 60 dias. Atualizado às ${updated}; atualiza sozinho a cada 5 minutos.`}
          </p>
          {st && !st.persistent && <p className="cfgbanner">Este computador não permite guardar o login com segurança, então será preciso conectar de novo a cada vez que abrir o Pulso Control.</p>}
          <div className="ai-row">
            <button className="btn" onClick={refreshAll}>Atualizar agora</button>
            <button className="btn ghost" disabled={!!busy} onClick={disconnect}>{busy === 'disconnect' ? 'Desconectando…' : 'Desconectar'}</button>
          </div>
        </div>
      ) : (
        <>
          <label className="field"><span>ID do aplicativo (cliente), do registro no Azure</span>
            <input className="input mono" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} />
          </label>
          <label className="field"><span>Locatário (deixe "common" se não souber)</span>
            <input className="input mono" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="common" spellCheck={false} />
          </label>
          <div className="ai-row">
            <button className="btn primary" disabled={!clientId.trim() || !!busy} onClick={connect}><I.cal />{busy === 'connect' ? 'Esperando o login no navegador…' : 'Conectar com a Microsoft'}</button>
            {busy === 'connect' && <button className="btn ghost" onClick={cancel}>Cancelar</button>}
          </div>
          <p className="note">O login abre no seu navegador. Depois de aceitar, volte para o Pulso Control. <a href={GUIA} target="_blank" rel="noreferrer">Como registrar o aplicativo no Azure</a></p>
        </>
      )}
      {err && <p className="err">{err}</p>}
      <IcsImport />
      <ReminderSettings />
    </div>
  );
}

function IcsImport() {
  const qc = useQueryClient();
  const count = useQuery({ queryKey: ['ics', 'count'], queryFn: countIcs });
  const [busy, setBusy] = useState<'' | 'import' | 'clear'>('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const done = () => { qc.invalidateQueries({ queryKey: calKeys.events }); qc.invalidateQueries({ queryKey: ['ics'] }); };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy('import'); setErr(''); setMsg('');
    try {
      let n = 0;
      for (const f of files) n += await importIcs(await f.text());
      setMsg(n ? `${n} ${n === 1 ? 'evento importado' : 'eventos importados'}.` : 'Nenhum evento entre 1 ano atrás e 1 ano à frente no arquivo.');
      done();
    } catch (x) { setErr(errMsg(x)); }
    setBusy('');
  };
  const clear = async () => {
    if (!window.confirm('Remover todos os eventos importados de arquivos .ics? As reuniões do Outlook continuam.')) return;
    setBusy('clear'); setErr(''); setMsg('');
    try { await clearIcs(); setMsg('Eventos importados removidos.'); done(); } catch (x) { setErr(errMsg(x)); }
    setBusy('');
  };
  const n = count.data ?? 0;

  return (
    <div className="cal-ok" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <h4 style={{ margin: 0 }}>Importar arquivo .ics</h4>
      <p className="note">Para calendários sem conexão direta (Google, Teams, convites por e-mail). Os eventos entram na agenda, na ocupação e nos avisos. Importar de novo o mesmo arquivo atualiza, sem duplicar. Repetições são lidas de 1 ano atrás até 1 ano à frente.</p>
      <div className="ai-row">
        <label className="btn" aria-disabled={!!busy} style={busy ? { opacity: .55, pointerEvents: 'none' } : undefined}>
          <I.cal />{busy === 'import' ? 'Importando…' : 'Escolher arquivo .ics'}
          <input type="file" accept=".ics,text/calendar" multiple hidden disabled={!!busy} onChange={pick} />
        </label>
        {n > 0 && <button className="btn ghost" disabled={!!busy} onClick={clear}>{busy === 'clear' ? 'Removendo…' : `Remover importados (${n})`}</button>}
      </div>
      {msg && <p className="note">{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function ReminderSettings() {
  const p = useReminderPrefs();
  const blocked = typeof Notification !== 'undefined' && Notification.permission === 'denied';
  return (
    <div className="cal-ok" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <h4 style={{ margin: 0 }}>Aviso antes das reuniões</h4>
      <label className="toggle"><input type="checkbox" checked={p.enabled} onChange={(e) => saveReminderPrefs({ ...p, enabled: e.target.checked })} /> Mostrar um aviso do Windows antes de cada reunião</label>
      <label className="field"><span>Avisar com antecedência de</span>
        <select className="input" value={p.minutes} disabled={!p.enabled} onChange={(e) => saveReminderPrefs({ ...p, minutes: Number(e.target.value) })}>
          {REMINDER_OPTIONS.map((n) => <option key={n} value={n}>{n} minutos</option>)}
        </select>
      </label>
      {blocked && <p className="cfgbanner">As notificações do Pulso Control estão bloqueadas no sistema. No Windows: Configurações &gt; Sistema &gt; Notificações &gt; Pulso Control.</p>}
      <p className="note">O Pulso Control precisa estar aberto (pode estar minimizado). Vale para as reuniões do Outlook que aparecem na agenda. Fica guardado neste computador.</p>
    </div>
  );
}

export function CalendarioModal({ onClose }: { onClose: () => void }) {
  return <Modal label="Calendário (Outlook)" onClose={onClose}><CalendarioSettings /></Modal>;
}

/** Rótulo do título da agenda: origem das reuniões ou o convite para conectar. */
export function CalendarSource({ onOpen }: { onOpen: () => void }) {
  const cal = useCalendar();
  if (!cal.available) return <span className="src">Reuniões do Outlook só no app instalado</span>;
  if (!cal.connected) return <button className="src linkbtn" onClick={onOpen}>Conectar Outlook</button>;
  if (cal.error) return <button className="src linkbtn err" onClick={onOpen}>Outlook: erro ao ler</button>;
  return <button className="src linkbtn" onClick={onOpen} title="Calendário do Outlook">{cal.loading ? 'Outlook · lendo…' : 'Reuniões do Outlook'}</button>;
}
