import { beamAxes, distance, scale, tolerance, type Point3 } from "./geometry";
import {
  addPoint,
  appendMember,
  nodalLoad,
  projectSchema,
  referenceErrors,
  type NodalLoad,
  type Project,
  type SelectedObject,
  type StructuralNode,
} from "./model";
import {
  assertLength,
  mapping,
  mapRestraints,
  movedRoll,
  sectionRoll,
  type Transform,
  type VectorMap,
} from "./transformGeometry";

export type CopyOptions = {
  supports: boolean;
  patterns: string[];
  conflicts: "ask" | "keep" | "combine";
};
export const geometryOnly: CopyOptions = {
  supports: false,
  patterns: [],
  conflicts: "ask",
};
type ObjectMap = { nodes: Map<string, string>; members: Map<string, string> };
export type TransformPlan = {
  source: Project;
  project: Project;
  maps: ObjectMap[];
  selected: SelectedObject[];
  affected: string[];
  reused: Set<string>;
  conflicts: string[];
  ready: boolean;
  restraints: number;
  loads: number;
};

function selectedGeometry(source: Project, selection: SelectedObject[]) {
  if (!selection.length || selection.some((s) => s.kind === "slab"))
    throw new Error("Selecione nós ou barras para transformar.");
  const nodeIds = new Set(
    selection.filter((s) => s.kind === "node").map((s) => s.id),
  );
  const selectedNodeIds = new Set(nodeIds);
  const memberIds = new Set(
    selection.filter((s) => s.kind === "member").map((s) => s.id),
  );
  const members = source.members.filter((m) => memberIds.has(m.id));
  for (const m of members) {
    nodeIds.add(m.start);
    nodeIds.add(m.end);
  }
  const nodes = source.nodes.filter((n) => nodeIds.has(n.id));
  if (members.length !== memberIds.size || nodes.length !== nodeIds.size)
    throw new Error("A seleção contém um objeto que já não existe.");
  return { nodes, members, nodeIds, selectedNodeIds };
}
const indexedNodes = (p: Project) => new Map(p.nodes.map((n) => [n.id, n]));
const dofs = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const components = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const hasLoad = (load: NodalLoad) => components.some((k) => load[k] !== 0);

function transformLoad(
  load: NodalLoad,
  id: string,
  vector: VectorMap,
  parity: number,
): NodalLoad {
  const f = vector({ x: load.fx, y: load.fy, z: load.fz });
  const m = scale(vector({ x: load.mx, y: load.my, z: load.mz }), parity);
  return { nodeId: id, fx: f.x, fy: f.y, fz: f.z, mx: m.x, my: m.y, mz: m.z };
}
function copyAssignments(
  plan: TransformPlan,
  options: CopyOptions,
  map: ObjectMap,
  i: number,
  vector: VectorMap,
  parity: number,
  nodes: StructuralNode[],
  targetNodes: Map<string, StructuralNode>,
) {
  for (const node of nodes) {
    const dest = targetNodes.get(map.nodes.get(node.id)!)!;
    if (options.supports && dofs.some((k) => node.restraints[k])) {
      const occupied = dofs.some((k) => dest.restraints[k]);
      if (occupied)
        plan.conflicts.push(
          `Cópia ${i} · ${node.name} → ${dest.name} · apoio existente`,
        );
      if (!occupied || options.conflicts === "combine") {
        const next = mapRestraints(node, vector);
        for (const k of dofs) dest.restraints[k] ||= next[k];
        plan.restraints++;
      }
    }
  }
  for (const patternId of new Set(options.patterns)) {
    const src = plan.source.loadPatterns.find((p) => p.id === patternId);
    const dst = plan.project.loadPatterns.find((p) => p.id === patternId);
    if (!src || !dst) throw new Error("Padrão de carga inexistente.");
    // Sum contributions of the same source node before deciding about a destination.
    const incoming = new Map<string, NodalLoad>();
    for (const l of src.nodal) {
      if (!map.nodes.has(l.nodeId)) continue;
      const total = incoming.get(l.nodeId) ?? nodalLoad(l.nodeId);
      for (const k of components) total[k] += l[k];
      incoming.set(l.nodeId, total);
    }
    for (const [id, load] of incoming) {
      if (!hasLoad(load)) continue;
      const dest = targetNodes.get(map.nodes.get(id)!)!;
      const existing = dst.nodal.find(
        (l) => l.nodeId === dest.id && hasLoad(l),
      );
      if (existing) {
        plan.conflicts.push(
          `Cópia ${i} · ${dest.name} · carga nodal em ${src.name}`,
        );
        if (options.conflicts !== "combine") continue;
      }
      const next = transformLoad(load, dest.id, vector, parity);
      if (existing) for (const k of components) existing[k] += next[k];
      else dst.nodal.push(next);
      plan.loads++;
    }
    for (const l of src.uniform) {
      const id = map.members.get(l.memberId);
      if (!id) continue;
      const q = vector({ x: l.qx, y: l.qy, z: l.qz });
      dst.uniform.push({ memberId: id, qx: q.x, qy: q.y, qz: q.z });
      plan.loads++;
    }
  }
}

