import { useState } from "react";
import { CheckCircle2, FileDown, History, Terminal } from "lucide-react";
import type { Project } from "../domain/model";
import type { AnalysisResult } from "../solver/oofem";
import { exportFile } from "../solver/desktop";

export default function Results({
  project,
  result,
  message,
  running,
  cancelling,
  openRunHistory,
}: {
  project: Project;
  result: AnalysisResult | null;
  message: string;
  running: boolean;
  cancelling: boolean;
  openRunHistory?: () => void;
}) {
  const [tab, setTab] = useState("log");
  const [exportError, setExportError] = useState("");
  const download = (name: string, content: string, type = "text/plain") => {
    setExportError("");
    void exportFile(name, content, type).catch((e) =>
      setExportError(String(e)),
    );
  };
  const fmt = (v: number) =>
    v.toLocaleString("pt-BR", { maximumFractionDigits: 5 });
  const rows: (string | number)[][] =
    tab === "reactions"
      ? (result?.reactions ?? []).map((r) => [
          project.nodes.find((n) => n.id === r.nodeId)?.name ?? r.nodeId,
          r.fx / 1000,
          r.fz / 1000,
          r.my / 1000,
        ])
      : tab === "displacements"
        ? [
            ...Object.entries(result?.displacements ?? {}).map(([id, d]) => [
              project.nodes.find((n) => n.id === id)?.name ?? id,
              d.ux * 1000,
              d.uz * 1000,
              d.ry * 1000,
            ]),
            ...Object.entries(result?.members ?? {}).flatMap(([id, stations]) =>
              stations
                .slice(1, -1)
                .map((s) => [
                  `${project.members.find((m) => m.id === id)?.name ?? id} · x/L ${s.t}`,
                  s.ux * 1000,
                  s.uz * 1000,
                  s.ry * 1000,
                ]),
            ),
          ]
        : Object.entries(result?.members ?? {}).flatMap(([id, stations]) =>
            stations.map((s) => [
              project.members.find((m) => m.id === id)?.name ?? id,
              s.t,
              s.n / 1000,
              s.v / 1000,
              s.m / 1000,
            ]),
          );
  const headers =
    tab === "reactions"
      ? ["Nó", "RX (kN)", "RZ (kN)", "MY (kN·m)"]
      : tab === "displacements"
        ? ["Nó / estação", "UX (mm)", "UZ (mm)", "RY (mrad)"]
        : ["Barra", "x/L", "N (kN)", "V (kN)", "M (kN·m)"];
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
          {openRunHistory && tab === "log" && (
            <button onClick={openRunHistory}>
              <History size={13} />
              Registros do OOFEM
            </button>
          )}
          {result && (
            <>
              <span>
                <CheckCircle2 size={13} /> {result.solver}
              </span>
              <button
                title="Baixar saída original do OOFEM"
                onClick={() => download("oofem-analysis.out", result.rawOutput)}
              >
                Saída OOFEM
              </button>
              {tab !== "log" && (
                <button
                  onClick={() =>
                    download(
                      `kstruct-${tab}.csv`,
                      "\uFEFF" +
                        [headers, ...rows]
                          .map((r) =>
                            r
                              .map((v) =>
                                typeof v === "number"
                                  ? String(v)
                                  : `"${v.replaceAll('"', '""')}"`,
                              )
                              .join(";"),
                          )
                          .join("\n"),
                      "text/csv",
                    )
                  }
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
                  : message}
            </pre>
          </div>
        ) : !result ? (
          <div className="no-results">
            Execute uma análise para consultar{" "}
            {tab === "forces"
              ? "os esforços"
              : tab === "reactions"
                ? "as reações"
                : "os deslocamentos"}{" "}
            do modelo atual.
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
                    <td key={j}>{typeof v === "number" ? fmt(v) : v}</td>
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
