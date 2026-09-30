// "Nova demanda com IA": captura (texto, print, imagem, PDF) -> proposta -> revisão -> criar.
import { useEffect, useRef, useState } from 'react';
import { I } from '../components/Icons';
import { useToast } from '../components/Toast';
import { api, qk, useInvalidate } from '../data/api';
import type { Model } from '../data/model';
import { errMsg } from '../lib/supabase';
import { emptySub, manualDraft, normalize, resolveIds, removeSub, toRpcPayload, type Proposal } from '../lib/proposal';
import { useUI } from '../ui';

const PRI = ['Nenhuma', 'Baixa', 'Média', 'Alta', 'Urgente'];
const MAX_FILES = 5;

interface Attach { name: string; media_type: string; data: string; url: string | null }
type Step = 'capture' | 'loading' | 'error' | 'review';

/** Lê a imagem, reduz o lado maior para 1568 px e devolve JPEG base64. PDF vai como está. */
async function toAttach(f: File): Promise<Attach> {
  const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
  if (f.type === 'application/pdf') {
    if (f.size > 5 * 1024 * 1024) throw new Error(`"${f.name}" passa de 5 MB.`);
    return { name: f.name, media_type: 'application/pdf', data: dataUrl.split(',')[1], url: null };
  }
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const out = c.toDataURL('image/jpeg', 0.85);
  return { name: f.name || 'print.jpg', media_type: 'image/jpeg', data: out.split(',')[1], url: out };
}

