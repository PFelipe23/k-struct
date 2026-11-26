import { beamExample } from "../../src/domain/model";
import type { MemberPointLoad } from "../../src/domain/memberPointLoads";

export function pointLoadBeam(kind: MemberPointLoad["kind"] = "force") {
  const p = beamExample();
  p.loadPatterns[0].uniform = [];
  p.loadPatterns[0].points = [
    {
      id: "P1",
      memberId: "V1",
      kind,
      system: "global",
      position: { kind: "distance", value: 2 },
      components:
        kind === "force" ? { x: 0, y: 0, z: -12000 } : { x: 0, y: 6000, z: 0 },
    },
  ];
  return p;
}
