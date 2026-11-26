import { ShapeUtils, Vector2 } from "three";
import type { PolygonSlab } from "./model";
import type { SlabMesh, SlabNode } from "./slab";
import {
  cross2,
  footprintProperties,
  nextIndex,
  type SlabRing,
  type XY,
} from "./slabPolygon";

type Triangle = [number, number, number];
const sideKey = (a: number, b: number) => (a < b ? `${a}/${b}` : `${b}/${a}`);

// Earcut may bridge a hole along a line containing another boundary vertex.
// Split both sides of every such edge before subdivision to keep matching nodes.
function conformingTriangles(rings: SlabRing[], vertices: XY[]) {
  const paths = rings.map((ring) => ring.map((v) => new Vector2(v.x, v.y)));
  const pending = ShapeUtils.triangulateShape(
    paths[0],
    paths.slice(1),
  ) as Triangle[];
  const triangles: Triangle[] = [];
  while (pending.length) {
    const face = pending.pop()!;
    let split = false;
    for (let side = 0; side < 3 && !split; side++) {
      const ia = face[side],
        ib = face[(side + 1) % 3],
        ic = face[(side + 2) % 3];
      const a = vertices[ia],
        b = vertices[ib],
        dx = b.x - a.x,
        dy = b.y - a.y;
      for (const [k, p] of vertices.entries()) {
        if (face.includes(k)) continue;
        const cross = cross2(a, b, p);
        const roundoff =
          8 *
          Number.EPSILON *
          (Math.abs(dx * (p.y - a.y)) + Math.abs(dy * (p.x - a.x)));
        if (
          Math.abs(cross) > roundoff ||
          (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y) >= 0
        )
          continue;
        pending.push([ia, k, ic], [k, ib, ic]);
        split = true;
        break;
      }
    }
    if (!split) {
      const [a, b, c] = face;
      const orientation = cross2(vertices[a], vertices[b], vertices[c]);
      if (!orientation)
        throw new Error("A triangulação produziu um elemento com área nula.");
      triangles.push(orientation > 0 ? face : [a, c, b]);
    }
  }
  return triangles;
}

export function meshPolygon(
  polygon: PolygonSlab["polygon"],
  z: number,
): SlabMesh {
  const { rings, refinements } = polygon;
  const vertices = rings.flat();
  const nodes: SlabNode[] = vertices.map(({ x, y }, i) => ({
    x,
    y,
    z,
    number: i + 1,
    restraints: [],
  }));
  let triangles = conformingTriangles(rings, vertices).map(
    ([a, b, c]): Triangle => [a + 1, b + 1, c + 1],
  );
  const edges: SlabMesh["edges"] = Object.create(null);
  let offset = 1;
  for (const ring of rings) {
    for (const [i, a] of ring.entries())
      edges[a.edgeId] = [offset + i, offset + nextIndex(i, ring.length)];
    offset += ring.length;
  }
  const incidence = new Map<string, number>();
  let area = 0;
  for (const face of triangles) {
    const [a, b, c] = face.map((i) => nodes[i - 1]);
    area += cross2(a, b, c) / 2;
    for (const [i, n] of face.entries()) {
      const key = sideKey(n, face[(i + 1) % 3]);
      incidence.set(key, (incidence.get(key) ?? 0) + 1);
    }
  }
  const boundaries = new Set(
    Object.values(edges).map(([a, b]) => sideKey(a, b)),
  );
  const expected = footprintProperties(rings).area;
  if (
    Math.abs(area - expected) > 1e-9 * expected ||
    [...boundaries].some((key) => incidence.get(key) !== 1) ||
    [...incidence].some(([key, n]) => n !== (boundaries.has(key) ? 1 : 2))
  )
    throw new Error(
      "A triangulação não cobre a área líquida ou não preserva uma borda do painel.",
    );

  for (let level = 0; level < refinements; level++) {
    const midpoints = new Map<string, number>();
    const midpoint = (a: number, b: number) => {
      const key = sideKey(a, b);
      const existing = midpoints.get(key);
      if (existing !== undefined) return existing;
      const u = nodes[a - 1],
        v = nodes[b - 1],
        number = nodes.length + 1;
      nodes.push({
        number,
        x: u.x + (v.x - u.x) / 2,
        y: u.y + (v.y - u.y) / 2,
        z,
        restraints: [],
      });
      midpoints.set(key, number);
      return number;
    };
    triangles = triangles.flatMap(([a, b, c]): Triangle[] => {
      const ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      return [
        [a, ab, ca],
        [ab, b, bc],
        [ca, bc, c],
        [ab, bc, ca],
      ];
    });
    for (const [id, line] of Object.entries(edges))
      edges[id] = line.flatMap((a, i) =>
        i + 1 < line.length ? [a, midpoint(a, line[i + 1])] : [a],
      );
  }
  let meshArea = 0;
  for (const [ia, ib, ic] of triangles) {
    const part = cross2(nodes[ia - 1], nodes[ib - 1], nodes[ic - 1]) / 2;
    if (!(part > 0))
      throw new Error(
        "O refinamento gerou um triângulo de área nula ou invertida. Revise as coordenadas das bordas.",
      );
    meshArea += part;
  }
  if (
    !Number.isFinite(meshArea) ||
    Math.abs(meshArea - expected) > 1e-9 * expected
  )
    throw new Error(
      "A precisão das coordenadas não conserva a área líquida ao refinar as bordas.",
    );
  const axes = new Map<number, XY>();
  for (const ring of rings)
    for (const [i, a] of ring.entries()) {
      if (!a.supported) continue;
      const b = ring[nextIndex(i, ring.length)],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      const tangent = { x: dx / length, y: dy / length };
      for (const number of edges[a.edgeId]) {
        const node = nodes[number - 1],
          prior = axes.get(number);
        if (prior) {
          if (Math.abs(prior.x * tangent.y - prior.y * tangent.x) > 1e-12) {
            node.restraints = [3, 4, 5];
            delete node.tangent;
          }
        } else {
          axes.set(number, tangent);
          node.restraints = dx === 0 ? [3, 4] : [3, 5];
          if (dx !== 0 && dy !== 0) node.tangent = tangent;
        }
      }
    }
  return {
    nodes,
    edges,
    elements: triangles.map((nodes, i) => ({ number: i + 1, nodes })),
  };
}

export function materialSample(mesh: SlabMesh, centroid: XY) {
  let nearest:
    | { point: XY; face: number[]; weights: number[]; relocated: boolean }
    | undefined;
  let distance = Infinity;
  for (const { nodes: face } of mesh.elements) {
    const [a, b, c] = face.map((i) => mesh.nodes[i - 1]);
    const area = cross2(a, b, c);
    const weights = [
      cross2(b, c, centroid) / area,
      cross2(c, a, centroid) / area,
      cross2(a, b, centroid) / area,
    ];
    if (weights.every((w) => w >= -1e-12))
      return { point: centroid, face, weights, relocated: false };
    const point = {
      x: a.x + (b.x - a.x + (c.x - a.x)) / 3,
      y: a.y + (b.y - a.y + (c.y - a.y)) / 3,
    };
    const gap = Math.hypot(point.x - centroid.x, point.y - centroid.y);
    if (gap < distance) {
      nearest = {
        point,
        face,
        weights: [1 / 3, 1 / 3, 1 / 3],
        relocated: true,
      };
      distance = gap;
    }
  }
  if (!nearest)
    throw new Error("A malha não possui um ponto material para a consulta.");
  return nearest;
}
