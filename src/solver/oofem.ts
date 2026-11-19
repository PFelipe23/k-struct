import { analysisErrors, projectSchema, type Project } from "../domain/model";

export interface MeshNode {
  number: number;
  x: number;
  z: number;
  objectId?: string;
}
export interface MeshElement {
  number: number;
  memberId: string;
  start: number;
  end: number;
  t0: number;
  t1: number;
}
export interface AnalysisInput {
  deck: string;
  nodes: MeshNode[];
  elements: MeshElement[];
  project: Project;
  caseId: string;
}
export interface Displacement {
  ux: number;
  uz: number;
  ry: number;
}
export interface Reaction {
  nodeId: string;
  fx: number;
  fz: number;
  my: number;
}
export interface Station {
  t: number;
  ux: number;
  uz: number;
  n: number;
  v: number;
  m: number;
}
export interface AnalysisResult {
  caseId: string;
  solver: string;
  completedAt: string;
  displacements: Record<string, Displacement>;
  reactions: Reaction[];
  members: Record<string, Station[]>;
  rawOutput: string;
}

export function exportOofem(project: Project, caseId: string): AnalysisInput {
  const p = projectSchema.parse(project);
  const errors = analysisErrors(p);
  if (errors.length) throw new Error(errors.join("\n"));
  const analysisCase = p.analysisCases.find((c) => c.id === caseId);
  if (!analysisCase) throw new Error("Caso de análise inexistente.");
  const nodes: MeshNode[] = p.nodes.map((n, i) => ({
    number: i + 1,
    x: n.x,
    z: n.z,
    objectId: n.id,
  }));
  const elements: MeshElement[] = [];
  const nodeNumber = (id: string) =>
    nodes.find((n) => n.objectId === id)!.number;
  for (const m of p.members) {
    const a = p.nodes.find((n) => n.id === m.start)!,
      b = p.nodes.find((n) => n.id === m.end)!;
    let start = nodeNumber(m.start);
    const count = p.mesh.segmentsPerMember;
    for (let i = 1; i <= count; i++) {
      const end = i === count ? nodeNumber(m.end) : nodes.length + 1;
      if (i < count)
        nodes.push({
          number: end,
          x: a.x + ((b.x - a.x) * i) / count,
          z: a.z + ((b.z - a.z) * i) / count,
        });
      elements.push({
        number: elements.length + 1,
        memberId: m.id,
        start,
        end,
        t0: (i - 1) / count,
        t1: i / count,
      });
      start = end;
    }
  }
  const sets: string[] = [],
    bcs: string[] = [];
  const set = (value: string) => {
    sets.push(`Set ${sets.length + 1} ${value}`);
    return sets.length;
  };
  const cs = p.sections.map((s, i) => {
    const ids = elements
      .filter(
        (e) => p.members.find((m) => m.id === e.memberId)!.sectionId === s.id,
      )
      .map((e) => e.number);
    return `SimpleCS ${i + 1} area ${s.width * s.height} Iy ${(s.width * s.height ** 3) / 12} beamShearCoeff 1.e18 material ${p.materials.findIndex((m) => m.id === s.materialId) + 1} set ${set(`elements ${ids.length} ${ids.join(" ")}`)}`;
  });
  for (const n of p.nodes) {
    const dofs = (
      [
        ["ux", 1],
        ["uz", 3],
        ["ry", 5],
      ] as const
    )
      .filter(([key]) => n.restraints[key])
      .map(([, d]) => d);
    if (dofs.length)
      bcs.push(
        `BoundaryCondition ${bcs.length + 1} loadTimeFunction 1 dofs ${dofs.length} ${dofs.join(" ")} values ${dofs.length} ${dofs.map(() => 0).join(" ")} set ${set(`nodes 1 ${nodeNumber(n.id)}`)}`,
      );
  }
  for (const factor of analysisCase.factors) {
    const pat = p.loadPatterns.find((pat) => pat.id === factor.patternId)!;
    for (const l of pat.nodal) {
      if (!factor.factor || !(l.fx || l.fz || l.my)) continue;
      bcs.push(
        `NodalLoad ${bcs.length + 1} loadTimeFunction 1 dofs 3 1 3 5 Components 3 ${l.fx * factor.factor} ${l.fz * factor.factor} ${l.my * factor.factor} set ${set(`nodes 1 ${nodeNumber(l.nodeId)}`)}`,
      );
    }
    for (const l of pat.uniform) {
      if (!factor.factor || !(l.qx || l.qz)) continue;
      const ids = elements
        .filter((e) => e.memberId === l.memberId)
        .flatMap((e) => [e.number, 1]);
      const m = p.members.find((m) => m.id === l.memberId)!;
      const a = p.nodes.find((n) => n.id === m.start)!,
        b = p.nodes.find((n) => n.id === m.end)!;
      const length = Math.hypot(b.x - a.x, b.z - a.z),
        c = (b.x - a.x) / length,
        s = (b.z - a.z) / length;
      // Beam2d load rotation is handled explicitly; model loads remain global.
      const axial = (c * l.qx + s * l.qz) * factor.factor,
        transverse = (-s * l.qx + c * l.qz) * factor.factor;
      bcs.push(
        `ConstantEdgeLoad ${bcs.length + 1} loadTimeFunction 1 Components 3 ${axial} ${transverse} 0 loadType 3 csType 1 set ${set(`elementedges ${ids.length} ${ids.join(" ")}`)}`,
      );
    }
  }
  const deck = [
    "analysis.out",
    "KStruct - linear static XZ - SI N m kg s - Euler Bernoulli",
    "StaticStructural nsteps 1 deltat 1",
    "domain 2dBeam",
    "OutputManager tstep_all dofman_all element_all",
    `ndofman ${nodes.length} nelem ${elements.length} ncrosssect ${cs.length} nmat ${p.materials.length} nbc ${bcs.length} nic 0 nltf 1 nset ${sets.length}`,
    ...nodes.map((n) => `Node ${n.number} coords 3 ${n.x} 0 ${n.z}`),
    ...elements.map((e) => `Beam2d ${e.number} nodes 2 ${e.start} ${e.end}`),
    ...cs,
    ...p.materials.map(
      (m, i) => `IsoLE ${i + 1} d ${m.density} E ${m.E} n ${m.nu} tAlpha 0`,
    ),
    ...bcs,
    "ConstantFunction 1 f(t) 1",
    ...sets,
    "",
  ].join("\n");
  return { deck, nodes, elements, project: p, caseId };
}

