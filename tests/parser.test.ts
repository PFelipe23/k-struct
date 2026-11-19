import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { beamExample } from "../src/domain/model";
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
