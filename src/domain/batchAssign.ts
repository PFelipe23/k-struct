import {
  nodalLoad,
  patternLoadLimit,
  uniformLoad,
  type NodalLoad,
  type Project,
  type SelectedObject,
  type UniformLoad,
} from "./model";

import { supportDofs, type SupportDof } from "./supports";

export type DofKey = SupportDof;
export type SupportAction = "keep" | "restrict" | "release";
export type LoadOperation = "add" | "replace" | "remove";
export type NodalLoadKey = Exclude<keyof NodalLoad, "nodeId">;
export type UniformLoadKey = Exclude<keyof UniformLoad, "memberId">;

export const planarDofs: readonly DofKey[] = ["ux", "uz", "ry"];
export const spatialDofs = supportDofs;
export const planarNodalKeys: readonly NodalLoadKey[] = ["fx", "fz", "my"];
export const spatialNodalKeys: readonly NodalLoadKey[] = [
  "fx",
  "fy",
  "fz",
  "mx",
  "my",
  "mz",
];
export const planarUniformKeys: readonly UniformLoadKey[] = ["qx", "qz"];
export const spatialUniformKeys: readonly UniformLoadKey[] = ["qx", "qy", "qz"];

export type ValueSummary =
  | { kind: "uniform"; value: number }
  | { kind: "mixed"; min: number; max: number };

export type SupportSummary = "restricted" | "free" | "mixed";

export type SectionSummary =
  | { kind: "uniform"; sectionId: string }
  | { kind: "mixed" }
  | { kind: "none" };

export type BatchSelectionSummary = {
  nodes: Project["nodes"];
  members: Project["members"];
  section: SectionSummary;
  restraints: Partial<Record<DofKey, SupportSummary>>;
  nodal: Partial<Record<NodalLoadKey, ValueSummary>>;
  uniform: Partial<Record<UniformLoadKey, ValueSummary>>;
};

type LoadEdit<K extends string> = {
  operation: LoadOperation;
  values: Partial<Record<K, number>>;
  removeKeys?: readonly K[];
};

export type BatchAssignmentSpec = {
  sectionId?: string;
  restraints?: Partial<Record<DofKey, SupportAction>>;
  nodalLoad?: LoadEdit<NodalLoadKey>;
  uniformLoad?: LoadEdit<UniformLoadKey>;
};

export type BatchPreview =
  | {
      ok: true;
      hasChanges: boolean;
      affectedNodes: number;
      affectedMembers: number;
      nodeNames: string[];
      memberNames: string[];
      patternName: string;
      lines: string[];
    }
  | { ok: false; errors: string[] };

