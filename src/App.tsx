import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  Box,
  ChevronDown,
  CircleDot,
  FilePlus2,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  MousePointer2,
  MoveUpRight,
  Trash2,
  Play,
  Settings2,
  ShieldCheck,
  Download,
  Layers3,
  BookOpen,
  GitBranch,
  History,
  Square,
  PanelLeft,
  PanelRight,
  Columns2,
} from "lucide-react";
import {
  addPoint,
  nextName,
  beamExample,
  createProject,
  parseProject,
  removeSelection,
  serializeProject,
  uid,
  type Project,
  type Selection,
} from "./domain/model";
import { historyReducer } from "./domain/history";
import Elevation, { type Display, type Tool } from "./components/Elevation";
import SpatialView from "./components/SpatialView";
import Inspector from "./components/Inspector";
import Results from "./components/Results";
import SolverSettings from "./components/SolverSettings";
import RunHistory from "./components/RunHistory";
import { version } from "../package.json";
import {
  exportOofem,
  parseOofemOutput,
  type AnalysisResult,
} from "./solver/oofem";
import {
  analyze,
  cancelAnalysis,
  desktop,
  exportFile,
  openProject,
  saveProject,
  type RunLog,
} from "./solver/desktop";

const initial = () => {
  try {
    const cached = localStorage.getItem("kstruct.draft.v1");
    if (cached) return parseProject(cached);
  } catch {
    /* Corrupted drafts never prevent opening the editor. */
  }
  return createProject();
};
export default function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    current: initial(),
    future: [],
  }));
  const p = history.current;
  const [selection, setSelection] = useState<Selection>(null),
    [tool, setTool] = useState<Tool>("select");
  const [pending, setPending] = useState<{ x: number; z: number } | null>(null),
    [display, setDisplay] = useState<Display>("model");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeRun, setActiveRun] = useState<{
    id: string;
    ready: boolean;
    cancelling: boolean;
  } | null>(null);
  const activeRunId = useRef<string | null>(null);
  const running = activeRun !== null;
  const [lastLog, setLastLog] = useState<RunLog | null>(null);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [message, setMessage] = useState(
    "Pronto para modelar. Selecione Barra (B) e marque os pontos na vista XZ, ou abra a viga de referência.",
  );
  const [saved, setSaved] = useState(serializeProject(p));
  const [tab, setTab] = useState("Modelo"),
    [settings, setSettings] = useState(false),
    [left, setLeft] = useState(true),
    [right, setRight] = useState(true),
    [dual, setDual] = useState(true);
  const [executable, setExecutable] = useState(() => {
    try {
      return localStorage.getItem("kstruct.oofem.path") ?? "";
    } catch {
      return "";
    }
  });
  const [caseId, setCaseId] = useState(p.analysisCases[0].id),
    [patternId, setPatternId] = useState(p.loadPatterns[0].id);
  const [confirmation, setConfirmation] = useState<{
    label: string;
    action: () => void;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    current = useRef(p);
  current.current = p;
  const serialized = serializeProject(p),
    dirty = serialized !== saved;
  useEffect(() => {
    setResult(null);
    setDisplay("model");
    try {
      localStorage.setItem("kstruct.draft.v1", serialized);
    } catch {
      setMessage(
        "Não foi possível guardar o rascunho automático. Salve o projeto em arquivo.",
      );
    }
  }, [serialized]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  const edit = useCallback((fn: (p: Project) => void) => {
    const next = structuredClone(current.current);
    fn(next);
    if (serializeProject(next) !== serializeProject(current.current)) {
      setResult(null);
      setDisplay("model");
    }
    dispatch({ type: "change", project: next });
  }, []);
  const changeTool = (t: Tool) => {
    setTool(t);
    setPending(null);
    setDisplay("model");
  };
  const replace = (project: Project) => {
    setResult(null);
    dispatch({ type: "reset", project });
    setSelection(null);
    setPending(null);
    setCaseId(project.analysisCases[0].id);
    setPatternId(project.loadPatterns[0].id);
    setSaved(serializeProject(project));
    setMessage(`Projeto aberto: ${project.name}.`);
    changeTool("select");
  };
  const protect = (label: string, action: () => void) => {
    if (dirty) setConfirmation({ label, action });
    else action();
  };
  const save = async () => {
    try {
      const project = current.current;
      const snapshot = serializeProject(project);
      if (await saveProject(project)) {
        setSaved(snapshot);
        setMessage("Projeto salvo.");
      }
    } catch (e) {
      setMessage(String(e));
    }
  };
  const open = async () => {
    try {
      if (desktop()) {
        const loaded = await openProject();
        if (loaded) replace(loaded);
      } else fileInput.current?.click();
    } catch (e) {
      setMessage(String(e));
    }
  };
  const remove = () => {
    edit((p) => removeSelection(p, selection));
    setSelection(null);
    setPending(null);
  };
  const undo = () => {
    setResult(null);
    setDisplay("model");
    dispatch({ type: "undo" });
    setSelection(null);
    setPending(null);
  };
  const redo = () => {
    setResult(null);
    setDisplay("model");
    dispatch({ type: "redo" });
    setSelection(null);
    setPending(null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (settings || confirmation || showRunHistory) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        (e.target as HTMLElement).blur();
        setTimeout(() => void save(), 0);
        return;
      }
      if ((e.target as HTMLElement).closest("input,textarea,select,button"))
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === "Escape") {
        changeTool("select");
        setSelection(null);
      }
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key.toLowerCase() === "b") changeTool("member");
        if (e.key.toLowerCase() === "n") changeTool("node");
        if (e.key.toLowerCase() === "v") changeTool("select");
        if (e.key === "Delete") remove();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const onPoint = (x: number, z: number) => {
    if (tool === "node") {
      edit((p) => {
        const n = addPoint(p, x, z);
        setSelection({ kind: "node", id: n.id });
      });
      return;
    }
    if (tool !== "member") return;
    if (!pending) {
      setPending({ x, z });
      return;
    }
    if (Math.hypot(x - pending.x, z - pending.z) < 1e-6) {
      setMessage("Escolha uma extremidade diferente para a barra.");
      return;
    }
    edit((p) => {
      const a = addPoint(p, pending.x, pending.z),
        b = addPoint(p, x, z);
      if (
        p.members.some(
          (m) =>
            (m.start === a.id && m.end === b.id) ||
            (m.start === b.id && m.end === a.id),
        )
      ) {
        setMessage("Já existe uma barra entre esses nós.");
        return;
      }
      const id = uid();
      p.members.push({
        id,
        name: nextName("B", p.members),
        start: a.id,
        end: b.id,
        sectionId: p.sections[0].id,
      });
      setSelection({ kind: "member", id });
    });
    setPending(null);
  };
  const run = async () => {
    if (activeRunId.current) return;
    const id = uid();
    activeRunId.current = id;
    setActiveRun({ id, ready: false, cancelling: false });
    setResult(null);
    setDisplay("model");
    const snapshot = serializeProject(p),
      requestedCase = caseId;
    try {
      const { execution, input } = await analyze(
        p,
        caseId,
        executable,
        id,
        () => {
          setActiveRun((active) =>
            active?.id === id ? { ...active, ready: true } : active,
          );
        },
      );
      setLastLog(execution.log);
      const historyNotice = execution.historyError
        ? `\n${execution.historyError}`
        : "";
      if (
        execution.log.summary.status !== "completed" ||
        execution.output === null
      ) {
        setMessage(`${execution.log.summary.message}${historyNotice}`);
        return;
      }
      if (serializeProject(current.current) !== snapshot) {
        setMessage(
          `O modelo mudou durante a análise. Execute novamente para obter resultados atuais.${historyNotice}`,
        );
        return;
      }
      setResult(parseOofemOutput(execution.output, input));
      setDisplay("m");
      setMessage(
        `Análise concluída · ${requestedCase}\nEquilíbrio global verificado. Consulte reações, deslocamentos e esforços.${historyNotice}`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      activeRunId.current = null;
      setActiveRun(null);
    }
  };
  const cancel = async () => {
    if (!activeRun?.ready || activeRun.cancelling) return;
    const { id } = activeRun;
    setActiveRun({ ...activeRun, cancelling: true });
    try {
      if (await cancelAnalysis(id)) return;
    } catch (e) {
      if (activeRunId.current === id) setMessage(String(e));
    }
    setActiveRun((active) =>
      active?.id === id ? { ...active, cancelling: false } : active,
    );
  };
  const exportDeck = async () => {
    try {
      if (await exportFile("analysis.in", exportOofem(p, caseId).deck))
        setMessage("Entrada OOFEM exportada em unidades SI (N, m, kg, s).");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <span>
            KStruct<small>OPENSTRUCT</small>
          </span>
        </div>
        <div className="quick-actions">
          <button
            title="Novo projeto"
            aria-label="Novo projeto"
            onClick={() =>
              protect("Criar um novo projeto", () => replace(createProject()))
            }
          >
            <FilePlus2 size={17} />
          </button>
          <button
            title="Abrir projeto"
            aria-label="Abrir projeto"
            onClick={() => protect("Abrir outro projeto", () => void open())}
          >
            <FolderOpen size={17} />
          </button>
          <button
            title="Salvar projeto (Ctrl+S)"
            aria-label="Salvar projeto"
            onClick={() => void save()}
          >
            <Save size={17} />
          </button>
          <span className="separator" />
          <button
            title="Desfazer (Ctrl+Z)"
            aria-label="Desfazer"
            disabled={!history.past.length}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            title="Refazer (Ctrl+Shift+Z)"
            aria-label="Refazer"
            disabled={!history.future.length}
            onClick={redo}
          >
            <Redo2 size={17} />
          </button>
        </div>
        <div className="project-title">
          <input
            aria-label="Nome do projeto"
            value={p.name}
            maxLength={120}
            onChange={(e) => {
              if (e.target.value.trim())
                edit((p) => {
                  p.name = e.target.value;
                });
            }}
          />
          <span>{dirty ? "Modificado" : "Rascunho local"}</span>
        </div>
        <div className="version">
          {version} <span>ALPHA</span>
        </div>
        <button
          title="Configurar OOFEM"
          aria-label="Configurar OOFEM"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={18} />
        </button>
      </header>
      <nav className="ribbon-tabs">
        {["Modelo", "Análise", "Exibição"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <span className="ribbon-caption">
          Análise estrutural por elementos finitos
        </span>
      </nav>
      <div className="ribbon">
        {tab === "Modelo" && (
          <>
            <div className="ribbon-group">
              <div className="ribbon-tools">
                {(
                  [
                    ["select", "Selecionar", MousePointer2, "V"],
                    ["node", "Nó", CircleDot, "N"],
                    ["member", "Barra", MoveUpRight, "B"],
                  ] as const
                ).map(([key, label, Icon, shortcut]) => (
                  <button
                    key={key}
                    className={`tool-button ${tool === key ? "active" : ""}`}
                    onClick={() => changeTool(key)}
                    title={`${label} (${shortcut})`}
                  >
                    <Icon size={21} />
                    <span>{label}</span>
                    <kbd>{shortcut}</kbd>
                  </button>
                ))}
                <button
                  className="tool-button"
                  disabled={!selection}
                  onClick={remove}
                >
                  <Trash2 size={19} />
                  <span>Excluir</span>
                </button>
              </div>
              <small>LANÇAMENTO</small>
            </div>
            <div className="ribbon-group loads-group">
              <label>
                Padrão de cargas
                <select
                  aria-label="Padrão de cargas"
                  value={patternId}
                  onChange={(e) => setPatternId(e.target.value)}
                >
                  {p.loadPatterns.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <small>ATRIBUIÇÕES NO PAINEL DE PROPRIEDADES</small>
            </div>
            <div className="ribbon-group">
              <button
                className="example-button"
                onClick={() =>
                  protect("Abrir a viga de referência", () =>
                    replace(beamExample()),
                  )
                }
              >
                <BookOpen size={18} />
                <span>
                  Viga de referência<small>6 m · 10 kN/m</small>
                </span>
              </button>
              <small>MODELO DE VALIDAÇÃO</small>
            </div>
          </>
        )}
        {tab === "Análise" && (
          <>
            <div className="ribbon-group">
              <button className="tool-button" onClick={exportDeck}>
                <Download size={21} />
                <span>Entrada OOFEM</span>
              </button>
              <small>EXPORTAR MODELO</small>
            </div>
            <div className="ribbon-group">
              <button className="tool-button" onClick={() => setSettings(true)}>
                <Settings2 size={21} />
                <span>Configurar motor</span>
              </button>
              <small>SOLVER NATIVO</small>
            </div>
            {desktop() && (
              <div className="ribbon-group">
                <button
                  className="tool-button"
                  aria-label="Histórico de análises"
                  onClick={() => setShowRunHistory(true)}
                >
                  <History size={21} />
                  <span>Histórico</span>
                </button>
              </div>
            )}
            <div className="analysis-description">
              <b>Estática linear no plano XZ</b>
              <span>
                Euler–Bernoulli · {p.mesh.segmentsPerMember} elementos por barra
              </span>
              <span>
                Peso próprio aplicado manualmente como carga distribuída
              </span>
            </div>
          </>
        )}
        {tab === "Exibição" && (
          <div className="ribbon-group">
            <div className="ribbon-tools">
              <button
                className={`tool-button ${left ? "active" : ""}`}
                onClick={() => setLeft((v) => !v)}
              >
                <PanelLeft />
                <span>Explorador</span>
              </button>
              <button
                className={`tool-button ${right ? "active" : ""}`}
                onClick={() => setRight((v) => !v)}
              >
                <PanelRight />
                <span>Propriedades</span>
              </button>
              <button
                className={`tool-button ${dual ? "active" : ""}`}
                onClick={() => setDual((v) => !v)}
              >
                <Columns2 />
                <span>Duas vistas</span>
              </button>
            </div>
            <small>ÁREA DE TRABALHO</small>
          </div>
        )}
        <div className="run-group">
          <label>
            Caso de análise
            <select
              aria-label="Caso de análise"
              disabled={running}
              value={caseId}
              onChange={(e) => {
                setCaseId(e.target.value);
                setResult(null);
                setDisplay("model");
              }}
            >
              {p.analysisCases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="run-button"
            disabled={running}
            onClick={() => void run()}
          >
            <Play size={15} fill="currentColor" />
            {running ? "Analisando…" : "Analisar"}
          </button>
          {activeRun?.ready && (
            <button
              className="cancel-analysis"
              aria-label="Cancelar análise"
              title="Cancelar análise"
              disabled={activeRun.cancelling}
              onClick={() => void cancel()}
            >
              <Square size={14} />
              {activeRun.cancelling ? "Cancelando…" : "Cancelar"}
            </button>
          )}
        </div>
      </div>
      <div className="workspace">
        {left && (
          <aside className="explorer">
            <div className="panel-title">
              <Layers3 size={15} />
              Explorador do modelo
            </div>
            <div className="tree-scroll">
              <div className="tree-root">
                <ChevronDown size={14} />
                <Box size={15} />
                Estrutura
              </div>
              <details open>
                <summary>
                  Nós <span>{p.nodes.length}</span>
                </summary>
                {p.nodes.map((n) => (
                  <button
                    className={
                      selection?.kind === "node" && selection.id === n.id
                        ? "selected"
                        : ""
                    }
                    key={n.id}
                    onClick={() => setSelection({ kind: "node", id: n.id })}
                  >
                    <CircleDot size={12} />
                    {n.name}
                    <small>
                      {Object.values(n.restraints).some(Boolean) ? "Apoio" : ""}
                    </small>
                  </button>
                ))}
                {!p.nodes.length && (
                  <p className="tree-empty">Nenhum nó lançado</p>
                )}
              </details>
              <details open>
                <summary>
                  Barras <span>{p.members.length}</span>
                </summary>
                {p.members.map((m) => (
                  <button
                    className={
                      selection?.kind === "member" && selection.id === m.id
                        ? "selected"
                        : ""
                    }
                    key={m.id}
                    onClick={() => setSelection({ kind: "member", id: m.id })}
                  >
                    <MoveUpRight size={13} />
                    {m.name}
                  </button>
                ))}
              </details>
              <details>
                <summary>
                  Seções <span>{p.sections.length}</span>
                </summary>
                {p.sections.map((s) => (
                  <p key={s.id} className="tree-empty">
                    {(s.width * 100).toFixed(1)} × {(s.height * 100).toFixed(1)}{" "}
                    cm
                  </p>
                ))}
              </details>
              <details>
                <summary>
                  Casos de análise <span>{p.analysisCases.length}</span>
                </summary>
                {p.analysisCases.map((c) => (
                  <p className="tree-empty" key={c.id}>
                    {c.name}
                  </p>
                ))}
              </details>
            </div>
            <div className="identity-card">
              <img
                src="/assets/dedalo.webp"
                alt="Dédalo apoiado em uma coluna grega, identidade do KStruct"
              />
              <div>
                <b>A arte de estruturar.</b>
                <span>KStruct / OpenStruct</span>
              </div>
            </div>
            <a
              className="repo-link"
              href="https://github.com/ricardocorsini/k-struct"
              target="_blank"
              rel="noreferrer"
            >
              <GitBranch size={13} />
              Projeto open source ↗
            </a>
          </aside>
        )}
        <main className="work-area">
          <div className="model-bar">
            <div>
              <span className="status-dot" />
              Modelo estrutural{" "}
              <span className="model-count">
                {p.nodes.length} nós · {p.members.length} barras
              </span>
            </div>
            <select
              aria-label="Visualização dos resultados"
              value={display}
              onChange={(e) => setDisplay(e.target.value as Display)}
            >
              <option value="model">Geometria e cargas</option>
              {result && (
                <>
                  <option value="deformed">Deformada ampliada</option>
                  <option value="m">Momento fletor M</option>
                  <option value="v">Cortante V</option>
                  <option value="n">Normal N</option>
                </>
              )}
            </select>
          </div>
          <div className={`viewports ${dual ? "dual" : "single"}`}>
            <Elevation
              project={p}
              selection={selection}
              tool={tool}
              result={result}
              display={display}
              patternId={patternId}
              pending={pending}
              onPoint={onPoint}
              onSelect={setSelection}
            />
            {dual && (
              <SpatialView
                project={p}
                selection={selection}
                onSelect={setSelection}
              />
            )}
          </div>
          {display !== "model" && result && (
            <div className="diagram-caption">
              {display === "deformed"
                ? "Deformada ampliada automaticamente. Valores reais na tabela de deslocamentos."
                : "Esforços amostrados nos nós da malha. N positivo em tração. M positivo sagente para barras horizontais orientadas +X."}
            </div>
          )}
          <Results
            project={p}
            result={result}
            message={message}
            running={running}
            cancelling={activeRun?.cancelling ?? false}
            openRunHistory={lastLog ? () => setShowRunHistory(true) : undefined}
          />
        </main>
        {right && (
          <Inspector
            project={p}
            selection={selection}
            patternId={patternId}
            edit={edit}
          />
        )}
      </div>
      <footer className="status-bar">
        <span>
          <ShieldCheck size={13} />
          {result
            ? "Análise concluída"
            : running
              ? "Análise em andamento"
              : "Modelo em edição"}
        </span>
        <span>
          {pending
            ? "Marque a segunda extremidade · Esc para cancelar"
            : tool === "member"
              ? "Marque a primeira extremidade da barra"
              : tool === "node"
                ? "Clique na malha para inserir um nó"
                : "Selecione um objeto para editar"}
        </span>
        <span>
          kN · m · rad <i /> {desktop() ? "Desktop" : "Navegador · edição"}{" "}
          <i /> OpenStruct
        </span>
      </footer>
      <input
        ref={fileInput}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            try {
              if (f.size > 5_000_000)
                throw new Error("Arquivo maior que 5 MB.");
              replace(parseProject(await f.text()));
            } catch (e) {
              setMessage(String(e));
            }
          }
          e.target.value = "";
        }}
      />
      {settings && (
        <SolverSettings
          executable={executable}
          running={running}
          onClose={() => setSettings(false)}
          onSave={(path) => {
            setExecutable(path);
            try {
              localStorage.setItem("kstruct.oofem.path", path);
            } catch {
              /* Keep the session preference. */
            }
            setSettings(false);
          }}
        />
      )}
      {showRunHistory && (
        <RunHistory latest={lastLog} onClose={() => setShowRunHistory(false)} />
      )}
      {confirmation && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 id="confirm-title">{confirmation.label}</h2>
            <p>
              Há alterações ainda não salvas em arquivo. Salve o projeto antes
              de continuar se desejar preservá-las.
            </p>
            <div className="modal-actions">
              <button onClick={() => setConfirmation(null)}>Voltar</button>
              <button
                className="primary"
                onClick={() => {
                  confirmation.action();
                  setConfirmation(null);
                }}
              >
                Continuar
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
