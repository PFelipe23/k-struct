import { beamExample, uniformLoad, type Project } from "../../src/domain/model";
import {
  userFamily,
  type FamilyProfile,
} from "../../src/domain/combinationFamilies";

export function familyBeam() {
  const p = beamExample();
  const base = p.loadPatterns[0];
  const cases = ["G", "Q1", "Q2"];
  p.loadPatterns = cases.map((id, i) => ({
    ...structuredClone(base),
    id: "P" + id,
    name: "Padrão " + id,
    uniform: [{ ...uniformLoad("V1"), qz: -1000 * [1, 2, 4][i] }],
  }));
  p.analysisCases = cases.map((id) => ({
    id,
    name: id,
    type: "linear-static",
    factors: [{ patternId: "P" + id, factor: 1 }],
  }));
  p.resultCombinations = [
    {
      id: "MAN",
      name: "Manual",
      type: "linear",
      factors: [{ caseId: "G", factor: 0.85 }],
    },
  ];
  p.resultEnvelopes = [
    { id: "ENV", name: "Envelope", combinationIds: ["MAN"] },
  ];
  return p;
}

// Coeficientes ilustrativos definidos pelo usuário para o ensaio.
export function testProfile(p: Project): FamilyProfile {
  return {
    actions: p.analysisCases.map((c) => ({
      caseId: c.id,
      role: c.id === "G" ? "permanent" : "variable",
      group: "",
    })),
    families: [
      {
        ...userFamily("ELU", "ELU"),
        source: "Perfil ilustrativo do ensaio",
        permanent: 1.2,
        leading: 1.5,
        accompanying: 0.75,
      },
      {
        ...userFamily("ELS", "ELS"),
        source: "Perfil ilustrativo do ensaio",
        permanent: 1,
        leading: 1,
        accompanying: 0.3,
      },
    ],
  };
}
