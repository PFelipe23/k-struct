import {
  nodalLoad,
  uniformLoad,
  type NodalLoad,
  type Project,
  type SelectedObject,
  type UniformLoad,
} from "./model";

export type DofKey = "ux" | "uy" | "uz" | "rx" | "ry" | "rz";
export type SupportAction = "keep" | "restrict" | "release";
export type LoadOperation = "add" | "replace" | "remove";
export type NodalLoadKey = Exclude<keyof NodalLoad, "nodeId">;
export type UniformLoadKey = Exclude<keyof UniformLoad, "memberId">;

export const planarDofs: readonly DofKey[] = ["ux", "uz", "ry"];
export const spatialDofs: readonly DofKey[] = [
  "ux",
  "uy",
  "uz",
  "rx",
  "ry",
  "rz",
];
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
  nodeIds: string[];
  memberIds: string[];
  slabCount: number;
  section: SectionSummary;
  restraints: Partial<Record<DofKey, SupportSummary>>;
  nodal: Partial<Record<NodalLoadKey, ValueSummary>>;
  uniform: Partial<Record<UniformLoadKey, ValueSummary>>;
};

export type BatchAssignmentSpec = {
  sectionId?: string;
  restraints?: Partial<Record<DofKey, SupportAction>>;
  nodalLoad?: {
    operation: LoadOperation;
    values: Partial<Record<NodalLoadKey, number>>;
    removeKeys?: readonly NodalLoadKey[];
  };
  uniformLoad?: {
    operation: LoadOperation;
    values: Partial<Record<UniformLoadKey, number>>;
    removeKeys?: readonly UniformLoadKey[];
  };
};

export type BatchPreview =
  | {
      ok: true;
      hasChanges: boolean;
      affectedNodes: number;
      affectedMembers: number;
      patternName: string;
      lines: string[];
    }
  | { ok: false; errors: string[] };

const normalizeZero = (value: number): number =>
  Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(12));

function summarizeNumbers(values: number[]): ValueSummary {
  if (!values.length) return { kind: "uniform", value: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return Math.abs(max - min) < 1e-9
    ? { kind: "uniform", value: normalizeZero(values[0]) }
    : { kind: "mixed", min: normalizeZero(min), max: normalizeZero(max) };
}

function sumNodalInPattern(
  pattern: Project["loadPatterns"][number],
  nodeId: string,
): NodalLoad {
  const total = nodalLoad(nodeId);
  for (const item of pattern.nodal) {
    if (item.nodeId !== nodeId) continue;
    for (const key of spatialNodalKeys) total[key] += item[key];
  }
  return total;
}

function sumUniformInPattern(
  pattern: Project["loadPatterns"][number],
  memberId: string,
): UniformLoad {
  const total = uniformLoad(memberId);
  for (const item of pattern.uniform) {
    if (item.memberId !== memberId) continue;
    for (const key of spatialUniformKeys) total[key] += item[key];
  }
  return total;
}

export function summarizeBatchSelection(
  project: Project,
  selection: readonly SelectedObject[],
  patternId: string,
): BatchSelectionSummary {
  const nodeIdSet = new Set<string>();
  const memberIdSet = new Set<string>();
  let slabCount = 0;

  const projectNodeIds = new Set(project.nodes.map((n) => n.id));
  const projectMemberIds = new Set(project.members.map((m) => m.id));

  for (const item of selection) {
    if (item.kind === "node" && projectNodeIds.has(item.id)) {
      nodeIdSet.add(item.id);
    } else if (item.kind === "member" && projectMemberIds.has(item.id)) {
      memberIdSet.add(item.id);
    } else if (item.kind === "slab") {
      slabCount++;
    }
  }

  const nodeIds = [...nodeIdSet];
  const memberIds = [...memberIdSet];
  const nodes = project.nodes.filter((n) => nodeIdSet.has(n.id));
  const members = project.members.filter((m) => memberIdSet.has(m.id));
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
    const totals = nodes.map((n) => sumNodalInPattern(pattern, n.id));
    for (const key of activeNodal) {
      nodal[key] = summarizeNumbers(totals.map((t) => t[key]));
    }
  }

  const uniform: Partial<Record<UniformLoadKey, ValueSummary>> = {};
  const activeUniform =
    project.mode === "spatial" ? spatialUniformKeys : planarUniformKeys;
  if (pattern && members.length > 0) {
    const totals = members.map((m) => sumUniformInPattern(pattern, m.id));
    for (const key of activeUniform) {
      uniform[key] = summarizeNumbers(totals.map((t) => t[key]));
    }
  }

  return {
    nodeIds,
    memberIds,
    slabCount,
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

const formatKn = (valueN: number): string =>
  (valueN / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 4 });

export function applyBatchAssignment(
  project: Project,
  selection: readonly SelectedObject[],
  patternId: string,
  spec: BatchAssignmentSpec,
): { changedNodes: number; changedMembers: number } {
  const errors = validateSpec(project, patternId, spec);
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }

  const nodeIds = new Set(
    selection.filter((s) => s.kind === "node").map((s) => s.id),
  );
  const memberIds = new Set(
    selection.filter((s) => s.kind === "member").map((s) => s.id),
  );

  const changedNodeSet = new Set<string>();
  const changedMemberSet = new Set<string>();

  if (spec.sectionId) {
    for (const member of project.members) {
      if (!memberIds.has(member.id)) continue;
      if (member.sectionId !== spec.sectionId) {
        member.sectionId = spec.sectionId;
        changedMemberSet.add(member.id);
      }
    }
  }

  const restraintEntries = Object.entries(spec.restraints ?? {}).filter(
    ([, action]) => action === "restrict" || action === "release",
  ) as [DofKey, "restrict" | "release"][];

  if (restraintEntries.length > 0) {
    for (const node of project.nodes) {
      if (!nodeIds.has(node.id)) continue;
      for (const [dof, action] of restraintEntries) {
        const next = action === "restrict";
        if (node.restraints[dof] !== next) {
          node.restraints[dof] = next;
          changedNodeSet.add(node.id);
        }
      }
    }
  }

  const pattern = project.loadPatterns.find((p) => p.id === patternId)!;

  if (spec.nodalLoad && nodeIds.size > 0) {
    const { operation, values, removeKeys = [] } = spec.nodalLoad;
    const keysToTouch =
      operation === "remove"
        ? removeKeys
        : (Object.keys(values).filter(
            (k) => values[k as NodalLoadKey] !== undefined,
          ) as NodalLoadKey[]);

    if (keysToTouch.length > 0) {
      const updatedNodal: NodalLoad[] = [];
      for (const item of pattern.nodal) {
        if (!nodeIds.has(item.nodeId)) updatedNodal.push(item);
      }
      for (const node of project.nodes) {
        if (!nodeIds.has(node.id)) continue;
        const current = sumNodalInPattern(pattern, node.id);
        const next = { ...current };
        for (const key of keysToTouch) {
          if (operation === "remove") {
            next[key] = 0;
          } else {
            const amount = values[key]!;
            next[key] = normalizeZero(
              operation === "add" ? current[key] + amount : amount,
            );
          }
          if (Math.abs(next[key] - current[key]) >= 1e-12) {
            changedNodeSet.add(node.id);
          }
        }
        if (spatialNodalKeys.some((k) => Math.abs(next[k]) >= 1e-12)) {
          updatedNodal.push(next);
        }
      }
      pattern.nodal = updatedNodal;
    }
  }

  if (spec.uniformLoad && memberIds.size > 0) {
    const { operation, values, removeKeys = [] } = spec.uniformLoad;
    const keysToTouch =
      operation === "remove"
        ? removeKeys
        : (Object.keys(values).filter(
            (k) => values[k as UniformLoadKey] !== undefined,
          ) as UniformLoadKey[]);

    if (keysToTouch.length > 0) {
      const updatedUniform: UniformLoad[] = [];
      for (const item of pattern.uniform) {
        if (!memberIds.has(item.memberId)) updatedUniform.push(item);
      }
      for (const member of project.members) {
        if (!memberIds.has(member.id)) continue;
        const current = sumUniformInPattern(pattern, member.id);
        const next = { ...current };
        for (const key of keysToTouch) {
          if (operation === "remove") {
            next[key] = 0;
          } else {
            const amount = values[key]!;
            next[key] = normalizeZero(
              operation === "add" ? current[key] + amount : amount,
            );
          }
          if (Math.abs(next[key] - current[key]) >= 1e-12) {
            changedMemberSet.add(member.id);
          }
        }
        if (spatialUniformKeys.some((k) => Math.abs(next[k]) >= 1e-12)) {
          updatedUniform.push(next);
        }
      }
      pattern.uniform = updatedUniform;
    }
  }

  return {
    changedNodes: changedNodeSet.size,
    changedMembers: changedMemberSet.size,
  };
}

