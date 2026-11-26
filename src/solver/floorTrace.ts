// Parameterize the four rotations at one common station. Each independent
// constraint has its own zero prescribed jump. Its OOFEM reaction is the
// conjugate moment, including for an exact (continuous) tie.
export type ScalarTerm = { id: number; weight: number };
export type RotationEquation = {
  row: number[];
  side?: number;
  tangentComponent?: number;
  kind: "exterior" | "normal" | "tangent";
};
export function rotationTrace(
  equations: RotationEquation[],
  scalar: (fixed: boolean) => number,
) {
  const pivots: { column: number; v: number[]; rhs: Map<number, number> }[] =
    [];
  const accepted: { eq: RotationEquation; id: number }[] = [];
  const add = (
    to: Map<number, number>,
    from: Map<number, number>,
    scale: number,
  ) => {
    for (const [k, v] of from) to.set(k, (to.get(k) ?? 0) + v * scale);
  };
  for (const eq of equations) {
    const v = [...eq.row],
      rhs = new Map<number, number>();
    for (const p of pivots) {
      const alpha = v[p.column];
      for (let k = 0; k < 4; k++) v[k] -= alpha * p.v[k];
      add(rhs, p.rhs, -alpha);
    }
    const pivot = v.reduce(
      (best, x, i) => (Math.abs(x) > Math.abs(v[best]) ? i : best),
      0,
    );
    if (Math.abs(v[pivot]) < 1e-10) continue;
    const id = scalar(true);
    accepted.push({ eq, id });
    rhs.set(id, 1);
    const factor = v[pivot];
    for (let i = 0; i < 4; i++) v[i] /= factor;
    for (const [key, value] of rhs) rhs.set(key, value / factor);
    for (const p of pivots) {
      const alpha = p.v[pivot];
      for (let k = 0; k < 4; k++) p.v[k] -= alpha * v[k];
      add(p.rhs, rhs, -alpha);
    }
    pivots.push({ column: pivot, v, rhs });
  }
  const free = new Map<number, number>();
  for (let i = 0; i < 4; i++)
    if (!pivots.some((p) => p.column === i)) free.set(i, scalar(false));
  const rotations = Array.from({ length: 4 }, (_, i): ScalarTerm[] => {
    if (free.has(i)) return [{ id: free.get(i)!, weight: 1 }];
    const p = pivots.find((p) => p.column === i)!;
    const terms = [...p.rhs].map(([id, weight]) => ({ id, weight }));
    for (const [j, id] of free) terms.push({ id, weight: -p.v[j] });
    return terms.filter((t) => Math.abs(t.weight) > 1e-13);
  });
  return { rotations, accepted };
}
