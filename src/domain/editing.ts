import {
  add,
  cross,
  distance,
  dot,
  interiorParameter,
  length,
  scale,
  subtract,
  tolerance,
  type Point3,
} from "./geometry";
import {
  addPoint,
  nextName,
  uid,
  type Member,
  type Project,
  type SelectedObject,
  type Slab,
} from "./model";

function hasMember(p: Project, a: string, b: string) {
  return p.members.some(
    (m) => (m.start === a && m.end === b) || (m.start === b && m.end === a),
  );
}

function appendMember(p: Project, properties: Omit<Member, "id" | "name">) {
  if (hasMember(p, properties.start, properties.end))
    throw new Error("Já existe uma barra entre esses nós.");
  const bar = { ...properties, id: uid(), name: nextName("B", p.members) };
  p.members.push(bar);
  return bar;
}

export function addMember(
  p: Project,
  from: Point3,
  to: Point3,
  properties: Pick<Member, "sectionId" | "roll"> = {
    sectionId: p.sections[0].id,
    roll: 0,
  },
) {
  if (distance(from, to) < tolerance)
    throw new Error("Escolha uma extremidade diferente para a barra.");
  const a = addPoint(p, from);
  const b = addPoint(p, to);
  if (a.id === b.id)
    throw new Error("Escolha uma extremidade diferente para a barra.");
  return appendMember(p, {
    start: a.id,
    end: b.id,
    ...properties,
  });
}

export function addSlab(
  p: Project,
  levelId: string,
  from: Point3,
  to: Point3,
): Slab {
  const level = p.guides.z.find((item) => item.id === levelId);
  if (
    p.mode !== "spatial" ||
    !level ||
    from.z !== level.position ||
    to.z !== level.position
  )
    throw new Error("Lance a laje na planta XY de um pavimento.");
  if (p.slabs.length)
    throw new Error("Este projeto já contém uma laje isolada.");
  const lengthX = Math.abs(to.x - from.x);
  const lengthY = Math.abs(to.y - from.y);
  if (lengthX < tolerance || lengthY < tolerance)
    throw new Error("Marque dois cantos opostos para definir um retângulo.");
  const concrete = { E: 30e9, nu: 0.2, density: 2500 };
  let material = p.materials.find(
    (item) =>
      item.E === concrete.E &&
      item.nu === concrete.nu &&
      item.density === concrete.density,
  );
  if (!material) {
    material = { id: uid(), name: "Concreto", ...concrete };
    p.materials.push(material);
  }
  const slab: Slab = {
    id: uid(),
    name: "L1",
    levelId,
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    lengthX,
    lengthY,
    thickness: 0.1,
    materialId: material.id,
    formulation: "qdkt",
    divisionsX: 8,
    divisionsY: 6,
    supports: { xMin: true, xMax: true, yMin: true, yMax: true },
  };
  p.slabs.push(slab);
  return slab;
}

export function replicate(
  p: Project,
  selection: SelectedObject[],
  offset: Point3,
  copies: number,
): SelectedObject[] {
  if (selection.some((item) => item.kind === "slab"))
    throw new Error("A replicação está disponível para nós e barras.");
  if (
    !selection.length ||
    !Number.isInteger(copies) ||
    copies < 1 ||
    copies > 20
  )
    throw new Error("Selecione os objetos e informe de 1 a 20 cópias.");
  if (distance(offset, { x: 0, y: 0, z: 0 }) < tolerance)
    throw new Error("Informe um deslocamento para replicar.");
  if (p.mode === "planar" && offset.y !== 0)
    throw new Error(
      "A replicação de um projeto plano precisa permanecer em XZ.",
    );
  const nodeIds = new Set(
    selection.filter((s) => s.kind === "node").map((s) => s.id),
  );
  const selectedNodes = [...nodeIds];
  const memberIds = new Set(
    selection.filter((s) => s.kind === "member").map((s) => s.id),
  );
  const bars = p.members.filter((m) => memberIds.has(m.id));
  if (p.members.length + bars.length * copies > 1000)
    throw new Error("A replicação ultrapassa o limite de 1.000 barras.");
  for (const bar of bars) {
    nodeIds.add(bar.start);
    nodeIds.add(bar.end);
  }
  const source = p.nodes.filter((n) => nodeIds.has(n.id));
  const result: SelectedObject[] = [];
  for (let i = 1; i <= copies; i++) {
    const delta = scale(offset, i);
    const ids = new Map(
      source.map((n) => [n.id, addPoint(p, add(n, delta)).id]),
    );
    if (p.nodes.length > 1000)
      throw new Error("A replicação ultrapassa o limite de 1.000 nós.");
    for (const id of selectedNodes)
      result.push({ kind: "node", id: ids.get(id)! });
    for (const bar of bars) {
      const m = appendMember(p, {
        start: ids.get(bar.start)!,
        end: ids.get(bar.end)!,
        sectionId: bar.sectionId,
        roll: bar.roll,
      });
      result.push({ kind: "member", id: m.id });
    }
  }
  return [...new Map(result.map((s) => [`${s.kind}:${s.id}`, s])).values()];
}

