import { describe, expect, it } from 'vitest';
import { manualDraft, nextRef, normalize, removeSub, resolveIds, toRpcPayload } from './proposal';

const base = () => normalize({
  summary: 'x', questions: [],
  demand: { title: ' Responder ofício ', description: '', type_name: 'Processo', type_id: null, group_path: 'Trabalho', group_id: 'g1',
    priority: 3, due_date: null, due_time: '16:00:00', estimated_minutes: null, external_ref: ' ', checklist: ['a', ' ', 'b'] },
  subtasks: [
    { ref: 's1', title: 'Levantar dados', description: null, due_date: null, due_time: null, estimated_minutes: 30, checklist: [], depends_on: [] },
    { ref: 's2', title: 'Redigir', description: null, due_date: '2026-10-02', due_time: '15:00', estimated_minutes: 60, checklist: [''], depends_on: ['s1', 's9', 's2'] },
  ],
});

describe('proposta da IA', () => {
  it('limpa o corpo da RPC', () => {
    const r = toRpcPayload(base(), 'Criada com IA');
    expect(r.demand.title).toBe('Responder ofício');
    expect(r.demand.due_time).toBeNull(); // sem data não há hora
    expect(r.demand.group_path).toBeNull(); // grupo existente vai por id
    expect(r.demand.type_name).toBe('Processo');
    expect(r.demand.external_ref).toBeNull();
    expect(r.demand.checklist).toEqual(['a', 'b']);
    expect(r.subtasks[1].depends_on).toEqual(['s1']);
    expect(r.subtasks[1].checklist).toEqual([]);
    expect(r.note).toBe('Criada com IA');
  });
  it('remover subtarefa tira as dependências para ela', () => {
    const p = base();
    removeSub(p, 0);
    expect(p.subtasks[0].depends_on).toEqual(['s9', 's2']);
    expect(nextRef(p)).toBe('s3');
  });
  it('rascunho manual usa a primeira linha', () => {
    expect(manualDraft('\n  Pedido da diretoria\nmais texto').demand.title).toBe('Pedido da diretoria');
  });
  it('liga grupo e tipo existentes pelo nome', () => {
    const p = { ...base(), demand: { ...base().demand, group_path: 'processos', type_name: 'PROCESSO', group_id: null, type_id: null } };
    const r = resolveIds(p, [{ id: 'g1', name: 'Processos' }], [{ id: 't1', name: 'Processo' }]);
    expect([r.demand.group_id, r.demand.type_id]).toEqual(['g1', 't1']);
    expect(resolveIds({ ...p, demand: { ...p.demand, group_path: 'Outro' } }, [{ id: 'g1', name: 'Processos' }], []).demand.group_id).toBeNull();
  });
});
