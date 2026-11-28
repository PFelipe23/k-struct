import { readFileSync } from "node:fs";
import { parseProject } from "../../src/domain/model";

function example(file: string) {
  return parseProject(
    readFileSync(
      new URL(`../../examples/p-delta-${file}.kstruct.json`, import.meta.url),
      "utf8",
    ),
  );
}

export const benchmarkOptions = {
  gravityId: "gravity",
  lateralId: "lateral",
  steps: 1,
  maxIterations: 30,
};

export function pDeltaColumn(compression = 600_000) {
  const project = example("coluna");
  project.loadPatterns[0].nodal[0].fz = -compression;
  return project;
}

export function pDeltaPortal() {
  return example("portico");
}
