import { addMember } from "./editing";
import { tolerance } from "./geometry";
import {
  addPoint,
  createProject,
  projectSchema,
  referenceErrors,
  type Project,
} from "./model";

export const TEMPLATE_LIMITS = {
  maxNodes: 1000,
  maxMembers: 1000,
  maxGuidesPerAxis: 40,
} as const;

export type ContinuousBeamSpec = {
  kind: "continuous-beam";
  spansX: number[];
};

export type RegularFrameSpec = {
  kind: "regular-frame";
  mode: Project["mode"];
  spansX: number[];
  spansY?: number[];
  heightsZ: number[];
};

export type ParametricTemplateSpec = ContinuousBeamSpec | RegularFrameSpec;

export type ParametricPreview = {
  mode: Project["mode"];
  projectName: string;
  units: "m";
  axesX: number[];
  axesY: number[];
  levelsZ: number[];
  totalLengthX: number;
  totalLengthY: number;
  totalHeightZ: number;
  nodeCount: number;
  memberCount: number;
  columnCount: number;
  beamCount: number;
  beamXCount: number;
  beamYCount: number;
  supportsSummary: string;
  loadsSummary: string;
};

export type ParametricValidation =
  | { ok: true; preview: ParametricPreview }
  | { ok: false; errors: string[] };

const normalizeCoord = (value: number): number =>
  value === 0 ? 0 : Number(value.toPrecision(12));

function validateAndAccumulate(
  values: readonly number[],
  label: string,
  errors: string[],
): number[] {
  if (!values.length) {
    errors.push(`Informe pelo menos um ${label}.`);
    return [0];
  }
  if (values.length + 1 > TEMPLATE_LIMITS.maxGuidesPerAxis) {
    errors.push(
      `O número de ${label}s gera ${values.length + 1} referências, excedendo o limite de ${TEMPLATE_LIMITS.maxGuidesPerAxis} por eixo.`,
    );
  }
  const positions = [0];
  let sum = 0;
  let valid = true;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      errors.push(`${label} ${index + 1}: informe um número finito em metros.`);
      valid = false;
      return;
    }
    if (value <= tolerance) {
      errors.push(
        `${label} ${index + 1}: o comprimento deve ser maior que zero (mín. > ${tolerance} m).`,
      );
      valid = false;
      return;
    }
    sum += value;
    if (!Number.isFinite(sum)) {
      errors.push(
        `${label} ${index + 1}: soma acumulada fora do intervalo numérico.`,
      );
      valid = false;
      return;
    }
    positions.push(normalizeCoord(sum));
  });
  return valid ? positions : [0];
}

function indexToAlpha(index: number): string {
  let current = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return label;
}

