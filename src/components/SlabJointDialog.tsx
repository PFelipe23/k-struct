import { useEffect, useRef, useState } from "react";
import type { Project, SlabJoint } from "../domain/model";
import {
  jointPanels,
  jointNames,
  matchingBeams,
  sharedEdges,
  sameEdge,
} from "../domain/slabJoint";
import {
  formatQuantity,
  formatUnitInput,
  parseUnitInput,
  unitLabel,
} from "../units";
import { useUnits } from "./Units";

export function SlabJointDialog({
  project,
  apply,
  close,
}: {
  project: Project;
  apply: (j: SlabJoint) => string | null;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    { units } = useUnits();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const edge = sharedEdges(project)[0],
    joint = project.slabJoint;
  const [kind, setKind] = useState(joint?.kind ?? "hinged"),
    [support, setSupport] = useState(
      joint?.memberId ?? joint?.support ?? "none",
    );
  const [stiffness, setStiffness] = useState(() =>
    joint?.stiffness ? formatUnitInput(joint.stiffness, "moment", units) : "",
  );
  const [error, setError] = useState("");
  const value = parseUnitInput(stiffness, "moment", units, joint?.stiffness);
  const unit = unitLabel("moment", units) + "/(rad·m)";
  const available = !!(edge && joint && sameEdge(joint, edge));
  return (
    <dialog
      ref={dialog}
      className="slab-sizing-dialog slab-joint-dialog"
      aria-label="Vínculo entre lajes"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2>Vínculo entre lajes</h2>
      {available ? (
        <>
          <p>
            {jointPanels(project)
              .map((s) => s.name)
              .join(" ↔ ")}{" "}
            · borda comum de{" "}
            {formatQuantity(
              Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y),
              "length",
              units,
            )}{" "}
            {units.length}
          </p>
          <label className="stack-field">
            Apoio da borda comum
            <select
              value={support}
              onChange={(e) => setSupport(e.target.value)}
            >
              <option value="none">Sem apoio externo</option>
              <option value="line">Apoio vertical de linha</option>
              {matchingBeams(project, edge).map((b) => (
                <option value={b.id} key={b.id}>
                  Viga {b.name}
                </option>
              ))}
            </select>
          </label>
          {!matchingBeams(project, edge).length && (
            <p>
              Para apoiar em viga, lance uma barra entre os dois extremos da
              borda, neste pavimento.
            </p>
          )}
          <label className="stack-field">
            Ligação à flexão
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SlabJoint["kind"])}
            >
              {Object.entries(jointNames).map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {kind === "elastic" && (
            <label className="stack-field">
              Rigidez rotacional por comprimento ({unit})
              <input
                aria-label="Rigidez rotacional por comprimento"
                inputMode="decimal"
                value={stiffness}
                onChange={(e) => setStiffness(e.target.value)}
              />
            </label>
          )}
          <p>
            {kind === "hinged"
              ? "A borda permite rotação relativa livre."
              : kind === "continuous"
                ? "As duas lajes têm a mesma rotação em torno da borda."
                : "O momento por metro é proporcional à diferença de rotação entre as lajes."}
          </p>
        </>
      ) : (
        <p role="alert">
          Alinhe uma borda externa inteira de cada laje no mesmo pavimento para
          editar a ligação.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button onClick={close}>Cancelar</button>
        <button
          disabled={
            !available || (kind === "elastic" && !(value !== null && value > 0))
          }
          onClick={() => {
            if (!edge) return;
            const next: SlabJoint = {
              a: edge.a,
              b: edge.b,
              kind,
              ...(kind === "elastic" ? { stiffness: value! } : {}),
              ...(support === "none" || support === "line"
                ? { support }
                : { support: "beam", memberId: support }),
            };
            const issue = apply(next);
            if (issue) setError(issue);
            else close();
          }}
        >
          Aplicar vínculo
        </button>
      </footer>
    </dialog>
  );
}
