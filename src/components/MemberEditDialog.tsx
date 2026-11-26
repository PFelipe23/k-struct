import { pointLoadFrame } from "../domain/memberPointLoads";
import {
  globalIntensity,
  loadInterval,
} from "../domain/memberDistributedLoads";
import { distributedLoadLabel } from "./DistributedLoadGlyph";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  add,
  scale,
  origin,
  coordinates,
  distance,
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
import { formatResultQuantity } from "./resultFormatting";
import GeometryPreview, { drawing } from "./GeometryPreview";
import {
  parseUnitInput,
  type UnitPreferences,
  type UnitQuantity,
} from "../units";
import { useUnits } from "./Units";

const labels = {
  split: "Dividir",
  join: "Unir",
  trim: "Aparar",
  extend: "Prolongar",
};
const vector = (p: Point3, quantity: UnitQuantity, units: UnitPreferences) =>
  coordinates
    .map((k) => formatResultQuantity(p[k], quantity, units))
    .join(" / ");
function describe(p: Project, ids: string[]) {
  const nodes = new Map(p.nodes.map((n) => [n.id, n])),
    affected = new Set(ids);
  const rows = p.members
    .filter((m) => affected.has(m.id))
    .map((m) => {
      const a = nodes.get(m.start)!,
        b = nodes.get(m.end)!;
      const frame = pointLoadFrame(m, nodes, p.mode);
      return { m, a, b, frame, span: frame.span };
    });
  const ends = new Set(rows.flatMap(({ a, b }) => [a.id, b.id]));
  return { rows, draw: drawing(p, ends, affected) };
}
function EditPreview({ plan, plane }: { plan: MemberEdit; plane: PlaneKind }) {
  const { units } = useUnits();
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
            <th>Extensão ({units.length})</th>
          </tr>
        </thead>
        <tbody>
          {after.rows.map(({ m, a, b, span }) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>
                {a.name} → {b.name}
              </td>
              <td>{formatResultQuantity(span, "length", units)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.project.loadPatterns.map((pat, i) => {
        const rows = after.rows
          .map((row) => ({ ...row, q: memberIntensity(pat, row.m.id) }))
          .filter((row) => coordinates.some((k) => row.q[k] !== 0));
        const intervals = after.rows.flatMap(({ m, span }) =>
          (pat.distributed ?? [])
            .filter((l) => l.memberId === m.id)
            .map((l) => ({
              id: l.id,
              name: m.name,
              label: distributedLoadLabel(l, span, units),
            })),
        );
        if (!rows.length && !intervals.length) return null;
        const resultant = (spans: typeof before.rows, pattern: typeof pat) =>
          spans.reduce((total, { m, span, frame }) => {
            let sum = add(total, scale(memberIntensity(pattern, m.id), span));
            for (const load of pattern.distributed ?? []) {
              if (load.memberId !== m.id) continue;
              const [a, b] = loadInterval(load, span);
              sum = add(
                sum,
                globalIntensity(
                  scale(add(load.qStart, load.qEnd), (b - a) / 2),
                  load.system,
                  frame.axes,
                ),
              );
            }
            return sum;
          }, origin);
        return (
          <section key={pat.id}>
            <h3>{pat.name}</h3>
            {rows.length > 0 && (
              <table>
                <caption>Cargas uniformes após a edição</caption>
                <thead>
                  <tr>
                    <th>Barra</th>
                    <th>Extensão ({units.length})</th>
                    <th>qX / qY / qZ ({units.distributedLoad})</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ m, span, q }) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{formatResultQuantity(span, "length", units)}</td>
                      <td>{vector(q, "distributedLoad", units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {intervals.length > 0 && (
              <table>
                <caption>Cargas por trecho após a edição</caption>
                <thead>
                  <tr>
                    <th>Barra</th>
                    <th>Trecho e intensidades</th>
                  </tr>
                </thead>
                <tbody>
                  {intervals.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td>{l.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p>
              Resultante global em X / Y / Z ({units.force}) nas barras afetadas
              <br />
              {vector(
                resultant(before.rows, plan.source.loadPatterns[i]),
                "force",
                units,
              )}{" "}
              → {vector(resultant(after.rows, pat), "force", units)}
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
  const { units } = useUnits();
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
    const value = parseUnitInput(number, "length", units) ?? NaN;
    if (kind === "split" && refKind === "distance")
      return { kind, id, reference: { kind: "distance", metres: value } };
    const reference: GeometricReference =
      refKind === "node" || refKind === "member"
        ? { kind: refKind, id: refId }
        : { kind: "coordinate", axis, value };
    return { kind, id, end, reference };
  }, [kind, id, end, refKind, number, refId, axis, ids, units]);
  const preview = useMemo(() => {
    try {
      if (command.kind !== "join") {
        const ref = command.reference;
        if (
          (ref.kind === "distance" && !Number.isFinite(ref.metres)) ||
          (ref.kind === "coordinate" && !Number.isFinite(ref.value))
        )
          throw new Error(`Informe uma posição finita em ${units.length}.`);
      }
      return { plan: planMemberEdit(project, command) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [command, project, units]);
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
                  i = {a.name} ({vector(a, "length", units)}) {units.length}
                  <br />j = {b.name} ({vector(b, "length", units)}){" "}
                  {units.length}
                  <br />
                  Comprimento atual ·{" "}
                  {formatResultQuantity(distance(a, b), "length", units)}{" "}
                  {units.length}
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
                      ? `Distância desde i (${units.length})`
                      : `Coordenada ${axis.toUpperCase()} (${units.length})`}
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
