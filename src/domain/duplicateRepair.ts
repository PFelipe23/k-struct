import { distance, tolerance } from "./geometry";
import {
  endpoints,
  mergeMap,
  mergeGroups,
  overlapLength,
  pairKey,
  stagedMembers,
  type Merge,
} from "./duplicateGeometry";
import { remapGroups } from "./editing";
import {
  projectSchema,
  referenceErrors,
  free,
  type NodalLoad,
  type UniformLoad,
  type Member,
  type Project,
  type StructuralNode,
} from "./model";
import { sameSupportAxes } from "./supports";

export type Decisions = {
  nodes: Merge[];
  members: Merge[];
  removeNull: string[];
  answers: Record<string, string>;
};
export const noRepairs = (): Decisions => ({
  nodes: [],
  members: [],
  removeNull: [],
  answers: {},
});
type Option = { value: string; label: string };
export type Question = {
  key: string;
  title: string;
  options: Option[];
  value: string;
};
type Item = { id: string; name: string };
export const named = (item: Item) => `${item.name} [${item.id}]`;
const dofs = Object.keys(free()) as (keyof ReturnType<typeof free>)[];
const hasRestraints = (n: StructuralNode) => dofs.some((k) => n.restraints[k]);
export const supportText = (node: StructuralNode) => {
  const keys = dofs
    .filter((k) => node.restraints[k])
    .map((k) => k.toUpperCase())
    .join(", ");
  return keys
    ? `${keys} · ${node.supportFrame ? "referencial local" : "referencial global"}`
    : "livre";
};
export const loadText = (row: NodalLoad | UniformLoad) =>
  "nodeId" in row
    ? `F (N) = [${[row.fx, row.fy, row.fz].join(", ")}], M (N·m) = [${[row.mx, row.my, row.mz].join(", ")}]`
    : `q (N/m) = [${[row.qx, row.qy, row.qz].join(", ")}]`;
