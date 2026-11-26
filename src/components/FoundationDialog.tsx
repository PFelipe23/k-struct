import { useEffect, useRef, useState } from "react";
import { globalFoundationMatrix, type Foundation } from "../domain/foundation";
import { parseFoundationCsv } from "../domain/foundationCsv";
import { coordinates, origin } from "../domain/geometry";
import { free, type Project, type StructuralNode } from "../domain/model";
import {
  hasSupport,
  supportBasis,
  type SupportFrame,
} from "../domain/supports";
import {
  formatUnitInput,
  formatUnitValue,
  parseUnitInput,
  parseUnitNumber,
} from "../units";
import { useUnits } from "./Units";

const axisTitles = [
  "UX (m)",
  "UY (m)",
  "UZ (m)",
  "RX (rad)",
  "RY (rad)",
  "RZ (rad)",
];
const forceTitles = [
  "FX (kN)",
  "FY (kN)",
  "FZ (kN)",
  "MX (kN·m)",
  "MY (kN·m)",
  "MZ (kN·m)",
];

export default function FoundationDialog({
  node,
  edit,
  onClose,
}: {
  node: StructuralNode;
  edit: (fn: (p: Project) => void) => string | null | void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const readId = useRef(0);
  const { units } = useUnits();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      readId.current++;
      element.close();
    };
  }, []);
  const previous = node.foundation;
  const [source, setSource] = useState(previous);
  const [axes, setAxes] = useState(
    previous ? (node.supportFrame ? "local" : "global") : "",
  );
  const base =
    node.supportFrame?.kind === "spatial" ? node.supportFrame : supportBasis();
  const [directions, setDirections] = useState(() =>
    [base.x, base.y].flatMap((v) => coordinates.map((k) => String(v[k]))),
  );
  const [reference, setReference] = useState<Foundation["reference"] | "">(
    previous?.reference ?? "",
  );
  const [delta, setDelta] = useState(() =>
    coordinates.map((k) =>
      formatUnitInput(previous?.offset[k] ?? 0, "length", units),
    ),
  );
  const [transformed, setTransformed] = useState(false);
  const [error, setError] = useState("");
  const [newFile, setNewFile] = useState(false);
  const replace = hasSupport(node) && (!previous || newFile);
  let candidate: Foundation | undefined,
    frame: SupportFrame | undefined,
    global: number[][] | undefined,
    problem = "";
  if (source && axes && reference) {
    try {
      if (axes === "local") {
        const values = directions.map(parseUnitNumber);
        if (values.some((v) => v === null))
          throw new Error("Preencha as seis componentes dos eixos locais.");
        const [x, y, z, a, b, c] = values as number[];
        frame = { kind: "spatial", x: { x, y, z }, y: { x: a, y: b, z: c } };
        supportBasis(frame);
      }
      const offset = { ...origin };
      if (reference === "offset")
        coordinates.forEach((k, i) => {
          const v = parseUnitInput(delta[i], "length", units, source.offset[k]);
          if (v === null)
            throw new Error(
              "Informe as três componentes do vetor do nó à origem da matriz.",
            );
          offset[k] = v;
        });
      const value = { ...source, offset, reference };
      global = globalFoundationMatrix(value, frame);
      candidate = value;
    } catch (e) {
      problem = (e as Error).message;
    }
  }
  async function read(file?: File) {
    if (!file) return;
    const id = ++readId.current;
    setError("");
    setSource(undefined);
    setTransformed(false);
    setNewFile(true);
    setAxes("");
    setReference("");
    setDelta(["0", "0", "0"]);
    try {
      if (file.size > 256 * 1024)
        throw new Error("O CSV de matriz excede 256 KiB.");
      const data = parseFoundationCsv(await file.text(), file.name);
      if (readId.current === id) setSource(data);
    } catch (e) {
      if (readId.current === id) setError((e as Error).message);
    }
  }
  function save() {
    if (!candidate) return;
    const value = candidate;
    const message = edit((p) => {
      const target = p.nodes.find((n) => n.id === node.id)!;
      if (replace) {
        target.restraints = free();
        delete target.springs;
      }
      target.foundation = value;
      if (frame) target.supportFrame = frame;
      else delete target.supportFrame;
    });
    if (message) setError(message);
    else onClose();
  }
  const matrix = transformed && global ? global : source?.matrix;
  return (
    <dialog
      ref={dialog}
      className="modal launch-modal foundation-dialog"
      aria-labelledby="foundation-title"
      onCancel={onClose}
    >
      <h2 id="foundation-title">Fundação do MolaStruct · {node.name}</h2>
      <label className="stack-field">
        Arquivo de matriz 6 × 6 (CSV)
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => void read(e.target.files?.[0])}
        />
      </label>
      {source && (
        <>
          <p>
            <strong>{source.name}</strong> · {source.fileName}
          </p>
          {source.reflected && (
            <p>
              Cópia espelhada. O eixo z do CSV é oposto ao z da base local de
              mão direita. O vetor de origem é expresso nos eixos originais do
              CSV.
            </p>
          )}
          <div className="selection-fields">
            <label className="stack-field">
              Eixos da matriz
              <select value={axes} onChange={(e) => setAxes(e.target.value)}>
                <option value="">Selecione os eixos</option>
                <option value="global">Eixos globais do modelo</option>
                <option value="local">Definir eixos locais</option>
              </select>
            </label>
            <label className="stack-field">
              Ponto de referência da matriz
              <select
                value={reference}
                onChange={(e) =>
                  setReference(e.target.value as Foundation["reference"] | "")
                }
              >
                <option value="">Selecione a origem</option>
                <option value="node">No próprio nó</option>
                <option value="offset">Deslocado do nó</option>
              </select>
            </label>
          </div>
          {axes === "local" && (
            <fieldset>
              <legend>Direções locais em coordenadas globais</legend>
              <p>
                Indique x e uma direção para y. O eixo z segue a regra da mão
                direita.
              </p>
              <div className="foundation-vectors">
                {["x", "y"].flatMap((axis, i) =>
                  coordinates.map((k, j) => (
                    <label key={axis + k}>
                      {axis} local · {k.toUpperCase()}
                      <input
                        inputMode="decimal"
                        value={directions[3 * i + j]}
                        onChange={(e) =>
                          setDirections(
                            directions.map((v, h) =>
                              h === 3 * i + j ? e.target.value : v,
                            ),
                          )
                        }
                      />
                    </label>
                  )),
                )}
              </div>
            </fieldset>
          )}
          {reference === "offset" && (
            <fieldset>
              <legend>Vetor do nó à origem do CSV, nos eixos da matriz</legend>
              <div className="foundation-vectors">
                {coordinates.map((k, i) => (
                  <label key={k}>
                    Δ{k.toUpperCase()} ({units.length})
                    <input
                      inputMode="decimal"
                      value={delta[i]}
                      onChange={(e) =>
                        setDelta(
                          delta.map((v, h) => (h === i ? e.target.value : v)),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="stack-field">
            Visualizar matriz
            <select
              value={transformed && global ? "node" : "source"}
              onChange={(e) => setTransformed(e.target.value === "node")}
            >
              <option value="source">
                Na origem do CSV, nos eixos da fundação
              </option>
              <option value="node" disabled={!global}>
                No nó, nos eixos globais
              </option>
            </select>
          </label>
          <div className="foundation-table">
            <table aria-label="Matriz de rigidez 6 por 6">
              <thead>
                <tr>
                  <th scope="col">Ação / movimento</th>
                  {axisTitles.map((s) => (
                    <th scope="col" key={s}>
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix?.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">{forceTitles[i]}</th>
                    {row.map((v, j) => (
                      <td key={j}>{formatUnitValue(v / 1000)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            GDL livres na origem do CSV:{" "}
            {source.freeDofs.map((k) => k.toUpperCase()).join(", ") || "nenhum"}
            .
          </p>
          <details>
            <summary>Metadados do CSV</summary>
            <dl>
              {source.metadata.map(([label, ...v], i) => (
                <div key={i}>
                  <dt>{label}</dt>
                  <dd>{v.join(" · ")}</dd>
                </div>
              ))}
            </dl>
          </details>
          {replace && (
            <p>
              Ao confirmar, a matriz substituirá os vínculos e as molas atuais
              de {node.name}.
            </p>
          )}
        </>
      )}
      {(error || problem) && (
        <p role="alert" className="launch-error">
          {error || problem}
        </p>
      )}
      <footer className="modal-actions">
        {previous && (
          <button
            onClick={() => {
              const message = edit((p) => {
                delete p.nodes.find((n) => n.id === node.id)!.foundation;
              });
              if (message) setError(message);
              else onClose();
            }}
          >
            Remover matriz
          </button>
        )}
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={!candidate} onClick={save}>
          {replace
            ? "Substituir apoio"
            : previous
              ? "Aplicar alterações"
              : "Associar fundação"}
        </button>
      </footer>
    </dialog>
  );
}
