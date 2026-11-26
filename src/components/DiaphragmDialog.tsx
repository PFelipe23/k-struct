import { useEffect, useRef, useState } from "react";
import { onPlane } from "../domain/geometry";
import {
  nextName,
  uid,
  type Diaphragm,
  type Project,
  type SelectedObject,
} from "../domain/model";
import { formatQuantity, formatUnitInput, parseUnitInput } from "../units";
import { useUnits } from "./Units";

export default function DiaphragmDialog({
  project,
  levelId,
  selection,
  edit,
  onClose,
}: {
  project: Project;
  levelId: string;
  selection: SelectedObject[];
  edit: (change: (draft: Project) => void) => string | null;
  onClose: () => void;
}) {
  const { units } = useUnits(),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const level = project.guides.z.find((g) => g.id === levelId)!;
  const floors = (project.diaphragms ?? []).filter(
    (f) => f.levelId === levelId,
  );
  const nodes = project.nodes.filter((n) =>
    onPlane(n, { kind: "XY", offset: level.position }),
  );
  const selected = new Set(
    selection.filter((s) => s.kind === "node").map((s) => s.id),
  );
  const initial =
    floors.find((f) => f.nodeIds.some((id) => selected.has(id))) ?? floors[0];
  const [id, setId] = useState(initial?.id ?? "");
  const existing = floors.find((f) => f.id === id);
  const assigned = new Map(
    floors
      .filter((f) => f.id !== id)
      .flatMap((f) => f.nodeIds.map((n) => [n, f.name] as const)),
  );
  const [name, setName] = useState(initial?.name ?? nextName("D", floors));
  const [ids, setIds] = useState<string[]>(
    initial?.nodeIds ??
      nodes
        .filter((n) => selected.has(n.id) && !assigned.has(n.id))
        .map((n) => n.id),
  );
  const refText = (r: Diaphragm["reference"]) => ({
    x: formatUnitInput(r.x, "length", units),
    y: formatUnitInput(r.y, "length", units),
  });
  const [manual, setManual] = useState<{ x: string; y: string } | null>(
    initial ? refText(initial.reference) : null,
  );
  const participants = new Set(ids);
  const center = nodes
    .filter((n) => participants.has(n.id))
    .reduce(
      (sum, n) => ({
        x: sum.x + n.x / ids.length,
        y: sum.y + n.y / ids.length,
      }),
      { x: 0, y: 0 },
    );
  const xy = manual ?? refText(center);
  const [error, setError] = useState("");
  function choose(value: string) {
    const floor = floors.find((f) => f.id === value);
    setId(value);
    setName(floor?.name ?? nextName("D", floors));
    setIds(
      floor?.nodeIds ??
        nodes
          .filter(
            (n) =>
              selected.has(n.id) &&
              !floors.some((f) => f.nodeIds.includes(n.id)),
          )
          .map((n) => n.id),
    );
    setManual(floor ? refText(floor.reference) : null);
    setError("");
  }
  function save() {
    const x = parseUnitInput(xy.x, "length", units, existing?.reference.x),
      y = parseUnitInput(xy.y, "length", units, existing?.reference.y);
    if (!name.trim() || ids.length < 2 || x === null || y === null) {
      setError(
        "Informe um nome, pelo menos dois nós e coordenadas válidas para a referência.",
      );
      return;
    }
    const value: Diaphragm = {
      id: existing?.id ?? uid(),
      name: name.trim(),
      levelId,
      nodeIds: ids,
      reference: { x, y },
    };
    const problem = edit((p) => {
      const list = (p.diaphragms ??= []);
      if (existing) list[list.findIndex((f) => f.id === existing.id)] = value;
      else list.push(value);
    });
    if (problem) setError(problem);
    else onClose();
  }
  function remove() {
    const problem = edit((p) => {
      p.diaphragms = p.diaphragms?.filter((f) => f.id !== id);
      if (!p.diaphragms?.length) delete p.diaphragms;
    });
    if (problem) setError(problem);
    else onClose();
  }
  return (
    <dialog
      className="modal launch-modal diaphragm-dialog"
      ref={dialog}
      aria-labelledby="diaphragm-title"
      onCancel={onClose}
    >
      <h2 id="diaphragm-title">Diafragmas de pavimento</h2>
      <p>
        {level.name} · Z = {formatQuantity(level.position, "length", units)}{" "}
        {units.length}
      </p>
      <div className="selection-fields" onChange={() => setError("")}>
        <label>
          Diafragma
          <select value={id} onChange={(e) => choose(e.target.value)}>
            <option value="">Novo diafragma</option>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nome do diafragma
          <input
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      <fieldset>
        <legend>Nós participantes</legend>
        {nodes.length > 0 ? (
          <>
            <button
              onClick={() => {
                setIds(
                  nodes.filter((n) => !assigned.has(n.id)).map((n) => n.id),
                );
                setError("");
              }}
            >
              Selecionar disponíveis
            </button>
            <div className="diaphragm-nodes">
              {nodes.map((n) => (
                <label key={n.id}>
                  <input
                    type="checkbox"
                    checked={participants.has(n.id)}
                    disabled={assigned.has(n.id)}
                    onChange={(e) => {
                      setIds(
                        e.target.checked
                          ? [...ids, n.id]
                          : ids.filter((i) => i !== n.id),
                      );
                      setError("");
                    }}
                    aria-label={n.name}
                  />
                  <span>{n.name}</span>
                  <small>
                    {assigned.get(n.id) ??
                      `(${formatQuantity(n.x, "length", units)}, ${formatQuantity(n.y, "length", units)}) ${units.length}`}
                  </small>
                </label>
              ))}
            </div>
          </>
        ) : (
          <p>Lance pelo menos dois nós neste pavimento.</p>
        )}
      </fieldset>
      <fieldset>
        <legend>Ponto de referência em planta</legend>
        <div className="selection-fields">
          {(["x", "y"] as const).map((k) => (
            <label key={k}>
              {k.toUpperCase()} de referência ({units.length})
              <input
                inputMode="decimal"
                value={xy[k]}
                onChange={(e) => {
                  setManual({ ...xy, [k]: e.target.value });
                  setError("");
                }}
              />
            </label>
          ))}
        </div>
        <button
          disabled={!ids.length}
          onClick={() => {
            setManual(null);
            setError("");
          }}
        >
          Usar centro dos nós
        </button>
      </fieldset>
      <p>
        O piso compartilha UX, UY e RZ. UZ, RX e RY seguem as barras e os apoios
        de cada nó.
      </p>
      {error && (
        <p role="alert" className="launch-error">
          {error}
        </p>
      )}
      <footer className="modal-actions">
        {existing && <button onClick={remove}>Excluir diafragma</button>}
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" onClick={save}>
          Aplicar diafragma
        </button>
      </footer>
    </dialog>
  );
}
