import { beamExample, nodalLoad } from "../../src/domain/model";
export function diagramEnvelope() {
  const p = beamExample();
  p.mesh.segmentsPerMember = 3;
  p.loadPatterns.push({
    ...structuredClone(p.loadPatterns[0]),
    id: "PAR",
    name: "Par de momentos",
    uniform: [],
    nodal: [
      { ...nodalLoad("A"), my: 42000 },
      { ...nodalLoad("B"), my: -42000, fx: 5000 },
    ],
  });
  p.analysisCases.push({
    id: "CP",
    name: "Momentos nas pontas",
    type: "linear-static",
    factors: [{ patternId: "PAR", factor: 1 }],
  });
  p.resultCombinations = p.analysisCases.map((c) => ({
    id: `C-${c.id}`,
    name: c.name,
    type: "linear",
    factors: [{ caseId: c.id, factor: 1 }],
  }));
  p.resultEnvelopes = [
    {
      id: "E",
      name: "Momento de cálculo",
      combinationIds: p.resultCombinations.map((c) => c.id),
    },
  ];
  return p;
}
