import type { RunStatus, RunSummary } from "./desktop";
import type { AnalysisInput } from "./oofem";

export type ReportRun = {
  projectId: string;
  revision: number;
  status: RunStatus;
  detail: string;
  summary?: RunSummary;
  warnings: string[];
  mesh?: { nodes: number; beams: number; areas: number };
};

export function reportMesh(input: AnalysisInput) {
  return {
    nodes: input.nodes.length,
    beams: input.elements.length,
    areas:
      input.panels?.mesh.elements.length ??
      input.slab?.mesh.elements.length ??
      input.floor?.parts.reduce(
        (count, p) => count + p.input.mesh.elements.length,
        0,
      ) ??
      0,
  };
}

export function reportCaseStatus(
  projectId: string,
  revision: number,
  run: ReportRun | undefined,
  ready: boolean,
) {
  if (!run || run.projectId !== projectId)
    return ready ? "Disponível" : "Pendente de análise";
  if (run.revision !== revision)
    return ready ? "Disponível" : "Revisão anterior · reanálise pendente";
  if (ready) return "Disponível";
  if (run.status === "cancelled") return "Cancelado";
  if (run.status === "timedOut") return "Tempo de execução excedido";
  return run.status === "failed" ? "Falha na análise" : "Pendente de análise";
}
