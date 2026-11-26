import { coordinates, type Coordinate, type Point3 } from "../domain/geometry";
import {
  distanceFromI,
  type MemberPointLoad,
} from "../domain/memberPointLoads";
import { formatQuantity, type UnitPreferences } from "../units";

export function pointLoadLabel(
  load: MemberPointLoad,
  span: number,
  units: UnitPreferences,
) {
  const prefix = load.kind === "force" ? "F" : "M";
  const values = coordinates
    .filter((k) => load.components[k] !== 0)
    .map(
      (k) =>
        `${prefix}${k.toUpperCase()} ${formatQuantity(load.components[k], load.kind, units)} ${units[load.kind]}`,
    );
  return `${values.join(" · ")} ${load.system} · x = ${formatQuantity(distanceFromI(load.position, span), "length", units)} ${units.length}`;
}
export default function PointLoadGlyph({
  x,
  y,
  vector,
  axes,
  label,
  kind,
  marker,
}: {
  x: number;
  y: number;
  vector: Point3;
  axes: readonly [Coordinate, Coordinate, Coordinate];
  label: string;
  kind: MemberPointLoad["kind"];
  marker: string;
}) {
  const [u, v, normal] = axes;
  const size = Math.hypot(vector.x, vector.y, vector.z);
  const projected = Math.hypot(vector[u], vector[v]);
  const norm = projected > size * 1e-12 ? projected : 0;
  const dx = norm ? (vector[u] / norm) * 31 : 0,
    dy = norm ? (-vector[v] / norm) * 31 : 0;
  const outward = vector[normal] * (normal === "y" ? -1 : 1);
  return (
    <g
      className="member-point-glyph"
      role="img"
      aria-label={label}
      transform={`translate(${x} ${y})`}
      pointerEvents="none"
    >
      <title>{label}</title>
      <circle r="2.5" fill="currentColor" />
      {norm > 0 && (
        <g
          stroke="currentColor"
          strokeWidth="1.7"
          markerEnd={`url(#${marker})`}
        >
          <line x1={-dx} y1={-dy} x2="0" y2="0" />
          {kind === "moment" && (
            <line
              x1={-dx * 0.75}
              y1={-dy * 0.75}
              x2={-dx * 0.32}
              y2={-dy * 0.32}
            />
          )}
        </g>
      )}
      {Math.abs(outward) > size * 1e-12 &&
        (kind === "moment" ? (
          <path
            d={
              outward > 0
                ? "M 10,5 A 12,12 0 1 0 -10,5"
                : "M -10,5 A 12,12 0 1 1 10,5"
            }
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            markerEnd={`url(#${marker})`}
          />
        ) : (
          <g stroke="currentColor">
            <circle r="6" fill="var(--surface-view)" />
            {outward > 0 ? (
              <circle r="1.8" fill="currentColor" />
            ) : (
              <path d="M-3,-3l6,6m0,-6l-6,6" />
            )}
          </g>
        ))}
      <text x={-dx + 7} y={-dy - 6} fill="currentColor">
        {label}
      </text>
    </g>
  );
}
