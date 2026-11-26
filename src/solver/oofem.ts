import {
  add,
  coordinates,
  cross,
  distance,
  interpolate,
  beamAxes,
  localComponents,
  length,
  origin,
  scale,
  subtract,
  type Point3,
} from "../domain/geometry";
import {
  analysisErrors,
  nodalLoad,
  projectSchema,
  type Project,
} from "../domain/model";
import { memberAxis } from "../domain/memberOffsets";
import { rigidGroups, rigidJointEquations } from "./rigidOffsets";
import { beamMeshLayout, type SectionLocation } from "../domain/beamMesh";
import { supportBasis, supportToGlobal } from "../domain/supports";
import { beamPropertyRecords } from "./beamProperties";
import { exportSlab, parseSlabOutput, type SlabResult } from "./slab";

export interface MeshNode extends Point3 {
  number: number;
  objectId?: string;
  master?: number;
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
  slab?: ReturnType<typeof exportSlab>["slab"];
}
export interface Displacement {
  ux: number;
  uy: number;
  uz: number;
  rx: number;
  ry: number;
  rz: number;
}
export interface Reaction {
  nodeId: string;
  fx: number;
  fy: number;
  fz: number;
  mx: number;
  my: number;
  mz: number;
}
export interface Station extends Displacement, SectionLocation {
  n: number;
  v: number;
  m: number;
  vy: number;
  vz: number;
  mx: number;
  my: number;
  mz: number;
}
export interface StructuralResult {
  displacements: Record<string, Displacement>;
  reactions: Reaction[];
  members: Record<string, Station[]>;
}
export interface AnalysisResult extends StructuralResult {
  caseId: string;
  solver: string;
  completedAt: string;
  rawOutput: string;
  slab?: SlabResult;
}

const spatialDofs = [
  ["ux", 1, "fx"],
  ["uy", 2, "fy"],
  ["uz", 3, "fz"],
  ["rx", 4, "mx"],
  ["ry", 5, "my"],
  ["rz", 6, "mz"],
] as const;
const planarDofs = [spatialDofs[0], spatialDofs[2], spatialDofs[4]];

