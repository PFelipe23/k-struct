import { useEffect, useMemo, useRef, useState } from "react";
import {
  coordinates,
  type Coordinate,
  origin,
  type PlaneKind,
  type Point3,
} from "../domain/geometry";
import type { Project, SelectedObject } from "../domain/model";
import {
  geometryOnly,
  planTransform,
  type CopyOptions,
  type TransformPlan,
} from "../domain/transform";
import type { Transform } from "../domain/transformGeometry";
import { parseNumberInput } from "./numberInput";
import TransformPreview from "./TransformPreview";

type Fields = Record<Coordinate, string>;
const fields = (v: Point3): Fields => ({
  x: String(v.x),
  y: String(v.y),
  z: String(v.z),
});
const values = (f: Fields): Point3 => ({
  x: parseNumberInput(f.x),
  y: parseNumberInput(f.y),
  z: parseNumberInput(f.z),
});
function VectorFields({
  name,
  value,
  onChange,
  planar,
  metres = false,
}: {
  name: string;
  value: Fields;
  onChange: (v: Fields) => void;
  planar: boolean;
  metres?: boolean;
}) {
  return (
    <div className="replica-fields">
      {coordinates
        .filter((k) => !(planar && k === "y"))
        .map((k) => (
          <label key={k}>
            {name}
            {k.toUpperCase()}
            {metres ? " (m)" : ""}
            <input
              inputMode="decimal"
              value={value[k]}
              onChange={(e) => onChange({ ...value, [k]: e.target.value })}
            />
          </label>
        ))}
    </div>
  );
}
const count = (n: number, singular: string, plural: string) =>
  `${n} ${n === 1 ? singular : plural}`;
const axisVector = (key: string): Point3 => ({ ...origin, [key]: 1 });

