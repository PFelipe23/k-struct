import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { coordinates, type Coordinate, type Point3 } from "../domain/geometry";
import type { Project } from "../domain/model";
import { fromSI, formatUnitInput, parseUnitInput } from "../units";
import { useUnits } from "./Units";
import {
  inspectTabularImport,
  type CoordinateUnit,
  type TabularImportPlan,
} from "../domain/tabularImport";

const formatLength = (value: number): string =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

export default function NodeTable({
  project,
  onApply,
  onImportTabular,
  onClose,
}: {
  project: Project;
  onApply: (changes: ReadonlyMap<string, Partial<Point3>>) => string | null;
  onImportTabular: (plan: TabularImportPlan) => string | null;
  onClose: () => void;
}) {
  const { units } = useUnits();
  const displayLength = (si: number) =>
    formatLength(fromSI(si, "length", units));
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"edit" | "paste">("edit");
  const [draft, setDraft] = useState(
    () => new Map<string, Partial<Record<Coordinate, string>>>(),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState("");
  const [unit, setUnit] = useState<CoordinateUnit>(units.length);
  const [nodesTsv, setNodesTsv] = useState("");
  const [membersTsv, setMembersTsv] = useState("");
  const [pasteError, setPasteError] = useState("");
  const axes = project.mode === "spatial" ? coordinates : (["x", "z"] as const);
  const spatial = project.mode === "spatial";
  const rows = project.nodes.map((node) => ({
    node,
    cells: axes.map((axis) => {
      const text =
        draft.get(node.id)?.[axis] ??
        formatUnitInput(node[axis], "length", units);
      const value = parseUnitInput(text, "length", units, node[axis]) ?? NaN;
      const reason = !text.trim()
        ? "Preencha a coordenada."
        : Number.isFinite(value)
          ? ""
          : "Informe um número finito.";
      return { id: `coordinate-${node.id}-${axis}`, axis, text, value, reason };
    }),
  }));
  const firstInvalid = rows
    .flatMap(({ cells }) => cells)
    .find((cell) => cell.reason);

  const tabularInspection = useMemo(
    () => inspectTabularImport(project, { nodesTsv, membersTsv, unit }),
    [project, nodesTsv, membersTsv, unit],
  );
  const hasPasteInput = Boolean(nodesTsv.trim() || membersTsv.trim());

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (firstInvalid) {
      setShowErrors(true);
      event.currentTarget
        .querySelector<HTMLInputElement>(`#${firstInvalid.id}`)
        ?.focus();
      return;
    }
    const changes = new Map<string, Partial<Point3>>();
    for (const { node, cells } of rows) {
      for (const { axis, value } of cells) {
        if (value !== node[axis]) {
          const position = changes.get(node.id) ?? {};
          position[axis] = value;
          changes.set(node.id, position);
        }
      }
    }
    const problem = changes.size ? onApply(changes) : null;
    if (problem) setError(problem);
    else onClose();
  };

  const applyPaste = () => {
    if (!tabularInspection.ok || !hasPasteInput) return;
    if (!tabularInspection.plan.hasChanges) {
      onClose();
      return;
    }
    const problem = onImportTabular(tabularInspection.plan);
    if (problem) setPasteError(problem);
    else onClose();
  };

  return (
    <dialog
      ref={dialog}
      className={`modal launch-modal node-editor ${tab === "paste" ? "node-editor-wide" : ""}`}
      aria-labelledby="node-table-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="node-table-title">Tabela de nós</h2>
      <div className="guide-tabs" role="tablist" aria-label="Modo da tabela">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "edit"}
          aria-pressed={tab === "edit"}
          onClick={() => setTab("edit")}
        >
          Editar nós
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "paste"}
          aria-pressed={tab === "paste"}
          onClick={() => setTab("paste")}
        >
          Colar planilha (TSV)
        </button>
      </div>
      {tab === "edit" ? (
        <form onSubmit={apply}>
          {rows.length ? (
            <div className="node-table-scroll">
              <table aria-label="Coordenadas dos nós">
                <thead>
                  <tr>
                    <th scope="col">Nó</th>
                    {axes.map((axis) => (
                      <th scope="col" key={axis}>
                        {axis.toUpperCase()} ({units.length})
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ node, cells }) => (
                    <tr key={node.id}>
                      <th scope="row">{node.name}</th>
                      {cells.map(({ id, axis, text, reason }) => {
                        const invalid = showErrors && Boolean(reason);
                        return (
                          <td key={axis}>
                            <input
                              id={id}
                              aria-label={`${axis.toUpperCase()} de ${node.name}`}
                              aria-invalid={invalid}
                              aria-describedby={
                                invalid ? `${id}-error` : undefined
                              }
                              inputMode="decimal"
                              value={text}
                              onChange={(event) => {
                                const value = event.target.value;
                                setDraft((previous) =>
                                  new Map(previous).set(node.id, {
                                    ...previous.get(node.id),
                                    [axis]: value,
                                  }),
                                );
                                setError("");
                              }}
                            />
                            {invalid && (
                              <span
                                id={`${id}-error`}
                                className="coordinate-error"
                              >
                                {reason}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Adicione nós ao modelo para editar as coordenadas.</p>
          )}
          {(error || (showErrors && firstInvalid)) && (
            <p role="alert" className="launch-error">
              {error || "Corrija as coordenadas destacadas para aplicar."}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={!rows.length}>
              Aplicar
            </button>
          </div>
        </form>
      ) : (
        <div className="tabular-paste-panel">
          <p className="help">
            Cole células tabuladas (TSV) de uma planilha com Ctrl+V. Um ID
            existente atualiza o objeto preservando apoios e cargas; um ID novo
            cria o objeto. Barras podem referenciar nós criados no mesmo lote.
          </p>
          <div className="tabular-controls">
            <label>
              Unidade das coordenadas
              <select
                aria-label="Unidade das coordenadas"
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value as CoordinateUnit);
                  setPasteError("");
                }}
              >
                <option value="m">Metros (m)</option>
                <option value="cm">Centímetros (cm)</option>
                <option value="mm">Milímetros (mm)</option>
              </select>
            </label>
            <div className="tabular-examples">
              <span>
                Nós:{" "}
                <code>{spatial ? "ID\tNome\tX\tY\tZ" : "ID\tNome\tX\tZ"}</code>
              </span>
              <span>
                Barras: <code>ID\tNome\tID inicial\tID final\tSeção</code>{" "}
                (seções: {project.sections.map((s) => s.id).join(", ")})
              </span>
            </div>
          </div>

          <div className="tabular-inputs">
            <label>
              <span>Colar nós (TSV)</span>
              <textarea
                aria-label="Colar nós (TSV)"
                rows={4}
                placeholder={
                  spatial
                    ? "ID\tNome\tX\tY\tZ\nN1\tN1\t0\t0\t0\nN2\tN2\t350\t0\t0"
                    : "ID\tNome\tX\tZ\nN1\tN1\t0\t0\nN2\tN2\t350\t0"
                }
                value={nodesTsv}
                onChange={(e) => {
                  setNodesTsv(e.target.value);
                  setPasteError("");
                }}
              />
            </label>
            <label>
              <span>Colar barras (TSV)</span>
              <textarea
                aria-label="Colar barras (TSV)"
                rows={4}
                placeholder={`ID\tNome\tID inicial\tID final\tSeção\nB1\tB1\tN1\tN2\t${project.sections[0].id}`}
                value={membersTsv}
                onChange={(e) => {
                  setMembersTsv(e.target.value);
                  setPasteError("");
                }}
              />
            </label>
          </div>

          <div className="tabular-preview" aria-label="Prévia da importação">
            <h3>Prévia do lote</h3>
            {pasteError && (
              <p role="alert" className="launch-error">
                {pasteError}
              </p>
            )}
            {!tabularInspection.ok ? (
              <div role="alert" className="tabular-errors">
                <p className="launch-error">
                  Corrija os erros abaixo antes de aplicar o lote:
                </p>
                <div className="node-table-scroll">
                  <table aria-label="Erros na importação tabular">
                    <thead>
                      <tr>
                        <th scope="col">Tabela</th>
                        <th scope="col">Linha</th>
                        <th scope="col">Coluna</th>
                        <th scope="col">Valor</th>
                        <th scope="col">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabularInspection.errors.map((err, idx) => (
                        <tr key={idx}>
                          <td>{err.table === "nodes" ? "Nós" : "Barras"}</td>
                          <td>{err.line}</td>
                          <td>{err.column}</td>
                          <td>{err.value || "—"}</td>
                          <td>{err.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : !hasPasteInput ? (
              <p className="help">
                Cole linhas de nós e/ou barras acima para visualizar a prévia em
                {units.length}.
              </p>
            ) : (
              <>
                <p className="tabular-counts">
                  Nós: {tabularInspection.plan.counts.nodesCreated} criar ·{" "}
                  {tabularInspection.plan.counts.nodesUpdated} atualizar ·{" "}
                  {tabularInspection.plan.counts.nodesUnchanged} sem alteração |{" "}
                  Barras: {tabularInspection.plan.counts.membersCreated} criar ·{" "}
                  {tabularInspection.plan.counts.membersUpdated} atualizar ·{" "}
                  {tabularInspection.plan.counts.membersUnchanged} sem alteração
                </p>
                {!tabularInspection.plan.hasChanges && (
                  <p className="help">
                    Prévia sem alteração: todos os registros coincidem com o
                    projeto atual.
                  </p>
                )}
                {tabularInspection.plan.nodes.length > 0 && (
                  <div className="node-table-scroll">
                    <table aria-label="Prévia de nós">
                      <thead>
                        <tr>
                          <th scope="col">Ação</th>
                          <th scope="col">ID</th>
                          <th scope="col">Nome</th>
                          <th scope="col">X ({units.length})</th>
                          {spatial && <th scope="col">Y ({units.length})</th>}
                          <th scope="col">Z ({units.length})</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tabularInspection.plan.nodes.map((n) => (
                          <tr key={n.id}>
                            <td>
                              {n.action === "create"
                                ? "Criar"
                                : n.action === "update"
                                  ? "Atualizar"
                                  : "Manter"}
                            </td>
                            <td>{n.id}</td>
                            <td>{n.name}</td>
                            <td>{displayLength(n.x)}</td>
                            {spatial && <td>{displayLength(n.y)}</td>}
                            <td>{displayLength(n.z)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {tabularInspection.plan.members.length > 0 && (
                  <div className="node-table-scroll">
                    <table aria-label="Prévia de barras">
                      <thead>
                        <tr>
                          <th scope="col">Ação</th>
                          <th scope="col">ID</th>
                          <th scope="col">Nome</th>
                          <th scope="col">Ligação</th>
                          <th scope="col">Seção</th>
                          <th scope="col">Comp. ({units.length})</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tabularInspection.plan.members.map((m) => (
                          <tr key={m.id}>
                            <td>
                              {m.action === "create"
                                ? "Criar"
                                : m.action === "update"
                                  ? "Atualizar"
                                  : "Manter"}
                            </td>
                            <td>{m.id}</td>
                            <td>{m.name}</td>
                            <td>
                              {m.start} → {m.end}
                            </td>
                            <td>{m.sectionName}</td>
                            <td>
                              {displayLength(m.length)} {units.length}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="primary"
              disabled={!tabularInspection.ok || !hasPasteInput}
              onClick={applyPaste}
            >
              Aplicar lote
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