export function previewBatchAssignment(
  project: Project,
  selection: readonly SelectedObject[],
  patternId: string,
  spec: BatchAssignmentSpec,
): BatchPreview {
  const errors = validateSpec(project, patternId, spec);
  if (errors.length) {
    return { ok: false, errors };
  }

  const pattern = project.loadPatterns.find((p) => p.id === patternId)!;
  const clone = structuredClone(project);
  const { changedNodes, changedMembers } = applyBatchAssignment(
    clone,
    selection,
    patternId,
    spec,
  );
  const hasChanges = changedNodes > 0 || changedMembers > 0;
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
    lines.push(`Apoios: ${desc}.`);
  }

  if (spec.uniformLoad) {
    const { operation, values, removeKeys = [] } = spec.uniformLoad;
    if (operation === "remove" && removeKeys.length > 0) {
      lines.push(
        `Cargas em barras (${pattern.name}): remover ${removeKeys.map((k) => k.toUpperCase()).join(", ")}.`,
      );
    } else {
      const entries = Object.entries(values).filter(
        ([, v]) => v !== undefined,
      ) as [UniformLoadKey, number][];
      if (entries.length > 0) {
        const opText = operation === "add" ? "somar" : "substituir por";
        const desc = entries
          .map(([k, v]) => `${k[0]}${k[1].toUpperCase()} = ${formatKn(v)} kN/m`)
          .join(", ");
        lines.push(`Cargas em barras (${pattern.name}): ${opText} ${desc}.`);
      }
    }
  }

  if (spec.nodalLoad) {
    const { operation, values, removeKeys = [] } = spec.nodalLoad;
    if (operation === "remove" && removeKeys.length > 0) {
      lines.push(
        `Cargas nodais (${pattern.name}): remover ${removeKeys.map((k) => k.toUpperCase()).join(", ")}.`,
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
              `${k[0] === "f" ? "F" : "M"}${k[1].toUpperCase()} = ${formatKn(v)} ${k[0] === "f" ? "kN" : "kN·m"}`,
          )
          .join(", ");
        lines.push(`Cargas nodais (${pattern.name}): ${opText} ${desc}.`);
      }
    }
  }

  return {
    ok: true,
    hasChanges,
    affectedNodes: changedNodes,
    affectedMembers: changedMembers,
    patternName: pattern.name,
    lines,
  };
}
