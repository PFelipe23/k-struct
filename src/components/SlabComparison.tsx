import { useEffect, useRef, useState } from "react";
import { querySlab, type SlabResult, type SlabSample } from "../solver/slab";
import { formatUnitInput, parseUnitInput, unitLabel } from "../units";
import type { XY } from "../domain/slabPolygon";
import { useUnits } from "./Units";
import { formatResultQuantity } from "./resultFormatting";

type Reference = {
  point: XY;
  sample: SlabSample;
  reaction: number;
  count: number;
};
export default function SlabComparison({
  result,
}: {
  result: SlabResult | null;
}) {
  const [reference, setReference] = useState<Reference | null>(null),
    [open, setOpen] = useState(false);
  return (
    <>
      <button disabled={!result} onClick={() => setOpen(true)}>
        Comparar malhas
      </button>
      {open && result && (
        <ComparisonDialog
          result={result}
          reference={reference}
          save={setReference}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
function ComparisonDialog({
  result,
  reference,
  save,
  close,
}: {
  result: SlabResult;
  reference: Reference | null;
  save: (r: Reference) => void;
  close: () => void;
}) {
  const { units } = useUnits(),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const initial = reference?.point ?? result.samplePoint;
  const [x, setX] = useState(() => formatUnitInput(initial.x, "length", units)),
    [y, setY] = useState(() => formatUnitInput(initial.y, "length", units));
  const xx = parseUnitInput(x, "length", units, initial.x),
    yy = parseUnitInput(y, "length", units, initial.y);
  const point = xx === null || yy === null ? null : { x: xx, y: yy },
    sample = point && querySlab(result, point);
  const same =
    !!reference &&
    point?.x === reference.point.x &&
    point?.y === reference.point.y;
  const rows = sample
    ? ([
        {
          label: "UZ",
          q: "displacement",
          v: sample.uz,
          old: reference?.sample.uz,
        },
        { label: "Mx", q: "moment", v: sample.mx, old: reference?.sample.mx },
        { label: "My", q: "moment", v: sample.my, old: reference?.sample.my },
        {
          label: "Σ RZ",
          q: "force",
          v: result.totalReactionZ,
          old: reference?.reaction,
        },
      ] as const)
    : [];
  return (
    <dialog
      className="slab-sizing-dialog"
      ref={dialog}
      aria-label="Comparação de malhas"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2>Comparação de malhas</h2>
      <div className="slab-comparison-coordinates">
        {(
          [
            ["X", x, setX],
            ["Y", y, setY],
          ] as const
        ).map(([axis, v, set]) => (
          <label key={axis}>
            {axis} ({units.length}){" "}
            <input
              aria-label={`${axis} da consulta`}
              inputMode="decimal"
              value={v}
              onChange={(e) => set(e.target.value)}
            />
          </label>
        ))}
      </div>
      {!sample ? (
        <p role="alert">Informe um ponto sobre a área de material da laje.</p>
      ) : (
        <table aria-label="Resultados no mesmo ponto">
          <thead>
            <tr>
              <th>Grandeza</th>
              <th>Atual · {result.elements.length} elementos</th>
              {same && (
                <>
                  <th>Referência · {reference!.count} elementos</th>
                  <th>Atual − referência</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>
                  {row.label} ({unitLabel(row.q, units)}
                  {row.q === "moment" ? "/m" : ""})
                </td>
                <td>{formatResultQuantity(row.v, row.q, units)}</td>
                {same && (
                  <>
                    <td>{formatResultQuantity(row.old!, row.q, units)}</td>
                    <td>
                      {formatResultQuantity(row.v - row.old!, row.q, units)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <footer>
        <button
          disabled={!sample}
          onClick={() => {
            if (point && sample)
              save({
                point,
                sample,
                count: result.elements.length,
                reaction: result.totalReactionZ,
              });
          }}
        >
          Guardar referência desta malha
        </button>
        <button onClick={close}>Fechar comparação</button>
      </footer>
    </dialog>
  );
}
