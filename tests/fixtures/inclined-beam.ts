import { beamExample } from "../../src/domain/model";

export const rollerAngle = (Math.atan2(-0.6, 0.8) * 180) / Math.PI;

export function inclinedBeam() {
  const p = beamExample();
  p.nodes[1].supportFrame = { kind: "planar", angle: rollerAngle };
  return p;
}
