import { meshSlab } from "../domain/slab";
import { analysisErrors, projectSchema, type Project } from "../domain/model";

export function exportSlabOofem(project: Project, caseId: string) {
  const p = projectSchema.parse(project);
  const [slab] = p.slabs;
  if (!slab) throw new Error("Lance uma laje retangular para analisar.");
  const errors = analysisErrors(p);
  if (errors.length) throw new Error(errors.join("\n"));
  const analysisCase = p.analysisCases.find(({ id }) => id === caseId);
  if (!analysisCase) throw new Error("Caso de análise inexistente.");
  const material = p.materials.find(({ id }) => id === slab.materialId)!;
  const pressure = analysisCase.factors.reduce((sum, { patternId, factor }) => {
    const pattern = p.loadPatterns.find(({ id }) => id === patternId)!;
    const load = pattern.pressures.find(({ slabId }) => slabId === slab.id);
    return sum + factor * (load?.qz ?? 0);
  }, 0);
  const appliedZ = pressure * slab.lengthX * slab.lengthY;
  if (!Number.isFinite(pressure) || !Number.isFinite(appliedZ))
    throw new Error("A pressão ou sua resultante excede o limite numérico.");
  const mesh = meshSlab(slab);
  const { nodes, cells, edges } = mesh;
  const xEdges = [...edges.xMin, ...edges.xMax];
  const yEdges = [...edges.yMin, ...edges.yMax];
  const supportNodes = [...new Set([...xEdges, ...yEdges])];
  const nodeSet = (number: number, ids: number[]) =>
    `Set ${number} nodes ${ids.length} ${ids.join(" ")}`;
  const deck = [
    "analysis.out",
    "KStruct - placa retangular simplesmente apoiada - SI",
    "StaticStructural nsteps 1",
    "domain 2dMindlinPlate",
    "OutputManager tstep_all dofman_all element_all",
    `ndofman ${nodes.length} nelem ${cells.length} ncrosssect 1 nmat 1 nbc 4 nic 0 nltf 1 nset 5`,
    ...nodes.map(({ number, x, y }) => `Node ${number} coords 3 ${x} ${y} 0`),
    ...cells.map(
      ({ number, vertices }) =>
        `qdktplate ${number} nodes 4 ${vertices.join(" ")}`,
    ),
    `SimpleCS 1 thick ${slab.thickness} material 1 set 1`,
    `IsoLE 1 d ${material.density} E ${material.E} n ${material.nu} tAlpha 0`,
    "BoundaryCondition 1 loadTimeFunction 1 dofs 1 3 values 1 0 set 2",
    "BoundaryCondition 2 loadTimeFunction 1 dofs 1 4 values 1 0 set 3",
    "BoundaryCondition 3 loadTimeFunction 1 dofs 1 5 values 1 0 set 4",
    `ConstantSurfaceLoad 4 loadTimeFunction 1 dofs 3 3 4 5 components 3 ${pressure} 0 0 csType 0 set 5`,
    "ConstantFunction 1 f(t) 1",
    `Set 1 elementranges {(1 ${cells.length})}`,
    nodeSet(2, supportNodes),
    nodeSet(3, xEdges),
    nodeSet(4, yEdges),
    `Set 5 elementboundaries ${2 * cells.length} ${cells.map(({ number }) => `${number} 1`).join(" ")}`,
    "",
  ].join("\n");
  return {
    kind: "slab" as const,
    caseId,
    slabId: slab.id,
    deck,
    mesh,
    appliedZ,
    supportNodes,
  };
}

type SlabInput = ReturnType<typeof exportSlabOofem>;
type Moments = { mx: number; my: number };
const corners = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
] as const;
const gaussSigns = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

