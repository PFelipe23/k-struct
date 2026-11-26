import { beamStations, type SectionLocation } from "../domain/beamMesh";
import { add, origin, scale, tolerance, type Point3 } from "../domain/geometry";
import { memberAxis } from "../domain/memberOffsets";
import type { Project, ResultCombination } from "../domain/model";
import {
  memberForceComponents,
  prepareMemberForces,
  weightedCases,
  type MemberForceComponent,
  type MemberForces,
} from "./combinations";
import type { AnalysisResult } from "./oofem";

export type SectionCursor = SectionLocation & { memberId: string };
type Definition = Pick<ResultCombination, "id" | "name" | "factors">;
type Sample = SectionLocation & MemberForces;
type Load = { qStart: Point3; qEnd: Point3 };
type Polynomial = readonly [number, number, number, number];
type Bound = "min" | "max";

// s runs from 0 to 1 inside one continuous element. N and V integrate a linear
// line load. A loaded bending moment is at most cubic: its end values and the
// two end shears (dMy/dx = Vz, dMz/dx = -Vy) determine it uniquely.
function polynomial(
  key: MemberForceComponent,
  a: Sample,
  b: Sample,
  load: Load,
  h: number,
  planar: boolean,
): Polynomial {
  const { qStart: q, qEnd: r } = load;
  const delta = b[key] - a[key];
  function bending(left: number, right: number): Polynomial {
    const d0 = h * left,
      d1 = h * right;
    return [a[key], d0, 3 * delta - 2 * d0 - d1, d0 + d1 - 2 * delta];
  }
  let quadratic = 0;
  switch (key) {
    case "n":
      quadratic = (-h * (r.x - q.x)) / 2;
      break;
    case "vy":
      quadratic = (-h * (r.y - q.y)) / 2;
      break;
    case "vz":
    case "v":
      quadratic = ((planar ? 1 : -1) * h * (r.z - q.z)) / 2;
      break;
    case "my":
    case "m":
      if (q.z || r.z) return bending(a.vz, b.vz);
      break;
    case "mz":
      if (q.y || r.y) return bending(-a.vy, -b.vy);
      break;
    // No distributed torsional couple is supported by the beam adapter.
  }
  return [a[key], delta - quadratic, quadratic, 0];
}

const at = ([a, b, c, d]: Polynomial, s: number) =>
  a + s * (b + s * (c + s * d));

function interiorRoots([, linear, quadratic, cubic]: Polynomial) {
  const scale = Math.max(
    Math.abs(linear),
    Math.abs(2 * quadratic),
    Math.abs(3 * cubic),
  );
  if (!scale) return [];
  const a = (3 * cubic) / scale,
    b = (2 * quadratic) / scale,
    c = linear / scale;
  let roots: number[];
  if (Math.abs(a) <= 8 * Number.EPSILON) roots = b ? [-c / b] : [];
  else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];
    const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant)) / 2;
    roots = q ? [q / a, c / q] : [-b / (2 * a)];
  }
  return roots.filter((s) => s > 0 && s < 1);
}

