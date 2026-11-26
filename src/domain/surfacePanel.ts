import {
  add,
  coordinates,
  cross,
  distance,
  dot,
  length,
  matrixRank,
  scale,
  subtract,
  tolerance,
  type Point3,
} from "./geometry";
import { panelTrig, panelStiffnessError } from "./panelStiffness";
import type { PanelEdge, Project, SurfacePanel } from "./model";

export const panelEdges: PanelEdge[] = ["AB", "BC", "CD", "DA"];
export const panelKinds = {
  membrane: "Membrana",
  plate: "Placa em flexão",
  shell: "Casca",
};
export type Basis = [Point3, Point3, Point3];
export const globalBasis: Basis = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];
const unit = (v: Point3) => scale(v, 1 / length(v));
export const inGlobal = (v: Point3, axes: Basis) =>
  add(add(scale(axes[0], v.x), scale(axes[1], v.y)), scale(axes[2], v.z));
export const inLocal = (v: Point3, axes: Basis): Point3 => ({
  x: dot(v, axes[0]),
  y: dot(v, axes[1]),
  z: dot(v, axes[2]),
});

export function panelGeometry(p: SurfacePanel) {
  const u = subtract(p.b, p.a),
    v = subtract(p.d, p.a),
    normal = cross(u, v);
  const area = length(normal),
    c = add(p.b, v);
  if (
    !Number.isFinite(area) ||
    !coordinates.every((k) => Number.isFinite(c[k])) ||
    Math.min(length(u) / p.nu, length(v) / p.nv) <= tolerance ||
    area <=
      Math.max(
        tolerance * Math.max(length(u), length(v)),
        1e-8 * length(u) * length(v),
      )
  )
    throw new Error(
      `${p.name} · A, B e D devem definir um painel com área e subdivisões válidas.`,
    );
  const x = unit(u),
    z = unit(normal);
  const axes: Basis = [x, cross(z, x), z];
  const corners = { A: p.a, B: p.b, C: c, D: p.d };
  const { c: cos, s: sin } = panelTrig(p.angleDeg);
  const materialAxes: Basis =
    cos === 1 && sin === 0
      ? axes
      : [
          add(scale(axes[0], cos), scale(axes[1], sin)),
          add(scale(axes[0], -sin), scale(axes[1], cos)),
          z,
        ];
  return { u, v, area, axes, materialAxes, corners };
}

