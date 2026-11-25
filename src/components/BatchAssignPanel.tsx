import { useMemo, useState } from "react";
import {
  applyBatchAssignment,
  planarDofs,
  planarNodalKeys,
  planarUniformKeys,
  previewBatchAssignment,
  spatialDofs,
  spatialNodalKeys,
  spatialUniformKeys,
  summarizeBatchSelection,
  type BatchAssignmentSpec,
  type DofKey,
  type LoadOperation,
  type NodalLoadKey,
  type SupportAction,
  type UniformLoadKey,
  type ValueSummary,
} from "../domain/batchAssign";
import type { Project, SelectedObject } from "../domain/model";
import { useUnits } from "./Units";
import {
  formatQuantity,
  parseUnitInput,
  type UnitPreferences,
  type UnitQuantity,
} from "../units";
import { coordinates } from "../domain/geometry";
import { supportBasis, type SupportFrame } from "../domain/supports";
import { formatResult } from "./resultFormatting";

function describeFrame(frame?: SupportFrame) {
  if (!frame) return "Global";
  if (frame.kind === "planar")
    return `Local · tangente a ${formatResult(frame.angle)}° em XZ`;
  const basis = supportBasis(frame);
  return (
    "Local · " +
    coordinates
      .map(
        (k) =>
          `${k} = (${coordinates.map((j) => formatResult(basis[k][j])).join(" / ")})`,
      )
      .join(", ")
  );
}

const describeSummary = (
  summary: ValueSummary | undefined,
  quantity: UnitQuantity,
  units: UnitPreferences,
): string => {
  const unit = units[quantity];
  if (!summary) return `0 ${unit}`;
  if (summary.kind === "uniform")
    return `${formatQuantity(summary.value, quantity, units)} ${unit}`;
  return `Misto (${formatQuantity(summary.min, quantity, units)} a ${formatQuantity(summary.max, quantity, units)} ${unit})`;
};

