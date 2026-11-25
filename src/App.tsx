import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Box,
  Boxes,
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
  Library,
  GitBranch,
  History,
  ListChecks,
  Table2,
  Square,
  PanelLeft,
  PanelRight,
  Scissors,
  Ruler,
  ScanSearch,
  Waypoints,
} from "lucide-react";
import {
  addPoint,
  beamExample,
  createProject,
  projectSchema,
  projectFileLimit,
  referenceErrors,
  parseProject,
  removeSelection,
  serializeProject,
  uid,
  type Project,
  type ResultEnvelope,
  type SelectedObject,
  type Selection,
} from "./domain/model";
import { addMember, addSlab, inspectNodeCoordinateChanges } from "./domain/editing";
import {
  onPlane,
  origin,
  planeCoordinates,
  type PlaneKind,
  type Point3,
  type WorkPlane,
} from "./domain/geometry";
import { historyReducer } from "./domain/history";
import { applyTabularImport } from "./domain/tabularImport";
import { applyTheme, readTheme, saveTheme, type Theme } from "./theme";
import { UnitsDialog, useUnits } from "./components/Units";
import { formatQuantity } from "./units";
import WorkPlaneView, {
  additiveSelection,
  type Display,
  type Tool,
  type PlaneCamera,
} from "./components/WorkPlaneView";
import { GuideEditor, WorkPlaneControls } from "./components/LaunchTools";
import { parseNumberInput } from "./components/numberInput";
import NewProjectDialog from "./components/NewProjectDialog";
import SpatialView, { type SpatialCamera } from "./components/SpatialView";
import { useViewLayers } from "./components/ViewLayers";
import Inspector from "./components/Inspector";
import SelectionDialog from "./components/SelectionDialog";
import TransformDialog from "./components/TransformDialog";
import DuplicateDialog from "./components/DuplicateDialog";
import SectionCatalog from "./components/SectionCatalog";
import { dimensions, shapeNames } from "./domain/sections";
import MaterialLibrary from "./components/MaterialLibrary";
import MeshConnections from "./components/MeshConnections";
import MemberEditDialog from "./components/MemberEditDialog";
import type { MemberEdit } from "./domain/memberOperations";
import type { TransformPlan } from "./domain/transform";
import { combineSelection } from "./domain/selection";
import NodeTable from "./components/NodeTable";
import Results from "./components/Results";
import SlabResults, {
  SlabLegend,
  buildSlabMap,
  isSlabDisplay,
  slabDisplays,
  type SlabDisplay,
} from "./components/SlabResults";
import EnvelopeResults from "./components/EnvelopeResults";
import SolverSettings from "./components/SolverSettings";
import RunHistory from "./components/RunHistory";
import LoadDefinitions, {
  type LoadDefinitionsPage,
} from "./components/LoadDefinitions";
import { version } from "../package.json";
import { combineLinearResults } from "./solver/combinations";
import {
  evaluateMemberEnvelope,
  type EnvelopeSection,
  type MemberEnvelopeResult,
} from "./solver/envelopes";
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

type PlanePanel = "primary" | "elevation";
type Panel = PlanePanel | "perspective";
type Layout = "single" | "dual" | "planes" | "triple";
type PlaneChoice = { kind: PlaneKind; guideId: string };
const initialPlanes = (levelId = ""): Record<PlanePanel, PlaneChoice> => ({
  primary: { kind: "XY", guideId: levelId },
  elevation: { kind: "XZ", guideId: "" },
});

