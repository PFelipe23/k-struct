import { centeredOffsets, memberAxis, setOffsets } from "./memberOffsets";
import {
  add,
  beamAxes,
  coordinates,
  cross,
  distance,
  dot,
  interiorParameter,
  length,
  origin,
  scale,
  subtract,
  tolerance,
  type Coordinate,
  type Point3,
} from "./geometry";
import {
  addPoint,
  projectSchema,
  referenceErrors,
  type Member,
  type Project,
  type StructuralNode,
} from "./model";
import { remapGroups, splitMembers } from "./editing";

export type GeometricReference =
  | { kind: "coordinate"; axis: Coordinate; value: number }
  | { kind: "node" | "member"; id: string };
export type MemberCommand =
  | {
      kind: "split";
      id: string;
      reference: GeometricReference | { kind: "distance"; metres: number };
    }
  | { kind: "join"; ids: string[] }
  | {
      kind: "trim" | "extend";
      id: string;
      end: "start" | "end";
      reference: GeometricReference;
    };
export type MemberEdit = {
  source: Project;
  project: Project;
  before: string[];
  after: string[];
  selected: string[];
  note: string;
};
type NodeIndex = Map<string, StructuralNode>;
const nodeIndex = (p: Project): NodeIndex =>
  new Map(p.nodes.map((n) => [n.id, n]));
function along(a: Point3, b: Point3) {
  const v = subtract(b, a),
    span = length(v);
  if (span <= tolerance) throw new Error("A barra tem comprimento nulo.");
  return scale(v, 1 / span);
}
function memberById(p: Project, id: string) {
  const m = p.members.find((m) => m.id === id);
  if (!m) throw new Error("Escolha uma barra existente.");
  return m;
}
function referencePoint(
  p: Project,
  nodes: NodeIndex,
  m: Member,
  reference: Exclude<MemberCommand, { kind: "join" }>["reference"],
) {
  const a = nodes.get(m.start)!,
    b = nodes.get(m.end)!,
    u = along(a, b);
  let d: number;
  switch (reference.kind) {
    case "distance":
      d = reference.metres;
      break;
    case "coordinate":
      if (Math.abs(u[reference.axis]) < 1e-12)
        throw new Error(
          "A coordenada escolhida não define um corte único neste eixo de barra.",
        );
      d = (reference.value - a[reference.axis]) / u[reference.axis];
      break;
    case "node": {
      const n = nodes.get(reference.id);
      if (!n) throw new Error("Escolha o nó de referência.");
      const delta = subtract(n, a);
      if (length(cross(delta, u)) >= tolerance)
        throw new Error(
          "O nó de referência está fora da reta da barra em XYZ.",
        );
      return n;
    }
    case "member": {
      if (reference.id === m.id)
        throw new Error("Escolha outra barra como referência.");
      const ref = memberById(p, reference.id),
        c = nodes.get(ref.start)!,
        e = nodes.get(ref.end)!;
      const v = along(c, e),
        n = cross(u, v),
        den = dot(n, n),
        delta = subtract(c, a);
      if (den < 1e-20)
        throw new Error(
          "Barras paralelas ou colineares não definem um corte único. Use um nó ou uma coordenada.",
        );
      d = dot(cross(delta, v), n) / den;
      const t = dot(cross(delta, u), n) / den;
      if (
        t < -tolerance ||
        t > distance(c, e) + tolerance ||
        distance(add(a, scale(u, d)), add(c, scale(v, t))) >= tolerance
      )
        throw new Error(
          "Sem interseção real com o segmento de referência em XYZ.",
        );
      break;
    }
  }
  const point = add(a, scale(u, d));
  if (!coordinates.every((k) => Number.isFinite(point[k])))
    throw new Error("Informe uma posição finita em metros.");
  return point;
}

