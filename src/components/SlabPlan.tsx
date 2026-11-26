import { memo, useMemo } from "react";
import type { MouseEvent } from "react";
import type { Slab } from "../domain/model";
import { slabRings, slabProperties, ringName } from "../domain/slabPolygon";
import { materialSample } from "../domain/polygonMesh";
import { meshSlab } from "../domain/slab";
import {
  getSlabQuantityDefinition,
  slabMapColor,
  type SlabMap,
} from "./SlabResults";
import { useUnits } from "./Units";
import { formatResult, formatResultQuantity } from "./resultFormatting";

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
  const { units } = useUnits();
  const definition = map
    ? getSlabQuantityDefinition(`slab-${map.definition.field}`, units)
    : null;
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
  const rings = slabRings(slab);
  const outline = rings
    .map(
      (ring) => "M" + ring.map((v) => `${sx(v.x)},${sy(v.y)}`).join(" ") + "Z",
    )
    .join(" ");
  const labelPoint = useMemo(() => {
    const { centroid } = slabProperties(slab);
    return slab.polygon ? materialSample(mesh, centroid).point : centroid;
  }, [mesh, slab]);
  return (
    <g className="slab-plan" aria-label={`Laje ${slab.name}`} onClick={onClick}>
      <path
        d={outline}
        fillRule="evenodd"
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
                {formatResultQuantity(
                  map.values[i],
                  definition!.quantity,
                  units,
                )}{" "}
                {definition!.unit}
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
      {rings.flatMap((ring, r) =>
        ring.map((v, i) => (
          <polyline
            key={v.edgeId}
            points={mesh.edges[v.edgeId].map(pos).join(" ")}
            className={v.supported ? "slab-supported-edge" : "slab-free-edge"}
          >
            <title>
              {ringName(r)} · borda {i + 1} ·{" "}
              {v.supported ? "apoio simples" : "livre"}
            </title>
          </polyline>
        )),
      )}
      {active && <path className="slab-selected-outline" d={outline} />}
      {slab.polygon &&
        active &&
        labels &&
        !map &&
        rings.flatMap((ring, r) =>
          ring.map((vertex, i) => (
            <text
              key={vertex.edgeId}
              className="node-label"
              x={sx(vertex.x) + 5}
              y={sy(vertex.y) - 5}
              pointerEvents="none"
            >
              {r > 0 ? `A${r} · ` : ""}V{i + 1}
            </text>
          )),
        )}
      {map && slab.polygon && (
        <circle
          cx={sx(map.result.samplePoint.x)}
          cy={sy(map.result.samplePoint.y)}
          r={3.5}
          fill="var(--geometry-selected)"
          stroke="var(--text)"
          pointerEvents="none"
        >
          <title>Ponto de consulta</title>
        </circle>
      )}
      {labels && !map && (
        <text
          x={sx(labelPoint.x)}
          y={sy(labelPoint.y)}
          pointerEvents="none"
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
