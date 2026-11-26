import { beamStations, type SectionLocation } from "../domain/beamMesh";
import type {
  Project,
  ResultCombination,
  ResultEnvelope,
} from "../domain/model";
import { hasSupport, supportBasis, supportDofs } from "../domain/supports";
import {
  localReaction,
  localDisplacement,
  reactionComponents,
  type ReactionComponent,
  type DisplacementComponent,
} from "./nodalResults";
import {
  memberForceComponents,
  prepareMemberForces,
  prepareNodalCombination,
  weightedCases,
  requireAvailableCases,
  type MemberForceComponent,
  type MemberForces,
} from "./combinations";
import type { AnalysisResult } from "./oofem";

export type EnvelopeExtreme = { combinationId: string; forces: MemberForces };
type ForceRange = { min: EnvelopeExtreme; max: EnvelopeExtreme };
export type EnvelopeStation = SectionLocation & {
  ranges: Record<MemberForceComponent, ForceRange>;
};
export type MemberEnvelopeResult = Record<string, EnvelopeStation[]>;
export type EnvelopeSection = { memberId: string; index: number };

export function envelopeCombinations(
  project: Project,
  envelope: ResultEnvelope,
) {
  const combinations = envelope.combinationIds.map((id) => {
    const combination = project.resultCombinations.find(
      (item) => item.id === id,
    );
    if (!combination)
      throw new Error("O envelope referencia uma combinação inexistente.");
    return combination;
  });
  if (!combinations.length)
    throw new Error("Inclua uma combinação no envelope.");
  return combinations;
}

export async function evaluateMemberEnvelope(
  project: Project,
  envelope: ResultEnvelope,
  caseResults: ReadonlyMap<string, AnalysisResult>,
  signal?: AbortSignal,
): Promise<MemberEnvelopeResult> {
  signal?.throwIfAborted();
  const combinations = envelopeCombinations(project, envelope);
  requireAvailableCases(
    project,
    combinations.flatMap((item) => item.factors),
    caseResults,
  );
  const layout = beamStations(project);
  const sources = combinations.map((item) => ({
    id: item.id,
    memberForces: prepareMemberForces(project, item, caseResults, layout),
  }));

  const result: MemberEnvelopeResult = {};
  let nextYield = performance.now() + 12;
  for (const { id } of project.members) {
    const stations: EnvelopeStation[] = [];
    for (const combination of sources) {
      // Every bound retains the full vector of a single combination at this station.
      for (const [index, { t, side, ...forces }] of combination
        .memberForces(id)
        .entries()) {
        const extreme = { combinationId: combination.id, forces };
        const station = stations[index];
        if (!station) {
          const ranges = Object.fromEntries(
            memberForceComponents.map((key) => [
              key,
              { min: extreme, max: extreme },
            ]),
          ) as EnvelopeStation["ranges"];
          stations.push({ t, ...(side && { side }), ranges });
          continue;
        }
        for (const key of memberForceComponents) {
          const range = station.ranges[key];
          if (forces[key] < range.min.forces[key]) range.min = extreme;
          if (forces[key] > range.max.forces[key]) range.max = extreme;
        }
      }
      if (signal && performance.now() >= nextYield) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal.throwIfAborted();
        nextYield = performance.now() + 12;
      }
    }
    result[id] = stations;
  }
  return result;
}

export type NodalFrame = "global" | "local";
type NodalSource = Pick<ResultCombination, "id" | "name" | "type"> & {
  factors: { caseId: string; name: string; factor: number }[];
};
type NodalExtreme<K extends string> = {
  source: NodalSource;
  vector: Record<K, number>;
  frame: NodalFrame;
};
type NodalRanges<K extends string> = Record<
  K,
  { min: NodalExtreme<K>; max: NodalExtreme<K> }
>;
export type NodeEnvelope<K extends string> = {
  global: NodalRanges<K>;
  local?: NodalRanges<K>;
};
export type NodalEnvelopeResult = {
  reactions: Map<string, NodeEnvelope<ReactionComponent>>;
  displacements: Map<string, NodeEnvelope<DisplacementComponent>>;
};

function compareVector<K extends string>(
  keys: readonly K[],
  previous: NodalRanges<K> | undefined,
  candidate: NodalExtreme<K>,
): NodalRanges<K> {
  if (keys.some((key) => !Number.isFinite(candidate.vector[key])))
    throw new Error(
      "O vetor nodal contém componentes não finitas no referencial consultado.",
    );
  if (!previous)
    return Object.fromEntries(
      keys.map((key) => [key, { min: candidate, max: candidate }]),
    ) as NodalRanges<K>;
  for (const key of keys) {
    const range = previous[key];
    if (candidate.vector[key] < range.min.vector[key]) range.min = candidate;
    if (candidate.vector[key] > range.max.vector[key]) range.max = candidate;
  }
  return previous;
}

function includeNode<K extends string>(
  nodes: Map<string, NodeEnvelope<K>>,
  id: string,
  keys: readonly K[],
  source: NodalSource,
  global: Record<K, number>,
  local?: Record<K, number>,
) {
  const previous = nodes.get(id);
  nodes.set(id, {
    global: compareVector(keys, previous?.global, {
      source,
      vector: global,
      frame: "global",
    }),
    ...(local && {
      local: compareVector(keys, previous?.local, {
        source,
        vector: local,
        frame: "local",
      }),
    }),
  });
}

export async function evaluateEnvelope(
  project: Project,
  envelope: ResultEnvelope,
  caseResults: ReadonlyMap<string, AnalysisResult>,
  signal?: AbortSignal,
) {
  const members = await evaluateMemberEnvelope(
    project,
    envelope,
    caseResults,
    signal,
  );
  signal?.throwIfAborted();
  const nodal: NodalEnvelopeResult = {
    reactions: new Map(),
    displacements: new Map(),
  };
  const caseNames = new Map(
    project.analysisCases.map(({ id, name }) => [id, name]),
  );
  const nodes = project.nodes.map((node) => ({
    node,
    supported: hasSupport(node),
    basis: node.supportFrame ? supportBasis(node.supportFrame) : undefined,
  }));
  let nextYield = performance.now() + 12;
  for (const combination of envelopeCombinations(project, envelope)) {
    const values = prepareNodalCombination(
      project,
      weightedCases(project, combination, caseResults),
    );
    const source: NodalSource = {
      id: combination.id,
      name: combination.name,
      type: combination.type,
      factors: combination.factors.map(({ caseId, factor }) => {
        const name = caseNames.get(caseId);
        if (name === undefined)
          throw new Error(
            "A combinação referencia um caso inexistente nesta revisão.",
          );
        return { caseId, name, factor };
      }),
    };
    for (const { node, supported, basis } of nodes) {
      const d = values.displacement(node.id);
      includeNode(
        nodal.displacements,
        node.id,
        supportDofs,
        source,
        d,
        basis && localDisplacement(d, basis),
      );
      if (supported) {
        const r = values.reaction(node.id);
        includeNode(
          nodal.reactions,
          node.id,
          reactionComponents,
          source,
          r,
          basis && localReaction(r, node, basis),
        );
      }
      if (signal && performance.now() >= nextYield) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal.throwIfAborted();
        nextYield = performance.now() + 12;
      }
    }
  }
  return { members, nodal };
}

export type EnvelopeResult = Awaited<ReturnType<typeof evaluateEnvelope>>;
