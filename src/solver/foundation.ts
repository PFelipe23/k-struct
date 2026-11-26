import { foundationModes } from "../domain/foundation";
import type { StructuralNode } from "../domain/model";
import { supportDofs } from "../domain/supports";

// OOFEM 3.0: GeneralSlaveNode can select a master's *different* DOF, but
// accepts integer masterweights. SlaveNode accepts real interpolation weights
// on the *same* DOF. Their composition gives the exact scalar w·q per mode.
export function foundationRecords(
  nodes: StructuralNode[],
  nodeNumber: (id: string) => number,
  lastNode: number,
  lastElement: number,
) {
  const auxiliary: string[] = [],
    elements: string[] = [];
  for (const node of nodes) {
    if (!node.foundation) continue;
    const physical = nodeNumber(node.id);
    const coords = `coords 3 ${node.x} ${node.y} ${node.z}`;
    const mask = "dofidmask 1 1 doftype 1 2";
    const masters = supportDofs.map((_, i) => {
      const n = ++lastNode;
      auxiliary.push(
        `GeneralSlaveNode ${n} ${coords} ${mask} mastersizes 1 1 masterlist 2 ${physical} ${i + 1} masterweights 1 1`,
      );
      return n;
    });
    for (const { stiffness, weights } of foundationModes(node.foundation)) {
      const n = ++lastNode;
      const active = weights.flatMap((w, i) =>
        w === 0 ? [] : [{ n: masters[i], w }],
      );
      auxiliary.push(
        `SlaveNode ${n} ${coords} ${mask} masterdofman ${active.length} ${active.map((v) => v.n).join(" ")} weights ${active.length} ${active.map((v) => v.w).join(" ")}`,
      );
      elements.push(
        `NodalSpring ${++lastElement} nodes 1 ${n} dofmask 1 1 k 1 ${stiffness}`,
      );
    }
  }
  return { auxiliary, elements };
}
