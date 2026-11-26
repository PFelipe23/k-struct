import type { Project } from "./model";
import { distance, type Point3 } from "./geometry";
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
  const members = project.members.map((member) => {
    const section = project.sections.find(({ id }) => id === member.sectionId)!;
    const material = project.materials.find(
      ({ id }) => id === section.materialId,
    )!;
    const start = project.nodes.find(({ id }) => id === member.start)!;
    const end = project.nodes.find(({ id }) => id === member.end)!;
    const length = distance(start, end);
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
    const material = project.materials.find(
      ({ id }) => id === slab.materialId,
    )!;
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
      totalZ: pz * slab.lengthX * slab.lengthY,
    };
  });

  const warnings: string[] = [];
  if (project.slabs.length && axis !== "Z")
    warnings.push(
      "A direção escolhida não é representada pelos painéis horizontais; o peso próprio deles será omitido da análise.",
    );
  const matchingMemberLoads = pattern.uniform.some((load) =>
    axis === "X" ? load.qx !== 0 : axis === "Y" ? load.qy !== 0 : load.qz !== 0,
  );
  const matchingSlabLoads =
    axis === "Z" && pattern.pressure.some((load) => load.pz !== 0);
  if (matchingMemberLoads || matchingSlabLoads)
    warnings.push(
      "Este padrão também contém cargas manuais na direção do peso próprio. Confira se elas não representam o mesmo peso.",
    );
  const enabledPatternIds = new Set(
    project.loadPatterns
      .filter((item) => item.id !== pattern.id && item.selfWeight.enabled)
      .map(({ id }) => id),
  );
  if (
    project.analysisCases.some(
      (analysisCase) =>
        analysisCase.factors.some(
          ({ patternId }) => patternId === pattern.id,
        ) &&
        analysisCase.factors.some(({ patternId }) =>
          enabledPatternIds.has(patternId),
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

export function selfWeightVector(
  project: Project,
  pattern: Pattern,
  memberId: string,
) {
  const member = selfWeightSummary(project, pattern).members.find(
    (item) => item.memberId === memberId,
  );
  return member
    ? { x: member.qx, y: member.qy, z: member.qz }
    : { x: 0, y: 0, z: 0 };
}