export function planTransform(
  source: Project,
  selection: SelectedObject[],
  spec: Transform,
  options: CopyOptions = geometryOnly,
): TransformPlan {
  const { nodes, members, nodeIds, selectedNodeIds } = selectedGeometry(
    source,
    selection,
  );
  const count = "copies" in spec ? spec.copies : 1;
  if (!Number.isInteger(count) || count < 1 || count > 20)
    throw new Error("Informe de 1 a 20 cópias.");
  if (
    spec.kind !== "move" &&
    source.members.length + count * members.length > 1000
  )
    throw new Error("A replicação ultrapassa o limite de 1.000 barras.");
  const project = structuredClone(source);
  const original = indexedNodes(source),
    targets = indexedNodes(project);
  const plan: TransformPlan = {
    source,
    project,
    maps: [],
    selected: [],
    affected: [],
    reused: new Set(),
    conflicts: [],
    ready: true,
    restraints: 0,
    loads: 0,
  };
  for (let i = 1; i <= count; i++) {
    const { position, vector, parity } = mapping(spec, i, source.mode);
    const map: ObjectMap = { nodes: new Map(), members: new Map() };
    plan.maps.push(map);
    if (spec.kind === "move") {
      for (const n of nodes) {
        Object.assign(targets.get(n.id)!, position(n));
        map.nodes.set(n.id, n.id);
      }
      for (const m of project.members) {
        if (!nodeIds.has(m.start) && !nodeIds.has(m.end)) continue;
        const a = targets.get(m.start)!,
          b = targets.get(m.end)!;
        assertLength(a, b, m.name);
        plan.affected.push(m.id);
        map.members.set(m.id, m.id);
        if (
          source.mode === "spatial" &&
          !(nodeIds.has(m.start) && nodeIds.has(m.end))
        )
          m.roll = movedRoll(
            original.get(m.start)!,
            original.get(m.end)!,
            a,
            b,
            m.roll,
          );
      }
      for (const n of nodes) {
        const dest = targets.get(n.id)!;
        const hit = project.nodes.find(
          (t) => t.id !== n.id && distance(t, dest) < tolerance,
        );
        if (hit)
          throw new Error(
            `Colisão: ${n.name} coincidiria com ${hit.name}. Altere o vetor.`,
          );
      }
      plan.selected = [...selection];
      continue;
    }
    for (const n of nodes) {
      const point = position(n);
      const matches = project.nodes.filter(
        (t) => distance(point, t) < tolerance,
      );
      if (matches.length > 1)
        throw new Error(
          `Destino ambíguo de ${n.name}: há mais de um nó coincidente.`,
        );
      const dest = matches[0] ?? addPoint(project, point);
      if (matches.length) plan.reused.add(dest.id);
      targets.set(dest.id, dest);
      map.nodes.set(n.id, dest.id);
      if (selectedNodeIds.has(n.id))
        plan.selected.push({ kind: "node", id: dest.id });
    }
    if (project.nodes.length > 1000)
      throw new Error("A replicação ultrapassa o limite de 1.000 nós.");
    for (const m of members) {
      const start = map.nodes.get(m.start)!,
        end = map.nodes.get(m.end)!;
      const a = targets.get(start)!,
        b = targets.get(end)!;
      assertLength(a, b, m.name);
      let roll = m.roll;
      if (source.mode === "spatial" && spec.kind !== "translate") {
        const [, , z] = beamAxes(
          original.get(m.start)!,
          original.get(m.end)!,
          m.roll,
        );
        roll = sectionRoll(a, b, vector(z));
      }
      const bar = appendMember(project, {
        start,
        end,
        sectionId: m.sectionId,
        roll,
      });
      map.members.set(m.id, bar.id);
      plan.selected.push({ kind: "member", id: bar.id });
    }
    copyAssignments(plan, options, map, i, vector, parity, nodes, targets);
  }
  plan.selected = [
    ...new Map(plan.selected.map((o) => [`${o.kind}:${o.id}`, o])).values(),
  ];
  plan.ready = plan.conflicts.length === 0 || options.conflicts !== "ask";
  if (!projectSchema.safeParse(project).success)
    throw new Error(
      "A operação excede os limites do projeto ou produz valores inválidos.",
    );
  const errors = referenceErrors(project);
  if (errors.length) throw new Error(errors.join("\n"));
  return plan;
}

// Historical API for callers that copy geometry by an offset.
export function replicate(
  p: Project,
  selection: SelectedObject[],
  offset: Point3,
  copies: number,
) {
  const plan = planTransform(p, selection, {
    kind: "translate",
    offset,
    copies,
  });
  // Keep existing object references for callers holding nodes and members.
  p.nodes.push(...plan.project.nodes.slice(p.nodes.length));
  p.members.push(...plan.project.members.slice(p.members.length));
  return plan.selected;
}