function summarizeNumbers(values: number[]): ValueSummary {
  if (!values.length) return { kind: "uniform", value: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max
    ? { kind: "uniform", value: min }
    : { kind: "mixed", min, max };
}

function selectedObjects(
  project: Project,
  selection: readonly SelectedObject[],
) {
  const nodeIds = new Set(
    selection.filter((s) => s.kind === "node").map((s) => s.id),
  );
  const memberIds = new Set(
    selection.filter((s) => s.kind === "member").map((s) => s.id),
  );
  return {
    nodes: project.nodes.filter((n) => nodeIds.has(n.id)),
    members: project.members.filter((m) => memberIds.has(m.id)),
  };
}

// Imported projects may have several load records on a single object.
function selectedTotals<K extends string, L extends Record<K, number>>(
  objects: readonly { id: string }[],
  rows: L[],
  keys: readonly K[],
  idOf: (row: L) => string,
  empty: (id: string) => L,
) {
  const totals = new Map(objects.map(({ id }) => [id, empty(id)]));
  for (const row of rows) {
    const total: Record<K, number> | undefined = totals.get(idOf(row));
    if (total) for (const key of keys) total[key] += row[key];
  }
  return totals;
}

const nodeIdOf = (load: NodalLoad) => load.nodeId;
const memberIdOf = (load: UniformLoad) => load.memberId;

export function summarizeBatchSelection(
  project: Project,
  selection: readonly SelectedObject[],
  patternId: string,
): BatchSelectionSummary {
  const { nodes, members } = selectedObjects(project, selection);
  const pattern = project.loadPatterns.find((p) => p.id === patternId);

  const sectionIds = new Set(members.map((m) => m.sectionId));
  const section: SectionSummary =
    members.length === 0
      ? { kind: "none" }
      : sectionIds.size === 1
        ? { kind: "uniform", sectionId: members[0].sectionId }
        : { kind: "mixed" };

  const activeDofs = project.mode === "spatial" ? spatialDofs : planarDofs;
  const restraints: Partial<Record<DofKey, SupportSummary>> = {};
  for (const dof of activeDofs) {
    const fixedCount = nodes.filter((n) => n.restraints[dof]).length;
    restraints[dof] =
      fixedCount === 0
        ? "free"
        : fixedCount === nodes.length
          ? "restricted"
          : "mixed";
  }

  const nodal: Partial<Record<NodalLoadKey, ValueSummary>> = {};
  const activeNodal =
    project.mode === "spatial" ? spatialNodalKeys : planarNodalKeys;
  if (pattern && nodes.length > 0) {
    const totals = [
      ...selectedTotals(
        nodes,
        pattern.nodal,
        activeNodal,
        nodeIdOf,
        nodalLoad,
      ).values(),
    ];
    for (const key of activeNodal) {
      nodal[key] = summarizeNumbers(totals.map((t) => t[key]));
    }
  }

  const uniform: Partial<Record<UniformLoadKey, ValueSummary>> = {};
  const activeUniform =
    project.mode === "spatial" ? spatialUniformKeys : planarUniformKeys;
  if (pattern && members.length > 0) {
    const totals = [
      ...selectedTotals(
        members,
        pattern.uniform,
        activeUniform,
        memberIdOf,
        uniformLoad,
      ).values(),
    ];
    for (const key of activeUniform) {
      uniform[key] = summarizeNumbers(totals.map((t) => t[key]));
    }
  }

  return {
    nodes,
    members,
    section,
    restraints,
    nodal,
    uniform,
  };
}

function validateSpec(
  project: Project,
  patternId: string,
  spec: BatchAssignmentSpec,
): string[] {
  const errors: string[] = [];
  const pattern = project.loadPatterns.find((p) => p.id === patternId);
  if (!pattern) {
    errors.push("Padrão de carga ativo inexistente no projeto.");
  }
  if (
    spec.sectionId &&
    !project.sections.some((s) => s.id === spec.sectionId)
  ) {
    errors.push("Seção selecionada inexistente no projeto.");
  }

  const activeDofs = new Set(
    project.mode === "spatial" ? spatialDofs : planarDofs,
  );
  for (const [dof, action] of Object.entries(spec.restraints ?? {})) {
    if (action && action !== "keep" && !activeDofs.has(dof as DofKey)) {
      errors.push(`Restrição ${dof.toUpperCase()} exige um projeto espacial.`);
    }
  }

  const activeNodal = new Set(
    project.mode === "spatial" ? spatialNodalKeys : planarNodalKeys,
  );
  if (spec.nodalLoad) {
    for (const [key, value] of Object.entries(spec.nodalLoad.values)) {
      if (value === undefined) continue;
      if (!activeNodal.has(key as NodalLoadKey)) {
        errors.push(
          `Componente ${key.toUpperCase()} exige um projeto espacial.`,
        );
      } else if (!Number.isFinite(value)) {
        errors.push(`Valor inválido em ${key.toUpperCase()}.`);
      }
    }
    for (const key of spec.nodalLoad.removeKeys ?? []) {
      if (!activeNodal.has(key)) {
        errors.push(
          `Componente ${key.toUpperCase()} exige um projeto espacial.`,
        );
      }
    }
  }

  const activeUniform = new Set(
    project.mode === "spatial" ? spatialUniformKeys : planarUniformKeys,
  );
  if (spec.uniformLoad) {
    for (const [key, value] of Object.entries(spec.uniformLoad.values)) {
      if (value === undefined) continue;
      if (!activeUniform.has(key as UniformLoadKey)) {
        errors.push(
          `Componente ${key.toUpperCase()} exige um projeto espacial.`,
        );
      } else if (!Number.isFinite(value)) {
        errors.push(`Valor inválido em ${key.toUpperCase()}.`);
      }
    }
    for (const key of spec.uniformLoad.removeKeys ?? []) {
      if (!activeUniform.has(key)) {
        errors.push(
          `Componente ${key.toUpperCase()} exige um projeto espacial.`,
        );
      }
    }
  }

  return errors;
}

export function formatBatchLoad(value: number) {
  const kilo = value / 1000;
  return kilo.toLocaleString("pt-BR", {
    maximumSignificantDigits: 12,
    notation: kilo !== 0 && Math.abs(kilo) < 1e-4 ? "scientific" : "standard",
  });
}

// Only the edited components of a changed object are consolidated. All other
// components stay on their original rows, including cancelling or very small loads.
function planLoads<K extends string, L extends Record<K, number>>(
  rows: L[],
  objects: readonly { id: string }[],
  edit: LoadEdit<K> | undefined,
  keys: readonly K[],
  idOf: (row: L) => string,
  empty: (id: string) => L,
) {
  const changes = new Map<string, Map<K, number>>();
  const touched =
    edit?.operation === "remove"
      ? (edit.removeKeys ?? [])
      : keys.filter((k) => edit?.values[k] !== undefined);
  if (!edit || !touched.length || !objects.length) return { rows, changes };
  const rowsById = new Map<string, L[]>(objects.map(({ id }) => [id, []]));
  for (const row of rows) rowsById.get(idOf(row))?.push(row);
  for (const [id, existing] of rowsById) {
    const updated = new Map<K, number>();
    for (const k of touched) {
      if (edit.operation === "remove") {
        if (existing.some((row) => row[k] !== 0)) updated.set(k, 0);
        continue;
      }
      const total = existing.reduce((sum, row) => sum + row[k], 0);
      const value =
        edit.operation === "add" ? total + edit.values[k]! : edit.values[k]!;
      if (!Number.isFinite(value))
        throw new Error(
          `O total de ${k.toUpperCase()} excede o intervalo numérico.`,
        );
      if (value !== total) updated.set(k, value);
    }
    if (updated.size) changes.set(id, updated);
  }
  if (!changes.size) return { rows, changes };

  const next: L[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = idOf(row);
    const updated = changes.get(id);
    if (!updated) {
      next.push(row);
      continue;
    }
    const copy = { ...row };
    const components: Record<K, number> = copy;
    for (const [k, value] of updated) components[k] = seen.has(id) ? 0 : value;
    seen.add(id);
    if (keys.some((k) => components[k] !== 0)) next.push(copy);
  }
  for (const [id, updated] of changes) {
    if (seen.has(id)) continue;
    const row = empty(id);
    const components: Record<K, number> = row;
    for (const [k, value] of updated) components[k] = value;
    next.push(row);
  }
  if (next.length > patternLoadLimit)
    throw new Error(
      `O lote ultrapassa o limite de ${patternLoadLimit} registros de carga por tipo e padrão.`,
    );
  return { rows: next, changes };
}

function planBatchAssignment(
  project: Project,
  selection: readonly SelectedObject[],
  patternId: string,
  spec: BatchAssignmentSpec,
) {
  const errors = validateSpec(project, patternId, spec);
  if (errors.length) throw new Error(errors.join("\n"));
  const pattern = project.loadPatterns.find((p) => p.id === patternId)!;
  const { nodes, members } = selectedObjects(project, selection);
  const nodal = planLoads(
    pattern.nodal,
    nodes,
    spec.nodalLoad,
    spatialNodalKeys,
    nodeIdOf,
    nodalLoad,
  );
  const uniform = planLoads(
    pattern.uniform,
    members,
    spec.uniformLoad,
    spatialUniformKeys,
    memberIdOf,
    uniformLoad,
  );
  const actions = (project.mode === "spatial" ? spatialDofs : planarDofs)
    .filter(
      (dof) =>
        spec.restraints?.[dof] === "restrict" ||
        spec.restraints?.[dof] === "release",
    )
    .map((dof) => ({ dof, fixed: spec.restraints![dof] === "restrict" }));
  const supportNodes = nodes.filter((n) =>
    actions.some((a) => n.restraints[a.dof] !== a.fixed),
  );
  const sectionMembers = spec.sectionId
    ? members.filter((m) => m.sectionId !== spec.sectionId)
    : [];
  const affectedNodes = new Set([
    ...supportNodes.map((n) => n.id),
    ...nodal.changes.keys(),
  ]);
  const affectedMembers = new Set([
    ...sectionMembers.map((m) => m.id),
    ...uniform.changes.keys(),
  ]);
  return {
    pattern,
    nodal,
    uniform,
    actions,
    supportNodes,
    sectionMembers,
    nodes: nodes.filter((n) => affectedNodes.has(n.id)),
    members: members.filter((m) => affectedMembers.has(m.id)),
  };
}

export function applyBatchAssignment(
  project: Project,
  selection: readonly SelectedObject[],
  patternId: string,
  spec: BatchAssignmentSpec,
): { changedNodes: number; changedMembers: number } {
  const plan = planBatchAssignment(project, selection, patternId, spec);
  for (const member of plan.sectionMembers) member.sectionId = spec.sectionId!;
  for (const node of plan.supportNodes)
    for (const { dof, fixed } of plan.actions) node.restraints[dof] = fixed;
  plan.pattern.nodal = plan.nodal.rows;
  plan.pattern.uniform = plan.uniform.rows;
  return {
    changedNodes: plan.nodes.length,
    changedMembers: plan.members.length,
  };
}

export function previewBatchAssignment(
  project: Project,
  selection: readonly SelectedObject[],
  patternId: string,
  spec: BatchAssignmentSpec,
): BatchPreview {
  let plan: ReturnType<typeof planBatchAssignment>;
  try {
    plan = planBatchAssignment(project, selection, patternId, spec);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  const { pattern, nodes, members } = plan;
  const lines: string[] = [];

  if (spec.sectionId) {
    const sec = project.sections.find((s) => s.id === spec.sectionId)!;
    lines.push(`Seção: atribuir "${sec.name}" às barras selecionadas.`);
  }

  const restraintChanges = Object.entries(spec.restraints ?? {}).filter(
    ([, action]) => action === "restrict" || action === "release",
  ) as [DofKey, "restrict" | "release"][];
  if (restraintChanges.length > 0) {
    const desc = restraintChanges
      .map(
        ([dof, action]) =>
          `${dof.toUpperCase()} (${action === "restrict" ? "restringir" : "liberar"})`,
      )
      .join(", ");
    lines.push(`Apoios nos eixos de cada nó: ${desc}.`);
  }

  if (spec.uniformLoad) {
    const { operation, values, removeKeys = [] } = spec.uniformLoad;
    if (operation === "remove" && removeKeys.length > 0) {
      lines.push(
        `Cargas globais em barras (${pattern.name}): remover ${removeKeys.map((k) => k.toUpperCase()).join(", ")}.`,
      );
    } else {
      const entries = Object.entries(values).filter(
        ([, v]) => v !== undefined,
      ) as [UniformLoadKey, number][];
      if (entries.length > 0) {
        const opText = operation === "add" ? "somar" : "substituir por";
        const desc = entries
          .map(
            ([k, v]) =>
              `${k[0]}${k[1].toUpperCase()} = ${formatBatchLoad(v)} kN/m`,
          )
          .join(", ");
        lines.push(
          `Cargas globais em barras (${pattern.name}): ${opText} ${desc}.`,
        );
      }
    }
  }

  if (spec.nodalLoad) {
    const { operation, values, removeKeys = [] } = spec.nodalLoad;
    if (operation === "remove" && removeKeys.length > 0) {
      lines.push(
        `Cargas nodais globais (${pattern.name}): remover ${removeKeys.map((k) => k.toUpperCase()).join(", ")}.`,
      );
    } else {
      const entries = Object.entries(values).filter(
        ([, v]) => v !== undefined,
      ) as [NodalLoadKey, number][];
      if (entries.length > 0) {
        const opText = operation === "add" ? "somar" : "substituir por";
        const desc = entries
          .map(
            ([k, v]) =>
              `${k[0] === "f" ? "F" : "M"}${k[1].toUpperCase()} = ${formatBatchLoad(v)} ${k[0] === "f" ? "kN" : "kN·m"}`,
          )
          .join(", ");
        lines.push(
          `Cargas nodais globais (${pattern.name}): ${opText} ${desc}.`,
        );
      }
    }
  }

  return {
    ok: true,
    hasChanges: nodes.length > 0 || members.length > 0,
    affectedNodes: nodes.length,
    affectedMembers: members.length,
    nodeNames: nodes.map((n) => n.name),
    memberNames: members.map((m) => m.name),
    patternName: pattern.name,
    lines,
  };
}
