import { beamMeshLayout, rigidGroups } from "./beamMesh";
import {
  coordinates,
  cross,
  distance,
  scale,
  subtract,
  tolerance,
  type Point3,
} from "./geometry";
import { foundationConstraintRows } from "./foundation";
import { supportBasis, supportsDof } from "./supports";
import type { Project, StructuralNode } from "./model";

export function remapDiaphragmNodes(
  project: Project,
  replacements: ReadonlyMap<string, string[]>,
) {
  if (!project.diaphragms || !replacements.size) return;
  for (const floor of project.diaphragms)
    floor.nodeIds = [
      ...new Set(floor.nodeIds.flatMap((id) => replacements.get(id) ?? [id])),
    ];
  project.diaphragms = project.diaphragms.filter(
    (floor) => floor.nodeIds.length >= 2,
  );
  if (!project.diaphragms.length) delete project.diaphragms;
}

// Incremental elimination keeps each independent frame or floor in a small block.
// Coordinates of rotations are scaled by a physical span before testing rank.
class ConstraintBasis {
  private pivots = new Map<number, Map<number, number>>();
  get rank() {
    return this.pivots.size;
  }

  add(terms: [number, number][]) {
    const row = new Map<number, number>();
    const norm = Math.max(...terms.map(([, v]) => Math.abs(v)), 0);
    if (!norm) return false;
    for (const [k, v] of terms) row.set(k, (row.get(k) ?? 0) + v / norm);
    for (;;) {
      let pivot = Infinity;
      for (const [k, v] of row) {
        if (Math.abs(v) <= 1e-10) row.delete(k);
        else pivot = Math.min(pivot, k);
      }
      if (!Number.isFinite(pivot)) return false;
      const factor = row.get(pivot)!;
      const previous = this.pivots.get(pivot);
      if (!previous) {
        for (const [k, v] of row) row.set(k, v / factor);
        this.pivots.set(pivot, row);
        return true;
      }
      for (const [k, v] of previous) row.set(k, (row.get(k) ?? 0) - factor * v);
      row.delete(pivot);
    }
  }
}
const indexed = (first: number, values: number[]): [number, number][] =>
  values.map((v, k) => [first + k, v]);

type Term = [column: number, weight: number];

function supportRows(n: StructuralNode, first: number, r: Point3) {
  const axes = supportBasis(n.supportFrame);
  return coordinates.flatMap((k) => {
    const a = axes[k],
      b = cross(r, a);
    return [
      {
        dof: `u${k}` as const,
        terms: indexed(first, [a.x, a.y, a.z, b.x, b.y, b.z]),
      },
      { dof: `r${k}` as const, terms: indexed(first + 3, [a.x, a.y, a.z]) },
    ];
  });
}
function planeRows(
  body: number,
  r: Point3,
  floor: number,
  dx: number,
  dy: number,
): Term[][] {
  return [
    [
      [body, 1],
      [body + 4, r.z],
      [body + 5, -r.y],
      [floor, -1],
      [floor + 2, dy],
    ],
    [
      [body + 1, 1],
      [body + 3, -r.z],
      [body + 5, r.x],
      [floor + 1, -1],
      [floor + 2, -dx],
    ],
    [
      [body + 5, 1],
      [floor + 2, -1],
    ],
  ];
}

