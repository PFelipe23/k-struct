import { add, cross, scale, type Point3 } from "./geometry";
import type { StructuralNode } from "./model";
import {
  supportBasis,
  supportDofs,
  supportToGlobal,
  type SupportFrame,
} from "./supports";

export type Foundation = NonNullable<StructuralNode["foundation"]>;
const point = (q: number[], i: number): Point3 => ({
  x: q[i],
  y: q[i + 1],
  z: q[i + 2],
});
const components = (a: Point3, b: Point3) => [a.x, a.y, a.z, b.x, b.y, b.z];

// Factor the source matrix after diagonal equilibration: a positive but very
// soft mode must survive regardless of the units or stiffness of other axes.
export function foundationModes({
  matrix,
  freeDofs,
  offset,
  reference,
  reflected,
}: Foundation) {
  if (
    matrix.length !== 6 ||
    matrix.some((row) => row.length !== 6 || !row.every(Number.isFinite))
  )
    throw new Error("A matriz deve conter 36 coeficientes finitos.");
  if (!Object.values(offset).every(Number.isFinite))
    throw new Error("Informe um deslocamento de origem finito.");
  if (reference === "node" && Object.values(offset).some((v) => v !== 0))
    throw new Error(
      "O ponto de referência no nó exige deslocamento de origem nulo.",
    );
  const diagonal = matrix.map((row, i) => row[i]);
  const active: number[] = [];
  for (const [i, dof] of supportDofs.entries()) {
    const zero =
      matrix[i].every((v) => v === 0) && matrix.every((row) => row[i] === 0);
    if (
      zero !== freeDofs.includes(dof) ||
      freeDofs.indexOf(dof) !== freeDofs.lastIndexOf(dof)
    )
      throw new Error(
        `${dof.toUpperCase()}: a declaração de GDL livres é incompatível com a linha e a coluna da matriz.`,
      );
    if (zero) continue;
    if (!(diagonal[i] > 0))
      throw new Error(
        `${dof.toUpperCase()}: a direção ativa deve ter energia positiva.`,
      );
    active.push(i);
  }
  if (!active.length)
    throw new Error("A fundação deve ter ao menos uma direção com rigidez.");
  const roots = diagonal.map(Math.sqrt);
  const lower = matrix.map(() => Array<number>(6).fill(0));
  for (const i of active)
    for (const j of active) {
      if (j > i) break;
      const a = matrix[i][j] / roots[i] / roots[j],
        b = matrix[j][i] / roots[j] / roots[i];
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-8)
        throw new Error(
          `Matriz assimétrica ou fora de escala em ${supportDofs[i].toUpperCase()} × ${supportDofs[j].toUpperCase()}.`,
        );
      let pivot = (a + b) / 2;
      for (const k of active) {
        if (k >= j) break;
        pivot -= lower[i][k] * lower[j][k];
      }
      if (i === j && !(pivot > 1e-12))
        throw new Error(
          `Energia não positiva ou mecanismo não declarado em ${supportDofs[i].toUpperCase()}.`,
        );
      lower[i][j] = i === j ? Math.sqrt(pivot) : pivot / lower[j][j];
    }
  return active.map((j) => {
    const v = lower.map((row, i) => roots[i] * row[j]);
    const force = point(v, 0);
    // r points from the structural node to the CSV origin in foundation axes.
    // u_origin = u_node + theta × r; the dual moment gains r × force.
    const nodal = components(force, add(point(v, 3), cross(offset, force)));
    // A mirrored copy rebuilds z as x × y. The CSV and its offset stay
    // verbatim in the original axes; polar and axial components map differently.
    if (reflected) for (const k of [2, 3, 4]) nodal[k] = -nodal[k];
    const s = Math.max(...nodal.map(Math.abs));
    if (!(s * s > 0) || !Number.isFinite(s * s))
      throw new Error(
        "A transformação da fundação excede o intervalo numérico.",
      );
    return { stiffness: s * s, weights: nodal.map((v) => v / s) };
  });
}

function globalWeights(weights: number[], frame?: SupportFrame) {
  const basis = supportBasis(frame);
  return components(
    supportToGlobal(point(weights, 0), basis),
    supportToGlobal(point(weights, 3), basis),
  );
}

export function globalFoundationMatrix(
  foundation: Foundation,
  frame?: SupportFrame,
) {
  const modes = foundationModes(foundation).map(({ stiffness, weights }) => ({
    stiffness,
    weights: globalWeights(weights, frame),
  }));
  return supportDofs.map((_, i) =>
    supportDofs.map((_, j) => {
      const value = modes.reduce(
        (v, m) => v + m.stiffness * m.weights[i] * m.weights[j],
        0,
      );
      if (!Number.isFinite(value))
        throw new Error("Coeficiente transformado fora do intervalo numérico.");
      return value;
    }),
  );
}

export function foundationConstraintRows(
  node: StructuralNode,
  position: Point3,
  span: number,
) {
  if (!node.foundation) return [];
  return foundationModes(node.foundation).map(({ weights }) => {
    const global = globalWeights(weights, node.supportFrame),
      a = point(global, 0);
    const row = components(
      a,
      add(cross(position, a), scale(point(global, 3), 1 / span)),
    );
    const largest = Math.max(...row.map(Math.abs));
    return row.map((v) => v / largest);
  });
}

export function foundationReaction(
  foundation: Foundation,
  displacement: number[],
) {
  const result = Array<number>(6).fill(0);
  for (const { weights, stiffness } of foundationModes(foundation)) {
    const force =
      -stiffness * weights.reduce((sum, v, i) => sum + v * displacement[i], 0);
    weights.forEach((weight, i) => {
      result[i] += weight * force;
    });
  }
  if (!result.every(Number.isFinite))
    throw new Error("Reação da fundação fora do intervalo numérico.");
  return result;
}
