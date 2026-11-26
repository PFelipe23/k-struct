import { coordinates, interpolate } from "../domain/geometry";
import { memberAxis } from "../domain/memberOffsets";
import type { Member, Project } from "../domain/model";
import type { MemberForceComponent } from "../solver/combinations";
import {
  DEFAULT_UNITS,
  fromSI,
  unitLabel,
  type UnitPreferences,
  type UnitQuantity,
} from "../units";

export const forceColumns = {
  planar: ["n", "v", "m"],
  spatial: ["n", "vy", "vz", "mx", "my", "mz"],
} as const;

export const forceLabels: Record<
  MemberForceComponent,
  { symbol: string; unit: string }
> = {
  n: { symbol: "N", unit: "kN" },
  v: { symbol: "V", unit: "kN" },
  m: { symbol: "M", unit: "kN·m" },
  vy: { symbol: "Vy", unit: "kN" },
  vz: { symbol: "Vz", unit: "kN" },
  mx: { symbol: "Mx", unit: "kN·m" },
  my: { symbol: "My", unit: "kN·m" },
  mz: { symbol: "Mz", unit: "kN·m" },
};

export const sectionSide = (side?: "left" | "right") =>
  side === "left" ? "Lado i" : side === "right" ? "Lado j" : "";

// Moment and force coordinates refer to the cut on the deformable axis.
export function sectionPositions(
  project: Project,
  members: Member[],
  units: UnitPreferences,
) {
  const axes = project.mode === "spatial" ? coordinates : (["x", "z"] as const);
  const show = members.some((m) => m.offsets);
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const lines = new Map(
    show
      ? members.map(
          (m) =>
            [
              m.id,
              memberAxis(m, nodes.get(m.start)!, nodes.get(m.end)!),
            ] as const,
        )
      : [],
  );
  return {
    headers: show
      ? axes.map((k) => `${k.toUpperCase()} da seção (${units.length})`)
      : [],
    values(id: string, t: number) {
      const line = lines.get(id);
      if (!line) return [];
      const at = interpolate(line.faceI, line.faceJ, t);
      return axes.map((k) => fromSI(at[k], "length", units));
    },
  };
}

export function forceQuantity(
  component: MemberForceComponent,
): "force" | "moment" {
  return component.startsWith("m") ? "moment" : "force";
}

export function getForceLabel(
  component: MemberForceComponent,
  units: UnitPreferences = DEFAULT_UNITS,
) {
  return {
    symbol: forceLabels[component].symbol,
    unit: unitLabel(forceQuantity(component), units),
  };
}

export const formatResult = (value: number, maximumFractionDigits = 5) =>
  value.toLocaleString("pt-BR", { maximumFractionDigits });

export function resultFractionDigits(
  quantity: UnitQuantity,
  units: UnitPreferences = DEFAULT_UNITS,
) {
  if (quantity !== "displacement") return 5;
  return { m: 9, cm: 7, mm: 5 }[units.displacement];
}

export function formatResultQuantity(
  valueSI: number,
  quantity: UnitQuantity,
  units: UnitPreferences = DEFAULT_UNITS,
) {
  return formatResult(
    fromSI(valueSI, quantity, units),
    resultFractionDigits(quantity, units),
  );
}

export function encodeCsv(rows: (string | number)[][]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) =>
            typeof value === "number"
              ? String(value)
              : `"${value.replaceAll('"', '""')}"`,
          )
          .join(";"),
      )
      .join("\n")
  );
}
