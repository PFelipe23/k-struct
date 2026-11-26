import { serializeProject, type Project } from "../domain/model";
import type { AnalysisDiagnostic } from "../domain/diagnostics";

const prefix = "kstruct.analysis-diagnostics.v1.";

export interface StoredDiagnosticContext {
  projectId: string;
  projectSnapshot: string;
  diagnostics: AnalysisDiagnostic[];
}

export function saveDiagnosticContext(
  runId: string,
  project: Project,
  diagnostics: AnalysisDiagnostic[],
) {
  if (typeof localStorage === "undefined" || diagnostics.length === 0) return;
  try {
    localStorage.setItem(
      `${prefix}${runId}`,
      JSON.stringify({
        projectId: project.id,
        projectSnapshot: serializeProject(project),
        diagnostics,
      } satisfies StoredDiagnosticContext),
    );
  } catch {
    // O log nativo continua disponível mesmo se o armazenamento local falhar.
  }
}

export function readDiagnosticContext(
  runId: string,
): StoredDiagnosticContext | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${prefix}${runId}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredDiagnosticContext;
    return typeof value.projectId === "string" &&
      typeof value.projectSnapshot === "string" &&
      Array.isArray(value.diagnostics)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function diagnosticContextMatches(
  context: StoredDiagnosticContext,
  project: Project,
) {
  return (
    context.projectId === project.id &&
    context.projectSnapshot === serializeProject(project)
  );
}
