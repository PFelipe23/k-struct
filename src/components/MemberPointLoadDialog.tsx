import { useEffect, useRef, useState } from "react";
import { coordinates, origin } from "../domain/geometry";
import {
  componentError,
  distanceFromI,
  pointFraction,
  positionError,
  type LoadPosition,
  type MemberPointLoad,
} from "../domain/memberPointLoads";
import { memberAxis } from "../domain/memberOffsets";
import { uid, type Member, type Project } from "../domain/model";
import {
  formatQuantity,
  formatUnitInput,
  formatUnitValue,
  parseUnitInput,
  parseUnitNumber,
} from "../units";
import { useUnits } from "./Units";

export type PointLoadSelection = {
  memberId: string;
  fraction: number;
  loadId?: string;
};

function relativeNumber(text: string) {
  const simple = parseUnitNumber(text);
  if (simple !== null) return simple;
  const match =
    /^\s*(L|[+-]?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*$/i.exec(text);
  if (!match) return null;
  const a = match[1].toUpperCase() === "L" ? 1 : parseUnitNumber(match[1]),
    b = parseUnitNumber(match[2]);
  return a !== null && b !== null && b !== 0 && Number.isFinite(a / b)
    ? a / b
    : null;
}

export default function MemberPointLoadDialog({
  project: p,
  member: m,
  pattern,
  selection,
  edit,
  onClose,
}: {
  project: Project;
  member: Member;
  pattern: Project["loadPatterns"][number];
  selection: PointLoadSelection;
  edit: (change: (p: Project) => void) => string | null | void;
  onClose: () => void;
}) {
  const { units } = useUnits();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const original = pattern.points?.find((l) => l.id === selection.loadId);
  const span = memberAxis(
    m,
    p.nodes.find((n) => n.id === m.start)!,
    p.nodes.find((n) => n.id === m.end)!,
  ).span;
  const initial = original?.position ?? {
    kind: "distance" as const,
    value: selection.fraction * span,
  };
  const [measure, setMeasure] = useState(initial.kind);
  const [text, setText] = useState(() =>
    initial.kind === "relative"
      ? String(initial.value)
      : formatUnitInput(initial.value, "length", units),
  );
  const [kind, setKind] = useState<MemberPointLoad["kind"]>(
    original?.kind ?? "force",
  );
  const [system, setSystem] = useState<MemberPointLoad["system"]>(
    original?.system ?? "global",
  );
  const [components, setComponents] = useState(() =>
    coordinates.map((k) =>
      formatUnitInput(
        original?.components[k] ?? 0,
        original?.kind ?? "force",
        units,
      ),
    ),
  );
  const [error, setError] = useState("");
  const value =
    measure === "relative"
      ? relativeNumber(text)
      : parseUnitInput(
          text,
          "length",
          units,
          original?.position.kind === "distance"
            ? original.position.value
            : undefined,
        );
  const position: LoadPosition = { kind: measure, value: value ?? NaN };
  const active = coordinates.filter(
    (k) => p.mode === "spatial" || (kind === "force" ? k !== "y" : k === "y"),
  );
  const vector = { ...origin };
  for (const k of active)
    vector[k] =
      parseUnitInput(
        components[coordinates.indexOf(k)],
        kind,
        units,
        original?.kind === kind ? original.components[k] : undefined,
      ) ?? NaN;
  const locationError = positionError(position, span);
  const problem =
    locationError ?? componentError({ kind, components: vector }, p.mode);
  const save = () => {
    if (problem) return;
    const load: MemberPointLoad = {
      id: original?.id ?? uid(),
      memberId: m.id,
      position,
      kind,
      system,
      components: vector,
    };
    const message = edit((draft) => {
      const pat = draft.loadPatterns.find((item) => item.id === pattern.id)!;
      if (original)
        pat.points = pat.points!.map((l) => (l.id === original.id ? load : l));
      else (pat.points ??= []).push(load);
    });
    if (message) setError(message);
    else onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal point-load-dialog"
      aria-labelledby="point-load-title"
      onCancel={onClose}
    >
      <h2 id="point-load-title">Carga concentrada · {m.name}</h2>
      <p>
        {pattern.name} · Comprimento do eixo de inserção{" "}
        {formatUnitInput(span, "length", units)} {units.length}
      </p>
      <div className="selection-fields">
        <label className="stack-field">
          Posição a partir de i
          <select
            value={measure}
            onChange={(e) => {
              const next = e.target.value as LoadPosition["kind"];
              if (value !== null && !locationError)
                setText(
                  next === "relative"
                    ? String(pointFraction(position, span))
                    : formatUnitInput(
                        distanceFromI(position, span),
                        "length",
                        units,
                      ),
                );
              setMeasure(next);
            }}
          >
            <option value="distance">Distância</option>
            <option value="relative">Fração do comprimento (x/L)</option>
          </select>
        </label>
        <label className="stack-field">
          {measure === "relative"
            ? "Fração x/L"
            : `Distância x (${units.length})`}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={measure === "relative" ? "1/3" : "0"}
          />
        </label>
        <label className="stack-field">
          Tipo de ação
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as MemberPointLoad["kind"]);
              setComponents(["0", "0", "0"]);
            }}
          >
            <option value="force">Força</option>
            <option value="moment">Momento</option>
          </select>
        </label>
        <label className="stack-field">
          Referencial da carga
          <select
            value={system}
            onChange={(e) =>
              setSystem(e.target.value as MemberPointLoad["system"])
            }
          >
            <option value="global">Global</option>
            <option value="local">Local da barra</option>
          </select>
        </label>
      </div>
      <div className="point-load-components">
        {active.map((k) => {
          const index = coordinates.indexOf(k);
          return (
            <label className="stack-field" key={k}>
              {kind === "force" ? "F" : "M"}
              {k.toUpperCase()} {system} ({units[kind]})
              <input
                inputMode="decimal"
                value={components[index]}
                onChange={(e) =>
                  setComponents(
                    components.map((s, i) =>
                      i === index ? e.target.value : s,
                    ),
                  )
                }
              />
            </label>
          );
        })}
      </div>
      {!locationError && (
        <p>
          Estação x ={" "}
          {formatQuantity(distanceFromI(position, span), "length", units)}{" "}
          {units.length} · x/L ={" "}
          {formatUnitValue(pointFraction(position, span))}
        </p>
      )}
      {(error || problem) && (
        <p
          className={error || locationError ? "launch-error" : undefined}
          role={error || locationError ? "alert" : "status"}
        >
          {error || problem}
        </p>
      )}
      <footer className="modal-actions">
        {original && (
          <button
            onClick={() => {
              const message = edit((d) => {
                const pat = d.loadPatterns.find(
                  (item) => item.id === pattern.id,
                )!;
                pat.points = pat.points!.filter((l) => l.id !== original.id);
              });
              if (message) setError(message);
              else onClose();
            }}
          >
            Excluir carga
          </button>
        )}
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={!!problem} onClick={save}>
          Aplicar carga
        </button>
      </footer>
    </dialog>
  );
}
