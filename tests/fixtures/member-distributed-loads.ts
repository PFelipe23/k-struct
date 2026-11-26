import { beamExample } from "../../src/domain/model";
import type { DistributedLoad } from "../../src/domain/memberDistributedLoads";

export function distributedBeam(startZ = 0, endZ = -6000) {
  const p = beamExample();
  p.loadPatterns[0].uniform = [];
  const load: DistributedLoad = {
    id: "D1",
    memberId: "V1",
    measure: "distance",
    system: "global",
    start: 2,
    end: 5,
    qStart: { x: 0, y: 0, z: startZ },
    qEnd: { x: 0, y: 0, z: endZ },
  };
  p.loadPatterns[0].distributed = [load];
  return p;
}
