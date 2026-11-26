import {
  coordinates,
  cross,
  dot,
  subtract,
  type Point3,
} from "../domain/geometry";
import { supportBasis, supportDofs } from "../domain/supports";
import type { Project, StructuralNode } from "../domain/model";

// Each independently prescribed DOF on a secondary joint keeps its own
// boundary condition and reaction. Tie it to the same rigid motion.
export function rigidJointEquations(
  master: StructuralNode,
  joint: StructuralNode,
  masterNumber: number,
  jointNumber: number,
  mode: Project["mode"],
  independent: number[][],
) {
  const m = supportBasis(master.supportFrame),
    j = supportBasis(joint.supportFrame);
  const arm = subtract(joint, master);
  const active = mode === "spatial" ? [0, 1, 2, 3, 4, 5] : [0, 2, 4];
  const equations: string[] = [];
  for (const dof of active) {
    const key = supportDofs[dof];
    if (!joint.restraints[key]) continue;
    const axis = j[coordinates[dof % 3]];
    const rotation = dof >= 3;
    const lever: Point3 = cross(arm, axis);
    const terms = [{ node: jointNumber, dof, weight: 1 }];
    for (const k of active) {
      if (rotation && k < 3) continue;
      const weight = -dot(
        !rotation && k >= 3 ? lever : axis,
        m[coordinates[k % 3]],
      );
      if (weight !== 0) terms.push({ node: masterNumber, dof: k, weight });
    }
    // Dependent prescribed motions on one perfectly rigid body have no unique
    // reaction split. Check independence in the remaining master DOFs.
    const row = active.map((k) =>
      master.restraints[supportDofs[k]]
        ? 0
        : (terms.find((t) => t.node === masterNumber && t.dof === k)?.weight ??
          0),
    );
    const fullNorm = Math.hypot(
      ...terms.filter((t) => t.node === masterNumber).map((t) => t.weight),
    );
    for (const v of independent) {
      const projection = v.reduce((sum, vk, k) => sum + vk * row[k], 0);
      v.forEach((vk, k) => {
        row[k] -= projection * vk;
      });
    }
    const remaining = Math.hypot(...row);
    if (remaining <= 1e-10 * fullNorm) {
      throw new Error(
        `Vínculo ${key.toUpperCase()} em ${joint.name} redundante no trecho rígido ligado a ${master.name}. As reações individuais são indeterminadas.`,
      );
    }
    independent.push(row.map((v) => v / remaining));
    const count = terms.length;
    const list = (values: number[]) => `${count} ${values.join(" ")}`;
    equations.push(
      `loadTimeFunction 1 dofmans ${list(terms.map((t) => t.node))} dofs ${list(terms.map((t) => t.dof + 1))} weights ${list(terms.map((t) => t.weight))} rhs 0 lhstype 4 1 2 3 4 rhstype 2 150 151`,
    );
  }
  return equations;
}
