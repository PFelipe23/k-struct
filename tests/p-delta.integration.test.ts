import { describe, expect, it } from "vitest";
import {
  pDeltaCases,
  pDeltaTolerance,
  solvePDelta,
} from "../src/solver/pDelta";
import {
  benchmarkOptions,
  pDeltaColumn,
  pDeltaPortal,
} from "./fixtures/p-delta";
import { runDeck } from "./fixtures/solve-oofem";

const executable = process.env.OOFEM_BIN;
const execute: Parameters<typeof solvePDelta>[2] = async ({ deck }) =>
  runDeck(deck, executable!);

it("recusa padrões ativos repetidos e peso próprio repetido sob outro ID", () => {
  const project = pDeltaColumn();
  project.analysisCases[1].factors.push({ patternId: "G", factor: 0.5 });
  expect(() => pDeltaCases(project, benchmarkOptions)).toThrow(/mesmo padrão/);
  project.analysisCases[1].factors.pop();
  project.loadPatterns[1].selfWeight = {
    ...project.loadPatterns[1].selfWeight,
    enabled: true,
  };
  expect(() => pDeltaCases(project, benchmarkOptions)).toThrow(/peso próprio/);
});

describe.skipIf(!executable)("KS-61 · P–Δ com OOFEM 3.0", () => {
  it("obtém 10 mm e 12,5 mm, mantém 600 kN e fecha o corpo livre", async () => {
    const result = await solvePDelta(pDeltaColumn(), benchmarkOptions, execute);
    expect(result.stop).toBeNull();
    const last = result.lastConverged!;
    expect(result.firstOrder.displacements.B.ux).toBeCloseTo(0.01, 8);
    expect(last.result.displacements.B.ux).toBeCloseTo(0.0125, 8);
    expect(
      last.result.displacements.B.ux / result.firstOrder.displacements.B.ux,
    ).toBeCloseTo(1.25, 6);
    expect(result.axial.every((e) => e.n === -600_000)).toBe(true);
    expect(last.residual).toBeLessThanOrEqual(pDeltaTolerance);
    expect(last.geometricMoment.y).toBeCloseTo(600_000 * 0.0125, 2);
    expect(last.result.reactions[0].fz).toBe(600_000);
    expect(last.result.reactions[0].fx).toBeCloseTo(2500, 0);
    expect(last.result.reactions[1].fx).toBeCloseTo(-12_500, 1);
    expect(last.result.members.column.at(-1)?.m).toBeCloseTo(0, 4);
  });

  it("recupera a resposta linear inteira sem força axial", async () => {
    const result = await solvePDelta(
      pDeltaColumn(0),
      benchmarkOptions,
      execute,
    );
    expect(result.stop).toBeNull();
    const last = result.lastConverged!;
    expect(last.iterations).toBe(1);
    expect(last.result.displacements).toEqual(result.firstOrder.displacements);
    expect(last.result.reactions).toEqual(result.firstOrder.reactions);
    expect(last.result.members).toEqual(result.firstOrder.members);
  });

  it("preserva o último passo aceito após esgotar as iterações na perda de rigidez", async () => {
    const result = await solvePDelta(
      pDeltaColumn(3_000_000),
      { ...benchmarkOptions, maxIterations: 4 },
      execute,
    );
    expect(result.stop).toMatchObject({ stage: { step: 1, iteration: 4 } });
    expect(result.stop?.reason).toMatch(/Limite de iterações/);
    expect(result.lastConverged).toMatchObject({ step: 0, fraction: 0 });
    expect(result.lastConverged?.result.displacements.B.ux).toBeCloseTo(0, 12);
  });

  it("descarta a resposta se for cancelada durante uma chamada ao motor", async () => {
    const abort = new AbortController();
    await expect(
      solvePDelta(
        pDeltaColumn(),
        benchmarkOptions,
        async (input, stage) => {
          const output = await execute(input, stage);
          abort.abort();
          return output;
        },
        abort.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("converge com refinamento no pórtico e preserva o resultado ao subdividir a ação", async () => {
    const project = pDeltaPortal();
    const values: number[] = [];
    for (const segments of [2, 8, 16]) {
      project.mesh.segmentsPerMember = segments;
      const result = await solvePDelta(project, benchmarkOptions, execute);
      expect(result.stop).toBeNull();
      values.push(result.lastConverged!.result.displacements.B.ux);
    }
    // Same portal, independent Euler–Bernoulli with consistent geometric stiffness.
    const independent = 0.000082001681;
    expect(Math.abs(values[2] - independent)).toBeLessThan(5e-10);
    expect(Math.abs(values[2] - values[1])).toBeLessThan(
      Math.abs(values[1] - values[0]),
    );
    const stepped = await solvePDelta(
      project,
      { ...benchmarkOptions, steps: 3 },
      execute,
    );
    expect(stepped.stop).toBeNull();
    expect(stepped.steps.map(({ fraction }) => fraction)).toEqual([
      0,
      1 / 3,
      2 / 3,
      1,
    ]);
    expect(stepped.lastConverged?.result.displacements.B.ux).toBeCloseTo(
      values[2],
      9,
    );
  });

  it("amplifica as duas direções transversais do Beam3d", async () => {
    const project = pDeltaColumn();
    project.mode = "spatial";
    Object.assign(project.nodes[0].restraints, { uy: true, rz: true });
    project.nodes[1].springs!.uy = 2e6;
    project.loadPatterns[1].nodal[0].fy = 10_000;
    const result = await solvePDelta(project, benchmarkOptions, execute);
    expect(result.stop).toBeNull();
    expect(result.lastConverged?.result.displacements.B.ux).toBeCloseTo(
      0.0125,
      8,
    );
    expect(result.lastConverged?.result.displacements.B.uy).toBeCloseTo(
      10_000 / 1.8e6,
      8,
    );
  });
});