export default function BatchAssignPanel({
  project,
  selection,
  patternId,
  edit,
}: {
  project: Project;
  selection: SelectedObject[];
  patternId: string;
  edit: (fn: (p: Project) => void) => string | null | void;
}) {
  const { units } = useUnits();
  const spatial = project.mode === "spatial";
  const pattern = project.loadPatterns.find((p) => p.id === patternId)!;

  const [sectionId, setSectionId] = useState("");
  const [restraints, setRestraints] = useState<
    Partial<Record<DofKey, SupportAction>>
  >({});
  const [uniformOp, setUniformOp] = useState<LoadOperation>("add");
  const [uniformDraft, setUniformDraft] = useState<Record<string, string>>({});
  const [uniformRemove, setUniformRemove] = useState<Set<UniformLoadKey>>(
    () => new Set(),
  );
  const [nodalOp, setNodalOp] = useState<LoadOperation>("add");
  const [nodalDraft, setNodalDraft] = useState<Record<string, string>>({});
  const [nodalRemove, setNodalRemove] = useState<Set<NodalLoadKey>>(
    () => new Set(),
  );
  const [notice, setNotice] = useState("");

  const resetDraft = () => {
    setSectionId("");
    setRestraints({});
    setUniformOp("add");
    setUniformDraft({});
    setUniformRemove(new Set());
    setNodalOp("add");
    setNodalDraft({});
    setNodalRemove(new Set());
    setNotice("");
  };

  const summary = useMemo(
    () => summarizeBatchSelection(project, selection, patternId),
    [project, selection, patternId],
  );

  if (summary.nodes.length === 0 && summary.members.length === 0) {
    return null;
  }

  const hasLocalFrame = summary.nodes.some((n) => n.supportFrame);
  const activeDofs = spatial ? spatialDofs : planarDofs;
  const activeUniformKeys = spatial ? spatialUniformKeys : planarUniformKeys;
  const activeNodalKeys = spatial ? spatialNodalKeys : planarNodalKeys;

  const invalidUniform = new Set<UniformLoadKey>();
  const uniformValues: Partial<Record<UniformLoadKey, number>> = {};
  if (uniformOp !== "remove") {
    for (const key of activeUniformKeys) {
      const raw = uniformDraft[key] ?? "";
      if (!raw.trim()) continue;
      const parsed = parseUnitInput(raw, "distributedLoad", units);
      if (parsed === null) invalidUniform.add(key);
      else uniformValues[key] = parsed;
    }
  }

  const invalidNodal = new Set<NodalLoadKey>();
  const nodalValues: Partial<Record<NodalLoadKey, number>> = {};
  if (nodalOp !== "remove") {
    for (const key of activeNodalKeys) {
      const raw = nodalDraft[key] ?? "";
      if (!raw.trim()) continue;
      const parsed = parseUnitInput(
        raw,
        key[0] === "f" ? "force" : "moment",
        units,
      );
      if (parsed === null) invalidNodal.add(key);
      else nodalValues[key] = parsed;
    }
  }

  const hasFieldError = invalidUniform.size > 0 || invalidNodal.size > 0;

  const spec: BatchAssignmentSpec = {
    sectionId: sectionId || undefined,
    restraints,
    uniformLoad:
      summary.members.length > 0
        ? {
            operation: uniformOp,
            values: uniformValues,
            removeKeys: uniformOp === "remove" ? [...uniformRemove] : undefined,
          }
        : undefined,
    nodalLoad:
      summary.nodes.length > 0
        ? {
            operation: nodalOp,
            values: nodalValues,
            removeKeys: nodalOp === "remove" ? [...nodalRemove] : undefined,
          }
        : undefined,
  };

  const preview = previewBatchAssignment(
    project,
    selection,
    patternId,
    spec,
    units,
  );

  const apply = () => {
    if (hasFieldError || !preview.ok) return;
    if (!preview.hasChanges) {
      setNotice("Nenhuma alteração efetiva para aplicar no lote.");
      return;
    }
    const problem = edit((draft) => {
      applyBatchAssignment(draft, selection, patternId, spec);
    });
    if (typeof problem === "string" && problem) {
      setNotice(problem);
      return;
    }
    resetDraft();
  };

  const secSummary = summary.section;
  const currentSectionLabel =
    secSummary.kind === "mixed"
      ? "Misto"
      : secSummary.kind === "uniform"
        ? (project.sections.find((s) => s.id === secSummary.sectionId)?.name ??
          "")
        : "";

  return (
    <section className="batch-panel" aria-label="Atribuição em lote">
      <h4>Atribuição em lote</h4>
      <p className="help">
        Campos vazios ou em &quot;Manter&quot; preservam os valores atuais.
      </p>

      {summary.members.length > 0 && (
        <>
          <label className="stack-field">
            Seção das barras ({currentSectionLabel})
            <select
              aria-label="Seção em lote"
              value={sectionId}
              onChange={(e) => {
                setSectionId(e.target.value);
                setNotice("");
              }}
            >
              <option value="">Manter seção atual</option>
              {project.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {summary.nodes.length > 0 && (
        <>
          <h4>Apoios dos nós</h4>
          <p className="help">
            {hasLocalFrame
              ? "Os vínculos seguem os eixos de cada nó. Confira os referenciais na prévia."
              : "Os vínculos da seleção usam os eixos globais."}
          </p>
          {activeDofs.map((dof) => {
            const state = summary.restraints[dof] ?? "free";
            const stateText =
              state === "mixed"
                ? "Misto"
                : state === "restricted"
                  ? "Restringido"
                  : "Livre";
            return (
              <label className="batch-row" key={dof}>
                <span>
                  {dof[0] === "r" ? "Rotação" : "Translação"}{" "}
                  {dof[1].toUpperCase()}
                  <small>{stateText}</small>
                </span>
                <select
                  aria-label={`Apoio em lote ${dof}`}
                  value={restraints[dof] ?? "keep"}
                  onChange={(e) => {
                    setRestraints((prev) => ({
                      ...prev,
                      [dof]: e.target.value as SupportAction,
                    }));
                    setNotice("");
                  }}
                >
                  <option value="keep">Manter</option>
                  <option value="restrict">Restringir</option>
                  <option value="release">Liberar</option>
                </select>
              </label>
            );
          })}
        </>
      )}

      {summary.members.length > 0 && (
        <>
          <h4>
            Carga distribuída global <span>{pattern.name}</span>
          </h4>
          <label className="stack-field">
            Operação de carga distribuída
            <select
              aria-label="Operação de carga distribuída"
              value={uniformOp}
              onChange={(e) => {
                setUniformOp(e.target.value as LoadOperation);
                setNotice("");
              }}
            >
              <option value="add">Somar</option>
              <option value="replace">Substituir</option>
              <option value="remove">Remover</option>
            </select>
          </label>
          {uniformOp === "remove" ? (
            <div className="batch-checks">
              {activeUniformKeys.map((key) => {
                const label = `q${key[1].toUpperCase()}`;
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      aria-label={`Remover ${label}`}
                      checked={uniformRemove.has(key)}
                      onChange={(e) => {
                        setUniformRemove((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        });
                        setNotice("");
                      }}
                    />
                    <span>
                      Remover {label} (
                      {describeSummary(
                        summary.uniform[key],
                        "distributedLoad",
                        units,
                      )}
                      )
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            activeUniformKeys.map((key) => {
              const label = `q${key[1].toUpperCase()}`;
              const invalid = invalidUniform.has(key);
              const currentDesc = describeSummary(
                summary.uniform[key],
                "distributedLoad",
                units,
              );
              return (
                <label className="number-field" key={key}>
                  <span>
                    Lote {label}
                    <small style={{ position: "static", display: "block" }}>
                      {currentDesc}
                    </small>
                  </span>
                  <div>
                    <input
                      aria-label={`Lote ${label}`}
                      aria-invalid={invalid}
                      inputMode="decimal"
                      placeholder={
                        summary.uniform[key]?.kind === "mixed"
                          ? "Misto"
                          : "Manter"
                      }
                      value={uniformDraft[key] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setUniformDraft((prev) => ({ ...prev, [key]: val }));
                        setNotice("");
                      }}
                    />
                    <small>{units.distributedLoad}</small>
                  </div>
                  {invalid && <em>Informe um valor numérico finito.</em>}
                </label>
              );
            })
          )}
        </>
      )}

      {summary.nodes.length > 0 && (
        <>
          <h4>
            Carga nodal global <span>{pattern.name}</span>
          </h4>
          <label className="stack-field">
            Operação de carga nodal
            <select
              aria-label="Operação de carga nodal"
              value={nodalOp}
              onChange={(e) => {
                setNodalOp(e.target.value as LoadOperation);
                setNotice("");
              }}
            >
              <option value="add">Somar</option>
              <option value="replace">Substituir</option>
              <option value="remove">Remover</option>
            </select>
          </label>
          {nodalOp === "remove" ? (
            <div className="batch-checks">
              {activeNodalKeys.map((key) => {
                const label = `${key[0] === "f" ? "Força" : "Momento"} ${key[1].toUpperCase()}`;
                const quantity = key[0] === "f" ? "force" : "moment";
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      aria-label={`Remover ${label}`}
                      checked={nodalRemove.has(key)}
                      onChange={(e) => {
                        setNodalRemove((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        });
                        setNotice("");
                      }}
                    />
                    <span>
                      Remover {label} (
                      {describeSummary(summary.nodal[key], quantity, units)})
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            activeNodalKeys.map((key) => {
              const label = `${key[0] === "f" ? "Força" : "Momento"} ${key[1].toUpperCase()}`;
              const quantity = key[0] === "f" ? "force" : "moment";
              const invalid = invalidNodal.has(key);
              const currentDesc = describeSummary(
                summary.nodal[key],
                quantity,
                units,
              );
              return (
                <label className="number-field" key={key}>
                  <span>
                    Lote {label}
                    <small style={{ position: "static", display: "block" }}>
                      {currentDesc}
                    </small>
                  </span>
                  <div>
                    <input
                      aria-label={`Lote ${label}`}
                      aria-invalid={invalid}
                      inputMode="decimal"
                      placeholder={
                        summary.nodal[key]?.kind === "mixed"
                          ? "Misto"
                          : "Manter"
                      }
                      value={nodalDraft[key] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodalDraft((prev) => ({ ...prev, [key]: val }));
                        setNotice("");
                      }}
                    />
                    <small>{units[quantity]}</small>
                  </div>
                  {invalid && <em>Informe um valor numérico finito.</em>}
                </label>
              );
            })
          )}
        </>
      )}

      <div className="batch-preview" aria-label="Prévia da atribuição em lote">
        <b>Prévia do lote ({pattern.name})</b>
        {hasFieldError ? (
          <p role="alert" className="launch-error">
            Corrija os campos destacados antes de aplicar o lote.
          </p>
        ) : !preview.ok ? (
          <p role="alert" className="launch-error">
            {preview.errors.join(" ")}
          </p>
        ) : preview.hasChanges ? (
          <>
            <span>
              Afeta {preview.affectedNodes} nós · {preview.affectedMembers}{" "}
              barras
            </span>
            <details>
              <summary>Objetos afetados</summary>
              {preview.nodeNames.length > 0 && (
                <p>Nós · {preview.nodeNames.join(", ")}</p>
              )}
              {preview.memberNames.length > 0 && (
                <p>Barras · {preview.memberNames.join(", ")}</p>
              )}
            </details>
            <ul>
              {preview.lines.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </>
        ) : (
          !notice && <span>Nenhuma alteração pendente no lote.</span>
        )}
        {hasLocalFrame && (
          <details>
            <summary>Referenciais dos nós selecionados</summary>
            <ul>
              {summary.nodes.map((n) => (
                <li key={n.id}>
                  {n.name} · {describeFrame(n.supportFrame)}
                </li>
              ))}
            </ul>
          </details>
        )}
        {notice && <span role="status">{notice}</span>}
      </div>

      <div className="batch-actions">
        <button type="button" onClick={resetDraft}>
          Cancelar
        </button>
        <button
          type="button"
          className="primary"
          disabled={hasFieldError || !preview.ok}
          onClick={apply}
        >
          Aplicar lote
        </button>
      </div>
    </section>
  );
}
