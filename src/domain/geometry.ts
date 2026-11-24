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

export function beamAxes(a: Point3, b: Point3, roll: number) {
  const unit = (v: Point3) => scale(v, 1 / length(v));
  const x = unit(subtract(b, a));
  const up =
    Math.abs(x.z) > 1 - 1e-8 ? { ...origin, x: 1 } : { ...origin, z: 1 };
  const y0 = unit(cross(up, x));
  const z0 = cross(x, y0);
  const angle = (roll * Math.PI) / 180;
  const z = add(scale(z0, Math.cos(angle)), scale(y0, -Math.sin(angle)));
  return [x, cross(z, x), z] as const;
}
