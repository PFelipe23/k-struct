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
    for (const member of project.members) {
      connected.add(member.start);
      connected.add(member.end);
      for (const station of connectionStations(project).get(member.id) ?? [])
        connected.add(station.nodeId);
    }
    return project.nodes
      .filter(({ id }) => !connected.has(id))
      .map(({ id }) => ({ kind: "node", id }));
  }
  const member = project.members.find(({ name }) =>
    message.startsWith(`${name}:`),
  );
  if (member) return [{ kind: "member", id: member.id }];
  const isolated = project.nodes.find(({ name }) =>
    message.startsWith(`${name} está isolado`),
  );
  if (isolated) {
    const hostName = message.match(/interior de (.+?)\. Use Conexões/)?.[1];
    const host = project.members.find(({ name }) => name === hostName);
    return [
      { kind: "node", id: isolated.id },
      ...(host ? [{ kind: "member" as const, id: host.id }] : []),
    ];
  }
  const supported = message.match(
    /^Estrutura ligada a (.+?): apoios insuficientes/,
  );
  if (supported) {
    const seed = project.nodes.find(({ name }) => name === supported[1]);
    if (seed) return componentObjects(project, seed.id);
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
  const objects = new Map<string, SelectedObject>();
  for (const match of raw.matchAll(
    /\b(?:node|dof manager)\s*(?:number|#)\s*#?(\d+)\b/gi,
  )) {
    const node = input?.nodes.find(({ number }) => number === Number(match[1]));
    if (node?.objectId)
      objects.set(`node:${node.objectId}`, { kind: "node", id: node.objectId });
  }
  for (const match of raw.matchAll(
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
