import { useState } from "react";
import { coordinates, type Point3 } from "../domain/geometry";
import { panelKinds } from "../domain/surfacePanel";
import { panelFields, type PanelResult } from "../solver/surfacePanel";
import { formatQuantity, type UnitQuantity } from "../units";
import { useUnits } from "./Units";

export function SurfacePanelResults({
  result,
  caseName,
  message,
}: {
  result?: PanelResult;
  caseName: string;
  message: string;
}) {
  const { units } = useUnits(),
    [choice, setChoice] = useState(""),
    [nodeIndex, setNodeIndex] = useState(0),
    [elementIndex, setElementIndex] = useState(0);
  const panel =
    result?.panels.find((p) => p.panelId === choice) ?? result?.panels[0];
  const fmt = (v: number, q: UnitQuantity) => formatQuantity(v, q, units);
  const vec = (v: Point3, q: UnitQuantity) =>
    coordinates.map((k) => fmt(v[k], q)).join(" / ");
  const fields = panelFields.filter(
    (k) => panel?.samples[0]?.fields[k] !== undefined,
  );
  const selectedNode = panel?.nodes[nodeIndex] ?? panel?.nodes[0];
  const elementIds = panel
    ? [...new Set(panel.samples.map((s) => s.element))]
    : [];
  const selectedElement = elementIds[elementIndex] ?? elementIds[0];
  const label = (key: string) =>
    key.toUpperCase().replaceAll("X", "1").replaceAll("Y", "2");
  return (
    <section
      className="results slab-results"
      aria-label="Resultados dos painéis espaciais"
    >
      <div className="results-heading">
        <strong>Painéis espaciais</strong>
        <span>{caseName}</span>
      </div>
      <div className="results-body">
        {result && panel ? (
          <>
            <label>
              Painel consultado{" "}
              <select
                value={panel.panelId}
                onChange={(e) => {
                  setChoice(e.target.value);
                  setNodeIndex(0);
                  setElementIndex(0);
                }}
              >
                {result.panels.map((p) => (
                  <option key={p.panelId} value={p.panelId}>
                    {p.name} · {panelKinds[p.kind]}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Resultante dos apoios em XYZ ({units.force}) ·{" "}
              {vec(result.force, "force")}
              <br />
              Momento dos apoios em XYZ ({units.moment}) ·{" "}
              {vec(result.moment, "moment")} · em relação a A do primeiro
              painel.
            </p>
            <table aria-label="Extremos locais do painel">
              <thead>
                <tr>
                  <th>Componente local</th>
                  <th>Mínimo</th>
                  <th>Máximo</th>
                  <th>Unidade</th>
                </tr>
              </thead>
              <tbody>
                {coordinates.map((k, i) => {
                  const v = panel.nodes.map((n) => n.local[k]);
                  return (
                    <tr key={k}>
                      <td>U{i + 1}</td>
                      <td>{fmt(Math.min(...v), "displacement")}</td>
                      <td>{fmt(Math.max(...v), "displacement")}</td>
                      <td>{units.displacement}</td>
                    </tr>
                  );
                })}
                {fields.map((k) => {
                  const v = panel.samples.map((s) => s.fields[k]!);
                  const q = k.startsWith("n") ? "distributedLoad" : "moment";
                  return (
                    <tr key={k}>
                      <td>{label(k)}</td>
                      <td>{fmt(Math.min(...v), q)}</td>
                      <td>{fmt(Math.max(...v), q)}</td>
                      <td>
                        {q === "moment"
                          ? units.moment + "/m"
                          : units.distributedLoad}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <details>
              <summary>Eixos locais em coordenadas globais</summary>
              {panel.axes.map((a, i) => (
                <p key={i}>
                  Eixo {i + 1} ·{" "}
                  {coordinates.map((k) => Number(a[k].toFixed(6))).join(" / ")}
                </p>
              ))}
            </details>
            <details>
              <summary>Consultar um nó ou elemento da malha</summary>
              {selectedNode && (
                <>
                  <label>
                    Nó de malha{" "}
                    <select
                      value={selectedNode.id}
                      onChange={(e) =>
                        setNodeIndex(
                          panel.nodes.findIndex(
                            (n) => n.id === Number(e.target.value),
                          ),
                        )
                      }
                    >
                      {panel.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    XYZ ({units.length}) · {vec(selectedNode.point, "length")}
                    <br />
                    U1 / U2 / U3 ({units.displacement}) ·{" "}
                    {vec(selectedNode.local, "displacement")}
                    <br />
                    UX / UY / UZ ({units.displacement}) ·{" "}
                    {vec(selectedNode.global, "displacement")}
                  </p>
                </>
              )}
              <label>
                Elemento triangular{" "}
                <select
                  value={selectedElement}
                  onChange={(e) =>
                    setElementIndex(elementIds.indexOf(Number(e.target.value)))
                  }
                >
                  {elementIds.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </label>
              <table aria-label="Esforços nos pontos de integração">
                <thead>
                  <tr>
                    <th>Ponto</th>
                    {fields.map((k) => (
                      <th key={k}>
                        {label(k)} (
                        {k.startsWith("n")
                          ? units.distributedLoad
                          : units.moment + "/m"}
                        )
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {panel.samples
                    .filter((s) => s.element === selectedElement)
                    .map((s) => (
                      <tr key={s.gp}>
                        <td>{s.gp}</td>
                        {fields.map((k) => (
                          <td key={k}>
                            {fmt(
                              s.fields[k]!,
                              k.startsWith("n") ? "distributedLoad" : "moment",
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
            {result.shared.length > 0 && (
              <p>
                {result.shared.length} nós de malha compartilhados na borda
                entre os painéis.
              </p>
            )}
          </>
        ) : (
          <p role="status">{message}</p>
        )}
      </div>
    </section>
  );
}
