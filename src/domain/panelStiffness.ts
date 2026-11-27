import type { Material, PanelFactors, SurfacePanel } from "./model";
import { stiffnessFactorError } from "./memberStiffness";

export const membraneKeys = ["n11", "n22", "n12"] as const;
export const bendingKeys = ["m11", "m22", "m12"] as const;
export type PanelComponent = keyof PanelFactors;
export function panelComponents(
  kind: SurfacePanel["kind"],
): readonly PanelComponent[] {
  if (kind === "plate") return bendingKeys;
  if (kind === "membrane") return membraneKeys;
  return [...membraneKeys, ...bendingKeys];
}
export function panelAngle(degrees = 0) {
  const a = degrees % 360;
  return a > 180 ? a - 360 : a <= -180 ? a + 360 : a || 0;
}
export function panelTrig(degrees = 0) {
  const a = panelAngle(degrees);
  if (a === 0) return { c: 1, s: 0 };
  if (a === 180) return { c: -1, s: 0 };
  if (Math.abs(a) === 90) return { c: 0, s: Math.sign(a) };
  return { c: Math.cos((a * Math.PI) / 180), s: Math.sin((a * Math.PI) / 180) };
}
export function directionalProperties(
  mat: Material,
  factors: PanelFactors,
  kind: "membrane" | "plate",
) {
  const [k1, k2, k12] = kind === "membrane" ? membraneKeys : bendingKeys;
  const f1 = factors[k1] ?? 1,
    f2 = factors[k2] ?? 1,
    f12 = factors[k12] ?? 1;
  const e1 = mat.E * f1,
    e2 = mat.E * f2,
    g12 = (mat.E / (2 * (1 + mat.nu))) * f12;
  // Symmetric scaling of the plane-stress matrix preserves positive energy and reciprocity.
  const nu12 = mat.nu * (Math.sqrt(f1) / Math.sqrt(f2));
  const d = 1 - mat.nu ** 2;
  return {
    e1,
    e2,
    g12,
    nu12,
    q11: e1 / d,
    q22: e2 / d,
    q12: (mat.nu * (Math.sqrt(e1) * Math.sqrt(e2))) / d,
  };
}
export function panelStiffnessError(p: SurfacePanel, mat: Material) {
  const active = panelComponents(p.kind);
  for (const [k, value] of Object.entries(p.stiffness ?? {})) {
    if (!active.includes(k as PanelComponent))
      return `${k.toUpperCase()} é incompatível com a formulação do painel.`;
    const err = stiffnessFactorError(value);
    if (err) return k.toUpperCase() + " · " + err;
  }
  if (p.angleDeg !== undefined && !Number.isFinite(p.angleDeg))
    return "Informe um ângulo finito.";
  for (const part of ["membrane", "plate"] as const) {
    if (p.kind !== "shell" && p.kind !== part) continue;
    const props = directionalProperties(mat, p.stiffness ?? {}, part);
    const h = part === "plate" ? p.thickness ** 3 / 12 : p.thickness;
    if (
      !Object.values(props).every(Number.isFinite) ||
      ![props.q11, props.q22, props.g12].every(
        (x) => x > 0 && x * h > 0 && Number.isFinite(x * h),
      )
    )
      return "Material, espessura e fatores geram rigidez fora do intervalo numérico do OOFEM.";
  }
}
