import { useState } from "react";
import { FileDown } from "lucide-react";
import { coordinates } from "../domain/geometry";
import { supportBasis } from "../domain/supports";
import type { Project, ResultEnvelope, StructuralNode } from "../domain/model";
import { exportFile } from "../solver/desktop";
import type { NodeEnvelope, NodalFrame } from "../solver/envelopes";
import type { NodalComponent } from "../solver/nodalResults";
import { fromSI, unitLabel, type UnitPreferences } from "../units";
import {
  encodeCsv,
  formatResult,
  resultFractionDigits,
} from "./resultFormatting";
import { useUnits } from "./Units";

type NodalQuery = "reactions" | "displacements";
const bounds = [
  ["min", "Mínimo"],
  ["max", "Máximo"],
] as const;
const symbol = (key: NodalComponent) => key[0].toUpperCase() + key[1];
function quantity(key: NodalComponent) {
  switch (key[0]) {
    case "f":
      return "force";
    case "m":
      return "moment";
    case "u":
      return "displacement";
    default:
      return "rotation";
  }
}

function columnLabel(key: NodalComponent, units: UnitPreferences) {
  const q = quantity(key);
  return `${symbol(key)} (${q === "rotation" ? "mrad" : unitLabel(q, units)})`;
}

function displayValue(
  value: number,
  key: NodalComponent,
  units: UnitPreferences,
) {
  const q = quantity(key);
  return q === "rotation" ? value * 1000 : fromSI(value, q, units);
}

function selectedRows<K extends NodalComponent>(
  nodes: StructuralNode[],
  results: ReadonlyMap<string, NodeEnvelope<K>>,
  selectedId: string,
  component: K,
  frame: NodalFrame,
) {
  return nodes
    .filter((node) => !selectedId || node.id === selectedId)
    .flatMap((node) => {
      const record = results.get(node.id)!;
      const range = (record[frame] ?? record.global)[component];
      return bounds.map(([bound, label]) => ({
        node,
        label,
        bound,
        ...range[bound],
      }));
    });
}

const frameLabel = (frame: NodalFrame) =>
  frame === "local" ? "Local do apoio" : "Global";

function buildNodalEnvelopeCsv<K extends NodalComponent>(
  envelope: ResultEnvelope,
  kind: NodalQuery,
  component: K,
  columns: readonly K[],
  rows: ReturnType<typeof selectedRows<K>>,
  units: UnitPreferences,
) {
  return encodeCsv([
    [
      "Envelope",
      "ID do envelope",
      "Resultado",
      "Nó",
      "ID do nó",
      ...coordinates.map(
        (axis) => `${axis.toUpperCase()} global (${units.length})`,
      ),
      "Componente governante",
      "Extremo",
      "Referencial",
      "Eixos do referencial em coordenadas globais",
      "Tipo da origem",
      "Combinação governante",
      "ID da combinação",
      "Parcelas (ID, nome do caso e fator)",
      ...columns.map((k) => columnLabel(k, units)),
    ],
    ...rows.map(({ node, label, frame, source, vector }) => [
      envelope.name,
      envelope.id,
      kind === "reactions"
        ? "Reação do apoio sobre a estrutura"
        : "Deslocamento nodal",
      node.name,
      node.id,
      ...coordinates.map((axis) => fromSI(node[axis], "length", units)),
      symbol(component),
      label,
      frameLabel(frame),
      JSON.stringify(
        supportBasis(frame === "local" ? node.supportFrame : undefined),
      ),
      "Combinação linear",
      source.name,
      source.id,
      JSON.stringify(source.factors),
      ...columns.map((key) => displayValue(vector[key], key, units)),
    ]),
  ]);
}

