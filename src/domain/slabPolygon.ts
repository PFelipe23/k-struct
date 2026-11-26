import { tolerance } from "./geometry";
import type { Slab } from "./model";

export type XY = { x: number; y: number };
// Each vertex owns the physical edge running to the next vertex.
export type SlabVertex = XY & { edgeId: string; supported: boolean };
export type SlabRing = SlabVertex[];
export const maxSlabVertices = 128;
export const maxSlabRings = Math.floor(maxSlabVertices / 3);
export const ringName = (i: number) =>
  i === 0 ? "Contorno externo" : `Abertura ${i}`;
export const nextIndex = (i: number, n: number) => (i + 1) % n;
export const cross2 = (a: XY, b: XY, c: XY) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const distance = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

function ringProperties(ring: XY[], origin: XY) {
  let twiceArea = 0,
    firstX = 0,
    firstY = 0;
  for (const [i, a] of ring.entries()) {
    const b = ring[nextIndex(i, ring.length)];
    const cross = cross2(origin, a, b);
    twiceArea += cross;
    firstX += (a.x - origin.x + (b.x - origin.x)) * cross;
    firstY += (a.y - origin.y + (b.y - origin.y)) * cross;
  }
  return { area: twiceArea / 2, firstX: firstX / 6, firstY: firstY / 6 };
}

export function footprintProperties(rings: XY[][]) {
  const origin = rings[0][0];
  let area = 0,
    firstX = 0,
    firstY = 0;
  for (const [i, ring] of rings.entries()) {
    const part = ringProperties(ring, origin);
    const direction = Math.sign(part.area) * (i === 0 ? 1 : -1);
    area += direction * part.area;
    firstX += direction * part.firstX;
    firstY += direction * part.firstY;
  }
  return {
    area,
    centroid: { x: origin.x + firstX / area, y: origin.y + firstY / area },
  };
}

function nearSegment(p: XY, a: XY, b: XY) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= tolerance;
}

function touch(a: XY, b: XY, c: XY, d: XY) {
  return (
    (Math.sign(cross2(a, b, c)) * Math.sign(cross2(a, b, d)) < 0 &&
      Math.sign(cross2(c, d, a)) * Math.sign(cross2(c, d, b)) < 0) ||
    nearSegment(a, c, d) ||
    nearSegment(b, c, d) ||
    nearSegment(c, a, b) ||
    nearSegment(d, a, b)
  );
}

export function insideRing(p: XY, ring: XY[]) {
  let inside = false;
  for (const [i, a] of ring.entries()) {
    const b = ring[nextIndex(i, ring.length)];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x - a.x < (b.x - a.x) * ((p.y - a.y) / (b.y - a.y))
    )
      inside = !inside;
  }
  return inside;
}

export const inMaterial = (p: XY, rings: XY[][]) =>
  insideRing(p, rings[0]) &&
  !rings.slice(1).some((ring) => insideRing(p, ring));

export function polygonError(rings: SlabRing[]): string | null {
  if (!rings.length) return "Trace o contorno externo.";
  if (
    rings.length > maxSlabRings ||
    rings.reduce((n, r) => n + r.length, 0) > maxSlabVertices
  )
    return `Use até ${maxSlabVertices} vértices no conjunto dos contornos do painel.`;
  const ids = new Set<string>();
  const segments: { a: XY; b: XY; r: number; i: number }[] = [];
  for (const [r, ring] of rings.entries()) {
    const name = ringName(r);
    if (ring.length < 3) return `${name}: marque pelo menos três vértices.`;
    for (const [i, a] of ring.entries()) {
      const j = nextIndex(i, ring.length),
        b = ring[j];
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y))
        return `${name}, vértice ${i + 1}: coordenada inválida.`;
      if (ids.has(a.edgeId))
        return `${name}, borda ${i + 1}: identificador repetido.`;
      ids.add(a.edgeId);
      for (let k = 0; k < i; k++)
        if (distance(a, ring[k]) <= tolerance)
          return `${name}: vértices ${k + 1} e ${i + 1} repetidos.`;
      const c = ring[nextIndex(j, ring.length)];
      if (nearSegment(c, a, b) || nearSegment(a, b, c))
        return `${name}: bordas ${i + 1} e ${j + 1} sobrepostas ou vértices repetidos.`;
      for (const other of segments) {
        if (other.r === r && (other.i + 1 === i || (other.i === 0 && j === 0)))
          continue;
        if (touch(a, b, other.a, other.b))
          return `${name}, borda ${i + 1}: cruza ou toca ${ringName(other.r).toLowerCase()}, borda ${other.i + 1}.`;
      }
      segments.push({ a, b, r, i });
    }
    const { area } = ringProperties(ring, ring[0]);
    if (!Number.isFinite(area) || Math.abs(area) <= tolerance ** 2)
      return `${name}: área nula ou inválida entre os vértices.`;
    if (r && !insideRing(ring[0], rings[0]))
      return `${name}, vértice 1: fora do contorno externo.`;
    for (let k = 1; k < r; k++) {
      if (insideRing(ring[0], rings[k]) || insideRing(rings[k][0], ring))
        return `${name} e ${ringName(k).toLowerCase()}: aberturas sobrepostas.`;
    }
  }
  const { area, centroid } = footprintProperties(rings);
  return area > tolerance ** 2 &&
    Number.isFinite(area) &&
    Number.isFinite(centroid.x) &&
    Number.isFinite(centroid.y)
    ? null
    : "O contorno e as aberturas geram uma área líquida inválida.";
}

export function normalizeRings(rings: SlabRing[]): SlabRing[] {
  const error = polygonError(rings);
  if (error) throw new Error(error);
  return rings.map((ring, r) => {
    if (ringProperties(ring, ring[0]).area > 0 === (r === 0)) return ring;
    // Keep the first vertex and carry each support with its undirected segment.
    return ring.map((_, i) => {
      const j = (ring.length - i) % ring.length;
      const edge = ring[(j + ring.length - 1) % ring.length];
      return { ...ring[j], edgeId: edge.edgeId, supported: edge.supported };
    });
  });
}

export function slabRings(slab: Slab): SlabRing[] {
  if (slab.polygon) return slab.polygon.rings;
  const { x, y, lengthX, lengthY, supports } = slab;
  return [
    [
      { x, y, edgeId: "yMin", supported: supports.yMin },
      { x: x + lengthX, y, edgeId: "xMax", supported: supports.xMax },
      {
        x: x + lengthX,
        y: y + lengthY,
        edgeId: "yMax",
        supported: supports.yMax,
      },
      { x, y: y + lengthY, edgeId: "xMin", supported: supports.xMin },
    ],
  ];
}

export function slabProperties(slab: Slab) {
  return slab.polygon
    ? footprintProperties(slab.polygon.rings)
    : {
        area: slab.lengthX * slab.lengthY,
        centroid: {
          x: slab.x + slab.lengthX / 2,
          y: slab.y + slab.lengthY / 2,
        },
      };
}

export function stablePolygonSupports(rings: SlabRing[]) {
  const ends = rings.flatMap((ring) =>
    ring.flatMap((a, i) =>
      a.supported ? [a, ring[nextIndex(i, ring.length)]] : [],
    ),
  );
  if (ends.length < 4) return false;
  const [a, b] = ends;
  return ends.some(
    (c) => Math.abs(cross2(a, b, c)) > tolerance * distance(a, b),
  );
}
