import { slabProperties } from "./slabPolygon";
import type { Project } from "./model";
import { memberAxis } from "./memberOffsets";
import { globalIntensity } from "./memberDistributedLoads";
import { beamAxes, type Point3 } from "./geometry";
import { sectionProperties } from "./sections";

type Pattern = Project["loadPatterns"][number];
type SelfWeight = Pattern["selfWeight"];

export interface SelfWeightMemberLoad {
  memberId: string;
  memberName: string;
  qx: number;
  qy: number;
  qz: number;
  totalX: number;
  totalY: number;
  totalZ: number;
}

export interface SelfWeightSlabLoad {
  slabId: string;
  slabName: string;
  pz: number;
  totalZ: number;
}

export interface SelfWeightSummary {
  members: SelfWeightMemberLoad[];
  slabs: SelfWeightSlabLoad[];
  warnings: string[];
}

function vector(settings: SelfWeight) {
  const axis = settings.direction[1].toLowerCase() as keyof Point3;
  const sign = settings.direction[0] === "+" ? 1 : -1;
  return {
    x: 0,
    y: 0,
    z: 0,
    [axis]: sign * settings.gravity * settings.multiplier,
  };
}

export function selfWeightSummary(
  project: Project,
  pattern: Pattern,
): SelfWeightSummary {
  if (!pattern.selfWeight.enabled)
    return { members: [], slabs: [], warnings: [] };

  const gravity = vector(pattern.selfWeight);
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const sections = new Map(project.sections.map((s) => [s.id, s]));
  const materials = new Map(project.materials.map((m) => [m.id, m]));
  const members = project.members.map((member) => {
    const section = sections.get(member.sectionId)!;
    const material = materials.get(section.materialId)!;
    const start = nodes.get(member.start)!;
    const end = nodes.get(member.end)!;
    const length = memberAxis(member, start, end).span;
    const area = sectionProperties(section).A;
    const intensity = material.density * area;
    const qx = intensity * gravity.x;
    const qy = intensity * gravity.y;
    const qz = intensity * gravity.z;
    return {
      memberId: member.id,
      memberName: member.name,
      qx,
      qy,
      qz,
      totalX: qx * length,
      totalY: qy * length,
      totalZ: qz * length,
    };
  });

  const axis = pattern.selfWeight.direction[1];
  const sign = pattern.selfWeight.direction[0] === "+" ? 1 : -1;
  const slabs = project.slabs.map((slab) => {
    const material = materials.get(slab.materialId)!;
    const pz =
      axis === "Z"
        ? sign *
          material.density *
          slab.thickness *
          pattern.selfWeight.gravity *
          pattern.selfWeight.multiplier
        : 0;
    return {
      slabId: slab.id,
      slabName: slab.name,
      pz,
      totalZ: pz * slabProperties(slab).area,
    };
  });

  const warnings: string[] = [];
  if (project.slabs.length && axis !== "Z")
    warnings.push(
      "O painel horizontal aceita peso próprio em Z. Escolha +Z ou −Z para analisar o padrão.",
    );
  const matchingMemberLoads = pattern.uniform.some((load) =>
    axis === "X" ? load.qx !== 0 : axis === "Y" ? load.qy !== 0 : load.qz !== 0,
  );
  const byMember = new Map(project.members.map((m) => [m.id, m]));
  const vertical = axis.toLowerCase() as keyof Point3;
  const matchingPartialLoads = pattern.distributed?.some((load) => {
    if (load.system === "global")
      return load.qStart[vertical] !== 0 || load.qEnd[vertical] !== 0;
    const member = byMember.get(load.memberId)!;
    const line = memberAxis(
      member,
      nodes.get(member.start)!,
      nodes.get(member.end)!,
    );
    if (!line.span) return false;
    const axes = beamAxes(line.start, line.end, member.roll, project.mode);
    return [load.qStart, load.qEnd].some(
      (q) =>
        Math.abs(globalIntensity(q, load.system, axes)[vertical]) >
        1e-12 * Math.hypot(q.x, q.y, q.z),
    );
  });
  const matchingSlabLoads =
    axis === "Z" && pattern.pressure.some((load) => load.pz !== 0);
  if (matchingMemberLoads || matchingPartialLoads || matchingSlabLoads)
    warnings.push(
      "Este padrão também contém cargas manuais na direção do peso próprio. Confira se elas não representam o mesmo peso.",
    );
  const enabledPatternIds = new Set(
    project.loadPatterns
      .filter(
        (item) =>
          item.id !== pattern.id &&
          item.selfWeight.enabled &&
          item.selfWeight.gravity !== 0 &&
          item.selfWeight.multiplier !== 0,
      )
      .map(({ id }) => id),
  );
  if (
    pattern.selfWeight.multiplier !== 0 &&
    pattern.selfWeight.gravity !== 0 &&
    project.analysisCases.some(
      (analysisCase) =>
        analysisCase.factors.some(
          ({ patternId, factor }) => factor !== 0 && patternId === pattern.id,
        ) &&
        analysisCase.factors.some(
          ({ patternId, factor }) =>
            factor !== 0 && enabledPatternIds.has(patternId),
        ),
    )
  )
    warnings.push(
      "Um caso combina este padrão com outro que também ativa o peso próprio; a ação será somada duas vezes.",
    );
  if (
    [...members, ...slabs].some((item) =>
      Object.values(item).some(
        (value) => typeof value === "number" && !Number.isFinite(value),
      ),
    )
  )
    warnings.push("O peso próprio calculado excede o intervalo numérico.");
  return { members, slabs, warnings };
}
