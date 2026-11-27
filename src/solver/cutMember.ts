import {
  dot,
  interpolate,
  origin,
  subtract,
  tolerance,
  type Point3,
} from "../domain/geometry";
import type { Member, Project, SectionCut } from "../domain/model";
import { connectionStations } from "../domain/beamMesh";
import {
  actionVector,
  distanceFromI,
  pointLoadFrame,
} from "../domain/memberPointLoads";
import {
  globalIntensity,
  intensityAt,
  linearEndForces,
  loadInterval,
} from "../domain/memberDistributedLoads";
import { tributaryProfiles } from "../domain/loadPanel";
import { selfWeightSummary } from "../domain/selfWeight";
import {
  accumulate,
  reduced,
  zeroResultant,
  type Resultant,
} from "./cutResultant";
import { sectionForcesBetween } from "./memberDiagram";
import type { AnalysisResult } from "./oofem";
import type { CutObject, CutFrame } from "../domain/sectionCut";

function sample(
  result: AnalysisResult,
  id: string,
  t: number,
  right: boolean,
  span: number,
  planar: boolean,
) {
  const stations = result.members[id] ?? [],
    eps = Math.min(tolerance / span, 1e-8);
  for (const [i, a] of stations.entries()) {
    if (Math.abs(a.t - t) <= eps) {
      if (!a.side || a.side === (right ? "right" : "left")) return a;
    }
    const b = stations[i + 1];
    if (b && a.t + eps < t && t < b.t - eps) {
      const load = result.memberIntensities?.[id]?.find(
        (q) => q.t0 === a.t && q.t1 === b.t,
      );
      if (!load) break;
      return sectionForcesBetween(a, b, load, span, t, planar);
    }
  }
  throw new Error(
    "Esforços ou carregamento do elemento indisponíveis na estação do corte.",
  );
}

function rigidLoads(
  p: Project,
  m: Member,
  caseId: string,
  line: ReturnType<typeof pointLoadFrame>,
  x: number,
  face: number,
  datum: Point3,
  sign: number,
  plane: CutFrame,
  onAxis: boolean,
) {
  const sum = zeroResultant(),
    a = Math.min(x, face),
    b = Math.max(x, face);
  const coordinate = (s: number) =>
    interpolate(line.start, line.end, s / line.span);
  const between = (s: number) => s >= a - tolerance && s <= b + tolerance;
  if (
    (connectionStations(p).get(m.id) ?? []).some((s) =>
      between(s.t * line.span),
    )
  )
    throw new Error(
      "Ligação nodal no trecho rígido sem esforços individuais recuperáveis.",
    );
  const caseDef = p.analysisCases.find((c) => c.id === caseId)!;
  const transferred = tributaryProfiles(p);
  for (const { patternId, factor } of caseDef.factors) {
    if (!factor) continue;
    const pat = p.loadPatterns.find((v) => v.id === patternId)!;
    const interval = (l: number, r: number, q0: Point3, q1: Point3) => {
      if (r <= l) return;
      const [f0, f1] = linearEndForces(q0, q1, r - l);
      accumulate(sum, reduced(coordinate(l), datum, f0), sign * factor);
      accumulate(sum, reduced(coordinate(r), datum, f1), sign * factor);
    };
    for (const q of [...pat.uniform, ...selfWeightSummary(p, pat).members])
      if (q.memberId === m.id) {
        const v = { x: q.qx, y: q.qy, z: q.qz };
        interval(a, b, v, v);
      }
    for (const q of [
      ...(pat.distributed ?? []),
      ...(transferred.get(pat.id) ?? []),
    ])
      if (q.memberId === m.id) {
        const [lo, hi] = loadInterval(q, line.span),
          l = Math.max(lo, a),
          r = Math.min(hi, b);
        const val = (s: number) =>
          globalIntensity(intensityAt(q, line.span, s), q.system, line.axes);
        interval(l, r, val(l), val(r));
      }
    for (const q of pat.points ?? [])
      if (q.memberId === m.id) {
        const s = distanceFromI(q.position, line.span);
        if (!between(s)) continue;
        if (
          onAxis &&
          Math.abs(s - x) <= tolerance &&
          dot(line.axes[0], plane.outward) * sign > 0
        )
          continue;
        const v = actionVector(q, line.axes);
        accumulate(
          sum,
          reduced(
            coordinate(s),
            datum,
            q.kind === "force" ? v : origin,
            q.kind === "moment" ? v : origin,
          ),
          sign * factor,
        );
      }
  }
  return sum;
}

export function cutMember(
  p: Project,
  result: AnalysisResult,
  m: Member,
  o: CutObject,
  cut: SectionCut,
  frame: CutFrame,
): Resultant {
  const nodes = new Map(p.nodes.map((v) => [v.id, v])),
    line = pointLoadFrame(m, nodes, p.mode);
  const faceI = m.offsets?.i.rigidLength ?? 0,
    faceJ = faceI + line.clear,
    sum = zeroResultant();
  const chain = o.outlines[0],
    planar = p.mode === "planar";
  for (const hit of o.hits) {
    const direction = subtract(chain[hit.link + 1], chain[hit.link]);
    const side = dot(direction, frame.outward) > 0 ? 1 : -1;
    const x =
      hit.link === 0 ? 0 : hit.link === 2 ? line.span : line.span * hit.t;
    const s = Math.max(faceI, Math.min(faceJ, x));
    const q = sample(
      result,
      m.id,
      (s - faceI) / line.clear,
      side > 0,
      line.clear,
      planar,
    );
    const f = globalIntensity(
      { x: q.n, y: q.vy, z: planar ? -q.v : q.vz },
      "local",
      line.axes,
    );
    const moment = globalIntensity(
      { x: q.mx, y: planar ? -q.m : q.my, z: q.mz },
      "local",
      line.axes,
    );
    const at = interpolate(line.start, line.end, s / line.span);
    accumulate(sum, reduced(at, cut.datum, f, moment), side);
    const rigidI =
      hit.link === 0 ||
      x < faceI ||
      (faceI > 0 && Math.abs(x - faceI) <= tolerance && side < 0);
    const rigidJ =
      hit.link === 2 ||
      x > faceJ ||
      (faceJ < line.span && Math.abs(x - faceJ) <= tolerance && side > 0);
    if (rigidI || rigidJ) {
      const sign = rigidI ? 1 : -1;
      accumulate(
        sum,
        rigidLoads(
          p,
          m,
          result.caseId,
          line,
          x,
          s,
          cut.datum,
          sign,
          frame,
          hit.link === 1,
        ),
        side,
      );
    }
  }
  return sum;
}
