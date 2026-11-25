import {
  cross,
  distance,
  dot,
  length,
  scale,
  subtract,
  tolerance,
  type Point3,
} from "./geometry";
import type { Member, Project } from "./model";

export type Pair = { a: string; b: string };
export type Merge = { drop: string; keep: string };
export const pairKey = (a: string, b: string) => [a, b].sort().join("|");
export const endpoints = (m: Member) => pairKey(m.start, m.end);
export function nearNodes(p: Project, limit: number) {
  if (!Number.isFinite(limit) || limit < 0)
    throw new Error("Informe uma tolerância finita e não negativa em metros.");
  const pairs: (Pair & { distance: number })[] = [];
  for (let i = 0; i < p.nodes.length; i++) {
    const a = p.nodes[i];
    for (let j = i + 1; j < p.nodes.length; j++) {
      const b = p.nodes[j],
        d = distance(a, b);
      if (d <= limit) pairs.push({ a: a.id, b: b.id, distance: d });
    }
  }
  return pairs;
}
export function mergeMap(merges: Merge[]) {
  const map = new Map<string, string>();
  for (const { drop, keep } of merges) {
    if (drop === keep || map.has(drop))
      throw new Error("Escolha um único destino para cada objeto removido.");
    map.set(drop, keep);
  }
  for (const keep of map.values())
    if (map.has(keep))
      throw new Error(
        "Um objeto mantido também foi marcado para remoção. Escolha um destino direto, sem união em cadeia.",
      );
  return map;
}
export function mergeGroups(map: Map<string, string>) {
  const groups = new Map<string, string[]>();
  for (const [drop, keep] of map) {
    const group = groups.get(keep) ?? [keep];
    group.push(drop);
    groups.set(keep, group);
  }
  return groups;
}
export function stagedMembers(p: Project, limit: number, merges: Merge[]) {
  if (!Number.isFinite(limit) || limit < 0)
    throw new Error("Tolerância inválida.");
  const nodes = new Map(p.nodes.map((n) => [n.id, n])),
    map = mergeMap(merges);
  for (const ids of mergeGroups(map).values()) {
    for (let i = 0; i < ids.length; i++) {
      const n = nodes.get(ids[i]);
      if (!n) throw new Error("O nó selecionado já não existe.");
      for (const id of ids.slice(i + 1)) {
        const other = nodes.get(id);
        if (!other || distance(n, other) > limit)
          throw new Error(
            "O conjunto ultrapassa a tolerância em XYZ. Retire um dos pares para evitar uma união em cadeia.",
          );
      }
    }
  }
  const members = p.members.map((m) => ({
    ...m,
    start: map.get(m.start) ?? m.start,
    end: map.get(m.end) ?? m.end,
  }));
  const byEnds = new Map<string, Member[]>(),
    pairs: Pair[] = [],
    nulls: string[] = [];
  for (const m of members) {
    if (distance(nodes.get(m.start)!, nodes.get(m.end)!) < tolerance) {
      nulls.push(m.id);
      continue;
    }
    const key = endpoints(m),
      peers = byEnds.get(key) ?? [];
    for (const other of peers) pairs.push({ a: other.id, b: m.id });
    peers.push(m);
    byEnds.set(key, peers);
  }
  return { source: p, map, members, pairs, nulls, byEnds };
}
// Positive length shared by two collinear finite segments in global XYZ.
export function overlapLength(a: Point3, b: Point3, c: Point3, d: Point3) {
  const span = distance(a, b);
  if (span < tolerance || distance(c, d) < tolerance) return 0;
  const u = scale(subtract(b, a), 1 / span),
    v = subtract(c, a),
    w = subtract(d, a);
  if (length(cross(v, u)) >= tolerance || length(cross(w, u)) >= tolerance)
    return 0;
  const i = dot(v, u),
    j = dot(w, u);
  return Math.max(
    0,
    Math.min(span, Math.max(i, j)) - Math.max(0, Math.min(i, j)),
  );
}
