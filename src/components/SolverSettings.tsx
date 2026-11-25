import { useState } from "react";
import { Check, FolderOpen, Stethoscope, X } from "lucide-react";
import {
  chooseSolver,
  desktop,
  diagnoseEngine,
  type Diagnostic,
} from "../solver/desktop";
import EngineDetails from "./EngineDetails";
import { unitLabel } from "../units";
import { formatResultQuantity } from "./resultFormatting";
import { useUnits } from "./Units";

export default function SolverSettings({
  executable,
  running,
  onSave,
  onClose,
}: {
  executable: string;
  running: boolean;
  onSave: (path: string) => void;
  onClose: () => void;
}) {
  const { units } = useUnits();
  const [custom, setCustom] = useState(executable);
  const [report, setReport] = useState<Diagnostic | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const native = desktop();
  const changePath = (path: string) => {
    setCustom(path);
    setReport(null);
    setError("");
  };
  const diagnose = async () => {
    setChecking(true);
    setError("");
    setReport(null);
    try {
      setReport(await diagnoseEngine(custom.trim()));
    } catch (error) {
      setError(String(error));
    } finally {
      setChecking(false);
    }
  };
  const choose = async () => {
    try {
      const selected = await chooseSolver();
      if (selected) changePath(selected);
    } catch (error) {
      setError(String(error));
    }
  };

  return (
    <div className="modal-backdrop">
      <section
        className="modal solver-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="solver-title"
      >
        <button
          className="modal-close"
          aria-label="Fechar configurações"
          onClick={onClose}
        >
          <X />
        </button>
        <h2 id="solver-title">Motor OOFEM</h2>
        <p>
          {native
            ? "A instalação do KStruct usa o motor integrado. Preencha o caminho para escolher outro executável."
            : "A análise com o OOFEM está disponível na aplicação desktop. Você pode modelar e exportar a entrada no navegador."}
        </p>
        {native && (
          <>
            <label className="stack-field">
              Caminho alternativo do OOFEM
              <input
                aria-label="Caminho do OOFEM"
                value={custom}
                placeholder="Vazio para usar o motor integrado"
                disabled={checking}
                onChange={(event) => changePath(event.target.value)}
              />
            </label>
            <div className="solver-options">
              <button disabled={checking} onClick={() => void choose()}>
                <FolderOpen size={15} />
                Selecionar arquivo
              </button>
              {custom && (
                <button disabled={checking} onClick={() => changePath("")}>
                  Usar motor integrado
                </button>
              )}
            </div>
            {error && (
              <p role="alert" className="solver-error">
                {error}
              </p>
            )}
            {report && (
              <div
                className={`solver-report ${report.ok ? "success" : "failure"}`}
                role="status"
              >
                <strong>
                  {report.ok ? "Motor disponível" : "Diagnóstico falhou"}
                </strong>
                <p>{report.message}</p>
                {report.engine && <EngineDetails engine={report.engine} />}
                {report.ok && report.benchmark && (
                  <p>
                    Reações{" "}
                    {formatResultQuantity(
                      report.benchmark.leftReactionN,
                      "force",
                      units,
                    )}{" "}
                    e{" "}
                    {formatResultQuantity(
                      report.benchmark.rightReactionN,
                      "force",
                      units,
                    )}{" "}
                    {unitLabel("force", units)} · Flecha{" "}
                    {formatResultQuantity(
                      report.benchmark.midspanUzM,
                      "displacement",
                      units,
                    )}{" "}
                    {unitLabel("displacement", units)}
                  </p>
                )}
                {!report.ok && (report.stdout || report.stderr) && (
                  <pre className="solver-log">
                    {[report.stdout, report.stderr].filter(Boolean).join("\n")}
                  </pre>
                )}
              </div>
            )}
            <div className="modal-actions">
              <button
                disabled={checking || running}
                onClick={() => void diagnose()}
              >
                <Stethoscope size={15} />
                {checking ? "Testando motor…" : "Testar motor"}
              </button>
              <button
                className="primary"
                disabled={checking}
                onClick={() => onSave(custom.trim())}
              >
                <Check size={15} />
                Concluir
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
