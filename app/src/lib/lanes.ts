// Distribui eventos que se sobrepõem em colunas (cada grupo de sobreposição usa só as colunas que precisa).
export function lanes<T extends { a: number; b: number }>(list: T[]): { e: T; col: number; cols: number }[] {
  const sorted = [...list].sort((x, y) => x.a - y.a || y.b - x.b);
  const out: { e: T; col: number; cols: number }[] = [];
  let group: { e: T; col: number; cols: number }[] = [];
  let ends: number[] = [];
  let groupEnd = -Infinity;
  const flush = () => { const n = ends.length; group.forEach((g) => (g.cols = n)); out.push(...group); group = []; ends = []; };
  for (const e of sorted) {
    if (e.a >= groupEnd) { flush(); groupEnd = -Infinity; }
    let col = ends.findIndex((end) => end <= e.a);
    if (col < 0) { col = ends.length; ends.push(e.b); } else ends[col] = e.b;
    group.push({ e, col, cols: 1 });
    groupEnd = Math.max(groupEnd, e.b);
  }
  flush();
  return out;
}