export function diaphragmErrors(project: Project) {
  const floors = project.diaphragms ?? [];
  const errors: string[] = [];
  if (project.mode !== "spatial")
    errors.push("O diafragma de pavimento exige um projeto espacial XYZ.");
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const owner = new Map<string, string>(),
    names = new Set<string>();
  for (const floor of floors) {
    const level = project.guides.z.find((l) => l.id === floor.levelId);
    if (!level) errors.push(`${floor.name}: pavimento inexistente.`);
    const key = JSON.stringify([
      floor.levelId,
      floor.name.trim().toLocaleLowerCase("pt-BR"),
    ]);
    if (!floor.name.trim() || names.has(key))
      errors.push("Informe um nome único para o diafragma no pavimento.");
    names.add(key);
    for (const id of floor.nodeIds) {
      const n = nodes.get(id);
      if (!n) {
        errors.push(`${floor.name}: nó ${id} inexistente.`);
        continue;
      }
      if (owner.has(id))
        errors.push(
          `${n.name}: participação repetida em diafragma (${owner.get(id)} / ${floor.name}).`,
        );
      owner.set(id, floor.name);
      if (level && Math.abs(n.z - level.position) >= tolerance)
        errors.push(
          `${floor.name}: ${n.name} precisa permanecer no plano do pavimento ${level.name}.`,
        );
      if (
        !Number.isFinite(n.x - floor.reference.x) ||
        !Number.isFinite(n.y - floor.reference.y)
      )
        errors.push(`${floor.name}: referência fora do intervalo numérico.`);
    }
    if (new Set(floor.nodeIds).size < 2)
      errors.push(`${floor.name}: selecione pelo menos dois nós distintos.`);
  }
  if (errors.length || !floors.length) return errors;
  const zones =
    project.meshConnections.length && project.members.some((m) => m.offsets)
      ? rigidGroups(beamMeshLayout(project).rigidLinks, project.nodes)
      : new Map<string, string>();
  const anchor = (id: string) => zones.get(id) ?? id;
  const bodyIds = [...new Set([...owner.keys()].map(anchor))];
  const column = new Map(bodyIds.map((id, i) => [id, 6 * i]));
  const physical = project.nodes.filter((n) => column.has(anchor(n.id)));
  const span = Math.max(
    tolerance,
    ...physical.map((n) => distance(n, nodes.get(anchor(n.id))!)),
    ...floors.flatMap((f) =>
      f.nodeIds.map((id) => distance(nodes.get(id)!, nodes.get(f.nodeIds[0])!)),
    ),
  );
  const basis = new ConstraintBasis();
  // Each independent node or rigid end zone retains six motions. Assemble the
  // exact floor constraints first, then detect indeterminate prescribed reactions.
  for (const [i, floor] of floors.entries()) {
    const first = nodes.get(floor.nodeIds[0])!;
    for (const id of floor.nodeIds) {
      const n = nodes.get(id)!,
        body = anchor(id);
      const r = scale(subtract(n, nodes.get(body)!), 1 / span);
      const rows = planeRows(
        column.get(body)!,
        r,
        6 * bodyIds.length + i * 3,
        (n.x - first.x) / span,
        (n.y - first.y) / span,
      );
      if (rows.some((row) => !basis.add(row))) {
        errors.push(
          `${floor.name}: vínculo redundante em ${n.name}. Verifique os participantes de outros diafragmas e os trechos rígidos.`,
        );
        return errors;
      }
    }
  }
  for (const n of physical) {
    const body = anchor(n.id);
    const r = scale(subtract(n, nodes.get(body)!), 1 / span);
    for (const { dof, terms } of supportRows(n, column.get(body)!, r)) {
      if (n.restraints[dof] && !basis.add(terms))
        errors.push(
          `Diafragma: apoio ${dof.toUpperCase()} em ${n.name} redundante. As reações individuais são indeterminadas.`,
        );
    }
  }
  return errors;
}

// A diaphragm connects only three motions. For a stability check each connected
// beam component may move as a rigid body, including vertical and tilting modes.
export function diaphragmStability(
  project: Project,
  bodies: StructuralNode[][],
) {
  const floors = project.diaphragms!;
  const floorByNode = new Map(
    floors.flatMap((f, i) => f.nodeIds.map((id) => [id, i] as const)),
  );
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const span = Math.max(
    1,
    ...bodies.flatMap((b) => b.map((n) => distance(n, b[0]))),
    ...floors.flatMap((f) =>
      f.nodeIds.map((id) => distance(nodes.get(id)!, nodes.get(f.nodeIds[0])!)),
    ),
  );
  const basis = new ConstraintBasis();
  const dimensions = 6 * bodies.length + 3 * floors.length;
  bodies.forEach((body, i) => {
    for (const n of body) {
      const r = scale(subtract(n, body[0]), 1 / span);
      for (const { dof, terms } of supportRows(n, 6 * i, r))
        if (supportsDof(n, dof)) basis.add(terms);
      for (const row of foundationConstraintRows(n, r, span))
        basis.add(indexed(6 * i, row));
      const f = floorByNode.get(n.id);
      if (f === undefined) continue;
      const first = nodes.get(floors[f].nodeIds[0])!;
      for (const row of planeRows(
        6 * i,
        r,
        6 * bodies.length + 3 * f,
        (n.x - first.x) / span,
        (n.y - first.y) / span,
      ))
        basis.add(row);
    }
  });
  return basis.rank === dimensions
    ? []
    : [
        "Apoios insuficientes na estrutura com diafragma. Verifique os movimentos do piso e as liberdades fora do plano de cada componente.",
      ];
}
