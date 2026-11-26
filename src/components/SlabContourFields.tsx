import { useEffect, useState } from "react";
import { uid, type PolygonSlab } from "../domain/model";
import {
  footprintProperties,
  nextIndex,
  normalizeRings,
  ringName,
  type SlabRing,
} from "../domain/slabPolygon";
import {
  formatUnitInput,
  formatUnitValue,
  fromSI,
  parseUnitInput,
} from "../units";
import { useUnits } from "./Units";

export default function SlabContourFields({
  slab,
  sharedEdge,
  update,
}: {
  slab: PolygonSlab;
  sharedEdge?: string;
  update: (
    rings: SlabRing[],
    split?: { from: string; to: string },
  ) => string | null | void;
}) {
  const { units } = useUnits();
  const rings = slab.polygon.rings;
  const [selectedRing, setRing] = useState(0),
    [selectedVertex, setVertex] = useState(0);
  const r = Math.min(selectedRing, rings.length - 1),
    ring = rings[r];
  const i = Math.min(selectedVertex, ring.length - 1),
    v = ring[i],
    j = nextIndex(i, ring.length);
  const [x, setX] = useState(""),
    [y, setY] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    setX(formatUnitInput(v.x, "length", units));
    setY(formatUnitInput(v.y, "length", units));
    setError("");
  }, [v, units]);
  const apply = (
    change: (draft: SlabRing[]) => void,
    split?: { from: string; to: string },
  ) => {
    const draft = structuredClone(rings);
    change(draft);
    try {
      const message = update(normalizeRings(draft), split);
      if (message) throw new Error(message);
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const move = () => {
    const xx = parseUnitInput(x, "length", units, v.x),
      yy = parseUnitInput(y, "length", units, v.y);
    if (xx === null || yy === null) {
      setError("Informe as duas coordenadas do vértice.");
      return;
    }
    apply((draft) => Object.assign(draft[r][i], { x: xx, y: yy }));
  };
  return (
    <div className="slab-contour-fields">
      <p>
        Área líquida ·{" "}
        {formatUnitValue(
          footprintProperties(rings).area * fromSI(1, "length", units) ** 2,
        )}{" "}
        {units.length}²
      </p>
      <label className="stack-field">
        Contorno da laje
        <select
          value={r}
          onChange={(e) => {
            setRing(+e.target.value);
            setVertex(0);
          }}
        >
          {rings.map((_, k) => (
            <option key={k} value={k}>
              {ringName(k)}
            </option>
          ))}
        </select>
      </label>
      <label className="stack-field">
        Vértice da laje
        <select value={i} onChange={(e) => setVertex(+e.target.value)}>
          {ring.map((pt, k) => (
            <option key={pt.edgeId} value={k}>
              {k + 1} · ({formatUnitInput(pt.x, "length", units)},{" "}
              {formatUnitInput(pt.y, "length", units)}) {units.length}
            </option>
          ))}
        </select>
      </label>
      <div className="coordinate-fields">
        {(
          [
            ["X", x, setX],
            ["Y", y, setY],
          ] as const
        ).map(([axis, value, set]) => (
          <label key={axis} className="number-field">
            <span>
              {axis} ({units.length})
            </span>
            <input
              aria-label={`${axis} do vértice`}
              inputMode="decimal"
              value={value}
              onChange={(e) => set(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") move();
              }}
            />
          </label>
        ))}
      </div>
      <button onClick={move}>Aplicar vértice</button>
      <label className="stack-field">
        <span>
          Borda {i + 1} · V{i + 1} → V{j + 1}
        </span>
        <select
          aria-label="Vínculo da borda"
          disabled={sharedEdge === v.edgeId}
          value={
            sharedEdge === v.edgeId ? "joint" : v.supported ? "simple" : "free"
          }
          onChange={(e) =>
            apply((draft) => {
              draft[r][i].supported = e.target.value === "simple";
            })
          }
        >
          {sharedEdge === v.edgeId && (
            <option value="joint">Vínculo entre lajes</option>
          )}
          <option value="simple">Apoio simples</option>
          <option value="free">Livre</option>
        </select>
      </label>
      <button
        onClick={() => {
          const newEdge = uid();
          if (
            apply(
              (draft) => {
                const a = draft[r][i],
                  b = draft[r][j];
                draft[r].splice(i + 1, 0, {
                  x: a.x + (b.x - a.x) / 2,
                  y: a.y + (b.y - a.y) / 2,
                  edgeId: newEdge,
                  supported: a.supported,
                });
              },
              { from: v.edgeId, to: newEdge },
            )
          )
            setVertex(i + 1);
        }}
      >
        Inserir vértice na borda
      </button>
      <button
        disabled={ring.length <= 3}
        onClick={() =>
          apply((draft) => {
            draft[r].splice(i, 1);
          })
        }
      >
        Excluir vértice
      </button>
      {r > 0 && (
        <button
          onClick={() => {
            if (
              apply((draft) => {
                draft.splice(r, 1);
              })
            ) {
              setRing(0);
              setVertex(0);
            }
          }}
        >
          Excluir abertura
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