function numberList(line: string) {
  const result = line.trim().split(/\s+/).map(Number);
  if (result.some((n) => !Number.isFinite(n)))
    throw new Error(
      "O OOFEM retornou valores não finitos. Verifique a estabilidade e a escala do modelo.",
    );
  return result;
}

export function parseOofemOutput(
  rawOutput: string,
  input: AnalysisInput,
): AnalysisResult {
  if (
    !rawOutput.includes("Finishing analysis") ||
    (rawOutput.match(/Output for time /g) || []).length !== 1
  )
    throw new Error(
      "Saída incompleta ou incompatível. Esperado um único passo estático concluído.",
    );
  if (/\b(?:nan|inf(?:inity)?)\b/i.test(rawOutput))
    throw new Error("Resultado não finito. Análise rejeitada.");
  const d = new Map<number, Displacement>();
  for (const match of rawOutput.matchAll(
    /Node\s+(\d+)\s+\(\s*\d+\):([\s\S]*?)(?=\nNode|\n\s*Element output)/g,
  )) {
    const values = new Map<number, number>();
    for (const v of match[2].matchAll(/dof\s+(\d+)\s+d\s+(\S+)/g))
      values.set(Number(v[1]), numberList(v[2])[0]);
    if ([1, 3, 5].every((k) => values.has(k)))
      d.set(Number(match[1]), {
        ux: values.get(1)!,
        uz: values.get(3)!,
        ry: values.get(5)!,
      });
  }
  for (const n of input.nodes)
    if (!d.has(n.number))
      throw new Error(`Deslocamentos ausentes no nó de análise ${n.number}.`);
  const forces = new Map<number, number[]>();
  for (const m of rawOutput.matchAll(
    /beam element\s+(\d+)\s+\(\s*\d+\)\s*:[\s\S]*?local end forces\s+([^\n]+)/g,
  )) {
    const f = numberList(m[2]);
    if (f.length === 6) forces.set(Number(m[1]), f);
  }
  const members: Record<string, Station[]> = {};
  for (const e of input.elements) {
    const f = forces.get(e.number);
    if (!f)
      throw new Error(`Esforços ausentes no elemento de análise ${e.number}.`);
    const stations = (members[e.memberId] ??= []);
    const a = d.get(e.start)!,
      b = d.get(e.end)!;
    if (!stations.length)
      stations.push({ t: e.t0, ...a, n: -f[0], v: f[1], m: f[2] });
    stations.push({ t: e.t1, ...b, n: f[3], v: -f[4], m: -f[5] });
  }
  const reactionMap = new Map<string, number>();
  for (const m of rawOutput.matchAll(
    /Node\s+(\d+)\s+iDof\s+(\d+)\s+reaction\s+(\S+)/g,
  ))
    reactionMap.set(`${m[1]}:${m[2]}`, numberList(m[3])[0]);
  const reactions: Reaction[] = [];
  for (const n of input.project.nodes) {
    if (!Object.values(n.restraints).some(Boolean)) continue;
    const num = input.nodes.find((m) => m.objectId === n.id)!.number;
    const result: Reaction = { nodeId: n.id, fx: 0, fz: 0, my: 0 };
    for (const [key, dof, axis] of [
      ["ux", 1, "fx"],
      ["uz", 3, "fz"],
      ["ry", 5, "my"],
    ] as const) {
      if (n.restraints[key]) {
        const value = reactionMap.get(`${num}:${dof}`);
        if (value === undefined)
          throw new Error(`Reação ausente em ${n.name}, ${key}.`);
        result[axis] = value;
      }
    }
    reactions.push(result);
  }
  checkEquilibrium(input.project, input.caseId, reactions);
  return {
    caseId: input.caseId,
    solver: rawOutput.match(/OOFEM ver\.[^\n]+/)?.[0] ?? "OOFEM",
    completedAt: new Date().toISOString(),
    displacements: Object.fromEntries(
      input.nodes
        .filter((n) => n.objectId)
        .map((n) => [n.objectId!, d.get(n.number)!]),
    ),
    reactions,
    members,
    rawOutput,
  };
}

