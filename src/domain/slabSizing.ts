import type { SlabSizing } from "./model";
import { nextIndex, type SlabRing, type XY } from "./slabPolygon";

export const targetMeshLimit = 8192;
export function checkMeshBudget(elements: number, nodes = 0) {
  if (
    elements > targetMeshLimit ||
    nodes > targetMeshLimit ||
    !Number.isFinite(elements + nodes)
  )
    throw new Error(
      `O tamanho solicitado ultrapassa o limite de ${targetMeshLimit} elementos ou nós. Aumente o tamanho-alvo.`,
    );
}
export function sizingError(rings: SlabRing[], sizing: SlabSizing) {
  if (!Number.isFinite(sizing.target) || sizing.target <= 0)
    return "Informe um tamanho-alvo global finito e positivo.";
  const borders = new Map(
    rings.flatMap((ring) =>
      ring.map((a, i) => {
        const b = ring[nextIndex(i, ring.length)];
        return [a.edgeId, Math.hypot(b.x - a.x, b.y - a.y)] as const;
      }),
    ),
  );
  const used = new Set<string>();
  for (const { edgeId, size } of sizing.edges) {
    const length = borders.get(edgeId);
    if (length === undefined || used.has(edgeId))
      return `Controle local com borda ausente ou repetida: ${edgeId}.`;
    if (!(size > 0 && size <= sizing.target))
      return "O tamanho local deve ser positivo e menor ou igual ao tamanho global.";
    if (Math.ceil(length / size) > targetMeshLimit)
      return `A borda ${edgeId} requer mais de ${targetMeshLimit} segmentos. Aumente o tamanho local.`;
    used.add(edgeId);
  }
  return null;
}
export function targetAt(rings: SlabRing[], sizing: SlabSizing) {
  const byId = new Map(sizing.edges.map((e) => [e.edgeId, e.size]));
  const segments = rings.flatMap((r) =>
    r.flatMap((a, i) => {
      const size = byId.get(a.edgeId);
      if (size === undefined) return [];
      const b = r[nextIndex(i, r.length)],
        dx = b.x - a.x,
        dy = b.y - a.y;
      return [{ a, dx, dy, squared: dx * dx + dy * dy, size }];
    }),
  );
  return (p: XY) => {
    let h = sizing.target;
    for (const { a, dx, dy, squared, size } of segments) {
      const u = p.x - a.x,
        v = p.y - a.y,
        t = Math.max(0, Math.min(1, (u * dx + v * dy) / squared));
      h = Math.min(h, size + 0.5 * Math.hypot(u - t * dx, v - t * dy));
    }
    return h;
  };
}
export function rectangularAxis(
  span: number,
  target: number,
  parallel: number[],
  low: number,
  high: number,
) {
  const count = Math.max(2, Math.ceil(span / Math.min(target, ...parallel)));
  checkMeshBudget(count);
  const values = [0];
  function interval(a: number, b: number) {
    const h = Math.min(target, low + 0.5 * a, high + 0.5 * (span - b));
    if (b - a > h * (1 + 1e-12)) {
      const mid = a + (b - a) / 2;
      if (mid === a || mid === b)
        throw new Error("Tamanho local abaixo da precisão das coordenadas.");
      interval(a, mid);
      interval(mid, b);
    } else {
      values.push(b);
      checkMeshBudget(values.length);
    }
  }
  for (let i = 0; i < count; i++)
    interval((i / count) * span, ((i + 1) / count) * span);
  return values;
}
