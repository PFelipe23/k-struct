import type { Point3 } from "./geometry";
import type { Slab, SlabEdge } from "./model";

export type SlabDof = 3 | 4 | 5;
interface SlabNode extends Point3 {
  number: number;
  restraints: SlabDof[];
}
export interface SlabElement {
  number: number;
  nodes: [number, number, number] | [number, number, number, number];
}
export interface SlabMesh {
  nodes: SlabNode[];
  elements: SlabElement[];
  edges: Record<SlabEdge, number[]>;
}

export function meshSlab(slab: Slab, z: number): SlabMesh {
  const { divisionsX: nx, divisionsY: ny, supports } = slab;
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
        x: slab.x + (i / nx) * slab.lengthX,
        y: slab.y + (j / ny) * slab.lengthY,
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
  return { nodes, elements, edges };
}
