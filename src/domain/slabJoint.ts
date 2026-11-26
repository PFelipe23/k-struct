import type { Project, Slab, SlabJoint } from "./model";
import { tolerance } from "./geometry";
import { slabRings, cross2, inMaterial, type XY } from "./slabPolygon";

export const jointNames = {
  hinged: "Articulada",
  elastic: "Semirrígida",
  continuous: "Contínua",
} as const;
const near = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
type SlabPair = Pick<Project, "slabs" | "slabJoint">;
export function jointPanels(p: SlabPair) {
  if (p.slabs.length === 2 && p.slabJoint?.a.slabId === p.slabs[1].id)
    return [p.slabs[1], p.slabs[0]];
  return p.slabs;
}
export function sharedEdges(p: SlabPair) {
  const [a, b] = jointPanels(p);
  if (!a || !b || a.levelId !== b.levelId) return [];
  const ra = slabRings(a)[0],
    rb = slabRings(b)[0];
  return ra.flatMap((v, i) =>
    rb.flatMap((w, j) => {
      const end = ra[(i + 1) % ra.length],
        otherEnd = rb[(j + 1) % rb.length];
      if (!near(v, otherEnd) || !near(end, w)) return [];
      return [
        {
          a: { slabId: a.id, edgeId: v.edgeId },
          b: { slabId: b.id, edgeId: w.edgeId },
          start: v,
          end,
        },
      ];
    }),
  );
}
export type SharedEdge = ReturnType<typeof sharedEdges>[number];
export function matchingBeams(p: Project, edge: SharedEdge) {
  const z = p.guides.z.find((v) => v.id === p.slabs[0].levelId)?.position;
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  return p.members.filter((m) => {
    const a = nodes.get(m.start),
      b = nodes.get(m.end);
    return (
      a &&
      b &&
      z !== undefined &&
      Math.abs(a.z - z) <= tolerance &&
      Math.abs(b.z - z) <= tolerance &&
      ((near(a, edge.start) && near(b, edge.end)) ||
        (near(b, edge.start) && near(a, edge.end)))
    );
  });
}
export function defaultJoint(edge: SharedEdge): SlabJoint {
  return { a: edge.a, b: edge.b, kind: "hinged", support: "none" };
}
export function sameEdge(j: SlabJoint, e: SharedEdge) {
  return (
    j.a.slabId === e.a.slabId &&
    j.a.edgeId === e.a.edgeId &&
    j.b.slabId === e.b.slabId &&
    j.b.edgeId === e.b.edgeId
  );
}
export function refreshJoint(p: Project) {
  const edges = sharedEdges(p);
  if (p.slabJoint && !edges.some((e) => sameEdge(p.slabJoint!, e)))
    delete p.slabJoint;
  if (!p.slabJoint && edges.length === 1) p.slabJoint = defaultJoint(edges[0]);
}
export function jointGeometryErrors(p: Project) {
  const matches = sharedEdges(p),
    joint = p.slabJoint;
  if (p.slabs.length !== 2)
    return joint ? ["A ligação requer os dois painéis do pavimento."] : [];
  if (matches.length !== 1 || !joint || !sameEdge(joint, matches[0]))
    return [
      "As duas lajes precisam compartilhar uma borda externa inteira no mesmo pavimento. Alinhe os vértices das duas extremidades.",
    ];
  const [a, b] = p.slabs.map(slabRings);
  const sides = (rs: typeof a) =>
    rs.flatMap((r) => r.map((v, i) => [v, r[(i + 1) % r.length]] as const));
  const hits = sides(a).some(([u, v]) =>
    sides(b).some(
      ([x, y]) =>
        cross2(u, v, x) * cross2(u, v, y) < 0 &&
        cross2(x, y, u) * cross2(x, y, v) < 0,
    ),
  );
  // A strict interior vertex or crossing indicates a second region of contact.
  const inside = (pt: XY, rs: typeof a) =>
    !sides(rs).some(([u, v]) => {
      const l = Math.hypot(v.x - u.x, v.y - u.y);
      return (
        Math.abs(cross2(u, v, pt)) <= tolerance * l &&
        (pt.x - u.x) * (pt.x - v.x) + (pt.y - u.y) * (pt.y - v.y) <=
          tolerance * l
      );
    }) && inMaterial(pt, rs);
  if (
    hits ||
    a.flat().some((v) => inside(v, b)) ||
    b.flat().some((v) => inside(v, a))
  )
    return ["Os painéis se sobrepõem fora da borda comum."];
  if (
    joint.support === "beam" &&
    !matchingBeams(p, matches[0]).some((m) => m.id === joint.memberId)
  )
    return [
      "A viga de apoio deve coincidir com a borda comum inteira, na mesma cota.",
    ];

  if (!p.members.length && p.nodes.length)
    return ["Há nós de pórtico sem viga conectada às lajes."];
  if (joint.support === "beam") {
    const member = p.members.find((m) => m.id === joint.memberId)!;
    if (
      member.offsets &&
      Object.values(member.offsets).some(
        (e) =>
          e.rigidLength > 0 ||
          Object.values(e.eccentricity).some((v) => v !== 0),
      )
    )
      return [
        "A viga que apoia a borda deve ter eixo deformável coincidente com todo o trecho. Confira os offsets e os trechos rígidos.",
      ];
  }
  return [];
}
export function rigidFloorRows(p: Project, edge: SharedEdge, beamFixed = true) {
  const span = Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y);
  const t = {
    x: (edge.end.x - edge.start.x) / span,
    y: (edge.end.y - edge.start.y) / span,
  };
  // For a rigid panel w=w0+rx*y-ry*x, about the first edge endpoint.
  const position = (v: XY) => [
    1,
    (v.y - edge.start.y) / span,
    -(v.x - edge.start.x) / span,
  ];
  const rows: number[][] = [];
  const zeros = [0, 0, 0];
  for (const [i, slab] of jointPanels(p).entries()) {
    const bare = panelWithoutJointSupport(
      slab,
      i === 0 ? edge.a.edgeId : edge.b.edgeId,
    );
    for (const ring of slabRings(bare))
      for (const [j, v] of ring.entries())
        if (v.supported)
          for (const end of [v, ring[(j + 1) % ring.length]])
            rows.push(
              i === 0
                ? [...position(end), ...zeros]
                : [...zeros, ...position(end)],
            );
  }
  for (const v of [edge.start, edge.end]) {
    const row = position(v);
    rows.push([...row, ...row.map((v) => -v)]);
    if (
      p.slabJoint?.support === "line" ||
      (beamFixed && p.slabJoint?.support === "beam")
    )
      rows.push([...row, ...zeros]);
  }
  if (p.slabJoint?.kind !== "hinged") rows.push([0, t.x, t.y, 0, -t.x, -t.y]);
  return rows;
}
export function panelWithoutJointSupport(slab: Slab, edgeId: string): Slab {
  if (slab.polygon)
    return {
      ...slab,
      polygon: {
        ...slab.polygon,
        rings: slab.polygon.rings.map((r) =>
          r.map((v) => (v.edgeId === edgeId ? { ...v, supported: false } : v)),
        ),
      },
    };
  return { ...slab, supports: { ...slab.supports, [edgeId]: false } };
}
