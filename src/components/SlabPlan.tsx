import { memo, useMemo } from "react";
import type { MouseEvent } from "react";
import type { Slab, SlabEdge } from "../domain/model";
import { meshSlab } from "../domain/slab";
import { slabMapColor, type SlabMap } from "./SlabResults";
import { formatResult } from "./resultFormatting";

export default memo(function SlabPlan({
  slab,
  z,
  sx,
  sy,
  active,
  labels,
  map,
  pressure,
  onClick,
}: {
  slab: Slab;
  z: number;
  sx: (x: number) => number;
  sy: (y: number) => number;
  active: boolean;
  labels: boolean;
  map: SlabMap | null;
  pressure: number;
  onClick: (event: MouseEvent<SVGGElement>) => void;
}) {
  const resultMesh = map?.result.mesh;
  const mesh = useMemo(
    () => resultMesh ?? meshSlab(slab, z),
    [slab, z, resultMesh],
  );
  const pos = (id: number) => {
    const { x, y } = mesh.nodes[id - 1];
    return `${sx(x)},${sy(y)}`;
  };
  const polygons = mesh.elements.map((element) =>
    element.nodes.map(pos).join(" "),
  );
  const left = sx(slab.x),
    right = sx(slab.x + slab.lengthX);
  const bottom = sy(slab.y),
    top = sy(slab.y + slab.lengthY);
  return (
    <g className="slab-plan" aria-label={`Laje ${slab.name}`} onClick={onClick}>
      <rect
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
        fill={active ? "var(--selected-bg)" : "var(--surface-raised)"}
      />
      {map ? (
        <g
          className="slab-map"
          aria-label={`Mapa de ${map.definition.label} da laje ${slab.name}`}
        >
          {polygons.map((points, i) => (
            <polygon
              key={mesh.elements[i].number}
              points={points}
              fill={slabMapColor(map.values[i], map.scale)}
            >
              <title>
                Elemento {mesh.elements[i].number} ·{" "}
                {formatResult(map.values[i] * map.definition.factor)}{" "}
                {map.definition.unit}
              </title>
            </polygon>
          ))}
        </g>
      ) : (
        <path
          className="slab-mesh"
          d={polygons.map((points) => `M${points}Z`).join(" ")}
        />
      )}
      {(Object.entries(mesh.edges) as [SlabEdge, number[]][]).map(
        ([edge, ids]) => (
          <polyline
            key={edge}
            points={`${pos(ids[0])} ${pos(ids.at(-1)!)}`}
            className={
              slab.supports[edge] ? "slab-supported-edge" : "slab-free-edge"
            }
          />
        ),
      )}
      {active && (
        <rect
          className="slab-selected-outline"
          x={left - 4}
          y={top - 4}
          width={right - left + 8}
          height={bottom - top + 8}
        />
      )}
      {labels && !map && (
        <text
          x={(left + right) / 2}
          y={bottom - 8}
          textAnchor="middle"
          className="node-label"
        >
          {slab.name}
          {pressure !== 0 && ` · pZ ${formatResult(pressure / 1000)} kN/m²`}
        </text>
      )}
    </g>
  );
});
