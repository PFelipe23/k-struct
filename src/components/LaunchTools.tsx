import { useState } from "react";
import { CopyPlus, Grid2X2, ScanLine, Waypoints } from "lucide-react";
import {
  coordinates,
  type Coordinate,
  type PlaneKind,
} from "../domain/geometry";
import { nextName, uid, type Project } from "../domain/model";
import {
  formatQuantity,
  formatUnitInput,
  parseUnitInput,
  parseUnitNumber,
  toSI,
} from "../units";
import { useUnits } from "./Units";

type PlaneControlsProps = {
  inactive: boolean;
  kinds: PlaneKind[];
  kind: PlaneKind;
  guideId: string;
  guides: Project["guides"][Coordinate];
  orthogonal: boolean;
  selected: number;
  onPlane: (kind: PlaneKind) => void;
  onGuide: (id: string) => void;
  toggleOrtho: () => void;
  selectPlane: () => void;
  editGuides: () => void;
  replicate: () => void;
  connect: () => void;
};

const coordinateName = {
  XY: "Pavimento ativo",
  XZ: "Eixo Y ativo",
  YZ: "Eixo X ativo",
};

export function WorkPlaneControls({
  inactive,
  kinds,
  kind,
  guideId,
  guides,
  orthogonal,
  selected,
  onPlane,
  onGuide,
  toggleOrtho,
  selectPlane,
  editGuides,
  replicate,
  connect,
}: PlaneControlsProps) {
  const { units } = useUnits();
  const activeLabel = coordinateName[kind];
  return (
    <fieldset
      className="plane-tools"
      aria-label="Controles do plano ativo"
      disabled={inactive}
    >
      <label>
        <span>Plano</span>
        <select
          aria-label="Plano de trabalho"
          value={kind}
          onChange={(e) => onPlane(e.target.value as PlaneKind)}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k === "XY" ? "Planta" : "Elevação"} {k}
            </option>
          ))}
        </select>
      </label>
      <select
        aria-label={activeLabel}
        title={activeLabel}
        value={guideId}
        onChange={(e) => onGuide(e.target.value)}
      >
        {[...guides]
          .sort((a, b) => a.position - b.position)
          .map((g) => (
            <option value={g.id} key={g.id}>
              {g.name} · {formatQuantity(g.position, "length", units)}{" "}
              {units.length}
            </option>
          ))}
      </select>
      <button
        onClick={toggleOrtho}
        aria-pressed={orthogonal}
        title="Restringir barras a direções ortogonais no plano. Shift inverte temporariamente."
      >
        Orto
      </button>
      <button onClick={editGuides} title="Editar eixos e pavimentos">
        <Grid2X2 size={14} /> Eixos e pavimentos
      </button>
      <button
        onClick={selectPlane}
        title="Selecionar nós e barras do plano ativo"
      >
        <ScanLine size={14} /> Selecionar plano
      </button>
      <button
        onClick={replicate}
        disabled={!selected}
        title="Mover, espelhar ou replicar a seleção"
      >
        <CopyPlus size={14} /> Replicar
      </button>
      <button
        onClick={connect}
        title="Conectar interseções e nós no interior das barras"
      >
        <Waypoints size={14} /> Conectar interseções
      </button>
    </fieldset>
  );
}

const groups = { x: "Eixos X", y: "Eixos Y", z: "Pavimentos" };
const numeric = (v: string) => parseUnitNumber(v) ?? NaN;

export function GuideEditor({
  guides,
  onApply,
  onClose,
}: {
  guides: Project["guides"];
  onApply: (guides: Project["guides"]) => string | null;
  onClose: () => void;
}) {
  const { units } = useUnits();
  const [axis, setAxis] = useState<Coordinate>("x");
  const toDraft = (k: Coordinate) =>
    guides[k].map((g) => ({
      ...g,
      position: formatUnitInput(g.position, "length", units),
    }));
  const [draft, setDraft] = useState(() => ({
    x: toDraft("x"),
    y: toDraft("y"),
    z: toDraft("z"),
  }));
  const [error, setError] = useState("");
  const rows = draft[axis];
  return (
    <div className="modal-backdrop">
      <section
        className="modal launch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guides-title"
      >
        <h2 id="guides-title">Eixos e pavimentos</h2>
        <p>
          Defina as linhas de referência e os planos de lançamento. Edite as
          coordenadas dos nós no painel de propriedades.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const convert = (k: Coordinate) =>
              draft[k].map((g) => ({
                ...g,
                name: g.name.trim(),
                position:
                  parseUnitInput(
                    g.position,
                    "length",
                    units,
                    guides[k].find(({ id }) => id === g.id)?.position,
                  ) ?? NaN,
              }));
            const next = { x: convert("x"), y: convert("y"), z: convert("z") };
            if (
              Object.values(next)
                .flat()
                .some((g) => !g.name || !Number.isFinite(g.position))
            ) {
              setError(
                "Informe um nome e uma posição válida para cada referência.",
              );
              return;
            }
            const problem = onApply(next);
            if (problem) setError(problem);
            else onClose();
          }}
        >
          <div className="guide-tabs" aria-label="Referências do modelo">
            {coordinates.map((k) => (
              <button
                type="button"
                key={k}
                aria-pressed={axis === k}
                onClick={() => setAxis(k)}
              >
                {groups[k]}
              </button>
            ))}
          </div>
          <div className="guide-table">
            {rows.map((g, i) => (
              <div className="guide-row" key={g.id}>
                <label>
                  Nome
                  <input
                    aria-label={`Nome da referência ${i + 1}`}
                    maxLength={120}
                    value={g.name}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [axis]: rows.map((item) =>
                          item.id === g.id
                            ? { ...item, name: e.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Posição ({units.length})
                  <input
                    aria-label={`Posição da referência ${i + 1}`}
                    inputMode="decimal"
                    value={g.position}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [axis]: rows.map((item) =>
                          item.id === g.id
                            ? { ...item, position: e.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={rows.length <= 1}
                  aria-label={`Remover referência ${i + 1}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      [axis]: rows.filter((item) => item.id !== g.id),
                    })
                  }
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={rows.length >= 40}
            onClick={() => {
              const end = Math.max(
                0,
                ...rows
                  .map((g) => toSI(numeric(g.position), "length", units))
                  .filter(Number.isFinite),
              );
              setDraft({
                ...draft,
                [axis]: [
                  ...rows,
                  {
                    id: uid(),
                    name: nextName(axis === "z" ? "Pav. " : "Eixo ", rows),
                    position: formatUnitInput(
                      end + (axis === "z" ? 3 : 4),
                      "length",
                      units,
                    ),
                  },
                ],
              });
            }}
          >
            Adicionar referência
          </button>
          {error && (
            <p role="alert" className="launch-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="primary">
              Aplicar referências
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