export function inspectParametricTemplate(
  spec: ParametricTemplateSpec,
): ParametricValidation {
  const errors: string[] = [];
  const axesX = validateAndAccumulate(spec.spansX, "Vão em X", errors);

  let mode: Project["mode"] = "planar";
  let axesY = [0];
  let levelsZ = [0];

  if (spec.kind === "regular-frame") {
    mode = spec.mode;
    levelsZ = validateAndAccumulate(
      spec.heightsZ,
      "Altura de pavimento",
      errors,
    );
    if (spec.mode === "spatial") {
      axesY = validateAndAccumulate(spec.spansY ?? [], "Vão em Y", errors);
    }
  }

  const nx = Math.max(0, axesX.length - 1);
  const ny = Math.max(0, axesY.length - 1);
  const nz = Math.max(0, levelsZ.length - 1);

  let nodeCount = 0;
  let columnCount = 0;
  let beamXCount = 0;
  let beamYCount = 0;
  let projectName = "";

  if (spec.kind === "continuous-beam") {
    nodeCount = nx + 1;
    beamXCount = nx;
    projectName = `Viga contínua · ${nx} ${nx === 1 ? "vão" : "vãos"}`;
  } else if (spec.mode === "planar") {
    nodeCount = (nx + 1) * (nz + 1);
    columnCount = (nx + 1) * nz;
    beamXCount = nx * nz;
    projectName = `Pórtico plano · ${nx} ${nx === 1 ? "vão" : "vãos"} × ${nz} pav.`;
  } else {
    nodeCount = (nx + 1) * (ny + 1) * (nz + 1);
    columnCount = (nx + 1) * (ny + 1) * nz;
    beamXCount = nx * (ny + 1) * nz;
    beamYCount = (nx + 1) * ny * nz;
    projectName = `Pórtico espacial · ${nx} × ${ny} vãos × ${nz} pav.`;
  }

  const beamCount = beamXCount + beamYCount;
  const memberCount = columnCount + beamCount;

  if (nodeCount > TEMPLATE_LIMITS.maxNodes) {
    errors.push(
      `O modelo teria ${nodeCount} nós, excedendo o limite de ${TEMPLATE_LIMITS.maxNodes.toLocaleString("pt-BR")} nós.`,
    );
  }
  if (memberCount > TEMPLATE_LIMITS.maxMembers) {
    errors.push(
      `O modelo teria ${memberCount} barras, excedendo o limite de ${TEMPLATE_LIMITS.maxMembers.toLocaleString("pt-BR")} barras.`,
    );
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    preview: {
      mode,
      projectName,
      units: "m",
      axesX,
      axesY,
      levelsZ,
      totalLengthX: axesX[axesX.length - 1],
      totalLengthY: axesY[axesY.length - 1],
      totalHeightZ: levelsZ[levelsZ.length - 1],
      nodeCount,
      memberCount,
      columnCount,
      beamCount,
      beamXCount,
      beamYCount,
      supportsSummary: "Nenhum apoio (nós livres para lançamento manual)",
      loadsSummary: "Nenhuma carga (padrão inicial 'Carga permanente' vazio)",
    },
  };
}

export function generateParametricProject(
  spec: ParametricTemplateSpec,
): Project {
  const validation = inspectParametricTemplate(spec);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }
  const { preview } = validation;
  const { axesX, axesY, levelsZ } = preview;

  const p = createProject(preview.mode);
  p.name = preview.projectName;
  p.guides = {
    x: axesX.map((position, index) => ({
      id: `X${index + 1}`,
      name: String(index + 1),
      position,
    })),
    y: axesY.map((position, index) => {
      const label = indexToAlpha(index);
      return {
        id: `Y${label}`,
        name: label,
        position,
      };
    }),
    z: levelsZ.map((position, index) =>
      index === 0
        ? { id: "base", name: "Base", position: 0 }
        : { id: `level${index}`, name: `Pav. ${index}`, position },
    ),
  };

  for (const z of levelsZ) {
    for (const y of axesY) {
      for (const x of axesX) {
        addPoint(p, { x, y, z });
      }
    }
  }

  if (spec.kind === "continuous-beam") {
    for (let i = 0; i < axesX.length - 1; i++) {
      addMember(
        p,
        { x: axesX[i], y: 0, z: 0 },
        { x: axesX[i + 1], y: 0, z: 0 },
      );
    }
  } else {
    for (let k = 0; k < levelsZ.length - 1; k++) {
      for (const y of axesY) {
        for (const x of axesX) {
          addMember(p, { x, y, z: levelsZ[k] }, { x, y, z: levelsZ[k + 1] });
        }
      }
    }
    for (let k = 1; k < levelsZ.length; k++) {
      for (const y of axesY) {
        for (let i = 0; i < axesX.length - 1; i++) {
          addMember(
            p,
            { x: axesX[i], y, z: levelsZ[k] },
            { x: axesX[i + 1], y, z: levelsZ[k] },
          );
        }
      }
      if (preview.mode === "spatial") {
        for (const x of axesX) {
          for (let j = 0; j < axesY.length - 1; j++) {
            addMember(
              p,
              { x, y: axesY[j], z: levelsZ[k] },
              { x, y: axesY[j + 1], z: levelsZ[k] },
            );
          }
        }
      }
    }
  }

  const parsed = projectSchema.parse(p);
  const refErrors = referenceErrors(parsed);
  if (refErrors.length) {
    throw new Error(refErrors.join("\n"));
  }
  return parsed;
}
