import { describe, expect, it } from 'vitest';
import { orderAtEnd, orderNear, siblingsOf, whyNotNest } from './order';

const d = (id: string, sort_order: number, group_id: string | null = 'g1', parent_id: string | null = null) =>
  ({ id, title: id, sort_order, group_id, parent_id, status: 'todo' });
const all = [d('a', 10), d('b', 20), d('c', 30), d('x', 10, 'g2'), d('a1', 10, 'g1', 'a'), d('a2', 20, 'g1', 'a')];

describe('ordem manual', () => {
  it('irmãos respeitam grupo e mãe', () => {
    expect(siblingsOf(all, null, 'g1').map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(siblingsOf(all, 'a', 'g2').map((s) => s.id)).toEqual(['a1', 'a2']);
  });
  it('soltar entre dois vizinhos grava a média', () => {
    expect(orderNear(all, 'c', all[0], true)).toEqual({ sort_order: 15, renorm: false });
    expect(orderNear(all, 'a', all[2], false).sort_order).toBe(25);
    expect(orderNear(all, 'x', all[2], true).sort_order).toBe(40);
    expect(orderNear(all, 'x', all[0], false).sort_order).toBe(0);
  });
  it('pede renumeração quando o intervalo acaba', () => {
    const tight = [d('p', 1), d('q', 1 + 1e-9), d('r', 5)];
    expect(orderNear(tight, 'r', tight[0], true).renorm).toBe(true);
  });
  it('fim da lista e regras de aninhamento', () => {
    expect(orderAtEnd(all, null, 'g1')).toBe(40);
    expect(whyNotNest(all, all[1], all[4])).toMatch(/principal/);
    expect(whyNotNest(all, all[0], all[1])).toMatch(/já tem subtarefas/);
    expect(whyNotNest(all, all[1], all[2])).toBe('');
  });
});
