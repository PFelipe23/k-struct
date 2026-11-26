import { useEffect, useMemo, useRef, useState } from "react";
import { memberAxis } from "../domain/memberOffsets";
import { distributedLoadLabel } from "./DistributedLoadGlyph";
import { distance } from "../domain/geometry";
import {
  nearNodes,
  stagedMembers,
  pairKey,
  type Pair,
  type Merge,
} from "../domain/duplicateGeometry";
import {
  named,
  noRepairs,
  planRepair,
  supportText,
  type Decisions,
} from "../domain/duplicateRepair";
import type {
  NodalLoad,
  Project,
  SelectedObject,
  UniformLoad,
} from "../domain/model";
import GeometryPreview, { drawing } from "./GeometryPreview";
import {
  formatQuantity,
  formatUnitInput,
  parseUnitInput,
  type UnitPreferences,
} from "../units";
import { useUnits } from "./Units";

type Focus = { kind: "node" | "member"; ids: string[] };
type Props = {
  project: Project;
  onClose: () => void;
  onHighlight: (objects: SelectedObject[]) => void;
  onApply: (source: Project, next: Project) => string | null;
};
const number = (n: number) =>
  n.toLocaleString("pt-BR", { maximumSignificantDigits: 9 });
function attempt<T>(
  fn: () => T,
): { value: T; error?: never } | { error: string; value?: never } {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
function PairList<T extends Pair>({
  title,
  pairs,
  label,
  chosen,
  onSelect,
  focus,
}: {
  title: string;
  pairs: T[];
  label: (pair: T) => string;
  chosen: Merge[];
  onSelect: (pair: T) => void;
  focus: string;
}) {
  const [requested, setPage] = useState(0),
    size = 12,
    pages = Math.ceil(pairs.length / size),
    page = Math.max(0, Math.min(requested, pages - 1));
  const marked = new Set(chosen.map((m) => pairKey(m.drop, m.keep)));
  return (
    <section className="duplicate-list">
      <h3>
        {title} ({pairs.length})
      </h3>
      {!pairs.length && <p>Nenhum par encontrado.</p>}
      {pairs.slice(page * size, (page + 1) * size).map((pair) => {
        const key = pairKey(pair.a, pair.b);
        return (
          <button
            type="button"
            key={key}
            onClick={() => onSelect(pair)}
            aria-pressed={key === focus}
          >
            {label(pair)}
            {marked.has(key) ? " · união marcada" : ""}
          </button>
        );
      })}
      {pages > 1 && (
        <div className="duplicate-pages">
          <button
            type="button"
            onClick={() => setPage(page - 1)}
            disabled={!page}
          >
            Anterior
          </button>
          <span>
            {page + 1} / {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage(page + 1)}
            disabled={page >= pages - 1}
          >
            Próxima
          </button>
        </div>
      )}
    </section>
  );
}
function displayLoad(row: NodalLoad | UniformLoad, units: UnitPreferences) {
  if ("nodeId" in row) {
    const forces = [row.fx, row.fy, row.fz].map((value) =>
      formatQuantity(value, "force", units),
    );
    const moments = [row.mx, row.my, row.mz].map((value) =>
      formatQuantity(value, "moment", units),
    );
    return `F (${units.force}) = [${forces.join(", ")}], M (${units.moment}) = [${moments.join(", ")}]`;
  }
  const values = [row.qx, row.qy, row.qz].map((value) =>
    formatQuantity(value, "distributedLoad", units),
  );
  return `q (${units.distributedLoad}) = [${values.join(", ")}]`;
}

function objectDetails(p: Project, focus: Focus, units: UnitPreferences) {
  const details: string[] = [];
  for (const id of focus.ids) {
    if (focus.kind === "node") {
      const n = p.nodes.find((n) => n.id === id)!;
      const bars = p.members.filter((m) => m.start === id || m.end === id);
      details.push(
        `${named(n)} · XYZ (${[n.x, n.y, n.z].map((value) => formatQuantity(value, "length", units)).join(" / ")}) ${units.length} · apoio ${supportText(n)} · barras: ${bars.map(named).join(", ") || "nenhuma"}`,
      );
    } else {
      const m = p.members.find((m) => m.id === id)!,
        s = p.sections.find((s) => s.id === m.sectionId)!;
      details.push(
        `${named(m)} · i → j: ${m.start} → ${m.end} · seção ${named(s)} · rotação ${number(m.roll)}°`,
      );
    }
    for (const pat of p.loadPatterns) {
      if (focus.kind === "member" && pat.distributed?.length) {
        const m = p.members.find((m) => m.id === id)!,
          span = memberAxis(
            m,
            p.nodes.find((n) => n.id === m.start)!,
            p.nodes.find((n) => n.id === m.end)!,
          ).span;
        for (const load of pat.distributed)
          if (load.memberId === id)
            details.push(
              `${id} · ${named(pat)} · ${distributedLoadLabel(load, span, units)}`,
            );
      }
      const loads =
        focus.kind === "node"
          ? pat.nodal.filter((l) => l.nodeId === id)
          : pat.uniform.filter((l) => l.memberId === id);
      details.push(
        ...loads.map((l) => `${id} · ${named(pat)} · ${displayLoad(l, units)}`),
      );
    }
    for (const group of p.selectionGroups)
      if (group.objects.some((o) => o.id === id && o.kind === focus.kind))
        details.push(`${id} · grupo ${named(group)}`);
  }
  if (focus.kind === "member" && focus.ids.length === 2) {
    const bars = focus.ids.map((id) => p.members.find((m) => m.id === id)!);
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const [a, b] = bars.map((m) => [byId.get(m.start)!, byId.get(m.end)!]);
    const gap = Math.min(
      Math.max(distance(a[0], b[0]), distance(a[1], b[1])),
      Math.max(distance(a[0], b[1]), distance(a[1], b[0])),
    );
    details.push(
      `Maior distância entre extremidades correspondentes no modelo original: ${formatQuantity(gap, "length", units)} ${units.length}.`,
    );
  }
  return details;
}
function PairPreview({ project, focus }: { project: Project; focus: Focus }) {
  const layers = focus.ids.map((id) => {
    const m =
      focus.kind === "member"
        ? project.members.find((m) => m.id === id)
        : undefined;
    return drawing(
      project,
      new Set(m ? [m.start, m.end] : [id]),
      new Set(m ? [id] : []),
    );
  });
  return (
    <details>
      <summary>Enquadrar o par na prévia</summary>
      <GeometryPreview
        source={layers[0]}
        target={layers[1]}
        mode={project.mode}
        plane={project.mode === "spatial" ? "XYZ" : "XZ"}
        labels={[focus.ids[0], focus.ids[1]]}
      />
    </details>
  );
}
export default function DuplicateDialog({
  project,
  onClose,
  onApply,
  onHighlight,
}: Props) {
  const { units } = useUnits();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const [tol, setTol] = useState(() => formatUnitInput(0.001, "length", units)),
    [choices, setChoices] = useState<Decisions>(noRepairs);
  const [focus, setFocus] = useState<Focus | null>(null),
    [submitError, setSubmitError] = useState("");
  const limit = parseUnitInput(tol, "length", units, 0.001) ?? NaN;
  const scan = useMemo(
    () => attempt(() => nearNodes(project, limit)),
    [project, limit],
  );
  const geometry = useMemo(
    () => attempt(() => stagedMembers(project, limit, choices.nodes)),
    [project, limit, choices.nodes],
  );
  const stage = geometry.value;
  const preview = useMemo(
    () =>
      stage
        ? attempt(() =>
            planRepair(stage, choices, (row) => displayLoad(row, units)),
          )
        : undefined,
    [stage, choices, units],
  );
  const plan = preview?.value;
  const byNode = useMemo(
    () => new Map(project.nodes.map((n) => [n.id, n])),
    [project],
  );
  const byMember = useMemo(
    () => new Map(project.members.map((m) => [m.id, m])),
    [project],
  );
  const names = focus?.kind === "node" ? byNode : byMember;
  const indexedFocus =
    focus?.ids.length === 2 ? pairKey(focus.ids[0], focus.ids[1]) : "";
  const targets = focus?.kind === "node" ? choices.nodes : choices.members;
  const picked = targets.find((m) => pairKey(m.drop, m.keep) === indexedFocus);
  const focusDetails = useMemo(
    () => (focus ? objectDetails(project, focus, units) : []),
    [project, focus, units],
  );
  function highlight(item: Focus | null) {
    setFocus(item);
    onHighlight(item ? item.ids.map((id) => ({ kind: item.kind, id })) : []);
    setSubmitError("");
  }
  function choose(keep: string) {
    if (!focus) return;
    const merges = targets.filter(
      (m) => pairKey(m.drop, m.keep) !== indexedFocus,
    );
    if (keep) merges.push({ drop: focus.ids.find((id) => id !== keep)!, keep });
    setChoices(
      focus.kind === "node"
        ? { ...noRepairs(), nodes: merges }
        : { ...choices, members: merges, answers: {} },
    );
  }
  const error = scan.error || geometry.error || preview?.error || submitError;
  const select = (kind: Focus["kind"], pair: Pair) =>
    highlight({ kind, ids: [pair.a, pair.b] });
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal duplicate-dialog"
      aria-labelledby="duplicate-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="duplicate-title">Diagnóstico de duplicidades</h2>
      <label>
        Tolerância de distância ({units.length})
        <input
          inputMode="decimal"
          value={tol}
          onChange={(e) => {
            setTol(e.target.value);
            setChoices(noRepairs());
            highlight(null);
          }}
        />
      </label>
      <p>
        Distância em XYZ. Selecione um par para destacá-lo nas vistas do modelo.
        Pares sem correção marcada permanecem separados.
      </p>
      {scan.value && (
        <PairList
          title="Nós próximos"
          pairs={scan.value}
          chosen={choices.nodes}
          focus={focus?.kind === "node" ? indexedFocus : ""}
          label={(p) =>
            `${named(byNode.get(p.a)!)} ↔ ${named(byNode.get(p.b)!)} · ${formatQuantity(p.distance, "length", units)} ${units.length}`
          }
          onSelect={(p) => select("node", p)}
        />
      )}
      {stage && (
        <>
          <PairList
            title="Barras duplicadas após as uniões marcadas"
            pairs={stage.pairs}
            chosen={choices.members}
            focus={focus?.kind === "member" ? indexedFocus : ""}
            label={(p) =>
              `${named(byMember.get(p.a)!)} ↔ ${named(byMember.get(p.b)!)}`
            }
            onSelect={(p) => select("member", p)}
          />
          {stage.nulls.length > 0 && (
            <section>
              <h3>Barras de comprimento nulo ({stage.nulls.length})</h3>
              {stage.nulls.map((id) => (
                <div key={id}>
                  <button
                    type="button"
                    onClick={() => highlight({ kind: "member", ids: [id] })}
                  >
                    Inspecionar {named(byMember.get(id)!)}
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={choices.removeNull.includes(id)}
                      onChange={(e) => {
                        highlight({ kind: "member", ids: [id] });
                        setChoices({
                          ...choices,
                          removeNull: e.target.checked
                            ? [...choices.removeNull, id]
                            : choices.removeNull.filter((v) => v !== id),
                          answers: {},
                        });
                      }}
                    />
                    Excluir {named(byMember.get(id)!)} com suas cargas e
                    associações
                  </label>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {focus && (
        <section className="duplicate-selected">
          <h3>
            {focus.ids.length === 2 ? "Par destacado" : "Barra destacada"}
          </h3>
          {focus.ids.length === 2 && (
            <PairPreview project={project} focus={focus} />
          )}
          <ul>
            {focusDetails.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {focus.ids.length === 2 && (
            <label>
              {focus.kind === "node" ? "Nó a manter" : "Barra a manter"}
              <select
                value={picked?.keep ?? ""}
                onChange={(e) => choose(e.target.value)}
              >
                <option value="">Manter separados</option>
                {focus.ids.map((id) => (
                  <option key={id} value={id}>
                    {named(names.get(id)!)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {focus.kind === "node" && (
            <p>
              O nó mantido conserva suas coordenadas. Ações transferidas
              preservam seus componentes globais no novo ponto de aplicação.
              Alterar a união de nós limpa as decisões dependentes de barras e
              conflitos.
            </p>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="launch-error">
          {error}
        </p>
      )}
      {plan?.changes ? (
        <section className="duplicate-review">
          <h3>Prévia da correção</h3>
          {plan.questions.map((q) => (
            <label key={q.key}>
              {q.title}
              <select
                value={q.value}
                onChange={(e) =>
                  setChoices({
                    ...choices,
                    answers: { ...choices.answers, [q.key]: e.target.value },
                  })
                }
              >
                <option value="">Escolha uma resolução</option>
                {q.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {plan.blocking.map((line) => (
            <p key={line} role="alert" className="launch-error">
              {line}
            </p>
          ))}
          <details open>
            <summary>Destino das referências ({plan.notes.length})</summary>
            <ul>
              {plan.notes.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="primary"
          disabled={!plan?.project}
          onClick={() => {
            if (!plan?.project) return;
            const err = onApply(project, plan.project);
            if (err) setSubmitError(err);
            else onClose();
          }}
        >
          Aplicar correções
        </button>
      </div>
    </dialog>
  );
}
