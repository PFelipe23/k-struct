import {
  add,
  cross,
  interpolate,
  scale,
  subtract,
  tolerance,
} from "./geometry";
import { nodalLoad, type Project, type StructuralNode } from "./model";

type Pattern = Project["loadPatterns"][number];
export type WindStrip = NonNullable<Pattern["wind"]>[number];

// Uniform pressure on a vertical tributary rectangle centered on the receiving column.
export function distributeWind(
  nodes: ReadonlyMap<string, StructuralNode>,
  mode: Project["mode"],
  strip: WindStrip,
) {
  const base = nodes.get(strip.bottomId);
  const top = nodes.get(strip.topId);
  if (
    !base ||
    !top ||
    top.z - base.z < tolerance ||
    Math.hypot(top.x - base.x, top.y - base.y) > tolerance
  )
    throw new Error(
      "Escolha dois nós da mesma vertical, com o superior acima da base.",
    );
  if (
    !(strip.width > 0) ||
    !(strip.from >= 0 && strip.from < strip.to && strip.to <= 1)
  )
    throw new Error(
      "Informe largura positiva e uma faixa crescente entre 0 e 100% da altura.",
    );
  if (
    !(strip.pressure >= 0) ||
    !Number.isFinite(strip.coefficient) ||
    !(Math.abs(strip.angle) <= 360)
  )
    throw new Error(
      "Confira a pressão de referência, o coeficiente e a direção.",
    );
  if (mode === "planar" && strip.angle % 180 !== 0)
    throw new Error("No plano XZ o vento deve seguir +X ou −X.");
  const radians = (strip.angle * Math.PI) / 180;
  const direction = {
    x: Math.abs(strip.angle % 180) === 90 ? 0 : Math.cos(radians),
    y: strip.angle % 180 === 0 ? 0 : Math.sin(radians),
    z: 0,
  };
  const area = strip.width * (top.z - base.z) * (strip.to - strip.from);
  const total = strip.pressure * strip.coefficient * area;
  const fraction = (strip.from + strip.to) / 2;
  const center = interpolate(base, top, fraction);
  const halfWidth = scale(
    { x: -direction.y, y: direction.x, z: 0 },
    strip.width / 2,
  );
  const lower = interpolate(base, top, strip.from);
  const upper = interpolate(base, top, strip.to);
  const corners = [
    add(lower, halfWidth),
    add(upper, halfWidth),
    add(upper, scale(halfWidth, -1)),
    add(lower, scale(halfWidth, -1)),
  ];
  if (
    !(area > 0) ||
    ![area, total, ...corners.flatMap((p) => [p.x, p.y, p.z])].every(
      Number.isFinite,
    )
  )
    throw new Error("Área ou resultante fora do intervalo numérico.");
  const force = scale(direction, total);
  // Linear nodal weights put the resultant through the centroid of the strip.
  const loads = [base, top].map((node, i) => ({
    ...nodalLoad(node.id),
    fx: force.x * (i ? fraction : 1 - fraction),
    fy: force.y * (i ? fraction : 1 - fraction),
  }));
  const momentAtBase = cross(subtract(center, base), force);
  if (!Object.values(momentAtBase).every(Number.isFinite))
    throw new Error("Momento da faixa fora do intervalo numérico.");
  return {
    id: strip.id,
    name: strip.name,
    area,
    center,
    force,
    momentAtBase,
    corners,
    loads,
  };
}

export function patternWind(
  nodes: ReadonlyMap<string, StructuralNode>,
  mode: Project["mode"],
  pattern: Pattern,
) {
  return (pattern.wind ?? []).map((strip) =>
    distributeWind(nodes, mode, strip),
  );
}
