// Mover demandas: reordenar, trocar de grupo, virar subtarefa e sair de dentro. Tudo com "Desfazer".
import { useToast } from '../components/Toast';
import { errMsg } from '../lib/supabase';
import { orderAtEnd, orderNear, whyNotNest } from '../lib/order';
import type { DemandOverview } from '../lib/types';
import { api, qk, useInvalidate } from './api';
import { isOpen, type Model } from './model';

export function useMover(m: Model, onManual?: () => boolean) {
  const toast = useToast();
  const invalidate = useInvalidate();

  async function apply(d: DemandOverview, patch: { parent_id: string | null; group_id: string | null; sort_order: number }, msg: string,
    opts: { renorm?: boolean; reopen?: DemandOverview } = {}) {
    const before = { parent_id: d.parent_id, group_id: d.group_id, sort_order: d.sort_order };
    try {
      await api.moveDemand(d.id, patch);
      if (opts.reopen) await api.setStatus(opts.reopen.id, 'in_progress');
      if (opts.renorm) await api.renormalizeOrder(patch.group_id, patch.parent_id);
    } catch (e) { toast(errMsg(e)); await invalidate(qk.demands); return; }
    await invalidate(qk.demands);
    const switched = onManual?.() ? ' Ordenação trocada para Manual.' : '';
    toast(msg + switched, {
      label: 'Desfazer',
      run: async () => {
        try {
          // Voltar para dentro de outra mãe: primeiro a mãe, depois o grupo (a regra do banco segue a mãe).
          await api.moveDemand(d.id, before);
          if (opts.reopen) await api.setStatus(opts.reopen.id, 'done');
        } catch (e) { toast(errMsg(e)); }
        await invalidate(qk.demands);
      },
    });
  }

  const title = (s: string) => (s.length > 60 ? s.slice(0, 60) + '…' : s);

  return {
    whyNotNest: (d: DemandOverview, target: DemandOverview | undefined) => whyNotNest(m.demands, d, target),

    async nestInto(d: DemandOverview, target: DemandOverview) {
      const why = whyNotNest(m.demands, d, target);
      if (why) { toast(why); return; }
      if (d.parent_id === target.id) return;
      const reopen = target.status === 'done' && isOpen(d) ? target : undefined;
      await apply(d, { parent_id: target.id, group_id: target.group_id, sort_order: orderAtEnd(m.demands, target.id, target.group_id, d.id) },
        `"${title(d.title)}" virou subtarefa de "${title(target.title)}".${reopen ? ' A demanda foi reaberta.' : ''}`, { reopen });
    },

    async unnest(d: DemandOverview) {
      if (!d.parent_id) return;
      await apply(d, { parent_id: null, group_id: d.group_id, sort_order: orderAtEnd(m.demands, null, d.group_id, d.id) },
        `"${title(d.title)}" saiu de dentro da demanda.`);
    },

    async moveNear(d: DemandOverview, target: DemandOverview, after: boolean) {
      if (d.id === target.id || target.parent_id === d.id) return;
      if (target.parent_id && m.children(d.id).length) { toast(`"${title(d.title)}" tem subtarefas e não pode entrar em outra demanda.`); return; }
      const { sort_order, renorm } = orderNear(m.demands, d.id, target, after);
      const moved = (target.group_id ?? null) !== (d.group_id ?? null);
      const unnested = d.parent_id && !target.parent_id;
      const g = target.group_id ? m.groupById.get(target.group_id)?.name : 'Sem grupo';
      await apply(d, { parent_id: target.parent_id, group_id: target.group_id, sort_order },
        unnested ? `"${title(d.title)}" saiu de dentro da demanda.` : moved ? `Movida para ${g}.` : 'Ordem atualizada.', { renorm });
    },

    async moveToGroupEnd(d: DemandOverview, groupId: string | null) {
      if (!d.parent_id && (d.group_id ?? null) === groupId) return;
      const g = groupId ? m.groupById.get(groupId)?.name : 'Sem grupo';
      await apply(d, { parent_id: null, group_id: groupId, sort_order: orderAtEnd(m.demands, null, groupId, d.id) }, `Movida para ${g}.`);
    },
  };
}
