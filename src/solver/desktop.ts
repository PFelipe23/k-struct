import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parseProject, serializeProject, type Project } from "../domain/model";
import { exportOofem, parseOofemOutput } from "./oofem";

export const desktop = () => isTauri();
export async function analyze(p: Project, caseId: string, executable: string) {
  const input = exportOofem(p, caseId);
  if (!desktop())
    throw new Error(
      "Execute o KStruct desktop para usar o OOFEM instalado neste computador. No navegador, você pode editar e exportar o modelo.",
    );
  const response = await invoke<{ output: string; log: string }>("run_oofem", {
    deck: input.deck,
    executable: executable || null,
  });
  return {
    result: parseOofemOutput(response.output, input),
    log: response.log,
  };
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
