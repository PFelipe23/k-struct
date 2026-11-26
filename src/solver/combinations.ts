import {
  beamStations,
  sectionLocations,
  type BeamStation,
} from "../domain/beamMesh";
import type { Project, ResultCombination } from "../domain/model";
import {
  hasSupport,
  supportDofs as displacementComponents,
} from "../domain/supports";
import { reactionComponents } from "./nodalResults";
import type { AnalysisResult, Station, StructuralResult } from "./oofem";

export const memberForceComponents = [
  "n",
  "v",
  "m",
  "vy",
  "vz",
  "mx",
  "my",
  "mz",
] as const;
export type MemberForceComponent = (typeof memberForceComponents)[number];
export type MemberForces = Pick<Station, MemberForceComponent>;
const stationComponents = [
  ...displacementComponents,
  ...memberForceComponents,
] as const;

type WeightedCase = {
  factor: number;
  result: AnalysisResult;
};

function sumComponents<K extends string, C extends WeightedCase>(
  components: readonly K[],
  cases: readonly C[],
  values: (term: C) => Record<K, number> | undefined,
): Record<K, number> {
  const total = Object.fromEntries(components.map((key) => [key, 0])) as Record<
    K,
    number
  >;
  for (const term of cases) {
    const value = values(term);
    if (!value)
      throw new Error(
        "Os resultados dos casos têm nós, apoios ou estações de malha incompatíveis.",
      );
    for (const key of components) {
      total[key] += term.factor * value[key];
      if (!Number.isFinite(total[key]))
        throw new Error(
          "A combinação gera valores fora do intervalo numérico.",
        );
    }
  }
  return total;
}

export function requiredCaseIds(
  factors: readonly ResultCombination["factors"][number][],
) {
  return new Set(
    factors.filter(({ factor }) => factor !== 0).map(({ caseId }) => caseId),
  );
}

export function requireAvailableCases(
  project: Project,
  factors: readonly ResultCombination["factors"][number][],
  caseResults: ReadonlyMap<string, AnalysisResult>,
): void {
  const pending = new Set(
    [...requiredCaseIds(factors)].filter(
      (id) => caseResults.get(id)?.caseId !== id,
    ),
  );
  if (pending.size) {
    const caseNames = new Map(
      project.analysisCases.map(({ id, name }) => [id, name]),
    );
    const names = [...pending].map((caseId) => caseNames.get(caseId) ?? caseId);
    throw new Error(
      `Analise os casos pendentes nesta revisão.\n${names.join(", ")}`,
    );
  }
}

export function weightedCases(
  project: Project,
  combination: ResultCombination,
  caseResults: ReadonlyMap<string, AnalysisResult>,
) {
  if (project.slabs.length)
    throw new Error("Consulte os resultados da laje por caso estático.");
  const terms = combination.factors.filter((term) => term.factor !== 0);
  if (!terms.length)
    throw new Error("Informe pelo menos um fator diferente de zero.");
  requireAvailableCases(project, terms, caseResults);
  return terms.map(({ caseId, factor }) => ({
    factor,
    result: caseResults.get(caseId)!,
  }));
}

function sumStations<K extends (typeof stationComponents)[number]>(
  components: readonly K[],
  cases: WeightedCase[],
  layout: Map<string, BeamStation[]>,
  memberId: string,
) {
  const expected = sectionLocations(layout.get(memberId)!);
  return expected.map((location, index) => {
    const values = sumComponents(components, cases, ({ result }) => {
      const stations = result.members[memberId];
      if (
        stations?.length === expected.length &&
        stations[index]?.t === location.t &&
        stations[index]?.side === location.side
      )
        return stations[index];
    });
    return { ...location, ...values };
  });
}

export function prepareMemberForces(
  project: Project,
  combination: ResultCombination,
  caseResults: ReadonlyMap<string, AnalysisResult>,
  layout: Map<string, BeamStation[]>,
) {
  const cases = weightedCases(project, combination, caseResults);
  return (memberId: string) =>
    sumStations(memberForceComponents, cases, layout, memberId);
}

export function prepareNodalCombination(
  project: Project,
  cases: WeightedCase[],
) {
  const supportCount = project.nodes.filter(hasSupport).length;
  const indexed = cases.map((term) => {
    const reactions = new Map(
      term.result.reactions.map((item) => [item.nodeId, item]),
    );
    if (
      reactions.size !== supportCount ||
      reactions.size !== term.result.reactions.length ||
      Object.keys(term.result.displacements).length !== project.nodes.length
    )
      throw new Error(
        "Os nós ou apoios do resultado são incompatíveis com esta revisão.",
      );
    return { ...term, reactions };
  });
  return {
    displacement: (id: string) =>
      sumComponents(
        displacementComponents,
        indexed,
        ({ result }) => result.displacements[id],
      ),
    reaction: (id: string) =>
      sumComponents(reactionComponents, indexed, ({ reactions }) =>
        reactions.get(id),
      ),
  };
}

// The caller supplies parsed linear-static results from the current model revision.
export function combineLinearResults(
  project: Project,
  combination: ResultCombination,
  caseResults: ReadonlyMap<string, AnalysisResult>,
): StructuralResult {
  const cases = weightedCases(project, combination, caseResults);
  const nodal = prepareNodalCombination(project, cases);
  const displacements = Object.fromEntries(
    project.nodes.map(({ id }) => [id, nodal.displacement(id)]),
  );
  const reactions = project.nodes
    .filter(hasSupport)
    .map(({ id }) => ({ nodeId: id, ...nodal.reaction(id) }));
  const layout = beamStations(project);
  const members = Object.fromEntries(
    project.members.map(({ id }) => [
      id,
      sumStations(stationComponents, cases, layout, id),
    ]),
  );
  return { displacements, reactions, members };
}
