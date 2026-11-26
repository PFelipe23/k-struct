import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import {
  exportFile,
  readRunLog,
  recentRuns,
  runStatusLabel,
  type RunLog,
  type RunSummary,
} from "../solver/desktop";
import EngineDetails from "./EngineDetails";
import type { Project } from "../domain/model";
import type { AnalysisDiagnostic } from "../domain/diagnostics";
import {
  diagnosticContextMatches,
  readDiagnosticContext,
  type StoredDiagnosticContext,
} from "../solver/diagnosticHistory";

const date = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});

export default function RunHistory({
  latest,
  project,
  onInspect,
  onClose,
}: {
  latest: RunLog | null;
  project: Project;
  onInspect: (diagnostic: AnalysisDiagnostic) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    latest?.summary.runId ?? null,
  );
  const [log, setLog] = useState<RunLog | null>(latest);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [diagnosticContext, setDiagnosticContext] =
    useState<StoredDiagnosticContext | null>(null);

  useEffect(() => {
    setDiagnosticContext(null);
    setDiagnosticContext(selectedId ? readDiagnosticContext(selectedId) : null);
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    setListError("");
    recentRuns()
      .then((stored) => {
        if (!active) return;
        const entries =
          latest &&
          !stored.some((entry) => entry.runId === latest.summary.runId)
            ? [latest.summary, ...stored]
            : stored;
        setEntries(entries);
        setSelectedId((id) => id ?? entries[0]?.runId ?? null);
      })
      .catch((error) => {
        if (active) setListError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [latest]);

  useEffect(() => {
    if (!selectedId) return;
    setDetailError("");
    if (latest?.summary.runId === selectedId) {
      setLog(latest);
      return;
    }
    let active = true;
    setLog(null);
    readRunLog(selectedId)
      .then((record) => {
        if (active) setLog(record);
      })
      .catch((error) => {
        if (active) setDetailError(String(error));
      });
    return () => {
      active = false;
    };
  }, [selectedId, latest]);

  const exportLog = async () => {
    if (!log) return;
    setDetailError("");
    try {
      await exportFile(
        `oofem-${log.summary.runId}.json`,
        JSON.stringify(log, null, 2),
        "application/json",
      );
    } catch (error) {
      setDetailError(String(error));
    }
  };

  return (
    <div className="modal-backdrop">
      <section
        className="modal run-history"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <button
          className="modal-close"
          aria-label="Fechar histórico"
          onClick={onClose}
        >
          <X />
        </button>
        <h2 id="history-title">Histórico de análises</h2>
        <p>Registros das últimas 30 execuções do OOFEM neste computador.</p>
        {listError && (
          <p role="alert" className="solver-error">
            {listError}
          </p>
        )}
        {loading ? (
          <p>Carregando histórico…</p>
        ) : entries.length === 0 && !log ? (
          <p>Nenhuma execução registrada.</p>
        ) : (
          <div className="run-history-grid">
            <div
              className="run-history-list"
              aria-label="Execuções registradas"
            >
              {entries.map((entry) => (
                <button
                  key={entry.runId}
                  type="button"
                  aria-pressed={selectedId === entry.runId}
                  onClick={() => setSelectedId(entry.runId)}
                >
                  <strong>{entry.projectName}</strong>
                  <span>{entry.caseName}</span>
                  <small>
                    {date.format(entry.startedAt)} ·{" "}
                    {runStatusLabel[entry.status]}
                  </small>
                </button>
              ))}
            </div>
            <div className="run-history-detail">
              {detailError && (
                <p role="alert" className="solver-error">
                  {detailError}
                </p>
              )}
              {log && log.summary.runId === selectedId && (
                <>
                  <div className="run-history-heading">
                    <h3>{runStatusLabel[log.summary.status]}</h3>
                    <button onClick={() => void exportLog()}>
                      <Download size={14} />
                      Exportar log
                    </button>
                  </div>
                  <p>
                    {log.summary.message} ·{" "}
                    {(log.summary.durationMs / 1000).toLocaleString("pt-BR", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    s
                  </p>
                  {log.summary.engine && (
                    <EngineDetails engine={log.summary.engine} />
                  )}
                  {diagnosticContext?.diagnostics.map((diagnostic) => (
                    <article key={diagnostic.id} className="history-diagnostic">
                      <strong>
                        {diagnostic.stage} · {diagnostic.severity}
                      </strong>
                      <p>{diagnostic.message}</p>
                      <p>{diagnostic.action}</p>
                      {diagnostic.objects.length > 0 &&
                        (diagnosticContextMatches(
                          diagnosticContext,
                          project,
                        ) ? (
                          <button onClick={() => onInspect(diagnostic)}>
                            Inspecionar objetos identificados
                          </button>
                        ) : (
                          <small>
                            O projeto foi alterado; o histórico não pode
                            selecionar objetos na revisão atual.
                          </small>
                        ))}
                    </article>
                  ))}
                  {log.logTruncated && (
                    <p>
                      O registro preserva a parte final das mensagens do motor.
                    </p>
                  )}
                  {log.stdout && (
                    <>
                      <h4>Saída do motor</h4>
                      <pre className="solver-log">{log.stdout}</pre>
                    </>
                  )}
                  {log.stderr && (
                    <>
                      <h4>Mensagens de erro</h4>
                      <pre className="solver-log">{log.stderr}</pre>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
