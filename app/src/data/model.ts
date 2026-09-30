// Visão derivada das demandas: mapas, subtarefas, bloqueios.
import { useMemo } from 'react';
import { useDemands, useDeps, useGroups, useTypes } from './api';
import type { DemandOverview, Group, Meeting } from '../lib/types';

export const GROUP_COLORS = ['var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--g4)'];
export const isOpen = (d: { status: string }) => d.status !== 'done' && d.status !== 'canceled';

/** Reuniões do dia. Vazio até a integração com o Outlook (fase 4). */
export const MEETINGS: Meeting[] = [];

export function useModel() {
  const demandsQ = useDemands();
  const depsQ = useDeps();
  const groupsQ = useGroups();
  const typesQ = useTypes();
  return useMemo(() => {
    const demands = demandsQ.data ?? [];
    const deps = depsQ.data ?? [];
    const groups = groupsQ.data ?? [];
    const types = typesQ.data ?? [];
    const byId = new Map(demands.map((d) => [d.id, d]));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const kids = new Map<string, DemandOverview[]>();
    for (const d of demands) if (d.parent_id) kids.set(d.parent_id, [...(kids.get(d.parent_id) ?? []), d]);
    const children = (id: string) => kids.get(id) ?? [];
    const depsOf = (id: string) => deps.filter((x) => x.demand_id === id).map((x) => byId.get(x.depends_on_id)).filter(Boolean) as DemandOverview[];
    const openDeps = (id: string) => depsOf(id).filter(isOpen);
    const blockers = (id: string) => [...children(id).filter(isOpen), ...openDeps(id)];
    const groupColor = (g: Group | undefined, i = 0) => g?.color || GROUP_COLORS[i % GROUP_COLORS.length];
    const colorOf = (d: DemandOverview | undefined) => {
      if (!d?.group_id) return 'var(--muted)';
      const g = groupById.get(d.group_id);
      return groupColor(g, groups.indexOf(g!));
    };
    return {
      loading: demandsQ.isLoading || groupsQ.isLoading,
      error: demandsQ.error || depsQ.error || groupsQ.error || typesQ.error,
      demands, deps, groups, types, byId, groupById, children, depsOf, openDeps, blockers, groupColor, colorOf,
    };
  }, [demandsQ.data, depsQ.data, groupsQ.data, typesQ.data, demandsQ.isLoading, groupsQ.isLoading, demandsQ.error, depsQ.error, groupsQ.error, typesQ.error]);
}
export type Model = ReturnType<typeof useModel>;
