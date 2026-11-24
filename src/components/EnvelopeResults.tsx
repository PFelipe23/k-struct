import { useState } from "react";
import { FileDown } from "lucide-react";
import type { Project, ResultEnvelope } from "../domain/model";
import type { MemberForceComponent } from "../solver/combinations";
import { exportFile } from "../solver/desktop";
import { DEFAULT_UNITS, fromSI, type UnitPreferences } from "../units";
import { useUnits } from "./Units";
import type {
  EnvelopeSection,
  MemberEnvelopeResult,
} from "../solver/envelopes";
import {
  encodeCsv,
  forceColumns,
  forceQuantity,
  getForceLabel,
  formatResult,
  formatResultQuantity,
} from "./resultFormatting";

const bounds = [
  ["min", "Mínimo"],
  ["max", "Máximo"],
] as const;

export function buildEnvelopeCsv(
  project: Project,
  envelope: ResultEnvelope,
  result: MemberEnvelopeResult,
  component: MemberForceComponent,
  units: UnitPreferences = DEFAULT_UNITS,
) {
  const columns = forceColumns[project.mode];
  const included = JSON.stringify(envelope.combinationIds);
  const combinations = new Map(
    project.resultCombinations.map((item) => [item.id, item]),
  );
  const rows = project.members.flatMap((member) =>
    result[member.id].flatMap((station) =>
      bounds.map(([bound, label]) => {
        const { combinationId, forces } = station.ranges[component][bound];
        const combination = combinations.get(combinationId)!;
        return [
          envelope.name,
          envelope.id,
          included,
          member.name,
          member.id,
          station.t,
          getForceLabel(component, units).symbol,
          label,
          combination.name,
          combinationId,
          ...columns.map((key) =>
            fromSI(forces[key], forceQuantity(key), units),
          ),
          JSON.stringify(combination.factors),
        ];
      }),
    ),
  );
  return encodeCsv([
    [
      "Envelope",
      "ID do envelope",
      "IDs das combinações no envelope",
      "Barra",
      "ID da barra",
      "x/L",
      "Componente governante",
      "Extremo",
      "Combinação governante",
      "ID da combinação",
      ...columns.map((key) => {
        const { symbol, unit } = getForceLabel(key, units);
        return `${symbol} (${unit})`;
      }),
      "Parcelas (ID do caso e fator)",
    ],
    ...rows,
  ]);
}

export default function EnvelopeResults({
  project,
  envelope,
  result,
  component,
  section,
  problem,
  onSection,
}: {
  project: Project;
  envelope: ResultEnvelope;
  result: MemberEnvelopeResult | null;
  component: MemberForceComponent;
  section: EnvelopeSection | null;
  problem: string;
  onSection: (section: EnvelopeSection) => void;
}) {
  const { units } = useUnits();
  const [exportError, setExportError] = useState("");
  const columns: readonly MemberForceComponent[] = forceColumns[project.mode];
  const headers = columns.map((key) => {
    const { symbol, unit } = getForceLabel(key, units);
    return `${symbol} (${unit})`;
  });
  const combinations = new Map(
    project.resultCombinations.map((item) => [item.id, item]),
  );
  const stations = section ? result?.[section.memberId] : undefined;
  const range = section && stations?.[section.index]?.ranges[component];
  const exportCsv = () => {
    if (!result) return;
    setExportError("");
    void exportFile(
      `kstruct-envelope-${envelope.id}-${component}.csv`,
      buildEnvelopeCsv(project, envelope, result, component, units),
      "text/csv",
    ).catch((error) => setExportError(String(error)));
  };

  return (
    <section
      className="results envelope-results"
      aria-label="Resultados do envelope"
    >
      <div className="results-heading">
        <span className="envelope-title" title={envelope.name}>
          {envelope.name} · {getForceLabel(component, units).symbol}
        </span>
        {section && stations && (
          <div className="result-actions">
            <label>
              Barra
              <select
                aria-label="Barra do envelope"
                value={section.memberId}
                onChange={(event) =>
                  onSection({ memberId: event.target.value, index: 0 })
                }
              >
                {project.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estação x/L
              <select
                aria-label="Estação x/L"
                value={section.index}
                onChange={(event) =>
                  onSection({ ...section, index: Number(event.target.value) })
                }
              >
                {stations.map(({ t }, index) => (
                  <option key={index} value={index}>
                    {formatResult(t)}
                  </option>
                ))}
              </select>
            </label>
            <button
              title="Exportar o esforço selecionado em todas as barras"
              onClick={exportCsv}
            >
              <FileDown size={13} /> CSV
            </button>
          </div>
        )}
      </div>
      <div className="results-body">
        {exportError && (
          <p className="help" role="alert">
            {exportError}
          </p>
        )}
        {range ? (
          <table aria-label="Esforços simultâneos do envelope">
            <thead>
              <tr>
                <th scope="col">Extremo</th>
                <th scope="col">Combinação governante</th>
                {columns.map((key, index) => (
                  <th
                    key={key}
                    scope="col"
                    className={
                      key === component ? "governing-force" : undefined
                    }
                  >
                    {headers[index]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bounds.map(([bound, label]) => {
                const { combinationId, forces } = range[bound];
                return (
                  <tr key={bound}>
                    <th scope="row" className={`envelope-${bound}-label`}>
                      {label}
                    </th>
                    <td>{combinations.get(combinationId)!.name}</td>
                    {columns.map((key) => (
                      <td
                        key={key}
                        className={
                          key === component ? "governing-force" : undefined
                        }
                      >
                        {formatResultQuantity(
                          forces[key],
                          forceQuantity(key),
                          units,
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="message-log">
            <pre role="status">{problem}</pre>
          </div>
        )}
      </div>
    </section>
  );
}
