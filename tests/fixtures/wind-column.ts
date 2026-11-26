import { beamExample, free } from "../../src/domain/model";
import type { WindStrip } from "../../src/domain/wind";

export const facade: WindStrip = {
  id: "W1",
  name: "Fachada",
  bottomId: "A",
  topId: "B",
  width: 4,
  from: 0,
  to: 1,
  pressure: 800,
  coefficient: 1.25,
  angle: 0,
};
export function windColumn() {
  const p = beamExample();
  Object.assign(p.nodes[0], {
    restraints: { ...free(), ux: true, uz: true, ry: true },
  });
  Object.assign(p.nodes[1], { x: 0, z: 3, restraints: free() });
  p.loadPatterns[0].uniform = [];
  return p;
}
