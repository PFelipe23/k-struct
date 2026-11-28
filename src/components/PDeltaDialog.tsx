import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { uid, type Project } from "../domain/model";
import { saveDiagnosticContext } from "../solver/diagnosticHistory";
import {
  cancelAnalysis,
  executeAnalysis,
  exportFile,
  type RunLog,
} from "../solver/desktop";
import {
  pDeltaCases,
  pDeltaModelError,
  pDeltaTolerance,
  solvePDelta,
  type PDeltaResult,
  type PDeltaStage,
} from "../solver/pDelta";
import { formatQuantity, formatUnitValue } from "../units";
import { buildResultTable } from "./Results";
import { formatResult } from "./resultFormatting";
import { useUnits } from "./Units";

const comparisonTabs = {
  displacements: "Deslocamentos",
  forces: "Esforços",
  reactions: "Reações",
  axial: "Axial de pré-carga",
} as const;

function stopMessage(result: PDeltaResult) {
  const { stop, lastConverged } = result;
  if (!stop) return "";
  return `Passo ${stop.stage.step}, iteração ${stop.stage.iteration}. ${stop.reason} ${lastConverged ? `O último passo convergido foi o ${lastConverged.step}, com ${formatUnitValue(lastConverged.fraction * 100)}% da ação lateral.` : "Nenhum passo P–Δ convergiu."}`;
}

