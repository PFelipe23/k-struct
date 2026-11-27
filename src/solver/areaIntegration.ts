import {
  add,
  cross,
  length,
  scale,
  subtract,
  type Point3,
} from "../domain/geometry";

type UV = { u: number; v: number };
const rule = [
  ...orbit(0.445948490915965, 0.10810301816807, 0.223381589678011),
  ...orbit(0.091576213509771, 0.816847572980459, 0.109951743655322),
];
function orbit(a: number, b: number, w: number) {
  return [
    [a, a, w],
    [a, b, w],
    [b, a, w],
  ];
}
const corners: UV[] = [
  { u: 0, v: 0 },
  { u: 1, v: 0 },
  { u: 0, v: 1 },
];

// Integrate on the original triangle with its original linear shape functions.
// Split at all changes of slope before integrating. The degree-four rule also
// integrates a bilinear pressure times the Allman quadratic drilling bubble.
export function integrateTriangle(
  points: Point3[],
  levels: number[],
  visit: (n: number[], p: Point3, dA: number) => void,
) {
  const [a, b, c] = points,
    ab = subtract(b, a),
    ac = subtract(c, a),
    area = length(cross(ab, ac)) / 2;
  const z = (p: UV) => a.z + p.u * ab.z + p.v * ac.z;
  let parts = [corners];
  for (const level of new Set(levels)) {
    parts = parts.flatMap((poly) => {
      if (!poly.some((p) => z(p) < level) || !poly.some((p) => z(p) > level))
        return [poly];
      const low: UV[] = [],
        high: UV[] = [];
      for (const [i, p] of poly.entries()) {
        const q = poly[(i + 1) % poly.length],
          zp = z(p) - level,
          zq = z(q) - level;
        if (zp <= 0) low.push(p);
        if (zp >= 0) high.push(p);
        if ((zp < 0 && zq > 0) || (zp > 0 && zq < 0)) {
          const t = zp / (zp - zq),
            cut = { u: p.u + t * (q.u - p.u), v: p.v + t * (q.v - p.v) };
          low.push(cut);
          high.push(cut);
        }
      }
      return [low, high];
    });
  }
  for (const poly of parts)
    for (let i = 1; i + 1 < poly.length; i++) {
      const [r, s, t] = [poly[0], poly[i], poly[i + 1]];
      const su = s.u - r.u,
        sv = s.v - r.v,
        tu = t.u - r.u,
        tv = t.v - r.v;
      const subArea = area * Math.abs(su * tv - sv * tu);
      if (subArea === 0) continue;
      for (const [l, m, w] of rule) {
        const u = r.u + l * su + m * tu,
          v = r.v + l * sv + m * tv;
        visit(
          [1 - u - v, u, v],
          add(a, add(scale(ab, u), scale(ac, v))),
          subArea * w,
        );
      }
    }
}
