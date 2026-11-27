import {
  cross,
  distance,
  dot,
  interpolate,
  length,
  origin,
  scale,
  subtract,
  type Point3,
} from "../domain/geometry";
import { elementTrace, type CutFrame } from "../domain/sectionCut";
import {
  globalBasis,
  inGlobal,
  type Basis,
  type PanelAssembly,
} from "../domain/surfacePanel";
import type { SectionCut } from "../domain/model";
import {
  accumulate,
  reduced,
  zeroResultant,
  type Resultant,
} from "./cutResultant";
import type { PanelResult } from "./surfacePanel";
import type { SlabResult } from "./slab";

type Tensor = { xx: number; yy: number; xy: number };
const keys = ["xx", "yy", "xy"] as const;
type Field = { membrane?: Tensor[]; bending?: Tensor[] };
function tensorAt(field: Tensor[], weights: number[]): Tensor {
  return Object.fromEntries(
    keys.map((k) => [k, field.reduce((v, t, i) => v + weights[i] * t[k], 0)]),
  ) as Tensor;
}

// Physical derivatives of the triangle's linear or the rectangular QDKT's
// bilinear interpolation, with the unsmoothed tensor of this native element.
function shape(points: Point3[], at: Point3, axes: Basis) {
  const a = points[0],
    ab = subtract(points[1], a),
    ad = subtract(points.at(-1)!, a),
    r = subtract(at, a);
  const bx = dot(ab, axes[0]),
    by = dot(ab, axes[1]),
    dx = dot(ad, axes[0]),
    dy = dot(ad, axes[1]),
    det = bx * dy - by * dx;
  const ux = dy / det,
    uy = -dx / det,
    vx = -by / det,
    vy = bx / det;
  const u = ux * dot(r, axes[0]) + uy * dot(r, axes[1]),
    v = vx * dot(r, axes[0]) + vy * dot(r, axes[1]);
  const tri = points.length === 3;
  const du = tri ? [-1, 1, 0] : [v - 1, 1 - v, v, -v],
    dv = tri ? [-1, 0, 1] : [u - 1, -u, u, 1 - u];
  return {
    w: tri
      ? [1 - u - v, u, v]
      : [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v],
    x: du.map((d, i) => d * ux + dv[i] * vx),
    y: du.map((d, i) => d * uy + dv[i] * vy),
  };
}

function integrateElement(
  sum: Resultant,
  points: Point3[],
  field: Field,
  axes: Basis,
  cut: SectionCut,
  frame: CutFrame,
) {
  const trace = elementTrace(points, frame);
  if (!trace) return;
  const [a, b] = trace,
    half = distance(a, b) / 2;
  const projection = subtract(
    frame.outward,
    scale(axes[2], dot(frame.outward, axes[2])),
  );
  const conormal = scale(projection, 1 / length(projection)),
    u = dot(conormal, axes[0]),
    v = dot(conormal, axes[1]);
  const timesNormal = (q: Tensor) => ({
    x: q.xx * u + q.xy * v,
    y: q.xy * u + q.yy * v,
    z: 0,
  });
  for (const g of [-1 / Math.sqrt(3), 1 / Math.sqrt(3)]) {
    const at = interpolate(a, b, (1 + g) / 2),
      s = shape(points, at, axes);
    let local = { ...origin },
      couple = origin;
    if (field.membrane) local = timesNormal(tensorAt(field.membrane, s.w));
    if (field.bending) {
      const m = tensorAt(field.bending, s.w),
        mx = tensorAt(field.bending, s.x),
        my = tensorAt(field.bending, s.y);
      // Kirchhoff equilibrium Q = div(M). The constitutive shear slots in a
      // DKT output are zero even when this transverse force is present.
      local.z = u * (mx.xx + my.xy) + v * (mx.xy + my.yy);
      couple = cross(axes[2], inGlobal(timesNormal(m), axes));
    }
    accumulate(
      sum,
      reduced(at, cut.datum, inGlobal(local, axes), couple),
      half,
    );
  }
}
export function integrateSlab(
  slab: SlabResult,
  cut: SectionCut,
  frame: CutFrame,
) {
  if (!slab.bendingCorners)
    throw new Error("Tensor de flexão elementar indisponível para a laje.");
  const sum = zeroResultant();
  for (const [i, e] of slab.mesh.elements.entries()) {
    const points = e.nodes.map((n) => slab.mesh.nodes[n - 1]);
    if (!elementTrace(points, frame)) continue;
    const corners = slab.bendingCorners[i];
    if (
      !corners ||
      corners.length !== points.length ||
      corners.some((v) => keys.some((k) => !Number.isFinite(v[k])))
    )
      throw new Error("Tensor de flexão elementar incompleto na laje.");
    integrateElement(
      sum,
      points,
      { bending: corners },
      globalBasis,
      cut,
      frame,
    );
  }
  return sum;
}

export function integratePanel(
  mesh: PanelAssembly,
  id: string,
  result: PanelResult,
  cut: SectionCut,
  frame: CutFrame,
) {
  const idx = mesh.panels.findIndex((g) => g.panel.id === id),
    g = mesh.panels[idx];
  const panel = result.panels.find((p) => p.panelId === id);
  if (!panel)
    throw new Error("Resultados elementares do painel indisponíveis.");
  const samples = new Map<number, typeof panel.samples>();
  for (const s of panel.samples) {
    const group = samples.get(s.element) ?? [];
    group[s.gp - 1] = s;
    samples.set(s.element, group);
  }
  const sum = zeroResultant();
  for (const [i, e] of mesh.elements.entries()) {
    if (e.panel !== idx) continue;
    const points = e.nodes.map((n) => mesh.nodes[n - 1]);
    if (!elementTrace(points, frame)) continue;
    const gp = samples.get(i + 1);
    if (!gp || gp.length !== 4)
      throw new Error("Pontos de integração do painel incompletos.");
    // GP 4,2,3 are the physical vertices' nearest points at (0.6,0.2,0.2)
    // and its permutations. Extrapolate each linear field from the centroid.
    function corners(
      keys: readonly ["mxx", "myy", "mxy"] | readonly ["nxx", "nyy", "nxy"],
    ): Tensor[] {
      const g = gp!;
      return [3, 1, 2].map((j) => {
        const val = (i: number) => {
          const a = g[0]?.geometricFields[keys[i]],
            b = g[j]?.geometricFields[keys[i]];
          if (a === undefined || b === undefined)
            throw new Error(
              "Componente elementar indisponível: " + keys[i] + ".",
            );
          return a + 2.5 * (b - a);
        };
        return { xx: val(0), yy: val(1), xy: val(2) };
      });
    }
    integrateElement(
      sum,
      points,
      {
        membrane:
          panel.kind !== "plate" ? corners(["nxx", "nyy", "nxy"]) : undefined,
        bending:
          panel.kind !== "membrane"
            ? corners(["mxx", "myy", "mxy"])
            : undefined,
      },
      g.axes,
      cut,
      frame,
    );
  }
  return sum;
}
