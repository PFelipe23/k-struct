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
import { formatResultQuantity } from "./resultFormatting";

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
  caseName,
  result,
  rawOutput,
  message,
  running,
  openRunHistory,
  onExportError,
}: {
  slab: Slab;
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
            <p className="slab-equilibrium">
              Carga em Z{" "}
              {formatResultQuantity(result.totalLoadZ, "force", units)}{" "}
              {unitLabel("force", units)} · Soma das reações em Z{" "}
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