export function exportOofem(project: Project, caseId: string): AnalysisInput {
  const p = projectSchema.parse(project);
  const errors = analysisErrors(p);
  if (errors.length) throw new Error(errors.join("\n"));
  const analysisCase = p.analysisCases.find((c) => c.id === caseId);
  if (!analysisCase) throw new Error("Caso de análise inexistente.");
  if (p.slabs.length) {
    const plate = exportSlab(p, analysisCase, p.slabs[0]);
    return {
      ...plate,
      nodes: plate.slab.mesh.nodes,
      elements: [],
      project: p,
      caseId,
    };
  }
  const spatial = p.mode === "spatial";
  const dofs = spatial ? spatialDofs : planarDofs;
  const dofList = `${dofs.length} ${dofs.map(([, number]) => number).join(" ")}`;
  const nodes: MeshNode[] = p.nodes.map((n, i) => ({
    number: i + 1,
    x: n.x,
    y: spatial ? n.y : 0,
    z: n.z,
    objectId: n.id,
  }));
  const elements: MeshElement[] = [];
  const modelNodes = new Map(nodes.map((n) => [n.objectId!, n]));
  const frames = new Map(
    p.nodes.flatMap(({ id, supportFrame }) =>
      supportFrame ? [[id, supportBasis(supportFrame)] as const] : [],
    ),
  );
  const nodeNumber = (id: string) => modelNodes.get(id)!.number;
  const axes = new Map<string, ReturnType<typeof beamAxes>>();
  const memberElements = new Map<string, number[]>();
  const { stations: layout, rigidLinks } = beamMeshLayout(p);
  const lines = new Map<string, ReturnType<typeof memberAxis>>();
  const explicitDofs = new Set<number>();
  for (const m of p.members) {
    const a = modelNodes.get(m.start)!,
      b = modelNodes.get(m.end)!;
    const line = memberAxis(m, a, b);
    lines.set(m.id, line);
    axes.set(m.id, beamAxes(line.start, line.end, m.roll, p.mode));
    const stationNode = (t: number, nodeId?: string) => {
      const at =
        t === 0
          ? line.faceI
          : t === 1
            ? line.faceJ
            : interpolate(line.faceI, line.faceJ, t);
      const joint = nodeId ? modelNodes.get(nodeId) : undefined;
      if (
        joint &&
        (!m.offsets ||
          (at.x === joint.x && at.y === joint.y && at.z === joint.z))
      )
        return joint.number;
      const number = nodes.length + 1;
      if (joint) explicitDofs.add(joint.number);
      nodes.push({ ...at, number, ...(joint ? { master: joint.number } : {}) });
      return number;
    };
    const ids: number[] = [];
    let start = stationNode(0, m.start);
    const stations = layout.get(m.id)!;
    for (let i = 1; i < stations.length; i++) {
      const { t, nodeId } = stations[i];
      const end = stationNode(t, nodeId);
      if (!(distance(nodes[start - 1], nodes[end - 1]) > 0))
        throw new Error(
          `${m.name}: a malha produziria um segmento de comprimento nulo.`,
        );
      ids.push(elements.length + 1);
      elements.push({
        number: elements.length + 1,
        memberId: m.id,
        start,
        end,
        t0: stations[i - 1].t,
        t1: t,
      });
      start = end;
    }
    memberElements.set(m.id, ids);
  }
  const sets: string[] = [],
    bcs: string[] = [];
  const set = (value: string) => {
    sets.push(`Set ${sets.length + 1} ${value}`);
    return sets.length;
  };
  const properties = beamPropertyRecords(p, memberElements, set);
  for (const n of p.nodes) {
    const fixed = dofs.filter(([key]) => n.restraints[key]).map(([, d]) => d);
    if (fixed.length)
      bcs.push(
        `BoundaryCondition ${bcs.length + 1} loadTimeFunction 1 dofs ${fixed.length} ${fixed.join(" ")} values ${fixed.length} ${fixed.map(() => 0).join(" ")} set ${set(`nodes 1 ${nodeNumber(n.id)}`)}`,
      );
  }
  const membersById = new Map(p.members.map((m) => [m.id, m]));
  const publicNodes = new Map(p.nodes.map((n) => [n.id, n]));
  const rigidMasters = rigidGroups(rigidLinks, p.nodes);
  const supportRows = new Map<string, number[][]>();
  for (const [nodeId, masterId] of rigidMasters) {
    const master = nodeNumber(masterId),
      joint = nodeNumber(nodeId);
    explicitDofs.add(master);
    modelNodes.get(nodeId)!.master = master;
    const independent = supportRows.get(masterId) ?? [];
    supportRows.set(masterId, independent);
    for (const equation of rigidJointEquations(
      publicNodes.get(masterId)!,
      publicNodes.get(nodeId)!,
      master,
      joint,
      p.mode,
      independent,
    ))
      bcs.push(`LinearConstraintBC ${bcs.length + 1} ${equation}`);
  }
  // Flatten auxiliary links, including a face attached to a joint in a rigid zone.
  for (const node of nodes) {
    if (!node.master || node.objectId) continue;
    const joint = nodes[node.master - 1];
    if (joint.master) node.master = joint.master;
  }
  function addNodalLoad(id: string, values: number[]) {
    if (!values.some(Boolean)) return;
    bcs.push(
      `NodalLoad ${bcs.length + 1} loadTimeFunction 1 dofs ${dofList} Components ${values.length} ${values.join(" ")}${frames.has(id) ? " cstype 0" : ""} set ${set(`nodes 1 ${nodeNumber(id)}`)}`,
    );
  }
  for (const factor of analysisCase.factors) {
    const pat = p.loadPatterns.find((pat) => pat.id === factor.patternId)!;
    const scaleLoad = (values: number[]) => {
      const components = values.map((value) => value * factor.factor);
      if (components.some((value) => !Number.isFinite(value)))
        throw new Error(
          `O fator do padrão ${pat.name} gera uma carga fora do intervalo numérico no caso ${analysisCase.name}.`,
        );
      return components;
    };
    for (const l of pat.nodal) {
      const values = scaleLoad(dofs.map(([, , key]) => l[key]));
      addNodalLoad(l.nodeId, values);
    }
    for (const l of pat.uniform) {
      if (!factor.factor || !(l.qx || l.qy || l.qz)) continue;
      const m = membersById.get(l.memberId)!;
      if (m.offsets) {
        const line = lines.get(m.id)!;
        for (const [id, end, insertion, face] of [
          [m.start, m.offsets.i, line.start, line.faceI],
          [m.end, m.offsets.j, line.end, line.faceJ],
        ] as const) {
          if (!end.rigidLength) continue;
          const force = scale({ x: l.qx, y: l.qy, z: l.qz }, end.rigidLength);
          const moment = cross(
            subtract(interpolate(insertion, face, 0.5), modelNodes.get(id)!),
            force,
          );
          const components = spatial
            ? [force.x, force.y, force.z, moment.x, moment.y, moment.z]
            : [force.x, force.z, moment.y];
          addNodalLoad(id, scaleLoad(components));
        }
      }
      const ids = memberElements
        .get(l.memberId)!
        .flatMap((number) => [number, 1]);
      const { x, y, z } = localComponents(
        { x: l.qx, y: l.qy, z: l.qz },
        axes.get(l.memberId)!,
      );
      const values = spatial ? [x, y, z, 0, 0, 0] : [x, z, 0];
      bcs.push(
        `ConstantEdgeLoad ${bcs.length + 1} loadTimeFunction 1${spatial ? ` dofs ${dofList}` : ""} Components ${values.length} ${scaleLoad(values).join(" ")} loadType 3 csType 1 set ${set(`elementedges ${ids.length} ${ids.join(" ")}`)}`,
      );
    }
  }
  const deck = [
    "analysis.out",
    `KStruct - linear static ${spatial ? "XYZ" : "XZ"} - SI N m kg s - Euler Bernoulli`,
    // Additional prescribed directions introduce Lagrange multipliers. GMRES
    // can solve that indefinite system even with a zero diagonal pivot.
    "StaticStructural nsteps 1 deltat 1" +
      ([...supportRows.values()].some((rows) => rows.length)
        ? " lstype 1 smtype 2 stype 1 lstol 1e-12 lsiter 2000"
        : ""),
    spatial ? "domain 3dShell" : "domain 2dBeam",
    "OutputManager tstep_all dofman_all element_all",
    `ndofman ${nodes.length} nelem ${elements.length} ncrosssect ${properties.sections.length} nmat ${properties.materials.length} nbc ${bcs.length} nic 0 nltf 1 nset ${sets.length}`,
    ...nodes.map((n) => {
      const basis = n.objectId && frames.get(n.objectId);
      const lcs = basis
        ? ` lcs 6 ${basis.x.x} ${basis.x.y} ${basis.x.z} ${basis.y.x} ${basis.y.y} ${basis.y.z}`
        : "";
      const coords = `coords 3 ${n.x} ${n.y} ${n.z}`;
      if (n.master) {
        const joint = n.objectId && publicNodes.get(n.objectId);
        const mask = (value: number) =>
          `${dofs.length} ${dofs.map(([key]) => (joint && joint.restraints[key] ? 0 : value)).join(" ")}`;
        return `RigidArmNode ${n.number} ${coords}${lcs} master ${n.master} dofidmask ${dofList} mastermask ${mask(1)} doftype ${mask(2)}`;
      }
      return `Node ${n.number} ${coords}${lcs}${explicitDofs.has(n.number) ? ` dofidmask ${dofList}` : ""}`;
    }),
    ...elements.map((e) => {
      if (!spatial) return `Beam2d ${e.number} nodes 2 ${e.start} ${e.end}`;
      const z = axes.get(e.memberId)![2];
      return `Beam3d ${e.number} nodes 2 ${e.start} ${e.end} zaxis 3 ${z.x} ${z.y} ${z.z}`;
    }),
    ...properties.sections,
    ...properties.materials,
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
    !/^Finishing analysis on:/m.test(rawOutput) ||
    (rawOutput.match(/Output for time /g) || []).length !== 1
  )
    throw new Error(
      "Saída incompleta ou incompatível. Esperado um único passo estático concluído.",
    );
  if (/\b(?:nan|inf(?:inity)?)\b/i.test(rawOutput))
    throw new Error("Resultado não finito. Análise rejeitada.");
  const nodeOutput = new Map<number, Map<number, number>>();
  for (const match of rawOutput.matchAll(
    /^(?:RigidArm)?Node\s+(\d+)\s+\(\s*\d+\):([\s\S]*?)(?=\n(?:RigidArm)?Node|\n\s*Element output)/gm,
  )) {
    const values = new Map<number, number>();
    const node = Number(match[1]);
    if (nodeOutput.has(node))
      throw new Error(`Deslocamento duplicado no nó ${node}.`);
    for (const v of match[2].matchAll(/dof\s+(\d+)\s+d\s+(\S+)/g)) {
      const dof = Number(v[1]);
      if (values.has(dof))
        throw new Error(`Deslocamento duplicado no nó ${node}, GL ${dof}.`);
      values.set(dof, numberList(v[2])[0]);
    }
    nodeOutput.set(node, values);
  }
  const reactionMap = new Map<string, number>();
  for (const m of rawOutput.matchAll(
    /Node\s+(\d+)\s+iDof\s+(\d+)\s+reaction\s+(\S+)/g,
  )) {
    const key = `${m[1]}:${m[2]}`;
    if (reactionMap.has(key))
      throw new Error(`Reação duplicada no nó ${m[1]}, GL ${m[2]}.`);
    reactionMap.set(key, numberList(m[3])[0]);
  }
  const metadata = {
    caseId: input.caseId,
    solver: rawOutput.match(/OOFEM ver\.[^\n]+/)?.[0] ?? "OOFEM",
    completedAt: new Date().toISOString(),
    rawOutput,
  };
  if (input.slab)
    return {
      ...metadata,
      displacements: {},
      reactions: [],
      members: {},
      slab: parseSlabOutput(rawOutput, input.slab, nodeOutput, reactionMap),
    };

  const spatial = input.project.mode === "spatial";
  const dofs = spatial ? spatialDofs : planarDofs;
  const modelNumbers = new Map(input.nodes.map((n) => [n.objectId, n.number]));
  const frames = new Map(
    input.project.nodes.flatMap(({ id, supportFrame }) =>
      supportFrame
        ? [[modelNumbers.get(id)!, supportBasis(supportFrame)] as const]
        : [],
    ),
  );
  const d = new Map<number, Displacement>();
  for (const [number, values] of nodeOutput) {
    if (!dofs.every(([, k]) => values.has(k))) continue;
    const basis = frames.get(number);
    let u = {
      x: values.get(1)!,
      y: spatial ? values.get(2)! : 0,
      z: values.get(3)!,
    };
    let r = {
      x: spatial ? values.get(4)! : 0,
      y: values.get(5)!,
      z: spatial ? values.get(6)! : 0,
    };
    if (basis) {
      u = supportToGlobal(u, basis);
      r = supportToGlobal(r, basis);
    }
    d.set(number, { ux: u.x, uy: u.y, uz: u.z, rx: r.x, ry: r.y, rz: r.z });
  }
  for (const n of input.nodes)
    if (!d.has(n.number))
      throw new Error(`Deslocamentos ausentes no nó de análise ${n.number}.`);
  // Independent supports on the same rigid zone add constraint equations.
  // Check compatibility against the printed global motions before publishing.
  for (const n of input.nodes) {
    if (!n.master) continue;
    const joint = input.nodes[n.master - 1],
      m = d.get(n.master)!,
      s = d.get(n.number)!;
    const arm = subtract(n, joint);
    const theta = { x: m.rx, y: m.ry, z: m.rz },
      rotation = { x: s.rx, y: s.ry, z: s.rz };
    const u = { x: m.ux, y: m.uy, z: m.uz },
      actual = { x: s.ux, y: s.uy, z: s.uz };
    const expected = add(u, cross(theta, arm));
    const printTolerance = 2e-8;
    if (
      distance(theta, rotation) > 1e-12 + printTolerance * length(theta) ||
      distance(expected, actual) >
        1e-12 + printTolerance * (length(u) + length(theta) * length(arm))
    ) {
      throw new Error(
        `O resultado do OOFEM é incompatível com o movimento rígido entre os nós de análise ${joint.number} e ${n.number}.`,
      );
    }
  }
  const forces = new Map<number, number[]>();
  for (const m of rawOutput.matchAll(
    /beam element\s+(\d+)\s+\(\s*\d+\)\s*:\r?\n[^\n]*local displacements[^\n]*\n[ \t]*local end forces[ \t]+([^\n]+)/g,
  )) {
    const f = numberList(m[2]);
    if (f.length === (spatial ? 12 : 6)) forces.set(Number(m[1]), f);
  }
  const members: Record<string, Station[]> = {};
  for (const e of input.elements) {
    const f = forces.get(e.number);
    if (!f)
      throw new Error(`Esforços ausentes no elemento de análise ${e.number}.`);
    const stations = (members[e.memberId] ??= []);
    const station = (end: boolean): Station => {
      const t = end ? e.t1 : e.t0;
      const displacement = d.get(end ? e.end : e.start)!;
      const sign = end ? 1 : -1;
      if (spatial) {
        // Resultants act on the positive local-x face of the cut.
        const [n, vy, vz, mx, my, mz] = (end ? f.slice(6) : f.slice(0, 6)).map(
          (value) => sign * value,
        );
        return { t, ...displacement, n, vy, vz, mx, my, mz, v: vz, m: my };
      }
      const offset = end ? 3 : 0;
      const n = sign * f[offset],
        v = -sign * f[offset + 1],
        m = -sign * f[offset + 2];
      return { t, ...displacement, n, v, m, vy: 0, vz: v, mx: 0, my: m, mz: 0 };
    };
    // Internal editable joints can exchange forces with loads, supports and other bars.
    if (!stations.length) stations.push(station(false));
    else if (
      input.nodes[e.start - 1].objectId ||
      input.nodes[e.start - 1].master
    )
      stations.push({ ...station(false), side: "right" });
    const end = station(true);
    if (
      e.t1 < 1 &&
      (input.nodes[e.end - 1].objectId || input.nodes[e.end - 1].master)
    )
      end.side = "left";
    stations.push(end);
  }
  const reactions: Reaction[] = [];
  const printedLocalReactions: Reaction[] = [];
  for (const n of input.project.nodes) {
    if (!Object.values(n.restraints).some(Boolean)) continue;
    const num = modelNumbers.get(n.id)!;
    const result = nodalLoad(n.id);
    for (const [key, dof, axis] of dofs) {
      if (n.restraints[key]) {
        const value = reactionMap.get(`${num}:${dof}`);
        if (value === undefined)
          throw new Error(`Reação ausente em ${n.name}, ${key}.`);
        result[axis] = value;
      }
    }
    const basis = frames.get(num);
    if (basis) {
      printedLocalReactions.push(result);
      const force = supportToGlobal(
        { x: result.fx, y: result.fy, z: result.fz },
        basis,
      );
      const moment = supportToGlobal(
        { x: result.mx, y: result.my, z: result.mz },
        basis,
      );
      reactions.push({
        nodeId: n.id,
        fx: force.x,
        fy: force.y,
        fz: force.z,
        mx: moment.x,
        my: moment.y,
        mz: moment.z,
      });
    } else reactions.push(result);
  }
  checkEquilibrium(
    input.project,
    input.caseId,
    reactions,
    printedLocalReactions,
  );
  return {
    ...metadata,
    displacements: Object.fromEntries(
      input.nodes
        .filter((n) => n.objectId)
        .map((n) => [n.objectId!, d.get(n.number)!]),
    ),
    reactions,
    members,
  };
}

