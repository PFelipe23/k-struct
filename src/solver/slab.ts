import type { AnalysisCase, Project, Slab } from "../domain/model";
import { meshSlab, type SlabDof, type SlabMesh } from "../domain/slab";

const slabDofs = [3, 4, 5] as const;
interface SlabInput {
  definition: Slab;
  mesh: SlabMesh;
  totalLoadZ: number;
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
  reactions: SlabReaction[];
  totalReactionZ: number;
  totalLoadZ: number;
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
  const pressureZ = analysisCase.factors.reduce(
    (sum, { patternId, factor }) => {
      const pattern = project.loadPatterns.find(({ id }) => id === patternId)!;
      return sum + (pattern.pressure[0]?.pz ?? 0) * factor;
    },
    0,
  );
  const totalLoadZ = pressureZ * (definition.lengthX * definition.lengthY);
  if (!Number.isFinite(totalLoadZ))
    throw new Error(
      `A pressão do caso ${analysisCase.name} gera uma carga total fora do intervalo numérico.`,
    );

  const { nodes, elements } = mesh;
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
  if (totalLoadZ !== 0) {
    // DKT uses the linear transverse shape functions for loads: integral(Ni * qZ) = qZ * A / 3.
    const perVertex = totalLoadZ / elements.length / 3;
    const nodalForces = nodes.map(() => 0);
    for (const element of elements)
      for (const node of element.nodes) nodalForces[node - 1] += perVertex;
    for (const node of nodes)
      conditions.push(
        `NodalLoad ${conditions.length + 1} loadTimeFunction 1 dofs 1 3 Components 1 ${nodalForces[node.number - 1]} set ${nodeSet([node.number])}`,
      );
  }
  const deck = [
    "analysis.out",
    "KStruct - isolated XY slab - SI N m kg s - Discrete Kirchhoff Triangle",
    "StaticStructural nsteps 1 deltat 1",
    "domain 2dMindlinPlate",
    "OutputManager tstep_all dofman_all element_all",
    `ndofman ${nodes.length} nelem ${elements.length} ncrosssect 1 nmat 1 nbc ${conditions.length} nic 0 nltf 1 nset ${sets.length}`,
    ...nodes.map(
      ({ number, x, y, z }) => `Node ${number} coords 3 ${x} ${y} ${z}`,
    ),
    ...elements.map(
      ({ number, nodes }) => `DKTPlate ${number} nodes 3 ${nodes.join(" ")}`,
    ),
    `SimpleCS 1 thick ${definition.thickness} material 1 set 1`,
    `IsoLE 1 d ${material.density} E ${material.E} n ${material.nu} tAlpha 0`,
    ...conditions,
    "ConstantFunction 1 f(t) 1",
    ...sets,
    "",
  ].join("\n");
  return { deck, slab: { definition, mesh, totalLoadZ } satisfies SlabInput };
}

function gaussMoments(raw: string) {
  const elements = new Map<number, { mx: number; my: number }[]>();
  for (const element of raw.matchAll(
    /^element[ \t]+(\d+)[ \t]+\([ \t]*\d+\)[ \t]*:([\s\S]*?)(?=^element[ \t]+\d+|(?![\s\S]))/gm,
  )) {
    const points = new Map<number, { mx: number; my: number }>();
    const number = Number(element[1]);
    for (const match of element[2].matchAll(
      /^[ \t]*GP[ \t]+1\.([123])[ \t]*:[^\r\n]*\r?\n[ \t]*stresses[ \t]+([^\r\n]+)/gm,
    )) {
      const point = Number(match[1]);
      const stress = match[2].trim().split(/\s+/).map(Number);
      if (
        points.has(point) ||
        stress.length !== 8 ||
        !stress.every(Number.isFinite)
      )
        throw new Error(`Momentos inválidos no triângulo ${number}.`);
      // The generalized stress entries 4 and 5 use the opposite of sagging-positive.
      points.set(point, { mx: -stress[3], my: -stress[4] });
    }
    if (elements.has(number) || points.size !== 3)
      throw new Error(
        `Momentos ausentes ou duplicados no triângulo ${number}.`,
      );
    // Barycentric GP coordinates are (1/6,1/6), (2/3,1/6), (1/6,2/3).
    elements.set(number, [points.get(2)!, points.get(3)!, points.get(1)!]);
  }
  return elements;
}