export default function TransformDialog({
  project,
  selection,
  plane,
  initial,
  onApply,
  onClose,
}: {
  project: Project;
  selection: SelectedObject[];
  plane: PlaneKind;
  initial: Point3;
  onApply: (plan: TransformPlan) => string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const planar = project.mode === "planar";
  const [kind, setKind] = useState<Transform["kind"]>("translate");
  const [offset, setOffset] = useState(fields(initial)),
    [center, setCenter] = useState(fields(origin));
  const [axis, setAxis] = useState(planar ? "y" : "z"),
    [normal, setNormal] = useState("x");
  const [direction, setDirection] = useState(fields({ x: 1, y: 0, z: 1 }));
  const [degrees, setDegrees] = useState("90"),
    [copies, setCopies] = useState("1");
  const [supports, setSupports] = useState(false),
    [patterns, setPatterns] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<CopyOptions["conflicts"]>("ask");
  const [submitError, setSubmitError] = useState("");
  function resetDecision() {
    setConflicts("ask");
    setSubmitError("");
  }
  const preview = useMemo(() => {
    const c = values(center),
      d = values(direction),
      n = parseNumberInput(copies);
    let spec: Transform;
    switch (kind) {
      case "move":
        spec = { kind, offset: values(offset) };
        break;
      case "translate":
        spec = { kind, offset: values(offset), copies: n };
        break;
      case "rotate":
        spec = {
          kind,
          center: c,
          axis: axis === "custom" ? d : axisVector(axis),
          degrees: parseNumberInput(degrees),
          copies: n,
        };
        break;
      case "mirror":
        spec = {
          kind,
          center: c,
          normal:
            normal !== "custom"
              ? axisVector(normal)
              : planar
                ? { x: d.z, y: 0, z: -d.x }
                : d,
        };
        break;
    }
    try {
      return {
        spec,
        plan: planTransform(
          project,
          selection,
          spec,
          kind === "move" ? geometryOnly : { supports, patterns, conflicts },
        ),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [
    project,
    selection,
    kind,
    offset,
    center,
    direction,
    copies,
    axis,
    degrees,
    normal,
    planar,
    supports,
    patterns,
    conflicts,
  ]);
  const plan = preview.plan;
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal transform-dialog"
      aria-labelledby="transform-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="transform-title">
        {kind === "translate"
          ? "Replicar seleção"
          : kind === "move"
            ? "Mover seleção"
            : kind === "mirror"
              ? "Espelhar seleção"
              : "Replicar por rotação"}
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!plan?.ready) return;
          const message = onApply(plan);
          if (message) setSubmitError(message);
          else onClose();
        }}
      >
        <div className="transform-layout">
          <div className="transform-inputs" onChangeCapture={resetDecision}>
            <label>
              Operação
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Transform["kind"])}
              >
                <option value="translate">Copiar por translação</option>
                <option value="move">Mover por vetor</option>
                <option value="mirror">Espelhar e copiar</option>
                <option value="rotate">Copiar por rotação</option>
              </select>
            </label>
            {kind === "translate" || kind === "move" ? (
              <VectorFields
                name="Δ"
                value={offset}
                onChange={setOffset}
                planar={planar}
                metres
              />
            ) : (
              <>
                <VectorFields
                  name={kind === "rotate" ? "Centro " : "Ponto do espelho "}
                  value={center}
                  onChange={setCenter}
                  planar={planar}
                  metres
                />
                {kind === "rotate" ? (
                  <>
                    <label>
                      Eixo de rotação
                      <select
                        value={axis}
                        onChange={(e) => setAxis(e.target.value)}
                      >
                        {(planar ? ["y"] : ["x", "y", "z", "custom"]).map(
                          (k) => (
                            <option value={k} key={k}>
                              {k === "custom"
                                ? "Direção definida"
                                : k.toUpperCase()}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    {axis === "custom" && (
                      <VectorFields
                        name="Direção "
                        value={direction}
                        onChange={setDirection}
                        planar={false}
                      />
                    )}
                    <label>
                      Passo angular (°)
                      <input
                        inputMode="decimal"
                        value={degrees}
                        onChange={(e) => setDegrees(e.target.value)}
                      />
                    </label>
                    <p>
                      Ângulo positivo pela regra da mão direita em torno do eixo
                      escolhido.
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      {planar ? "Reta de simetria" : "Plano de simetria"}
                      <select
                        value={normal}
                        onChange={(e) => setNormal(e.target.value)}
                      >
                        <option value="x">
                          {planar ? "Paralela a Z" : "Paralelo a YZ"}
                        </option>
                        {!planar && <option value="y">Paralelo a XZ</option>}
                        <option value="z">
                          {planar ? "Paralela a X" : "Paralelo a XY"}
                        </option>
                        <option value="custom">
                          {planar ? "Direção da reta" : "Normal do plano"}
                        </option>
                      </select>
                    </label>
                    {normal === "custom" && (
                      <VectorFields
                        name={planar ? "Direção " : "Normal "}
                        value={direction}
                        onChange={setDirection}
                        planar={planar}
                      />
                    )}
                  </>
                )}
              </>
            )}
            {(kind === "translate" || kind === "rotate") && (
              <label>
                Cópias
                <input
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  value={copies}
                  onChange={(e) => setCopies(e.target.value)}
                />
              </label>
            )}
            {kind !== "move" && (
              <fieldset>
                <legend>Propriedades das cópias</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={supports}
                    onChange={(e) => setSupports(e.target.checked)}
                  />
                  Copiar apoios
                </label>
                {project.loadPatterns.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={patterns.includes(p.id)}
                      onChange={(e) =>
                        setPatterns(
                          e.target.checked
                            ? [...patterns, p.id]
                            : patterns.filter((id) => id !== p.id),
                        )
                      }
                    />
                    Copiar cargas · {p.name}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          <div className="transform-summary">
            {plan && (
              <>
                <TransformPreview
                  plan={plan}
                  plane={plane}
                  spec={preview.spec!}
                />
                <p>
                  {kind === "move"
                    ? `${count(plan.maps[0].nodes.size, "nó movido", "nós movidos")} · ${count(plan.affected.length, "barra incidente", "barras incidentes")}`
                    : `${count(plan.project.nodes.length - project.nodes.length, "novo nó", "novos nós")} · ${count(plan.reused.size, "nó reutilizado", "nós reutilizados")} · ${count(plan.project.members.length - project.members.length, "nova barra", "novas barras")}`}
                </p>
                {kind !== "move" && (
                  <p>
                    {count(plan.restraints, "apoio copiado", "apoios copiados")}{" "}
                    · {count(plan.loads, "carga copiada", "cargas copiadas")}
                  </p>
                )}
              </>
            )}
            {(Boolean(plan?.conflicts.length) || conflicts !== "ask") && (
              <fieldset>
                <legend>
                  Conflitos no destino
                  {plan ? ` (${plan.conflicts.length})` : ""}
                </legend>
                <ul>
                  {plan?.conflicts.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
                <label>
                  Para os conflitos listados
                  <select
                    value={conflicts}
                    onChange={(e) =>
                      setConflicts(e.target.value as CopyOptions["conflicts"])
                    }
                  >
                    <option value="ask">Escolha como resolver</option>
                    <option value="keep">Conservar os dados existentes</option>
                    <option value="combine">
                      Unir vínculos e somar cargas no padrão
                    </option>
                  </select>
                </label>
              </fieldset>
            )}
            {preview.error && (
              <p className="launch-error" role="alert">
                {preview.error}
              </p>
            )}
          </div>
        </div>
        <p>
          {kind === "move"
            ? "Vetor em coordenadas globais. Os IDs, os apoios e as cargas acompanham os nós."
            : "Referencial global. Forças e cargas distribuídas acompanham a geometria. No espelho, momentos recebem também a inversão de sinal de um vetor axial. A seção mantém os eixos locais em mão direita."}
        </p>
        {submitError && (
          <p className="launch-error" role="alert">
            {submitError}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={!plan?.ready}>
            {kind === "move" ? "Confirmar movimento" : "Criar cópias"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