const sourceOption = (item: Item) => ({
  value: "use:" + item.id,
  label: "Usar " + named(item),
});
const acknowledge = [{ value: "confirm", label: "Confirmar esta decisão" }];
export function planRepair(
  stage: ReturnType<typeof stagedMembers>,
  choices: Pick<Decisions, "members" | "removeNull" | "answers">,
) {
  const source = stage.source;
  const p = structuredClone(source),
    members = new Map(source.members.map((m) => [m.id, m])),
    nodes = new Map(source.nodes.map((n) => [n.id, n]));
  const changedNode = stage.map,
    changedMember = mergeMap(choices.members);
  const candidate = new Map(stage.members.map((m) => [m.id, m]));
  const questions: Question[] = [],
    notes: string[] = [],
    blocking: string[] = [];
  function ask(parts: string[], title: string, options: Option[]) {
    const key = JSON.stringify(parts),
      answer = choices.answers[key];
    const value = options.some((o) => o.value === answer) ? answer : "";
    questions.push({ key, title, options, value });
    return value;
  }
  for (const [drop, keep] of changedMember) {
    const a = candidate.get(drop),
      b = candidate.get(keep);
    if (!a || !b || endpoints(a) !== endpoints(b) || stage.nulls.includes(drop))
      throw new Error(
        "As barras escolhidas precisam ter as mesmas extremidades após as uniões de nós.",
      );
  }
  const removed = new Set(choices.removeNull);
  for (const id of removed)
    if (!stage.nulls.includes(id))
      throw new Error("A barra marcada para exclusão já não é nula.");
  p.members = stage.members
    .filter((m) => !changedMember.has(m.id) && !removed.has(m.id))
    .map((m) => ({ ...m }));
  p.nodes = p.nodes.filter((n) => !changedNode.has(n.id));
  const survivingMembers = new Map(p.members.map((m) => [m.id, m]));
  const mappedLinks = new Map<string, Project["meshConnections"][number]>();
  for (const link of p.meshConnections) {
    const nodeId = changedNode.get(link.nodeId) ?? link.nodeId;
    const memberId = changedMember.get(link.memberId) ?? link.memberId;
    const m = survivingMembers.get(memberId);
    if (m && nodeId !== m.start && nodeId !== m.end)
      mappedLinks.set(memberId + ":" + nodeId, { memberId, nodeId });
  }
  p.meshConnections = [...mappedLinks.values()];
  const nodeDraft = new Map(p.nodes.map((n) => [n.id, n]));
  type Load = NodalLoad | UniformLoad;
  // Preserve independent load records. The solver sums records only when the user chooses to.
  function resolveRows<T extends Load>(
    rows: T[],
    ids: string[],
    items: Map<string, Item>,
    key: "nodeId" | "memberId",
    pattern: Item,
  ) {
    const keep = ids[0],
      idOf = (row: T) =>
        key === "nodeId"
          ? (row as NodalLoad).nodeId
          : (row as UniformLoad).memberId;
    const inGroup = new Set(ids),
      values = rows.filter((row) => inGroup.has(idOf(row)));
    if (!values.length) return rows;

    const contributors = new Set(
      values
        .filter((row) =>
          Object.entries(row).some(([field, v]) => field !== key && v !== 0),
        )
        .map(idOf),
    );
    let policy = "all";
    if (contributors.size > 1)
      policy = ask(
        [key, "loads", pattern.id, ...ids],
        `Cargas em ${named(pattern)} para ${named(items.get(keep)!)}`,
        [
          { value: "all", label: "Somar as ações globais de todas as origens" },
          ...ids.map((id) => sourceOption(items.get(id)!)),
        ],
      );
    for (const row of values) {
      const destination = !policy
        ? "aguarda decisão"
        : policy === "all" || policy === "use:" + idOf(row)
          ? named(items.get(keep)!)
          : "descartar";
      notes.push(
        `${named(pattern)} · ${named(items.get(idOf(row))!)} → ${destination} · ${loadText(row)}`,
      );
    }
    return rows.flatMap((row) =>
      !inGroup.has(idOf(row))
        ? [row]
        : policy === "all" || policy === "use:" + idOf(row)
          ? [{ ...row, [key]: keep }]
          : [],
    );
  }
  for (const [keep, ids] of mergeGroups(changedNode)) {
    const dst = nodeDraft.get(keep)!,
      label = named(dst),
      supports = ids.map((id) => nodes.get(id)!);
    for (const n of supports)
      notes.push(`Apoio · ${named(n)} → ${label} · ${supportText(n)}`);
    const restrained = supports.filter(hasRestraints);
    const targetFrame = (hasRestraints(dst) ? dst : restrained[0])
      ?.supportFrame;
    const canUnion = restrained.every((n) =>
      sameSupportAxes(n.supportFrame, targetFrame),
    );
    if (
      !canUnion ||
      supports.some((n) =>
        dofs.some((k) => n.restraints[k] !== dst.restraints[k]),
      )
    ) {
      const value = ask(
        ["supports", ...ids],
        `Vínculos diferentes em ${label}`,
        [
          ...(canUnion
            ? [
                {
                  value: "union",
                  label: "Unir os graus de liberdade restringidos",
                },
              ]
            : []),
          ...supports.map(sourceOption),
        ],
      );
      if (value === "union") {
        if (targetFrame) dst.supportFrame = targetFrame;
        else delete dst.supportFrame;
        for (const k of dofs)
          dst.restraints[k] = supports.some((n) => n.restraints[k]);
      } else if (value) {
        const chosen = nodes.get(value.slice(4))!;
        dst.restraints = { ...chosen.restraints };
        if (chosen.supportFrame) dst.supportFrame = chosen.supportFrame;
        else delete dst.supportFrame;
      }
      if (value) notes.push(`Apoio final · ${label} · ${supportText(dst)}`);
    }
    for (const pat of p.loadPatterns)
      pat.nodal = resolveRows(pat.nodal, ids, nodes, "nodeId", pat);
  }
  for (const m of stage.members) {
    const old = members.get(m.id)!;
    if (m.start !== old.start || m.end !== old.end) {
      const span = distance(nodes.get(m.start)!, nodes.get(m.end)!);
      notes.push(
        `Incidência · ${named(m)} · ${old.start} → ${old.end} passa a ${m.start} → ${m.end} · ${span.toPrecision(6)} m`,
      );
      if (
        !removed.has(m.id) &&
        !changedMember.has(m.id) &&
        !choices.members.some((pair) => pair.keep === m.id)
      ) {
        for (const pat of source.loadPatterns)
          for (const l of pat.uniform.filter((row) => row.memberId === m.id))
            notes.push(
              `${named(pat)} · mantida em ${named(m)} na nova extensão · ${loadText(l)}`,
            );
      }
    }
  }
  for (const [keep, ids] of mergeGroups(changedMember)) {
    const dst = members.get(keep)!;
    notes.push(
      ...ids.map((id) => `Barra · ${named(members.get(id)!)} → ${named(dst)}`),
    );
    if (
      ids.some((id) => {
        const m = members.get(id)!;
        return (
          m.sectionId !== dst.sectionId ||
          m.roll !== dst.roll ||
          (m.roll !== 0 &&
            candidate.get(id)!.start !== candidate.get(keep)!.start)
        );
      })
    ) {
      ask(
        ["section", ...ids],
        `Conservar a seção ${dst.sectionId}, a rotação de ${dst.roll}° e o sentido de ${named(dst)}`,
        acknowledge,
      );
    }
    for (const pat of p.loadPatterns)
      pat.uniform = resolveRows(pat.uniform, ids, members, "memberId", pat);
  }
  for (const id of stage.nulls) {
    const m = members.get(id)!;
    if (removed.has(id)) {
      notes.push(`Excluir barra nula · ${named(m)}`);
      for (const pat of p.loadPatterns) {
        for (const l of pat.uniform.filter((l) => l.memberId === id))
          notes.push(
            `${named(pat)} · excluir carga de ${named(m)} · ${loadText(l)}`,
          );
        pat.uniform = pat.uniform.filter((l) => l.memberId !== id);
      }
    } else if (distance(nodes.get(m.start)!, nodes.get(m.end)!) >= tolerance)
      blocking.push(
        `${named(m)} ficaria com comprimento nulo. Confirme sua exclusão com as referências listadas ou retire a união de nós.`,
      );
  }
  for (const peers of stage.byEnds.values()) {
    const remaining = peers.filter((m) => !changedMember.has(m.id));
    if (new Set(remaining.map((m) => endpoints(members.get(m.id)!))).size > 1) {
      ask(
        ["duplicates", ...remaining.map((m) => m.id)],
        `A união cria barras duplicadas: ${remaining.map(named).join(", ")}. Una as duplicatas ou escolha mantê-las independentes.`,
        [{ value: "confirm", label: "Manter essas barras independentes" }],
      );
    }
  }
  if (changedNode.size) {
    const checked = new Set<string>();
    const span = (m: Member, other: Member) =>
      overlapLength(
        nodes.get(m.start)!,
        nodes.get(m.end)!,
        nodes.get(other.start)!,
        nodes.get(other.end)!,
      );
    for (const m of p.members) {
      const original = members.get(m.id)!;
      if (m.start === original.start && m.end === original.end) continue;
      for (const other of p.members) {
        const key = pairKey(m.id, other.id);
        if (
          m.id === other.id ||
          checked.has(key) ||
          endpoints(m) === endpoints(other)
        )
          continue;
        checked.add(key);
        const overlap = span(m, other);
        if (
          overlap > tolerance &&
          Math.abs(span(original, members.get(other.id)!) - overlap) > 1e-12
        ) {
          ask(
            ["overlap", key],
            `Sobreposição de ${overlap.toPrecision(5)} m entre ${named(m)} e ${named(other)}. Retire a união para corrigir a extensão ou confirme a sobreposição.`,
            [{ value: "confirm", label: "Manter ambas as barras sobrepostas" }],
          );
        }
      }
    }
  }
  const index = (map: Map<string, string>) =>
    new Map([...map].map(([from, to]) => [from, [to]]));
  const nodeRefs = index(changedNode),
    memberRefs = index(changedMember);
  for (const id of removed) memberRefs.set(id, []);
  for (const group of source.selectionGroups)
    for (const obj of group.objects) {
      const ids =
        obj.kind === "member"
          ? memberRefs.get(obj.id)
          : obj.kind === "node"
            ? nodeRefs.get(obj.id)
            : undefined;
      if (ids)
        notes.push(
          `Grupo ${named(group)} · ${obj.id} → ${ids[0] ?? "removido"}`,
        );
    }
  remapGroups(p, "node", nodeRefs);
  remapGroups(p, "member", memberRefs);
  const changes = changedNode.size + changedMember.size + removed.size;
  if (changes) {
    if (!projectSchema.safeParse(p).success)
      blocking.push("A correção excede os limites do projeto.");
    blocking.push(...referenceErrors(p));
  }
  const ready =
    changes > 0 && !blocking.length && questions.every((q) => q.value);
  return {
    source,
    project: ready ? p : null,
    questions,
    notes,
    blocking,
    changes,
  };
}
