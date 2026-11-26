import {
  add,
  coordinates,
  cross,
  dot,
  length,
  origin,
  scale,
  type Point3,
} from "./geometry";
import type { StructuralNode } from "./model";

export type SupportFrame =
  | { kind: "planar"; angle: number }
  | { kind: "spatial"; x: Point3; y: Point3 };

export const supportDofs = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
export type SupportDof = (typeof supportDofs)[number];

export function hasSpring(node: StructuralNode, dof: SupportDof) {
  return (node.springs?.[dof] ?? 0) > 0;
}

export function hasElasticSupport(node: StructuralNode) {
  return supportDofs.some((dof) => hasSpring(node, dof));
}

export function supportsDof(node: StructuralNode, dof: SupportDof) {
  return node.restraints[dof] || hasSpring(node, dof);
}

export function hasSupport(node: StructuralNode) {
  return supportDofs.some((dof) => supportsDof(node, dof));
}

export function setSpring(
  node: StructuralNode,
  dof: SupportDof,
  stiffness: number,
) {
  if (!Number.isFinite(stiffness) || stiffness < 0)
    throw new Error("Informe uma rigidez finita e não negativa.");
  node.restraints[dof] = false;
  if (stiffness > 0) {
    (node.springs ??= {})[dof] = stiffness;
  } else if (node.springs) {
    delete node.springs[dof];
    if (supportDofs.every((key) => !node.springs?.[key])) delete node.springs;
  }
}

export function setRigidSupport(
  node: StructuralNode,
  dof: SupportDof,
  fixed: boolean,
) {
  setSpring(node, dof, 0);
  node.restraints[dof] = fixed;
}

export function combineSupport(
  target: StructuralNode,
  source: Pick<StructuralNode, "restraints" | "springs">,
) {
  for (const dof of supportDofs) {
    if (target.restraints[dof] || source.restraints[dof]) {
      setRigidSupport(target, dof, true);
      continue;
    }
    const stiffness =
      (target.springs?.[dof] ?? 0) + (source.springs?.[dof] ?? 0);
    if (!Number.isFinite(stiffness))
      throw new Error(
        `${target.name}: soma de rigidez fora do intervalo numérico.`,
      );
    setSpring(target, dof, stiffness);
  }
}

export function restrainedDofs(restraints: Record<SupportDof, boolean>) {
  return supportDofs.filter((key) => restraints[key]);
}

type SupportBasis = Record<keyof Point3, Point3>;
const globalBasis: SupportBasis = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

function unitDirection(v: Point3): Point3 {
  const largest = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
  if (!largest || !Number.isFinite(largest))
    throw new Error("Informe direções finitas e não nulas.");
  const bounded = { x: v.x / largest, y: v.y / largest, z: v.z / largest };
  return scale(bounded, 1 / length(bounded));
}

export function supportBasis(frame?: SupportFrame): SupportBasis {
  if (!frame) return globalBasis;
  if (frame.kind === "planar") {
    const rad = ((frame.angle % 360) * Math.PI) / 180;
    const cos = Math.cos(rad),
      sin = Math.sin(rad);
    return {
      x: { x: cos, y: 0, z: sin },
      y: globalBasis.y,
      z: { x: -sin, y: 0, z: cos },
    };
  }
  const x = unitDirection(frame.x);
  const perpendicular = cross(x, unitDirection(frame.y));
  if (length(perpendicular) < 1e-8)
    throw new Error("As direções de x e y não podem ser colineares.");
  const z = unitDirection(perpendicular);
  return { x, y: cross(z, x), z };
}

export function supportToGlobal(vector: Point3, basis: SupportBasis) {
  return coordinates.reduce(
    (global, axis) => add(global, scale(basis[axis], vector[axis])),
    origin,
  );
}

export function supportToLocal(vector: Point3, basis: SupportBasis): Point3 {
  return {
    x: dot(basis.x, vector),
    y: dot(basis.y, vector),
    z: dot(basis.z, vector),
  };
}

export function sameSupportAxes(a?: SupportFrame, b?: SupportFrame) {
  const A = supportBasis(a),
    B = supportBasis(b);
  return coordinates.every((key) => length(cross(A[key], B[key])) < 1e-10);
}
