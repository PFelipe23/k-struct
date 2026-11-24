import type { Point3 } from "./geometry";
import { nextName, uid, type Project, type Slab } from "./model";

export function addSlab(
  project: Project,
  first: Point3,
  last: Point3,
  patternId: string,
) {
  if (project.slabs.length || project.mode !== "spatial")
    throw new Error("Lance uma única laje retangular em um projeto espacial.");
  const lengthX = Math.abs(first.x - last.x);
  const lengthY = Math.abs(first.y - last.y);
  if (lengthX === 0 || lengthY === 0)
    throw new Error(
      "Marque dois cantos opostos para definir a largura e o comprimento.",
    );
  const slab: Slab = {
    id: uid(),
    name: nextName("L", project.slabs),
    materialId: project.materials[0].id,
    x: Math.min(first.x, last.x),
    y: Math.min(first.y, last.y),
    z: first.z,
    lengthX,
    lengthY,
    thickness: 0.1,
    nx: 8,
    ny: 6,
    supports: { xMin: true, xMax: true, yMin: true, yMax: true },
  };
  project.slabs.push(slab);
  const pattern = project.loadPatterns.find(({ id }) => id === patternId)!;
  pattern.pressures.push({ slabId: slab.id, qz: 0 });
  return slab.id;
}

export function slabCorners({ x, y, z, lengthX, lengthY }: Slab): Point3[] {
  return [
    { x, y, z },
    { x: x + lengthX, y, z },
    { x: x + lengthX, y: y + lengthY, z },
    { x, y: y + lengthY, z },
  ];
}

export function meshSlab({ id, lengthX, lengthY, nx, ny }: Slab) {
  // The solver uses coordinates relative to the lower-left corner of the panel.
  const nodeNumber = (i: number, j: number) => 1 + j * (nx + 1) + i;
  const nodes = [];
  const cells = [];
  const edges = {
    xMin: [] as number[],
    xMax: [] as number[],
    yMin: [] as number[],
    yMax: [] as number[],
  };
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const number = nodeNumber(i, j);
      nodes.push({ number, x: (i / nx) * lengthX, y: (j / ny) * lengthY });
      if (i === 0) edges.xMin.push(number);
      if (i === nx) edges.xMax.push(number);
      if (j === 0) edges.yMin.push(number);
      if (j === ny) edges.yMax.push(number);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // QDKT corner order: (+1,+1), (-1,+1), (-1,-1), (+1,-1).
      const vertices = [
        nodeNumber(i + 1, j + 1),
        nodeNumber(i, j + 1),
        nodeNumber(i, j),
        nodeNumber(i + 1, j),
      ] as const;
      cells.push({ number: cells.length + 1, slabId: id, i, j, vertices });
    }
  }
  return {
    nodes,
    cells,
    edges,
    nx,
    ny,
    lengthX,
    lengthY,
    center: nodeNumber(nx / 2, ny / 2),
  };
}
