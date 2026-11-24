import { addSlab } from "../../src/domain/editing";
import { createProject } from "../../src/domain/model";

export const slabBenchmark = {
  lengthX: 4,
  lengthY: 3,
  thickness: 0.1,
  E: 30e9,
  nu: 0.2,
  pressureZ: -5000,
  refinements: [
    [8, 6],
    [16, 12],
    [32, 24],
  ] as const,
};

export function slabBenchmarkProject() {
  const project = createProject("spatial");
  const { lengthX, lengthY, thickness, E, nu, pressureZ } = slabBenchmark;
  const slab = addSlab(
    project,
    "level1",
    { x: 0, y: 0, z: 3 },
    { x: lengthX, y: lengthY, z: 3 },
  );
  slab.formulation = "dkt";
  slab.thickness = thickness;
  Object.assign(project.materials.find(({ id }) => id === slab.materialId)!, {
    E,
    nu,
  });
  project.loadPatterns[0].pressure = [{ slabId: slab.id, pz: pressureZ }];
  return project;
}

// Navier's double sine series for a thin, simply supported plate, in SI.
// At the center only odd terms contribute and the sines alternate +/-1.
export function navierSlabCenter() {
  const { lengthX, lengthY, E, nu, thickness, pressureZ } = slabBenchmark;
  const rigidity = (E * thickness ** 3) / (12 * (1 - nu ** 2));
  const center = { uz: 0, mx: 0, my: 0 };
  for (let m = 1; m <= 201; m += 2) {
    const alpha = (m * Math.PI) / lengthX;
    for (let n = 1; n <= 201; n += 2) {
      const beta = (n * Math.PI) / lengthY;
      const sign = (m + n) % 4 === 2 ? 1 : -1;
      const q = (16 * pressureZ) / (Math.PI ** 2 * m * n);
      const w = (sign * q) / (rigidity * (alpha ** 2 + beta ** 2) ** 2);
      center.uz += w;
      center.mx -= rigidity * (alpha ** 2 + nu * beta ** 2) * w;
      center.my -= rigidity * (beta ** 2 + nu * alpha ** 2) * w;
    }
  }
  return center;
}
