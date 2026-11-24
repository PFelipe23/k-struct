export const plateBenchmark = {
  lengthX: 4,
  lengthY: 3,
  thickness: 0.1,
  modulus: 30e9,
  poisson: 0.2,
  pressureZ: -5e3,
} as const;

export function makePlateDeck(nx: number, ny: number) {
  if (![nx, ny].every((n) => Number.isInteger(n) && n >= 2 && n % 2 === 0))
    throw new Error("Use subdivisões pares para incluir um nó no centro.");

  const { lengthX, lengthY, thickness, modulus, poisson, pressureZ } =
    plateBenchmark;
  const nodeId = (i: number, j: number) => j * (nx + 1) + i + 1;
  const nodes: string[] = [];
  const xEdges: number[] = [];
  const yEdges: number[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const id = nodeId(i, j);
      nodes.push(
        `Node ${id} coords 3 ${(lengthX * i) / nx} ${(lengthY * j) / ny} 0`,
      );
      if (i === 0 || i === nx) xEdges.push(id);
      if (j === 0 || j === ny) yEdges.push(id);
    }
  }
  const supportNodes = [...new Set([...xEdges, ...yEdges])];
  const centerNode = nodeId(nx / 2, ny / 2);

  const elements: number[][] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // Ordem do FEI2dQuadLin: NE, NO, SO, SE.
      elements.push([
        nodeId(i + 1, j + 1),
        nodeId(i, j + 1),
        nodeId(i, j),
        nodeId(i + 1, j),
      ]);
    }
  }
  const nodeSet = (id: number, members: number[]) =>
    `Set ${id} nodes ${members.length} ${members.join(" ")}`;
  const elementSurfaces = elements.map((_, i) => `${i + 1} 1`);
  const deck = [
    "analysis.out",
    "KStruct - placa retangular simplesmente apoiada - SI",
    "StaticStructural nsteps 1",
    "domain 2dMindlinPlate",
    "OutputManager tstep_all dofman_all element_all",
    `ndofman ${nodes.length} nelem ${elements.length} ncrosssect 1 nmat 1 nbc 4 nic 0 nltf 1 nset 5`,
    ...nodes,
    ...elements.map((ids, i) => `qdktplate ${i + 1} nodes 4 ${ids.join(" ")}`),
    `SimpleCS 1 thick ${thickness} material 1 set 1`,
    `IsoLE 1 d 2500 E ${modulus} n ${poisson} tAlpha 0`,
    "BoundaryCondition 1 loadTimeFunction 1 dofs 1 3 values 1 0 set 2",
    "BoundaryCondition 2 loadTimeFunction 1 dofs 1 4 values 1 0 set 3",
    "BoundaryCondition 3 loadTimeFunction 1 dofs 1 5 values 1 0 set 4",
    `ConstantSurfaceLoad 4 loadTimeFunction 1 dofs 3 3 4 5 components 3 ${pressureZ} 0 0 csType 0 set 5`,
    "ConstantFunction 1 f(t) 1",
    `Set 1 elementranges {(1 ${elements.length})}`,
    nodeSet(2, supportNodes),
    nodeSet(3, xEdges),
    nodeSet(4, yEdges),
    `Set 5 elementboundaries ${2 * elements.length} ${elementSurfaces.join(" ")}`,
    "",
  ].join("\n");

  return { deck, centerNode, supportNodes, elements };
}

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

export function readPlateResults(
  output: string,
  { centerNode, supportNodes, elements }: ReturnType<typeof makePlateDeck>,
) {
  if (!/^Finishing analysis on:/m.test(output))
    throw new Error("A saída da placa não contém o fim da análise.");

  const centerDof = new RegExp(
    String.raw`^Node[ \t]+${centerNode}[ \t]+\([^\r\n]+\):[ \t]*\r?\n[ \t]+dof +3 +d +(\S+)`,
    "m",
  );
  const uz = Number(centerDof.exec(output)?.[1]);
  if (!Number.isFinite(uz)) throw new Error("Flecha central ausente na saída.");

  const verticalReactions = [
    ...output.matchAll(/^[ \t]+Node\s+(\d+)\s+iDof\s+3\s+reaction\s+(\S+)/gm),
  ];
  const reactions = new Map(
    verticalReactions.map(([, node, value]) => [Number(node), Number(value)]),
  );
  if (
    verticalReactions.length !== supportNodes.length ||
    !supportNodes.every((node) => Number.isFinite(reactions.get(node)))
  )
    throw new Error("Reações verticais incompletas na saída da placa.");
  const rz = [...reactions.values()].reduce(
    (sum, reaction) => sum + reaction,
    0,
  );

  const blocks = output.split(/^element[ \t]+(\d+)[ \t]+\([^\r\n]+\)[ \t]*:/gm);
  const elementOutput = new Map<number, string>();
  for (let i = 1; i < blocks.length; i += 2)
    elementOutput.set(Number(blocks[i]), blocks[i + 1]);

  let mx = 0;
  let my = 0;
  let count = 0;
  for (const [index, nodes] of elements.entries()) {
    const corner = nodes.indexOf(centerNode);
    if (corner < 0) continue;
    const id = index + 1;
    const [xi, eta] = corners[corner];
    const block = elementOutput.get(id) ?? "";
    const points = [
      ...block.matchAll(
        /^[ \t]+GP +1\.(\d+) +:[^\r\n]*\r?\n[ \t]+stresses +([^\r\n]+)/gm,
      ),
    ];
    if (points.length !== gaussSigns.length)
      throw new Error(`Pontos de Gauss incompletos no elemento ${id}.`);

    for (const [point, [signX, signY]] of gaussSigns.entries()) {
      const [, label, stresses] = points[point];
      const [, , , rawMx, rawMy] = stresses.trim().split(/\s+/).map(Number);
      if (
        Number(label) !== point + 1 ||
        !Number.isFinite(rawMx) ||
        !Number.isFinite(rawMy)
      )
        throw new Error(
          `Momentos inválidos no ponto ${point + 1} do elemento ${id}.`,
        );
      // Extrapolação bilinear dos pontos ±1/√3 para o vértice (xi, eta).
      const weight =
        ((1 + signX * xi * Math.sqrt(3)) * (1 + signY * eta * Math.sqrt(3))) /
        4;
      // Na convenção do benchmark, a flexão sagente é positiva.
      mx -= weight * rawMx;
      my -= weight * rawMy;
    }
    count++;
  }
  if (count !== 4)
    throw new Error("O centro deve pertencer a quatro elementos.");
  return { rz, uz, mx: mx / count, my: my / count };
}
