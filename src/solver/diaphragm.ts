import {
  coordinates,
  cross,
  dot,
  origin,
  subtract,
  type Point3,
} from "../domain/geometry";
import { supportBasis } from "../domain/supports";
import type { Project } from "../domain/model";
import type { MeshNode } from "./oofem";

type Term = [node: number, dof: number, weight: number];
function equation(terms: Term[]) {
  // Express the compatibility residual in µm or µrad in the mixed force/displacement
  // system. Scaling both sides of this exact equality preserves the reactions.
  const nonzero = terms
    .filter(([, , w]) => w !== 0)
    .map(([n, k, w]): Term => [n, k, w * 1e6]);
  if (nonzero.some(([, , w]) => !Number.isFinite(w)))
    throw new Error("Braço do diafragma fora do intervalo numérico.");
  const list = (col: 0 | 1 | 2) =>
    `${nonzero.length} ${nonzero.map((t) => t[col]).join(" ")}`;
  return `loadTimeFunction 1 dofmans ${list(0)} dofs ${list(1)} weights ${list(2)} rhs 0 lhstype 4 1 2 3 4 rhstype 2 150 151`;
}

export function floorConstraints(
  project: Project,
  nodes: MeshNode[],
  modelNodes: Map<string, MeshNode>,
  rigidMasters: Map<string, string>,
  addBoundary: (
    type: "BoundaryCondition" | "LinearConstraintBC",
    fields: string,
  ) => void,
  setNode: (number: number) => number,
) {
  const records = new Map<number, string>();
  let multipliers = false;
  const joints = new Map(project.nodes.map((n) => [n.id, n]));
  const rigidZone = new Set([...rigidMasters.keys(), ...rigidMasters.values()]);
  for (const floor of project.diaphragms ?? []) {
    const level = project.guides.z.find((l) => l.id === floor.levelId)!;
    const ref = {
      ...floor.reference,
      z: level.position,
      number: nodes.length + 1,
    };
    nodes.push(ref);
    records.set(
      ref.number,
      `Node ${ref.number} coords 3 ${ref.x} ${ref.y} ${ref.z} dofidmask 6 1 2 3 4 5 6`,
    );
    addBoundary(
      "BoundaryCondition",
      `loadTimeFunction 1 dofs 3 3 4 5 values 3 0 0 0 set ${setNode(ref.number)}`,
    );
    for (const id of floor.nodeIds) {
      const joint = joints.get(id)!,
        physical = modelNodes.get(id)!;
      physical.diaphragm = ref.number;
      const anchorId = rigidMasters.get(id) ?? id;
      const anchor = joints.get(anchorId)!,
        number = modelNodes.get(anchorId)!.number;
      const ordinary = !joint.supportFrame && !rigidZone.has(id);
      const keys = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
      if (ordinary) {
        const tied = keys.map(
          (key, i) => (i === 0 || i === 1 || i === 5) && !joint.restraints[key],
        );
        const mask = (kind: number) =>
          `6 ${tied.map((on) => (on ? kind : 0)).join(" ")}`;
        records.set(
          physical.number,
          `RigidArmNode ${physical.number} coords 3 ${joint.x} ${joint.y} ${joint.z} master ${ref.number} dofidmask 6 1 2 3 4 5 6 mastermask ${mask(1)} doftype ${mask(2)}`,
        );
      }
      const basis = supportBasis(anchor.supportFrame);
      const arm = subtract(joint, anchor);
      for (const k of [0, 1, 5] as const) {
        if (ordinary && !joint.restraints[keys[k]]) continue;
        // Project global UX, UY or RZ onto the actual independent support basis.
        // An offset secondary gets its motion from the primary joint at 'anchor'.
        const rotation = k === 5;
        const axis: Point3 = { ...origin, [coordinates[k % 3]]: 1 };
        const lever = rotation ? axis : cross(arm, axis);
        const terms: Term[] = [];
        coordinates.forEach((c, i) => {
          if (!rotation) terms.push([number, i + 1, dot(axis, basis[c])]);
          terms.push([number, i + 4, dot(lever, basis[c])]);
        });
        terms.push([ref.number, k + 1, -1]);
        if (k === 0) terms.push([ref.number, 6, joint.y - ref.y]);
        if (k === 1) terms.push([ref.number, 6, ref.x - joint.x]);
        addBoundary("LinearConstraintBC", equation(terms));
        multipliers = true;
      }
    }
  }
  return { records, multipliers };
}
