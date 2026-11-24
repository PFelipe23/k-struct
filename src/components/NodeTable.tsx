import { useEffect, useRef, useState, type FormEvent } from "react";
import { coordinates, type Coordinate, type Point3 } from "../domain/geometry";
import type { Project } from "../domain/model";
import { parseNumberInput } from "./numberInput";

export default function NodeTable({
  project,
  onApply,
  onClose,
}: {
  project: Project;
  onApply: (changes: ReadonlyMap<string, Partial<Point3>>) => string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(
    () => new Map<string, Partial<Record<Coordinate, string>>>(),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState("");
  const axes = project.mode === "spatial" ? coordinates : (["x", "z"] as const);
  const rows = project.nodes.map((node) => ({
    node,
    cells: axes.map((axis) => {
      const text = draft.get(node.id)?.[axis] ?? String(node[axis]);
      const value = parseNumberInput(text);
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

  return (
    <dialog
      ref={dialog}
      className="modal launch-modal node-editor"
      aria-labelledby="node-table-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="node-table-title">Tabela de nós</h2>
      <form onSubmit={apply}>
        {rows.length ? (
          <div className="node-table-scroll">
            <table aria-label="Coordenadas dos nós">
              <thead>
                <tr>
                  <th scope="col">Nó</th>
                  {axes.map((axis) => (
                    <th scope="col" key={axis}>
                      {axis.toUpperCase()} (m)
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
    </dialog>
  );
}