function slabReactions(
  input: SlabInput,
  reactionMap: ReadonlyMap<string, number>,
) {
  const { definition, totalLoadZ, mesh } = input;
  const reactions: SlabReaction[] = [];
  const loadMx = totalLoadZ * (definition.lengthY / 2);
  const loadMy = -totalLoadZ * (definition.lengthX / 2);
  const sum = [totalLoadZ, loadMx, loadMy];
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
    const [fz, mx, my] = slabDofs.map(get);
    reactions.push({ node: node.number, fz, mx, my });
    const momentX = (node.y - definition.y) * fz;
    const momentY = -(node.x - definition.x) * fz;
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

export function parseSlabOutput(
  raw: string,
  input: SlabInput,
  nodeOutput: ReadonlyMap<number, Map<number, number>>,
  reactionMap: ReadonlyMap<string, number>,
): SlabResult {
  const { definition, mesh, totalLoadZ } = input;
  const nodes = mesh.nodes.map(({ number }) => {
    const dofs = nodeOutput.get(number);
    if (!dofs || !slabDofs.every((dof) => dofs.has(dof)))
      throw new Error(`Deslocamentos ausentes no nó ${number} da laje.`);
    return {
      uz: dofs.get(3)!,
      rx: dofs.get(4)!,
      ry: dofs.get(5)!,
      mx: 0,
      my: 0,
    };
  });
  const moments = gaussMoments(raw);
  const contributions = nodes.map(() => 0);
  const elements = mesh.elements.map(({ number, nodes: indices }) => {
    const gp = moments.get(number);
    if (!gp) throw new Error(`Momentos ausentes no triângulo ${number}.`);
    const mx = (gp[0].mx + gp[1].mx + gp[2].mx) / 3;
    const my = (gp[0].my + gp[1].my + gp[2].my) / 3;
    let uz = 0;
    for (const [vertex, id] of indices.entries()) {
      const node = nodes[id - 1];
      uz += node.uz / 3;
      // Invert the barycentric interpolation, then average the adjacent triangles at each node.
      node.mx += 2.5 * gp[vertex].mx - 1.5 * mx;
      node.my += 2.5 * gp[vertex].my - 1.5 * my;
      contributions[id - 1]++;
    }
    if (![uz, mx, my].every(Number.isFinite))
      throw new Error(
        `Resultado fora do intervalo numérico no triângulo ${number}.`,
      );
    return { uz, mx, my };
  });
  if (moments.size !== elements.length)
    throw new Error(
      "A quantidade de triângulos na saída diverge da malha da laje.",
    );
  for (const [i, node] of nodes.entries()) {
    node.mx /= contributions[i];
    node.my /= contributions[i];
    if (![node.mx, node.my].every(Number.isFinite))
      throw new Error(
        `Momentos fora do intervalo numérico no nó ${i + 1} da laje.`,
      );
  }
  const { divisionsX: nx, divisionsY: ny } = definition;
  const a = nodes[Math.floor(ny / 2) * (nx + 1) + Math.floor(nx / 2)];
  const b = nodes[Math.ceil(ny / 2) * (nx + 1) + Math.ceil(nx / 2)];
  const center = {
    uz: a.uz / 2 + b.uz / 2,
    mx: a.mx / 2 + b.mx / 2,
    my: a.my / 2 + b.my / 2,
  };
  const reactions = slabReactions(input, reactionMap);
  return {
    slabId: definition.id,
    mesh,
    nodes,
    elements,
    center,
    reactions,
    totalReactionZ: reactions.reduce((sum, reaction) => sum + reaction.fz, 0),
    totalLoadZ,
  };
}
