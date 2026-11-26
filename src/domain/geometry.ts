import { parseUnitNumber } from "../units";

export type Point3 = { x: number; y: number; z: number };
export type Coordinate = keyof Point3;

export const tolerance = 1e-6;
export const coordinates = ["x", "y", "z"] as const;
export const origin: Point3 = { x: 0, y: 0, z: 0 };
export const add = (a: Point3, b: Point3): Point3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
export const subtract = (a: Point3, b: Point3): Point3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export const scale = (p: Point3, k: number): Point3 => ({
  x: p.x * k,
  y: p.y * k,
  z: p.z * k,
});
export const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Point3, b: Point3): Point3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = ({ x, y, z }: Point3) => Math.hypot(x, y, z);
export const distance = (a: Point3, b: Point3) => length(subtract(a, b));
export function memberLengthError(
  member: { id: string; name: string },
  a: Point3,
  b: Point3,
): string | null {
  const span = distance(a, b);
  const label = `A barra ${member.name} (${member.id})`;
  if (!Number.isFinite(span))
    return `${label} teria comprimento fora do intervalo numérico.`;
  if (span === 0) return `${label} teria comprimento nulo.`;
  if (span < tolerance)
    return `${label} teria comprimento inferior à tolerância de ${tolerance.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} m.`;
  return null;
}

export const interpolate = (a: Point3, b: Point3, t: number) =>
  add(a, scale(subtract(b, a), t));

export function interiorParameter(point: Point3, a: Point3, b: Point3) {
  const direction = subtract(b, a);
  const span = length(direction);
  if (span < tolerance) return null;
  const unit = scale(direction, 1 / span);
  const offset = subtract(point, a);
  const d = dot(offset, unit);
  return d > tolerance &&
    d < span - tolerance &&
    length(subtract(offset, scale(unit, d))) < tolerance
    ? d / span
    : null;
}

export type PlaneKind = "XY" | "XZ" | "YZ";
export type WorkPlane = { kind: PlaneKind; offset: number };
export const planeCoordinates = {
  XY: ["x", "y", "z"],
  XZ: ["x", "z", "y"],
  YZ: ["y", "z", "x"],
} as const;

export function onPlane(p: Point3, plane: WorkPlane) {
  return (
    Math.abs(p[planeCoordinates[plane.kind][2]] - plane.offset) < tolerance
  );
}

export function planePoint(
  u: number,
  v: number,
  { kind, offset }: WorkPlane,
): Point3 {
  const [a, b, c] = planeCoordinates[kind];
  return { ...origin, [a]: u, [b]: v, [c]: offset };
}

export function beamAxes(
  a: Point3,
  b: Point3,
  roll: number,
  mode: "planar" | "spatial" = "spatial",
) {
  const unit = (v: Point3) => scale(v, 1 / length(v));
  const direction = subtract(b, a);
  if (mode === "planar") {
    const x = unit({ ...direction, y: 0 });
    const y = { ...origin, y: 1 };
    return [x, y, cross(x, y)] as const;
  }
  const x = unit(direction);
  const up =
    Math.abs(x.z) > 1 - 1e-8 ? { ...origin, x: 1 } : { ...origin, z: 1 };
  const y0 = unit(cross(up, x));
  const z0 = cross(x, y0);
  const angle = (roll * Math.PI) / 180;
  const z = add(scale(z0, Math.cos(angle)), scale(y0, -Math.sin(angle)));
  return [x, cross(z, x), z] as const;
}

export function localComponents(
  vector: Point3,
  [x, y, z]: ReturnType<typeof beamAxes>,
): Point3 {
  return { x: dot(vector, x), y: dot(vector, y), z: dot(vector, z) };
}

export function normalizeCoord(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

export function midpoint(a: Point3, b: Point3): Point3 {
  return {
    x: a.x / 2 + b.x / 2,
    y: a.y / 2 + b.y / 2,
    z: a.z / 2 + b.z / 2,
  };
}

export function perpendicularFootOnSegment(
  from: Point3,
  a: Point3,
  b: Point3,
): Point3 | null {
  const ab = subtract(b, a);
  const span = length(ab);
  if (span < tolerance) return null;
  const u = scale(ab, 1 / span);
  const d = dot(subtract(from, a), u);
  if (d < -tolerance || d > span + tolerance) return null;
  const clamped = Math.min(span, Math.max(0, d));
  const foot = add(a, scale(u, clamped));
  if (distance(from, foot) < tolerance) return null;
  return {
    x: normalizeCoord(foot.x),
    y: normalizeCoord(foot.y),
    z: normalizeCoord(foot.z),
  };
}

export function relativePointOnPlane(
  anchor: Point3,
  deltaU: number,
  deltaV: number,
  plane: WorkPlane,
): Point3 {
  const [axisU, axisV] = planeCoordinates[plane.kind];
  const u = normalizeCoord(anchor[axisU] + deltaU);
  const v = normalizeCoord(anchor[axisV] + deltaV);
  return planePoint(u, v, plane);
}

export function parseDecimalInput(raw: string): number {
  return parseUnitNumber(raw.replace(/−/g, "-")) ?? NaN;
}

export function matrixRank(rows: number[][], columns: number): number {
  const a = rows.map((row) => [...row]);
  let r = 0;
  for (let c = 0; c < columns && r < a.length; c++) {
    let pivot = r;
    for (let i = r + 1; i < a.length; i++)
      if (Math.abs(a[i][c]) > Math.abs(a[pivot][c])) pivot = i;
    if (Math.abs(a[pivot][c]) <= 1e-8) continue;
    [a[r], a[pivot]] = [a[pivot], a[r]];
    const v = a[r][c];
    a[r] = a[r].map((x) => x / v);
    for (let i = r + 1; i < a.length; i++) {
      const f = a[i][c];
      a[i] = a[i].map((x, j) => x - f * a[r][j]);
    }
    r++;
  }
  return r;
}
