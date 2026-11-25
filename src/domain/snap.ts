/**
 * Captura geométrica no plano de trabalho ativo, medida em pixels de tela via `scale`.
 *
 * Ordem de prioridade:
 * 1. `node` (raio 12 px): nós pertencentes ao plano ativo (`onPlane`).
 * 2. `midpoint` e `perpendicular` (raio 12 px): barras cujas duas extremidades estão
 *    no plano ativo. O pé da perpendicular só é avaliado quando há `anchor` válido no
 *    plano ativo. Dentro do raio, vence o menor erro em pixels na tela (em empate
 *    <= 1e-6 px, `midpoint` vence de forma determinística).
 * 3. `guide` (raio 10 px por eixo): guias/eixos do plano ativo no modo espacial.
 * 4. `grid` (fallback): malha regular com passo de 0,50 m.
 */
import {
  distance,
  midpoint,
  normalizeCoord,
  onPlane,
  perpendicularFootOnSegment,
  planeCoordinates,
  planePoint,
  tolerance,
  type Point3,
  type WorkPlane,
} from "./geometry";

export type SnapKind =
  | "node"
  | "midpoint"
  | "perpendicular"
  | "guide"
  | "grid"
  | "relative";

export type SnapCandidate = {
  u: number;
  v: number;
  point: Point3;
  kind: SnapKind;
  label: string;
  sourceName?: string;
  distance: number | null;
  screenErrorPx: number;
};

export type SnapInput = {
  rawU: number;
  rawV: number;
  scale: number;
  plane: WorkPlane;
  spatial: boolean;
  orthogonal: boolean;
  shiftKey: boolean;
  tool: "select" | "node" | "member" | "slab";
  anchor: Point3 | null;
  nodes: readonly {
    id: string;
    name: string;
    x: number;
    y: number;
    z: number;
  }[];
  members: readonly { id: string; name: string; start: string; end: string }[];
  uGuides: readonly { position: number }[];
  vGuides: readonly { position: number }[];
};

const POINT_RADIUS_PX = 12;
const GUIDE_RADIUS_PX = 10;

export function resolveWorkPlaneSnap({
  rawU,
  rawV,
  scale,
  plane,
  spatial,
  orthogonal,
  shiftKey,
  tool,
  anchor,
  nodes,
  members,
  uGuides,
  vGuides,
}: SnapInput): SnapCandidate {
  const [axisU, axisV] = planeCoordinates[plane.kind];
  const validAnchor = anchor && onPlane(anchor, plane) ? anchor : null;
  const aligned = Boolean(
    validAnchor && tool === "member" && spatial && orthogonal !== shiftKey,
  );
  const horizontal =
    aligned && validAnchor
      ? Math.abs(rawU - validAnchor[axisU]) >=
        Math.abs(rawV - validAnchor[axisV])
      : false;
  const lockU =
    aligned && validAnchor && !horizontal ? validAnchor[axisU] : null;
  const lockV =
    aligned && validAnchor && horizontal ? validAnchor[axisV] : null;

  const matchesLock = (u: number, v: number) => {
    if (lockU !== null && Math.abs(u - lockU) >= tolerance) return false;
    if (lockV !== null && Math.abs(v - lockV) >= tolerance) return false;
    return true;
  };
  const computeDistance = (point: Point3) =>
    validAnchor ? normalizeCoord(distance(validAnchor, point)) : null;

  const planeNodes = nodes.filter((n) => onPlane(n, plane));
  const nodeMap = new Map(planeNodes.map((n) => [n.id, n]));

  let bestNode: SnapCandidate | null = null;
  for (const n of planeNodes) {
    const u = n[axisU];
    const v = n[axisV];
    if (!matchesLock(u, v)) continue;
    const error = Math.hypot(u - rawU, v - rawV) * scale;
    if (error < (bestNode?.screenErrorPx ?? POINT_RADIUS_PX)) {
      const point = planePoint(u, v, plane);
      bestNode = {
        u,
        v,
        point,
        kind: "node",
        label: `Nó ${n.name}`,
        sourceName: n.name,
        distance: computeDistance(point),
        screenErrorPx: error,
      };
    }
  }
  if (bestNode) return bestNode;

  let bestSegmentRef: SnapCandidate | null = null;
  const considerSegmentRef = (candidate: SnapCandidate) => {
    if (candidate.screenErrorPx >= POINT_RADIUS_PX) return;
    if (!bestSegmentRef) {
      bestSegmentRef = candidate;
      return;
    }
    const diff = candidate.screenErrorPx - bestSegmentRef.screenErrorPx;
    if (diff < -1e-6) {
      bestSegmentRef = candidate;
    } else if (
      Math.abs(diff) <= 1e-6 &&
      candidate.kind === "midpoint" &&
      bestSegmentRef.kind === "perpendicular"
    ) {
      bestSegmentRef = candidate;
    }
  };

  for (const m of members) {
    const a = nodeMap.get(m.start);
    const b = nodeMap.get(m.end);
    if (!a || !b || distance(a, b) < tolerance) continue;

    const mid = midpoint(a, b);
    const midU = mid[axisU];
    const midV = mid[axisV];
    if (matchesLock(midU, midV)) {
      considerSegmentRef({
        u: midU,
        v: midV,
        point: mid,
        kind: "midpoint",
        label: `Ponto médio (${m.name})`,
        sourceName: m.name,
        distance: computeDistance(mid),
        screenErrorPx: Math.hypot(midU - rawU, midV - rawV) * scale,
      });
    }

    if (validAnchor) {
      const foot = perpendicularFootOnSegment(validAnchor, a, b);
      if (foot) {
        const footU = foot[axisU];
        const footV = foot[axisV];
        if (matchesLock(footU, footV)) {
          considerSegmentRef({
            u: footU,
            v: footV,
            point: foot,
            kind: "perpendicular",
            label: `Perpendicular (${m.name})`,
            sourceName: m.name,
            distance: computeDistance(foot),
            screenErrorPx: Math.hypot(footU - rawU, footV - rawV) * scale,
          });
        }
      }
    }
  }
  if (bestSegmentRef) return bestSegmentRef;

  const snapAxis = (
    value: number,
    guides: readonly { position: number }[],
    locked: number | null,
  ) => {
    if (locked !== null) return { position: locked, isGuide: false };
    const closest = guides.reduce(
      (best, g) =>
        Math.abs(g.position - value) < Math.abs(best - value)
          ? g.position
          : best,
      Infinity,
    );
    if (Math.abs(closest - value) * scale < GUIDE_RADIUS_PX) {
      return { position: closest, isGuide: true };
    }
    return { position: Math.round(value * 2) / 2, isGuide: false };
  };

  const activeUGuides = spatial ? uGuides : [];
  const activeVGuides = spatial ? vGuides : [];
  const snappedU = snapAxis(rawU, activeUGuides, lockU);
  const snappedV = snapAxis(rawV, activeVGuides, lockV);
  const u = normalizeCoord(snappedU.position);
  const v = normalizeCoord(snappedV.position);
  const kind: SnapKind =
    snappedU.isGuide || snappedV.isGuide ? "guide" : "grid";
  const point = planePoint(u, v, plane);

  return {
    u,
    v,
    point,
    kind,
    label: kind === "guide" ? "Guia" : "Malha 0,50 m",
    distance: computeDistance(point),
    screenErrorPx: Math.hypot(u - rawU, v - rawV) * scale,
  };
}