export function panelModelErrors(p: Project) {
  const panels = p.surfacePanels ?? [],
    errors: string[] = [];
  if (panels.length && p.mode !== "spatial")
    errors.push("Painéis espaciais exigem um projeto XYZ.");
  for (const panel of panels) {
    const mat = p.materials.find((m) => m.id === panel.materialId);
    if (!mat) errors.push(`${panel.name} · material inexistente.`);
    else {
      const err = panelStiffnessError(panel, mat);
      if (err) errors.push(`${panel.name} · ${err}`);
    }
    if (new Set(panel.fixed).size !== panel.fixed.length)
      errors.push(`${panel.name} · engaste repetido na mesma borda.`);
    try {
      panelGeometry(panel);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  for (const pat of p.loadPatterns) {
    const ids = pat.panelActions?.map((a) => a.panelId) ?? [];
    if (
      ids.some((id) => !panels.some((s) => s.id === id)) ||
      new Set(ids).size !== ids.length
    )
      errors.push(
        `${pat.name} · carga de painel duplicada ou sem painel correspondente.`,
      );
  }
  return errors;
}

type PanelGrid = ReturnType<typeof grid>;
function grid(panel: SurfacePanel) {
  const geometry = panelGeometry(panel);
  const { nu, nv } = panel,
    at = (i: number, j: number) => j * (nu + 1) + i;
  const points: Point3[] = [],
    triangles: number[][] = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      points.push(
        add(panel.a, add(scale(geometry.u, i / nu), scale(geometry.v, j / nv))),
      );
      if (i < nu && j < nv)
        triangles.push(
          [at(i, j), at(i + 1, j), at(i + 1, j + 1)],
          [at(i, j), at(i + 1, j + 1), at(i, j + 1)],
        );
    }
  for (const tri of triangles) {
    const [a, b, d] = tri.map((k) => points[k]);
    const area2 = dot(cross(subtract(b, a), subtract(d, a)), geometry.axes[2]);
    if (
      !Number.isFinite(area2) ||
      Math.abs(area2 / (geometry.area / (nu * nv)) - 1) > 1e-5
    )
      throw new Error(
        `${panel.name} · as coordenadas globais não têm precisão suficiente para essa discretização.`,
      );
  }
  const edges: Record<PanelEdge, number[]> = {
    AB: Array.from({ length: nu + 1 }, (_, i) => at(i, 0)),
    BC: Array.from({ length: nv + 1 }, (_, j) => at(nu, j)),
    CD: Array.from({ length: nu + 1 }, (_, i) => at(nu - i, nv)),
    DA: Array.from({ length: nv + 1 }, (_, j) => at(0, nv - j)),
  };
  return { panel, ...geometry, points, triangles, edges };
}

// Both traces of a complete edge have the same global translation and rotation.
function commonEdge(a: PanelGrid, b: PanelGrid) {
  const matches: { left: number[]; right: number[] }[] = [];
  for (const e of panelEdges)
    for (const f of panelEdges) {
      const left = a.edges[e],
        right = b.edges[f],
        from = a.points[left[0]],
        to = a.points[left.at(-1)!];
      const first = b.points[right[0]],
        last = b.points[right.at(-1)!];
      const same =
        distance(from, first) <= tolerance && distance(to, last) <= tolerance;
      const reverse =
        distance(from, last) <= tolerance && distance(to, first) <= tolerance;
      if (!same && !reverse) continue;
      if (left.length !== right.length)
        throw new Error(
          `Borda ${a.panel.name} ${e} / ${b.panel.name} ${f} · use o mesmo número de subdivisões ao longo da borda comum.`,
        );
      if (Math.abs(dot(a.axes[2], b.axes[2])) > 1 - 1e-10) {
        const tangent = unit(subtract(to, from)),
          inward = cross(a.axes[2], tangent);
        const side = (p: PanelGrid) =>
          dot(
            subtract(scale(add(p.corners.A, p.corners.C), 0.5), from),
            inward,
          );
        if (side(a) * side(b) > 0)
          throw new Error(
            "Os painéis coplanares se sobrepõem na mesma face da borda.",
          );
      }
      matches.push({ left, right: reverse ? [...right].reverse() : right });
    }
  if (matches.length !== 1)
    throw new Error(
      "Os dois painéis precisam de uma única borda reta comum, coincidente de ponta a ponta. Contato parcial ou por vértice exige outra discretização física.",
    );
  return matches[0];
}

function orthogonal(directions: Point3[]) {
  const basis: Point3[] = [];
  for (const v of directions) {
    let w = v;
    for (const axis of basis) w = subtract(w, scale(axis, dot(w, axis)));
    if (length(w) > 1e-9) basis.push(unit(w));
  }
  return basis;
}
const complement = (dirs: Point3[]) => {
  const span = orthogonal(dirs);
  return orthogonal([...span, ...globalBasis]).slice(span.length);
};
function activeAxes(g: PanelGrid) {
  const [x, y, z] = g.axes;
  return g.panel.kind === "shell"
    ? { t: globalBasis, r: globalBasis }
    : g.panel.kind === "membrane"
      ? { t: [x, y], r: [z] }
      : { t: [z], r: [x, y] };
}
function checkJointStability(
  grids: PanelGrid[],
  shared: { left: number[]; right: number[] },
) {
  const i = grids.findIndex((g) => !g.panel.fixed.length);
  if (i < 0) return;
  const free = grids[i],
    base = grids[1 - i],
    freeEdge = i === 0 ? shared.left : shared.right,
    baseEdge = i === 0 ? shared.right : shared.left;
  const active = activeAxes(free),
    other = activeAxes(base);
  const intersect = (a: Point3[], b: Point3[]) =>
    complement([...complement(a), ...complement(b)]);
  const t = intersect(active.t, other.t),
    r = intersect(active.r, other.r);
  const fixed = new Set(base.panel.fixed.flatMap((e) => base.edges[e]));
  const a = free.points[freeEdge[0]],
    b = free.points[freeEdge.at(-1)!],
    rows: number[][] = [];
  for (const k of [0, freeEdge.length - 1]) {
    const arm = scale(
      subtract(free.points[freeEdge[k]], a),
      1 / distance(a, b),
    );
    const atSupport = fixed.has(baseEdge[k]);
    for (const v of atSupport ? active.t : t)
      rows.push([
        ...active.t.map((dir) => dot(v, dir)),
        ...active.r.map((dir) => dot(v, cross(dir, arm))),
      ]);
    for (const v of atSupport ? active.r : r)
      rows.push([
        ...active.t.map(() => 0),
        ...active.r.map((dir) => dot(v, dir)),
      ]);
  }
  const modes = active.t.length + active.r.length;
  if (matrixRank(rows, modes) < modes)
    throw new Error(
      `${free.panel.name} · a borda comum deixa movimento de corpo rígido livre. Revise a formulação do painel de apoio ou os engastes.`,
    );
}
function nodalBasis(owners: PanelGrid[]) {
  if (owners.some((p) => p.panel.kind === "shell"))
    return { axes: globalBasis, inactive: [] as number[] };
  const t: Point3[] = [],
    r: Point3[] = [];
  for (const p of owners) {
    const axes = activeAxes(p);
    t.push(...axes.t);
    r.push(...axes.r);
  }
  // Unused translations and unused rotations are mutually orthogonal.
  const tNull = complement(t),
    rNull = complement(r);
  const [x, y] = orthogonal([...tNull, ...rNull, ...globalBasis]);
  const axes: Basis = [x, y, cross(x, y)];
  return {
    axes,
    inactive: [
      ...tNull.map((_, i) => i + 1),
      ...rNull.map((_, i) => 4 + tNull.length + i),
    ],
  };
}

export function panelAssembly(p: Project) {
  if (p.slabs.length || p.nodes.length || p.members.length)
    throw new Error(
      "Analise os painéis espaciais em um projeto sem barras, nós avulsos ou lajes de pavimento. Para o encontro parede–laje, modele ambas como painéis espaciais.",
    );
  const grids = (p.surfacePanels ?? []).map(grid);
  if (!grids.length) throw new Error("Inclua um painel espacial.");
  if (!grids.some((g) => g.panel.fixed.length))
    throw new Error("Engaste pelo menos uma borda do conjunto de painéis.");
  const shared =
    grids.length === 2 ? commonEdge(grids[0], grids[1]) : undefined;
  if (shared) checkJointStability(grids, shared);
  const linked = new Map(shared?.right.map((j, k) => [j, shared.left[k] + 1]));
  const stations: { point: Point3; owners: PanelGrid[]; fixed: boolean }[] = [];
  const panels = grids.map((g, i) => {
    const fixed = new Set(g.panel.fixed.flatMap((e) => g.edges[e]));
    const ids = g.points.map((pt, j) => {
      const other = i === 1 ? linked.get(j) : undefined;
      if (other !== undefined) {
        const n = stations[other - 1];
        n.owners.push(g);
        n.fixed ||= fixed.has(j);
        return other;
      }
      stations.push({ point: pt, owners: [g], fixed: fixed.has(j) });
      return stations.length;
    });
    return { ...g, ids };
  });
  const nodes = stations.map(({ point, owners, fixed }, i) => ({
    ...point,
    number: i + 1,
    fixed,
    ...nodalBasis(owners),
  }));
  const elements = panels.flatMap((g, panel) =>
    g.triangles.map((tri) => ({ panel, nodes: tri.map((i) => g.ids[i]) })),
  );
  return {
    nodes,
    panels,
    elements,
    shared: shared?.left.map((i) => i + 1) ?? [],
  };
}
export type PanelAssembly = ReturnType<typeof panelAssembly>;
