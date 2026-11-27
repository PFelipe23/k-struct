import type { Point3 } from "../domain/geometry";
import type { distributeLoadPanel } from "../domain/loadPanel";

type Distribution = ReturnType<typeof distributeLoadPanel>;
type Props = {
  name: string;
  data: Distribution;
  project: (p: Point3) => [number, number];
  labels: boolean;
};
export function LoadPanelFootprint({ name, data, project, labels }: Props) {
  return (
    <g
      role="img"
      aria-label={"Áreas de influência de " + name}
      className="load-panel-footprint"
    >
      {data.regions.map(({ side, points }) => {
        const xy = points.map(project);
        return (
          <g key={side} data-receiver={side}>
            <polygon points={xy.map((v) => v.join(",")).join(" ")} />
            {labels && (
              <text
                x={xy.reduce((v, p) => v + p[0], 0) / xy.length}
                y={xy.reduce((v, p) => v + p[1], 0) / xy.length}
              >
                {side}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
export function LoadPanelPreview({
  name,
  data,
}: {
  name: string;
  data: Distribution;
}) {
  const { width, height, u, v, corners } = data.rect;
  const zoom = Math.min(260 / width, 114 / height),
    cx = (300 - width * zoom) / 2,
    cy = (148 + height * zoom) / 2;
  const project = (p: Point3): [number, number] => {
    const x = p.x - corners[0].x,
      y = p.y - corners[0].y;
    return [cx + (u.x * x + u.y * y) * zoom, cy - (v.x * x + v.y * y) * zoom];
  };
  return (
    <svg className="load-panel-preview" viewBox="0 0 300 148">
      <LoadPanelFootprint name={name} data={data} project={project} labels />
      {corners.map((c, i) => {
        const [x, y] = project(c);
        return (
          <text key={i} x={x} y={y + (i < 2 ? 13 : -5)} textAnchor="middle">
            {"ABCD"[i]}
          </text>
        );
      })}
    </svg>
  );
}
