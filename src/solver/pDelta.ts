import {
  add,
  cross,
  dot,
  length,
  origin,
  scale,
  subtract,
  type Point3,
} from "../domain/geometry";
import type { AnalysisCase, Project } from "../domain/model";
import {
  exportOofem,
  parseOofemOutput,
  type AnalysisInput,
  type AnalysisResult,
  type Displacement,
} from "./oofem";

export const pDeltaTolerance = 1e-7;
const forceFloor = 1e-6; // N

type Factors = AnalysisCase["factors"];
export interface PDeltaOptions {
  gravityId: string;
  lateralId: string;
  steps: number;
  maxIterations: number;
}

export interface PDeltaStage {
  label: string;
  step: number;
  iteration: number;
}

interface Step {
  step: number;
  fraction: number;
  iterations: number;
  residual: number;
}

interface Converged extends Step {
  result: AnalysisResult;
  geometricMoment: Point3;
  axialChange: number;
}

export interface PDeltaResult {
  firstOrder: AnalysisResult;
  axial: { memberId: string; t0: number; t1: number; n: number }[];
  gravity: Factors;
  lateral: Factors;
  steps: Step[];
  lastConverged: Converged | null;
  stop: { stage: PDeltaStage; reason: string } | null;
}

function effectiveFactors(factors: Factors) {
  const totals = new Map<string, number>();
  for (const { patternId, factor } of factors)
    totals.set(patternId, (totals.get(patternId) ?? 0) + factor);
  return [...totals]
    .filter(([, factor]) => factor !== 0)
    .map(([patternId, factor]) => ({ patternId, factor }));
}

export function pDeltaCases(project: Project, options: PDeltaOptions) {
  const gravity = project.analysisCases.find(
    ({ id }) => id === options.gravityId,
  );
  const lateral = project.analysisCases.find(
    ({ id }) => id === options.lateralId,
  );
  if (!gravity || !lateral || gravity.id === lateral.id)
    throw new Error(
      "Selecione casos distintos para a pré-carga e o incremento lateral.",
    );
  const sustained = effectiveFactors(gravity.factors);
  const increment = effectiveFactors(lateral.factors);
  if (!increment.length)
    throw new Error(
      "O caso lateral precisa de um padrão com fator diferente de zero.",
    );
  const gravityPatterns = new Set(sustained.map(({ patternId }) => patternId));
  if (increment.some(({ patternId }) => gravityPatterns.has(patternId)))
    throw new Error(
      "Um mesmo padrão tem fator ativo nos dois casos. Separe as cargas permanentes do incremento lateral.",
    );
  const patterns = new Map(
    project.loadPatterns.map((pattern) => [pattern.id, pattern]),
  );
  const weighs = ({ patternId }: Factors[number]) => {
    const weight = patterns.get(patternId)?.selfWeight;
    return weight?.enabled && weight.multiplier !== 0;
  };
  if (sustained.filter(weighs).length > 1 || increment.some(weighs))
    throw new Error(
      "Atribua o peso próprio a um único padrão ativo da pré-carga e retire-o do incremento lateral.",
    );
  return { gravity, lateral, sustained, increment };
}

export function pDeltaModelError(p: Project) {
  if (!p.members.length || p.slabs.length || p.surfacePanels?.length)
    return "A análise P–Δ requer um modelo de barras Beam2d ou Beam3d.";
  if (
    p.diaphragms?.length ||
    p.nodes.some((node) => node.foundation) ||
    p.members.some(
      ({ offsets, connectionI, connectionJ }) =>
        offsets ||
        [connectionI, connectionJ].some(
          (connection) =>
            connection &&
            Object.values(connection).some(({ kind }) => kind !== "rigid"),
        ),
    )
  )
    return "Nesta análise P–Δ, use barras sem offsets ou liberações de extremidade e apoios nodais rígidos ou elásticos, sem fundações acopladas nem diafragmas.";
  return "";
}

const translation = ({ ux, uy, uz }: Displacement): Point3 => ({
  x: ux,
  y: uy,
  z: uz,
});

