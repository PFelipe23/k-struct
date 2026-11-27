import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parseProject, serializeProject, type Project } from "../domain/model";
import { exportOofem } from "./oofem";

export type EngineOrigin = "bundled" | "custom" | "environment" | "path";
export const engineOriginLabel: Record<EngineOrigin, string> = {
  bundled: "Integrado ao KStruct",
  custom: "Executável selecionado",
  environment: "Variável OOFEM_BIN",
  path: "PATH do sistema",
};

export interface EngineInfo {
  origin: EngineOrigin;
  path: string;
  version: string | null;
  commit: string | null;
  sha256: string | null;
}

export type RunStatus = "completed" | "failed" | "cancelled" | "timedOut";
export const runStatusLabel: Record<RunStatus, string> = {
  completed: "Motor concluído",
  failed: "Falha",
  cancelled: "Cancelado",
  timedOut: "Tempo excedido",
};

interface RunContext {
  runId: string;
  projectName: string;
  caseName: string;
}

export interface RunSummary extends RunContext {
  startedAt: number;
  durationMs: number;
  status: RunStatus;
  message: string;
  engine: EngineInfo | null;
}

export interface RunLog {
  summary: RunSummary;
  stdout: string;
  stderr: string;
  logTruncated: boolean;
}

interface ExecutionResponse {
  log: RunLog;
  output: string | null;
  historyError: string | null;
}

export interface Diagnostic {
  ok: boolean;
  message: string;
  engine: EngineInfo | null;
  benchmark: {
    leftReactionN: number;
    rightReactionN: number;
    midspanUzM: number;
  } | null;
  stdout: string;
  stderr: string;
}

export const desktop = () => isTauri();
export async function analyze(
  p: Project,
  caseId: string,
  executable: string,
  runId: string,
  onStarted: () => void,
) {
  const input = exportOofem(p, caseId);
  if (!desktop())
    throw new Error(
      "Execute o KStruct desktop para usar o OOFEM instalado neste computador. No navegador, você pode editar e exportar o modelo.",
    );
  const response = new Channel<ExecutionResponse>();
  const completed = new Promise<ExecutionResponse>((resolve) => {
    response.onmessage = resolve;
  });
  await invoke("start_oofem", {
    deck: input.deck,
    executable: executable || null,
    runContext: {
      runId,
      projectName: p.name,
      caseName: p.analysisCases.find((item) => item.id === caseId)!.name,
    },
    response,
  });
  onStarted();
  return { execution: await completed, input };
}
export function cancelAnalysis(runId: string) {
  return invoke<boolean>("cancel_oofem", { runId });
}
export function diagnoseEngine(executable: string) {
  return invoke<Diagnostic>("diagnose_oofem", {
    executable: executable || null,
  });
}
export function recentRuns() {
  return invoke<RunSummary[]>("list_oofem_runs");
}
export function readRunLog(runId: string) {
  return invoke<RunLog>("read_oofem_log", { runId });
}
function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function exportFile(
  name: string,
  content: string,
  type = "text/plain",
): Promise<boolean> {
  if (!desktop()) {
    download(name, content, type);
    return true;
  }
  const path = await save({ title: "Exportar arquivo", defaultPath: name });
  if (!path) return false;
  await writeTextFile(path, content);
  return true;
}
export async function saveAnalysisPdf(
  projectName: string,
  render: () => Promise<Uint8Array>,
) {
  const name =
    projectName.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "projeto";
  const path = await save({
    title: "Salvar relatório de análise",
    defaultPath: `${name}-analise.pdf`,
    filters: [{ name: "Relatório PDF", extensions: ["pdf"] }],
  });
  if (!path) return false;
  await writeFile(path, await render());
  return true;
}
export async function saveProject(p: Project): Promise<boolean> {
  const name = p.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "projeto";
  const content = serializeProject(p);
  if (!desktop()) {
    download(`${name}.kstruct.json`, content, "application/json");
    return true;
  }
  const path = await save({
    title: "Salvar projeto KStruct",
    defaultPath: `${name}.kstruct.json`,
    filters: [{ name: "Projeto KStruct", extensions: ["json"] }],
  });
  if (!path) return false;
  await writeTextFile(path, content);
  return true;
}
export async function openProject(): Promise<Project | null> {
  const path = await open({
    title: "Abrir projeto KStruct",
    multiple: false,
    directory: false,
    filters: [{ name: "Projeto KStruct", extensions: ["json"] }],
  });
  return path ? parseProject(await readTextFile(path)) : null;
}
export async function chooseSolver(): Promise<string | null> {
  return await open({
    title: "Selecione o executável OOFEM",
    multiple: false,
    directory: false,
  });
}
