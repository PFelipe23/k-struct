import {
  add,
  cross,
  dot,
  length,
  scale,
  subtract,
  type Point3,
} from "../domain/geometry";
import { globalBasis } from "../domain/surfacePanel";
import type { SectionCut } from "../domain/model";
import type { cutGeometry } from "../domain/sectionCut";

export function SectionCutPreview({
  cut,
  geometry,
}: {
  cut: SectionCut;
  geometry: ReturnType<typeof cutGeometry>;
}) {
  const { objects, frame } = geometry,
    vertices = objects.flatMap((o) => o.outlines.flat());
  if (!vertices.length) return null;
  const center = scale(
    vertices.reduce(add, { x: 0, y: 0, z: 0 }),
    1 / vertices.length,
  );
  const radius =
    Math.max(0.1, ...vertices.map((p) => length(subtract(p, center)))) * 0.85;
  const n = frame.outward,
    at = subtract(center, scale(n, dot(n, subtract(center, cut.point))));
  const ref = Math.abs(n.z) < 0.9 ? globalBasis[2] : globalBasis[1];
  const u = cross(n, ref),
    unit = scale(u, 1 / length(u)),
    v = cross(n, unit);
  const plane = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) =>
    add(at, add(scale(unit, x * radius), scale(v, y * radius))),
  );
  const arrow = add(at, scale(n, radius * 0.7));
  const proj = (p: Point3) => [p.x - 0.63 * p.y, -p.z + 0.3 * p.x + 0.38 * p.y];
  const coords = [...vertices, ...plane, cut.datum, arrow].map(proj);
  const xs = coords.map((q) => q[0]),
    ys = coords.map((q) => q[1]);
  const lo = Math.min(...xs),
    top = Math.min(...ys);
  const w = Math.max(...xs) - lo,
    h = Math.max(...ys) - top,
    zoom = Math.min(440 / Math.max(w, 0.01), 170 / Math.max(h, 0.01));
  const xy = (p: Point3) => {
    const [x, y] = proj(p);
    return [(x - lo - w / 2) * zoom + 240, (y - top - h / 2) * zoom + 100];
  };
  const pts = (ps: Point3[]) => ps.map((p) => xy(p).join(",")).join(" ");
  const [ox, oy] = xy(cut.datum);
  return (
    <svg
      className="cut-preview"
      viewBox="0 0 480 200"
      role="img"
      aria-label="Plano de corte, objetos atingidos, normal exterior e ponto O"
    >
      <defs>
        <marker
          id="cut-arrowhead"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="M0 0 L7 3.5 L0 7 Z" fill="currentColor" />
        </marker>
      </defs>
      <polygon points={pts(plane)} className="cut-plane" />
      {objects.map((o) => (
        <g
          key={o.kind + o.id}
          data-object={o.id}
          data-hit={!!(o.hits.length || o.traces.length || o.notice)}
        >
          <title>{o.name}</title>
          {o.outlines.map((line, i) => (
            <polyline
              key={i}
              points={pts(o.kind === "member" ? line : [...line, line[0]])}
            />
          ))}
          {o.traces.map((s, i) => (
            <polyline key={"s" + i} className="cut-trace" points={pts(s)} />
          ))}
          {o.hits.map((hit, i) => {
            const [cx, cy] = xy(hit.point);
            return <circle key={i + "p"} cx={cx} cy={cy} r="4" />;
          })}
        </g>
      ))}
      <polyline
        points={pts([at, arrow])}
        stroke="currentColor"
        fill="none"
        markerEnd="url(#cut-arrowhead)"
      />
      <circle cx={ox} cy={oy} r="3" fill="currentColor" />
      <text x={ox + 5} y={oy - 4}>
        O
      </text>
    </svg>
  );
}
