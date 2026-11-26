import type { Project } from "../domain/model";
import {
  jointPanels,
  jointNames,
  sharedEdges,
  sameEdge,
} from "../domain/slabJoint";
import { useUnits } from "./Units";
import { formatQuantity, unitLabel } from "../units";
export function SlabJointPlan({
  project,
  sx,
  sy,
  select,
}: {
  project: Project;
  sx: (n: number) => number;
  sy: (n: number) => number;
  select?: () => void;
}) {
  const { units } = useUnits(),
    edge = sharedEdges(project)[0],
    j = project.slabJoint;
  if (!edge || !j || !sameEdge(j, edge)) return null;
  const x1 = sx(edge.start.x),
    y1 = sy(edge.start.y),
    x2 = sx(edge.end.x),
    y2 = sy(edge.end.y);
  const size = Math.hypot(x2 - x1, y2 - y1),
    nx = (y1 - y2) / size,
    ny = (x2 - x1) / size;
  const support =
    j.support === "beam"
      ? "viga " + project.members.find((b) => b.id === j.memberId)?.name
      : j.support === "line"
        ? "apoio vertical"
        : "sem apoio externo";
  const label = `Borda ${jointPanels(project)
    .map((s) => s.name)
    .join(" ↔ ")} · ${jointNames[j.kind]} · ${support}`;
  return (
    <g
      className="slab-joint-plan"
      data-kind={j.kind}
      role={select ? "button" : undefined}
      aria-label={label}
      tabIndex={select ? 0 : undefined}
      pointerEvents={select ? "auto" : "none"}
      onClick={(e) => {
        if (select) {
          e.stopPropagation();
          select();
        }
      }}
      onKeyDown={(e) => {
        if (select && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          e.stopPropagation();
          select();
        }
      }}
    >
      <title>
        {label}
        {j.stiffness
          ? ` · ${formatQuantity(j.stiffness, "moment", units)} ${unitLabel("moment", units)}/(rad·m)`
          : ""}
      </title>
      <line className="joint-hit" {...{ x1, y1, x2, y2 }} />
      <line className="joint-line" {...{ x1, y1, x2, y2 }} />
      {j.kind === "continuous" && (
        <line
          className="joint-line"
          x1={x1 + 3 * nx}
          y1={y1 + 3 * ny}
          x2={x2 + 3 * nx}
          y2={y2 + 3 * ny}
        />
      )}
      {[0.25, 0.5, 0.75].map((s) => {
        const x = x1 + s * (x2 - x1),
          y = y1 + s * (y2 - y1);
        return j.kind === "hinged" ? (
          <circle key={s} cx={x} cy={y} r={3} />
        ) : j.kind === "elastic" ? (
          <path
            key={s}
            d={`M${x - 4 * nx},${y - 4 * ny}l${2 * nx + 2 * ny},${2 * ny - 2 * nx}l${4 * nx - 4 * ny},${4 * ny + 4 * nx}l${2 * nx + 2 * ny},${2 * ny - 2 * nx}`}
          />
        ) : null;
      })}
    </g>
  );
}
