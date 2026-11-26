import type { StructuralNode } from "../domain/model";
import {
  supportBasis,
  supportDofs,
  supportsDof,
  supportToLocal,
} from "../domain/supports";
import type { Displacement, Reaction } from "./oofem";

export const reactionComponents = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
export type ReactionComponent = (typeof reactionComponents)[number];
export type DisplacementComponent = (typeof supportDofs)[number];
export type NodalComponent = ReactionComponent | DisplacementComponent;
export const reactionColumns = {
  planar: ["fx", "fz", "my"],
  spatial: reactionComponents,
} as const;
export const displacementColumns = {
  planar: ["ux", "uz", "ry"],
  spatial: supportDofs,
} as const;

export function localReaction(
  reaction: Omit<Reaction, "nodeId">,
  node: StructuralNode,
  basis = supportBasis(node.supportFrame),
) {
  const f = supportToLocal(
    { x: reaction.fx, y: reaction.fy, z: reaction.fz },
    basis,
  );
  const m = supportToLocal(
    { x: reaction.mx, y: reaction.my, z: reaction.mz },
    basis,
  );
  const local = { fx: f.x, fy: f.y, fz: f.z, mx: m.x, my: m.y, mz: m.z };
  // A free support axis carries exactly zero reaction; projection can leave roundoff.
  if (!node.foundation)
    for (const [i, dof] of supportDofs.entries())
      if (!supportsDof(node, dof)) local[reactionComponents[i]] = 0;
  return local;
}

export function localDisplacement(
  d: Displacement,
  basis: ReturnType<typeof supportBasis>,
) {
  const u = supportToLocal({ x: d.ux, y: d.uy, z: d.uz }, basis);
  const r = supportToLocal({ x: d.rx, y: d.ry, z: d.rz }, basis);
  return { ux: u.x, uy: u.y, uz: u.z, rx: r.x, ry: r.y, rz: r.z };
}