function protectJoint(p: Project, n: StructuralNode, allowed: Set<string>) {
  const other = p.members.find(
    (m) => !allowed.has(m.id) && (m.start === n.id || m.end === n.id),
  );
  if (other)
    throw new Error(
      `${n.name} também conecta ${other.name}. A operação desfaria essa ligação.`,
    );
  if (p.meshConnections.some((l) => l.nodeId === n.id))
    throw new Error(
      `${n.name} tem uma conexão da malha. Remova a conexão antes de alterar a extremidade.`,
    );
  if (Object.values(n.restraints).some(Boolean))
    throw new Error(
      `${n.name} tem apoio. A operação alteraria a posição ou eliminaria o vínculo.`,
    );
  const pattern = p.loadPatterns.find((pat) =>
    pat.nodal.some(
      (l) =>
        l.nodeId === n.id &&
        [l.fx, l.fy, l.fz, l.mx, l.my, l.mz].some((v) => v !== 0),
    ),
  );
  if (pattern)
    throw new Error(
      `${n.name} tem carga nodal no padrão ${pattern.name}. Preserve esse ponto de aplicação.`,
    );
}
function discardNodes(p: Project, removed: Set<string>, replacement?: string) {
  p.nodes = p.nodes.filter((n) => !removed.has(n.id));
  for (const pat of p.loadPatterns)
    pat.nodal = pat.nodal.filter((l) => !removed.has(l.nodeId));
  remapGroups(
    p,
    "node",
    new Map([...removed].map((id) => [id, replacement ? [replacement] : []])),
  );
}
export function memberIntensity(
  pattern: Project["loadPatterns"][number],
  id: string,
): Point3 {
  return pattern.uniform
    .filter((l) => l.memberId === id)
    .reduce(
      (q, l) => ({ x: q.x + l.qx, y: q.y + l.qy, z: q.z + l.qz }),
      origin,
    );
}
// Reject duplicate or overlapping spans involving edited members. Unrelated geometry is untouched.
function checkOverlaps(p: Project, affected: string[]) {
  const nodes = nodeIndex(p);
  for (const id of affected) {
    const m = memberById(p, id),
      a = nodes.get(m.start)!,
      b = nodes.get(m.end)!,
      u = along(a, b),
      span = distance(a, b);
    for (const other of p.members) {
      if (other.id === id) continue;
      const c = subtract(nodes.get(other.start)!, a),
        d = subtract(nodes.get(other.end)!, a);
      if (length(cross(c, u)) >= tolerance || length(cross(d, u)) >= tolerance)
        continue;
      const x = dot(c, u),
        y = dot(d, u);
      if (
        Math.min(span, Math.max(x, y)) - Math.max(0, Math.min(x, y)) >
        tolerance
      )
        throw new Error(`A operação sobreporia ${m.name} e ${other.name}.`);
    }
  }
}
type Change = Omit<MemberEdit, "source" | "project">;
function join(p: Project, ids: string[], nodes: NodeIndex): Change {
  const selected = new Set(ids),
    bars = p.members.filter((m) => selected.has(m.id));
  if (bars.length < 2 || bars.length !== selected.size)
    throw new Error("Selecione pelo menos duas barras de uma cadeia contínua.");
  const survivor = bars[0],
    a = nodes.get(survivor.start)!,
    b = nodes.get(survivor.end)!;
  const [axis] = beamAxes(a, b, survivor.roll);
  const line = memberAxis(survivor, a, b);
  const [, , z] = beamAxes(line.start, line.end, survivor.roll);
  const ends = new Set(bars.flatMap((m) => [m.start, m.end]));
  const stations = [...ends]
    .map((id) => {
      const delta = subtract(nodes.get(id)!, a);
      if (length(cross(delta, axis)) >= tolerance)
        throw new Error("A cadeia precisa ser colinear em XYZ.");
      return { id, d: dot(delta, axis) };
    })
    .sort((a, b) => a.d - b.d);
  const order = new Map(stations.map((s, i) => [s.id, i]));
  const intervals = new Set<number>();
  for (const m of bars) {
    const i = order.get(m.start)!,
      j = order.get(m.end)!;
    if (Math.abs(i - j) !== 1 || intervals.has(Math.min(i, j)))
      throw new Error("A cadeia tem lacuna, ramificação ou sobreposição.");
    intervals.add(Math.min(i, j));
    if (m.sectionId !== survivor.sectionId)
      throw new Error("As barras precisam ter a mesma seção.");
    const segment = memberAxis(m, nodes.get(m.start)!, nodes.get(m.end)!);
    const [, , localZ] = beamAxes(segment.start, segment.end, m.roll);
    if (length(cross(z, localZ)) > 1e-8)
      throw new Error("As barras têm orientações de seção incompatíveis.");
  }
  if (
    intervals.size !== stations.length - 1 ||
    stations.some((s, i) => i > 0 && s.d - stations[i - 1].d <= tolerance)
  )
    throw new Error("A cadeia tem lacuna ou nós coincidentes sem ligação.");
  const interior = new Set(stations.slice(1, -1).map((s) => s.id));
  for (const id of interior) protectJoint(p, nodes.get(id)!, selected);
  for (const pat of p.loadPatterns) {
    const q = memberIntensity(pat, survivor.id);
    for (const m of bars) {
      const other = memberIntensity(pat, m.id);
      if (
        coordinates.some(
          (k) =>
            Math.abs(other[k] - q[k]) >
            32 *
              Number.EPSILON *
              Math.max(1, Math.abs(q[k]), Math.abs(other[k])),
        )
      )
        throw new Error(
          `As intensidades de carga diferem no padrão ${pat.name}.`,
        );
    }
    pat.uniform = pat.uniform.filter(
      (l) => !selected.has(l.memberId) || l.memberId === survivor.id,
    );
  }
  if (bars.some((m) => m.offsets)) {
    const first = stations[0],
      last = stations.at(-1)!;
    const endsAt = (id: string) =>
      bars.flatMap((m) => {
        const e = m.offsets ?? centeredOffsets;
        if (m.start === id) return [e.i];
        if (m.end === id) return [e.j];
        return [];
      });
    const [i] = endsAt(first.id),
      [j] = endsAt(last.id);
    for (const station of stations.slice(1, -1)) {
      const t = (station.d - first.d) / (last.d - first.d);
      const expected = add(
        i.eccentricity,
        scale(subtract(j.eccentricity, i.eccentricity), t),
      );
      if (
        endsAt(station.id).some(
          (e) =>
            e.rigidLength || distance(e.eccentricity, expected) > tolerance,
        )
      )
        throw new Error(
          "A união precisa preservar um único eixo de inserção e os trechos rígidos nas pontas externas.",
        );
    }
    setOffsets(survivor, { i, j });
  }
  survivor.start = stations[0].id;
  survivor.end = stations.at(-1)!.id;
  p.members = p.members.filter(
    (m) => !selected.has(m.id) || m.id === survivor.id,
  );
  for (const link of p.meshConnections)
    if (selected.has(link.memberId)) link.memberId = survivor.id;
  discardNodes(p, interior);
  remapGroups(p, "member", new Map(bars.map((m) => [m.id, [survivor.id]])));
  return {
    before: bars.map((m) => m.id),
    after: [survivor.id],
    selected: [survivor.id],
    note: `${survivor.name} conserva o ID e o sentido i → j. Nós intermediários removidos: ${interior.size}.`,
  };
}
function editEndOrSplit(
  p: Project,
  cmd: Exclude<MemberCommand, { kind: "join" }>,
  nodes: NodeIndex,
): Change {
  const m = memberById(p, cmd.id),
    a = nodes.get(m.start)!,
    b = nodes.get(m.end)!;
  const point = referencePoint(p, nodes, m, cmd.reference);
  const oldSpan = distance(a, b),
    d = dot(subtract(point, a), along(a, b));
  const matches = p.nodes.filter((n) => distance(n, point) < tolerance);
  if (matches.length > 1)
    throw new Error(
      "Mais de um nó coincide com o destino. Resolva a ambiguidade antes de editar.",
    );
  let joint: StructuralNode;
  if (cmd.kind === "split") {
    if (d <= tolerance || d >= oldSpan - tolerance)
      throw new Error("A divisão precisa estar no interior da barra.");
    joint = matches[0] ?? addPoint(p, point);
  } else {
    const old = cmd.end === "start" ? a : b,
      fixed = cmd.end === "start" ? b : a;
    const span = cmd.end === "start" ? oldSpan - d : d;
    if (span <= tolerance)
      throw new Error(
        "A referência alcança ou ultrapassa a extremidade oposta.",
      );
    if (
      cmd.kind === "trim"
        ? span >= oldSpan - tolerance
        : span <= oldSpan + tolerance
    )
      throw new Error(
        cmd.kind === "trim"
          ? "Para aparar, indique uma posição entre as extremidades."
          : "Para prolongar, indique uma posição além da extremidade escolhida.",
      );
    protectJoint(p, old, new Set([m.id]));
    if (
      cmd.kind === "extend" &&
      p.nodes.some(
        (n) => n.id !== old.id && interiorParameter(n, old, point) !== null,
      )
    )
      throw new Error(
        "Há um nó entre a ponta e a referência. Prolongue primeiro até esse nó para preservar a conectividade.",
      );
    joint = matches[0] ?? old;
    if (joint.id === fixed.id)
      throw new Error("A barra ficaria com comprimento nulo.");
    if (joint === old)
      Object.assign(old, { x: point.x, y: point.y, z: point.z });
    else {
      m[cmd.end] = joint.id;
      p.meshConnections = p.meshConnections.filter(
        (l) => l.memberId !== m.id || l.nodeId !== joint.id,
      );
      discardNodes(p, new Set([old.id]), joint.id);
    }
  }
  // Every physical member passing through the new joint must use the very same node.
  const cuts = new Map<string, string[]>();
  for (const bar of p.members) {
    if (bar.start === joint.id || bar.end === joint.id) continue;
    if (
      interiorParameter(joint, nodes.get(bar.start)!, nodes.get(bar.end)!) !==
      null
    )
      cuts.set(bar.id, [joint.id]);
  }
  if (cmd.kind === "split" && !cuts.has(m.id))
    throw new Error(
      "O nó de corte precisa estar no interior da barra, fora da tolerância das pontas.",
    );
  const children = splitMembers(p, cuts);
  const before = [...new Set([m.id, ...cuts.keys()])];
  const selected = children.get(m.id) ?? [m.id];
  return {
    before,
    after: before.flatMap((id) => children.get(id) ?? [id]),
    selected,
    note:
      cmd.kind === "split"
        ? `${joint.name} é o nó de corte. O trecho a partir de i conserva o ID de ${m.name}.`
        : `${m.name} conserva o ID. Nova extremidade ${cmd.end === "start" ? "i" : "j"} em ${joint.name}.`,
  };
}
export function planMemberEdit(
  source: Project,
  command: MemberCommand,
): MemberEdit {
  const project = structuredClone(source),
    nodes = nodeIndex(project);
  const change =
    command.kind === "join"
      ? join(project, command.ids, nodes)
      : editEndOrSplit(project, command, nodes);
  checkOverlaps(project, change.after);
  if (!projectSchema.safeParse(project).success)
    throw new Error(
      "A operação excede os limites de nós, barras ou cargas do projeto.",
    );
  const errors = referenceErrors(project);
  if (errors.length) throw new Error(errors.join("\n"));
  return { source, project, ...change };
}
