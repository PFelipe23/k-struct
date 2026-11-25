import { beamExample, free, nodalLoad } from "../../src/domain/model";

export function internalJointBeam() {
  const p = beamExample();
  p.nodes.push({ id: "C", name: "N3", x: 2, y: 0, z: 0, restraints: free() });
  p.loadPatterns[0].uniform = [];
  p.loadPatterns[0].nodal = [{ ...nodalLoad("C"), fz: -9000 }];
  p.meshConnections = [{ memberId: "V1", nodeId: "C" }];
  p.resultCombinations = [
    {
      id: "POS",
      name: "Direta",
      type: "linear",
      factors: [{ caseId: "EL", factor: 1 }],
    },
    {
      id: "NEG",
      name: "Invertida",
      type: "linear",
      factors: [{ caseId: "EL", factor: -1 }],
    },
  ];
  p.resultEnvelopes = [
    { id: "ENV", name: "Envoltória V", combinationIds: ["POS", "NEG"] },
  ];
  return p;
}
