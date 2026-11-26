import type { Slab } from "./model";
import { meshSlab, type SlabMesh } from "./slab";
import { cross2, slabProperties, slabRings, type XY } from "./slabPolygon";

export interface MeshIssue {
  element: number;
  level: "invalid" | "warning";
  reason: string;
  at: XY;
}
const distance = (a: XY, b: XY) => Math.hypot(b.x - a.x, b.y - a.y);
export function inspectSlabMesh(slab: Slab, mesh: SlabMesh) {
  const issues: MeshIssue[] = [];
  const incidence = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}/${b}` : `${b}/${a}`);
  let area = 0,
    minAngle = 180,
    minJacobian = Infinity,
    minRatio = 1;
  for (const el of mesh.elements) {
    const pts = el.nodes.map((i) => mesh.nodes[i - 1]),
      n = pts.length;
    const at = { x: 0, y: 0 };
    let issue: Omit<MeshIssue, "element" | "at"> | undefined;
    if (pts.some((p) => !p)) {
      issues.push({
        element: el.number,
        level: "invalid",
        reason: "Nó de conectividade ausente",
        at,
      });
      continue;
    }
    const lengths = pts.map((p, i) => distance(p, pts[(i + 1) % n])),
      scale = Math.max(...lengths);
    for (const [i, p] of pts.entries()) {
      at.x += p.x / n;
      at.y += p.y / n;
      const edge = key(el.nodes[i], el.nodes[(i + 1) % n]);
      incidence.set(edge, (incidence.get(edge) ?? 0) + 1);
    }
    const twice =
      cross2(pts[0], pts[1], pts[2]) +
      (n === 4 ? cross2(pts[0], pts[2], pts[3]) : 0);
    area += twice / 2;
    if (n === 3) {
      const angles = pts.map((p, i) => {
        const a = pts[(i + 1) % 3],
          b = pts[(i + 2) % 3];
        return (
          (Math.atan2(
            Math.abs(cross2(p, a, b)),
            (a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y),
          ) *
            180) /
          Math.PI
        );
      });
      const angle = Math.min(...angles);
      minAngle = Math.min(minAngle, angle);
      if (!(twice > 1e-10 * scale ** 2))
        issue = {
          level: "invalid",
          reason: "Área orientada nula, invertida ou numericamente degenerada",
        };
      else if (angle < 15)
        issue = {
          level: "warning",
          reason: `Ângulo mínimo ${angle.toFixed(2)}° inferior a 15°`,
        };
    } else {
      const jac = pts.map(
        (p, i) => cross2(p, pts[(i + 1) % 4], pts[(i + 3) % 4]) / 4,
      );
      const lo = Math.min(...jac),
        hi = Math.max(...jac),
        ratio = Math.min(lo / hi, Math.min(...lengths) / scale);
      minJacobian = Math.min(minJacobian, lo);
      minRatio = Math.min(minRatio, ratio);
      if (!(lo > (1e-10 * scale ** 2) / 4))
        issue = {
          level: "invalid",
          reason: "Jacobiano não positivo ou numericamente degenerado",
        };
      else if (ratio < 0.1)
        issue = {
          level: "warning",
          reason: `Distorção do quadrilátero · razão ${ratio.toPrecision(3)} inferior a 0,1`,
        };
    }
    if (issue) issues.push({ element: el.number, at, ...issue });
  }
  const boundaries = new Set<string>();
  for (const vertex of slabRings(slab).flat()) {
    const line = mesh.edges[vertex.edgeId];
    if (!line || line.length < 2) {
      issues.push({
        element: 0,
        level: "invalid",
        reason: "Borda física ausente na malha",
        at: vertex,
      });
      continue;
    }
    for (let i = 1; i < line.length; i++)
      boundaries.add(key(line[i - 1], line[i]));
  }
  const { area: expected, centroid } = slabProperties(slab);
  if (
    Math.abs(area - expected) > 1e-9 * expected ||
    !Number.isFinite(area) ||
    [...boundaries].some((edge) => incidence.get(edge) !== 1) ||
    [...incidence].some(([edge, n]) => n !== (boundaries.has(edge) ? 1 : 2))
  )
    issues.push({
      element: 0,
      level: "invalid",
      reason: "Área ou conectividade incompatível com as fronteiras físicas",
      at: centroid,
    });
  return {
    area,
    issues,
    minAngle: slab.formulation === "dkt" ? minAngle : null,
    minJacobian: slab.formulation === "qdkt" ? minJacobian : null,
    minRatio,
  };
}
export function previewSlabMesh(slab: Slab, z = 0) {
  try {
    const mesh = meshSlab(slab, z);
    return { mesh, quality: inspectSlabMesh(slab, mesh), error: null };
  } catch (err) {
    return {
      mesh: null,
      quality: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
