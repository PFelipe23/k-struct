import { twoSpanBeam } from "./two-span-beam";

export function settlementBeam() {
  const p = twoSpanBeam();
  p.nodes[1].x = 4;
  p.nodes[2].x = 8;
  // Each support can be edited independently.
  p.nodes[2].restraints = { ...p.nodes[2].restraints };
  Object.assign(p.sections[0], { width: 0.3, height: 0.4 });
  p.materials[0].E = 18.75e9;
  p.loadPatterns[0].uniform = [];
  p.loadPatterns[0].prescribed = [{ nodeId: "B", dof: "uz", value: -0.004 }];
  return p;
}
