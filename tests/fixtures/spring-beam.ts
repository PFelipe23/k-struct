import { beamExample, nodalLoad } from "../../src/domain/model";

export function springBenchmark() {
  const p = beamExample();
  p.nodes.push({
    ...p.nodes[1],
    id: "C",
    name: "Meio",
    x: 3,
    restraints: { ...p.nodes[1].restraints, uz: false },
  });
  p.meshConnections = [{ memberId: "V1", nodeId: "C" }];
  p.loadPatterns[0].uniform = [];
  p.loadPatterns[0].nodal = [{ ...nodalLoad("C"), fz: -20000 }];
  return p;
}
