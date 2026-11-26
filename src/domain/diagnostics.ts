import { analysisErrors, type Project, type SelectedObject } from "./model";
import { connectionStations } from "./beamMesh";
import type { AnalysisInput } from "../solver/oofem";

export type DiagnosticStage = "modelo" | "solver";
export type DiagnosticConfidence = "confirmado" | "possível";

export interface AnalysisDiagnostic {
  id: string;
  stage: DiagnosticStage;
  message: string;
  severity: "erro" | "aviso";
  objects: SelectedObject[];
  confidence: DiagnosticConfidence;
  action: string;
}

function componentObjects(project: Project, seedId: string): SelectedObject[] {
  const graph = new Map(project.nodes.map(({ id }) => [id, new Set<string>()]));
  const stations = connectionStations(project);
  for (const member of project.members) {
    const chain = [
      member.start,
      ...(stations.get(member.id) ?? []).map(({ nodeId }) => nodeId),
      member.end,
    ];
    for (let index = 1; index < chain.length; index++) {
      const a = graph.get(chain[index - 1]);
      const b = graph.get(chain[index]);
      if (a && b) {
        a.add(chain[index]);
        b.add(chain[index - 1]);
      }
    }
  }
  const found = new Set<string>();
  const stack = graph.has(seedId) ? [seedId] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (found.has(id)) continue;
    found.add(id);
    stack.push(...(graph.get(id) ?? []));
  }
  const nodes = project.nodes
    .filter(({ id }) => found.has(id))
    .map(({ id }) => ({ kind: "node" as const, id }));
  const members = project.members
    .filter((member) => found.has(member.start) && found.has(member.end))
    .map(({ id }) => ({ kind: "member" as const, id }));
  return [...nodes, ...members];
}

function objectsForMessage(
  project: Project,
  message: string,
): SelectedObject[] {
  if (message === "Remova ou conecte os nós isolados antes de analisar.") {
    const connected = new Set<string>();
    const stations = connectionStations(project);
    for (const floor of project.diaphragms ?? [])
      for (const id of floor.nodeIds) connected.add(id);
    for (const node of project.nodes)
      if (node.foundation) connected.add(node.id);
    for (const member of project.members) {
      connected.add(member.start);
      connected.add(member.end);
      for (const station of stations.get(member.id) ?? [])
        connected.add(station.nodeId);
    }
    return project.nodes
      .filter(({ id }) => !connected.has(id))
      .map(({ id }) => ({ kind: "node", id }));
  }
  const markers = [
    ...project.members.map((item) => ({ ...item, kind: "member" as const })),
    ...project.nodes.map((item) => ({ ...item, kind: "node" as const })),
    ...project.slabs.map((item) => ({ ...item, kind: "slab" as const })),
  ].filter(
    (item) =>
      message.startsWith(`${item.name}:`) ||
      message.startsWith(`${item.name} (${item.id}):`),
  );
  if (markers.length === 1)
    return [{ kind: markers[0].kind, id: markers[0].id }];
  if (markers.length > 1) return [];
  const isolatedNodes = project.nodes.filter(({ name }) =>
    message.startsWith(`${name} está isolado`),
  );
  if (isolatedNodes.length === 1) {
    const [isolated] = isolatedNodes;
    const hostName = message.match(/interior de (.+?)\. Use Conexões/)?.[1];
    const hosts = project.members.filter(({ name }) => name === hostName);
    const host = hosts.length === 1 ? hosts[0] : undefined;
    return [
      { kind: "node", id: isolated.id },
      ...(host ? [{ kind: "member" as const, id: host.id }] : []),
    ];
  }
  const supported = message.match(
    /^Estrutura ligada a (.+?): apoios insuficientes/,
  );
  if (supported) {
    const seeds = project.nodes.filter(({ name }) => name === supported[1]);
    if (seeds.length === 1) return componentObjects(project, seeds[0].id);
  }
  return [];
}

export function diagnoseModel(project: Project): AnalysisDiagnostic[] {
  return analysisErrors(project).map((message, index) => {
    const objects = objectsForMessage(project, message);
    const identified = objects
      .map((object) =>
        object.kind === "node"
          ? project.nodes.find(({ id }) => id === object.id)?.name
          : project.members.find(({ id }) => id === object.id)?.name,
      )
      .filter((name): name is string => Boolean(name));
    return {
      id: `modelo-${index}`,
      stage: "modelo",
      message:
        identified.length && !message.includes(identified[0])
          ? `${message} Objetos identificados: ${identified.join(", ")}.`
          : message,
      severity: "erro",
      objects,
      confidence: objects.length ? "confirmado" : "possível",
      action: objects.length
        ? "Inspecione os objetos destacados e corrija a condição indicada."
        : "Confira conexões, apoios e graus de liberdade; a causa não foi associada a uma peça específica.",
    };
  });
}

export function diagnoseSolverFailure(
  message: string,
  stdout: string,
  stderr: string,
  input?: AnalysisInput,
): AnalysisDiagnostic[] {
  const raw = [message, stdout, stderr].filter(Boolean).join("\n");
  const singular = /singular|zero pivot|pivot.*zero|rank deficient/i.test(raw);
  const failureLines = raw
    .split(/\r?\n/)
    .filter((line) =>
      /error|fatal|failed|failure|singular|zero pivot|pivot.*zero|rank deficient|incompat/i.test(
        line,
      ),
    )
    .join("\n");
  const objects = new Map<string, SelectedObject>();
  for (const match of failureLines.matchAll(
    /\b(?:node|dof manager)\s*(?:number|#)\s*#?(\d+)\b/gi,
  )) {
    const node = input?.nodes.find(({ number }) => number === Number(match[1]));
    if (node?.objectId)
      objects.set(`node:${node.objectId}`, { kind: "node", id: node.objectId });
  }
  for (const match of failureLines.matchAll(
    /\b(?:element)\s*(?:number|#)\s*#?(\d+)\b/gi,
  )) {
    const element = input?.elements.find(
      ({ number }) => number === Number(match[1]),
    );
    if (element)
      objects.set(`member:${element.memberId}`, {
        kind: "member",
        id: element.memberId,
      });
  }
  const identified = [...objects.values()];
  return [
    {
      id: "solver-failure",
      stage: "solver",
      message: singular
        ? identified.length
          ? `O OOFEM indicou uma matriz singular e o log identifica ${identified.length} objeto(s) do modelo.`
          : "O OOFEM indicou uma matriz singular. O log não identifica com segurança uma peça específica."
        : message || "O OOFEM não concluiu a análise.",
      severity: "erro",
      objects: identified,
      confidence: identified.length ? "confirmado" : "possível",
      action: identified.length
        ? "Inspecione os objetos identificados no log e confira seus apoios e conexões."
        : "Confira o log bruto e inspecione apoios, conexões e graus de liberdade antes de alterar uma peça.",
    },
  ];
}
