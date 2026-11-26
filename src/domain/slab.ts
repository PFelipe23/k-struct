import type { Point3 } from "./geometry";
import type { Slab } from "./model";
import { meshPolygon } from "./polygonMesh";
import { slabRings, type XY } from "./slabPolygon";
import { checkMeshBudget, rectangularAxis, sizingError } from "./slabSizing";

export type SlabDof = 3 | 4 | 5;
export interface SlabNode extends Point3 {
  number: number;
  restraints: SlabDof[];
  tangent?: XY; // Local x along a simply supported oblique edge, local z = global Z.
}
export interface SlabElement {
  number: number;
  nodes: [number, number, number] | [number, number, number, number];
}
export interface SlabMesh {
  nodes: SlabNode[];
  elements: SlabElement[];
  edges: Record<string, number[]>;
  grid?: { x: number[]; y: number[] };
}

export function meshSlab(
  slab: Slab,
  z: number,
  extra?: { axis: "x" | "y"; values: number[] },
): SlabMesh {
  const sizing = slab.sizing;
  if (sizing) {
    const error = sizingError(slabRings(slab), sizing);
    if (error) throw new Error(error);
  }
  if (slab.polygon) return meshPolygon(slab.polygon, z, sizing);
  const { supports } = slab;
  const uniform = (span: number, n: number) =>
    Array.from({ length: n + 1 }, (_, i) => (i / n) * span);
  const sizes = new Map(sizing?.edges.map((e) => [e.edgeId, e.size]));
  const h = (id: string) => sizes.get(id) ?? Infinity;
  const grid = sizing
    ? {
        x: rectangularAxis(
          slab.lengthX,
          sizing.target,
          [h("yMin"), h("yMax")],
          h("xMin"),
          h("xMax"),
        ),
        y: rectangularAxis(
          slab.lengthY,
          sizing.target,
          [h("xMin"), h("xMax")],
          h("yMin"),
          h("yMax"),
        ),
      }
    : {
        x: uniform(slab.lengthX, slab.divisionsX),
        y: uniform(slab.lengthY, slab.divisionsY),
      };
  if (extra) {
    const ordered = [...grid[extra.axis], ...extra.values].sort(
      (a, b) => a - b,
    );
    grid[extra.axis] = ordered.filter(
      (v, i) => !i || Math.abs(v - ordered[i - 1]) > 1e-8,
    );
  }
  const nx = grid.x.length - 1,
    ny = grid.y.length - 1;
  if (sizing || extra)
    checkMeshBudget(
      nx * ny * (slab.formulation === "qdkt" ? 1 : 2),
      (nx + 1) * (ny + 1),
    );
  const number = (i: number, j: number) => j * (nx + 1) + i + 1;
  const nodes: SlabNode[] = [];
  const elements: SlabElement[] = [];
  const edges: SlabMesh["edges"] = { xMin: [], xMax: [], yMin: [], yMax: [] };
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const id = number(i, j);
      if (i === 0) edges.xMin.push(id);
      if (i === nx) edges.xMax.push(id);
      if (j === 0) edges.yMin.push(id);
      if (j === ny) edges.yMax.push(id);
      const fixedX = (i === 0 && supports.xMin) || (i === nx && supports.xMax);
      const fixedY = (j === 0 && supports.yMin) || (j === ny && supports.yMax);
      const restraints: SlabDof[] = [];
      if (fixedX || fixedY) restraints.push(3);
      if (fixedX) restraints.push(4);
      if (fixedY) restraints.push(5);
      nodes.push({
        number: id,
        x: slab.x + grid.x[i],
        y: slab.y + grid.y[j],
        z,
        restraints,
      });
      if (i < nx && j < ny) {
        const opposite = number(i + 1, j + 1);
        const right = number(i + 1, j);
        const top = number(i, j + 1);
        if (slab.formulation === "qdkt") {
          // Natural corner order in OOFEM: (+,+), (-,+), (-,-), (+,-).
          elements.push({
            number: elements.length + 1,
            nodes: [opposite, top, id, right],
          });
        } else {
          elements.push({
            number: elements.length + 1,
            nodes: [id, right, opposite],
          });
          elements.push({
            number: elements.length + 1,
            nodes: [id, opposite, top],
          });
        }
      }
    }
  }
  return { nodes, elements, edges, grid };
}
