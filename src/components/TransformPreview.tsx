import GeometryPreview, { drawing } from "./GeometryPreview";
import {
  type PlaneKind,
  type Point3,
  distance,
  add,
  subtract,
  length,
  scale,
  cross,
  origin,
} from "../domain/geometry";
import type { Transform } from "../domain/transformGeometry";
import type { TransformPlan } from "../domain/transform";
import { formatResultQuantity } from "./resultFormatting";
import { useUnits } from "./Units";

function guide(spec: Transform, first: Point3, radius: number) {
  const unit = (v: Point3) => scale(v, 1 / length(v));
  if (spec.kind === "move" || spec.kind === "translate")
    return { label: "Vetor", points: [first, add(first, spec.offset)] };
  const at = (v: Point3) => add(spec.center, scale(v, radius));
  if (spec.kind === "rotate") {
    const u = unit(spec.axis);
    return {
      label: "Eixo de rotação",
      center: spec.center,
      points: [at(scale(u, -1)), at(u)],
    };
  }
  const n = unit(spec.normal);
  const u = unit(
    cross(n, Math.abs(n.z) < 0.9 ? { ...origin, z: 1 } : { ...origin, x: 1 }),
  );
  const v = cross(n, u);
  return {
    label: "Espelho",
    center: spec.center,
    points: [
      add(u, v),
      subtract(u, v),
      scale(add(u, v), -1),
      subtract(v, u),
      add(u, v),
    ].map(at),
  };
}

export default function TransformPreview({
  plan,
  plane,
  spec,
}: {
  plan: TransformPlan;
  plane: PlaneKind;
  spec: Transform;
}) {
  const { units } = useUnits();
  const source = drawing(
    plan.source,
    new Set(plan.maps.flatMap((m) => [...m.nodes.keys()])),
    new Set(plan.maps.flatMap((m) => [...m.members.keys()])),
  );
  const target = drawing(
    plan.project,
    new Set(plan.maps.flatMap((m) => [...m.nodes.values()])),
    new Set(plan.maps.flatMap((m) => [...m.members.values()])),
  );
  const first = source.nodes[0];
  const radius =
    Math.max(0.5, ...source.nodes.map((n) => distance(n, first))) / 2;
  const ref = guide(spec, first, radius);
  return (
    <GeometryPreview
      source={source}
      target={target}
      plane={plane}
      mode={plan.source.mode}
      guide={ref}
    >
      {plan.affected.length > 0 && (
        <details>
          <summary>Barras incidentes ({plan.affected.length})</summary>
          {plan.affected.map((id, i) => {
            const bar = plan.source.members.find((m) => m.id === id)!;
            const [a, b] = source.bars[i],
              [A, B] = target.bars[i];
            return (
              <div key={id}>
                {bar.name} ·{" "}
                {formatResultQuantity(distance(a, b), "length", units)} →{" "}
                {formatResultQuantity(distance(A, B), "length", units)}{" "}
                {units.length}
              </div>
            );
          })}
        </details>
      )}
    </GeometryPreview>
  );
}
