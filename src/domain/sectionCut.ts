import {
  cross,
  distance,
  dot,
  interpolate,
  length,
  origin,
  scale,
  subtract,
  tolerance,
  type Point3,
} from "./geometry";
import { memberAxis } from "./memberOffsets";
import type { Project, SectionCut } from "./model";
import { slabRings } from "./slabPolygon";
import { panelGeometry } from "./surfacePanel";

export type Segment = [Point3, Point3];
export type CutObject = {
  id: string;
  name: string;
  kind: "member" | "slab" | "panel";
  outlines: Point3[][];
  traces: Segment[];
  hits: { point: Point3; t: number; link: number }[];
  notice?: string;
  unavailable?: boolean;
};

// The plane itself belongs to the retained body. On a shared edge or a jump
// take the limiting face just outside that body, once.
export function cutFrame(cut: SectionCut) {
  const norm = length(cut.normal);
  if (!Number.isFinite(norm) || norm === 0)
    throw new Error("Informe uma normal finita e não nula.");
  const sign = cut.retained === "negative" ? 1 : -1;
  const outward = {
    x: sign * (cut.normal.x / norm),
    y: sign * (cut.normal.y / norm),
    z: sign * (cut.normal.z / norm),
  };
  return {
    outward,
    signed: (p: Point3) => {
      const d = dot(subtract(p, cut.point), outward);
      return Math.abs(d) <= tolerance ? 0 : d;
    },
  };
}
export type CutFrame = ReturnType<typeof cutFrame>;

function crossings(ring: Point3[], frame: CutFrame) {
  const points: Point3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      da = frame.signed(a),
      db = frame.signed(b);
    if (da === 0) points.push(a);
    if (da * db < 0) points.push(interpolate(a, b, da / (da - db)));
  }
  return points;
}

export function elementTrace(
  points: Point3[],
  frame: CutFrame,
): Segment | undefined {
  if (!points.some((p) => frame.signed(p) > 0)) return;
  const hits = crossings(points, frame);
  if (hits.length === 2 && distance(hits[0], hits[1]) > tolerance)
    return [hits[0], hits[1]];
}

function surface(object: CutObject, normal: Point3, frame: CutFrame) {
  const rings = object.outlines,
    points = rings.flat();
  if (points.every((p) => frame.signed(p) === 0)) {
    object.notice = "Superfície coplanar";
    object.unavailable = true;
    return;
  }
  const hits = rings.flatMap((ring) => crossings(ring, frame));
  if (!hits.length) return;
  const boundary = rings.some((ring) =>
    ring.some(
      (p, i) =>
        frame.signed(p) === 0 &&
        frame.signed(ring[(i + 1) % ring.length]) === 0,
    ),
  );
  if (boundary) {
    object.notice = "Corte coincidente com borda física ou interface";
    object.unavailable = true;
  }
  const tangent = cross(normal, frame.outward);
  const mag = length(tangent);
  if (!mag) return;
  const u = scale(tangent, 1 / mag),
    v = cross(normal, u);
  hits.sort((a, b) => dot(subtract(a, b), u));
  const distinct = hits.filter(
    (p, i) => !i || distance(p, hits[i - 1]) > tolerance,
  );
  for (let i = 1; i < distinct.length; i++) {
    const a = distinct[i - 1],
      b = distinct[i],
      mid = interpolate(a, b, 0.5);
    // Even/odd in physical coordinates also covers concave outlines and holes.
    let inside = false;
    for (const ring of rings)
      for (let j = 0; j < ring.length; j++) {
        const start = subtract(ring[j], mid),
          end = subtract(ring[(j + 1) % ring.length], mid);
        const y0 = dot(start, v),
          y1 = dot(end, v);
        if (
          y0 > 0 !== y1 > 0 &&
          dot(interpolate(start, end, y0 / (y0 - y1)), u) > 0
        )
          inside = !inside;
      }
    if (inside || boundary) object.traces.push([a, b]);
  }
  if (!object.traces.length && !object.notice)
    object.notice = "Tangência em vértice";
}

export function cutGeometry(project: Project, cut: SectionCut) {
  const frame = cutFrame(cut),
    objects: CutObject[] = [];
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  function object(
    id: string,
    name: string,
    kind: CutObject["kind"],
    outlines: Point3[][],
  ) {
    const o: CutObject = { id, name, kind, outlines, traces: [], hits: [] };
    objects.push(o);
    return o;
  }
  for (const m of project.members) {
    const a = nodes.get(m.start)!,
      b = nodes.get(m.end)!;
    const axis = memberAxis(m, a, b),
      line = [a, axis.start, axis.end, b];
    const o = object(m.id, m.name, "member", [line]);
    for (let i = 0; i < 3; i++) {
      const start = line[i],
        end = line[i + 1];
      if (distance(start, end) < tolerance) continue;
      const da = frame.signed(start),
        db = frame.signed(end);
      if (!da && !db) {
        o.notice = "Trecho de barra no plano";
        o.unavailable = true;
        continue;
      }
      if (da > 0 === db > 0) continue;
      const t = da / (da - db);
      o.hits.push({ point: interpolate(start, end, t), t, link: i });
    }
    if (!o.hits.length && !o.notice && line.some((p) => frame.signed(p) === 0))
      o.notice = "Tangência em extremidade";
  }
  for (const s of project.slabs) {
    const z = project.guides.z.find((g) => g.id === s.levelId)!.position;
    const o = object(
      s.id,
      s.name,
      "slab",
      slabRings(s).map((r) => r.map(({ x, y }) => ({ x, y, z }))),
    );
    surface(o, { ...origin, z: 1 }, frame);
  }
  for (const s of project.surfacePanels ?? []) {
    const g = panelGeometry(s),
      o = object(s.id, s.name, "panel", [Object.values(g.corners)]);
    surface(o, g.axes[2], frame);
  }
  return { frame, objects };
}
