import { selectionKey } from "./selection";
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
  appendMember,
  nextName,
  uid,
  type Member,
  type Project,
  type Slab,
} from "./model";

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

export { replicate } from "./transform";

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
  const cuts = new Map<string, string[]>();
  for (const { m, a, b } of segments) {
    const interior = p.nodes
      .flatMap((n) => {
        if (n.id === a.id || n.id === b.id) return [];
        const t = interiorParameter(n, a, b);
        return t === null ? [] : [{ id: n.id, t }];
      })
      .sort((x, y) => x.t - y.t);
    if (interior.length)
      cuts.set(
        m.id,
        interior.map((n) => n.id),
      );
  }
  splitMembers(p, cuts);
  return { joints: p.nodes.length - initialNodes, divided: cuts.size };
}

// Cut nodes are ordered from i to j. The first span inherits the physical member ID.
export function splitMembers(p: Project, cuts: Map<string, string[]>) {
  const split = new Map<string, string[]>();
  let barCount = p.members.length;
  const usedNames = [...p.members];
  p.members = p.members.flatMap((m) => {
    const interior = cuts.get(m.id);
    if (!interior?.length) return [m];

    barCount += interior.length;
    if (barCount > 1000)
      throw new Error(
        "A conexão de interseções ultrapassa o limite de 1.000 barras.",
      );
    const joints = [m.start, ...interior, m.end];
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
  remapGroups(p, "member", split);
  return split;
}

export function remapGroups(
  p: Project,
  kind: "member" | "node",
  replacements: Map<string, string[]>,
) {
  for (const group of p.selectionGroups) {
    const mapped = group.objects.flatMap((obj) =>
      obj.kind === kind && replacements.has(obj.id)
        ? replacements.get(obj.id)!.map((id) => ({ kind, id }))
        : [obj],
    );
    group.objects = [
      ...new Map(mapped.map((obj) => [selectionKey(obj), obj])).values(),
    ];
  }
}
