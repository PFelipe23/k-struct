import {
  add,
  cross,
  dot,
  interpolate,
  length,
  origin,
  scale,
  subtract,
  type Point3,
} from "../domain/geometry";
import type { Project, SectionCut, Slab } from "../domain/model";
import type { CutFrame } from "../domain/sectionCut";
import type { PanelAssembly } from "../domain/surfacePanel";
import { integrateTriangle } from "./areaIntegration";
import {
  accumulate,
  reduced,
  zeroResultant,
  type Resultant,
} from "./cutResultant";
import { slabPressureField } from "./slabAreaLoads";
import { panelLoading, type PanelResult } from "./surfacePanel";
import type { SlabResult } from "./slab";

function retainedPolygon(poly: Point3[], frame: CutFrame) {
  const kept: Point3[] = [];
  for (const [i, a] of poly.entries()) {
    const b = poly[(i + 1) % poly.length],
      da = frame.signed(a),
      db = frame.signed(b);
    if (da <= 0) kept.push(a);
    if (da * db < 0) kept.push(interpolate(a, b, da / (da - db)));
  }
  return kept;
}
function areaActions(
  sum: Resultant,
  poly: Point3[],
  frame: CutFrame,
  datum: Point3,
  levels: number[],
  density: (at: Point3) => Point3,
) {
  const kept = retainedPolygon(poly, frame);
  for (let i = 1; i + 1 < kept.length; i++)
    integrateTriangle([kept[0], kept[i], kept[i + 1]], levels, (_, at, dA) => {
      accumulate(sum, reduced(at, datum, density(at)), dA);
    });
}
export function externalSlab(
  p: Project,
  caseId: string,
  slab: Slab,
  r: SlabResult,
  cut: SectionCut,
  frame: CutFrame,
) {
  const sum = zeroResultant();
  const field = slabPressureField(
    p,
    p.analysisCases.find((c) => c.id === caseId)!,
    slab,
    r.mesh.nodes[0].z,
  );
  for (const el of r.mesh.elements) {
    const pts = el.nodes.map((n) => r.mesh.nodes[n - 1]);
    areaActions(sum, pts, frame, cut.datum, [], (at) => ({
      ...origin,
      z: field.at(at),
    }));
  }
  for (const q of r.reactions) {
    const at = r.mesh.nodes[q.node - 1];
    if (frame.signed(at) <= 0)
      accumulate(
        sum,
        reduced(
          at,
          cut.datum,
          { ...origin, z: q.fz },
          { x: q.mx, y: q.my, z: 0 },
        ),
      );
  }
  return sum;
}
export function externalPanels(
  p: Project,
  caseId: string,
  mesh: PanelAssembly,
  r: PanelResult,
  cut: SectionCut,
  frame: CutFrame,
) {
  const sum = zeroResultant(),
    c = p.analysisCases.find((v) => v.id === caseId)!;
  for (const g of mesh.panels) {
    const load = panelLoading(p, c, g);
    for (const { edge, intensity } of load.edges) {
      let a = g.points[edge[0]],
        b = g.points[edge.at(-1)!];
      const da = frame.signed(a),
        db = frame.signed(b);
      if (da > 0 && db > 0) continue;
      if (da > 0 || db > 0) {
        const hit = interpolate(a, b, da / (da - db));
        if (da > 0) a = hit;
        else b = hit;
      }
      accumulate(
        sum,
        reduced(interpolate(a, b, 0.5), cut.datum, intensity),
        length(subtract(b, a)),
      );
    }
    if (load.variable.length || length(load.areaLoad))
      for (const tri of g.triangles) {
        const pts = tri.map((i) => g.points[i]);
        areaActions(sum, pts, frame, cut.datum, load.levels, (at) =>
          load.variable.reduce(
            (f, q) => add(f, scale(q.direction, q.at(at))),
            load.areaLoad,
          ),
        );
      }
  }
  for (const q of r.supportReactions) {
    const at = mesh.nodes[q.id - 1];
    if (frame.signed(at) <= 0)
      accumulate(sum, reduced(at, cut.datum, q.force, q.couple));
  }
  return sum;
}

export function shearModes(at: Point3, z: Point3, frame: CutFrame) {
  const u = subtract(frame.outward, scale(z, dot(frame.outward, z)));
  return { at, z, u: scale(u, 1 / length(u)) };
}
type Mode = ReturnType<typeof shearModes> & { value: Resultant };

// A straight trace transmits two independent shear resultants: the integral of
// Qn and its first moment along the trace. Project the equilibrium residual on
// these modes only. Membrane tractions and bending about the trace remain the
// original line integrals of the Gauss-point tensors.
export function equilibrateShear(
  ext: Resultant,
  parts: Resultant[],
  modes: Mode[],
  datum: Point3,
) {
  if (!modes.length) return;
  const residual = zeroResultant();
  accumulate(residual, ext, -1);
  for (const value of parts) accumulate(residual, value, -1);
  function coefficients(r: Point3, dirs: Point3[]) {
    if (dirs.length === 1) return [dot(r, dirs[0])];
    const [a, b] = dirs,
      d = dot(a, b),
      det = 1 - d * d;
    if (dirs.length !== 2 || det < 1e-10)
      throw new Error(
        "A interface não individualiza o cortante ou seu primeiro momento entre os painéis neste plano.",
      );
    const ra = dot(r, a),
      rb = dot(r, b);
    return [(ra - d * rb) / det, (rb - d * ra) / det];
  }
  const forces = coefficients(
    residual.force,
    modes.map((m) => m.z),
  );
  const arms = modes.map((m, i) =>
    cross(subtract(m.at, datum), scale(m.z, forces[i])),
  );
  for (const arm of arms) residual.moment = subtract(residual.moment, arm);
  const moments = coefficients(
    residual.moment,
    modes.map((m) => m.u),
  );
  modes.forEach((m, i) =>
    accumulate(m.value, {
      force: scale(m.z, forces[i]),
      moment: add(arms[i], scale(m.u, moments[i])),
    }),
  );
}
