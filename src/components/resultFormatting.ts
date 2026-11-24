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