export function checkEquilibrium(
  p: Project,
  caseId: string,
  reactions: Reaction[],
) {
  const sum = [0, 0, 0],
    scale = [1, 1, 1];
  const add = (fx: number, fz: number, my: number, x: number, z: number) => {
    const v = [fx, fz, my + z * fx - x * fz];
    v.forEach((v, i) => {
      sum[i] += v;
      scale[i] += Math.abs(v);
    });
  };
  for (const r of reactions) {
    const n = p.nodes.find((n) => n.id === r.nodeId)!;
    add(r.fx, r.fz, r.my, n.x, n.z);
  }
  for (const f of p.analysisCases.find((c) => c.id === caseId)!.factors) {
    const pat = p.loadPatterns.find((l) => l.id === f.patternId)!;
    for (const l of pat.nodal) {
      const n = p.nodes.find((n) => n.id === l.nodeId)!;
      add(l.fx * f.factor, l.fz * f.factor, l.my * f.factor, n.x, n.z);
    }
    for (const l of pat.uniform) {
      const m = p.members.find((m) => m.id === l.memberId)!;
      const a = p.nodes.find((n) => n.id === m.start)!,
        b = p.nodes.find((n) => n.id === m.end)!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      add(
        l.qx * length * f.factor,
        l.qz * length * f.factor,
        0,
        (a.x + b.x) / 2,
        (a.z + b.z) / 2,
      );
    }
  }
  if (sum.some((v, i) => Math.abs(v) > 1e-3 * scale[i]))
    throw new Error(
      "A saída não fechou o equilíbrio global de forças e momentos. Resultados rejeitados.",
    );
}