export function PDeltaDialog({
  project,
  executable,
  revision,
  modelRevision,
  onLog,
  onClose,
}: {
  project: Project;
  executable: string;
  revision: number;
  modelRevision: { current: number };
  onLog: (log: RunLog) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const { units } = useUnits();
  const [gravityId, setGravityId] = useState(
    project.analysisCases[0]?.id ?? "",
  );
  const [lateralId, setLateralId] = useState(
    project.analysisCases[1]?.id ?? "",
  );
  const [steps, setSteps] = useState(1);
  const [maxIterations, setMaxIterations] = useState(30);
  const [stage, setStage] = useState<PDeltaStage | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PDeltaResult | null>(null);
  const [log, setLog] = useState<RunLog | null>(null);
  const [view, setView] =
    useState<keyof typeof comparisonTabs>("displacements");
  const [memberId, setMemberId] = useState(project.members[0]?.id ?? "");
  const [nodeId, setNodeId] = useState(project.nodes.at(-1)?.id ?? "");
  const previousRevision = useRef(revision);

  useEffect(() => {
    dialog.current?.showModal();
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (revision === previousRevision.current) return;
    previousRevision.current = revision;
    controller.current?.abort();
    setResult(null);
    setError("O modelo foi alterado. Execute a comparação na revisão atual.");
  }, [revision]);

  const options = { gravityId, lateralId, steps, maxIterations };
  const factorList = (factors: PDeltaResult["gravity"]) =>
    factors
      .map(
        ({ patternId, factor }) =>
          `${project.loadPatterns.find(({ id }) => id === patternId)?.name ?? patternId} × ${formatUnitValue(factor)}`,
      )
      .join(" + ") || "Sem carga";
  const modelProblem = pDeltaModelError(project);
  let caseProblem = "";
  let factors;
  if (!modelProblem) {
    try {
      factors = pDeltaCases(project, options);
    } catch (e) {
      caseProblem = e instanceof Error ? e.message : String(e);
    }
  }

  const run = async () => {
    if (controller.current) return;
    const active = new AbortController();
    const { signal } = active;
    controller.current = active;
    setRunning(true);
    setError("");
    setResult(null);
    setLog(null);
    let latestRunId: string | undefined;
    try {
      const comparison = await solvePDelta(
        project,
        options,
        async (input, current) => {
          if (modelRevision.current !== revision) active.abort();
          signal.throwIfAborted();
          setStage(current);
          const runId = uid();
          let ready = false;
          const cancel = () => {
            if (ready) void cancelAnalysis(runId).catch(() => undefined);
          };
          signal.addEventListener("abort", cancel, { once: true });
          try {
            const execution = await executeAnalysis(
              input.deck,
              executable,
              {
                runId,
                projectName: project.name,
                caseName: current.iteration
                  ? `${current.label} · iteração ${current.iteration}`
                  : current.label,
              },
              () => {
                ready = true;
                if (signal.aborted) cancel();
              },
            );
            onLog(execution.log);
            latestRunId = runId;
            if (modelRevision.current !== revision) active.abort();
            signal.throwIfAborted();
            setLog(execution.log);
            if (
              !execution.output ||
              execution.log.summary.status !== "completed"
            )
              throw new Error(execution.log.summary.message);
            return execution.output;
          } finally {
            signal.removeEventListener("abort", cancel);
          }
        },
        signal,
      );
      if (!signal.aborted && modelRevision.current === revision) {
        if (comparison.stop && latestRunId) {
          saveDiagnosticContext(latestRunId, project, [
            {
              id: "p-delta-stop",
              stage: "solver",
              severity: "erro",
              message: stopMessage(comparison),
              confidence: "confirmado",
              objects: [],
              action:
                "Confira os casos ativos e a rigidez do pórtico antes de repetir a comparação.",
            },
          ]);
        }
        setResult(comparison);
      }
    } catch (e) {
      if (modelRevision.current === revision)
        setError(
          signal.aborted
            ? "Comparação P–Δ cancelada."
            : e instanceof Error
              ? e.message
              : String(e),
        );
    } finally {
      controller.current = null;
      setRunning(false);
      setStage(null);
    }
  };

  const last = result?.lastConverged;
  const table =
    result && view !== "axial"
      ? buildResultTable(
          project,
          view,
          result.firstOrder,
          memberId,
          units,
          undefined,
          true,
        )
      : null;
  const secondOrder =
    last && view !== "axial"
      ? buildResultTable(
          project,
          view,
          last.result,
          memberId,
          units,
          undefined,
          true,
        )
      : null;
  const axes =
    project.mode === "spatial"
      ? (["x", "y", "z"] as const)
      : (["x", "z"] as const);
  const cells = (values: (string | number)[]) =>
    values.map((value, i) => (
      <td key={i}>
        {typeof value === "number" ? formatResult(value, 9) : value}
      </td>
    ));
  const save = async () => {
    if (!result) return;
    try {
      await exportFile(
        "comparacao-p-delta.json",
        JSON.stringify(
          {
            project: { id: project.id, name: project.name },
            options,
            formulation:
              "K elástica + matriz geométrica concentrada do OOFEM com N congelado na pré-carga linear",
            engine: log?.summary.engine,
            tolerance: pDeltaTolerance,
            units: "N-m-kg-s",
            ...result,
          },
          null,
          2,
        ),
        "application/json",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <dialog
      ref={dialog}
      className="modal launch-modal p-delta-dialog"
      aria-labelledby="p-delta-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!running) onClose();
      }}
    >
      <button
        className="modal-close"
        aria-label="Fechar análise P–Δ"
        onClick={onClose}
        disabled={running}
      >
        <X />
      </button>
      <h2 id="p-delta-title">Análise estática P–Δ</h2>
      <p>
        A rigidez geométrica usa o axial da pré-carga linear na malha inicial. A
        pré-carga permanece aplicada durante todos os passos laterais.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <fieldset disabled={running} className="p-delta-controls">
          <label>
            Pré-carga gravitacional
            <select
              value={gravityId}
              onChange={(event) => {
                setGravityId(event.target.value);
                setResult(null);
              }}
            >
              <option value="">Selecione um caso</option>
              {project.analysisCases.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Incremento lateral
            <select
              value={lateralId}
              onChange={(event) => {
                setLateralId(event.target.value);
                setResult(null);
              }}
            >
              <option value="">Selecione um caso</option>
              {project.analysisCases.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Passos laterais
            <input
              type="number"
              min={1}
              max={10}
              required
              value={Number.isNaN(steps) ? "" : steps}
              onChange={(event) => {
                setSteps(event.target.valueAsNumber);
                setResult(null);
              }}
            />
          </label>
          <label>
            Limite de iterações por passo
            <input
              type="number"
              min={1}
              max={50}
              required
              value={Number.isNaN(maxIterations) ? "" : maxIterations}
              onChange={(event) => {
                setMaxIterations(event.target.valueAsNumber);
                setResult(null);
              }}
            />
          </label>
        </fieldset>
        {factors && (
          <p>
            Pré-carga mantida · {factorList(factors.sustained)}
            <br />
            Incremento lateral a 100% · {factorList(factors.increment)}
          </p>
        )}
        {(modelProblem || caseProblem) && (
          <p className="solver-error">{modelProblem || caseProblem}</p>
        )}
        <div className="modal-actions">
          {running ? (
            <button
              key="cancel"
              type="button"
              onClick={() => controller.current?.abort()}
            >
              Cancelar análise P–Δ
            </button>
          ) : (
            <button
              key="run"
              type="submit"
              disabled={Boolean(modelProblem || caseProblem)}
            >
              Comparar primeira ordem e P–Δ
            </button>
          )}
        </div>
      </form>
      {running && (
        <p role="status">
          {stage
            ? stage.iteration
              ? `${stage.label} · iteração ${stage.iteration}`
              : stage.label
            : "Preparando análise P–Δ…"}
        </p>
      )}
      {error && (
        <p className="solver-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <section aria-label="Resultado da comparação">
          <h3>
            {result.stop ? "Comparação interrompida" : "Comparação convergida"}
          </h3>
          {result.stop && (
            <p className="solver-error" role="alert">
              {stopMessage(result)}
            </p>
          )}
          {log?.summary.engine && (
            <p>
              Motor ·{" "}
              {log.summary.engine.version
                ? `OOFEM ${log.summary.engine.version}`
                : log.summary.engine.path}{" "}
              {log.summary.engine.commit && `· ${log.summary.engine.commit}`}
            </p>
          )}
          <p>
            Tolerância relativa {pDeltaTolerance.toExponential()} com piso
            absoluto de 10⁻⁶ N. O passo 0 mantém apenas a pré-carga.
          </p>
          <div className="p-delta-table">
            <table aria-label="Convergência por passo">
              <thead>
                <tr>
                  <th>Passo</th>
                  <th>Ação lateral</th>
                  <th>Iterações</th>
                  <th>Resíduo relativo</th>
                </tr>
              </thead>
              <tbody>
                {result.steps.map((s) => (
                  <tr key={s.step}>
                    <th>{s.step}</th>
                    <td>{formatUnitValue(s.fraction * 100)}%</td>
                    <td>{s.iterations}</td>
                    <td>{s.residual.toExponential(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {last && (
            <p>
              Momento geométrico no primeiro nó do modelo ·{" "}
              {axes.length === 3
                ? (["x", "y", "z"] as const)
                    .map(
                      (axis) =>
                        axis.toUpperCase() +
                        " " +
                        formatQuantity(
                          last.geometricMoment[axis],
                          "moment",
                          units,
                        ),
                    )
                    .join(" · ")
                : `Y ${formatQuantity(last.geometricMoment.y, "moment", units)}`}{" "}
              {units.moment}
              <br />
              Maior variação axial em relação à pré-carga ·{" "}
              {formatQuantity(last.axialChange, "force", units)} {units.force}
            </p>
          )}
          {!result.stop && (
            <p>
              <label>
                Nó para amplificação{" "}
                <select
                  value={nodeId}
                  onChange={(event) => setNodeId(event.target.value)}
                >
                  {project.nodes.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>{" "}
              {axes
                .map((axis) => {
                  const key = `u${axis}` as const;
                  const linear =
                    result.firstOrder.displacements[nodeId]?.[key] ?? 0;
                  const amplified =
                    last?.result.displacements[nodeId]?.[key] ?? 0;
                  return `${key.toUpperCase()} ${Math.abs(linear) <= 1e-10 ? "—" : formatResult(amplified / linear) + "×"}`;
                })
                .join(" · ")}
            </p>
          )}
          <div className="p-delta-controls">
            <label>
              Resultado{" "}
              <select
                value={view}
                onChange={(event) =>
                  setView(event.target.value as keyof typeof comparisonTabs)
                }
              >
                {Object.entries(comparisonTabs).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {(view === "forces" || view === "axial") && (
              <label>
                Barra{" "}
                <select
                  value={memberId}
                  onChange={(event) => setMemberId(event.target.value)}
                >
                  {project.members.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="p-delta-table">
            {table ? (
              <table aria-label={comparisonTabs[view]}>
                <thead>
                  <tr>
                    <th rowSpan={2}>{table.headers[0]}</th>
                    <th colSpan={table.headers.length - 1}>
                      Primeira ordem · 100% lateral
                    </th>
                    {secondOrder && (
                      <th colSpan={table.headers.length - 1}>
                        P–Δ · {formatUnitValue(last!.fraction * 100)}% lateral
                      </th>
                    )}
                  </tr>
                  <tr>
                    {table.headers.slice(1).map((header, i) => (
                      <th key={i}>{header}</th>
                    ))}
                    {secondOrder?.headers.slice(1).map((header, i) => (
                      <th key={`p-${i}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index}>
                      <th>{row[0]}</th>
                      {cells(row.slice(1))}
                      {secondOrder && cells(secondOrder.rows[index].slice(1))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table aria-label="Axial de pré-carga">
                <thead>
                  <tr>
                    <th>Início x/L</th>
                    <th>Fim x/L</th>
                    <th>N inicial ({units.force})</th>
                  </tr>
                </thead>
                <tbody>
                  {result.axial
                    .filter((item) => item.memberId === memberId)
                    .map(({ t0, t1, n }) => (
                      <tr key={t0}>
                        <td>{formatUnitValue(t0)}</td>
                        <td>{formatUnitValue(t1)}</td>
                        <td>{formatQuantity(n, "force", units)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
          <p>
            A rigidez pode ser reutilizada para incrementos que preservem a
            malha, os vínculos e o estado axial. Se esses dados mudarem ou
            houver variação axial relevante, reavalie a pré-carga e o caminho. A
            convergência desta comparação não certifica estabilidade.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => void save()}>
              Exportar comparação
            </button>
          </div>
        </section>
      )}
    </dialog>
  );
}
