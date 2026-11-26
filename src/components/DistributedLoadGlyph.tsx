import {
  coordinates,
  interpolate,
  length,
  scale,
  type Coordinate,
  type Point3,
} from "../domain/geometry";
import {
  globalIntensity,
  loadInterval,
  zeroCrossings,
  type DistributedLoad,
  type InsertionAxis,
} from "../domain/memberDistributedLoads";
import type { LoadFrame } from "../domain/memberPointLoads";
import { formatQuantity, type UnitPreferences } from "../units";

export function distributedLoadLabel(
  load: DistributedLoad,
  span: number,
  units: UnitPreferences,
) {
  const [a, b] = loadInterval(load, span);
  const range =
    [a, b].map((x) => formatQuantity(x, "length", units)).join("–") +
    " " +
    units.length;
  const components = coordinates
    .filter((k) => load.qStart[k] !== 0 || load.qEnd[k] !== 0)
    .map(
      (k) =>
        `q${k.toUpperCase()} ${formatQuantity(load.qStart[k], "distributedLoad", units)} → ${formatQuantity(load.qEnd[k], "distributedLoad", units)} ${units.distributedLoad}`,
    );
  return [range, ...components, load.system].join(" · ");
}

export function distributedArrows(
  load: DistributedLoad,
  line: InsertionAxis,
  axes: LoadFrame["axes"],
) {
  const [a, b] = loadInterval(load, line.span);
  const first = globalIntensity(load.qStart, load.system, axes),
    last = globalIntensity(load.qEnd, load.system, axes);
  const peak = Math.max(length(first), length(last));
  const breaks = new Set([0, ...zeroCrossings(load.qStart, load.qEnd), 1]);
  const samples = [
    ...new Set([
      ...breaks,
      ...zeroCrossings(first, last),
      ...Array.from({ length: 7 }, (_, i) => i / 6),
    ]),
  ].sort((l, r) => l - r);
  return samples.map((s) => {
    const x = a + (b - a) * s;
    return {
      x,
      s,
      at: interpolate(line.start, line.end, x / line.span),
      direction: scale(interpolate(first, last, s), 1 / peak),
      boundary: breaks.has(s),
    };
  });
}

export default function DistributedLoadGlyph({
  load,
  line,
  basis,
  axes,
  project,
  marker,
  units,
  stationsOnly = false,
}: {
  load: DistributedLoad;
  line: InsertionAxis;
  basis: LoadFrame["axes"];
  axes: readonly [Coordinate, Coordinate, Coordinate];
  project: (point: Point3) => [number, number];
  marker: string;
  units: UnitPreferences;
  stationsOnly?: boolean;
}) {
  const label = distributedLoadLabel(load, line.span, units);
  const [u, v, normal] = axes;
  const arrows = distributedArrows(load, line, basis).map((s) => {
    const [x, y] = project(s.at);
    return {
      ...s,
      x,
      y,
      physicalX: s.x,
      tailX: x - 32 * s.direction[u],
      tailY: y + 32 * s.direction[v],
    };
  });
  const end = arrows.at(-1)!;
  return (
    <g
      className="member-distributed-glyph"
      role="img"
      aria-label={label}
      pointerEvents="none"
    >
      <title>{label}</title>
      {!stationsOnly && (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          points={arrows.map((a) => `${a.tailX},${a.tailY}`).join(" ")}
        />
      )}
      {arrows.map((a, i) => {
        const out = a.direction[normal] * (normal === "y" ? -1 : 1),
          radius = Math.abs(out) * 5;
        return (
          <g key={i}>
            {a.boundary && (
              <g data-load-station={a.physicalX}>
                <circle
                  cx={a.x}
                  cy={a.y}
                  r="3"
                  stroke="currentColor"
                  fill="var(--surface-view)"
                />
                <title>{`${i === 0 ? "Início" : i === arrows.length - 1 ? "Fim" : "Mudança de sinal"} · x = ${formatQuantity(a.physicalX, "length", units)} ${units.length}`}</title>
                {stationsOnly && (
                  <text x={a.x + 4} y={a.y - 6}>
                    x = {formatQuantity(a.physicalX, "length", units)}{" "}
                    {units.length}
                  </text>
                )}
              </g>
            )}
            {!stationsOnly &&
              Math.hypot(a.x - a.tailX, a.y - a.tailY) > 0.02 && (
                <line
                  x1={a.tailX}
                  y1={a.tailY}
                  x2={a.x}
                  y2={a.y}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  markerEnd={`url(#${marker})`}
                />
              )}
            {!stationsOnly && radius > 0.1 && (
              <g transform={`translate(${a.x} ${a.y})`} stroke="currentColor">
                <circle r={radius} fill="var(--surface-view)" />
                {out > 0 ? (
                  <circle r={radius * 0.28} fill="currentColor" />
                ) : (
                  <path
                    d={`M${-radius * 0.65} ${-radius * 0.65}l${radius * 1.3} ${radius * 1.3}m0 ${-radius * 1.3}l${-radius * 1.3} ${radius * 1.3}`}
                  />
                )}
              </g>
            )}
          </g>
        );
      })}
      {!stationsOnly && (
        <text
          x={(arrows[0].tailX + end.tailX) / 2}
          y={Math.min(arrows[0].tailY, end.tailY) - 8}
          textAnchor="middle"
        >
          {label}
        </text>
      )}
    </g>
  );
}