// OOFEM 3.0 prints reactions with %.4e. Bound the half-unit of the last digit
// before projecting local components, which can cancel along a global axis.
function reactionPrintError(value: number) {
  return value === 0
    ? 0
    : 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(value))) - 4);
}

export function checkEquilibrium(
  p: Project,
  caseId: string,
  reactions: Reaction[],
  printedLocalReactions: readonly Reaction[] = [],
) {
  const sum = [0, 0, 0, 0, 0, 0];
  const magnitudes = [1, 1, 1, 1, 1, 1];
  const reference = p.nodes[0] ?? origin;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const members = new Map(p.members.map((m) => [m.id, m]));
  const rounding = [0, 0, 0, 0, 0, 0];
  for (const local of printedLocalReactions) {
    const node = byId.get(local.nodeId)!;
    const basis = supportBasis(node.supportFrame);
    const lever = subtract(node, reference);
    for (const key of coordinates) {
      const axis = basis[key];
      const arm = cross(lever, axis);
      const df = reactionPrintError(local[`f${key}`]);
      const dm = reactionPrintError(local[`m${key}`]);
      for (const [i, global] of coordinates.entries()) {
        rounding[i] += Math.abs(axis[global]) * df;
        rounding[i + 3] +=
          Math.abs(arm[global]) * df + Math.abs(axis[global]) * dm;
      }
    }
  }
  const accumulate = (force: Point3, moment: Point3, point: Point3) => {
    const lever = subtract(point, reference);
    const induced = cross(lever, force);
    const net = add(moment, induced);
    [force.x, force.y, force.z, net.x, net.y, net.z].forEach((value, i) => {
      sum[i] += value;
    });
    // Scale moment tolerance by each printed reaction's contribution before cancellation.
    [
      force.x,
      force.y,
      force.z,
      Math.abs(moment.x) +
        Math.abs(lever.y * force.z) +
        Math.abs(lever.z * force.y),
      Math.abs(moment.y) +
        Math.abs(lever.z * force.x) +
        Math.abs(lever.x * force.z),
      Math.abs(moment.z) +
        Math.abs(lever.x * force.y) +
        Math.abs(lever.y * force.x),
    ].forEach((value, i) => {
      magnitudes[i] += Math.abs(value);
    });
  };
  const accumulateNodal = (f: Reaction, factor: number) =>
    accumulate(
      scale({ x: f.fx, y: f.fy, z: f.fz }, factor),
      scale({ x: f.mx, y: f.my, z: f.mz }, factor),
      byId.get(f.nodeId)!,
    );
  for (const r of reactions) {
    accumulateNodal(r, 1);
  }
  for (const f of p.analysisCases.find((c) => c.id === caseId)!.factors) {
    const pat = p.loadPatterns.find((l) => l.id === f.patternId)!;
    for (const l of pat.nodal) accumulateNodal(l, f.factor);
    for (const l of pat.uniform) {
      const m = members.get(l.memberId)!;
      const a = byId.get(m.start)!,
        b = byId.get(m.end)!;
      const line = memberAxis(m, a, b);
      accumulate(
        scale({ x: l.qx, y: l.qy, z: l.qz }, line.span * f.factor),
        origin,
        interpolate(line.start, line.end, 0.5),
      );
    }
  }
  if (
    sum.some(
      (v, i) =>
        !Number.isFinite(v) || Math.abs(v) > 1e-3 * magnitudes[i] + rounding[i],
    )
  )
    throw new Error(
      "A saída não fechou o equilíbrio global de forças e momentos. Resultados rejeitados.",
    );
}
