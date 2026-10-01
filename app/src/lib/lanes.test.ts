import { describe, expect, it } from 'vitest';
import { lanes } from './lanes';

describe('lanes', () => {
  it('põe lado a lado só o que se sobrepõe', () => {
    const r = lanes([{ a: 560, b: 640 }, { a: 600, b: 660 }, { a: 665, b: 680 }]);
    expect(r.map((x) => [x.e.a, x.col, x.cols])).toEqual([[560, 0, 2], [600, 1, 2], [665, 0, 1]]);
  });
  it('reaproveita a coluna livre', () => {
    const r = lanes([{ a: 0, b: 100 }, { a: 10, b: 20 }, { a: 30, b: 40 }]);
    expect(r.map((x) => [x.col, x.cols])).toEqual([[0, 2], [1, 2], [1, 2]]);
  });
});
