// Ordem manual (sort_order fracionário entre irmãos) e regras de aninhamento de um nível.

export interface Orderable { id: string; parent_id: string | null; group_id: string | null; sort_order: number; status: string }

/** Irmãos de uma posição: mesma mãe; se for principal, também o mesmo grupo. */
export const siblingsOf = <T extends Orderable>(all: T[], parent: string | null, group: string | null, exceptId?: string) =>
  all.filter((x) => x.id !== exceptId && (x.parent_id ?? null) === parent && (parent || (x.group_id ?? null) === group))
    .sort((a, b) => a.sort_order - b.sort_order);

/**
 * Ordem para soltar `id` antes/depois de `target`, entre os irmãos do alvo.
 * `renorm` indica que o intervalo ficou pequeno demais e a lista deve ser renumerada depois.
 */
export function orderNear<T extends Orderable>(all: T[], id: string, target: T, after: boolean): { sort_order: number; renorm: boolean } {
  const sibs = siblingsOf(all, target.parent_id ?? null, target.group_id ?? null, id);
  const i = sibs.findIndex((s) => s.id === target.id);
  const nb = sibs[after ? i + 1 : i - 1];
  if (!nb) return { sort_order: target.sort_order + (after ? 10 : -10), renorm: false };
  const v = (target.sort_order + nb.sort_order) / 2;
  return { sort_order: v, renorm: Math.abs(target.sort_order - nb.sort_order) < 1e-6 };
}

/** Ordem para ir ao fim de uma lista. */
export const orderAtEnd = <T extends Orderable>(all: T[], parent: string | null, group: string | null, exceptId?: string) =>
  Math.max(0, ...siblingsOf(all, parent, group, exceptId).map((s) => s.sort_order)) + 10;

/** Motivo para não poder colocar `d` dentro de `target` (vazio = pode). */
export function whyNotNest<T extends Orderable>(all: T[], d: T & { title: string }, target: T | undefined): string {
  if (!target || target.id === d.id || target.parent_id) return 'Só dá para colocar dentro de uma demanda principal.';
  if (all.some((x) => x.parent_id === d.id)) return `"${d.title}" já tem subtarefas e não pode virar subtarefa.`;
  return '';
}
