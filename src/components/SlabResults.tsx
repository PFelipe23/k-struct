import type { FloorResult } from "../solver/floor";
import { jointNames } from "../domain/slabJoint";
import SlabComparison from "./SlabComparison";
import { CheckCircle2, History, Terminal } from "lucide-react";
import type { Slab } from "../domain/model";
import { exportFile } from "../solver/desktop";
import type { SlabResult, SlabSample } from "../solver/slab";
import {
  DEFAULT_UNITS,
  fromSI,
  unitLabel,
  type UnitPreferences,
} from "../units";
import { useUnits } from "./Units";
import { formatResult, formatResultQuantity } from "./resultFormatting";

export const slabDisplays = {
  "slab-uz": {
    label: "Flecha UZ",
    field: "uz",
    quantity: "displacement",
    unit: unitLabel("displacement"),
    factor: fromSI(1, "displacement"),
    sign: "UZ negativo para baixo",
  },
  "slab-mx": {
    label: "Momento local Mx",
    field: "mx",
    quantity: "moment",
    unit: `${unitLabel("moment")}/m`,
    factor: fromSI(1, "moment"),
    sign: "Mx positivo traciona a face inferior na direção X",
  },
  "slab-my": {
    label: "Momento local My",
    field: "my",
    quantity: "moment",
    unit: `${unitLabel("moment")}/m`,
    factor: fromSI(1, "moment"),
    sign: "My positivo traciona a face inferior na direção Y",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    field: keyof SlabSample;
    quantity: "displacement" | "moment";
    unit: string;
    factor: number;
    sign: string;
  }
>;
export type SlabDisplay = keyof typeof slabDisplays;
export const isSlabDisplay = (value: string): value is SlabDisplay =>
  Object.hasOwn(slabDisplays, value);

export function getSlabQuantityDefinition(
  display: SlabDisplay,
  units: UnitPreferences = DEFAULT_UNITS,
) {
  const definition = slabDisplays[display];
  return {
    ...definition,
    unit:
      definition.quantity === "moment"
        ? `${unitLabel("moment", units)}/m`
        : unitLabel("displacement", units),
    factor: fromSI(1, definition.quantity, units),
  };
}

export function buildSlabMap(
  result: SlabResult,
  display: SlabDisplay,
  units: UnitPreferences = DEFAULT_UNITS,
) {
  const definition = getSlabQuantityDefinition(display, units);
  const values = result.elements.map((element) => element[definition.field]);
  const scale = Math.max(...values.map(Math.abs));
  return { result, definition, values, scale };
}
export type SlabMap = ReturnType<typeof buildSlabMap>;

export function slabMapColor(value: number, scale: number) {
  const percent = scale ? 100 * Math.min(1, Math.abs(value) / scale) : 0;
  const limit = value >= 0 ? "var(--slab-positive)" : "var(--slab-negative)";
  return `color-mix(in srgb, ${limit} ${percent}%, var(--slab-zero))`;
}

export function SlabLegend({
  map,
  name,
  caseName,
}: {
  map: SlabMap;
  name: string;
  caseName: string;
}) {
  const { units } = useUnits();
  const definition = getSlabQuantityDefinition(
    `slab-${map.definition.field}`,
    units,
  );
  const { scale } = map;
  return (
    <div
      className="diagram-caption slab-legend"
      aria-label="Legenda do mapa da laje"
    >
      <span>
        <b>
          {name} · {definition.label}
        </b>{" "}
        · {caseName}
      </span>
      <span className="slab-legend-scale">
        {formatResultQuantity(scale ? -scale : 0, definition.quantity, units)}
        <i
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(to right, var(--slab-negative), var(--slab-zero), var(--slab-positive))",
          }}
        />
        {formatResultQuantity(scale, definition.quantity, units)}{" "}
        {definition.unit}
      </span>
      <span>{definition.sign} · valores médios por elemento</span>
    </div>
  );
}

