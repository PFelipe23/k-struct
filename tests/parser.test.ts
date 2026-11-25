import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { beamExample, type ResultCombination } from "../src/domain/model";
import { combineLinearResults } from "../src/solver/combinations";
import { internalJointBeam } from "./fixtures/internal-joint";
import { evaluateMemberEnvelope } from "../src/solver/envelopes";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";

const output = readFileSync(
  new URL("./fixtures/beam-oofem.txt", import.meta.url),
  "utf8",
);
it("mantém referência executável do parser para ambientes sem OOFEM", () => {
  const result = parseOofemOutput(output, exportOofem(beamExample(), "EL"));
  expect(result.members.V1[4].m).toBeCloseTo(45000, 1);
  expect(result.members.V1[4].uz).toBeCloseTo(-0.0084375, 8);
});
it("rejeita reação adulterada que viola o equilíbrio", () => {
  const changed = output.replace(
    /(iDof\s+3\s+reaction\s+)3\.0000e\+04/,
    "$140000",
  );
  expect(changed).not.toBe(output);
  expect(() =>
    parseOofemOutput(changed, exportOofem(beamExample(), "EL")),
  ).toThrow(/equilíbrio/);
});
it("rejeita saída sem esforços de um elemento", () => {
  expect(() =>
    parseOofemOutput(
      output.replace("beam element 1", "missing element 1"),
      exportOofem(beamExample(), "EL"),
    ),
  ).toThrow(/Esforços ausentes/);
});

it("superpõe casos por identidade, ignora fatores nulos e recusa estações incompatíveis", () => {
  const project = beamExample();
  for (const id of ["Q", "W"])
    project.analysisCases.push({ ...project.analysisCases[0], id, name: id });
  const combination: ResultCombination = {
    id: "C1",
    name: "Combinação 1",
    type: "linear",
    factors: [
      { caseId: "EL", factor: 1.5 },
      { caseId: "Q", factor: -0.75 },
      { caseId: "W", factor: 0 },
    ],
  };
  const first = parseOofemOutput(output, exportOofem(project, "EL"));
  const second = parseOofemOutput(output, exportOofem(project, "Q"));
  second.reactions.reverse();
  const results = new Map([["EL", first]]);
  expect(() => combineLinearResults(project, combination, results)).toThrow(
    /pendentes.*\nQ$/,
  );
  results.set("Q", second);
  const combined = combineLinearResults(project, combination, results);
  expect(combined.reactions.map(({ nodeId, fz }) => [nodeId, fz])).toEqual([
    ["A", 22500],
    ["B", 22500],
  ]);
  expect(combined.members.V1[4].m).toBe(33750);
  expect(combined.members.V1[4].uz).toBeCloseTo(-0.006328125, 10);
  second.members.V1[4].t = 0.51;
  expect(() => combineLinearResults(project, combination, results)).toThrow(
    /estações de malha incompatíveis/,
  );
  second.members.V1[4].t = 0.5;
  combination.factors[0].factor = 1e308;
  expect(() => combineLinearResults(project, combination, results)).toThrow(
    /intervalo numérico/,
  );
});

it("remonta os dois lados no mesmo ID e retém o governante de cada lado na malha irregular", async () => {
  const p = internalJointBeam();
  const raw = readFileSync(
    new URL("./fixtures/internal-joint-oofem.txt", import.meta.url),
    "utf8",
  );
  const result = parseOofemOutput(raw, exportOofem(p, "EL"));
  const cases = new Map([["EL", result]]);
  const sides = result.members.V1.filter((s) => s.t === 1 / 3);
  expect(sides.map((s) => [s.side, s.v, s.m])).toEqual([
    ["left", 6000, 12000],
    ["right", -3000, 12000],
  ]);
  const reversed = combineLinearResults(p, p.resultCombinations[1], cases);
  expect(
    reversed.members.V1.filter((s) => s.t === 1 / 3).map((s) => [s.side, s.v]),
  ).toEqual([
    ["left", -6000],
    ["right", 3000],
  ]);
  const env = await evaluateMemberEnvelope(p, p.resultEnvelopes[0], cases);
  const entries = env.V1.filter((s) => s.t === 1 / 3);
  expect(
    entries.map((s) => [
      s.side,
      s.ranges.v.max.combinationId,
      s.ranges.v.max.forces.m,
    ]),
  ).toEqual([
    ["left", "POS", 12000],
    ["right", "NEG", -12000],
  ]);
  sides[1].side = "left";
  expect(() => combineLinearResults(p, p.resultCombinations[0], cases)).toThrow(
    /estações de malha incompatíveis/,
  );
  await expect(
    evaluateMemberEnvelope(p, p.resultEnvelopes[0], cases),
  ).rejects.toThrow(/estações de malha incompatíveis/);
});
