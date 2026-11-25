import { useEffect, useMemo, useRef, useState } from "react";
import { beamStations } from "../domain/beamMesh";
import { connectMeshJoint } from "../domain/editing";
import { interiorParameter } from "../domain/geometry";
import type { Project, SelectedObject } from "../domain/model";
import { formatResult } from "./resultFormatting";

export default function MeshConnections({
  project,
  selection,
  edit,
  onClose,
}: {
  project: Project;
  selection: SelectedObject[];
  edit: (change: (draft: Project) => void) => string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const selectedBars = selection.filter((s) => s.kind === "member");
  const [memberId, setMemberId] = useState(
    selectedBars[0]?.id ?? project.members[0]?.id ?? "",
  );
  const [kind, setKind] = useState<"node" | "member">(
    selectedBars.length > 1 ? "member" : "node",
  );
  const [target, setTarget] = useState(
    selection.find((s) => s.kind === "node")?.id ?? selectedBars[1]?.id ?? "",
  );
  const [count, setCount] = useState(String(project.mesh.segmentsPerMember));
  const [error, setError] = useState("");
  const nodes = useMemo(
    () => new Map(project.nodes.map((n) => [n.id, n])),
    [project.nodes],
  );
  const layout = useMemo(() => beamStations(project), [project]);
  const member = project.members.find((m) => m.id === memberId);
  const stations = layout.get(memberId) ?? [];
  const links = stations.slice(1, -1).filter((s) => s.nodeId);
  const linkedNodes = new Set(links.map((s) => s.nodeId));
  const candidates =
    kind === "member"
      ? project.members.filter((m) => m.id !== memberId)
      : member
        ? project.nodes.filter(
            (n) =>
              !linkedNodes.has(n.id) &&
              interiorParameter(
                n,
                nodes.get(member.start)!,
                nodes.get(member.end)!,
              ) !== null,
          )
        : [];
  const targetId =
    candidates.find((c) => c.id === target)?.id ?? candidates[0]?.id ?? "";
  const validCount =
    Number.isInteger(Number(count)) &&
    Number(count) >= 2 &&
    Number(count) <= 32;
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal mesh-dialog"
      aria-labelledby="mesh-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="mesh-title">Conexões da malha</h2>
      <div className="load-definition-fields" onChange={() => setError("")}>
        <label>
          Barra física
          <select
            aria-label="Barra física"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          >
            {project.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <div className="definition-picker">
          <label>
            Conectar por
            <select
              aria-label="Conectar por"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setTarget("");
              }}
            >
              <option value="node">Nó interno ou encontro em T</option>
              <option value="member">Cruzamento de duas barras em XYZ</option>
            </select>
          </label>
          <label>
            {kind === "node" ? "Nó interno" : "Segunda barra"}
            <select
              aria-label={kind === "node" ? "Nó interno" : "Segunda barra"}
              value={targetId}
              onChange={(e) => setTarget(e.target.value)}
              disabled={!candidates.length}
            >
              {!candidates.length && (
                <option value="">Nenhum disponível</option>
              )}
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!targetId}
            onClick={() =>
              setError(
                edit((p) =>
                  connectMeshJoint(p, memberId, { kind, id: targetId }),
                ) ?? "",
              )
            }
          >
            Conectar
          </button>
        </div>
        <p>
          {kind === "node"
            ? "Lance o nó no interior da barra. Ele pode receber carga, apoio ou a ponta de outra barra."
            : "A ligação cria ou reutiliza um nó no cruzamento. Apenas as duas barras escolhidas passam a compartilhá-lo."}
        </p>
        {member && (
          <section>
            <h3>
              {member.name} · {stations.length - 1} elementos de análise
            </h3>
            {links.length ? (
              <table className="node-editor">
                <thead>
                  <tr>
                    <th>Nó conectado</th>
                    <th>x/L desde i</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {links.map(({ t, nodeId }) => (
                    <tr key={nodeId}>
                      <td>{nodes.get(nodeId!)!.name}</td>
                      <td>{formatResult(t)}</td>
                      <td>
                        <button
                          aria-label={`Desconectar ${nodes.get(nodeId!)!.name} de ${member.name}`}
                          onClick={() =>
                            setError(
                              edit((p) => {
                                p.meshConnections = p.meshConnections.filter(
                                  (l) =>
                                    l.memberId !== memberId ||
                                    l.nodeId !== nodeId,
                                );
                              }) ?? "",
                            )
                          }
                        >
                          Desconectar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>Nenhum nó interno conectado a esta barra.</p>
            )}
          </section>
        )}
        <div className="definition-picker">
          <label>
            Subdivisões regulares por barra
            <input
              aria-label="Subdivisões regulares por barra"
              type="number"
              min="2"
              max="32"
              step="1"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </label>
          <button
            disabled={
              !validCount || Number(count) === project.mesh.segmentsPerMember
            }
            onClick={() =>
              setError(
                edit((p) => {
                  p.mesh.segmentsPerMember = Number(count);
                }) ?? "",
              )
            }
          >
            Aplicar refinamento
          </button>
        </div>
        <p>
          Na vista, ative “Malha de análise” para ver as estações. Os anéis
          indicam conexões internas.
        </p>
        {error && (
          <p role="alert" className="launch-error">
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>Fechar</button>
      </div>
    </dialog>
  );
}
