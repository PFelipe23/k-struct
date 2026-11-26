import { inspectSlabMesh } from "../domain/slabQuality";
import { materialSample } from "../domain/polygonMesh";
import { cross2, slabProperties, type XY } from "../domain/slabPolygon";
import type { AnalysisCase, Project, Slab } from "../domain/model";
import { elasticMaterialRecord } from "./elasticMaterial";
import { meshSlab, type SlabDof, type SlabMesh } from "../domain/slab";
import { selfWeightSummary } from "../domain/selfWeight";

const slabDofs = [3, 4, 5] as const;
interface SlabInput {
  definition: Slab;
  mesh: SlabMesh;
  totalLoadZ: number;
  centroid: XY;
}

export interface SlabSample {
  uz: number;
  mx: number;
  my: number;
}

interface SlabDisplacement extends SlabSample {
  rx: number;
  ry: number;
}

interface SlabReaction {
  node: number;
  fz: number;
  mx: number;
  my: number;
}

export interface SlabResult {
  slabId: string;
  mesh: SlabMesh;
  nodes: SlabDisplacement[];
  elements: SlabSample[];
  center: SlabSample;
  samplePoint: XY & { relocated: boolean };
  reactions: SlabReaction[];
  totalReactionZ: number;
  totalLoadZ: number;
  centroid: XY;
}

export function exportSlab(
  project: Project,
  analysisCase: AnalysisCase,
  definition: Slab,
) {
  const material = project.materials.find(
    ({ id }) => id === definition.materialId,
  )!;
  const level = project.guides.z.find(({ id }) => id === definition.levelId)!;
  const mesh = meshSlab(definition, level.position);
  const invalid = inspectSlabMesh(definition, mesh).issues.find(
    (v) => v.level === "invalid",
  );
  if (invalid) {
    const region = invalid.element
      ? `elemento ${invalid.element}`
      : "contorno do painel";
    throw new Error(
      `Malha inválida em ${definition.name}, ${region} (X ${invalid.at.x} m, Y ${invalid.at.y} m). ${invalid.reason}.`,
    );
  }
  const pressureZ = analysisCase.factors.reduce(
    (sum, { patternId, factor }) => {
      const pattern = project.loadPatterns.find(({ id }) => id === patternId)!;
      if (factor === 0) return sum;
      const manualPressure =
        pattern.pressure.find(({ slabId }) => slabId === definition.id)?.pz ??
        0;
      if (
        pattern.selfWeight.enabled &&
        !pattern.selfWeight.direction.endsWith("Z")
      )
        throw new Error(
          `O padrão ${pattern.name} direciona o peso próprio fora do eixo Z, que não é suportado pelo painel horizontal ${definition.name}.`,
        );
      const automaticPressure = pattern.selfWeight.enabled
        ? (selfWeightSummary(project, pattern).slabs.find(
            ({ slabId }) => slabId === definition.id,
          )?.pz ?? 0)
        : 0;
      return sum + (manualPressure + automaticPressure) * factor;
    },
    0,
  );
  const { area, centroid } = slabProperties(definition);
  const totalLoadZ = pressureZ * area;
  if (!Number.isFinite(totalLoadZ))
    throw new Error(
      `A pressão do caso ${analysisCase.name} gera uma carga total fora do intervalo numérico.`,
    );

  const { nodes, elements } = mesh;
  const quad = definition.formulation === "qdkt";
  const conditions: string[] = [];
  const sets = [`Set 1 elementranges {(1 ${elements.length})}`];
  const nodeSet = (numbers: number[]) => {
    const id = sets.length + 1;
    sets.push(`Set ${id} nodes ${numbers.length} ${numbers.join(" ")}`);
    return id;
  };
  for (const dof of slabDofs) {
    const fixed = nodes
      .filter((node) => node.restraints.includes(dof))
      .map(({ number }) => number);
    if (fixed.length)
      conditions.push(
        `BoundaryCondition ${conditions.length + 1} loadTimeFunction 1 dofs 1 ${dof} values 1 0 set ${nodeSet(fixed)}`,
      );
  }
  if (quad && pressureZ !== 0) {
    const set = sets.length + 1;
    sets.push(
      `Set ${set} elementboundaries ${2 * elements.length} ${elements.map(({ number }) => `${number} 1`).join(" ")}`,
    );
    conditions.push(
      `ConstantSurfaceLoad ${conditions.length + 1} loadTimeFunction 1 dofs 3 3 4 5 components 3 ${pressureZ} 0 0 csType 0 set ${set}`,
    );
  } else if (totalLoadZ !== 0) {
    // DKT uses the linear transverse shape functions for loads: integral(Ni * qZ) = qZ * A / 3.
    const nodalForces = nodes.map(() => 0);
    for (const element of elements) {
      const [a, b, c] = element.nodes.map((i) => nodes[i - 1]);
      const perVertex = (pressureZ * cross2(a, b, c)) / 6;
      for (const node of element.nodes) nodalForces[node - 1] += perVertex;
    }
    for (const node of nodes)
      conditions.push(
        `NodalLoad ${conditions.length + 1} loadTimeFunction 1 dofs 1 3 Components 1 ${nodalForces[node.number - 1]} set ${nodeSet([node.number])}`,
      );
  }
  const deck = [
    "analysis.out",
    `KStruct - isolated XY slab - SI N m kg s - ${definition.formulation.toUpperCase()}`,
    "StaticStructural nsteps 1 deltat 1",
    "domain 2dMindlinPlate",
    "OutputManager tstep_all dofman_all element_all",
    `ndofman ${nodes.length} nelem ${elements.length} ncrosssect 1 nmat 1 nbc ${conditions.length} nic 0 nltf 1 nset ${sets.length}`,
    ...nodes.map(({ number, x, y, z, tangent }) => {
      // QDKT uses panel-local coordinates. Global mesh positions remain available for the maps.
      if (quad) {
        const grid = mesh.grid!,
          i = (number - 1) % grid.x.length,
          j = Math.floor((number - 1) / grid.x.length);
        return `Node ${number} coords 3 ${grid.x[i]} ${grid.y[j]} 0`;
      }
      const axes = tangent
        ? ` lcs 6 ${tangent.x} ${tangent.y} 0 ${-tangent.y} ${tangent.x} 0`
        : "";
      if (definition.polygon)
        return `Node ${number} coords 3 ${x - nodes[0].x} ${y - nodes[0].y} 0${axes}`;
      return `Node ${number} coords 3 ${x} ${y} ${z}${axes}`;
    }),
    ...elements.map(
      ({ number, nodes }) =>
        `${quad ? "qdktplate" : "DKTPlate"} ${number} nodes ${nodes.length} ${nodes.join(" ")}`,
    ),
    `SimpleCS 1 thick ${definition.thickness} material 1 set 1`,
    elasticMaterialRecord(material, 1),
    ...conditions,
    "ConstantFunction 1 f(t) 1",
    ...sets,
    "",
  ].join("\n");
  return {
    deck,
    slab: { definition, mesh, totalLoadZ, centroid } satisfies SlabInput,
  };
}

