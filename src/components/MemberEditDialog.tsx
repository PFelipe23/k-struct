import { useEffect, useMemo, useRef, useState } from "react";
import {
  coordinates,
  distance,
  scale,
  type Coordinate,
  type PlaneKind,
  type Point3,
} from "../domain/geometry";
import {
  memberIntensity,
  planMemberEdit,
  type MemberCommand,
  type GeometricReference,
  type MemberEdit,
} from "../domain/memberOperations";
import type { Project } from "../domain/model";
import { formatResult } from "./resultFormatting";
import { parseNumberInput } from "./numberInput";
import GeometryPreview, { drawing } from "./GeometryPreview";

const labels = {
  split: "Dividir",
  join: "Unir",
  trim: "Aparar",
  extend: "Prolongar",
};
const vector = (p: Point3) =>
  coordinates.map((k) => formatResult(p[k])).join(" / ");
function describe(p: Project, ids: string[]) {
  const nodes = new Map(p.nodes.map((n) => [n.id, n])),
    affected = new Set(ids);
  const rows = p.members
    .filter((m) => affected.has(m.id))
    .map((m) => {
      const a = nodes.get(m.start)!,
        b = nodes.get(m.end)!;
      return { m, a, b, span: distance(a, b) };
    });
  const ends = new Set(rows.flatMap(({ a, b }) => [a.id, b.id]));
  return { rows, draw: drawing(p, ends, affected) };
}
function EditPreview({ plan, plane }: { plan: MemberEdit; plane: PlaneKind }) {
  const before = describe(plan.source, plan.before),
    after = describe(plan.project, plan.after);
  return (
    <>
      <GeometryPreview
        plane={plane}
        mode={plan.project.mode}
        source={before.draw}
        target={after.draw}
      />
      <p>{plan.note}</p>
      <table>
        <caption>Geometria final</caption>
        <thead>
          <tr>
            <th>Barra</th>
            <th>i → j</th>
            <th>Extensão (m)</th>
          </tr>
        </thead>
        <tbody>
          {after.rows.map(({ m, a, b, span }) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>
                {a.name} → {b.name}
              </td>
              <td>{formatResult(span)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.project.loadPatterns.map((pat, i) => {
        const rows = after.rows
          .map((row) => ({ ...row, q: memberIntensity(pat, row.m.id) }))
          .filter((row) => coordinates.some((k) => row.q[k] !== 0));
        if (!rows.length) return null;
        const resultant = (spans: typeof before.rows, pattern: typeof pat) =>
          spans.reduce(
            (total, { m, span }) => {
              const q = memberIntensity(pattern, m.id);
              return {
                x: total.x + (q.x * span) / 1000,
                y: total.y + (q.y * span) / 1000,
                z: total.z + (q.z * span) / 1000,
              };
            },
            { x: 0, y: 0, z: 0 },
          );
        return (
          <section key={pat.id}>
            <h3>{pat.name}</h3>
            <table>
              <caption>Cargas uniformes após a edição</caption>
              <thead>
                <tr>
                  <th>Barra</th>
                  <th>Extensão (m)</th>
                  <th>qX / qY / qZ (kN/m)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ m, span, q }) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{formatResult(span)}</td>
                    <td>{vector(scale(q, 0.001))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Resultante global em X / Y / Z (kN) nas barras afetadas
              <br />
              {vector(
                resultant(before.rows, plan.source.loadPatterns[i]),
              )} → {vector(resultant(after.rows, pat))}
            </p>
          </section>
        );
      })}
    </>
  );
}
export default function MemberEditDialog({
  project,
  ids,
  plane,
  onClose,
  onApply,
}: {
  project: Project;
  ids: string[];
  plane: PlaneKind;
  onClose: () => void;
  onApply: (plan: MemberEdit) => string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const [kind, setKind] = useState<MemberCommand["kind"]>(
    ids.length > 1 ? "join" : "split",
  );
  const [id, setId] = useState(ids[0]),
    [end, setEnd] = useState<"start" | "end">("end");
  const [refKind, setRefKind] = useState<
    "distance" | GeometricReference["kind"]
  >("distance");
  const [number, setNumber] = useState(""),
    [axis, setAxis] = useState<Coordinate>("x");
  const [refId, setRefId] = useState(""),
    [error, setError] = useState("");
  const selected = project.members.filter((m) => ids.includes(m.id)),
    bar = selected.find((m) => m.id === id)!;
  const a = project.nodes.find((n) => n.id === bar.start)!,
    b = project.nodes.find((n) => n.id === bar.end)!;
  const command = useMemo((): MemberCommand => {
    if (kind === "join") return { kind, ids };
    const value = parseNumberInput(number);
    if (kind === "split" && refKind === "distance")
      return { kind, id, reference: { kind: "distance", metres: value } };
    const reference: GeometricReference =
      refKind === "node" || refKind === "member"
        ? { kind: refKind, id: refId }
        : { kind: "coordinate", axis, value };
    return { kind, id, end, reference };
  }, [kind, id, end, refKind, number, refId, axis, ids]);
  const preview = useMemo(() => {
    try {
      return { plan: planMemberEdit(project, command) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [command, project]);
  const empty =
    kind !== "join" &&
    (refKind === "node" || refKind === "member" ? !refId : !number.trim());
  const setOperation = (next: typeof kind) => {
    setKind(next);
    setRefKind(next === "split" ? "distance" : "coordinate");
    setNumber("");
    setRefId("");
    const dominant = coordinates.reduce(
      (best, k) =>
        Math.abs(a[k] - b[k]) > Math.abs(a[best] - b[best]) ? k : best,
      "x",
    );
    setAxis(dominant);
  };
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal transform-dialog member-edit"
      aria-labelledby="member-edit-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="member-edit-title">Editar barras físicas</h2>
      <form
        onChange={() => setError("")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!preview.plan) return;
          const message = onApply(preview.plan);
          if (message) setError(message);
          else onClose();
        }}
      >
        <div className="transform-layout">
          <div className="transform-inputs">
            <label>
              Operação
              <select
                value={kind}
                onChange={(e) => setOperation(e.target.value as typeof kind)}
              >
                {Object.entries(labels).map(([k, label]) => (
                  <option
                    key={k}
                    value={k}
                    disabled={k === "join" && ids.length < 2}
                  >
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {kind === "join" ? (
              <p>
                Cadeia selecionada · {selected.map((m) => m.name).join(", ")}
              </p>
            ) : (
              <>
                <label>
                  Barra a editar
                  <select
                    value={id}
                    onChange={(e) => {
                      setId(e.target.value);
                      setRefId("");
                    }}
                  >
                    {selected.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  i = {a.name} ({vector(a)}) m<br />j = {b.name} ({vector(b)}) m
                  <br />
                  Comprimento atual · {formatResult(distance(a, b))} m
                </p>
                {kind !== "split" && (
                  <label>
                    Extremidade
                    <select
                      value={end}
                      onChange={(e) => setEnd(e.target.value as typeof end)}
                    >
                      <option value="start">i · {a.name}</option>
                      <option value="end">j · {b.name}</option>
                    </select>
                  </label>
                )}
                <label>
                  Referência geométrica
                  <select
                    value={refKind}
                    onChange={(e) => {
                      setRefKind(e.target.value as typeof refKind);
                      setRefId("");
                      setNumber("");
                    }}
                  >
                    {kind === "split" && (
                      <option value="distance">Distância a partir de i</option>
                    )}
                    <option value="coordinate">Coordenada global</option>
                    <option value="node">Nó sobre a reta</option>
                    <option value="member">Interseção com outra barra</option>
                  </select>
                </label>
                {refKind === "coordinate" && (
                  <label>
                    Eixo global
                    <select
                      value={axis}
                      onChange={(e) => setAxis(e.target.value as Coordinate)}
                    >
                      {coordinates
                        .filter((k) => project.mode === "spatial" || k !== "y")
                        .map((k) => (
                          <option key={k} value={k}>
                            {k.toUpperCase()}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {refKind === "member" || refKind === "node" ? (
                  <label>
                    {refKind === "member"
                      ? "Barra de referência"
                      : "Nó de referência"}
                    <select
                      value={refId}
                      onChange={(e) => setRefId(e.target.value)}
                    >
                      <option value="">Escolha a referência</option>
                      {(refKind === "member"
                        ? project.members.filter((m) => m.id !== id)
                        : project.nodes
                      ).map((obj) => (
                        <option key={obj.id} value={obj.id}>
                          {obj.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    {refKind === "distance"
                      ? "Distância desde i (m)"
                      : `Coordenada ${axis.toUpperCase()} (m)`}
                    <input
                      inputMode="decimal"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                    />
                  </label>
                )}
              </>
            )}
          </div>
          <div className="transform-summary">
            {preview.plan ? (
              <EditPreview plan={preview.plan} plane={plane} />
            ) : (
              !empty && (
                <p role="alert" className="launch-error">
                  {preview.error}
                </p>
              )
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="launch-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={!preview.plan}>
            Aplicar edição
          </button>
        </div>
      </form>
    </dialog>
  );
}
