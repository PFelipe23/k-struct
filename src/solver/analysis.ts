import type { Project } from "../domain/model";
import { exportOofem, parseOofemOutput, type AnalysisResult } from "./oofem";
import { exportSlabOofem, parseSlabOutput, type SlabResult } from "./slab";

export type CaseResult = AnalysisResult & { slab?: SlabResult };

export function exportAnalysis(project: Project, caseId: string) {
  return project.slabs.length
    ? exportSlabOofem(project, caseId)
    : { kind: "frame" as const, ...exportOofem(project, caseId) };
}

export function parseAnalysisOutput(
  rawOutput: string,
  input: ReturnType<typeof exportAnalysis>,
): CaseResult {
  if (input.kind === "frame") return parseOofemOutput(rawOutput, input);
  return {
    caseId: input.caseId,
    solver: rawOutput.match(/OOFEM ver\.[^\n]+/)?.[0] ?? "OOFEM",
    completedAt: new Date().toISOString(),
    rawOutput,
    displacements: {},
    reactions: [],
    members: {},
    slab: parseSlabOutput(rawOutput, input),
  };
}