function gaussMoments(raw: string, count: number) {
  const elements = new Map<number, { mx: number; my: number }[]>();
  for (const element of raw.matchAll(
    /^element[ \t]+(\d+)[ \t]+\([ \t]*\d+\)[ \t]*:([\s\S]*?)(?=^element[ \t]+\d+|(?![\s\S]))/gm,
  )) {
    const points = new Map<number, { mx: number; my: number }>();
    const number = Number(element[1]);
    for (const match of element[2].matchAll(
      /^[ \t]*GP[ \t]+1\.(\d+)[ \t]*:[^\r\n]*\r?\n[ \t]*stresses[ \t]+([^\r\n]+)/gm,
    )) {
      const point = Number(match[1]);
      const stress = match[2].trim().split(/\s+/).map(Number);
      if (
        point < 1 ||
        point > count ||
        points.has(point) ||
        stress.length !== 8 ||
        !stress.every(Number.isFinite)
      )
        throw new Error(`Momentos inválidos no elemento ${number}.`);
      // The generalized stress entries 4 and 5 use the opposite of sagging-positive.
      points.set(point, { mx: -stress[3], my: -stress[4] });
    }
    if (elements.has(number) || points.size !== count)
      throw new Error(`Momentos ausentes ou duplicados no elemento ${number}.`);
    // Barycentric GP coordinates are (1/6,1/6), (2/3,1/6), (1/6,2/3).
    const order = count === 3 ? [2, 3, 1] : [1, 2, 3, 4];
    elements.set(
      number,
      order.map((id) => points.get(id)!),
    );
  }
  return elements;
}

function slabReactions(
  input: SlabInput,
  reactionMap: ReadonlyMap<string, number>,
) {
  const { totalLoadZ, mesh, centroid } = input;
  const reactions: SlabReaction[] = [];
  // Take moments about the first mesh node to avoid sensitivity to the world origin.
  const origin = mesh.nodes[0];
  const sum = [
    totalLoadZ,
    totalLoadZ * (centroid.y - origin.y),
    -totalLoadZ * (centroid.x - origin.x),
  ];
  const magnitudes = sum.map((value) => 1 + Math.abs(value));
  for (const node of mesh.nodes) {
    if (!node.restraints.length) continue;
    const get = (dof: SlabDof) => {
      if (!node.restraints.includes(dof)) return 0;
      const value = reactionMap.get(`${node.number}:${dof}`);
      if (value === undefined)
        throw new Error(
          `Reação ausente no nó ${node.number} da laje, GL ${dof}.`,
        );
      return value;
    };
    const [fz, localX, localY] = slabDofs.map(get);
    const [mx, my] = globalPair(localX, localY, node.tangent);
    reactions.push({ node: node.number, fz, mx, my });
    const momentX = (node.y - origin.y) * fz;
    const momentY = -(node.x - origin.x) * fz;
    sum[0] += fz;
    sum[1] += mx + momentX;
    sum[2] += my + momentY;
    magnitudes[0] += Math.abs(fz);
    magnitudes[1] += Math.abs(mx) + Math.abs(momentX);
    magnitudes[2] += Math.abs(my) + Math.abs(momentY);
  }
  if (
    sum.some(
      (value, index) =>
        !Number.isFinite(value) ||
        !Number.isFinite(magnitudes[index]) ||
        Math.abs(value) > magnitudes[index] * 0.001,
    )
  )
    throw new Error(
      "A saída do OOFEM não satisfaz o equilíbrio vertical e de momentos da laje.",
    );
  return reactions;
}

