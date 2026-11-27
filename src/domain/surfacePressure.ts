import {
  add,
  cross,
  dot,
  length,
  scale,
  subtract,
  type Point3,
} from "./geometry";
import type {
  PressureDirection,
  PressureDistribution,
  Project,
  Slab,
} from "./model";
import { conformingTriangles } from "./polygonMesh";
import { cross2, ringName, slabRings } from "./slabPolygon";

export type PressureSpec = {
  direction?: PressureDirection;
  distribution?: PressureDistribution;
};
export type PressureVertex = { id: string; label: string; point: Point3 };
export const directionNames = {
  normal: "Normal geométrica +3",
  X: "X global",
  Y: "Y global",
  Z: "Z global",
};
export function pressureVector(
  direction: PressureDirection = "normal",
  normal: Point3,
): Point3 {
  if (direction === "normal") return normal;
  return {
    x: Number(direction === "X"),
    y: Number(direction === "Y"),
    z: Number(direction === "Z"),
  };
}
export function panelPressureVertices(
  corners: Record<"A" | "B" | "C" | "D", Point3>,
): PressureVertex[] {
  return (["A", "B", "C", "D"] as const).map((id) => ({
    id,
    label: id,
    point: corners[id],
  }));
}
export function slabPressureVertices(slab: Slab, z: number): PressureVertex[] {
  return slabRings(slab).flatMap((ring, r) =>
    ring.map((v, i) => ({
      id: v.edgeId,
      label: slab.polygon ? `${ringName(r)} · V${i + 1}` : "ABCD"[i],
      point: { x: v.x, y: v.y, z },
    })),
  );
}
const atVertex = (values: Record<string, number>, key: string) =>
  Object.hasOwn(values, key) ? values[key] : 0;
export function elevationPressure(
  d: Extract<PressureDistribution, { mode: "elevation" }>,
  z: number,
) {
  if (z <= d.z0) return d.p0;
  if (z >= d.z1) return d.p1;
  const t = (z - d.z0) / (d.z1 - d.z0);
  return (1 - t) * d.p0 + t * d.p1;
}
// The four corners are ordered around the physical parallelogram. The scalar
// triple products recover its affine coordinates even when AB and AD are skew.
export function pressureAt(
  uniform: number,
  d: PressureDistribution | undefined,
  vertices: PressureVertex[],
  polygon?: Slab["polygon"],
): (p: Point3) => number {
  if (!d) return () => uniform;
  if (d.mode === "elevation") return (p) => elevationPressure(d, p.z);
  const q = vertices.map((v) => atVertex(d.values, v.id));
  if (polygon) {
    const points = vertices.map((v) => v.point);
    const faces = conformingTriangles(polygon.rings, points).map(
      ([i, j, k]) => ({
        i,
        j,
        k,
        area: cross2(points[i], points[j], points[k]),
      }),
    );
    return (p) => {
      for (const { i, j, k, area } of faces) {
        const v = cross2(points[i], p, points[k]) / area,
          w = cross2(points[i], points[j], p) / area,
          u = 1 - v - w;
        if (Math.min(u, v, w) >= -1e-8) return u * q[i] + v * q[j] + w * q[k];
      }
      throw new Error("Ponto de pressão fora da área material da laje.");
    };
  }
  const [a, b, , e] = vertices.map((v) => v.point);
  const ab = subtract(b, a),
    ad = subtract(e, a),
    n = cross(ab, ad),
    area = length(n),
    unit = scale(n, 1 / area);
  return (p) => {
    const v = subtract(p, a),
      u = dot(cross(v, ad), unit) / area,
      t = dot(cross(ab, v), unit) / area;
    return (
      (1 - u) * (1 - t) * q[0] +
      u * (1 - t) * q[1] +
      u * t * q[2] +
      (1 - u) * t * q[3]
    );
  };
}
export function pressureValues(uniform: number, dist?: PressureDistribution) {
  if (!dist) return [uniform];
  return dist.mode === "elevation"
    ? [dist.p0, dist.p1]
    : Object.values(dist.values);
}
export function pressureSpecError(
  spec: PressureSpec,
  uniform: number,
  ids: string[],
) {
  const d = spec.distribution;
  if (!d) return;
  if (uniform !== 0)
    return "A carga variável e a pressão uniforme devem ser lançadas separadamente.";
  if (
    d.mode === "elevation" &&
    (!(d.z1 > d.z0) || !Number.isFinite(d.z1 - d.z0))
  )
    return "Informe duas cotas finitas, com a superior acima da inferior.";
  if (
    d.mode === "vertices" &&
    Object.keys(d.values).some((key) => !ids.includes(key))
  )
    return "A carga por vértice referencia um vértice ausente no painel.";
}
// Sample each smooth stretch, including both sides of a waterline crossing.
export function pressureStations(
  a: Point3,
  b: Point3,
  d?: PressureDistribution,
) {
  if (!d) return [0, 1];
  const breaks = [0, 1];
  if (d.mode === "elevation" && a.z !== b.z)
    for (const z of [d.z0, d.z1]) {
      const t = (z - a.z) / (b.z - a.z);
      if (t > 0 && t < 1) breaks.push(t);
    }
  breaks.sort((x, y) => x - y);
  return breaks.flatMap((t, i) =>
    i + 1 < breaks.length ? [t, (t + breaks[i + 1]) / 2] : [t],
  );
}
export function pressureMarkers(
  vertices: PressureVertex[],
  uniform: number,
  d?: PressureDistribution,
  polygon?: Slab["polygon"],
) {
  const samples: { point: Point3; value: number }[] = [];
  const rings = polygon?.rings.map((r) => r.length) ?? [vertices.length];
  let offset = 0;
  for (const count of rings) {
    for (let i = 0; i < count; i++) {
      const a = vertices[offset + i],
        b = vertices[offset + ((i + 1) % count)];
      for (const t of pressureStations(a.point, b.point, d).slice(0, -1)) {
        const point = add(a.point, scale(subtract(b.point, a.point), t));
        const value =
          d?.mode === "vertices"
            ? (1 - t) * atVertex(d.values, a.id) + t * atVertex(d.values, b.id)
            : d
              ? elevationPressure(d, point.z)
              : uniform;
        samples.push({ point, value });
      }
    }
    offset += count;
  }
  if (d && !polygon) {
    const point = add(
      vertices[0].point,
      scale(subtract(vertices[2].point, vertices[0].point), 0.5),
    );
    const value =
      d.mode === "elevation"
        ? elevationPressure(d, point.z)
        : vertices.reduce((sum, v) => sum + atVertex(d.values, v.id) / 4, 0);
    samples.push({ point, value });
  }
  return samples;
}

// Keep pressures at surviving vertices and interpolate a new vertex from
// the previous physical surface when splitting an edge or cutting a hole.
export function remapSlabPressures(p: Project, old: Slab, next: Slab) {
  for (const pattern of p.loadPatterns) {
    const spec = pattern.pressure.find(
      (a) => a.slabId === old.id,
    )?.distribution;
    if (spec?.mode !== "vertices") continue;
    const before = slabPressureVertices(old, 0),
      after = slabPressureVertices(next, 0);
    const at = pressureAt(0, spec, before, old.polygon);
    const existing = new Set(before.map((v) => v.id));
    spec.values = Object.fromEntries(
      after.map((v) => [
        v.id,
        existing.has(v.id) ? atVertex(spec.values, v.id) : at(v.point),
      ]),
    );
  }
}
