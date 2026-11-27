import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Project } from "../domain/model";
import { saveAnalysisPdf } from "../solver/desktop";
import {
  renderAnalysisReport,
  reportSources,
  reportTables,
  type ReportOptions,
  type ReportTable,
} from "../solver/analysisReport";
import type { AnalysisResult } from "../solver/oofem";
import { reportCaseStatus, type ReportRun } from "../solver/reportRuns";
import { useUnits } from "./Units";

type Props = {
  project: Project;
  revision: number;
  cases: ReadonlyMap<string, AnalysisResult>;
  runs: ReadonlyMap<string, ReportRun>;
  initialScope: string;
  memberId?: string;
  warnings?: readonly string[];
  close: () => void;
};

export function AnalysisReportDialog({
  project,
  revision,
  cases,
  runs,
  initialScope,
  memberId,
  warnings,
  close,
}: Props) {
  const { units } = useUnits();
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const sources = reportSources(project);
  const [options, setOptions] = useState<ReportOptions>({
    sources: [
      sources.some((v) => v.scope === initialScope)
        ? initialScope
        : sources[0].scope,
    ],
    tables: ["reactions", "displacements", "forces"],
    geometry: true,
    diagramMemberId: memberId || project.members[0]?.id || "",
  });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const status = (id: string) =>
    reportCaseStatus(project.id, revision, runs.get(id), cases.has(id));
  const change = (updates: Partial<ReportOptions>) => {
    setOptions((before) => ({ ...before, ...updates }));
    setMessage("");
    setError("");
  };
  const emit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current || !options.sources.length) return;
    const snapshot = {
      project,
      revision,
      results: cases,
      runs,
      units,
      issuedAt: new Date().toISOString(),
      warnings,
      options,
    };
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await saveAnalysisPdf(project.name, () =>
        renderAnalysisReport(snapshot),
      );
      setMessage(saved ? "Relatório PDF salvo." : "Gravação cancelada.");
    } catch (reason) {
      setError(
        `Não foi possível salvar o PDF. ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="slab-sizing-dialog report-dialog"
      aria-label="Relatório de análise"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving.current) close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2>Relatório de análise</h2>
      <p>
        {project.name} · Revisão {revision}
      </p>
      <form onSubmit={(event) => void emit(event)}>
        <fieldset disabled={busy}>
          <legend>Casos e combinações</legend>
          <div className="report-scopes">
            {sources.map((source) => {
              const missing =
                source.kind === "combination"
                  ? source.definition.factors.filter(
                      (f) => f.factor !== 0 && !cases.has(f.caseId),
                    )
                  : [];
              return (
                <label key={source.scope}>
                  <input
                    type="checkbox"
                    checked={options.sources.includes(source.scope)}
                    onChange={(e) =>
                      change({
                        sources: e.target.checked
                          ? [...options.sources, source.scope]
                          : options.sources.filter((v) => v !== source.scope),
                      })
                    }
                  />
                  <span>
                    {source.kind === "case" ? "Caso" : "Combinação"} [
                    {source.definition.id}] · {source.definition.name}
                  </span>
                  <small>
                    {source.kind === "case"
                      ? status(source.definition.id)
                      : missing.length
                        ? missing
                            .map((f) => `${f.caseId} · ${status(f.caseId)}`)
                            .join(" / ")
                        : "Disponível"}
                  </small>
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset disabled={busy} className="report-options">
          <legend>Tabelas de resultados</legend>
          {(Object.keys(reportTables) as ReportTable[]).map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={options.tables.includes(key)}
                onChange={(e) =>
                  change({
                    tables: e.target.checked
                      ? [...options.tables, key]
                      : options.tables.filter((v) => v !== key),
                  })
                }
              />
              {reportTables[key]}
            </label>
          ))}
        </fieldset>
        <fieldset disabled={busy} className="report-options">
          <legend>Figuras</legend>
          <label>
            <input
              type="checkbox"
              checked={options.geometry}
              onChange={(e) => change({ geometry: e.target.checked })}
            />
            Geometria
          </label>
          {project.members.length > 0 && (
            <label>
              Diagrama de momento{" "}
              <select
                value={options.diagramMemberId}
                onChange={(e) => change({ diagramMemberId: e.target.value })}
              >
                <option value="">Omitir diagrama</option>
                {project.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    [{m.id}] {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
        <p>
          Casos pendentes, cancelados ou de revisão anterior aparecem com seu
          estado. Tabelas e diagramas usam os resultados disponíveis da revisão.
        </p>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            Fechar relatório
          </button>
          <button type="submit" disabled={busy || !options.sources.length}>
            {busy ? "Preparando PDF…" : "Salvar PDF"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
