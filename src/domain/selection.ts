import {
  onPlane,
  planeCoordinates,
  tolerance,
  type WorkPlane,
} from "./geometry";
import { memberAxis, memberOnPlane } from "./memberOffsets";
import { inMaterial, slabRings } from "./slabPolygon";
import type { Project, SelectedObject } from "./model";

export type SelectionMode = "replace" | "add" | "subtract" | "intersect";
export type SelectionFilter = {
  kind: SelectedObject["kind"] | "";
  levelId: string;
  materialId: string;
  sectionId: string;
};
export const allObjects: SelectionFilter = {
  kind: "",
  levelId: "",
  materialId: "",
  sectionId: "",
};
export const selectionKey = ({ kind, id }: SelectedObject) => `${kind}:${id}`;

export function combineSelection(
  current: SelectedObject[],
  matches: SelectedObject[],
  mode: SelectionMode,
) {
  if (mode === "replace") return [...matches];
  if (mode === "add") {
    const keys = new Set(current.map(selectionKey));
    return [
      ...current,
      ...matches.filter((obj) => !keys.has(selectionKey(obj))),
    ];
  }
  const keys = new Set(matches.map(selectionKey));
  return current.filter(
    (obj) => keys.has(selectionKey(obj)) === (mode === "intersect"),
  );
}

export function filterObjects(
  p: Project,
  filter: SelectionFilter,
): SelectedObject[] {
  const found: SelectedObject[] = [];
  const level = p.guides.z.find((g) => g.id === filter.levelId);
  if (filter.levelId && !level) return found;
  const atLevel = (z: number) =>
    !level || Math.abs(z - level.position) < tolerance;
  if (
    (!filter.kind || filter.kind === "node") &&
    !filter.materialId &&
    !filter.sectionId
  )
    for (const node of p.nodes)
      if (atLevel(node.z)) found.push({ kind: "node", id: node.id });
  if (!filter.kind || filter.kind === "member") {
    const nodes = new Map(p.nodes.map((n) => [n.id, n]));
    const sections = new Map(p.sections.map((s) => [s.id, s]));
    for (const bar of p.members) {
      if (filter.sectionId && bar.sectionId !== filter.sectionId) continue;
      if (
        filter.materialId &&
        sections.get(bar.sectionId)?.materialId !== filter.materialId
      )
        continue;
      if (atLevel(nodes.get(bar.start)!.z) && atLevel(nodes.get(bar.end)!.z))
        found.push({ kind: "member", id: bar.id });
    }
  }
  if ((!filter.kind || filter.kind === "slab") && !filter.sectionId)
    for (const slab of p.slabs)
      if (
        (!level || slab.levelId === level.id) &&
        (!filter.materialId || slab.materialId === filter.materialId)
      )
        found.push({ kind: "slab", id: slab.id });
  return found;
}

export type ViewPoint = { u: number; v: number };
type Box = { left: number; right: number; bottom: number; top: number };
const inside = ({ u, v }: ViewPoint, b: Box) =>
  u >= b.left && u <= b.right && v >= b.bottom && v <= b.top;

// Clip the segment parameter to the overlap with both closed coordinate intervals.
function intersects(a: ViewPoint, b: ViewPoint, rect: Box) {
  let first = 0,
    last = 1;
  for (const [start, end, min, max] of [
    [a.u, b.u, rect.left, rect.right],
    [a.v, b.v, rect.bottom, rect.top],
  ]) {
    const d = end - start;
    if (d === 0) {
      if (start < min || start > max) return false;
    } else {
      const t1 = (min - start) / d,
        t2 = (max - start) / d;
      first = Math.max(first, Math.min(t1, t2));
      last = Math.min(last, Math.max(t1, t2));
      if (first > last) return false;
    }
  }
  return true;
}

export function objectsInWindow(
  p: Project,
  plane: WorkPlane,
  from: ViewPoint,
  to: ViewPoint,
): SelectedObject[] {
  const crossing = from.u > to.u;
  const bounds = {
    left: Math.min(from.u, to.u) - tolerance,
    right: Math.max(from.u, to.u) + tolerance,
    bottom: Math.min(from.v, to.v) - tolerance,
    top: Math.max(from.v, to.v) + tolerance,
  };
  const [u, v] = planeCoordinates[plane.kind];
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const found: SelectedObject[] = [];
  for (const node of p.nodes) {
    if (!onPlane(node, plane)) continue;
    const point = { u: node[u], v: node[v] };
    if (inside(point, bounds)) found.push({ kind: "node", id: node.id });
  }
  for (const m of p.members) {
    const a = byId.get(m.start)!,
      b = byId.get(m.end)!;
    if (!memberOnPlane(m, a, b, plane)) continue;
    const axis = memberAxis(m, a, b);
    const points = (m.offsets ? [a, axis.start, axis.end, b] : [a, b]).map(
      (n) => ({ u: n[u], v: n[v] }),
    );
    if (
      crossing
        ? points.slice(1).some((pt, i) => intersects(points[i], pt, bounds))
        : points.every((pt) => inside(pt, bounds))
    )
      found.push({ kind: "member", id: m.id });
  }
  if (plane.kind === "XY")
    for (const slab of p.slabs) {
      const level = p.guides.z.find((g) => g.id === slab.levelId);
      if (!level || Math.abs(level.position - plane.offset) >= tolerance)
        continue;
      const rings = slabRings(slab);
      const corners = [
        { x: bounds.left, y: bounds.bottom },
        { x: bounds.left, y: bounds.top },
        { x: bounds.right, y: bounds.bottom },
        { x: bounds.right, y: bounds.top },
      ];
      const uv = ({ x, y }: { x: number; y: number }) => ({ u: x, v: y });
      const hit = crossing
        ? corners.some((p) => inMaterial(p, rings)) ||
          rings.some((ring) =>
            ring.some((v, i) =>
              intersects(uv(v), uv(ring[(i + 1) % ring.length]), bounds),
            ),
          )
        : rings[0].every((v) => inside(uv(v), bounds));
      if (hit) found.push({ kind: "slab", id: slab.id });
    }
  return found;
}
