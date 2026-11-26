import {
  planeCoordinates,
  type PlaneKind,
  type Point3,
  type beamAxes,
} from "../domain/geometry";
import { thermalLabel, type ThermalField } from "../domain/thermalLoads";

export default function ThermalLoadGlyph({
  field,
  memberName,
  anchor,
  basis,
  plane,
  sx,
  sy,
  marker,
}: {
  field: ThermalField;
  memberName: string;
  anchor: Point3;
  basis: ReturnType<typeof beamAxes>;
  plane: PlaneKind;
  sx: (u: number) => number;
  sy: (v: number) => number;
  marker: string;
}) {
  const label = thermalLabel(field);
  if (!label) return null;
  const [u, v, normal] = planeCoordinates[plane];
  const x = sx(anchor[u]),
    y = sy(anchor[v]);
  return (
    <g
      role="img"
      aria-label={`Ação térmica em ${memberName}: ${label}`}
      data-thermal-member={field.memberId}
      pointerEvents="none"
      fill="var(--geometry-load)"
    >
      <title>{label}</title>
      <text x={x + 5} y={y + 17} fontSize="11">
        {label}
      </text>
      {[field.deltaY, field.deltaZ].map((delta, i) => {
        if (!delta) return null;
        const axis = basis[i + 1],
          size = 23 * Math.sign(delta);
        const dx = size * axis[u],
          dy = -size * axis[v];
        if (Math.hypot(dx, dy) < 3) {
          const towardViewer =
            axis[normal] * size * (plane === "XZ" ? -1 : 1) > 0;
          return (
            <text key={i} x={x - 10} y={y - 4}>
              {towardViewer ? "⊙" : "⊗"}
            </text>
          );
        }
        return (
          <line
            key={i}
            x1={x}
            y1={y}
            x2={x + dx}
            y2={y + dy}
            stroke="var(--geometry-load)"
            strokeWidth="2"
            markerEnd={`url(#${marker})`}
          />
        );
      })}
    </g>
  );
}
