import { useState, type ReactNode } from "react";
import { parseDecimalInput } from "../domain/geometry";
import type { Project } from "../domain/model";
import type { MemberForceComponent } from "../solver/combinations";
import type {
  DiagramReading,
  MemberDiagram,
  SectionCursor,
} from "../solver/memberDiagram";
import { fromSI, toSI, type UnitPreferences } from "../units";
import { useUnits } from "./Units";
import {
  forceColumns,
  forceQuantity,
  formatResult,
  formatResultQuantity,
  getForceLabel,
  sectionPositions,
  sectionSide,
} from "./resultFormatting";

export type SectionControls = {
  diagram: MemberDiagram;
  reading: DiagramReading;
  component: MemberForceComponent;
  onSection: (location: SectionCursor) => void;
  onComponent: (component: MemberForceComponent) => void;
};

function PositionInput({
  ratio,
  length,
  reading,
  units,
  onPosition,
}: {
  ratio: boolean;
  length: number;
  reading: DiagramReading;
  units: UnitPreferences;
  onPosition: (t: number) => void;
}) {
  const t = reading.location.t;
  const current = ratio ? t : fromSI(length * t, "length", units);
  const formatted = String(Number(current.toPrecision(13))).replace(".", ",");
  const [edit, setEdit] = useState<{
    reading: DiagramReading;
    draft: string;
    error: string;
  } | null>(null);
  const draft = edit?.reading === reading ? edit.draft : formatted;
  const error = edit?.reading === reading ? edit.error : "";
  function apply() {
    const terms = draft.trim().split("/");
    let x = parseDecimalInput(terms[0]);
    if (terms.length === 2 && ratio) x /= parseDecimalInput(terms[1]);
    else if (terms.length !== 1) x = NaN;
    const position =
      draft === formatted ? t : ratio ? x : toSI(x, "length", units) / length;
    if (!Number.isFinite(position) || position < 0 || position > 1) {
      setEdit({
        reading,
        draft,
        error: `Informe um valor entre 0 e ${ratio ? "1" : formatResult(fromSI(length, "length", units)) + " " + units.length}.`,
      });
      return;
    }
    onPosition(position);
  }
  return (
    <form
      className="section-position"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <input
        aria-label={ratio ? "Posição x/L" : `Distância x (${units.length})`}
        aria-invalid={!!error}
        value={draft}
        onChange={(e) => {
          setEdit({ reading, draft: e.target.value, error: "" });
        }}
      />
      <button type="submit">Consultar</button>
      {error && <span role="alert">{error}</span>}
    </form>
  );
}

