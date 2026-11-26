import {
  add,
  coordinates,
  interpolate,
  origin,
  scale,
  subtract,
  type Point3,
} from "../domain/geometry";

export interface LinearDensity {
  start: number;
  end: number;
  qStart: Point3;
  qEnd: Point3;
}
interface Change {
  start: Point3;
  end: Point3;
  startGradient: Point3;
  endGradient: Point3;
  enter: number;
  leave: number;
}

// Physical breakpoints already belong to the common mesh. Choose their station
// without relying on equality after the conversion from insertion to face coordinates.
function nearest(stations: number[], x: number) {
  let lo = 0,
    hi = stations.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (stations[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo && x - stations[lo - 1] < stations[lo] - x ? lo - 1 : lo;
}

// Adjacent elements may see different intensities at a boundary. Collect starts
// and ends separately; one native edge record suffices for all overlapping patterns.
export function elementDensities(
  stations: number[],
  profiles: LinearDensity[],
) {
  const changes = new Map<number, Change>();
  function change(i: number) {
    let item = changes.get(i);
    if (!item) {
      item = {
        start: origin,
        end: origin,
        startGradient: origin,
        endGradient: origin,
        enter: 0,
        leave: 0,
      };
      changes.set(i, item);
    }
    return item;
  }
  for (const p of profiles) {
    const a = Math.max(stations[0], p.start),
      b = Math.min(stations.at(-1)!, p.end);
    if (b <= a) continue;
    const i = nearest(stations, a),
      j = nearest(stations, b);
    if (i === j) continue;
    const value = (x: number) =>
      interpolate(p.qStart, p.qEnd, (x - p.start) / (p.end - p.start));
    const qa = value(a),
      qb = value(b),
      slope = scale(subtract(qb, qa), 1 / (stations[j] - stations[i]));
    const first = change(i),
      last = change(j);
    first.start = add(first.start, qa);
    first.startGradient = add(first.startGradient, slope);
    first.enter++;
    last.end = add(last.end, qb);
    last.endGradient = add(last.endGradient, slope);
    last.leave++;
  }
  const elements: { index: number; qStart: Point3; qEnd: Point3 }[] = [];
  let active = 0,
    q = origin,
    slope = origin;
  for (let i = 0; i < stations.length - 1; i++) {
    const e = changes.get(i);
    if (e) {
      active -= e.leave;
      q = add(active ? subtract(q, e.end) : origin, e.start);
      slope = add(
        active ? subtract(slope, e.endGradient) : origin,
        e.startGradient,
      );
      active += e.enter;
    }
    if (!active) {
      q = origin;
      slope = origin;
      continue;
    }
    const qEnd = add(q, scale(slope, stations[i + 1] - stations[i]));
    if (
      coordinates.some(
        (k) => !Number.isFinite(q[k]) || !Number.isFinite(qEnd[k]),
      )
    )
      throw new Error(
        "A superposição das cargas por trecho ultrapassa o intervalo numérico.",
      );
    if (coordinates.some((k) => q[k] !== 0 || qEnd[k] !== 0))
      elements.push({ index: i, qStart: q, qEnd });
    q = qEnd;
  }
  return elements;
}
