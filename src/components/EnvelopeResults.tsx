import { useState } from "react";
import { FileDown } from "lucide-react";
import type { Project, ResultEnvelope } from "../domain/model";
import type { MemberForceComponent } from "../solver/combinations";
import { exportFile } from "../solver/desktop";
import { DEFAULT_UNITS, fromSI, type UnitPreferences } from "../units";
import { useUnits } from "./Units";
import {
  SectionConsultation,
  type SectionControls,
} from "./SectionConsultation";
import { NodalEnvelopeResults } from "./NodalEnvelopeResults";
import { displacementColumns, reactionColumns } from "../solver/nodalResults";
import type { EnvelopeResult, MemberEnvelopeResult } from "../solver/envelopes";
import {
  encodeCsv,
  forceColumns,
  forceQuantity,
  getForceLabel,
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
  controls: SectionControls | null;
};
export type EnvelopeView = "members" | "reactions" | "displacements";

function MemberEnvelopeResults({
  project,
  envelope,
  result,
  component,
  controls,
}: MemberQuery & { result: MemberEnvelopeResult }) {
  const { units } = useUnits();
  const [error, setError] = useState("");
  if (!controls) return null;
  const exportCsv = () => {
    setError("");
    void exportFile(
      `kstruct-envelope-${envelope.id}-${component}.csv`,
      buildEnvelopeCsv(project, envelope, result, component, units),
      "text/csv",
    ).catch((cause) => setError(String(cause)));
  };
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <SectionConsultation
        project={project}
        controls={controls}
        isEnvelope
        action={
          <button
            title="Exportar as estações amostradas em todas as barras"
            onClick={exportCsv}
          >
            <FileDown size={13} /> CSV
          </button>
        }
      />
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
