import { createProject } from "../../src/domain/model";
import { addSlab } from "../../src/domain/slab";
import { exportSlabOofem, parseSlabOutput } from "../../src/solver/slab";

export const plateBenchmark = {
  lengthX: 4,
  lengthY: 3,
  thickness: 0.1,
  modulus: 30e9,
  poisson: 0.2,
  pressureZ: -5e3,
} as const;

export function plateProject(nx: number, ny: number) {
  const { lengthX, lengthY, thickness, modulus, poisson, pressureZ } =
    plateBenchmark;
  const project = createProject("spatial");
  addSlab(project, { x: 0, y: 0, z: 0 }, { x: lengthX, y: lengthY, z: 0 }, "G");
  Object.assign(project.slabs[0], { thickness, nx, ny });
  Object.assign(project.materials[0], {
    E: modulus,
    nu: poisson,
    density: 2500,
  });
  project.loadPatterns[0].pressures[0].qz = pressureZ;
  return project;
}

export function makePlateDeck(nx: number, ny: number) {
  return exportSlabOofem(plateProject(nx, ny), "EL");
}

export function readPlateResults(
  output: string,
  input: ReturnType<typeof makePlateDeck>,
) {
  const { rz, center } = parseSlabOutput(output, input);
  return { rz, ...center };
}
