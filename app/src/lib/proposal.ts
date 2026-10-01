// Proposta da captura com IA (ver docs em ia/README.md, seção 4) e utilidades puras.

export interface PropSub {
  ref: string;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: number | null;
  checklist: string[];
  depends_on: string[];
}

export interface Proposal {
  summary: string;
  questions: string[];
  demand: {
    title: string;
    description: string | null;
    type_name: string | null;
    type_id?: string | null;
    group_path: string | null;
    group_id?: string | null;
    priority: number;
    due_date: string | null;
    due_time: string | null;
    estimated_minutes: number | null;
    external_ref: string | null;
    checklist: string[];
  };
  subtasks: PropSub[];
}

export const nextRef = (p: Proposal) => 's' + (Math.max(0, ...p.subtasks.map((s) => Number(s.ref.replace(/\D/g, '')) || 0)) + 1);

export function emptySub(p: Proposal, title = 'Nova subtarefa'): PropSub {
  return { ref: nextRef(p), title, description: null, due_date: p.demand.due_date, due_time: null, estimated_minutes: null, checklist: [], depends_on: [] };
}

/** Remove uma subtarefa e as dependências para ela. */
export function removeSub(p: Proposal, i: number): PropSub {
  const [s] = p.subtasks.splice(i, 1);
  for (const o of p.subtasks) o.depends_on = o.depends_on.filter((r) => r !== s.ref);
  return s;
}

/** Normaliza campos vindos da IA (nulos, listas faltando). */
export function normalize(raw: unknown): Proposal {
  const r = (raw ?? {}) as Partial<Proposal>;
  const d = (r.demand ?? {}) as Partial<Proposal['demand']>;
  return {
    summary: r.summary ?? '',
    questions: Array.isArray(r.questions) ? r.questions : [],
    demand: {
      title: d.title ?? '', description: d.description ?? null,
      type_name: d.type_name ?? null, type_id: d.type_id ?? null,
      group_path: d.group_path ?? null, group_id: d.group_id ?? null,
      priority: typeof d.priority === 'number' ? d.priority : 2,
      due_date: d.due_date ?? null, due_time: d.due_time ? d.due_time.slice(0, 5) : null,
      estimated_minutes: d.estimated_minutes ?? null, external_ref: d.external_ref ?? null,
      checklist: Array.isArray(d.checklist) ? d.checklist : [],
    },
    subtasks: (Array.isArray(r.subtasks) ? r.subtasks : []).map((s, i) => ({
      ref: s.ref || `s${i + 1}`, title: s.title ?? '', description: s.description ?? null,
      due_date: s.due_date ?? null, due_time: s.due_time ? s.due_time.slice(0, 5) : null,
      estimated_minutes: s.estimated_minutes ?? null,
      checklist: Array.isArray(s.checklist) ? s.checklist : [], depends_on: Array.isArray(s.depends_on) ? s.depends_on : [],
    })),
  };
}

/** Proposta revisada -> corpo da RPC create_demand_from_ai (limpa vazios). */
export function toRpcPayload(p: Proposal, note?: string) {
  const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  const refs = new Set(p.subtasks.map((s) => s.ref));
  const d = p.demand;
  return {
    demand: {
      ...d,
      title: d.title.trim(),
      description: d.description?.trim() || null,
      type_id: d.type_id || null, type_name: d.type_id ? null : d.type_name?.trim() || null,
      group_id: d.group_id || null, group_path: d.group_id ? null : d.group_path?.trim() || null,
      due_time: d.due_date ? d.due_time || null : null,
      external_ref: d.external_ref?.trim() || null,
      checklist: clean(d.checklist),
    },
    subtasks: p.subtasks.filter((s) => s.title.trim()).map((s) => ({
      ...s,
      title: s.title.trim(),
      due_time: s.due_date ? s.due_time || null : null,
      checklist: clean(s.checklist),
      depends_on: s.depends_on.filter((r) => refs.has(r) && r !== s.ref),
    })),
    ...(note ? { note } : {}),
  };
}

/** Proposta mínima para criar à mão quando a IA falha. */
export function manualDraft(text: string, fileName?: string): Proposal {
  const first = (text.split('\n').map((l) => l.trim()).find(Boolean) || fileName || '').slice(0, 90);
  return normalize({ summary: '', questions: [], demand: { title: first, description: text.slice(0, 2000) || null, priority: 2, checklist: [] }, subtasks: [] });
}

/** Liga tipo e grupo da proposta aos que já existem, pelo nome (sem diferenciar maiúsculas). */
export function resolveIds(p: Proposal, groups: { id: string; name: string }[], types: { id: string; name: string }[]): Proposal {
  const eq = (a: string | null | undefined, b: string) => !!a && a.trim().toLocaleLowerCase('pt') === b.trim().toLocaleLowerCase('pt');
  const d = { ...p.demand };
  if (!d.group_id && d.group_path) {
    const last = d.group_path.split('/').pop()!;
    const g = groups.find((x) => eq(d.group_path, x.name)) ?? groups.find((x) => eq(last, x.name));
    if (g) { d.group_id = g.id; d.group_path = g.name; }
  }
  if (!d.type_id && d.type_name) {
    const t = types.find((x) => eq(d.type_name, x.name));
    if (t) { d.type_id = t.id; d.type_name = t.name; }
  }
  return { ...p, demand: d };
}