function crossing(a: Point3, b: Point3, c: Point3, d: Point3) {
  const ab = subtract(b, a),
    cd = subtract(d, c);
  const la = length(ab),
    lb = length(cd);
  if (la < tolerance || lb < tolerance) return null;
  const u = scale(ab, 1 / la),
    v = scale(cd, 1 / lb);
  const normal = cross(u, v);
  const denominator = dot(normal, normal);
  const offset = subtract(c, a);
  if (denominator < 1e-20) {
    if (length(cross(offset, u)) >= tolerance) return null;
    const s = dot(offset, u),
      t = dot(subtract(d, a), u);
    const overlap = Math.min(la, Math.max(s, t)) - Math.max(0, Math.min(s, t));
    return overlap > tolerance ? "overlap" : null;
  }
  const s = dot(cross(offset, v), normal) / denominator;
  const t = dot(cross(offset, u), normal) / denominator;
  if (
    s <= tolerance ||
    s >= la - tolerance ||
    t <= tolerance ||
    t >= lb - tolerance
  )
    return null;
  const p = add(a, scale(u, s)),
    q = add(c, scale(v, t));
  return distance(p, q) < tolerance ? scale(add(p, q), 0.5) : null;
}

export function connectIntersections(p: Project) {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const segments = p.members.map((m) => ({
    m,
    a: nodes.get(m.start)!,
    b: nodes.get(m.end)!,
  }));
  const initialNodes = p.nodes.length;
  for (let i = 0; i < segments.length; i++) {
    const first = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const second = segments[j];
      const point = crossing(first.a, first.b, second.a, second.b);
      if (point === "overlap")
        throw new Error(
          `Barras sobrepostas: ${first.m.name} e ${second.m.name}. Ajuste a geometria antes de conectar.`,
        );
      if (point) {
        addPoint(p, point);
        if (p.nodes.length > 1000)
          throw new Error(
            "A conexão de interseções ultrapassa o limite de 1.000 nós.",
          );
      }
    }
  }
  const split = new Map<string, string[]>();
  let barCount = p.members.length;
  const usedNames = [...p.members];
  p.members = segments.flatMap(({ m, a, b }) => {
    const interior = p.nodes
      .flatMap((n) => {
        if (n.id === a.id || n.id === b.id) return [];
        const t = interiorParameter(n, a, b);
        return t === null ? [] : [{ id: n.id, t }];
      })
      .sort((x, y) => x.t - y.t);
    if (!interior.length) return [m];
    barCount += interior.length;
    if (barCount > 1000)
      throw new Error(
        "A conexão de interseções ultrapassa o limite de 1.000 barras.",
      );
    const joints = [a.id, ...interior.map((n) => n.id), b.id];
    const children = joints.slice(0, -1).map((start, i) => {
      const child = { ...m, start, end: joints[i + 1] };
      if (i > 0) {
        child.id = uid();
        child.name = nextName("B", usedNames);
        usedNames.push(child);
      }
      return child;
    });
    split.set(
      m.id,
      children.map((bar) => bar.id),
    );
    return children;
  });
  for (const pat of p.loadPatterns) {
    pat.uniform = pat.uniform.flatMap((l) =>
      (split.get(l.memberId) ?? [l.memberId]).map((memberId) => ({
        ...l,
        memberId,
      })),
    );
  }
  return { joints: p.nodes.length - initialNodes, divided: split.size };
}
