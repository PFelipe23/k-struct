import type { Material, Member, Project } from "./model";
import type { sectionProperties } from "./sections";

const stiffnessComponents = ["ea", "eiy", "eiz", "gj"] as const;
type StiffnessComponent = (typeof stiffnessComponents)[number];
export const stiffnessLabels = {
  ea: "EA",
  eiy: "EIy",
  eiz: "EIz",
  gj: "GJ",
} as const;
export type StiffnessFactors = Partial<Record<StiffnessComponent, number>>;
export const beamShearCoefficient = 1e18;
type Geometry = ReturnType<typeof sectionProperties>;

export function activeStiffnessComponents(mode: Project["mode"]) {
  return mode === "spatial" ? stiffnessComponents : (["ea", "eiy"] as const);
}

export function stiffnessFactorError(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return "Informe um fator finito.";
  if (value < 0) return "Informe um fator positivo.";
  if (value === 0)
    return "Rigidez nula pode gerar um mecanismo. Use um fator maior que zero.";
}

export function setStiffnessFactor(
  member: Member,
  component: StiffnessComponent,
  value: number,
) {
  const stiffness = { ...member.stiffness };
  if (value === 1) delete stiffness[component];
  else stiffness[component] = value;
  if (Object.keys(stiffness).length) member.stiffness = stiffness;
  else delete member.stiffness;
}

export function sameStiffness(a: Member, b: Member, mode: Project["mode"]) {
  return activeStiffnessComponents(mode).every(
    (key) => (a.stiffness?.[key] ?? 1) === (b.stiffness?.[key] ?? 1),
  );
}

export function grossStiffness(
  { A, Iy, Iz, J }: Geometry,
  { E, nu }: Material,
) {
  return { ea: E * A, eiy: E * Iy, eiz: E * Iz, gj: (E / (2 * (1 + nu))) * J };
}

export function equivalentBeamProperties(
  geometry: Geometry,
  material: Material,
  factors?: StiffnessFactors,
) {
  const ea = factors?.ea ?? 1;
  const scaled = (value: number, factor = 1) =>
    factor === ea ? value : value * (factor / ea);
  return {
    A: geometry.A,
    Iy: scaled(geometry.Iy, factors?.eiy),
    Iz: scaled(geometry.Iz, factors?.eiz),
    J: scaled(geometry.J, factors?.gj),
    shear: beamShearCoefficient / ea,
    E: material.E * ea,
  };
}

export function memberStiffnessError(
  mode: Project["mode"],
  geometry: Geometry,
  material: Material,
  factors: StiffnessFactors,
) {
  for (const v of Object.values(factors)) {
    if (v === undefined) continue;
    const error = stiffnessFactorError(v);
    if (error) return error;
  }
  const gross = grossStiffness(geometry, material);
  const fit = equivalentBeamProperties(geometry, material, factors);
  const shearArea = geometry.A * fit.shear;
  const shearStiffness = shearArea * (fit.E / (2 * (1 + material.nu)));
  const checks = [
    fit.E,
    fit.Iy,
    fit.shear,
    shearArea,
    shearStiffness,
    ...(mode === "spatial" ? [fit.Iz, fit.J] : []),
    ...activeStiffnessComponents(mode).map(
      (key) => gross[key] * (factors[key] ?? 1),
    ),
  ];
  if (checks.some((value) => !Number.isFinite(value) || value <= 0))
    return "Os fatores geram rigidez fora do intervalo numérico do OOFEM.";
}
