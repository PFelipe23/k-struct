import { useState } from "react";
import {
  planeCoordinates,
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
import type { Project } from "../domain/model";
import type { TransformPlan } from "../domain/transform";
import { formatResult } from "./resultFormatting";

type View = PlaneKind | "XYZ";
function drawing(p: Project, nodes: Set<string>, bars: Set<string>) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  return {
    nodes: [...nodes].map((id) => byId.get(id)!),
    bars: p.members
      .filter((m) => bars.has(m.id))
      .map((m) => [byId.get(m.start)!, byId.get(m.end)!] as const),
  };
}

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
  const [view, setView] = useState<View>(plane);
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
  const project = (n: Point3) =>
    view === "XYZ"
      ? [(Math.sqrt(3) / 2) * (n.x - n.y), n.z - (n.x + n.y) / 2]
      : planeCoordinates[view].slice(0, 2).map((k) => n[k]);
  const first = source.nodes[0];
  const radius =
    Math.max(0.5, ...source.nodes.map((n) => distance(n, first))) / 2;
  const ref = guide(spec, first, radius);
  const points = [
    ...source.nodes,
    ...target.nodes,
    ...source.bars.flat(),
    ...target.bars.flat(),
    ...ref.points,
  ].map(project);
  const u = points.map((p) => p[0]),
    v = points.map((p) => p[1]);
  const loU = Math.min(...u),
    hiU = Math.max(...u),
    loV = Math.min(...v),
    hiV = Math.max(...v);
  const zoom = Math.min(
    260 / Math.max(hiU - loU, 0.01),
    140 / Math.max(hiV - loV, 0.01),
  );
  function pixel(n: Point3) {
    const [x, y] = project(n);
    return {
      x: 150 + (x - (loU + hiU) / 2) * zoom,
      y: 85 - (y - (loV + hiV) / 2) * zoom,
    };
  }
  return (
    <div className="transform-preview">
      <label>
        Vista da prévia
        <select value={view} onChange={(e) => setView(e.target.value as View)}>
          {(plan.source.mode === "spatial"
            ? ["XY", "XZ", "YZ", "XYZ"]
            : ["XZ"]
          ).map((k) => (
            <option key={k} value={k}>
              {k === "XYZ" ? "Isométrica XYZ" : k}
            </option>
          ))}
        </select>
      </label>
      <svg
        viewBox="0 0 300 170"
        role="img"
        aria-label={`Prévia geométrica em ${view}`}
      >
        <g className="transform-guide">
          <polyline
            points={ref.points
              .map((p) => {
                const q = pixel(p);
                return `${q.x},${q.y}`;
              })
              .join(" ")}
          />
          {ref.center && (
            <circle cx={pixel(ref.center).x} cy={pixel(ref.center).y} r="4" />
          )}
        </g>
        {[source, target].map((layer, i) => (
          <g key={i} className={i ? "transform-target" : "transform-source"}>
            {layer.bars.map(([a, b], j) => {
              const A = pixel(a),
                B = pixel(b);
              return <line key={j} x1={A.x} y1={A.y} x2={B.x} y2={B.y} />;
            })}
            {layer.nodes.map((n) => {
              const pt = pixel(n);
              return (
                <circle key={n.id} cx={pt.x} cy={pt.y} r={i ? 2.8 : 3.8} />
              );
            })}
          </g>
        ))}
      </svg>
      <div className="transform-legend">
        <span>Original</span>
        <span>Resultado</span>
        <span>{ref.label}</span>
      </div>
      {plan.affected.length > 0 && (
        <details>
          <summary>Barras incidentes ({plan.affected.length})</summary>
          {plan.affected.map((id, i) => {
            const bar = plan.source.members.find((m) => m.id === id)!;
            const [a, b] = source.bars[i],
              [A, B] = target.bars[i];
            return (
              <div key={id}>
                {bar.name} · {formatResult(distance(a, b))} →{" "}
                {formatResult(distance(A, B))} m
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}
