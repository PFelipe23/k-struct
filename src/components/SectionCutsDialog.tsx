import { useEffect, useMemo, useRef, useState } from "react";
import {
  coordinates,
  origin,
  subtract,
  length,
  scale,
  type Point3,
} from "../domain/geometry";
import { uid, type Project, type SectionCut } from "../domain/model";
import { cutGeometry } from "../domain/sectionCut";
import { evaluateCut } from "../solver/sectionCut";
import type { AnalysisResult } from "../solver/oofem";
import {
  formatQuantity,
  formatUnitInput,
  parseUnitInput,
  parseUnitNumber,
  type UnitPreferences,
} from "../units";
import { SectionCutPreview } from "./SectionCutPreview";
import { useUnits } from "./Units";

const groups = ["point", "normal", "datum"] as const;
function fresh(p: Project): SectionCut {
  const cut: SectionCut = {
    id: uid(),
    name: "",
    point: origin,
    datum: origin,
    normal: { ...origin, x: 1 },
    retained: "negative",
  };
  const names = new Set(p.sectionCuts?.map((c) => c.name));
  let i = 1;
  while (names.has("Corte " + i)) i++;
  cut.name = "Corte " + i;
  const vertices = cutGeometry(p, cut).objects.flatMap((o) =>
    o.outlines.flat(),
  );
  if (vertices.length) {
    const spans = coordinates.map((k) => {
      const v = vertices.map((p) => p[k]);
      return [Math.min(...v), Math.max(...v)];
    });
    const axis = spans.reduce(
      (best, s, i) =>
        s[1] - s[0] > spans[best][1] - spans[best][0] ? i : best,
      0,
    );
    cut.normal = { ...origin, [coordinates[axis]]: 1 };
    cut.point = Object.fromEntries(
      coordinates.map((k, i) => [k, (spans[i][0] + spans[i][1]) / 2]),
    ) as Point3;
    const beam = p.members.find((m) => m.id === p.slabJoint?.memberId);
    if (beam) {
      const a = p.nodes.find((n) => n.id === beam.start)!,
        b = p.nodes.find((n) => n.id === beam.end)!;
      const axis = subtract(b, a);
      if (length(axis) > 0) cut.normal = scale(axis, 1 / length(axis));
    }
    cut.datum = { ...cut.point };
  }
  return cut;
}
function asDraft(c: SectionCut, units: UnitPreferences) {
  const point = (v: Point3, normal: boolean) =>
    Object.fromEntries(
      coordinates.map((k) => [
        k,
        normal ? String(v[k]) : formatUnitInput(v[k], "length", units),
      ]),
    ) as Record<keyof Point3, string>;
  return {
    ...c,
    point: point(c.point, false),
    normal: point(c.normal, true),
    datum: point(c.datum, false),
  };
}
type Props = {
  project: Project;
  cases: ReadonlyMap<string, AnalysisResult>;
  initialSource: string;
  edit: (fn: (p: Project) => void) => string | null;
  close: () => void;
};
export function SectionCutsDialog({
  project: p,
  cases,
  initialSource,
  edit,
  close,
}: Props) {
  const { units } = useUnits(),
    ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() =>
    asDraft(p.sectionCuts?.[0] ?? fresh(p), units),
  );
  const [source, setSource] = useState(initialSource),
    [message, setMessage] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const load = (c: SectionCut) => {
    setDraft(asDraft(c, units));
    setMessage("");
  };
  const saved = p.sectionCuts?.find((c) => c.id === draft.id);
  const preview = useMemo(() => {
    try {
      const vec = (s: (typeof groups)[number]) =>
        Object.fromEntries(
          coordinates.map((k) => {
            const n =
              s === "normal"
                ? parseUnitNumber(draft[s][k])
                : parseUnitInput(draft[s][k], "length", units);
            if (n === null)
              throw new Error("Preencha as coordenadas com números finitos.");
            return [k, n];
          }),
        ) as Point3;
      const cut: SectionCut = {
        ...draft,
        name: draft.name.trim(),
        point: vec("point"),
        normal: vec("normal"),
        datum: vec("datum"),
      };
      return { cut, geometry: cutGeometry(p, cut) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [draft, p, units]);
  const output = useMemo(() => {
    if (!preview.cut || !preview.geometry) return {};
    try {
      const factors = p.resultCombinations.find(
        (c) => "combination:" + c.id === source,
      )?.factors ?? [{ caseId: source.slice(5), factor: 1 }];
      return {
        data: evaluateCut(p, preview.cut, factors, cases, preview.geometry),
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [p, cases, source, preview]);
  const save = () => {
    const cut = preview.cut;
    if (!cut || !cut.name) return;
    const error = edit((q) => {
      const cuts = (q.sectionCuts ??= []);
      const i = cuts.findIndex((c) => c.id === cut.id);
      if (i < 0) cuts.push(cut);
      else cuts[i] = cut;
    });
    setMessage(error ?? "Corte salvo no projeto.");
  };
  const remove = () => {
    const error = edit((q) => {
      q.sectionCuts = q.sectionCuts?.filter((c) => c.id !== draft.id);
      if (!q.sectionCuts?.length) delete q.sectionCuts;
    });
    if (error) setMessage(error);
    else
      load(
        p.sectionCuts?.find((c) => c.id !== draft.id) ??
          fresh({ ...p, sectionCuts: [] }),
      );
  };
  const names = {
    point: "Ponto do plano",
    normal: "Normal do plano",
    datum: "Ponto de redução O",
  };
  const values = (v: NonNullable<NonNullable<typeof output.data>["total"]>) => [
    ...coordinates.map((k) => formatQuantity(v.force[k], "force", units)),
    ...coordinates.map((k) => formatQuantity(v.moment[k], "moment", units)),
  ];
  const touched =
    preview.geometry?.objects.filter(
      (o) => o.hits.length || o.traces.length || o.notice,
    ) ?? [];
  return (
    <dialog
      ref={ref}
      className="slab-sizing-dialog load-panel-dialog section-cuts-dialog"
      aria-labelledby="section-cuts-title"
      onCancel={close}
    >
      <header>
        <h2 id="section-cuts-title">Cortes da estrutura</h2>
      </header>
      <div className="cut-tools">
        <label>
          Corte{" "}
          <select
            value={saved ? draft.id : ""}
            onChange={(e) =>
              load(p.sectionCuts!.find((c) => c.id === e.target.value)!)
            }
          >
            {!saved && <option value="">Novo corte</option>}
            {p.sectionCuts?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => load(fresh(p))}>Novo corte</button>
        {saved && <button onClick={remove}>Excluir corte</button>}
      </div>
      <div className="cut-layout">
        <section>
          <label className="stack-field">
            Nome do corte
            <input
              value={draft.name}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          {groups.map((key) => (
            <fieldset key={key}>
              <legend>
                {names[key]}
                {key !== "normal" && " (" + units.length + ")"}
              </legend>
              <div className="cut-coordinates">
                {coordinates.map((k) => (
                  <label key={k}>
                    {k.toUpperCase()}
                    <input
                      aria-label={names[key] + " " + k.toUpperCase()}
                      inputMode="decimal"
                      value={draft[key][k]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [key]: { ...draft[key], [k]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <label>
            Lado retido{" "}
            <select
              value={draft.retained}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  retained: e.target.value as SectionCut["retained"],
                })
              }
            >
              <option value="negative">Negativo (−n)</option>
              <option value="positive">Positivo (+n)</option>
            </select>
          </label>
        </section>
        <section>
          {preview.cut && preview.geometry && (
            <SectionCutPreview cut={preview.cut} geometry={preview.geometry} />
          )}
          {preview.error && <p role="alert">{preview.error}</p>}
          {preview.geometry && (
            <p>
              {touched.length
                ? touched
                    .map((o) => o.name + (o.notice ? " · " + o.notice : ""))
                    .join(" / ")
                : "Corte vazio."}
            </p>
          )}
          <small>
            A seta aponta para fora do lado retido. Nós e ações no plano
            pertencem ao corpo retido.
          </small>
        </section>
      </div>
      <label>
        Origem dos esforços{" "}
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {p.analysisCases.map((c) => (
            <option key={c.id} value={"case:" + c.id}>
              {c.name}
            </option>
          ))}
          {p.resultCombinations.map((c) => (
            <option key={c.id} value={"combination:" + c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {output.error && <p role="status">{output.error}</p>}
      {!!output.data?.rows.length && (
        <section>
          <table aria-label="Resultantes globais no ponto O">
            <caption>Eixos globais · momentos em O</caption>
            <thead>
              <tr>
                <th>Objeto</th>
                {["Fx", "Fy", "Fz", "Mx", "My", "Mz"].map((k, i) => (
                  <th key={k}>
                    {k} ({i < 3 ? units.force : units.moment})
                  </th>
                ))}
                <th>Recuperação</th>
              </tr>
            </thead>
            <tbody>
              {output.data.rows.map((row) => (
                <tr key={row.id + row.name}>
                  <th scope="row">{row.name}</th>
                  {row.value ? (
                    values(row.value).map((v, i) => <td key={i}>{v}</td>)
                  ) : (
                    <td colSpan={6}>Indisponível</td>
                  )}
                  <td>{row.note}</td>
                </tr>
              ))}
            </tbody>
            {output.data.total && (
              <tfoot>
                <tr>
                  <th>Total</th>
                  {values(output.data.total).map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          {!output.data.total && <p>Resultante total indisponível.</p>}
        </section>
      )}
      <footer>
        <span role="status">{message}</span>
        <button onClick={close}>Fechar</button>
        <button
          className="primary"
          disabled={!preview.cut?.name}
          onClick={save}
        >
          Salvar corte
        </button>
      </footer>
    </dialog>
  );
}