export function AiCapture({ m }: { m: Model }) {
  const ui = useUI();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [step, setStep] = useState<Step>('capture');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attach[]>([]);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState('');
  const [p, setP] = useState<Proposal | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [instr, setInstr] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formErr, setFormErr] = useState('');
  const abort = useRef<AbortController | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textRef.current?.focus(); return () => abort.current?.abort(); }, []);

  const close = () => { abort.current?.abort(); ui.setAiOpen(false); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && step !== 'loading') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function addFiles(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      if (!/^image\/|application\/pdf/.test(f.type)) { toast(`"${f.name}" não é imagem nem PDF.`); continue; }
      if (files.length >= MAX_FILES) { toast(`No máximo ${MAX_FILES} anexos.`); break; }
      try { const a = await toAttach(f); setFiles((xs) => (xs.length >= MAX_FILES ? xs : [...xs, a])); } catch (e) { toast(errMsg(e)); }
    }
  }

  async function propose() {
    if (!text.trim() && !files.length) return;
    setStep('loading'); setErr('');
    abort.current = new AbortController();
    try {
      const r = await api.propose({ modo: 'criar', texto: text.trim() || undefined, anexos: files.map(({ media_type, data }) => ({ media_type, data })) }, abort.current.signal);
      setP(resolveIds(normalize(r.proposta), m.groups, m.types)); setOpen(new Set()); setStep('review');
    } catch (e) {
      if (abort.current?.signal.aborted) { setStep('capture'); return; }
      const msg = errMsg(e);
      if (/Configure a chave/i.test(msg)) { ui.openConfig('ia', true); return; }
      setErr(msg); setStep('error');
    }
  }

  async function adjust() {
    if (!p || !instr.trim()) return;
    setAdjusting(true);
    try {
      const r = await api.propose({ modo: 'refinar', proposta_atual: p, instrucao: instr.trim() });
      setP(resolveIds(normalize(r.proposta), m.groups, m.types)); setInstr('');
    } catch (e) { toast(errMsg(e)); }
    setAdjusting(false);
  }

  async function create() {
    if (!p) return;
    if (!p.demand.title.trim()) { setFormErr('Dê um título à demanda antes de criar.'); return; }
    setCreating(true); setFormErr('');
    try {
      const id = await api.createFromAI(toRpcPayload(p, 'Criada com a IA a partir do material colado.'));
      await invalidate(qk.demands, qk.deps, qk.groups, qk.types);
      ui.setAiOpen(false); ui.go('demandas'); ui.open(id);
      toast(`Demanda criada com ${p.subtasks.length} subtarefa${p.subtasks.length === 1 ? '' : 's'} e ${p.demand.checklist.filter((x) => x.trim()).length} itens de checklist.`);
    } catch (e) { setFormErr(errMsg(e)); }
    setCreating(false);
  }

  /** Aplica uma edição sobre uma cópia da proposta. */
  const edit = (fn: (x: Proposal) => void) => setP((cur) => { if (!cur) return cur; const x = structuredClone(cur); fn(x); return x; });

  const head = (
    <header className="ai-head">
      <h3><I.spark />Nova demanda com IA</h3>
      <span className="kbd">Ctrl+Shift+N</span>
      <button className="iconbtn" onClick={close} aria-label="Fechar"><I.x /></button>
    </header>
  );

  if (step === 'capture') return (
    <div className="ai" role="dialog" aria-label="Nova demanda com IA"
      onPaste={(e) => { const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); addFiles(imgs); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
      {head}
      <div className="ai-body">
        <p className="note">Cole um e-mail, uma mensagem ou uma anotação. Também dá para colar um print (Ctrl+V), arrastar uma imagem ou PDF, ou escolher um arquivo. A IA propõe a demanda e você revisa antes de criar.</p>
        <div className={`drop ${over ? 'over' : ''}`}>
          <textarea ref={textRef} className="ai-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Cole aqui o texto, o print ou arraste um arquivo…" aria-label="Material para a IA"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) propose(); }} />
          {files.length > 0 && (
            <div className="thumbs">
              {files.map((f, i) => (
                <div className="thumb" key={i}>
                  {f.url ? <img src={f.url} alt="" /> : <span className="pdf">PDF</span>}
                  <span>{f.name}</span>
                  <button className="iconbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remover ${f.name}`}><I.x /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ai-row">
          <label className="btn"><input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />Escolher arquivo</label>
          <span className="note" style={{ marginLeft: 'auto' }}>Ctrl+Enter para propor</span>
        </div>
      </div>
      <div className="ai-foot">
        <button className="btn ghost" onClick={close}>Cancelar</button>
        <button className="btn primary" disabled={!text.trim() && !files.length} onClick={propose}><I.spark />Propor</button>
      </div>
    </div>
  );

  if (step === 'loading') return (
    <div className="ai" role="dialog" aria-label="Nova demanda com IA">{head}
      <div className="ai-body ai-center"><span className="spin big" /><b>Lendo o material…</b><p className="note">Montando título, prazo, subtarefas e checklist.</p>
        <button className="btn" onClick={() => abort.current?.abort()}>Cancelar</button></div>
    </div>
  );

  if (step === 'error') return (
    <div className="ai" role="dialog" aria-label="Nova demanda com IA">{head}
      <div className="ai-body ai-center">
        <div className="ai-q" style={{ maxWidth: '52ch' }}><I.warn /><span>{err}</span></div>
        <div className="ai-row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={propose}>Tentar de novo</button>
          <button className="btn" onClick={() => { const d = manualDraft(text, files[0]?.name); d.summary = 'Criação manual: a IA não respondeu. O título veio da primeira linha do material.'; setP(d); setStep('review'); }}>
            Criar manualmente com o que já foi preenchido</button>
          <button className="btn ghost" onClick={() => setStep('capture')}>Voltar</button>
        </div>
      </div>
    </div>
  );

  // revisão
  const d = p!.demand;
  const typeSel = d.type_id ? d.type_id : d.type_name ? '__new' : '';
  const groupSel = d.group_id ? d.group_id : d.group_path ? '__new' : '';
  const toggleOpen = (ref: string) => setOpen((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; });

  return (
    <div className="ai" role="dialog" aria-label="Nova demanda com IA">{head}
      <div className="ai-body">
        {p!.summary && <div className="ai-sum"><I.spark /><div><b>Entendi assim:</b> {p!.summary}</div></div>}
        {p!.questions.map((q, i) => <div className="ai-q" key={i}><I.warn /><span>{q}</span></div>)}
        <div className="form">
          <label className="field full"><span>Título</span><input className="input" value={d.title} onChange={(e) => edit((x) => { x.demand.title = e.target.value; })} /></label>
          <label className="field"><span>Tipo {typeSel === '__new' && <span className="chip ok">novo</span>}</span>
            <select className="input" value={typeSel} onChange={(e) => edit((x) => {
              const v = e.target.value;
              if (v === '__new') return;
              if (!v) { x.demand.type_id = null; x.demand.type_name = null; return; }
              x.demand.type_id = v; x.demand.type_name = m.types.find((t) => t.id === v)?.name ?? null;
            })}>
              <option value="">Sem tipo</option>
              {!d.type_id && d.type_name && <option value="__new">{d.type_name} (criar)</option>}
              {m.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
          <label className="field"><span>Grupo {groupSel === '__new' && <span className="chip ok">novo</span>}</span>
            <select className="input" value={groupSel} onChange={(e) => edit((x) => {
              const v = e.target.value;
              if (v === '__new') return;
              if (!v) { x.demand.group_id = null; x.demand.group_path = null; return; }
              x.demand.group_id = v; x.demand.group_path = m.groupById.get(v)?.name ?? null;
            })}>
              <option value="">Sem grupo</option>
              {!d.group_id && d.group_path && <option value="__new">{d.group_path} (criar)</option>}
              {m.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select></label>
          <label className="field"><span>Prazo</span><input className="input" type="date" value={d.due_date ?? ''} onChange={(e) => edit((x) => { x.demand.due_date = e.target.value || null; })} /></label>
          <label className="field"><span>Hora</span><input className="input mono" type="time" value={d.due_time ?? ''} disabled={!d.due_date} onChange={(e) => edit((x) => { x.demand.due_time = e.target.value || null; })} /></label>
          <label className="field"><span>Prioridade</span><select className="input" value={d.priority} onChange={(e) => edit((x) => { x.demand.priority = +e.target.value; })}>
            {PRI.map((l, i) => <option key={i} value={i}>{l}</option>)}</select></label>
          <label className="field"><span>Estimativa (min)</span><input className="input mono" type="number" min={0} value={d.estimated_minutes ?? ''}
            onChange={(e) => edit((x) => { x.demand.estimated_minutes = e.target.value ? Math.max(1, +e.target.value) : null; })} /></label>
          <label className="field full"><span>Referência externa</span><input className="input" value={d.external_ref ?? ''} placeholder="Nº do processo, chamado, e-mail…"
            onChange={(e) => edit((x) => { x.demand.external_ref = e.target.value; })} /></label>
          <label className="field full"><span>Descrição</span><textarea className="input" rows={3} value={d.description ?? ''} onChange={(e) => edit((x) => { x.demand.description = e.target.value; })} /></label>
        </div>

        <div className="sect"><h4>Checklist <span className="n">{d.checklist.length} itens</span></h4>
          <div className="stack" style={{ gap: 6 }}>
            {d.checklist.map((c, i) => (
              <div className="ai-li" key={i}>
                <input className="input" value={c} aria-label={`Item ${i + 1} do checklist`} onChange={(e) => edit((x) => { x.demand.checklist[i] = e.target.value; })} />
                <button className="iconbtn" disabled={!i} aria-label="Subir" onClick={() => edit((x) => { const a = x.demand.checklist; [a[i - 1], a[i]] = [a[i], a[i - 1]]; })}><I.up /></button>
                <button className="iconbtn" title="Transformar em subtarefa" aria-label="Transformar em subtarefa" onClick={() => edit((x) => { const [t] = x.demand.checklist.splice(i, 1); x.subtasks.push(emptySub(x, t)); })}><I.sub /></button>
                <button className="iconbtn" aria-label="Remover" onClick={() => edit((x) => { x.demand.checklist.splice(i, 1); })}><I.x /></button>
              </div>
            ))}
          </div>
          <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => edit((x) => { x.demand.checklist.push(''); })}>+ Item</button>
        </div>

        <div className="sect"><h4>Subtarefas <span className="n">precisam ser concluídas antes da demanda</span></h4>
          <div className="stack" style={{ gap: 6 }}>
            {p!.subtasks.map((s, i) => (
              <details className="ai-sub" key={s.ref} open={open.has(s.ref)} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open !== open.has(s.ref)) toggleOpen(s.ref); }}>
                <summary>
                  <span className="ai-n mono">{i + 1}</span><span className="ai-st">{s.title || 'Sem título'}</span>
                  {s.depends_on.length > 0 && <span className="chip block"><I.lock />depende de {s.depends_on.map((r) => p!.subtasks.findIndex((x) => x.ref === r) + 1).filter((n) => n > 0).join(', ')}</span>}
                  {s.checklist.length > 0 && <span className="chip"><I.cl />{s.checklist.length}</span>}
                </summary>
                <div className="ai-subbody">
                  <label className="field"><span>Título</span><input className="input" value={s.title} onChange={(e) => edit((x) => { x.subtasks[i].title = e.target.value; })} /></label>
                  <div className="form" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
                    <label className="field"><span>Prazo</span><input className="input" type="date" value={s.due_date ?? ''} onChange={(e) => edit((x) => { x.subtasks[i].due_date = e.target.value || null; })} /></label>
                    <label className="field"><span>Hora</span><input className="input mono" type="time" value={s.due_time ?? ''} disabled={!s.due_date} onChange={(e) => edit((x) => { x.subtasks[i].due_time = e.target.value || null; })} /></label>
                    <label className="field"><span>Estimativa (min)</span><input className="input mono" type="number" min={0} value={s.estimated_minutes ?? ''}
                      onChange={(e) => edit((x) => { x.subtasks[i].estimated_minutes = e.target.value ? Math.max(1, +e.target.value) : null; })} /></label>
                  </div>
                  <div className="field"><span>Depende de</span>
                    <div className="deps">
                      {p!.subtasks.filter((o) => o.ref !== s.ref).map((o) => {
                        const on = s.depends_on.includes(o.ref);
                        return <button key={o.ref} aria-pressed={on} onClick={(e) => { e.preventDefault(); edit((x) => { const t = x.subtasks[i]; t.depends_on = on ? t.depends_on.filter((r) => r !== o.ref) : [...t.depends_on, o.ref]; }); }}>
                          {p!.subtasks.indexOf(o) + 1}. {o.title}</button>;
                      })}
                      {p!.subtasks.length < 2 && <span className="note">Não há outras subtarefas.</span>}
                    </div>
                  </div>
                  <div className="field"><span>Checklist da subtarefa</span>
                    {s.checklist.map((c, j) => (
                      <div className="ai-li" key={j}>
                        <input className="input" value={c} onChange={(e) => edit((x) => { x.subtasks[i].checklist[j] = e.target.value; })} />
                        <button className="iconbtn" aria-label="Remover" onClick={() => edit((x) => { x.subtasks[i].checklist.splice(j, 1); })}><I.x /></button>
                      </div>
                    ))}
                    <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => edit((x) => { x.subtasks[i].checklist.push(''); })}>+ Item</button>
                  </div>
                  <div className="ai-row">
                    <button className="btn" disabled={!i} onClick={() => edit((x) => { const a = x.subtasks; [a[i - 1], a[i]] = [a[i], a[i - 1]]; })}><I.up />Subir</button>
                    <button className="btn" disabled={i === p!.subtasks.length - 1} onClick={() => edit((x) => { const a = x.subtasks; [a[i + 1], a[i]] = [a[i], a[i + 1]]; })}><I.down />Descer</button>
                    <button className="btn" onClick={() => edit((x) => { const t = removeSub(x, i); x.demand.checklist.push(t.title); })}><I.cl />Virar item de checklist</button>
                    <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => edit((x) => { removeSub(x, i); })}>Remover</button>
                  </div>
                </div>
              </details>
            ))}
            {!p!.subtasks.length && <p className="note">Nenhuma subtarefa.</p>}
          </div>
          <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => { const n = emptySub(p!); edit((x) => { x.subtasks.push({ ...n }); }); setOpen((o) => new Set(o).add(n.ref)); }}>+ Subtarefa</button>
        </div>

        <div className="sect ai-adj"><h4><I.spark />Pedir ajuste à IA</h4>
          <div className="addline">
            <input className="input" value={instr} disabled={adjusting} onChange={(e) => setInstr(e.target.value)} placeholder="Ex.: divida a redação em pesquisa e escrita"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adjust(); } }} />
            <button className="btn" disabled={adjusting || !instr.trim()} onClick={adjust}>{adjusting ? <><span className="spin" />Ajustando…</> : 'Ajustar'}</button>
          </div>
          <p className="note">Suas edições manuais são mantidas no ajuste.</p>
        </div>
        {formErr && <p className="ai-err">{formErr}</p>}
      </div>
      <div className="ai-foot">
        <button className="btn ghost" onClick={close}>Descartar</button>
        <button className="btn primary" disabled={creating} onClick={create}><I.check />{creating ? 'Criando…' : 'Criar demanda'}</button>
      </div>
    </div>
  );
}