export function prepareMemberDiagram(
  project: Project,
  memberId: string,
  definitions: Definition[],
  results: ReadonlyMap<string, AnalysisResult>,
) {
  const member = project.members.find((item) => item.id === memberId);
  if (!member || !definitions.length)
    throw new Error(
      "Selecione uma barra e uma origem de resultados para a consulta.",
    );
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const length = memberAxis(
    member,
    nodes.get(member.start)!,
    nodes.get(member.end)!,
  ).clear;
  const layout = beamStations(project);
  const planar = project.mode === "planar";
  const sources = definitions.map((definition) => {
    const comb = { ...definition, type: "linear" as const };
    const samples = prepareMemberForces(
      project,
      comb,
      results,
      layout,
    )(memberId);
    const cases = weightedCases(project, comb, results).map(
      ({ factor, result }) => ({
        factor,
        loads: result.memberIntensities?.[memberId],
      }),
    );
    let element = 0;
    const loads = samples.slice(0, -1).map((a, i): Load | null => {
      const b = samples[i + 1];
      if (a.t === b.t) return null;
      const index = element++;
      let qStart = origin,
        qEnd = origin;
      for (const term of cases) {
        const edge = term.loads?.[index];
        if (!edge || edge.t0 !== a.t || edge.t1 !== b.t) return null;
        qStart = add(qStart, scale(edge.qStart, term.factor));
        qEnd = add(qEnd, scale(edge.qEnd, term.factor));
      }
      const load = { qStart, qEnd };
      const h = (b.t - a.t) * length;
      if (
        !memberForceComponents.every((key) =>
          polynomial(key, a, b, load, h, planar).every(Number.isFinite),
        )
      )
        return null;
      return load;
    });
    return { id: definition.id, name: definition.name, samples, loads };
  });
  const stations = sources[0].samples.map(({ t, side }) => ({ t, side }));
  const spans = stations
    .slice(0, -1)
    .map((a, i) => (stations[i + 1].t - a.t) * length);
  const known = spans.map((h, i) => h > 0 && sources.every((r) => r.loads[i]));
  const coverage = spans.every((h, i) => !h || known[i])
    ? "complete"
    : known.some(Boolean)
      ? "partial"
      : "sampled";
  type Source = (typeof sources)[number];
  const curve = (source: Source, i: number, key: MemberForceComponent) =>
    polynomial(
      key,
      source.samples[i],
      source.samples[i + 1],
      source.loads[i]!,
      spans[i],
      planar,
    );

  function locate({ t, side }: SectionLocation) {
    if (!Number.isFinite(t) || t < 0 || t > 1)
      throw new Error("Posição fora do trecho deformável da barra.");
    let lo = 0,
      hi = stations.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (stations[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    const upper = lo;
    let index =
      upper && t - stations[upper - 1].t <= stations[upper].t - t
        ? upper - 1
        : upper;
    const snap =
      Math.abs(t - stations[index].t) <= Math.min(tolerance / length, 1e-8);
    if (snap) {
      const wanted = side ?? (t > stations[index].t ? "right" : "left");
      if (stations[index].side && stations[index].side !== wanted)
        index += wanted === "left" ? -1 : 1;
    }
    if (snap || !known[upper - 1])
      return {
        location: stations[index],
        index,
        s: 0,
        method: snap ? ("sample" as const) : ("nearest" as const),
      };
    const i = upper - 1;
    return {
      location: { t, side: undefined },
      index: i,
      s: (t - stations[i].t) / (stations[upper].t - stations[i].t),
      method: "law" as const,
    };
  }

  function read(position: SectionLocation, key: MemberForceComponent) {
    const point = locate(position);
    const value = (source: Source, k: MemberForceComponent) =>
      point.method === "law"
        ? at(curve(source, point.index, k), point.s)
        : source.samples[point.index][k];
    let low = sources[0],
      high = low,
      min = value(low, key),
      max = min;
    for (const source of sources.slice(1)) {
      const v = value(source, key);
      if (v < min) {
        min = v;
        low = source;
      }
      if (v > max) {
        max = v;
        high = source;
      }
    }
    function extreme(source: Source) {
      const forces = Object.fromEntries(
        memberForceComponents.map((k) => [k, value(source, k)]),
      ) as MemberForces;
      return { id: source.id, name: source.name, forces };
    }
    const linear =
      point.method === "law" &&
      sources.every((source) => {
        const p = curve(source, point.index, key);
        return p[2] === 0 && p[3] === 0;
      });
    return {
      ...point,
      method: linear ? ("linear" as const) : point.method,
      min: extreme(low),
      max: extreme(high),
    };
  }

  function extreme(
    key: MemberForceComponent,
    bound: Bound,
    sampledOnly: boolean,
  ) {
    let best = sources[0].samples[0][key],
      location = stations[0];
    function consider(
      value: number,
      t: number,
      side?: SectionLocation["side"],
    ) {
      if (
        (bound === "min" ? value < best : value > best) ||
        (value === best && t < location.t)
      ) {
        best = value;
        location = { t, side };
      }
    }
    for (const source of sources) {
      source.samples.forEach((sample, i) => {
        consider(sample[key], sample.t, sample.side);
        if (sampledOnly || !known[i]) return;
        const poly = curve(source, i, key);
        for (const s of interiorRoots(poly))
          consider(at(poly, s), sample.t + s * (stations[i + 1].t - sample.t));
      });
    }
    return locate(location).location;
  }

  // Additional drawing vertices never become native stations or cross a duplicate abscissa.
  function trace(key: MemberForceComponent, reading: ReturnType<typeof read>) {
    return stations.flatMap((position, i) => {
      const values = sources.map((r) => r.samples[i][key]);
      const points = [
        { t: position.t, min: Math.min(...values), max: Math.max(...values) },
      ];
      if (!known[i]) return points;
      const curves = sources.map((r) => curve(r, i, key));
      const width = stations[i + 1].t - position.t;
      const interior = new Set<number>();
      if (curves.length > 1 || curves.some((p) => p[2] || p[3])) {
        for (let j = 1; j < 8; j++) interior.add(j / 8);
        let low = Infinity,
          high = -Infinity,
          sLow = 0,
          sHigh = 0;
        for (const p of curves)
          for (const s of [0, 1, ...interiorRoots(p)]) {
            const v = at(p, s);
            if (v < low) {
              low = v;
              sLow = s;
            }
            if (v > high) {
              high = v;
              sHigh = s;
            }
          }
        if (sLow > 0 && sLow < 1) interior.add(sLow);
        if (sHigh > 0 && sHigh < 1) interior.add(sHigh);
      }
      if (
        (reading.method === "law" || reading.method === "linear") &&
        reading.index === i
      )
        interior.add(reading.s);
      for (const s of [...interior].sort((x, y) => x - y)) {
        const v = curves.map((p) => at(p, s));
        points.push({
          t: position.t + s * width,
          min: Math.min(...v),
          max: Math.max(...v),
        });
      }
      return points;
    });
  }
  return { memberId, length, stations, coverage, read, extreme, trace };
}
export type MemberDiagram = ReturnType<typeof prepareMemberDiagram>;
export type DiagramReading = ReturnType<MemberDiagram["read"]>;