// OOFEM QDKT reports four Gauss points in (-,-), (-,+), (+,-), (+,+) order.
// The rows extrapolate a bilinear field to each corner in QDKT connectivity order.
const quadCornerWeights = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
].map(([xi, eta]) =>
  [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].map(
    ([sx, sy]) =>
      ((1 + sx * xi * Math.sqrt(3)) * (1 + sy * eta * Math.sqrt(3))) / 4,
  ),
);

function globalPair(x: number, y: number, tangent?: XY) {
  return tangent
    ? [tangent.x * x - tangent.y * y, tangent.y * x + tangent.x * y]
    : [x, y];
}

export function parseSlabOutput(
  raw: string,
  input: SlabInput,
  nodeOutput: ReadonlyMap<number, Map<number, number>>,
  reactionMap: ReadonlyMap<string, number>,
): SlabResult {
  const { definition, mesh, totalLoadZ } = input;
  const nodes = mesh.nodes.map(({ number, tangent }) => {
    const dofs = nodeOutput.get(number);
    if (!dofs || !slabDofs.every((dof) => dofs.has(dof)))
      throw new Error(`Deslocamentos ausentes no nó ${number} da laje.`);
    const [rx, ry] = globalPair(dofs.get(4)!, dofs.get(5)!, tangent);
    return {
      uz: dofs.get(3)!,
      rx,
      ry,
      mx: 0,
      my: 0,
    };
  });
  const quad = definition.formulation === "qdkt";
  const moments = gaussMoments(raw, quad ? 4 : 3);
  const contributions = nodes.map(() => 0);
  const elements = mesh.elements.map(({ number, nodes: indices }) => {
    const gp = moments.get(number);
    if (!gp) throw new Error(`Momentos ausentes no elemento ${number}.`);
    const mx = gp.reduce((sum, point) => sum + point.mx / gp.length, 0);
    const my = gp.reduce((sum, point) => sum + point.my / gp.length, 0);
    let uz = 0;
    for (const [vertex, id] of indices.entries()) {
      const node = nodes[id - 1];
      uz += node.uz / indices.length;
      if (quad) {
        for (const [i, weight] of quadCornerWeights[vertex].entries()) {
          node.mx += weight * gp[i].mx;
          node.my += weight * gp[i].my;
        }
      } else {
        // At the nearest Gauss point Mgp = (Mvertex + Mmean) / 2.
        node.mx += 2 * gp[vertex].mx - mx;
        node.my += 2 * gp[vertex].my - my;
      }
      contributions[id - 1]++;
    }
    if (![uz, mx, my].every(Number.isFinite))
      throw new Error(
        `Resultado fora do intervalo numérico no elemento ${number}.`,
      );
    return { uz, mx, my };
  });
  if (moments.size !== elements.length)
    throw new Error(
      "A quantidade de elementos na saída diverge da malha da laje.",
    );
  for (const [i, node] of nodes.entries()) {
    node.mx /= contributions[i];
    node.my /= contributions[i];
    if (![node.mx, node.my].every(Number.isFinite))
      throw new Error(
        `Momentos fora do intervalo numérico no nó ${i + 1} da laje.`,
      );
  }
  const sample = materialSample(mesh, input.centroid);
  const samplePoint = { ...sample.point, relocated: sample.relocated };
  const center = interpolateSlab(nodes, sample);
  const reactions = slabReactions(input, reactionMap);
  return {
    slabId: definition.id,
    mesh,
    nodes,
    elements,
    center,
    centroid: input.centroid,
    samplePoint,
    reactions,
    totalReactionZ: reactions.reduce((sum, reaction) => sum + reaction.fz, 0),
    totalLoadZ,
  };
}

function interpolateSlab(
  nodes: SlabSample[],
  sample: ReturnType<typeof materialSample>,
): SlabSample {
  const values = { uz: 0, mx: 0, my: 0 };
  for (const [i, id] of sample.face.entries())
    for (const field of ["uz", "mx", "my"] as const)
      values[field] += nodes[id - 1][field] * sample.weights[i];
  return values;
}

export function querySlab(result: SlabResult, point: XY) {
  const sample = materialSample(result.mesh, point);
  return sample.relocated ? null : interpolateSlab(result.nodes, sample);
}