export async function solvePDelta(
  project: Project,
  options: PDeltaOptions,
  execute: (input: AnalysisInput, stage: PDeltaStage) => Promise<string>,
  signal?: AbortSignal,
): Promise<PDeltaResult> {
  const modelError = pDeltaModelError(project);
  if (modelError) throw new Error(modelError);
  const { gravity, lateral, sustained, increment } = pDeltaCases(
    project,
    options,
  );
  const { steps, maxIterations } = options;
  if (
    !Number.isInteger(steps) ||
    steps < 1 ||
    steps > 10 ||
    !Number.isInteger(maxIterations) ||
    maxIterations < 1 ||
    maxIterations > 50
  )
    throw new Error(
      "Use entre 1 e 10 passos laterais e entre 1 e 50 iterações por passo.",
    );

  const solve = async (input: AnalysisInput, stage: PDeltaStage) => {
    signal?.throwIfAborted();
    const output = await execute(input, stage);
    signal?.throwIfAborted();
    const state: {
      mesh?: {
        displacements: ReadonlyMap<number, Displacement>;
        axial: ReadonlyMap<number, number>;
      };
    } = {};
    const result = parseOofemOutput(output, input, (displacements, axial) => {
      state.mesh = { displacements, axial };
    });
    if (!state.mesh)
      throw new Error("A saída do OOFEM não contém o estado das barras.");
    return { result, mesh: state.mesh };
  };

  const gravityFactors = sustained.length
    ? sustained
    : [{ patternId: gravity.factors[0].patternId, factor: 0 }];
  const preloadInput = exportOofem(project, gravity.id, {
    factors: gravityFactors,
  });
  const preload = await solve(preloadInput, {
    step: 0,
    iteration: 0,
    label: "P–Δ · Pré-carga linear",
  });
  const factorsAt = (fraction: number) =>
    fraction === 0
      ? gravityFactors
      : [
          ...sustained,
          ...increment.map(({ patternId, factor }) => ({
            patternId,
            factor: fraction * factor,
          })),
        ];
  const firstOrder = await solve(
    exportOofem(project, lateral.id, { factors: factorsAt(1) }),
    {
      step: steps,
      iteration: 0,
      label: "P–Δ · Primeira ordem com pré-carga + 100% lateral",
    },
  );
  const { nodes, elements } = preloadInput;
  const axial = elements.map(({ number, memberId, t0, t1 }) => ({
    memberId,
    t0,
    t1,
    n: preload.mesh.axial.get(number)!,
  }));
  const axes = elements.map(({ start, end }, index) => {
    const axis = subtract(nodes[end - 1], nodes[start - 1]);
    const span = length(axis);
    return {
      start,
      end,
      unit: scale(axis, 1 / span),
      stiffness: axial[index].n / span,
    };
  });
  // Apply -Kg·u as equal-and-opposite transverse nodal forces. The elastic
  // equilibrium solved by OOFEM then has K·u = F - Kg·u at convergence.
  const forcesAt = (displacements: ReadonlyMap<number, Displacement>) => {
    const forces = new Map<number, Point3>();
    const accumulate = (node: number, force: Point3) =>
      forces.set(node, add(forces.get(node) ?? origin, force));
    for (const { start, end, unit, stiffness } of axes) {
      if (!stiffness) continue;
      const relative = subtract(
        translation(displacements.get(end)!),
        translation(displacements.get(start)!),
      );
      const transverse = subtract(relative, scale(unit, dot(relative, unit)));
      const force = scale(transverse, stiffness);
      accumulate(start, force);
      accumulate(end, scale(force, -1));
    }
    for (const [node, force] of forces) {
      if (!Number.isFinite(length(force)))
        throw new Error("Forças geométricas fora do intervalo numérico.");
      if (!length(force)) forces.delete(node);
    }
    return forces;
  };

  const response: PDeltaResult = {
    firstOrder: firstOrder.result,
    gravity: sustained,
    lateral: increment,
    axial,
    steps: [],
    lastConverged: null,
    stop: null,
  };
  let stage: PDeltaStage = {
    step: 0,
    iteration: 0,
    label: "Verificação da pré-carga",
  };
  try {
    let applied = new Map<number, Point3>();
    for (let step = 0; step <= steps; step++) {
      const fraction = step / steps;
      const label = step
        ? `P–Δ · lateral ${step}/${steps}`
        : "P–Δ · pré-carga mantida";
      let residual = Infinity;
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        stage = { label, step, iteration };
        const current =
          applied.size === 0 && step === 0
            ? preload
            : applied.size === 0 && step === steps
              ? firstOrder
              : await solve(
                  exportOofem(project, lateral.id, {
                    factors: factorsAt(fraction),
                    equivalentForces: applied,
                  }),
                  stage,
                );
        const next = forcesAt(current.mesh.displacements);
        let difference = 0;
        let magnitude = 0;
        for (const number of new Set([...applied.keys(), ...next.keys()])) {
          const actual = applied.get(number) ?? origin;
          const expected = next.get(number) ?? origin;
          difference = Math.max(difference, length(subtract(actual, expected)));
          magnitude = Math.max(magnitude, length(actual), length(expected));
        }
        residual =
          difference / Math.max(magnitude, forceFloor / pDeltaTolerance);
        if (residual <= pDeltaTolerance) {
          const record = { step, fraction, iterations: iteration, residual };
          let geometricMoment = origin;
          for (const [number, force] of applied)
            geometricMoment = add(
              geometricMoment,
              cross(subtract(nodes[number - 1], nodes[0]), force),
            );
          let axialChange = 0;
          for (const [index, element] of elements.entries())
            axialChange = Math.max(
              axialChange,
              Math.abs(
                current.mesh.axial.get(element.number)! - axial[index].n,
              ),
            );
          response.steps.push(record);
          response.lastConverged = {
            ...record,
            result: current.result,
            geometricMoment,
            axialChange,
          };
          break;
        }
        applied = next;
      }
      if (response.lastConverged?.step !== step) {
        response.stop = {
          stage,
          reason: `Limite de iterações atingido (resíduo ${residual.toExponential(3)}). Verifique estabilidade e magnitude da pré-carga.`,
        };
        break;
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    response.stop = {
      stage,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return response;
}
