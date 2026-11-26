import type { AnalysisCase, Project, ResultCombination } from "./model";
import {
  supportBasis,
  supportToLocal,
  type SupportDof,
  type SupportFrame,
} from "./supports";
import { coordinates, scale, type Point3 } from "./geometry";

type Pattern = Project["loadPatterns"][number];
export type PrescribedMotion = NonNullable<Pattern["prescribed"]>[number];
type Motions = Map<string, Partial<Record<SupportDof, number>>>;

export function setPrescribedMotion(
  pattern: Pattern,
  motion: PrescribedMotion,
) {
  const rows = (pattern.prescribed ?? []).filter(
    (r) => r.nodeId !== motion.nodeId || r.dof !== motion.dof,
  );
  if (motion.value !== 0) rows.push(motion);
  if (rows.length) pattern.prescribed = rows;
  else delete pattern.prescribed;
}

// Express a copied translation (polar) or rotation (axial) in the destination frame.
export function transformMotions(
  rows: PrescribedMotion[],
  nodeId: string,
  from: SupportFrame | undefined,
  to: SupportFrame | undefined,
  vector: (p: Point3) => Point3,
  parity: number,
) {
  const a = supportBasis(from),
    b = supportBasis(to);
  const mapped: Partial<Record<SupportDof, number>> = {};
  for (const { dof, value } of rows) {
    const kind = dof[0] as "u" | "r",
      axis = dof[1] as keyof Point3;
    const local = supportToLocal(
      scale(vector(a[axis]), kind === "r" ? parity : 1),
      b,
    );
    for (const k of coordinates) {
      if (Math.abs(local[k]) < 1e-12) continue;
      const key = `${kind}${k}` as SupportDof;
      mapped[key] = (mapped[key] ?? 0) + local[k] * value;
    }
  }
  return Object.entries(mapped).map(([key, value]) => ({
    nodeId,
    dof: key as SupportDof,
    value,
  }));
}

function accumulate(
  total: Motions,
  nodeId: string,
  dof: SupportDof,
  value: number,
) {
  const node = total.get(nodeId) ?? {};
  const next = (node[dof] ?? 0) + value;
  if (!Number.isFinite(next))
    throw new Error(
      `Movimento prescrito fora do intervalo numérico em ${nodeId}, ${dof.toUpperCase()}.`,
    );
  node[dof] = next;
  total.set(nodeId, node);
}

export function caseMotions(
  project: Project,
  analysisCase: AnalysisCase,
): Motions {
  const result: Motions = new Map();
  const patterns = new Map(project.loadPatterns.map((p) => [p.id, p]));
  for (const { patternId, factor } of analysisCase.factors) {
    if (factor === 0) continue;
    for (const row of patterns.get(patternId)!.prescribed ?? [])
      accumulate(result, row.nodeId, row.dof, factor * row.value);
  }
  return result;
}

export function combinationMotions(
  project: Project,
  combination: ResultCombination,
): Motions {
  const result: Motions = new Map();
  for (const { caseId, factor } of combination.factors) {
    if (factor === 0) continue;
    const analysisCase = project.analysisCases.find((c) => c.id === caseId)!;
    for (const [id, components] of caseMotions(project, analysisCase))
      for (const [dof, value] of Object.entries(components))
        accumulate(result, id, dof as SupportDof, factor * value);
  }
  return result;
}