export default function SlabResults({
  slab,
  floor,
  panelNames,
  frameReactionZ = 0,
  comparisonKey,
  caseName,
  result,
  rawOutput,
  message,
  running,
  openRunHistory,
  onExportError,
}: {
  slab: Slab;
  floor?: FloorResult;
  panelNames?: string[];
  frameReactionZ?: number;
  comparisonKey: string;
  caseName: string;
  result: SlabResult | null;
  rawOutput?: string;
  message: string;
  running: boolean;
  openRunHistory?: () => void;
  onExportError: (message: string) => void;
}) {
  const { units } = useUnits();
  const displacement = getSlabQuantityDefinition("slab-uz", units);
  const moment = getSlabQuantityDefinition("slab-mx", units);
  return (
    <section className="results slab-results" aria-label="Resultados da laje">
      <div className="results-heading">
        <div className="result-tabs">
          <span>Laje {slab.name}</span>
        </div>
        <div className="result-actions">
          <SlabComparison key={comparisonKey} result={result} />
          <span className="result-case-name" title={caseName}>
            {caseName}
          </span>
          {result && (
            <span>
              <CheckCircle2 size={12} /> Equilíbrio verificado
            </span>
          )}
          {rawOutput && (
            <button
              aria-label="Exportar saída do OOFEM"
              title="Exportar saída do OOFEM"
              onClick={() =>
                void exportFile("analysis.out", rawOutput).catch((error) =>
                  onExportError(String(error)),
                )
              }
            >
              <Terminal size={13} />
            </button>
          )}
          {openRunHistory && (
            <button
              aria-label="Histórico da execução"
              title="Histórico da execução"
              onClick={openRunHistory}
            >
              <History size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="results-body">
        {result && (
          <>
            <table
              aria-label={
                slab.polygon
                  ? "Flecha e momentos no ponto de consulta"
                  : "Flecha e momentos no centro da laje"
              }
            >
              <thead>
                <tr>
                  <th>Local</th>
                  <th>UZ ({displacement.unit})</th>
                  <th>Mx ({moment.unit})</th>
                  <th>My ({moment.unit})</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {slab.polygon ? (
                      <>
                        {result.samplePoint.relocated
                          ? "Ponto material próximo ao centroide"
                          : "Centroide da área líquida"}{" "}
                        · X{" "}
                        {formatResultQuantity(
                          result.samplePoint.x,
                          "length",
                          units,
                        )}{" "}
                        · Y{" "}
                        {formatResultQuantity(
                          result.samplePoint.y,
                          "length",
                          units,
                        )}{" "}
                        {units.length}
                      </>
                    ) : (
                      "Centro do painel"
                    )}
                  </td>
                  <td>
                    {formatResultQuantity(
                      result.center.uz,
                      "displacement",
                      units,
                    )}
                  </td>
                  <td>
                    {formatResultQuantity(result.center.mx, "moment", units)}
                  </td>
                  <td>
                    {formatResultQuantity(result.center.my, "moment", units)}
                  </td>
                </tr>
              </tbody>
            </table>
            {floor && (
              <div
                className="floor-result"
                aria-label="Resultados da borda comum"
              >
                <b>
                  {panelNames?.join(" ↔ ")} · {jointNames[floor.joint.kind]}
                </b>
                <table aria-label="Transferência na borda comum">
                  <thead>
                    <tr>
                      <th>
                        Momento em {panelNames?.[0]} (
                        {unitLabel("moment", units)})
                      </th>
                      <th>
                        Momento em {panelNames?.[1]} (
                        {unitLabel("moment", units)})
                      </th>
                      <th>Rotação relativa máx. (mrad)</th>
                      {floor.joint.support === "beam" && (
                        <th>
                          Carga das lajes na viga em Z (
                          {unitLabel("force", units)})
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        {formatResultQuantity(floor.momentA, "moment", units)}
                      </td>
                      <td>
                        {formatResultQuantity(floor.momentB, "moment", units)}
                      </td>
                      <td>{formatResult(floor.deltaMax * 1000)}</td>
                      {floor.joint.support === "beam" && (
                        <td>
                          {formatResultQuantity(
                            floor.beamForce,
                            "force",
                            units,
                          )}
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
                <p>
                  Carga das lajes em Z{" "}
                  {formatResultQuantity(floor.totalLoadZ, "force", units)}{" "}
                  {unitLabel("force", units)} · Reações externas do modelo em Z{" "}
                  {formatResultQuantity(
                    floor.outerReactionZ + frameReactionZ,
                    "force",
                    units,
                  )}{" "}
                  {unitLabel("force", units)}
                </p>
                <details>
                  <summary>Estações da borda e convenção de sinal</summary>
                  <p>
                    {floor.stations.length} estações comuns ·{" "}
                    {floor.panels
                      .map(
                        (v, i) =>
                          `${panelNames?.[i]} com ${v.elements.length} elementos`,
                      )
                      .join(" · ")}
                  </p>
                  <p>
                    O momento positivo gira em torno da tangente (
                    {formatResult(floor.tangent.x)},{" "}
                    {formatResult(floor.tangent.y)}) em XY. A rotação relativa é
                    a da segunda laje menos a da primeira. Os momentos por metro
                    usam o comprimento tributário da estação.
                  </p>
                  <table aria-label="Estações da borda">
                    <thead>
                      <tr>
                        <th>X ({units.length})</th>
                        <th>Y ({units.length})</th>
                        <th>Δθ (mrad)</th>
                        <th>
                          m em {panelNames?.[0]} ({unitLabel("moment", units)}
                          /m)
                        </th>
                        <th>
                          m em {panelNames?.[1]} ({unitLabel("moment", units)}
                          /m)
                        </th>
                        {floor.joint.support === "beam" && (
                          <th>FZ na viga ({unitLabel("force", units)})</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {floor.stations.map((v, i) => (
                        <tr key={i}>
                          <td>
                            {formatResultQuantity(v.point.x, "length", units)}
                          </td>
                          <td>
                            {formatResultQuantity(v.point.y, "length", units)}
                          </td>
                          <td>{formatResult(v.delta * 1000)}</td>
                          <td>
                            {formatResultQuantity(
                              v.momentA / v.length,
                              "moment",
                              units,
                            )}
                          </td>
                          <td>
                            {formatResultQuantity(
                              v.momentB / v.length,
                              "moment",
                              units,
                            )}
                          </td>
                          {floor.joint.support === "beam" && (
                            <td>
                              {formatResultQuantity(
                                v.beamForce,
                                "force",
                                units,
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>
            )}
            <p className="slab-equilibrium">
              Carga em Z{" "}
              {formatResultQuantity(result.totalLoadZ, "force", units)}{" "}
              {unitLabel("force", units)} ·{" "}
              {floor
                ? "Reações do painel, incluindo a borda comum, em Z"
                : "Soma das reações em Z"}{" "}
              {formatResultQuantity(result.totalReactionZ, "force", units)}{" "}
              {unitLabel("force", units)}
              {slab.polygon && (
                <>
                  {" "}
                  · Posição da resultante em X{" "}
                  {formatResultQuantity(result.centroid.x, "length", units)} e Y{" "}
                  {formatResultQuantity(result.centroid.y, "length", units)}{" "}
                  {units.length}
                </>
              )}
            </p>
          </>
        )}
        <div className="message-log" role="status">
          <i className={running ? "working" : "log-dot"} />
          <pre>{message}</pre>
        </div>
      </div>
    </section>
  );
}
