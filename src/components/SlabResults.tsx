import { CheckCircle2, History, Terminal } from "lucide-react";
import type { Slab } from "../domain/model";
import { exportFile } from "../solver/desktop";
import type { SlabResult, SlabSample } from "../solver/slab";
import { formatResult } from "./resultFormatting";

export const slabDisplays = {
  "slab-uz": {
    label: "Flecha UZ",
    field: "uz",
    unit: "mm",
    factor: 1000,
    sign: "UZ negativo para baixo",
  },
  "slab-mx": {
    label: "Momento local Mx",
    field: "mx",
    unit: "kN·m/m",
    factor: 0.001,
    sign: "Mx positivo traciona a face inferior na direção X",
  },
  "slab-my": {
    label: "Momento local My",
    field: "my",
    unit: "kN·m/m",
    factor: 0.001,
    sign: "My positivo traciona a face inferior na direção Y",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    field: keyof SlabSample;
    unit: string;
    factor: number;
    sign: string;
  }
>;
export type SlabDisplay = keyof typeof slabDisplays;
export const isSlabDisplay = (value: string): value is SlabDisplay =>
  Object.hasOwn(slabDisplays, value);

export function buildSlabMap(result: SlabResult, display: SlabDisplay) {
  const definition = slabDisplays[display];
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
  const { definition, scale } = map;
  const limit = scale * definition.factor;
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
        {formatResult(limit ? -limit : 0)}
        <i
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(to right, var(--slab-negative), var(--slab-zero), var(--slab-positive))",
          }}
        />
        {formatResult(limit)} {definition.unit}
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
            <table aria-label="Flecha e momentos no centro da laje">
              <thead>
                <tr>
                  <th>Local</th>
                  <th>UZ (mm)</th>
                  <th>Mx (kN·m/m)</th>
                  <th>My (kN·m/m)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Centro do painel</td>
                  <td>{formatResult(result.center.uz * 1000)}</td>
                  <td>{formatResult(result.center.mx / 1000)}</td>
                  <td>{formatResult(result.center.my / 1000)}</td>
                </tr>
              </tbody>
            </table>
            <p className="slab-equilibrium">
              Carga em Z {formatResult(result.totalLoadZ / 1000)} kN · Soma das
              reações em Z {formatResult(result.totalReactionZ / 1000)} kN
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