export function parseSlabOutput(output: string, input: SlabInput) {
  if (
    !/^Finishing analysis on:/m.test(output) ||
    (output.match(/^Output for time /gm) ?? []).length !== 1
  )
    throw new Error(
      "Saída da laje incompleta. Esperado um único passo estático concluído.",
    );

  const displacement = new Map<number, number>();
  for (const [, label, value] of output.matchAll(
    /^Node[ \t]+(\d+)[ \t]+\([^\r\n]+\):[ \t]*\r?\n[ \t]+dof +3 +d +(\S+)/gm,
  )) {
    const id = Number(label);
    if (displacement.has(id))
      throw new Error(`Deslocamento duplicado no nó de malha ${id}.`);
    displacement.set(id, Number(value));
  }
  for (const { number } of input.mesh.nodes)
    if (!Number.isFinite(displacement.get(number)))
      throw new Error(`Flecha ausente ou inválida no nó de malha ${number}.`);

  const verticalReactions = [
    ...output.matchAll(/^[ \t]+Node\s+(\d+)\s+iDof\s+3\s+reaction\s+(\S+)/gm),
  ];
  const reactions = new Map(
    verticalReactions.map(([, label, value]) => [Number(label), Number(value)]),
  );
  if (
    verticalReactions.length !== input.supportNodes.length ||
    !input.supportNodes.every((id) => Number.isFinite(reactions.get(id)))
  )
    throw new Error("Reações verticais incompletas na saída da laje.");
  let rz = 0;
  let reactionMagnitude = 0;
  for (const reaction of reactions.values()) {
    rz += reaction;
    reactionMagnitude += Math.abs(reaction);
  }
  // The output prints reactions to five significant digits.
  if (
    !Number.isFinite(rz) ||
    !Number.isFinite(reactionMagnitude) ||
    Math.abs(rz + input.appliedZ) > 0.01 + reactionMagnitude * 5e-5
  )
    throw new Error("O equilíbrio vertical da laje não foi verificado.");

  const blocks = output.split(/^element[ \t]+(\d+)[ \t]+\([^\r\n]+\)[ \t]*:/gm);
  const elementOutput = new Map<number, string>();
  for (let i = 1; i < blocks.length; i += 2) {
    const id = Number(blocks[i]);
    if (elementOutput.has(id))
      throw new Error(`Resultado duplicado no elemento de laje ${id}.`);
    elementOutput.set(id, blocks[i + 1]);
  }

  const center = { uz: displacement.get(input.mesh.center)!, mx: 0, my: 0 };
  const cells = input.mesh.cells.map((cell) => {
    const block = elementOutput.get(cell.number) ?? "";
    const points = [
      ...block.matchAll(
        /^[ \t]+GP +1\.(\d+) +:[^\r\n]*\r?\n[ \t]+stresses +([^\r\n]+)/gm,
      ),
    ];
    if (points.length !== gaussSigns.length)
      throw new Error(
        `Pontos de Gauss incompletos no elemento de laje ${cell.number}.`,
      );
    const moments: Moments[] = points.map(([, label, stresses], index) => {
      const values = stresses.trim().split(/\s+/).map(Number);
      if (
        Number(label) !== index + 1 ||
        values.length !== 8 ||
        values.some((value) => !Number.isFinite(value))
      )
        throw new Error(
          `Momentos inválidos no ponto ${index + 1} do elemento de laje ${cell.number}.`,
        );
      return { mx: -values[3], my: -values[4] };
    });

    const corner = cell.vertices.indexOf(input.mesh.center);
    if (corner >= 0) {
      const [xi, eta] = corners[corner];
      for (const [i, [sx, sy]] of gaussSigns.entries()) {
        // Extrapolate to the central node and average its four adjacent cells.
        const weight =
          ((1 + sx * xi * Math.sqrt(3)) * (1 + sy * eta * Math.sqrt(3))) / 16;
        center.mx += weight * moments[i].mx;
        center.my += weight * moments[i].my;
      }
    }

    return {
      ...cell,
      uz: cell.vertices.reduce((sum, id) => sum + displacement.get(id)! / 4, 0),
      mx: moments.reduce((sum, moment) => sum + moment.mx / 4, 0),
      my: moments.reduce((sum, moment) => sum + moment.my / 4, 0),
    };
  });
  if (!Number.isFinite(center.mx) || !Number.isFinite(center.my))
    throw new Error("Momentos recuperados na laje excedem o limite numérico.");
  return {
    slabId: input.slabId,
    caseId: input.caseId,
    center,
    rz,
    appliedZ: input.appliedZ,
    cells,
    nx: input.mesh.nx,
    ny: input.mesh.ny,
    lengthX: input.mesh.lengthX,
    lengthY: input.mesh.lengthY,
  };
}

export type SlabResult = ReturnType<typeof parseSlabOutput>;
