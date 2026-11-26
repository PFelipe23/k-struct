import {
  coordinates,
  cross,
  dot,
  origin,
  subtract,
  type Point3,
} from "../domain/geometry";
import type { Member, Project } from "../domain/model";
import { foundationConstraintRows } from "../domain/foundation";
import { hasSpring, supportBasis, supportDofs } from "../domain/supports";
import { constraintEquation } from "./diaphragm";
import type { MeshElement, MeshNode } from "./oofem";

const inner = (a: number[], b: number[]) =>
  a.reduce((sum, v, i) => sum + v * b[i], 0);
function remainder(row: number[], basis: number[][]) {
  const out = row.slice();
  for (const unit of basis) {
    const coeff = inner(out, unit);
    for (let i = 0; i < out.length; i++) out[i] -= coeff * unit[i];
  }
  return out;
}

export function checkMemberFreedom(
  member: Member,
  spatial: boolean,
  hasInteriorJoint: boolean,
) {
  if (hasInteriorJoint || (!member.connectionI && !member.connectionJ)) return;
  const indices = spatial ? [0, 1, 2, 3, 4, 5] : [0, 2, 4],
    basis: number[][] = [];
  for (const [end, connection] of [
    member.connectionI,
    member.connectionJ,
  ].entries()) {
    for (const d of indices) {
      if (connection?.[supportDofs[d]].kind === "free") continue;
      const row = [0, 0, 0, 0, 0, 0];
      row[d] = 1;
      // Scale rotations by the span. At j, θ × (L,0,0) adds Lθz to uy and −Lθy to uz.
      if (end && d === 1) row[5] = 1;
      if (end && d === 2) row[4] = -1;
      const residual = remainder(
          indices.map((i) => row[i]),
          basis,
        ),
        len = Math.hypot(...residual);
      if (len > 1e-10) basis.push(residual.map((v) => v / len));
    }
  }
  if (basis.length < indices.length)
    throw new Error(
      `Mecanismo na barra ${member.name} [${member.id}]: as ligações nas pontas i e j permitem movimento de corpo rígido.`,
    );
}

export function connectionFreedom(
  project: Project,
  nodes: MeshNode[],
  elements: MeshElement[],
  loads: Map<number, number[]>,
  set: (nodes: string) => number,
  conditions: string[],
) {
  const active = project.mode === "spatial" ? [0, 1, 2, 3, 4, 5] : [0, 2, 4];
  const root = (n: MeshNode) => {
    while (n.master) n = nodes[n.master - 1];
    return n;
  };
  const candidates = new Map<number, number[][]>();
  for (const n of nodes)
    if (n.connection?.transmitted.includes(false))
      candidates.set(root(n).number, []);
  if (!candidates.size) return false;
  const physical = new Map(project.nodes.map((n) => [n.id, n]));
  const global = supportBasis();
  const six = (a: Point3, b: Point3) => [a.x, a.y, a.z, b.x, b.y, b.z];
  const rowAt = (n: MeshNode, axis: Point3, rot: boolean) =>
    six(rot ? origin : axis, rot ? axis : cross(subtract(n, root(n)), axis));
  function addRow(n: MeshNode, row: number[]) {
    const basis = candidates.get(root(n).number);
    if (!basis || basis.length === active.length) return;
    const reduced = active.map((i) => row[i]),
      magnitude = Math.hypot(...reduced);
    if (!magnitude) return;
    const res = remainder(
        reduced.map((v) => v / magnitude),
        basis,
      ),
      len = Math.hypot(...res);
    if (len > 1e-10) basis.push(res.map((v) => v / len));
  }
  for (const element of elements)
    for (const number of [element.start, element.end]) {
      const n = nodes[number - 1],
        c = n.connection;
      const axes = c?.basis ?? global;
      active.forEach((d, i) => {
        if (!c || c.transmitted[i])
          addRow(n, rowAt(n, axes[coordinates[d % 3]], d >= 3));
      });
    }
  const generalized = new Map<number, number[]>();
  for (const n of nodes) {
    const master = root(n);
    if (!candidates.has(master.number)) continue;
    const joint = n.objectId ? physical.get(n.objectId) : undefined;
    if (joint) {
      const local = supportBasis(joint.supportFrame);
      for (const d of active) {
        const key = supportDofs[d];
        if (joint.restraints[key] || hasSpring(joint, key))
          addRow(n, rowAt(n, local[coordinates[d % 3]], d >= 3));
      }
      for (const row of foundationConstraintRows(joint, subtract(n, master), 1))
        addRow(n, row);
      if (n.diaphragm)
        for (const d of [0, 1, 5])
          addRow(n, rowAt(n, global[coordinates[d % 3]], d >= 3));
    }
    // Loads on a beam-end copy act on the element side of the release.
    const values = loads.get(n.number);
    if (!values || n.connection) continue;
    const force = generalized.get(master.number) ?? active.map(() => 0);
    active.forEach((component, i) => {
      const row = rowAt(n, global[coordinates[component % 3]], component >= 3);
      active.forEach((d, k) => {
        force[k] += values[i] * row[d];
      });
    });
    generalized.set(master.number, force);
  }
  let multipliers = false;
  for (const [number, basis] of candidates) {
    if (basis.length === active.length) continue;
    const node = physical.get(nodes[number - 1].objectId!)!;
    const local = supportBasis(node.supportFrame),
      force = generalized.get(number) ?? active.map(() => 0);
    for (let k = 0; k < active.length; k++) {
      // Use the orthogonal complement of the directions that can transfer work.
      const res = remainder(
          active.map((_, i) => Number(i === k)),
          basis,
        ),
        len = Math.hypot(...res);
      if (len < 1e-10) continue;
      const normal = res.map((v) => v / len);
      basis.push(normal);
      const full = [0, 0, 0, 0, 0, 0];
      active.forEach((d, i) => {
        full[d] = normal[i];
      });
      const weights = active.map((d) =>
        dot(local[coordinates[d % 3]], {
          x: full[d < 3 ? 0 : 3],
          y: full[d < 3 ? 1 : 4],
          z: full[d < 3 ? 2 : 5],
        }),
      );
      const terms = active.flatMap((d, i): [number, number, number][] =>
        Math.abs(weights[i]) > 1e-12 ? [[number, d + 1, weights[i]]] : [],
      );
      if (
        Math.abs(inner(normal, force)) >
        64 *
          Number.EPSILON *
          force.reduce((sum, v, i) => sum + Math.abs(normal[i] * v), 0)
      ) {
        const members = project.members
          .filter((m) => m.start === node.id || m.end === node.id)
          .map((m) => m.id);
        throw new Error(
          `Mecanismo no nó ${node.name} [${node.id}], ligação de ${members.join(", ")}: carga efetiva em ${terms.map((t) => supportDofs[t[1] - 1].toUpperCase()).join("/")} sem rigidez no caso analisado.`,
        );
      }
      // Fix only the unloaded, disconnected motion. Supports keep their physical reactions.
      const id = conditions.length + 1;
      if (terms.length === 1)
        conditions.push(
          `BoundaryCondition ${id} loadTimeFunction 1 dofs 1 ${terms[0][1]} values 1 0 set ${set(`nodes 1 ${number}`)}`,
        );
      else {
        multipliers = true;
        conditions.push(
          `LinearConstraintBC ${id} ${constraintEquation(terms)}`,
        );
      }
    }
  }
  return multipliers;
}
