import { useState } from "react";
import { coordinates, type Point3 } from "../domain/geometry";
import { supportBasis, type SupportFrame } from "../domain/supports";
import { parseNumberInput } from "./numberInput";
import { formatResult } from "./resultFormatting";

function FrameFields({
  frame,
  onChange,
}: {
  frame: SupportFrame;
  onChange: (frame: SupportFrame) => void;
}) {
  const [draft, setDraft] = useState(() =>
    frame.kind === "planar"
      ? [String(frame.angle)]
      : [frame.x, frame.y].flatMap((axis) =>
          coordinates.map((key) => String(axis[key])),
        ),
  );
  const numbers = draft.map(parseNumberInput);
  const [x, y, z, a, b, c] = numbers;
  const candidate: SupportFrame =
    frame.kind === "planar"
      ? { kind: "planar", angle: x }
      : { kind: "spatial", x: { x, y, z }, y: { x: a, y: b, z: c } };
  let basis: ReturnType<typeof supportBasis> | undefined;
  let problem = "";
  if (numbers.some((value) => !Number.isFinite(value))) {
    problem = "Preencha todos os componentes com números finitos.";
  } else if (candidate.kind === "planar" && Math.abs(candidate.angle) > 360) {
    problem = "Informe um ângulo entre −360° e 360°.";
  } else {
    try {
      basis = supportBasis(candidate);
    } catch (error) {
      problem = (error as Error).message;
    }
  }
  const field = (label: string, index: number) => (
    <label className="stack-field" key={label}>
      {label}
      <input
        inputMode="decimal"
        value={draft[index]}
        onChange={(event) => {
          const value = event.target.value;
          setDraft((previous) =>
            previous.map((item, i) => (i === index ? value : item)),
          );
        }}
      />
    </label>
  );
  return (
    <form
      className="support-frame"
      onSubmit={(event) => {
        event.preventDefault();
        if (basis) onChange(candidate);
      }}
    >
      {frame.kind === "planar" ? (
        <>
          {field("Ângulo da tangente (°)", 0)}
          <p className="help">
            Meça a partir de +X em direção a +Z. O eixo x local é tangente e z
            local é normal.
          </p>
          {basis && <PlanarPreview tangent={basis.x} normal={basis.z} />}
        </>
      ) : (
        <>
          <p className="help">
            Indique x local e uma direção para y. A prévia mostra a base
            ortonormal de mão direita.
          </p>
          <div className="support-frame-inputs">
            {(["x", "y"] as const).flatMap((axis, i) =>
              coordinates.map((key, j) =>
                field(`${axis} local · ${key.toUpperCase()}`, i * 3 + j),
              ),
            )}
          </div>
          {basis && (
            <dl className="support-basis" aria-label="Prévia da base nodal">
              {coordinates.map((key) => (
                <div key={key}>
                  <dt>{key} local</dt>
                  <dd>
                    (
                    {coordinates
                      .map((k) => formatResult(basis[key][k] || 0))
                      .join(" / ")}
                    )
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
      {problem && (
        <p className="support-frame-error" role="alert">
          {problem}
        </p>
      )}
      <button
        type="submit"
        disabled={!basis || JSON.stringify(frame) === JSON.stringify(candidate)}
      >
        Aplicar referencial
      </button>
    </form>
  );
}

function PlanarPreview({
  tangent,
  normal,
}: {
  tangent: Point3;
  normal: Point3;
}) {
  return (
    <svg
      className="support-frame-preview"
      viewBox="-62 -57 124 114"
      role="img"
      aria-label="Prévia da tangente e da normal"
    >
      <path className="support-frame-grid" d="M-50 0h100 M0-45v90" />
      <text className="support-frame-grid-label" x="52" y="3">
        X
      </text>
      <text className="support-frame-grid-label" x="0" y="-50">
        Z
      </text>
      {(
        [
          ["t", tangent],
          ["n", normal],
        ] as const
      ).map(([name, axis]) => {
        const x = axis.x * 34,
          y = -axis.z * 34;
        const dx = axis.x * 6,
          dy = -axis.z * 6;
        return (
          <g key={name} className={`support-frame-${name}`}>
            <path
              d={`M0 0L${x} ${y}m${-dx + dy / 2} ${-dy - dx / 2}L${x} ${y}l${-dx - dy / 2} ${-dy + dx / 2}`}
            />
            <text x={x * 1.24} y={y * 1.24}>
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function SupportFrameEditor({
  mode,
  frame,
  onChange,
}: {
  mode: "planar" | "spatial";
  frame?: SupportFrame;
  onChange: (frame?: SupportFrame) => void;
}) {
  return (
    <>
      <label className="stack-field">
        Referencial do apoio
        <select
          value={frame ? "local" : "global"}
          onChange={(event) => {
            onChange(
              event.target.value === "global"
                ? undefined
                : mode === "planar"
                  ? { kind: "planar", angle: 0 }
                  : {
                      kind: "spatial",
                      x: { x: 1, y: 0, z: 0 },
                      y: { x: 0, y: 1, z: 0 },
                    },
            );
          }}
        >
          <option value="global">Global</option>
          <option value="local">Local</option>
        </select>
      </label>
      {frame && (
        <FrameFields
          key={JSON.stringify(frame)}
          frame={frame}
          onChange={onChange}
        />
      )}
    </>
  );
}
