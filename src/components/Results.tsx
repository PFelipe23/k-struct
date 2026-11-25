import { useState } from "react";
import { CheckCircle2, FileDown, History, Terminal } from "lucide-react";
import type { AnalysisCase, Project, ResultCombination } from "../domain/model";
import { supportBasis, supportToLocal } from "../domain/supports";
import type {
  AnalysisResult,
  Displacement,
  Reaction,
  StructuralResult,
} from "../solver/oofem";
import { exportFile } from "../solver/desktop";
import {
  DEFAULT_UNITS,
  fromSI,
  unitLabel,
  type UnitPreferences,
} from "../units";
import { useUnits } from "./Units";
import {
  encodeCsv,
  forceColumns,
  forceQuantity,
  getForceLabel,
  formatResult,
  resultFractionDigits,
  sectionSide,
} from "./resultFormatting";

type ResultView =
  | { kind: "case"; definition: AnalysisCase; result: AnalysisResult | null }
  | {
      kind: "combination";
      definition: ResultCombination;
      result: StructuralResult | null;
      problem: string;
    };

export function buildResultTable(
  project: Project,
  tab: string,
  result: StructuralResult | null,
  forceMemberId = "",
  units: UnitPreferences = DEFAULT_UNITS,
) {
  const spatial = project.mode === "spatial";
  const nodeNames = new Map(project.nodes.map((n) => [n.id, n.name]));
  const memberNames = new Map(project.members.map((m) => [m.id, m.name]));
  let rows: (string | number)[][] = [],
    headers: string[] = [];
  if (tab === "reactions") {
    const keys: (keyof Omit<Reaction, "nodeId">)[] = spatial
      ? ["fx", "fy", "fz", "mx", "my", "mz"]
      : ["fx", "fz", "my"];
    const nodes = new Map(project.nodes.map((node) => [node.id, node]));
    const hasLocal = (result?.reactions ?? []).some(
      ({ nodeId }) => nodes.get(nodeId)?.supportFrame,
    );
    const quantity = (key: (typeof keys)[number]) =>
      key.startsWith("f") ? "force" : "moment";
    const componentHeaders = (frame: "global" | "local") =>
      keys.map((key) => {
        const [kind, axis] = key.toUpperCase();
        return `${kind === "F" ? "R" : "M"}${axis} ${frame} (${unitLabel(quantity(key), units)})`;
      });
    headers = ["Nó", ...componentHeaders("global")];
    if (hasLocal)
      headers.push(...componentHeaders("local"), "Referencial do apoio");
    rows = (result?.reactions ?? []).map((r) => {
      const row: (string | number)[] = [
        nodeNames.get(r.nodeId) ?? r.nodeId,
        ...keys.map((key) => fromSI(r[key], quantity(key), units)),
      ];
      if (hasLocal) {
        const node = nodes.get(r.nodeId)!;
        const basis = supportBasis(node.supportFrame);
        const f = supportToLocal({ x: r.fx, y: r.fy, z: r.fz }, basis);
        const m = supportToLocal({ x: r.mx, y: r.my, z: r.mz }, basis);
        const local = { fx: f.x, fy: f.y, fz: f.z, mx: m.x, my: m.y, mz: m.z };
        row.push(
          ...keys.map((key) => {
            const axis = key[1] as "x" | "y" | "z";
            return node.restraints[`${key[0] === "f" ? "u" : "r"}${axis}`]
              ? fromSI(local[key], quantity(key), units)
              : 0;
          }),
          node.supportFrame ? "Local" : "Global",
        );
      }
      return row;
    });
  } else if (tab === "displacements") {
    const values = (d: Displacement) => [
      ...[d.ux, ...(spatial ? [d.uy] : []), d.uz].map((value) =>
        fromSI(value, "displacement", units),
      ),
      ...(spatial ? [d.rx, d.ry, d.rz] : [d.ry]).map((value) => value * 1000),
    ];
    const displacement = unitLabel("displacement", units);
    headers = [
      "Nó / estação",
      ...["UX", ...(spatial ? ["UY"] : []), "UZ"].map(
        (label) => `${label} (${displacement})`,
      ),
      ...(spatial ? ["RX", "RY", "RZ"] : ["RY"]).map(
        (label) => `${label} (mrad)`,
      ),
    ];
    rows = [
      ...Object.entries(result?.displacements ?? {}).map(([id, d]) => [
        nodeNames.get(id) ?? id,
        ...values(d),
      ]),
      ...Object.entries(result?.members ?? {}).flatMap(([id, stations]) =>
        stations
          .slice(1, -1)
          .filter((s) => s.side !== "right")
          .map((s) => [
            `${memberNames.get(id) ?? id} · x/L ${s.t}`,
            ...values(s),
          ]),
      ),
    ];
  } else if (tab === "forces") {
    const components = forceColumns[project.mode];
    headers = [
      "Barra",
      "x/L",
      ...components.map((key) => {
        const { symbol, unit } = getForceLabel(key, units);
        return `${symbol} (${unit})`;
      }),
      ...(project.meshConnections.length
        ? ["Lado da seção", "ID da barra"]
        : []),
    ];
    rows = Object.entries(result?.members ?? {})
      .filter(([id]) => !forceMemberId || id === forceMemberId)
      .flatMap(([id, stations]) =>
        stations.map((s) => [
          memberNames.get(id) ?? id,
          s.t,
          ...components.map((key) => fromSI(s[key], forceQuantity(key), units)),
          ...(project.meshConnections.length ? [sectionSide(s.side), id] : []),
        ]),
      );
  }
  return { headers, rows };
}