export function SectionConsultation({
  project,
  controls,
  isEnvelope = false,
  action,
}: {
  project: Project;
  controls: SectionControls;
  isEnvelope?: boolean;
  action?: ReactNode;
}) {
  const { units } = useUnits();
  const { diagram, reading, component, onSection, onComponent } = controls;
  const [ratio, setRatio] = useState(false),
    [sampled, setSampled] = useState(false);
  const { memberId, length, stations } = diagram;
  const { t, side } = reading.location;
  const [found, setFound] = useState<{
    which: string;
    t: number;
    side?: string;
    component: MemberForceComponent;
    diagram: MemberDiagram;
    sampled: boolean;
  } | null>(null);
  const sample = reading.method === "sample" || reading.method === "nearest";
  const select = (position: { t: number; side?: "left" | "right" }) =>
    onSection({ memberId, ...position });
  const lengthText = (x: number) =>
    `${formatResult(fromSI(x, "length", units), 9)} ${units.length}`;
  function jump(bound: "min" | "max") {
    const position = diagram.extreme(component, bound, sampled);
    select(position);
    setFound({
      which: bound === "min" ? "Mínimo" : "Máximo",
      ...position,
      component,
      diagram,
      sampled,
    });
  }
  const member = project.members.find((m) => m.id === memberId)!;
  const positions = sectionPositions(
    project,
    member.offsets ? [member] : [],
    units,
  );
  const columns = forceColumns[project.mode];
  const method =
    reading.method === "linear"
      ? isEnvelope
        ? "Interpolação linear por combinação"
        : "Interpolação linear no trecho"
      : reading.method === "law"
        ? "Lei do esforço"
        : reading.method === "nearest"
          ? "Amostra mais próxima do OOFEM"
          : "Amostra do OOFEM";
  const scope =
    sampled || diagram.coverage === "sampled"
      ? "estações amostradas"
      : diagram.coverage === "partial"
        ? "faces e trechos com lei disponível, demais trechos amostrados"
        : "faces e extremos internos dos trechos";
  const foundHere =
    found &&
    found.t === t &&
    found.side === side &&
    found.component === component &&
    found.diagram === diagram &&
    found.sampled === sampled;
  const rows = isEnvelope
    ? ([
        ["Mínimo", reading.min],
        ["Máximo", reading.max],
      ] as const)
    : ([["Seção", reading.min]] as const);
  return (
    <div className="results-body section-consultation">
      <div className="result-actions envelope-toolbar">
        <label>
          Barra{" "}
          <select
            aria-label={isEnvelope ? "Barra do envelope" : "Barra da consulta"}
            value={memberId}
            onChange={(e) => onSection({ memberId: e.target.value, t: 0 })}
          >
            {project.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} [{m.id}]
              </option>
            ))}
          </select>
        </label>
        <label>
          Esforço{" "}
          <select
            aria-label="Componente do diagrama"
            value={component}
            onChange={(e) => onComponent(columns[e.target.selectedIndex])}
          >
            {columns.map((k) => (
              <option key={k} value={k}>
                {getForceLabel(k, units).symbol}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="Coordenada da consulta"
          value={ratio ? "ratio" : "distance"}
          onChange={(e) => setRatio(e.target.value === "ratio")}
        >
          <option value="distance">x ({units.length})</option>
          <option value="ratio">x/L</option>
        </select>
        <PositionInput
          key={`${memberId}/${ratio}/${units.length}/${t}/${side}`}
          ratio={ratio}
          units={units}
          length={length}
          reading={reading}
          onPosition={(x) => {
            setFound(null);
            select({ t: x, ...(x === t && { side }) });
          }}
        />
        {side && (
          <label>
            Face{" "}
            <select
              aria-label="Face da descontinuidade"
              value={side}
              onChange={(e) =>
                select({
                  t,
                  side: e.target.value === "left" ? "left" : "right",
                })
              }
            >
              <option value="left">Lado i (esquerda)</option>
              <option value="right">Lado j (direita)</option>
            </select>
          </label>
        )}
        {action}
      </div>
      <div className="result-actions envelope-toolbar">
        <label>
          Estação x/L{" "}
          <select
            aria-label="Estação x/L"
            value={sample ? reading.index : ""}
            onChange={(e) => select(stations[Number(e.target.value)])}
          >
            {!sample && <option value="">Entre estações</option>}
            {stations.map((s, i) => (
              <option key={i} value={i}>
                {formatResult(s.t)}
                {s.side && ` · ${sectionSide(s.side)}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Busca{" "}
          <select
            aria-label="Domínio da busca de extremos"
            value={sampled ? "samples" : "spans"}
            onChange={(e) => setSampled(e.target.value === "samples")}
          >
            <option value="spans">Trechos e faces</option>
            <option value="samples">Apenas amostras</option>
          </select>
        </label>
        <button onClick={() => jump("min")}>Ir ao mínimo</button>
        <button onClick={() => jump("max")}>Ir ao máximo</button>
      </div>
      <p className="section-reading" aria-label="Posição consultada">
        {foundHere && `${found.which} · `}
        {method} · x = {lengthText(t * length)} · x/L = {formatResult(t, 9)}
        {side && ` · ${sectionSide(side)}`}. Busca em {member.name} de 0 a{" "}
        {lengthText(length)} a partir da face i · {scope}.
      </p>
      <table
        aria-label={
          isEnvelope
            ? "Esforços simultâneos do envelope"
            : "Esforços na seção consultada"
        }
      >
        {positions.headers.length > 0 && (
          <caption>
            Seção no trecho deformável ·{" "}
            {positions
              .values(memberId, t)
              .map(
                (v, i) =>
                  `${positions.headers[i][0]} = ${formatResult(v)} ${units.length}`,
              )
              .join(" · ")}
          </caption>
        )}
        <thead>
          <tr>
            <th>{isEnvelope ? "Extremo" : "Seção"}</th>
            <th>{isEnvelope ? "Combinação governante" : "Origem"}</th>
            {columns.map((k) => (
              <th
                key={k}
                className={k === component ? "governing-force" : undefined}
              >
                {getForceLabel(k, units).symbol} ({getForceLabel(k, units).unit}
                )
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, e]) => (
            <tr key={label}>
              <th
                scope="row"
                className={
                  label === "Máximo"
                    ? "envelope-max-label"
                    : label === "Mínimo"
                      ? "envelope-min-label"
                      : undefined
                }
              >
                {label}
              </th>
              <td>
                {e.name} [{e.id}]
              </td>
              {columns.map((k) => (
                <td
                  key={k}
                  className={k === component ? "governing-force" : undefined}
                >
                  {formatResultQuantity(e.forces[k], forceQuantity(k), units)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
