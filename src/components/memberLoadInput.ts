import type { Member, Project } from "../domain/model";
import { parseUnitNumber } from "../units";

export type MemberLoadSelection = {
  memberId: string;
  fraction: number;
  kind?: "point" | "distributed";
  loadId?: string;
};

export function relativeNumber(text: string) {
  const simple = parseUnitNumber(text);
  if (simple !== null) return simple;
  const match =
    /^\s*(L|[+-]?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*$/i.exec(text);
  if (!match) return null;
  const a = match[1].toUpperCase() === "L" ? 1 : parseUnitNumber(match[1]),
    b = parseUnitNumber(match[2]);
  return a !== null && b !== null && b !== 0 && Number.isFinite(a / b)
    ? a / b
    : null;
}

export type MemberLoadDialogProps = {
  project: Project;
  member: Member;
  pattern: Project["loadPatterns"][number];
  selection: MemberLoadSelection;
  edit: (change: (p: Project) => void) => string | null | void;
  onClose: () => void;
};