const initial = () => {
  try {
    const cached =
      localStorage.getItem("kstruct.draft.v11") ??
      localStorage.getItem("kstruct.draft.v10") ??
      localStorage.getItem("kstruct.draft.v9") ??
      localStorage.getItem("kstruct.draft.v8") ??
      localStorage.getItem("kstruct.draft.v7") ??
      localStorage.getItem("kstruct.draft.v6") ??
      localStorage.getItem("kstruct.draft.v5") ??
      localStorage.getItem("kstruct.draft.v4") ??
      localStorage.getItem("kstruct.draft.v3") ??
      localStorage.getItem("kstruct.draft.v2") ??
      localStorage.getItem("kstruct.draft.v1");
    if (cached) return parseProject(cached);
  } catch {
    /* Corrupted drafts never prevent opening the editor. */
  }
  return createProject();
};
export default function App() {
  const { units } = useUnits();
  const [showUnits, setShowUnits] = useState(false);
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    current: initial(),
    future: [],
  }));
  const p = history.current;
  const spatial = p.mode === "spatial";
  const slab = p.slabs[0];
  const [selection, setSelection] = useState<SelectedObject[]>([]),
    [tool, setTool] = useState<Tool>("select");
  const [layout, setLayout] = useState<Layout>("dual");
  const [showMemberAxes, setShowMemberAxes] = useState(false);
  const [activePanel, setActivePanel] = useState<Panel>("primary");
  const [planes, setPlanes] = useState(() => initialPlanes(slab?.levelId));
  const primaryLayers = useViewLayers();
  const elevationLayers = useViewLayers();
  const [perspectiveLayers, setPerspectiveLayers] = useViewLayers(false);
  const primaryCamera = useRef<PlaneCamera | null>(null);
  const elevationCamera = useRef<PlaneCamera | null>(null);
  const perspectiveCamera = useRef<SpatialCamera | null>(null);
  const splitPlanes = spatial && (layout === "triple" || layout === "planes");
  const perspective = layout === "dual" || layout === "triple";
  const planePanel = activePanel === "elevation" ? "elevation" : "primary";
  function viewPlane(panel: PlanePanel) {
    const choice = planes[panel];
    const kind = !spatial
      ? "XZ"
      : splitPlanes && panel === "primary"
        ? "XY"
        : choice.kind;
    const guides = p.guides[planeCoordinates[kind][2]];
    const guide = guides.find((g) => g.id === choice.guideId) ?? guides[0];
    return {
      plane: { kind, offset: spatial ? guide.position : 0 } satisfies WorkPlane,
      guides,
      guide,
    };
  }
  const [memberMode, setMemberMode] = useState<"single" | "chain" | "span">(
    "single",
  );
  const [launchSection, setLaunchSection] = useState("");
  const [rollText, setRollText] = useState("0");
  const sectionId =
    p.sections.find((s) => s.id === launchSection)?.id ?? p.sections[0].id;
  const roll = spatial ? parseNumberInput(rollText) : 0;
  const validRoll = Number.isFinite(roll) && Math.abs(roll) <= 360;
  const [orthogonal, setOrthogonal] = useState(true);
  const [launchDialog, setLaunchDialog] = useState<
    | "guides"
    | "replicate"
    | "mesh"
    | "materials"
    | "sections"
    | "member-edit"
    | "duplicates"
    | "nodes"
    | "new-project"
    | "selection"
    | null
  >(null);
  const [catalogSectionId, setCatalogSectionId] = useState("");
  const openSections = (id: string) => {
    setCatalogSectionId(id);
    setLaunchDialog("sections");
  };
  const {
    plane,
    guides: planeGuides,
    guide: activeGuide,
  } = viewPlane(planePanel);
  const [pending, setPending] = useState<Point3 | null>(null),
    [display, setDisplay] = useState<Display | SlabDisplay>("model");
  const [caseResults, setCaseResults] = useState<Map<string, AnalysisResult>>(
    () => new Map(),
  );
  const modelRevision = useRef(0);
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
    "Pronto para modelar. Selecione Barra (B) e marque duas extremidades no plano de trabalho.",
  );
  const [saved, setSaved] = useState(() => serializeProject(p));
  const [tab, setTab] = useState("Modelo"),
    [settings, setSettings] = useState(false),
    [left, setLeft] = useState(true),
    [right, setRight] = useState(true);
  const [theme, setTheme] = useState(readTheme);
  useLayoutEffect(() => applyTheme(theme), [theme]);
  const [executable, setExecutable] = useState(() => {
    try {
      return localStorage.getItem("kstruct.oofem.path") ?? "";
    } catch {
      return "";
    }
  });
  const [preferredCaseId, setCaseId] = useState(p.analysisCases[0].id),
    [preferredPatternId, setPatternId] = useState(p.loadPatterns[0].id);
  const [derivedChoice, setDerivedChoice] = useState<{
    kind: "combination" | "envelope";
    id: string;
  } | null>(null);
  const [preferredSection, setPreferredSection] =
    useState<EnvelopeSection | null>(null);
  const [forceMemberId, setForceMemberId] = useState("");
  if (forceMemberId && !p.members.some(({ id }) => id === forceMemberId))
    setForceMemberId("");
  const [calculatedEnvelope, setCalculatedEnvelope] = useState<{
    project: Project;
    envelope: ResultEnvelope;
    cases: ReadonlyMap<string, AnalysisResult>;
    result: MemberEnvelopeResult | null;
    problem: string;
  } | null>(null);
  const analysisCase =
    p.analysisCases.find((c) => c.id === preferredCaseId) ?? p.analysisCases[0];
  const caseId = analysisCase.id;
  const combination =
    !slab && derivedChoice?.kind === "combination"
      ? p.resultCombinations.find(({ id }) => id === derivedChoice.id)
      : undefined;
  const envelope =
    !slab && derivedChoice?.kind === "envelope"
      ? p.resultEnvelopes.find(({ id }) => id === derivedChoice.id)
      : undefined;
  const derived = combination ?? envelope;
  const patternId =
    p.loadPatterns.find((pattern) => pattern.id === preferredPatternId)?.id ??
    p.loadPatterns[0].id;
  const caseResult = caseResults.get(caseId) ?? null;
  const slabResult = caseResult?.slab ?? null;
  const slabMap = useMemo(
    () =>
      slabResult && isSlabDisplay(display)
        ? buildSlabMap(slabResult, display, units)
        : null,
    [slabResult, display, units],
  );
  const showSlabMap =
    plane.kind === "XY" && activeGuide.id === slab?.levelId ? slabMap : null;
  const combined = useMemo(() => {
    if (!combination) return null;
    try {
      return {
        result: combineLinearResults(p, combination, caseResults),
        problem: "",
      };
    } catch (error) {
      return {
        result: null,
        problem: error instanceof Error ? error.message : String(error),
      };
    }
  }, [p, combination, caseResults]);
  useEffect(() => {
    if (!envelope) {
      setCalculatedEnvelope(null);
      return;
    }
    const controller = new AbortController();
    const context = { project: p, envelope, cases: caseResults };
    void evaluateMemberEnvelope(
      p,
      envelope,
      caseResults,
      controller.signal,
    ).then(
      (result) => {
        if (!controller.signal.aborted)
          setCalculatedEnvelope({ ...context, result, problem: "" });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setCalculatedEnvelope({
            ...context,
            result: null,
            problem: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => controller.abort();
  }, [p, envelope, caseResults]);
  const envelopeState =
    calculatedEnvelope?.project === p &&
    calculatedEnvelope.envelope === envelope &&
    calculatedEnvelope.cases === caseResults
      ? calculatedEnvelope
      : null;
  const envelopeResult = envelopeState?.result ?? null;
  const sectionMemberId =
    selection.find(
      (item) =>
        item.kind === "member" && p.members.some(({ id }) => item.id === id),
    )?.id ?? p.members[0]?.id;
  const section =
    envelopeResult && sectionMemberId
      ? {
          memberId: sectionMemberId,
          index:
            preferredSection?.memberId === sectionMemberId
              ? preferredSection.index
              : 0,
        }
      : null;
  const beamDisplay = isSlabDisplay(display) ? "model" : display;
  const envelopeComponent =
    beamDisplay === "model" || beamDisplay === "deformed"
      ? spatial
        ? "my"
        : "m"
      : beamDisplay;
  const showEnvelope = Boolean(envelopeResult) && tool === "select";
  const result = envelope ? null : combined ? combined.result : caseResult;
  const visibleDisplay = showEnvelope
    ? envelopeComponent
    : result
      ? beamDisplay
      : "model";
  const defaultDiagram = slab ? "slab-uz" : spatial ? "deformed" : "m";
  const [loadEditor, setLoadEditor] = useState<LoadDefinitionsPage | null>(
    null,
  );
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
    try {
      localStorage.setItem("kstruct.draft.v11", serialized);
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
  const invalidateResults = useCallback(() => {
    modelRevision.current++;
    setCaseResults(new Map());
    setDisplay("model");
    setPreferredSection(null);
    setMessage(
      "Modelo em edição. Analise a revisão atual para obter resultados.",
    );
  }, []);
  const edit = useCallback(
    (fn: (p: Project) => void) => {
      try {
        const next = structuredClone(current.current);
        fn(next);
        if (!projectSchema.safeParse(next).success)
          throw new Error(
            "A alteração contém valores inválidos ou excede os limites do projeto.",
          );
        const errors = referenceErrors(next);
        if (errors.length) throw new Error(errors.join("\n"));
        if (serializeProject(next) !== serializeProject(current.current)) {
          current.current = next;
          dispatch({ type: "change", project: next });
          invalidateResults();
        }
        return null;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        setMessage(error);
        return error;
      }
    },
    [invalidateResults],
  );
  const selectResult = (value: string) => {
    const selectedEnvelope = p.resultEnvelopes.find(
      (item) => `envelope:${item.id}` === value,
    );
    if (selectedEnvelope) {
      setDerivedChoice({ kind: "envelope", id: selectedEnvelope.id });
      setTool("select");
      setPending(null);
      return;
    }
    const selectedCombination = p.resultCombinations.find(
      (item) => `combination:${item.id}` === value,
    );
    if (selectedCombination) {
      setDerivedChoice({ kind: "combination", id: selectedCombination.id });
      setDisplay((value) => (value === "model" ? defaultDiagram : value));
      return;
    }
    const selected = p.analysisCases.find((item) => item.id === value);
    if (!selected) return;
    setDerivedChoice(null);
    setCaseId(selected.id);
    if (caseResults.has(selected.id)) {
      if (slab) showDisplay(isSlabDisplay(display) ? display : "slab-uz");
      else setDisplay((value) => (value === "model" ? defaultDiagram : value));
      setMessage(`Resultados do caso ${selected.name}.`);
    } else {
      setDisplay("model");
      setMessage(`Caso ${selected.name} selecionado. Clique em Analisar.`);
    }
  };
  const [diagnosticHighlight, setDiagnosticHighlight] = useState<
    SelectedObject[]
  >([]);
  const shownSelection =
    launchDialog === "duplicates" ? diagnosticHighlight : selection;
  const isSelected = (kind: SelectedObject["kind"], id: string) =>
    shownSelection.some((s) => s.kind === kind && s.id === id);
  const selectObject = useCallback((object: Selection, additive = false) => {
    if (!additive) setSelection(object ? [object] : []);
    else if (object)
      setSelection((selected) => {
        const same = (s: SelectedObject) =>
          s.kind === object.kind && s.id === object.id;
        return selected.some(same)
          ? selected.filter((s) => !same(s))
          : [...selected, object];
      });
  }, []);
  const activatePanel = (panel: Panel) => {
    if (panel === activePanel) return;
    setActivePanel(panel);
    setPending(null);
    if (
      tool === "slab" &&
      (panel === "perspective" || viewPlane(panel).plane.kind !== "XY")
    )
      setTool("select");
  };
  const changeLayout = (next: Layout) => {
    setLayout(next);
    setPending(null);
    setActivePanel("primary");
    if (tool === "slab") setTool("select");
    if (next === "planes" || next === "triple")
      setPlanes((v) =>
        v.primary.kind === "XY"
          ? v
          : { ...v, primary: { kind: "XY", guideId: "" } },
      );
  };
  const changeTool = (t: Tool) => {
    if (t === "slab" && (!spatial || plane.kind !== "XY" || slab)) return;
    if (t !== "select" && activePanel === "perspective")
      activatePanel("primary");
    setTool(t);
    setPending(null);
    setDisplay("model");
  };
  const showDisplay = (value: Display | SlabDisplay) => {
    if (slab && isSlabDisplay(value)) {
      setActivePanel("primary");
      setPlanes((v) => ({
        ...v,
        primary: { kind: "XY", guideId: slab.levelId },
      }));
      setTool("select");
      setPending(null);
    }
    setDisplay(value);
  };
  const inspectSection = (target: EnvelopeSection) => {
    selectObject({ kind: "member", id: target.memberId });
    setPreferredSection(target);
    setTool("select");
    setPending(null);
  };
  const replace = (project: Project) => {
    invalidateResults();
    current.current = project;
    dispatch({ type: "reset", project });
    setLaunchDialog(null);
    setLaunchSection("");
    setRollText("0");
    setSelection(project.slabs.map(({ id }) => ({ kind: "slab", id })));
    setPending(null);
    setActivePanel("primary");
    setPlanes(initialPlanes(project.slabs[0]?.levelId));
    if (
      project.mode === "planar" &&
      (layout === "triple" || layout === "planes")
    )
      setLayout("dual");
    setCaseId(project.analysisCases[0].id);
    setDerivedChoice(null);
    setForceMemberId("");
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
    if (edit((p) => removeSelection(p, selection))) return;
    setSelection([]);
    setPending(null);
  };
  const undo = () => {
    if (!history.past.length) return;
    invalidateResults();
    dispatch({ type: "undo" });
    setSelection([]);
    setPending(null);
  };
  const redo = () => {
    if (!history.future.length) return;
    invalidateResults();
    dispatch({ type: "redo" });
    setSelection([]);
    setPending(null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        loadEditor ||
        launchDialog === "materials" ||
        launchDialog === "sections" ||
        launchDialog === "nodes" ||
        launchDialog === "selection" ||
        settings ||
        confirmation ||
        showRunHistory
      )
        return;
      if (launchDialog) {
        if (e.key === "Escape") setLaunchDialog(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        (e.target as HTMLElement).blur();
        setTimeout(() => void save(), 0);
        return;
      }
      if (e.key === "Escape" && tool === "member") {
        changeTool("select");
        setSelection([]);
        return;
      }
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,button:not(.view-actions button)",
        )
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === "Escape") {
        changeTool("select");
        setSelection([]);
      }
      if (!e.ctrlKey && !e.metaKey) {
        if (
          activePanel === "perspective" &&
          ["b", "n", "l"].includes(e.key.toLowerCase())
        )
          return;
        if (e.key.toLowerCase() === "b") changeTool("member");
        if (e.key.toLowerCase() === "n") changeTool("node");
        if (e.key.toLowerCase() === "l") changeTool("slab");
        if (e.key.toLowerCase() === "v") changeTool("select");
        if (e.key === "Delete") remove();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const placeMember = (from: Point3, to: Point3) => {
    if (!validRoll) {
      setMessage("Informe uma rotação entre −360° e 360° para lançar a barra.");
      return;
    }
    let memberId = "";
    let end = to;
    const error = edit((draft) => {
      const bar = addMember(draft, from, to, { sectionId, roll });
      memberId = bar.id;
      end = draft.nodes.find((node) => node.id === bar.end)!;
    });
    if (!error) {
      selectObject({ kind: "member", id: memberId });
      setPending(memberMode === "chain" ? end : null);
    }
  };
  const onPoint = (point: Point3) => {
    if (tool === "node") {
      let id = "";
      const error = edit((p) => {
        id = addPoint(p, point).id;
      });
      if (!error) selectObject({ kind: "node", id });
      return;
    }
    if (tool !== "member" && tool !== "slab") return;
    if (!pending) {
      setPending(point);
      return;
    }
    if (tool === "member") {
      placeMember(pending, point);
      return;
    }
    let id = "";
    const error = edit((draft) => {
      id = addSlab(draft, activeGuide.id, pending, point).id;
    });
    if (!error) {
      selectObject({ kind: "slab", id });
      changeTool("select");
    }
  };
  const selectPlane = () => {
    const ids = new Set(
      p.nodes.filter((n) => onPlane(n, plane)).map((n) => n.id),
    );
    changeTool("select");
    setSelection([
      ...Array.from(ids, (id) => ({ kind: "node" as const, id })),
      ...p.members
        .filter((m) => ids.has(m.start) && ids.has(m.end))
        .map((m) => ({ kind: "member" as const, id: m.id })),
      ...(slab && plane.kind === "XY" && slab.levelId === activeGuide.id
        ? [{ kind: "slab" as const, id: slab.id }]
        : []),
    ]);
  };
  const applyGeometry = (plan: TransformPlan | MemberEdit) => {
    if (("ready" in plan && !plan.ready) || current.current !== plan.source)
      return "O modelo mudou. Reabra a prévia para confirmar.";
    const error = edit((draft) => {
      draft.nodes = plan.project.nodes;
      draft.members = plan.project.members;
      draft.loadPatterns = plan.project.loadPatterns;
      draft.selectionGroups = plan.project.selectionGroups;
      draft.meshConnections = plan.project.meshConnections;
    });
    if (!error) {
      changeTool("select");
      if ("note" in plan) {
        setSelection(plan.selected.map((id) => ({ kind: "member", id })));
        setMessage(plan.note);
      } else {
        setSelection(plan.selected);
        setMessage("Transformação aplicada à seleção.");
      }
    }
    return error;
  };
  const run = async () => {
    if (activeRunId.current) return;
    const snapshot = current.current;
    const revision = modelRevision.current;
    const requestedCase =
      snapshot.analysisCases.find((item) => item.id === caseId) ??
      snapshot.analysisCases[0];
    const id = uid();
    activeRunId.current = id;
    setActiveRun({ id, ready: false, cancelling: false });
    setCaseResults((results) => {
      const updated = new Map(results);
      updated.delete(requestedCase.id);
      return updated;
    });
    setDisplay("model");
    setMessage(`Analisando ${requestedCase.name}…`);
    try {
      const { execution, input } = await analyze(
        snapshot,
        requestedCase.id,
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
      if (modelRevision.current !== revision) {
        setMessage(
          `O modelo mudou durante a análise. Execute novamente para obter resultados atuais.${historyNotice}`,
        );
        return;
      }
      if (
        execution.log.summary.status !== "completed" ||
        execution.output === null
      ) {
        setMessage(`${execution.log.summary.message}${historyNotice}`);
        return;
      }
      const completed = parseOofemOutput(execution.output, input);
      setCaseResults((results) =>
        new Map(results).set(completed.caseId, completed),
      );
      showDisplay(defaultDiagram);
      setMessage(
        `Análise concluída · ${requestedCase.name}\nEquilíbrio global verificado. ${completed.slab ? "Consulte a flecha e os mapas de momentos." : "Consulte reações, deslocamentos e esforços."}${historyNotice}`,
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
            onClick={() => setLaunchDialog("new-project")}
          >
            <FilePlus2 size={17} />
          </button>
          <button
            title="Novo pórtico espacial"
            aria-label="Novo pórtico espacial"
            onClick={() =>
              protect("Criar um pórtico espacial", () =>
                replace(createProject("spatial")),
              )
            }
          >
            <Boxes size={17} />
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
                {spatial && (
                  <button
                    className={`tool-button ${tool === "slab" ? "active" : ""}`}
                    title={
                      slab
                        ? "O projeto já contém uma laje isolada"
                        : "Lançar laje retangular na planta XY (L)"
                    }
                    disabled={plane.kind !== "XY" || Boolean(slab)}
                    onClick={() => changeTool("slab")}
                  >
                    <Square size={21} />
                    <span>Laje</span>
                    <kbd>L</kbd>
                  </button>
                )}
                <button
                  className="tool-button"
                  disabled={!selection.length}
                  onClick={remove}
                >
                  <Trash2 size={19} />
                  <span>Excluir</span>
                </button>
                <button
                  className="tool-button"
                  disabled={
                    !selection.length ||
                    selection.some((obj) => obj.kind !== "member")
                  }
                  onClick={() => setLaunchDialog("member-edit")}
                  title="Dividir, unir, aparar ou prolongar barras selecionadas"
                >
                  <Scissors size={20} />
                  <span>Editar barras</span>
                </button>
                <button
                  className="tool-button"
                  disabled={!p.members.length}
                  onClick={() => setLaunchDialog("mesh")}
                  title="Conectar nós e inspecionar as estações de análise"
                >
                  <Waypoints size={20} />
                  <span>Conexões da malha</span>
                </button>
                <button
                  className="tool-button"
                  onClick={() => {
                    setDiagnosticHighlight([]);
                    setLaunchDialog("duplicates");
                  }}
                >
                  <ScanSearch size={20} />
                  <span>Duplicidades</span>
                </button>
                <button
                  className="tool-button"
                  onClick={() => setLaunchDialog("nodes")}
                >
                  <Table2 size={21} />
                  <span>Tabela de nós</span>
                </button>
              </div>
              <small>LANÇAMENTO</small>
            </div>
            {tool === "member" && (
              <div
                className="member-launch"
                role="group"
                aria-label="Lançamento de barras"
              >
                <label>
                  Traçado
                  <select
                    value={memberMode}
                    onChange={(e) => {
                      setPending(null);
                      setMemberMode(e.target.value as typeof memberMode);
                    }}
                  >
                    <option value="single">Dois pontos</option>
                    <option value="chain">Em cadeia</option>
                    <option value="span">Vão entre eixos</option>
                  </select>
                </label>
                <label>
                  Seção ativa
                  <select
                    value={sectionId}
                    onChange={(e) => setLaunchSection(e.target.value)}
                  >
                    {p.sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                {spatial && (
                  <label>
                    Rotação local (°)
                    <input
                      inputMode="decimal"
                      aria-invalid={!validRoll}
                      value={rollText}
                      onChange={(e) => setRollText(e.target.value)}
                    />
                  </label>
                )}
                {!validRoll && <span role="alert">Use −360° a 360°.</span>}
              </div>
            )}
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
              <div className="definition-shortcuts">
                <button
                  className="manage-loads"
                  onClick={() => setLoadEditor("patterns")}
                >
                  <ListChecks size={14} /> Cargas e casos
                </button>
                <button
                  className="manage-loads"
                  onClick={() => setLaunchDialog("materials")}
                >
                  <Library size={14} /> Materiais
                </button>
              </div>
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
                  Viga de referência
                  <small>
                    {formatQuantity(6, "length", units)} {units.length} ·{" "}
                    {formatQuantity(10000, "distributedLoad", units)}{" "}
                    {units.distributedLoad}
                  </small>
                </span>
              </button>
              <small>MODELO DE VALIDAÇÃO</small>
            </div>
          </>
        )}
        {tab === "Análise" && (
          <>
            <div className="ribbon-group">
              <button
                className="tool-button"
                onClick={() =>
                  setLoadEditor(
                    envelope
                      ? "envelopes"
                      : combination
                        ? "combinations"
                        : "cases",
                  )
                }
              >
                <ListChecks size={21} />
                <span>Cargas e casos</span>
              </button>
            </div>
            <div className="ribbon-group">
              <button
                className="tool-button"
                onClick={exportDeck}
                disabled={Boolean(derived)}
              >
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
              <b>
                {slab
                  ? "Estática linear · Laje isolada"
                  : spatial
                    ? "Estática linear espacial"
                    : "Estática linear no plano XZ"}
              </b>
              <span>
                {slab
                  ? `Placa delgada DKT · ${slab.divisionsX} × ${slab.divisionsY} subdivisões`
                  : `Euler–Bernoulli · ${p.mesh.segmentsPerMember} subdivisões regulares por barra`}
              </span>
              <span>
                {slab
                  ? "Peso próprio aplicado manualmente como pressão"
                  : "Peso próprio aplicado manualmente como carga distribuída"}
              </span>
            </div>
          </>
        )}
        {tab === "Exibição" && (
          <>
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
                <label>
                  Arranjo de vistas
                  <select
                    value={layout}
                    onChange={(e) => changeLayout(e.target.value as Layout)}
                  >
                    <option value="single">Plano de trabalho</option>
                    <option value="dual">Plano + perspectiva</option>
                    {spatial && (
                      <option value="planes">Planta + elevação</option>
                    )}
                    {spatial && (
                      <option value="triple">
                        Planta + elevação + perspectiva
                      </option>
                    )}
                  </select>
                </label>
              </div>
              <small>ÁREA DE TRABALHO</small>
            </div>
            <div className="ribbon-group theme-group">
              <label>
                Tema
                <select
                  value={theme}
                  onChange={(event) => {
                    const next = event.target.value as Theme;
                    setTheme(next);
                    saveTheme(next);
                  }}
                >
                  <option value="dark">Escuro</option>
                  <option value="light">Claro</option>
                </select>
              </label>
            </div>
            <div className="ribbon-group">
              <button
                className="tool-button"
                onClick={() => setShowUnits(true)}
              >
                <Ruler />
                <span>Unidades</span>
              </button>
              <small>APRESENTAÇÃO</small>
            </div>
            <div className="ribbon-group theme-group">
              <button
                aria-pressed={showMemberAxes}
                className="member-axes-toggle"
                onClick={() => setShowMemberAxes((show) => !show)}
              >
                Eixos locais
              </button>
            </div>
          </>
        )}
        <div className="run-group">
          <label>
            {slab ? "Caso estático" : "Caso, combinação ou envelope"}
            <select
              aria-label={
                slab ? "Caso estático" : "Caso, combinação ou envelope"
              }
              disabled={running}
              value={
                envelope
                  ? `envelope:${envelope.id}`
                  : combination
                    ? `combination:${combination.id}`
                    : caseId
              }
              onChange={(e) => selectResult(e.target.value)}
            >
              <optgroup label="Casos estáticos">
                {p.analysisCases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              {!slab && p.resultCombinations.length > 0 && (
                <optgroup label="Combinações lineares">
                  {p.resultCombinations.map((item) => (
                    <option key={item.id} value={`combination:${item.id}`}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {!slab && p.resultEnvelopes.length > 0 && (
                <optgroup label="Envelopes">
                  {p.resultEnvelopes.map((item) => (
                    <option key={item.id} value={`envelope:${item.id}`}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <button
            className="run-button"
            disabled={running || Boolean(derived)}
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
                    className={isSelected("node", n.id) ? "selected" : ""}
                    aria-pressed={isSelected("node", n.id)}
                    key={n.id}
                    onClick={(e) =>
                      selectObject(
                        { kind: "node", id: n.id },
                        additiveSelection(e),
                      )
                    }
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
                    className={isSelected("member", m.id) ? "selected" : ""}
                    aria-pressed={isSelected("member", m.id)}
                    key={m.id}
                    onClick={(e) =>
                      selectObject(
                        { kind: "member", id: m.id },
                        additiveSelection(e),
                      )
                    }
                  >
                    <MoveUpRight size={13} />
                    {m.name}
                  </button>
                ))}
              </details>
              {spatial && (
                <details open>
                  <summary>
                    Lajes <span>{p.slabs.length}</span>
                  </summary>
                  {slab && (
                    <button
                      key={slab.id}
                      className={isSelected("slab", slab.id) ? "selected" : ""}
                      aria-pressed={isSelected("slab", slab.id)}
                      onClick={(event) =>
                        selectObject(
                          { kind: "slab", id: slab.id },
                          additiveSelection(event),
                        )
                      }
                    >
                      <Square size={13} /> {slab.name}
                    </button>
                  )}
                </details>
              )}
              <details>
                <summary>
                  Seções <span>{p.sections.length}</span>
                </summary>
                {p.sections.map((s) => (
                  <button
                    key={s.id}
                    title={`${shapeNames[s.shape]} · ${dimensions(s)
                      .map(
                        ({ label, value }) =>
                          `${label}: ${formatQuantity(value, "section", units)} ${units.section}`,
                      )
                      .join(", ")}`}
                    onClick={() => openSections(s.id)}
                  >
                    {s.name}
                  </button>
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
              <span aria-label="Vista ativa">
                {activePanel === "perspective"
                  ? "Perspectiva 3D"
                  : `${plane.kind === "XY" ? "Planta" : "Elevação"} ${plane.kind} · ${planeCoordinates[plane.kind][2].toUpperCase()} = ${formatQuantity(plane.offset, "length", units)} ${units.length}`}
              </span>
              <span className="model-count">
                {p.nodes.length} nós · {p.members.length} barras
                {slab && " · 1 laje"}
              </span>
            </div>
            {!spatial && (
              <button
                className="selection-trigger"
                disabled={
                  !selection.length || selection.some((s) => s.kind === "slab")
                }
                onClick={() => setLaunchDialog("replicate")}
              >
                Transformar
              </button>
            )}
            <button
              className="selection-trigger"
              onClick={() => {
                setPending(null);
                setTool("select");
                setLaunchDialog("selection");
              }}
            >
              Seleção e grupos
            </button>
            <select
              aria-label="Visualização dos resultados"
              value={showSlabMap ? display : visibleDisplay}
              onChange={(e) =>
                showDisplay(e.target.value as Display | SlabDisplay)
              }
            >
              {!showEnvelope && (
                <option value="model">Geometria e cargas</option>
              )}
              {slabResult &&
                Object.entries(slabDisplays).map(([key, field]) => (
                  <option key={key} value={key}>
                    {field.label}
                  </option>
                ))}
              {!slab && result && (
                <option value="deformed">Deformada ampliada</option>
              )}
              {!slab && (result || showEnvelope) && (
                <>
                  {spatial ? (
                    <>
                      <option value="my">Momento fletor My</option>
                      <option value="mz">Momento fletor Mz</option>
                      <option value="mx">Torção Mx</option>
                      <option value="vy">Cortante Vy</option>
                      <option value="vz">Cortante Vz</option>
                    </>
                  ) : (
                    <>
                      <option value="m">Momento fletor M</option>
                      <option value="v">Cortante V</option>
                    </>
                  )}
                  <option value="n">Normal N</option>
                </>
              )}
            </select>
          </div>
          {spatial && (
            <WorkPlaneControls
              inactive={activePanel === "perspective"}
              kinds={
                splitPlanes
                  ? planePanel === "primary"
                    ? ["XY"]
                    : ["XZ", "YZ"]
                  : ["XY", "XZ", "YZ"]
              }
              kind={plane.kind}
              guideId={activeGuide.id}
              guides={planeGuides}
              orthogonal={orthogonal}
              selected={
                selection.some(({ kind }) => kind === "slab")
                  ? 0
                  : selection.length
              }
              onPlane={(kind) => {
                setPending(null);
                setPlanes((v) => ({
                  ...v,
                  [planePanel]: { kind, guideId: "" },
                }));
                if (tool === "slab") changeTool("select");
              }}
              onGuide={(id) => {
                setPlanes((v) => ({
                  ...v,
                  [planePanel]: { kind: plane.kind, guideId: id },
                }));
                setPending(null);
              }}
              toggleOrtho={() => setOrthogonal((v) => !v)}
              editGuides={() => {
                setPending(null);
                setLaunchDialog("guides");
              }}
              selectPlane={selectPlane}
              replicate={() => setLaunchDialog("replicate")}
              connect={() => setLaunchDialog("mesh")}
            />
          )}
          <div className={`viewports ${layout}`}>
            {(
              (splitPlanes
                ? ["primary", "elevation"]
                : ["primary"]) as PlanePanel[]
            ).map((panel) => {
              const view = viewPlane(panel);
              const active = panel === activePanel;
              const [layers, setLayers] =
                panel === "primary" ? primaryLayers : elevationLayers;
              return (
                <WorkPlaneView
                  key={panel}
                  layers={layers}
                  setLayers={setLayers}
                  savedCamera={
                    panel === "primary" ? primaryCamera : elevationCamera
                  }
                  active={active}
                  onActivate={() => activatePanel(panel)}
                  project={p}
                  showMemberAxes={showMemberAxes}
                  plane={view.plane}
                  orthogonal={orthogonal}
                  selection={shownSelection}
                  tool={active ? tool : "select"}
                  quick={active && tool === "member" && memberMode === "span"}
                  result={result}
                  envelope={
                    showEnvelope && envelopeResult && section
                      ? {
                          result: envelopeResult,
                          section,
                          onSection: inspectSection,
                        }
                      : null
                  }
                  display={visibleDisplay}
                  slabMap={
                    view.plane.kind === "XY" && view.guide.id === slab?.levelId
                      ? slabMap
                      : null
                  }
                  patternId={patternId}
                  onWindow={(objects, additive) =>
                    setSelection((previous) =>
                      combineSelection(
                        previous,
                        objects,
                        additive ? "add" : "replace",
                      ),
                    )
                  }
                  onSpan={placeMember}
                  pending={active ? pending : null}
                  onPoint={onPoint}
                  onSelect={selectObject}
                />
              );
            })}
            {perspective && (
              <SpatialView
                layers={perspectiveLayers}
                setLayers={setPerspectiveLayers}
                savedCamera={perspectiveCamera}
                active={activePanel === "perspective"}
                onActivate={() => activatePanel("perspective")}
                patternId={patternId}
                theme={theme}
                project={p}
                showMemberAxes={showMemberAxes}
                selection={shownSelection}
                result={visibleDisplay === "deformed" ? result : null}
                onSelect={selectObject}
              />
            )}
          </div>
          {showSlabMap && slab ? (
            <SlabLegend
              map={showSlabMap}
              name={slab.name}
              caseName={analysisCase.name}
            />
          ) : showEnvelope ? (
            <div className="diagram-caption envelope-legend">
              <span className="envelope-max-label">Máximo</span>
              <span className="envelope-min-label">Mínimo</span>
              <span>
                N positivo em tração · Clique no diagrama para consultar uma
                estação.
              </span>
            </div>
          ) : (
            visibleDisplay !== "model" && (
              <div className="diagram-caption">
                {visibleDisplay === "deformed"
                  ? "Deformada ampliada automaticamente. Valores reais na tabela de deslocamentos."
                  : spatial
                    ? "x/L vai de i (0) a j (1). Esforços nos eixos locais, na face +x. N positivo em tração."
                    : "x/L vai de i (0) a j (1). N positivo em tração. M positivo sagente em barras horizontais orientadas +X."}
              </div>
            )
          )}
          {slab ? (
            <SlabResults
              slab={slab}
              caseName={analysisCase.name}
              result={slabResult}
              rawOutput={slabResult ? caseResult?.rawOutput : undefined}
              message={message}
              running={running}
              openRunHistory={
                lastLog ? () => setShowRunHistory(true) : undefined
              }
              onExportError={setMessage}
            />
          ) : envelope ? (
            <EnvelopeResults
              key={envelope.id}
              project={p}
              envelope={envelope}
              result={envelopeResult}
              component={envelopeComponent}
              section={section}
              problem={envelopeState?.problem ?? "Calculando envelope…"}
              onSection={inspectSection}
            />
          ) : (
            <Results
              project={p}
              forceMemberId={forceMemberId}
              onForceMemberChange={setForceMemberId}
              view={
                combination && combined
                  ? {
                      kind: "combination",
                      definition: combination,
                      ...combined,
                    }
                  : {
                      kind: "case",
                      definition: analysisCase,
                      result: caseResult,
                    }
              }
              message={message}
              running={running}
              cancelling={activeRun?.cancelling ?? false}
              openRunHistory={
                lastLog ? () => setShowRunHistory(true) : undefined
              }
            />
          )}
        </main>
        {right && (
          <Inspector
            onSections={openSections}
            onMaterials={() => setLaunchDialog("materials")}
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
          {envelopeResult
            ? "Envelope disponível"
            : result
              ? combination
                ? "Combinação disponível"
                : "Análise concluída"
              : running
                ? "Análise em andamento"
                : "Modelo em edição"}
        </span>
        <span>
          {tool === "slab"
            ? pending
              ? "Marque o canto oposto da laje · Esc para cancelar"
              : "Marque o primeiro canto da laje na planta XY"
            : pending
              ? "Marque a segunda extremidade · Esc para cancelar"
              : tool === "member"
                ? memberMode === "span"
                  ? "Aponte para um eixo no interior do vão, afastado dos cruzamentos"
                  : "Marque a primeira extremidade da barra"
                : tool === "node"
                  ? "Clique na malha para inserir um nó"
                  : selection.length > 1
                    ? `${selection.length} objetos selecionados`
                    : "Selecione um objeto · Ctrl ou Shift para seleção múltipla"}
        </span>
        <span>
          {units.force} · {units.length} · rad <i />{" "}
          {desktop() ? "Desktop" : "Navegador · edição"} <i /> OpenStruct
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
              if (f.size > projectFileLimit)
                throw new Error("Arquivo maior que 5 MB.");
              replace(parseProject(await f.text()));
            } catch (e) {
              setMessage(String(e));
            }
          }
          e.target.value = "";
        }}
      />
      {showUnits && <UnitsDialog onClose={() => setShowUnits(false)} />}
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
      {loadEditor && (
        <LoadDefinitions
          project={p}
          initialPage={loadEditor}
          initialPatternId={patternId}
          initialCaseId={caseId}
          initialCombinationId={
            combination?.id ?? p.resultCombinations[0]?.id ?? ""
          }
          initialEnvelopeId={envelope?.id ?? p.resultEnvelopes[0]?.id ?? ""}
          onClose={() => setLoadEditor(null)}
          onApply={(definitions, next) => {
            const problem = edit((project) => {
              project.loadPatterns = definitions.loadPatterns;
              project.analysisCases = definitions.analysisCases;
              project.resultCombinations = definitions.resultCombinations;
              project.resultEnvelopes = definitions.resultEnvelopes;
            });
            if (problem) return problem;
            setPatternId(next.patternId);
            setCaseId(next.caseId);
            setDerivedChoice(
              next.envelopeId
                ? { kind: "envelope", id: next.envelopeId }
                : next.combinationId
                  ? { kind: "combination", id: next.combinationId }
                  : null,
            );
            if (next.envelopeId) {
              setTool("select");
              setPending(null);
            }
            setDisplay("model");
            setMessage("Definições de carga aplicadas.");
            return null;
          }}
        />
      )}
      {launchDialog === "selection" && (
        <SelectionDialog
          project={p}
          selection={selection}
          edit={edit}
          onSelect={setSelection}
          onClose={() => setLaunchDialog(null)}
        />
      )}
      {launchDialog === "nodes" && (
        <NodeTable
          project={p}
          onClose={() => setLaunchDialog(null)}
          onApply={(changes) => {
            const problem = edit((project) => {
              const { nodes, issues } = inspectNodeCoordinateChanges(
                project,
                changes,
              );
              if (issues.length)
                throw new Error(issues.map(({ message }) => message).join(" "));
              project.nodes = nodes;
            });
            if (!problem)
              setMessage(
                "Coordenadas atualizadas. Clique em Analisar para calcular o caso.",
              );
            return problem;
          }}
          onImportTabular={(plan) => {
            const problem = edit((project) =>
              applyTabularImport(project, plan),
            );
            if (!problem)
              setMessage(
                `Importação concluída: ${plan.counts.nodesCreated} nós criados, ${plan.counts.nodesUpdated} atualizados · ${plan.counts.membersCreated} barras criadas, ${plan.counts.membersUpdated} atualizadas.`,
              );
            return problem;
          }}
        />
      )}
      {launchDialog === "guides" && (
        <GuideEditor
          guides={p.guides}
          onClose={() => setLaunchDialog(null)}
          onApply={(guides) =>
            edit((p) => {
              p.guides = guides;
            })
          }
        />
      )}
      {launchDialog === "duplicates" && (
        <DuplicateDialog
          project={p}
          onHighlight={setDiagnosticHighlight}
          onClose={() => setLaunchDialog(null)}
          onApply={(source, next) => {
            if (current.current !== source)
              return "O modelo mudou. Reabra o diagnóstico.";
            const error = edit((draft) => {
              draft.nodes = next.nodes;
              draft.members = next.members;
              draft.loadPatterns = next.loadPatterns;
              draft.selectionGroups = next.selectionGroups;
              draft.meshConnections = next.meshConnections;
            });
            if (!error) {
              changeTool("select");
              setSelection([]);
              setMessage(
                "Correções aplicadas. Reabra Duplicidades para consultar os pares restantes.",
              );
            }
            return error;
          }}
        />
      )}
      {launchDialog === "sections" && (
        <SectionCatalog
          initialId={catalogSectionId}
          project={p}
          edit={edit}
          onClose={() => setLaunchDialog(null)}
        />
      )}
      {launchDialog === "materials" && (
        <MaterialLibrary
          project={p}
          selection={selection}
          edit={edit}
          onClose={() => setLaunchDialog(null)}
        />
      )}
      {launchDialog === "mesh" && (
        <MeshConnections
          project={p}
          selection={selection}
          edit={edit}
          onClose={() => setLaunchDialog(null)}
        />
      )}
      {launchDialog === "member-edit" && (
        <MemberEditDialog
          project={p}
          ids={selection.map((s) => s.id)}
          plane={plane.kind}
          onClose={() => setLaunchDialog(null)}
          onApply={applyGeometry}
        />
      )}
      {launchDialog === "replicate" && (
        <TransformDialog
          project={p}
          selection={selection}
          plane={plane.kind}
          initial={{
            ...origin,
            x: plane.kind === "XY" ? 0 : 1,
            z:
              plane.kind === "XY"
                ? ([...p.guides.z]
                    .sort((a, b) => a.position - b.position)
                    .find((g) => g.position > plane.offset)?.position ??
                    plane.offset) - plane.offset
                : 0,
          }}
          onApply={applyGeometry}
          onClose={() => setLaunchDialog(null)}
        />
      )}
      {launchDialog === "new-project" && (
        <NewProjectDialog
          onClose={() => setLaunchDialog(null)}
          onCreate={(project) =>
            protect("Substituir o projeto atual", () => replace(project))
          }
        />
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
