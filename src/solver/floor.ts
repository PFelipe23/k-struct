import { caseMotions } from "../domain/prescribedMotions";
import { supportBasis } from "../domain/supports";
import type { FloorMesh } from "./floorMesh";
import {
  rotationTrace,
  type RotationEquation,
  type ScalarTerm,
} from "./floorTrace";
import type { Project } from "../domain/model";
import type { MeshNode, MeshElement } from "./oofem";
import type { XY } from "../domain/slabPolygon";
import type { SlabDof } from "../domain/slab";
import { parseSlabOutput } from "./slab";

type Face = {
  local: number;
  global: number;
  force: number;
  momentT: number;
  momentN: number;
};
type TraceStation = {
  point: XY;
  length: number;
  faces: Face[];
  ground?: number;
  beam?: number;
  contact?: number;
  extraBeamSupport: boolean;
  spring?: number;
  constraints: ReturnType<typeof rotationTrace>["accepted"];
};
type Counts = { node: number; element: number; section: number };
export function floorRecords(
  p: Project,
  f: FloorMesh,
  beamNodes: MeshNode[],
  bars: MeshElement[],
  offset: Counts,
  bcs: string[],
  set: (v: string) => number,
) {
  const nodes: string[] = [],
    elements: string[] = [],
    sections: string[] = [];
  const fix = (dof: number, ids: number[]) => {
    if (ids.length)
      bcs.push(
        `BoundaryCondition ${bcs.length + 1} loadTimeFunction 1 dofs 1 ${dof} values 1 0 set ${set(`nodes ${ids.length} ${ids.join(" ")}`)}`,
      );
  };
  const fixedScalars: number[] = [],
    extraBeamSupports: number[] = [];
  const node = (record: (id: number) => string) => {
    const id = offset.node + nodes.length + 1;
    nodes.push(record(id));
    return id;
  };
  const element = (record: (id: number) => string) => {
    const id = offset.element + elements.length + 1;
    elements.push(record(id));
    return id;
  };
  const coords = (pt: XY) => `coords 3 ${pt.x} ${pt.y} ${f.z}`;
  const scalar = (pt: XY, fixed = false) => {
    const id = node((n) => `Node ${n} ${coords(pt)} dofidmask 1 1`);
    if (fixed) fixedScalars.push(id);
    return id;
  };
  const expression = (pt: XY, terms: ScalarTerm[]) => {
    if (terms.length === 1 && terms[0].weight === 1) return terms[0].id;
    return node(
      (n) =>
        `SlaveNode ${n} ${coords(pt)} dofidmask 1 1 doftype 1 2 masterdofman ${terms.length} ${terms.map((t) => t.id).join(" ")} weights ${terms.length} ${terms.map((t) => t.weight).join(" ")}`,
    );
  };
  const t = f.tangent,
    norm = { x: -t.y, y: t.x },
    lcs = (a: XY) => ` lcs 6 ${a.x} ${a.y} 0 ${-a.y} ${a.x} 0`;
  const bindings = f.panels.map(
    () => new Map<number, { w: number; rt: number; rn: number }>(),
  );
  const frameStations = new Map<number, number>();
  if (f.member)
    for (const el of bars.filter((e) => e.memberId === f.member!.id)) {
      frameStations.set(el.t0, el.start);
      frameStations.set(el.t1, el.end);
    }
  const motions = caseMotions(p, f.analysisCase);
  const traces: TraceStation[] = [];
  for (const [i, param] of f.ts.entries()) {
    const pt = f.point(param),
      ell = (f.length * ((f.ts[i + 1] ?? param) - (f.ts[i - 1] ?? param))) / 2;
    const boundary = f.panels.map((v) => v.mesh.nodes[v.ordered[i] - 1]);
    const exterior = boundary.some((v) => v.restraints.includes(3));
    let w: number,
      beam: number | undefined,
      contact: number | undefined,
      ground: number | undefined,
      extraBeamSupport = false;
    if (f.member) {
      const pair = [...frameStations].find(
        ([u]) => Math.abs(u - f.beamT(param)) * f.length <= 1e-6,
      );
      if (!pair) throw new Error("Estação da viga ausente na malha da borda.");
      beam = pair[1];
      const bn = beamNodes[beam - 1],
        obj = p.nodes.find((n) => n.id === bn.objectId);
      // The attached coordinate is global UZ, including for rotated support
      // frames. A coincident rigid-arm projection expresses it in master DOFs.
      if (Math.hypot(bn.x - pt.x, bn.y - pt.y, bn.z - f.z) > 1e-6)
        throw new Error("O nó da viga não coincide com a estação da borda.");
      const inclined =
        obj?.supportFrame &&
        Math.abs(supportBasis(obj.supportFrame).z.z - 1) > 1e-12;
      const projected = bn.connection || inclined;
      const master = projected
        ? node(
            (n) =>
              `RigidArmNode ${n} ${coords(pt)} master ${beam} dofidmask 1 3 mastermask 1 1 doftype 1 2`,
          )
        : beam;
      contact = master;
      if (exterior && obj?.restraints.uz && motions.get(obj.id)?.uz)
        throw new Error(
          "O recalque da viga é incompatível com o apoio vertical fixo da borda externa nesse nó.",
        );
      if (exterior && !obj?.restraints.uz) {
        if (projected || bn.master)
          throw new Error(
            "A borda externa apoiada encontra uma ponta de viga com referencial ou liberação. Use apoio vertical global nesse encontro.",
          );
        extraBeamSupports.push(beam);
        extraBeamSupport = true;
      } else if (exterior && inclined)
        throw new Error(
          "O encontro com a borda externa apoiada requer apoio vertical no referencial global.",
        );
      w = node(
        (n) =>
          `GeneralSlaveNode ${n} ${coords(pt)} dofidmask 1 1 doftype 1 2 mastersizes 1 1 masterlist 2 ${master} 3 masterweights 1 1`,
      );
      bn.pointLoadStation = true;
    } else {
      w = scalar(pt, exterior || f.joint.support === "line");
      if (exterior || f.joint.support === "line") ground = w;
    }
    const equations: RotationEquation[] = [];
    for (const [side, v] of boundary.entries()) {
      const x = v.tangent ?? { x: 1, y: 0 };
      for (const d of v.restraints.filter((d) => d !== 3)) {
        const axis = d === 4 ? x : { x: -x.y, y: x.x };
        const alpha = axis.x * t.x + axis.y * t.y,
          beta = axis.x * norm.x + axis.y * norm.y;
        const row = [0, 0, 0, 0];
        row[side * 2] = alpha;
        row[side * 2 + 1] = beta;
        equations.push({
          row,
          side,
          tangentComponent: alpha,
          kind: "exterior",
        });
      }
    }
    equations.push({ kind: "normal", row: [0, 1, 0, -1] });
    if (f.joint.kind === "continuous")
      equations.push({ kind: "tangent", row: [1, 0, -1, 0] });
    const { rotations, accepted } = rotationTrace(equations, (fixed) =>
      scalar(pt, fixed),
    );
    const axes = rotations.map((terms) => expression(pt, terms));
    const faces = boundary.map((v, side) => {
      const force = scalar(pt, true),
        momentT = scalar(pt, true),
        momentN = scalar(pt, true);
      bindings[side].set(v.number, {
        w: expression(pt, [
          { id: w, weight: 1 },
          { id: force, weight: 1 },
        ]),
        rt: expression(pt, [
          { id: axes[2 * side], weight: 1 },
          { id: momentT, weight: 1 },
        ]),
        rn: expression(pt, [
          { id: axes[2 * side + 1], weight: 1 },
          { id: momentN, weight: 1 },
        ]),
      });
      return { local: v.number, global: 0, force, momentT, momentN };
    });
    // Positive spring output acts on A about the common A-edge tangent.
    let spring: number | undefined;
    if (f.joint.kind === "elastic") {
      const stiffness = f.joint.stiffness! * ell;
      if (!(stiffness > 0) || !Number.isFinite(stiffness))
        throw new Error("Rigidez da mola da borda fora do intervalo numérico.");
      spring = element(
        (id) =>
          `Spring ${id} nodes 2 ${axes[0]} ${axes[2]} crossSect ${offset.section + 1} mode 0 k ${stiffness}`,
      );
    }
    traces.push({
      point: pt,
      length: ell,
      faces,
      ground,
      beam,
      contact,
      extraBeamSupport,
      spring,
      constraints: accepted,
    });
  }
  fix(1, fixedScalars);
  fix(3, extraBeamSupports);
  const parts = f.panels.map((input, side) => {
    const { mesh, definition } = input;
    const mapping = mesh.nodes.map((v) => {
      const b = bindings[side].get(v.number);
      if (b) {
        const id = node(
          (n) =>
            `GeneralSlaveNode ${n} ${coords(v)} dofidmask 3 3 4 5 doftype 3 2 2 2 mastersizes 3 1 1 1 masterlist 6 ${b.w} 1 ${b.rt} 1 ${b.rn} 1 masterweights 3 1 1 1${lcs(t)}`,
        );
        v.tangent = t;
        v.restraints = [3, 4, 5];
        return id;
      }
      return node(
        (n) =>
          `Node ${n} ${coords(v)} dofidmask 3 3 4 5${v.tangent ? lcs(v.tangent) : ""}`,
      );
    });
    traces.forEach((tr) => {
      const face = tr.faces[side];
      face.global = mapping[face.local - 1];
    });
    for (const d of [3, 4, 5] as SlabDof[])
      fix(
        d,
        mesh.nodes
          .filter(
            (v) => !bindings[side].has(v.number) && v.restraints.includes(d),
          )
          .map((v) => mapping[v.number - 1]),
      );
    const first = offset.element + elements.length;
    const quad = definition.formulation === "qdkt";
    const ids = mesh.elements.map((el) =>
      element(
        (n) =>
          `${quad ? "qdktplate" : "DKTPlate"} ${n} nodes ${el.nodes.length} ${el.nodes.map((j) => mapping[j - 1]).join(" ")}`,
      ),
    );
    const material =
      p.materials.findIndex((m) => m.id === definition.materialId) + 1;
    sections.push(
      `SimpleCS ${offset.section + side + 1} thick ${definition.thickness} material ${material} set ${set(`elementranges {(${ids[0]} ${ids.at(-1)})}`)}`,
    );
    if (input.pressure && quad)
      bcs.push(
        `ConstantSurfaceLoad ${bcs.length + 1} loadTimeFunction 1 dofs 3 3 4 5 components 3 ${input.pressure} 0 0 csType 0 set ${set(`elementboundaries ${2 * ids.length} ${ids.map((id) => id + " 1").join(" ")}`)}`,
      );
    if (input.nodalLoads) {
      input.nodalLoads.forEach((v, i) =>
        bcs.push(
          `NodalLoad ${bcs.length + 1} loadTimeFunction 1 dofs 1 3 components 1 ${v} set ${set(`nodes 1 ${mapping[i]}`)}`,
        ),
      );
    }
    return { input, mapping, first };
  });
  return {
    nodes,
    elements,
    sections,
    data: { parts, traces, joint: f.joint, tangent: f.tangent, z: f.z },
  };
}
export type FloorInput = ReturnType<typeof floorRecords>["data"];
export type FloorResult = ReturnType<typeof readFloor>;
export function readFloor(
  raw: string,
  f: FloorInput,
  displacements: ReadonlyMap<number, Map<number, number>>,
  reactions: ReadonlyMap<string, number>,
) {
  const reaction = (id: number, d = 1) => {
    const r = reactions.get(`${id}:${d}`);
    if (r === undefined)
      throw new Error(`Reação da ligação ausente no nó ${id}, GL ${d}.`);
    return r;
  };
  const forces = new Map(
    [
      ...raw.matchAll(
        /spring element\s+(\d+)\s+\([^)]*\)\s*:\s*spring force or moment\s+(\S+)/gi,
      ),
    ].map((m) => [+m[1], Number(m[2])]),
  );
  const panels = f.parts.map(({ input, mapping, first }, side) => {
    const values = new Map<number, Map<number, number>>(),
      applied = new Map<string, number>();
    mapping.forEach((g, i) => {
      const u = displacements.get(g);
      if (u) values.set(i + 1, u);
      for (const d of input.mesh.nodes[i].restraints) {
        const r = reactions.get(`${g}:${d}`);
        if (r !== undefined) applied.set(`${i + 1}:${d}`, r);
      }
    });
    for (const tr of f.traces) {
      const face = tr.faces[side];
      [face.force, face.momentT, face.momentN].forEach((id, k) =>
        applied.set(`${face.local}:${k + 3}`, reaction(id)),
      );
    }
    return parseSlabOutput(raw, input, values, applied, first);
  });
  const within = (a: number, b: number, scale: number, why: string) => {
    if (!Number.isFinite(a + b) || Math.abs(a - b) > 0.002 * scale + 1e-5)
      throw new Error(`A saída do OOFEM não satisfaz ${why} da borda comum.`);
  };
  const stations = f.traces.map((tr) => {
    const ua = displacements.get(tr.faces[0].global)!,
      ub = displacements.get(tr.faces[1].global)!;
    const delta = ub.get(4)! - ua.get(4)!;
    if (tr.contact) {
      const w = displacements.get(tr.contact)?.get(3);
      if (
        w === undefined ||
        Math.abs(w - ua.get(3)!) > 1e-10 + 1e-8 * Math.abs(w)
      )
        throw new Error(
          "O deslocamento vertical da viga diverge do deslocamento da laje na borda.",
        );
    }
    if (
      Math.abs(ub.get(3)! - ua.get(3)!) > 1e-10 ||
      Math.abs(ub.get(5)! - ua.get(5)!) > 1e-10 ||
      (f.joint.kind === "continuous" && Math.abs(delta) > 1e-10)
    )
      throw new Error(
        "Incompatibilidade de deslocamento ou rotação na borda comum.",
      );
    const exterior = [0, 0],
      rawMoment = tr.faces.map((v) => reaction(v.momentT));
    let moment = 0;
    for (const { eq, id } of tr.constraints) {
      if (eq.kind === "exterior")
        exterior[eq.side!] += reaction(id) * eq.tangentComponent!;
      if (eq.kind === "tangent") moment = reaction(id);
    }
    if (tr.spring) {
      moment = forces.get(tr.spring) ?? NaN;
      within(
        moment,
        f.joint.stiffness! * tr.length * delta,
        Math.max(
          1,
          Math.abs(moment),
          f.joint.stiffness! *
            tr.length *
            (Math.abs(ua.get(4)!) + Math.abs(ub.get(4)!)) *
            1e-4,
        ),
        "a lei da mola rotacional",
      );
    }
    const [momentA, momentB] = rawMoment.map((v, k) => v - exterior[k]);
    const scale = Math.max(
      1,
      ...rawMoment.map(Math.abs),
      ...exterior.map(Math.abs),
      Math.abs(moment),
    );
    within(momentA, moment, scale, "o momento do primeiro painel");
    within(momentB, -moment, scale, "o momento do segundo painel");
    const vertical = tr.faces.reduce((sum, v) => sum + reaction(v.force), 0);
    const external = tr.ground
      ? reaction(tr.ground)
      : tr.extraBeamSupport
        ? reaction(tr.beam!, 3)
        : 0;
    if (!tr.beam)
      within(
        vertical,
        external,
        tr.faces.reduce((tot, v) => tot + Math.abs(reaction(v.force)), 0),
        "o equilíbrio vertical",
      );
    return {
      external,
      point: { ...tr.point, z: f.z },
      length: tr.length,
      delta,
      moment,
      momentA,
      momentB,
      vertical,
      beamForce: tr.beam ? external - vertical : 0,
    };
  });
  const outerReactionZ =
    panels.reduce((sum, v) => sum + v.totalReactionZ, 0) +
    stations.reduce((sum, v) => sum + v.external - v.vertical, 0);
  return {
    panels,
    stations,
    outerReactionZ,
    joint: f.joint,
    tangent: f.tangent,
    beamForce: stations.reduce((s, v) => s + v.beamForce, 0),
    momentA: stations.reduce((s, v) => s + v.momentA, 0),
    momentB: stations.reduce((s, v) => s + v.momentB, 0),
    deltaMax: Math.max(...stations.map((v) => Math.abs(v.delta))),
    totalLoadZ: panels.reduce((s, v) => s + v.totalLoadZ, 0),
  };
}
