import { LoadPanelPreview } from "./LoadPanelFootprint";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  distributionNames,
  distributeLoadPanel,
  checkLoadPanelLocation,
} from "../domain/loadPanel";
import { distance, dot, subtract, tolerance } from "../domain/geometry";
import {
  uid,
  type LoadPanel,
  type Project,
  type TributaryLoad,
} from "../domain/model";
import { formatQuantity, parseUnitNumber } from "../units";
import { useUnits } from "./Units";

export function newLoadPanel(p: Project, z: number): LoadPanel {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const horizontal = p.members.flatMap((m) => {
    const a = nodes.get(m.start)!,
      b = nodes.get(m.end)!;
    return Math.abs(a.z - b.z) <= tolerance ? [[a, b] as const] : [];
  });
  const pair =
    horizontal.find(([a]) => Math.abs(a.z - z) <= tolerance) ?? horizontal[0];
  const a = pair?.[0] ?? p.nodes[0],
    b = pair?.[1] ?? p.nodes.find((n) => n.id !== a?.id);
  const ab = a && b ? subtract(b, a) : undefined;
  const side =
    a &&
    ab &&
    p.nodes
      .filter(
        (n) =>
          n.id !== a.id &&
          n.id !== b?.id &&
          Math.abs(n.z - a.z) <= tolerance &&
          Math.abs(dot(ab, subtract(n, a))) <= tolerance * distance(a, b!),
      )
      .sort((n, m) => distance(a, n) - distance(a, m))[0];
  const names = new Set(p.loadPanels?.map((v) => v.name));
  let k = 1;
  while (names.has("PC" + k)) k++;
  return {
    id: uid(),
    name: "PC" + k,
    a: a?.id ?? "",
    b: b?.id ?? "",
    d: side?.id ?? "",
    distribution: "twoWay",
  };
}
type Edit = (fn: (draft: Project) => void) => string | null;
export function LoadPanelDialog({
  project,
  initial,
  activePattern,
  edit,
  close,
}: {
  project: Project;
  initial: LoadPanel;
  activePattern: string;
  edit: Edit;
  close: () => void;
}) {
  const { units } = useUnits(),
    ref = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState(initial),
    [patternId, setPattern] = useState(activePattern),
    [error, setError] = useState("");
  const [actions, setActions] = useState(() =>
    Object.fromEntries(
      project.loadPatterns.map((p) => {
        const load = p.tributaryLoads?.find((l) => l.panelId === initial.id);
        return [
          p.id,
          {
            axis: load?.axis ?? "Z",
            text: String((load?.pressure ?? 0) / 1000),
          },
        ];
      }),
    ),
  );
  const pattern = actions[patternId],
    pressure = (parseUnitNumber(pattern.text) ?? NaN) * 1000;
  const existing = project.loadPanels?.some((v) => v.id === initial.id);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const preview = useMemo(() => {
    try {
      const data = distributeLoadPanel(project, panel);
      checkLoadPanelLocation(project, panel, data.rect);
      return { data };
    } catch (e) {
      return { problem: (e as Error).message };
    }
  }, [project, panel]);
  const finish = (fn: (p: Project) => void) => {
    const reason = edit(fn);
    if (reason) setError(reason);
    else close();
  };
  const save = () => {
    if (!preview.data) return;
    const loads = new Map<string, TributaryLoad>();
    for (const p of project.loadPatterns) {
      const a = actions[p.id],
        parsed = parseUnitNumber(a.text),
        intensity = parsed === null ? NaN : parsed * 1000;
      if (
        !Number.isFinite(intensity) ||
        !Number.isFinite(intensity * preview.data.rect.area)
      ) {
        setError(p.name + " · informe uma pressão finita.");
        return;
      }
      if (intensity)
        loads.set(p.id, {
          panelId: panel.id,
          axis: a.axis,
          pressure: intensity,
        });
    }
    finish((p) => {
      const panels = (p.loadPanels ??= []),
        i = panels.findIndex((v) => v.id === panel.id);
      const updated = { ...panel, name: panel.name.trim() };
      if (!updated.name) throw new Error("Informe o nome do painel de carga.");
      if (i < 0) panels.push(updated);
      else panels[i] = updated;
      for (const pat of p.loadPatterns) {
        const list = (pat.tributaryLoads ?? []).filter(
          (v) => v.panelId !== panel.id,
        );
        const value = loads.get(pat.id);
        if (value) list.push(value);
        if (list.length) pat.tributaryLoads = list;
        else delete pat.tributaryLoads;
      }
    });
  };
  const remove = () =>
    finish((p) => {
      p.loadPanels = p.loadPanels?.filter((v) => v.id !== panel.id);
      for (const pat of p.loadPatterns)
        if (pat.tributaryLoads)
          pat.tributaryLoads = pat.tributaryLoads.filter(
            (v) => v.panelId !== panel.id,
          );
    });
  const fmt = (v: number) =>
    v.toLocaleString("pt-BR", { maximumSignificantDigits: 6 });
  const coord = (x: number) => formatQuantity(x, "length", units);
  return (
    <dialog
      ref={ref}
      aria-label="Painel de carga"
      className="slab-sizing-dialog load-panel-dialog"
      onCancel={close}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>{existing ? "Editar painel de carga" : "Novo painel de carga"}</h2>
        <label className="stack-field">
          Nome do painel de carga
          <input
            value={panel.name}
            maxLength={120}
            required
            onChange={(e) => setPanel({ ...panel, name: e.target.value })}
          />
        </label>
        <fieldset>
          <legend>Retângulo em planta</legend>
          <p>
            Escolha o canto A e seus vizinhos B e D na mesma cota. O quarto
            canto é calculado. As vigas que cobrem as bordas receptoras aparecem
            na prévia.
          </p>
          <div className="panel-columns">
            {(["a", "b", "d"] as const).map((k) => (
              <label key={k} className="stack-field">
                Nó {k.toUpperCase()}
                <select
                  aria-label={"Nó " + k.toUpperCase()}
                  value={panel[k]}
                  onChange={(e) => setPanel({ ...panel, [k]: e.target.value })}
                  required
                >
                  <option value="">Selecionar nó</option>
                  {project.nodes.map((n) => (
                    <option value={n.id} key={n.id}>
                      {n.name} · {coord(n.x)}, {coord(n.y)}, {coord(n.z)}{" "}
                      {units.length}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="stack-field">
            Distribuição às vigas
            <select
              value={panel.distribution}
              onChange={(e) =>
                setPanel({
                  ...panel,
                  distribution: e.target.value as LoadPanel["distribution"],
                })
              }
            >
              {Object.entries(distributionNames).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p>
            {panel.distribution === "twoWay"
              ? "As bissetrizes a 45° dividem a área entre as quatro bordas."
              : panel.distribution === "spanAB"
                ? "O vão AB descarrega nas bordas BC e DA."
                : "O vão AD descarrega nas bordas AB e CD."}
          </p>
        </fieldset>
        <fieldset>
          <legend>Carga uniforme por padrão</legend>
          <div className="panel-columns">
            <label className="stack-field">
              Padrão do painel
              <select
                value={patternId}
                onChange={(e) => setPattern(e.target.value)}
              >
                {project.loadPatterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack-field">
              Direção da carga
              <select
                value={pattern.axis}
                onChange={(e) =>
                  setActions({
                    ...actions,
                    [patternId]: {
                      ...pattern,
                      axis: e.target.value as TributaryLoad["axis"],
                    },
                  })
                }
              >
                {(["X", "Y", "Z"] as const).map((axis) => (
                  <option key={axis} value={axis}>
                    {axis} global
                  </option>
                ))}
              </select>
            </label>
            <label className="stack-field">
              Intensidade (kN/m²)
              <input
                inputMode="decimal"
                required
                value={pattern.text}
                onChange={(e) =>
                  setActions({
                    ...actions,
                    [patternId]: { ...pattern, text: e.target.value },
                  })
                }
              />
            </label>
          </div>
          <p>
            O sinal positivo acompanha o eixo global. O painel transfere a ação
            às vigas e tem rigidez, massa e peso próprio nulos.
          </p>
        </fieldset>
        {preview.problem && <p role="alert">{preview.problem}</p>}
        {preview.data && Number.isFinite(pressure) && (
          <section aria-label="Distribuição do painel">
            <LoadPanelPreview name={panel.name} data={preview.data} />
            <p>
              Área total {fmt(preview.data.rect.area)} m² · Força em{" "}
              {pattern.axis}{" "}
              {formatQuantity(
                pressure * preview.data.rect.area,
                "force",
                units,
              )}{" "}
              {units.force}
            </p>
            <table aria-label="Parcelas por viga">
              <thead>
                <tr>
                  <th>Borda</th>
                  <th>Viga</th>
                  <th>Área (m²)</th>
                  <th>Força ({units.force})</th>
                </tr>
              </thead>
              <tbody>
                {preview.data.shares.map((v) => (
                  <tr key={v.side + v.memberId}>
                    <td>{v.side}</td>
                    <td>{v.name}</td>
                    <td>{fmt(v.area)}</td>
                    <td>{formatQuantity(pressure * v.area, "force", units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details>
              <summary>Cargas lineares por trecho</summary>
              <table aria-label="Cargas lineares nas vigas">
                <thead>
                  <tr>
                    <th>Viga</th>
                    <th>De i ({units.length})</th>
                    <th>Até ({units.length})</th>
                    <th>q inicial ({units.distributedLoad})</th>
                    <th>q final ({units.distributedLoad})</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.data.shares.flatMap((v) =>
                    v.segments.map((s, i) => (
                      <tr key={v.side + v.memberId + i}>
                        <td>{v.name}</td>
                        <td>{coord(s.start * v.span)}</td>
                        <td>{coord(s.end * v.span)}</td>
                        <td>
                          {formatQuantity(
                            s.widthStart * pressure,
                            "distributedLoad",
                            units,
                          )}
                        </td>
                        <td>
                          {formatQuantity(
                            s.widthEnd * pressure,
                            "distributedLoad",
                            units,
                          )}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </details>
          </section>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          {existing && (
            <button type="button" onClick={remove}>
              Excluir painel de carga
            </button>
          )}
          <button type="button" onClick={close}>
            Cancelar
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!preview.data || !Number.isFinite(pressure)}
          >
            Aplicar painel de carga
          </button>
        </footer>
      </form>
    </dialog>
  );
}