export function buildResultCsv(
  project: Project,
  view: ResultView,
  tab: string,
  forceMemberId = "",
  units: UnitPreferences = DEFAULT_UNITS,
) {
  const { headers, rows } = buildResultTable(
    project,
    tab,
    view.result,
    forceMemberId,
    units,
  );
  const { definition } = view;
  const combination = view.kind === "combination" ? view.definition : null;
  const sourceHeaders = combination
    ? ["Combinação", "ID da combinação", "Parcelas (ID do caso e fator)"]
    : ["Caso", "ID do caso"];
  const source = [definition.name, definition.id];
  if (combination) source.push(JSON.stringify(combination.factors));
  return encodeCsv([
    [...headers, ...sourceHeaders],
    ...rows.map((row) => [...row, ...source]),
  ]);
}

export default function Results({
  project,
  forceMemberId,
  onForceMemberChange,
  view,
  message,
  running,
  cancelling,
  openRunHistory,
}: {
  project: Project;
  forceMemberId: string;
  onForceMemberChange: (id: string) => void;
  view: ResultView;
  message: string;
  running: boolean;
  cancelling: boolean;
  openRunHistory?: () => void;
}) {
  const { units } = useUnits();
  const [tab, setTab] = useState("log");
  const [exportError, setExportError] = useState("");
  const { definition, result } = view;
  const caseOutput = view.kind === "case" ? view.result : null;
  const combination = view.kind === "combination" ? view.definition : null;
  const caseNames = new Map(
    project.analysisCases.map(({ id, name }) => [id, name]),
  );
  const formula = combination?.factors
    .map(({ caseId, factor }, i) => {
      const sign = factor < 0 ? "− " : i ? "+ " : "";
      return `${sign}${String(Math.abs(factor)).replace(".", ",")} × ${caseNames.get(caseId) ?? caseId}`;
    })
    .join(" ");
  const logMessage =
    view.kind === "combination"
      ? `${definition.name}\n${formula}\n${view.problem || "Combinação disponível para consulta."}`
      : message;
  const download = (name: string, content: string, type = "text/plain") => {
    setExportError("");
    void exportFile(name, content, type).catch((e) =>
      setExportError(String(e)),
    );
  };
  const { headers, rows } = buildResultTable(
    project,
    tab,
    result,
    forceMemberId,
    units,
  );
  return (
    <section className="results">
      <div className="results-heading">
        <div className="result-tabs">
          {[
            ["log", "Mensagens"],
            ["reactions", "Reações"],
            ["displacements", "Deslocamentos"],
            ["forces", "Esforços"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {key === "log" && <Terminal size={13} />} {label}
            </button>
          ))}
        </div>
        <div className="result-actions">
          {tab === "forces" && (
            <label>
              Barra
              <select
                aria-label="Barra em Esforços"
                value={forceMemberId}
                onChange={(event) => onForceMemberChange(event.target.value)}
              >
                <option value="">Todas as barras</option>
                {project.members.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {openRunHistory && tab === "log" && (
            <button onClick={openRunHistory}>
              <History size={13} />
              Registros do OOFEM
            </button>
          )}
          {result && (
            <>
              <span
                className="result-case-name"
                title={formula ?? definition.name}
              >
                {definition.name}
              </span>
              <span>
                <CheckCircle2 size={13} />{" "}
                {caseOutput?.solver ?? "Combinação linear"}
              </span>
              {caseOutput && (
                <button
                  title="Baixar saída original do OOFEM"
                  onClick={() =>
                    download(
                      `oofem-${caseOutput.caseId}.out`,
                      caseOutput.rawOutput,
                    )
                  }
                >
                  Saída OOFEM
                </button>
              )}
              {tab !== "log" && (
                <button
                  onClick={() => {
                    download(
                      `kstruct-${combination ? "combinacao-" : ""}${definition.id}-${tab}.csv`,
                      buildResultCsv(project, view, tab, forceMemberId, units),
                      "text/csv",
                    );
                  }}
                >
                  <FileDown size={13} />
                  CSV
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="results-body">
        {exportError && (
          <p className="help" role="alert">
            {exportError}
          </p>
        )}
        {tab === "log" ? (
          <div className="message-log">
            <span className={running ? "working" : "log-dot"} />
            <pre role="status">
              {cancelling
                ? "Cancelando execução do OOFEM…"
                : running
                  ? "OOFEM em execução…"
                  : logMessage}
            </pre>
          </div>
        ) : !result && view.kind === "combination" ? (
          <div className="no-results">{view.problem.replace("\n", " ")}</div>
        ) : !result ? (
          <div className="no-results">
            Execute uma análise para consultar{" "}
            {tab === "forces"
              ? "os esforços"
              : tab === "reactions"
                ? "as reações"
                : "os deslocamentos"}{" "}
            do caso <b>{definition.name}</b>.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j}>
                      {typeof v === "number"
                        ? formatResult(
                            v,
                            tab === "displacements" &&
                              j > 0 &&
                              j <= (project.mode === "spatial" ? 3 : 2)
                              ? resultFractionDigits("displacement", units)
                              : 5,
                          )
                        : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
