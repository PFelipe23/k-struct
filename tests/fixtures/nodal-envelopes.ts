import { beamExample, type ResultCombination } from "../../src/domain/model";
import { spatialBenchmark } from "./spatial-benchmark";

export function planarNodalEnvelope() {
  const p = beamExample();
  p.resultCombinations = [1, -2].map((factor, i) => ({
    id: i === 0 ? "A" : "B",
    name: i === 0 ? "Positiva" : "Invertida",
    type: "linear",
    factors: [{ caseId: "EL", factor }],
  }));
  p.resultEnvelopes = [
    { id: "E", name: "Apoios e nós", combinationIds: ["A", "B"] },
  ];
  return p;
}

export const obliqueFrame = {
  kind: "spatial" as const,
  x: { x: 3, y: 4, z: 0 },
  y: { x: -4, y: 3, z: 0 },
};

export function spatialNodalEnvelope() {
  const p = spatialBenchmark();
  p.nodes.find(({ id }) => id === "N7")!.supportFrame = obliqueFrame;
  const distributed = p.loadPatterns[0];
  const lateral = {
    ...structuredClone(distributed),
    id: "W",
    name: "Carga na cobertura",
    uniform: [],
  };
  distributed.nodal = [];
  p.loadPatterns.push(lateral);
  p.analysisCases = [distributed, lateral].map(({ id, name }) => ({
    id,
    name,
    type: "linear-static",
    factors: [{ patternId: id, factor: 1 }],
  }));
  const combo = (id: string, g: number, w: number): ResultCombination => ({
    id,
    name: `Combinação ${id}`,
    type: "linear",
    factors: [
      { caseId: "G", factor: g },
      { caseId: "W", factor: w },
    ],
  });
  p.resultCombinations = [combo("A", 1.2, 0.8), combo("B", 0.7, -1.1)];
  p.resultEnvelopes = [
    { id: "E", name: "Pórtico XYZ", combinationIds: ["A", "B"] },
  ];
  return p;
}
