import { useState } from "react";
import { FileDown } from "lucide-react";
import type { Project, ResultEnvelope } from "../domain/model";
import type { MemberForceComponent } from "../solver/combinations";
import { exportFile } from "../solver/desktop";
import { DEFAULT_UNITS, fromSI, type UnitPreferences } from "../units";
import { useUnits } from "./Units";
import { NodalEnvelopeResults } from "./NodalEnvelopeResults";
import { displacementColumns, reactionColumns } from "../solver/nodalResults";
import type {
  EnvelopeSection,
  EnvelopeResult,
  MemberEnvelopeResult,
} from "../solver/envelopes";
import {
  encodeCsv,
  forceColumns,
  forceQuantity,
  getForceLabel,
  formatResult,
  formatResultQuantity,
  reportsSectionSides,
  sectionSide,
  sectionPositions,
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
  const includeSide = reportsSectionSides(project);
  const positions = sectionPositions(project, project.members, units);
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
          ...(includeSide ? [sectionSide(station.side)] : []),
          ...positions.values(member.id, station.t),
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
      ...(includeSide ? ["Lado da seção"] : []),
      ...positions.headers,
    ],
    ...rows,
  ]);
}

type MemberQuery = {
  project: Project;
  envelope: ResultEnvelope;
  component: MemberForceComponent;
  section: EnvelopeSection | null;
  onSection: (section: EnvelopeSection) => void;
};
export type EnvelopeView = "members" | "reactions" | "displacements";

function MemberEnvelopeResults({
  project,
  envelope,
  component,
  section,
  result,
  onSection,
}: MemberQuery & { result: MemberEnvelopeResult }) {
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
  const stations = section ? result[section.memberId] : undefined;
  const station = section && stations?.[section.index];
  const range = station?.ranges[component];
  const positions = sectionPositions(
    project,
    project.members.filter((m) => m.id === section?.memberId),
    units,
  );
  const exportCsv = () => {
    setExportError("");
    void exportFile(
      `kstruct-envelope-${envelope.id}-${component}.csv`,
      buildEnvelopeCsv(project, envelope, result, component, units),
      "text/csv",
    ).catch((error) => setExportError(String(error)));
  };

  return (
    <>
      {section && stations && (
        <div className="result-actions envelope-toolbar">
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
              {stations.map(({ t, side }, index) => (
                <option key={index} value={index}>
                  {formatResult(t)}
                  {side && ` · ${sectionSide(side)}`}
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
      <div className="results-body">
        {exportError && (
          <p className="help" role="alert">
            {exportError}
          </p>
        )}
        {range ? (
          <table aria-label="Esforços simultâneos do envelope">
            {section && station && positions.headers.length > 0 && (
              <caption>
                Seção no trecho deformável ·{" "}
                {positions
                  .values(section.memberId, station.t)
                  .map(
                    (v, i) =>
                      `${positions.headers[i][0]} = ${formatResult(v)} ${units.length}`,
                  )
                  .join(" · ")}
              </caption>
            )}
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
            <pre role="status">
              Selecione uma barra e uma estação para consultar seus esforços.
            </pre>
          </div>
        )}
      </div>
    </>
  );
}

export default function EnvelopeResults({
  result,
  view,
  onView,
  problem,
  ...query
}: MemberQuery & {
  result: EnvelopeResult | null;
  view: EnvelopeView;
  onView: (view: EnvelopeView) => void;
  problem: string;
}) {
  const { project, envelope, component } = query;
  const { units } = useUnits();
  return (
    <section
      className="results envelope-results"
      aria-label="Resultados do envelope"
    >
      <div className="results-heading">
        <div
          className="result-tabs"
          role="group"
          aria-label="Consulta do envelope"
        >
          {(
            [
              ["members", "Esforços nas barras"],
              ["reactions", "Reações de apoio"],
              ["displacements", "Deslocamentos nodais"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={view === key}
              className={view === key ? "active" : undefined}
              onClick={() => onView(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="envelope-title" title={envelope.name}>
          {envelope.name}
          {view === "members" && ` · ${getForceLabel(component, units).symbol}`}
        </span>
      </div>
      {!result ? (
        <div className="results-body">
          <div className="message-log">
            <pre role="status">{problem}</pre>
          </div>
        </div>
      ) : view === "reactions" ? (
        <NodalEnvelopeResults
          key="reactions"
          project={project}
          envelope={envelope}
          kind="reactions"
          results={result.nodal.reactions}
          columns={reactionColumns[project.mode]}
        />
      ) : view === "displacements" ? (
        <NodalEnvelopeResults
          key="displacements"
          project={project}
          envelope={envelope}
          kind="displacements"
          results={result.nodal.displacements}
          columns={displacementColumns[project.mode]}
        />
      ) : (
        <MemberEnvelopeResults {...query} result={result.members} />
      )}
    </section>
  );
}