export function NodalEnvelopeResults<K extends NodalComponent>({
  project,
  envelope,
  kind,
  results,
  columns,
}: {
  project: Project;
  envelope: ResultEnvelope;
  kind: NodalQuery;
  results: ReadonlyMap<string, NodeEnvelope<K>>;
  columns: readonly K[];
}) {
  const { units } = useUnits();
  const nodes = project.nodes.filter(({ id }) => results.has(id));
  const [selectedId, setSelectedId] = useState(nodes[0]?.id ?? "");
  const [component, setComponent] = useState<K>(columns[0]);
  const [frame, setFrame] = useState<NodalFrame>("global");
  const [error, setError] = useState("");
  const reactions = kind === "reactions";
  const rows = selectedRows(nodes, results, selectedId, component, frame);
  const local = nodes.some(
    (node) => (!selectedId || node.id === selectedId) && !!node.supportFrame,
  );
  const exportCsv = async () => {
    setError("");
    try {
      await exportFile(
        `kstruct-envelope-${envelope.id}-${kind}-${selectedId || "todos"}-${component}.csv`,
        buildNodalEnvelopeCsv(envelope, kind, component, columns, rows, units),
        "text/csv",
      );
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <>
      <div className="result-actions envelope-toolbar">
        <label>
          {reactions ? "Apoio" : "Nó"}
          <select
            aria-label={reactions ? "Apoio do envelope" : "Nó do envelope"}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name} [{node.id}]
              </option>
            ))}
            <option value="">
              {reactions ? "Todos os apoios" : "Todos os nós"}
            </option>
          </select>
        </label>
        <label>
          Componente
          <select
            aria-label="Componente nodal"
            value={component}
            onChange={(e) => setComponent(columns[e.target.selectedIndex])}
          >
            {columns.map((key) => (
              <option key={key} value={key}>
                {symbol(key)}
              </option>
            ))}
          </select>
        </label>
        {local && (
          <label>
            Referencial
            <select
              aria-label="Referencial do envelope"
              value={frame}
              onChange={(e) =>
                setFrame(e.target.value === "local" ? "local" : "global")
              }
            >
              <option value="global">Global</option>
              <option value="local">Local do apoio</option>
            </select>
          </label>
        )}
        <button
          onClick={exportCsv}
          disabled={!rows.length}
          title="Exportar os extremos e seus vetores simultâneos"
        >
          <FileDown size={13} /> CSV
        </button>
      </div>
      <div className="results-body">
        {error && <p role="alert">{error}</p>}
        {rows.length ? (
          <table
            aria-label={
              reactions
                ? "Reações simultâneas do envelope"
                : "Deslocamentos simultâneos do envelope"
            }
          >
            <caption>
              {reactions
                ? "Reação do apoio sobre a estrutura"
                : "Translações e rotações no nó físico"}{" "}
              · extremos de {symbol(component)}
            </caption>
            <thead>
              <tr>
                <th>{reactions ? "Apoio" : "Nó"}</th>
                <th>Extremo</th>
                <th>Referencial</th>
                <th>Combinação linear governante</th>
                {columns.map((key) => (
                  <th
                    key={key}
                    className={
                      key === component ? "governing-force" : undefined
                    }
                  >
                    {columnLabel(key, units)}
                  </th>
                ))}
                <th>Casos e fatores</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ node, label, bound, source, vector, frame }) => (
                <tr key={`${node.id}:${bound}`}>
                  <th scope="row">
                    {node.name} [{node.id}]
                  </th>
                  <td className={`envelope-${bound}-label`}>{label}</td>
                  <td>{frameLabel(frame)}</td>
                  <td>
                    {source.name} [{source.id}]
                  </td>
                  {columns.map((key) => (
                    <td
                      key={key}
                      className={
                        key === component ? "governing-force" : undefined
                      }
                    >
                      {formatResult(
                        displayValue(vector[key], key, units),
                        key[0] === "u"
                          ? resultFractionDigits("displacement", units)
                          : 5,
                      )}
                    </td>
                  ))}
                  <td>
                    {source.factors
                      .map(
                        ({ caseId, name, factor }) =>
                          `${String(factor).replace(".", ",")} × ${name} [${caseId}]`,
                      )
                      .join(" + ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p role="status">
            {reactions ? "Nenhum apoio no modelo." : "Nenhum nó no modelo."}
          </p>
        )}
      </div>
    </>
  );
}
