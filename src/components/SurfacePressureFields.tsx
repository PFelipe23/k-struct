import { useEffect, useRef, useState } from "react";
import type { PressureDirection, PressureDistribution } from "../domain/model";
import {
  directionNames,
  elevationPressure,
  pressureSpecError,
  type PressureSpec,
  type PressureVertex,
} from "../domain/surfacePressure";
import {
  formatUnitInput,
  parseUnitInput,
  parseUnitNumber,
  type UnitPreferences,
} from "../units";
import { useUnits } from "./Units";

type Props = {
  spec?: PressureSpec;
  uniform: number;
  vertices: PressureVertex[];
  horizontal?: boolean;
};
export function SurfacePressureFields({
  spec,
  uniform,
  vertices,
  horizontal = false,
}: Props) {
  const { units } = useUnits();
  const old = spec?.distribution;
  const [mode, setMode] = useState<"uniform" | PressureDistribution["mode"]>(
    old?.mode ?? "uniform",
  );
  const [direction, setDirection] = useState<PressureDirection>(
    spec?.direction ?? "normal",
  );
  const [lo, hi] = [
    Math.min(...vertices.map((v) => v.point.z)),
    Math.max(...vertices.map((v) => v.point.z)),
  ];
  const number = (
    name: string,
    label: string,
    value: number,
    isLength = false,
  ) => (
    <label key={name} className="stack-field">
      {label}
      <input
        name={name}
        inputMode="decimal"
        required
        defaultValue={
          isLength
            ? formatUnitInput(value, "length", units)
            : String(value / 1000)
        }
      />
    </label>
  );
  return (
    <fieldset>
      <legend>Carga superficial</legend>
      <div className="panel-columns">
        <label className="stack-field">
          Direção da carga
          <select
            name="areaDirection"
            value={direction}
            onChange={(e) => setDirection(e.target.value as PressureDirection)}
          >
            {(Object.keys(directionNames) as PressureDirection[])
              .filter((k) => !horizontal || k === "normal" || k === "Z")
              .map((k) => (
                <option key={k} value={k}>
                  {directionNames[k]}
                </option>
              ))}
          </select>
        </label>
        <label className="stack-field">
          Distribuição da carga
          <select
            name="areaMode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="uniform">Uniforme</option>
            <option value="elevation">Por cota Z</option>
            <option value="vertices">Por vértice</option>
          </select>
        </label>
      </div>
      <p>
        Intensidade por m² da superfície real. O sinal positivo acompanha a
        direção escolhida.
      </p>
      {mode === "uniform" &&
        number(
          "areaUniform",
          direction === "normal"
            ? "Pressão no sentido +3 (kN/m²)"
            : "Intensidade uniforme (kN/m²)",
          uniform,
        )}
      {mode === "elevation" && (
        <>
          <div className="panel-columns">
            {number(
              "areaZ0",
              `Cota Z inferior (${units.length})`,
              old?.mode === "elevation" ? old.z0 : lo,
              true,
            )}
            {number(
              "areaP0",
              "Pressão na cota inferior (kN/m²)",
              old?.mode === "elevation" ? old.p0 : uniform,
            )}
            {number(
              "areaZ1",
              `Cota Z superior (${units.length})`,
              old?.mode === "elevation" ? old.z1 : hi > lo ? hi : lo + 1,
              true,
            )}
            {number(
              "areaP1",
              "Pressão na cota superior (kN/m²)",
              old?.mode === "elevation" ? old.p1 : 0,
            )}
          </div>
          <p>
            A intensidade varia linearmente entre as cotas globais Z. Abaixo e
            acima delas vale a intensidade da respectiva extremidade.
          </p>
        </>
      )}
      {mode === "vertices" && (
        <>
          <div className="panel-columns">
            {vertices.map((v) =>
              number(
                "areaV-" + v.id,
                `${v.label} (kN/m²)`,
                old?.mode === "vertices"
                  ? (old.values[v.id] ?? 0)
                  : old?.mode === "elevation"
                    ? elevationPressure(old, v.point.z)
                    : uniform,
              ),
            )}
          </div>
          <p>
            {vertices[0]?.label === "A"
              ? "Interpolação bilinear nos quatro cantos A, B, C e D."
              : "Interpolação linear nos triângulos do contorno, descontadas as aberturas."}
          </p>
        </>
      )}
    </fieldset>
  );
}
export function readPressureForm(
  data: FormData,
  units: UnitPreferences,
  vertices: PressureVertex[],
) {
  const field = (name: string, isLength = false) => {
    const text = String(data.get(name) ?? "");
    const n = isLength
      ? parseUnitInput(text, "length", units)
      : parseUnitNumber(text);
    if (n === null || !Number.isFinite(isLength ? n : 1000 * n))
      throw new Error("Informe cotas e pressões numéricas finitas.");
    return isLength ? n : 1000 * n;
  };
  const dir = data.get("areaDirection") as PressureDirection;
  const spec: PressureSpec = dir === "normal" ? {} : { direction: dir };
  const mode = data.get("areaMode");
  let uniform = 0;
  if (mode === "uniform") uniform = field("areaUniform");
  else if (mode === "elevation")
    spec.distribution = {
      mode,
      z0: field("areaZ0", true),
      z1: field("areaZ1", true),
      p0: field("areaP0"),
      p1: field("areaP1"),
    };
  else if (mode === "vertices")
    spec.distribution = {
      mode,
      values: Object.fromEntries(
        vertices.map((v) => [v.id, field("areaV-" + v.id)]),
      ),
    };
  else throw new Error("Escolha a distribuição da carga.");
  const error = pressureSpecError(
    spec,
    uniform,
    vertices.map((v) => v.id),
  );
  if (error) throw new Error(error);
  return { spec, uniform };
}
export function SlabPressureDialog({
  close,
  apply,
  ...props
}: Props & {
  close: () => void;
  apply: (uniform: number, spec: PressureSpec) => void;
}) {
  const { units } = useUnits(),
    ref = useRef<HTMLDialogElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Carga superficial da laje"
      className="slab-sizing-dialog spatial-panel-dialog"
      onCancel={close}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const { spec, uniform } = readPressureForm(
              new FormData(e.currentTarget),
              units,
              props.vertices,
            );
            apply(uniform, spec);
            close();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h2>Carga superficial da laje</h2>
        <SurfacePressureFields {...props} horizontal />
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="primary">
            Aplicar carga superficial
          </button>
        </footer>
      </form>
    </dialog>
  );
}
