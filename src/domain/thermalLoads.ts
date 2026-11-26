import { dot, type Point3, type beamAxes } from "./geometry";
import type { Project, AnalysisCase } from "./model";
import type { SectionGeometry } from "./sections";

type Pattern = Project["loadPatterns"][number];
export type ThermalField = NonNullable<Pattern["thermal"]>[number];
export const thermalComponents = ["uniform", "deltaY", "deltaZ"] as const;
export const emptyThermal = (memberId: string): ThermalField => ({
  memberId,
  uniform: 0,
  deltaY: 0,
  deltaZ: 0,
});

export function sectionExtents(g: SectionGeometry) {
  if (g.shape === "rectangle" || g.shape === "i")
    return { width: g.width, height: g.height };
  const diameter = g.shape === "circle" ? g.diameter : g.outerDiameter;
  return { width: diameter, height: diameter };
}

export function setThermalField(pattern: Pattern, field: ThermalField) {
  const fields = (pattern.thermal ?? []).filter(
    (row) => row.memberId !== field.memberId,
  );
  if (thermalComponents.some((k) => field[k] !== 0)) fields.push(field);
  if (fields.length) pattern.thermal = fields;
  else delete pattern.thermal;
}

export function thermalFieldError(
  f: ThermalField,
  mode: Project["mode"],
  section: SectionGeometry,
  alpha: number,
) {
  if (mode === "planar" && f.deltaY !== 0)
    return "A diferença entre as faces y exige um pórtico espacial.";
  const { width, height } = sectionExtents(section);
  if (
    ![
      f.uniform,
      f.deltaY,
      f.deltaZ,
      alpha * f.uniform,
      (alpha * f.deltaY) / width,
      (alpha * f.deltaZ) / height,
    ].every(Number.isFinite)
  )
    return "Variação de temperatura ou curvatura fora do intervalo numérico.";
}

export function caseThermalFields(p: Project, analysisCase: AnalysisCase) {
  const fields = new Map<string, ThermalField>();
  for (const { patternId, factor } of analysisCase.factors) {
    if (!factor) continue;
    const pattern = p.loadPatterns.find(({ id }) => id === patternId)!;
    for (const f of pattern.thermal ?? []) {
      const sum = fields.get(f.memberId) ?? emptyThermal(f.memberId);
      for (const k of thermalComponents) sum[k] += factor * f[k];
      fields.set(f.memberId, sum);
    }
  }
  const sections = new Map(p.sections.map((s) => [s.id, s]));
  const materials = new Map(p.materials.map((m) => [m.id, m]));
  const members = new Map(p.members.map((m) => [m.id, m]));
  for (const [id, f] of fields) {
    const m = members.get(id)!,
      section = sections.get(m.sectionId)!,
      alpha = materials.get(section.materialId)!.alpha;
    if (alpha === 0 || !thermalComponents.some((k) => f[k] !== 0))
      fields.delete(id);
    else {
      const error = thermalFieldError(f, p.mode, section, alpha);
      if (error) throw new Error(`${analysisCase.name} · ${m.name}: ${error}`);
    }
  }
  return fields;
}

type Axes = ReturnType<typeof beamAxes>;
// Reproject the physical gradient (K/m) before converting back to face differences (K).
export function rebaseThermal(
  f: ThermalField,
  from: Axes,
  to: Axes,
  memberId: string,
  source: SectionGeometry,
  dest = source,
  vector: (v: Point3) => Point3 = (v) => v,
): ThermalField {
  const old = sectionExtents(source),
    next = sectionExtents(dest);
  const coefficient = (a: Point3, b: Point3) => {
    const c = dot(vector(a), b);
    if (Math.abs(c) < 1e-12) return 0;
    return Math.abs(1 - Math.abs(c)) < 1e-12 ? Math.sign(c) : c;
  };
  const component = (axis: Point3, extent: number) =>
    f.deltaY * coefficient(from[1], axis) * (extent / old.width) +
    f.deltaZ * coefficient(from[2], axis) * (extent / old.height);
  return {
    memberId,
    uniform: f.uniform,
    deltaY: component(to[1], next.width),
    deltaZ: component(to[2], next.height),
  };
}

export function sameThermal(a: ThermalField, b: ThermalField) {
  return thermalComponents.every(
    (k) =>
      Math.abs(a[k] - b[k]) <=
      1e-10 * Math.max(1, Math.abs(a[k]), Math.abs(b[k])),
  );
}

export function thermalLabel(f: ThermalField) {
  const parts: string[] = [];
  const value = (n: number) =>
    n.toLocaleString("pt-BR", { maximumSignificantDigits: 5 });
  if (f.uniform) parts.push(`ΔT ${value(f.uniform)} K`);
  for (const [axis, delta] of [
    ["y", f.deltaY],
    ["z", f.deltaZ],
  ] as const)
    if (delta)
      parts.push(
        `${delta > 0 ? "+" : "−"}${axis} quente (${value(Math.abs(delta))} K)`,
      );
  return parts.join(" · ");
}
