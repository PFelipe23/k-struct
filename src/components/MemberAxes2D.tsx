import {
  beamAxes,
  coordinates,
  planeCoordinates,
  type PlaneKind,
} from "../domain/geometry";
import type { Member, Project, StructuralNode } from "../domain/model";

export default function MemberAxes2D({
  member,
  a,
  b,
  mode,
  plane,
  sx,
  sy,
}: {
  member: Member;
  a: StructuralNode;
  b: StructuralNode;
  mode: Project["mode"];
  plane: PlaneKind;
  sx: (u: number) => number;
  sy: (v: number) => number;
}) {
  const [u, v, normal] = planeCoordinates[plane];
  const x0 = sx(a[u]),
    y0 = sy(a[v]),
    x1 = sx(b[u]),
    y1 = sy(b[v]);
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2;
  const span = Math.hypot(x1 - x0, y1 - y0);
  const size = Math.max(25, Math.min(43, span * 0.3));
  const offset = x1 >= x0 ? -12 : 12;
  const towardViewer = plane === "XZ" ? -1 : 1;
  return (
    <g
      className="member-axes"
      role="img"
      aria-label={`Eixos locais de ${member.name}: i ${a.name}, j ${b.name}`}
    >
      <text x={x0 + offset} y={y0 - 8}>
        i
      </text>
      <text x={x1 + offset} y={y1 - 8}>
        j
      </text>
      {beamAxes(a, b, member.roll, mode).map((axis, i) => {
        const name = coordinates[i];
        const dx = size * axis[u],
          dy = -size * axis[v];
        const projected = Math.hypot(dx, dy);
        if (projected < 7) {
          return (
            <text
              key={name}
              className={`member-axis-${name}`}
              x={cx - 15}
              y={cy + 13}
            >
              {axis[normal] * towardViewer > 0 ? "⊙" : "⊗"} {name}
            </text>
          );
        }
        const ex = cx + dx,
          ey = cy + dy;
        const hx = (5 * dx) / projected,
          hy = (5 * dy) / projected;
        const arrow = `M${cx} ${cy}L${ex} ${ey}m${-hx + hy / 2} ${-hy - hx / 2}L${ex} ${ey}l${-hx - hy / 2} ${-hy + hx / 2}`;
        return (
          <g key={name} className={`member-axis-${name}`}>
            <path className="member-axis-halo" d={arrow} />
            <path d={arrow} />
            <text x={ex + 1.6 * hx} y={ey + 1.6 * hy}>
              {name}
            </text>
          </g>
        );
      })}
    </g>
  );
}
