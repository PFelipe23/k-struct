import { useEffect, useMemo, useRef, useState } from "react";
import type { Slab, SlabSizing } from "../domain/model";
import { slabRings, ringName, slabProperties } from "../domain/slabPolygon";
import { previewSlabMesh } from "../domain/slabQuality";
import { targetMeshLimit } from "../domain/slabSizing";
import {
  formatUnitInput,
  formatUnitValue,
  parseUnitInput,
  formatQuantity,
} from "../units";
import { useUnits } from "./Units";

export default function SlabMeshControl({
  slab,
  onApply,
}: {
  slab: Slab;
  onApply: (s?: SlabSizing) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Configurar malha da laje</button>
      {open && (
        <MeshDialog
          slab={slab}
          apply={(s) => {
            onApply(s);
            setOpen(false);
          }}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
function MeshDialog({
  slab,
  apply,
  close,
}: {
  slab: Slab;
  apply: (s?: SlabSizing) => void;
  close: () => void;
}) {
  const { units } = useUnits(),
    ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const rings = useMemo(() => slabRings(slab), [slab]);
  const [targetMode, setTargetMode] = useState(!!slab.sizing);
  const [target, setTarget] = useState(() =>
    formatUnitInput(
      slab.sizing?.target ?? Math.sqrt(slabProperties(slab).area) / 8,
      "length",
      units,
    ),
  );
  const [entries, setEntries] = useState(() => slab.sizing?.edges ?? []);
  const [scope, setScope] = useState("supports"),
    [size, setSize] = useState(""),
    [message, setMessage] = useState(""),
    [picked, setPicked] = useState(0);
  const options = rings.flatMap((ring, r) =>
    ring.map((v, i) => ({
      id: v.edgeId,
      name: `${ringName(r)} · borda ${i + 1}`,
      r,
      supported: v.supported,
    })),
  );
  const ids = options
    .filter((o) =>
      scope === "supports"
        ? o.supported
        : scope.startsWith("ring:")
          ? o.r === Number(scope.slice(5))
          : scope === "edge:" + o.id,
    )
    .map((o) => o.id);
  const h = parseUnitInput(target, "length", units, slab.sizing?.target),
    local = parseUnitInput(size, "length", units);
  const sizing = useMemo(
    () => (targetMode ? { target: h ?? 0, edges: entries } : undefined),
    [targetMode, h, entries],
  );
  const preview = useMemo(
    () => previewSlabMesh({ ...slab, sizing }),
    [slab, sizing],
  );
  const { mesh, quality } = preview,
    invalid = quality?.issues.filter((i) => i.level === "invalid") ?? [],
    warnings = quality?.issues.filter((i) => i.level === "warning") ?? [];
  const bad = new Map(quality?.issues.map((i) => [i.element, i]));
  const vertices = rings[0],
    left = Math.min(...vertices.map((v) => v.x)),
    right = Math.max(...vertices.map((v) => v.x)),
    bottom = Math.min(...vertices.map((v) => v.y)),
    top = Math.max(...vertices.map((v) => v.y));
  const span = Math.max(right - left, top - bottom),
    pad = span * 0.04;
  const selected = mesh?.elements.find((el) => el.number === picked);
  const selectedIssue = quality?.issues.find(
    (issue) => issue.element === picked,
  );
  const location =
    selectedIssue?.at ??
    (selected &&
      selected.nodes.reduce(
        (p, id) => ({
          x: p.x + mesh!.nodes[id - 1].x / selected.nodes.length,
          y: p.y + mesh!.nodes[id - 1].y / selected.nodes.length,
        }),
        { x: 0, y: 0 },
      ));
  return (
    <dialog
      ref={ref}
      aria-label="Malha da laje"
      className="slab-sizing-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2>Malha da laje {slab.name}</h2>
      <div className="slab-sizing-body">
        <div>
          <label className="stack-field">
            Geração da malha
            <select
              value={targetMode ? "target" : "legacy"}
              onChange={(e) => {
                setTargetMode(e.target.value === "target");
                setPicked(0);
              }}
            >
              <option value="legacy">
                {slab.polygon ? "Refinamentos uniformes" : "Subdivisões em X/Y"}
              </option>
              <option value="target">Tamanho-alvo</option>
            </select>
          </label>
          {targetMode && (
            <>
              <label className="stack-field">
                Tamanho-alvo global ({units.length})
                <input
                  aria-label="Tamanho-alvo global"
                  inputMode="decimal"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setPicked(0);
                  }}
                />
              </label>
              <label className="stack-field">
                Refinar junto a
                <select
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value);
                    setMessage("");
                  }}
                >
                  <option value="supports">Bordas apoiadas</option>
                  {rings.map((_, r) => (
                    <option key={r} value={`ring:${r}`}>
                      Todas as bordas · {ringName(r)}
                    </option>
                  ))}
                  {options.map((o) => (
                    <option key={o.id} value={"edge:" + o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="stack-field">
                Tamanho local ({units.length})
                <input
                  aria-label="Tamanho local"
                  value={size}
                  inputMode="decimal"
                  onChange={(e) => setSize(e.target.value)}
                />
              </label>
              <button
                disabled={!ids.length}
                onClick={() => {
                  if (local === null || h === null || local <= 0 || local > h) {
                    setMessage(
                      "Informe tamanho local positivo até o tamanho global.",
                    );
                    return;
                  }
                  const updated = new Map(
                    entries.map((e) => [e.edgeId, e.size]),
                  );
                  for (const id of ids) updated.set(id, local);
                  setEntries(
                    options
                      .filter((o) => updated.has(o.id))
                      .map((o) => ({ edgeId: o.id, size: updated.get(o.id)! })),
                  );
                  setSize("");
                  setMessage("");
                  setPicked(0);
                }}
              >
                Adicionar controle à prévia
              </button>
              {message && <p role="alert">{message}</p>}
              <ul>
                {entries.map((e) => (
                  <li key={e.edgeId}>
                    {options.find((o) => o.id === e.edgeId)?.name} ·{" "}
                    {formatQuantity(e.size, "length", units)} {units.length}{" "}
                    <button
                      aria-label={`Remover controle ${options.find((o) => o.id === e.edgeId)?.name}`}
                      onClick={() =>
                        setEntries(
                          entries.filter((item) => item.edgeId !== e.edgeId),
                        )
                      }
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>
            Limite por tamanho-alvo · {targetMeshLimit} elementos e{" "}
            {targetMeshLimit} nós.
          </p>
        </div>
        <div>
          <svg
            role="img"
            aria-label="Prévia da malha da laje"
            viewBox={`${left - pad} ${-top - pad} ${right - left + 2 * pad} ${top - bottom + 2 * pad}`}
          >
            {mesh?.elements.map((el) => (
              <polygon
                key={el.number}
                data-element={el.number}
                data-quality={bad.get(el.number)?.level ?? "ok"}
                data-picked={el.number === picked}
                points={el.nodes
                  .map(
                    (id) => `${mesh.nodes[id - 1].x},${-mesh.nodes[id - 1].y}`,
                  )
                  .join(" ")}
                onClick={() => setPicked(el.number)}
              >
                <title>
                  Elemento {el.number} ·{" "}
                  {bad.get(el.number)?.reason ?? "Regular"}
                </title>
              </polygon>
            ))}
          </svg>
          {preview.error ? (
            <p role="alert">{preview.error}</p>
          ) : (
            <>
              <p aria-label="Contagem da malha">
                {mesh!.elements.length} elementos · {mesh!.nodes.length} nós ·{" "}
                {invalid.length} inválidos · {warnings.length} alertas
              </p>
              <p>
                {quality!.minAngle !== null
                  ? `Ângulo mínimo ${formatUnitValue(quality!.minAngle)}°`
                  : `Jacobiano mínimo ${formatUnitValue(quality!.minJacobian!)} m² · razão de distorção ${formatUnitValue(quality!.minRatio)}`}
              </p>
              {!!quality!.issues.length && (
                <label className="stack-field">
                  Ocorrências de qualidade
                  <select
                    value={bad.has(picked) ? picked : ""}
                    onChange={(e) => setPicked(+e.target.value)}
                  >
                    <option value="">Escolher ocorrência</option>
                    {quality!.issues.map((v, i) => (
                      <option key={i} value={v.element}>
                        {v.level === "invalid" ? "Inválido" : "Alerta"} ·
                        elemento {v.element} · {v.reason}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {location && (
                <p>
                  {selected
                    ? `Elemento ${selected.number}`
                    : "Contorno do painel"}{" "}
                  · X {formatQuantity(location.x, "length", units)} · Y{" "}
                  {formatQuantity(location.y, "length", units)} {units.length}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <footer>
        <button onClick={close}>Cancelar</button>
        <button
          disabled={!!preview.error || !!invalid.length}
          onClick={() => apply(sizing)}
        >
          Aplicar malha
        </button>
      </footer>
    </dialog>
  );
}
