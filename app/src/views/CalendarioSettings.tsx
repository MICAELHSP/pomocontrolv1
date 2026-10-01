// Configurações > Calendário (Outlook): conectar a conta Microsoft para ler as reuniões.
// Painel independente: vai na aba "Calendário (Outlook)" de Configurações e, até ela existir,
// abre como janela sobre a tela Hoje (CalendarioModal).
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { I } from '../components/Icons';
import { Modal } from '../components/Modal';
import { calKeys, outlook, useCalendar } from '../lib/outlook';
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
    return <div className="cal-set"><p className="note">O calendário do Outlook funciona só no app instalado (Electron), não no navegador.</p></div>;
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
      <p className="note">O Pauta só lê as suas reuniões para mostrar na agenda e avisar quando um prazo cai em cima de uma delas. Nada é alterado no Outlook. Uma cópia das reuniões (assunto, horário, local e link) fica no banco do Pauta para o Calendário e a ocupação.</p>

      {cal.connected ? (
        <div className="cal-ok">
          <span className="chip ok"><I.check />Conectado</span>
          <div><b>{st?.account?.name || 'Conta Microsoft'}</b>{st?.account?.email ? <span className="note"> · {st.account.email}</span> : null}</div>
          <p className="note">
            {cal.loading ? 'Lendo as reuniões…' : cal.error ? <span className="err">Erro ao ler o calendário: {errMsg(cal.error)}</span> : `Reuniões de ontem até os próximos 60 dias. Atualizado às ${updated}; atualiza sozinho a cada 5 minutos.`}
          </p>
          {st && !st.persistent && <p className="cfgbanner">Este computador não permite guardar o login com segurança, então será preciso conectar de novo a cada vez que abrir o Pauta.</p>}
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
          <p className="note">O login abre no seu navegador. Depois de aceitar, volte para o Pauta. <a href={GUIA} target="_blank" rel="noreferrer">Como registrar o aplicativo no Azure</a></p>
        </>
      )}
      {err && <p className="err">{err}</p>}
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
