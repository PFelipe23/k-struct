import type { Coordinate } from "../domain/geometry";
import type { StructuralNode } from "../domain/model";
import { restrainedDofs, supportBasis } from "../domain/supports";

export default function InclinedSupport2D({
  node,
  x,
  y,
  u,
  v,
  showLabel,
}: {
  node: StructuralNode;
  x: number;
  y: number;
  u: Coordinate;
  v: Coordinate;
  showLabel: boolean;
}) {
  const basis = supportBasis(node.supportFrame);
  const blocked = restrainedDofs(node.restraints);
  const projected = (["z", "x", "y"] as const)
    .filter((key) => node.restraints[`u${key}`])
    .map((key) => ({ dx: basis[key][u], dy: -basis[key][v] }))
    .map(({ dx, dy }) => ({ dx, dy, norm: Math.hypot(dx, dy) }))
    .sort((a, b) => b.norm - a.norm);
  const primary = projected[0];
  const inPlane = primary && primary.norm > 1e-6;
  const angle = inPlane
    ? (Math.atan2(primary.dx, -primary.dy) * 180) / Math.PI
    : 0;
  const roller = blocked.length === 1 && projected.length === 1;
  const description = blocked.map((key) => key.toUpperCase()).join(", ");
  const fixed =
    blocked.length === (node.supportFrame?.kind === "planar" ? 3 : 6);
  return (
    <g
      className="inclined-support"
      role="img"
      aria-label={`${node.name}: apoio local, ${description}`}
      transform={`translate(${x} ${y})`}
    >
      {inPlane ? (
        <g transform={`rotate(${angle})`}>
          {fixed ? (
            <path d="M-11 7h22m-20 0l-4 6m12-6l-4 6m12-6l-4 6" fill="none" />
          ) : (
            <path d="M0 4l-9 14h18z" />
          )}
          {roller && <path d="M-11 22h22" fill="none" />}
        </g>
      ) : (
        <g transform="translate(-10 11)">
          <circle r="5" />
          <path
            d={
              projected.length ? "M-2 -2l4 4m-4 0l4 -4" : "M-2 2a3 3 0 1 1 4 0"
            }
            fill="none"
          />
        </g>
      )}
      {showLabel && (
        <text x="12" y="31">
          {description} local
        </text>
      )}
    </g>
  );
}
