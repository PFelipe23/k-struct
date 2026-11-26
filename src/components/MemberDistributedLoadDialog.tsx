import { useEffect, useRef, useState } from "react";
import { coordinates, origin, type Point3 } from "../domain/geometry";
import {
  distributedLoadError,
  loadInterval,
  type DistributedLoad,
} from "../domain/memberDistributedLoads";
import { memberAxis } from "../domain/memberOffsets";
import { uid } from "../domain/model";
import { formatQuantity, formatUnitInput, parseUnitInput } from "../units";
import { useUnits } from "./Units";
import { relativeNumber, type MemberLoadDialogProps } from "./memberLoadInput";

export default function MemberDistributedLoadDialog({
  project,
  member,
  pattern,
  selection,
  edit,
  onClose,
}: MemberLoadDialogProps) {
  const { units } = useUnits(),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const original = pattern.distributed?.find((l) => l.id === selection.loadId);
  const span = memberAxis(
    member,
    project.nodes.find((n) => n.id === member.start)!,
    project.nodes.find((n) => n.id === member.end)!,
  ).span;
  const [measure, setMeasure] = useState<DistributedLoad["measure"]>(
    original?.measure ?? "distance",
  );
  const [system, setSystem] = useState<DistributedLoad["system"]>(
    original?.system ?? "global",
  );
  const positionText = (x: number, mode: DistributedLoad["measure"]) =>
    mode === "relative" ? String(x) : formatUnitInput(x, "length", units);
  const fields = ["start", "end"] as const,
    ends = ["qStart", "qEnd"] as const;
  const [positions, setPositions] = useState(() => ({
    start: positionText(
      original?.start ??
        (selection.fraction < 1 ? selection.fraction * span : 0),
      measure,
    ),
    end: positionText(original?.end ?? span, measure),
  }));
  const [values, setValues] = useState(() =>
    ends.map((end) =>
      coordinates.map((k) =>
        formatUnitInput(original?.[end][k] ?? 0, "distributedLoad", units),
      ),
    ),
  );
  const [failure, setFailure] = useState("");
  const active = coordinates.filter(
    (k) => project.mode === "spatial" || k !== "y",
  );
  const readPosition = (field: (typeof fields)[number]) =>
    measure === "relative"
      ? relativeNumber(positions[field])
      : parseUnitInput(
          positions[field],
          "length",
          units,
          original?.measure === measure ? original[field] : undefined,
        );
  const readVector = (side: number) => {
    const vector: Point3 = { ...origin };
    for (const k of active)
      vector[k] =
        parseUnitInput(
          values[side][coordinates.indexOf(k)],
          "distributedLoad",
          units,
          original?.[ends[side]][k],
        ) ?? NaN;
    return vector;
  };
  const load: DistributedLoad = {
    id: original?.id ?? "",
    memberId: member.id,
    measure,
    system,
    start: readPosition("start") ?? NaN,
    end: readPosition("end") ?? NaN,
    qStart: readVector(0),
    qEnd: readVector(1),
  };
  const error = distributedLoadError(load, span, project.mode);
  const save = (remove = false) => {
    if (!remove && error) return;
    const message = edit((draft) => {
      const pat = draft.loadPatterns.find((item) => item.id === pattern.id)!;
      if (remove)
        pat.distributed = pat.distributed!.filter((l) => l.id !== original!.id);
      else if (original)
        pat.distributed = pat.distributed!.map((l) =>
          l.id === original.id ? load : l,
        );
      else (pat.distributed ??= []).push({ ...load, id: uid() });
    });
    if (message) setFailure(message);
    else onClose();
  };
  const [a, b] = loadInterval(load, span);
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal point-load-dialog distributed-load-dialog"
      aria-labelledby="distributed-title"
      onCancel={onClose}
    >
      <h2 id="distributed-title">Carga por trecho · {member.name}</h2>
      <p>
        {pattern.name} · Comprimento do eixo de inserção{" "}
        {formatQuantity(span, "length", units)} {units.length}
      </p>
      <div className="selection-fields">
        <label className="stack-field">
          Posições a partir de i
          <select
            value={measure}
            onChange={(e) => {
              const next = e.target.value as DistributedLoad["measure"];
              const convert = (field: (typeof fields)[number]) => {
                const x = readPosition(field);
                return x === null
                  ? positions[field]
                  : positionText(
                      next === "relative" ? x / span : x * span,
                      next,
                    );
              };
              setPositions({ start: convert("start"), end: convert("end") });
              setMeasure(next);
            }}
          >
            <option value="distance">Distância</option>
            <option value="relative">Fração do comprimento (x/L)</option>
          </select>
        </label>
        <label className="stack-field">
          Referencial da carga
          <select
            value={system}
            onChange={(e) =>
              setSystem(e.target.value as DistributedLoad["system"])
            }
          >
            <option value="global">Global</option>
            <option value="local">Local da barra</option>
          </select>
        </label>
        {fields.map((field, i) => (
          <label className="stack-field" key={field}>
            {i ? "Fim" : "Início"} (
            {measure === "relative" ? "x/L" : units.length})
            <input
              value={positions[field]}
              onChange={(e) =>
                setPositions({ ...positions, [field]: e.target.value })
              }
            />
          </label>
        ))}
      </div>
      <div className="distributed-intensities">
        {ends.map((end, side) => (
          <fieldset key={end}>
            <legend>
              {side ? "Intensidade final" : "Intensidade inicial"} (
              {units.distributedLoad})
            </legend>
            {active.map((k) => {
              const index = coordinates.indexOf(k);
              return (
                <label className="stack-field" key={k}>
                  q{k.toUpperCase()} {side ? "final" : "inicial"}
                  <input
                    inputMode="decimal"
                    value={values[side][index]}
                    onChange={(e) =>
                      setValues(
                        values.map((row, i) =>
                          i !== side
                            ? row
                            : row.map((s, j) =>
                                j === index ? e.target.value : s,
                              ),
                        ),
                      )
                    }
                  />
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      {failure || error ? (
        <p role="alert" className="launch-error">
          {failure || error}
        </p>
      ) : (
        <p>
          Trecho carregado de {formatQuantity(a, "length", units)} a{" "}
          {formatQuantity(b, "length", units)} {units.length}. As intensidades
          variam linearmente entre as pontas.
        </p>
      )}
      <footer className="modal-actions">
        {original && <button onClick={() => save(true)}>Excluir carga</button>}
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={!!error} onClick={() => save()}>
          Aplicar carga
        </button>
      </footer>
    </dialog>
  );
}
