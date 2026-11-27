import { SlabJointPlan } from "./SlabJointPlan";
import { patternWind } from "../domain/wind";
import ThermalLoadGlyph from "./ThermalLoadGlyph";
import {
  useCallback,
  useEffect,
  useMemo,
  useId,
  useLayoutEffect,
  type RefObject,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import {
  coordinates,
  beamAxes,
  interpolate,
  distance,
  normalizeCoord,
  onPlane,
  parseDecimalInput,
  planeCoordinates,
  planePoint,
  relativePointOnPlane,
  tolerance,
  type Coordinate,
  type Point3,
  type WorkPlane,
} from "../domain/geometry";
import { resolveWorkPlaneSnap, type SnapCandidate } from "../domain/snap";
import type { Project, SelectedObject, Selection } from "../domain/model";
import type { MemberForceComponent } from "../solver/combinations";
import type { MemberEnvelopeResult } from "../solver/envelopes";
import type { SectionCursor, MemberDiagram } from "../solver/memberDiagram";
import type { StructuralResult } from "../solver/oofem";
import { pickGuideSpan } from "../domain/guideSpan";
import { memberAxis, memberOnPlane } from "../domain/memberOffsets";
import { actionVector, pointFraction } from "../domain/memberPointLoads";
import DistributedLoadGlyph from "./DistributedLoadGlyph";
import PointLoadGlyph, { pointLoadLabel } from "./PointLoadGlyph";
import { beamMeshLayout, nearestSection } from "../domain/beamMesh";
import { ViewLayers, type LayerControls } from "./ViewLayers";
import SelectionWindow from "./SelectionWindow";
import { objectsInWindow } from "../domain/selection";
import { slabRings } from "../domain/slabPolygon";
import { panelGeometry } from "../domain/surfacePanel";
import SlabPlan from "./SlabPlan";
import type { SlabMap } from "./SlabResults";
import { formatQuantity, fromSI, toSI } from "../units";
import { useUnits } from "./Units";
import MemberAxes2D from "./MemberAxes2D";
import {
  forceQuantity,
  formatResultQuantity,
  getForceLabel,
} from "./resultFormatting";
import InclinedSupport2D from "./InclinedSupport2D";

export type PlaneCamera = {
  projectId: string;
  kind: WorkPlane["kind"];
  u: number;
  v: number;
  scale: number;
};

export type Tool =
  | "select"
  | "node"
  | "member"
  | "slab"
  | "slabPolygon"
  | "slabHole"
  | "pointLoad"
  | "distributedLoad";
export type Display = "model" | "deformed" | MemberForceComponent;
interface Props {
  project: Project;
  showPanelAxes: boolean;
  showMemberAxes: boolean;
  plane: WorkPlane;
  orthogonal: boolean;
  selection: SelectedObject[];
  tool: Tool;
  quick: boolean;
  onWindow: (objects: SelectedObject[], additive: boolean) => void;
  onPickLoad?: (id: string, point: Point3) => void;
  onSpan: (from: Point3, to: Point3) => void;
  result: StructuralResult | null;
  envelope: MemberEnvelopeResult | null;
  sectionPlot: {
    memberId: string;
    t: number;
    min: number;
    max: number;
    points: ReturnType<MemberDiagram["trace"]>;
  } | null;
  onSection: (section: SectionCursor) => void;
  display: Display;
  slabMap: SlabMap | null;
  floorMaps?: SlabMap[];
  onPanel?: (id: string) => void;
  onJoint?: () => void;
  patternId: string;
  resultPatterns: ReadonlySet<string>;
  active: boolean;
  savedCamera: RefObject<PlaneCamera | null>;
  onActivate: () => void;
  outline: Point3[];
  pending: Point3 | null;
  onPoint: (p: Point3) => void;
  onSelect: (s: Selection, additive: boolean) => void;
}

export const additiveSelection = (e: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) => e.ctrlKey || e.metaKey || e.shiftKey;

export default function WorkPlaneView({
  active,
  onActivate,
  savedCamera,
  layers,
  setLayers,
  project,
  showPanelAxes,
  showMemberAxes,
  plane,
  orthogonal,
  selection,
  tool: activeTool,
  quick,
  onWindow,
  onSpan,
  onPickLoad,
  result,
  envelope: envelopeResult,
  sectionPlot,
  onSection,
  display,
  slabMap,
  floorMaps,
  patternId,
  resultPatterns,
  pending,
  outline,
  onPoint,
  onSelect,
  onPanel,
  onJoint,
}: Props & LayerControls) {
  const { units } = useUnits();
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 700, height: 460 });
  const [camera, setCamera] = useState({ u: 3, v: 1.5, scale: 65 });
  const [cursor, setCursor] = useState<SnapCandidate | null>(null);
  const [lastNodeAnchor, setLastNodeAnchor] = useState<Point3 | null>(null);
  const [deltaU, setDeltaU] = useState("");
  const [deltaV, setDeltaV] = useState("");
  const [relativeError, setRelativeError] = useState("");
  const [relativeInvalid, setRelativeInvalid] = useState({
    u: false,
    v: false,
  });
  const pan = useRef<{ x: number; y: number; u: number; v: number } | null>(
    null,
  );
  const [spanPointer, setSpanPointer] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // The span picker handles its own hits and does not request point placement.
  const tool =
    quick || activeTool === "pointLoad" || activeTool === "distributedLoad"
      ? "select"
      : activeTool;
  useEffect(() => {
    setSpanPointer(null);
    if (quick) setCursor(null);
  }, [quick, plane.kind, plane.offset, project.id]);
  const { labels } = layers;
  const mesh = useMemo(
    () => (layers.mesh ? beamMeshLayout(project) : null),
    [layers.mesh, project],
  );
  const markerId = useId();
  const spatial = project.mode === "spatial";
  const [axisU, axisV, normal] = planeCoordinates[plane.kind];
  const uGuides = spatial || quick ? project.guides[axisU] : [];
  const vGuides = spatial || quick ? project.guides[axisV] : [];
  const nodes = project.nodes.filter((n) => onPlane(n, plane));
  const nodeMap = new Map(project.nodes.map((n) => [n.id, n]));
  const bars = project.members.filter((m) =>
    memberOnPlane(m, nodeMap.get(m.start)!, nodeMap.get(m.end)!, plane),
  );
  const selected = new Set(selection.map((s) => `${s.kind}:${s.id}`));
  const hasMemberSelection = selection.some((item) => item.kind === "member");
  const patterns = project.loadPatterns.find((p) => p.id === patternId)!;
  const wind =
    layers.loads && display === "model"
      ? patternWind(nodeMap, project.mode, patterns)
      : [];
  const nodalActions = [...patterns.nodal, ...wind.flatMap((w) => w.loads)];
  const displayedPatterns =
    display === "model"
      ? [patterns]
      : project.loadPatterns.filter((p) => resultPatterns.has(p.id));
  const floors =
    plane.kind === "XY"
      ? (project.diaphragms ?? []).filter((floor) =>
          project.guides.z.some(
            (level) =>
              level.id === floor.levelId && level.position === plane.offset,
          ),
        )
      : [];
  const slabs =
    plane.kind === "XY"
      ? project.slabs.filter((item) =>
          project.guides.z.some(
            (level) =>
              level.id === item.levelId && level.position === plane.offset,
          ),
        )
      : [];
  const tracing = tool === "slabPolygon" || tool === "slabHole";
  // A barra de coordenadas muda a altura do SVG ao ativar uma ferramenta.
  // Atualize a projeção antes de pintar a grade ou receber o primeiro clique.
  useLayoutEffect(() => {
    const svg = ref.current!;
    const measure = ({ width, height }: DOMRectReadOnly) =>
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    measure(svg.getBoundingClientRect());
    const observer = new ResizeObserver(([entry]) =>
      measure(entry.contentRect),
    );
    observer.observe(svg);
    return () => observer.disconnect();
  }, [tool, plane.kind, plane.offset, units.length, relativeError]);

  const cameraBeforeFit = useRef(camera);
  const fit = () => {
    const points = [
      ...project.nodes,
      ...(project.surfacePanels ?? []).flatMap((p) =>
        Object.values(panelGeometry(p).corners),
      ),
      ...slabs.flatMap((slab) =>
        slabRings(slab)[0].map((v) => ({ ...v, z: plane.offset })),
      ),
      ...floors.map((floor) => ({ ...floor.reference, z: plane.offset })),
      ...bars.flatMap((m) => {
        if (!m.offsets) return [];
        const line = memberAxis(m, nodeMap.get(m.start)!, nodeMap.get(m.end)!);
        return [line.start, line.end];
      }),
    ];
    const us = [
      ...points.map((n) => n[axisU]),
      ...uGuides.map((g) => g.position),
    ];
    const vs = [
      ...points.map((n) => n[axisV]),
      ...vGuides.map((g) => g.position),
    ];
    const minU = Math.min(0, ...us),
      maxU = Math.max(6, ...us);
    const minV = Math.min(0, ...vs),
      maxV = Math.max(0, ...vs);
    const bounds = ref.current?.getBoundingClientRect() ?? size;
    setCamera({
      u: (minU + maxU) / 2,
      v: (minV + maxV) / 2,
      scale: Math.max(
        10,
        Math.min(
          (bounds.width - 105) / Math.max(6, maxU - minU),
          (bounds.height - Math.min(120, bounds.height * 0.35)) /
            Math.max(3, maxV - minV),
          100,
        ),
      ),
    });
  };
  useLayoutEffect(() => {
    cameraBeforeFit.current = camera;
    const previous = savedCamera.current;
    if (
      previous &&
      previous.projectId === project.id &&
      previous.kind === plane.kind
    )
      setCamera({ u: previous.u, v: previous.v, scale: previous.scale });
    else fit();
    setCursor(null);
  }, [project.id, plane.kind]);
  useEffect(() => {
    setCursor(null);
    setLastNodeAnchor(null);
    setDeltaU("");
    setDeltaV("");
    setRelativeError("");
    setRelativeInvalid({ u: false, v: false });
  }, [project.id, plane.kind, plane.offset, tool]);

  useEffect(() => {
    setDeltaU("");
    setDeltaV("");
    setRelativeError("");
    setRelativeInvalid({ u: false, v: false });
  }, [units.length]);

  const snapAnchor =
    tracing && outline.length
      ? outline.at(-1)!
      : tool === "member" && pending && onPlane(pending, plane)
        ? pending
        : tool === "node" && lastNodeAnchor && onPlane(lastNodeAnchor, plane)
          ? lastNodeAnchor
          : null;
  const relativeAnchor = snapAnchor ?? planePoint(0, 0, plane);

  const sx = useCallback(
    (u: number) => size.width / 2 + (u - camera.u) * camera.scale,
    [size.width, camera],
  );
  const sy = useCallback(
    (v: number) => size.height / 2 - (v - camera.v) * camera.scale,
    [size.height, camera],
  );
  const resolveCursor = (event: {
    clientX: number;
    clientY: number;
    shiftKey: boolean;
  }): SnapCandidate => {
    const rect = ref.current!.getBoundingClientRect();
    const rawU =
      (event.clientX - rect.left - size.width / 2) / camera.scale + camera.u;
    const rawV =
      -(event.clientY - rect.top - size.height / 2) / camera.scale + camera.v;
    const candidate = resolveWorkPlaneSnap({
      rawU,
      rawV,
      scale: camera.scale,
      plane,
      spatial,
      orthogonal,
      shiftKey: event.shiftKey,
      tool: tracing ? "slab" : tool,
      anchor: snapAnchor,
      nodes: project.nodes,
      members: project.members,
      uGuides,
      vGuides,
    });
    if (candidate.kind === "grid")
      candidate.label = `Malha ${displayLength(0.5)} ${units.length}`;
    return candidate;
  };

  const displayLength = (si: number) =>
    fromSI(si, "length", units).toFixed(2).replace(".", ",");
  const parsedDeltaU = toSI(parseDecimalInput(deltaU), "length", units);
  const parsedDeltaV = toSI(parseDecimalInput(deltaV), "length", units);
  const hasRelativeBoth =
    Number.isFinite(parsedDeltaU) && Number.isFinite(parsedDeltaV);
  const relativeDistance = hasRelativeBoth
    ? Math.hypot(parsedDeltaU, parsedDeltaV)
    : NaN;
  const relativePreview: SnapCandidate | null =
    (tool === "member" || tool === "node" || tracing) &&
    hasRelativeBoth &&
    !(
      tool === "member" &&
      pending &&
      onPlane(pending, plane) &&
      relativeDistance < tolerance
    )
      ? (() => {
          const target = relativePointOnPlane(
            relativeAnchor,
            parsedDeltaU,
            parsedDeltaV,
            plane,
          );
          if (
            !Number.isFinite(target[axisU]) ||
            !Number.isFinite(target[axisV]) ||
            !Number.isFinite(relativeDistance)
          )
            return null;
          return {
            u: target[axisU],
            v: target[axisV],
            point: target,
            kind: "relative",
            label: "Coordenada relativa",
            distance: normalizeCoord(relativeDistance),
            screenErrorPx: 0,
          };
        })()
      : null;
  const activeCandidate = relativePreview ?? cursor;

  const cancelRelative = (input?: HTMLInputElement | null) => {
    setDeltaU("");
    setDeltaV("");
    setRelativeError("");
    setRelativeInvalid({ u: false, v: false });
    input?.blur();
  };

  const handleRelativeSubmit = (e: FormEvent) => {
    e.preventDefault();
    const invalidU = !Number.isFinite(parsedDeltaU);
    const invalidV = !Number.isFinite(parsedDeltaV);
    if (invalidU || invalidV) {
      setRelativeInvalid({ u: invalidU, v: invalidV });
      setRelativeError(
        `Informe Δ${axisU.toUpperCase()} e Δ${axisV.toUpperCase()} numéricos em ${units.length}.`,
      );
      return;
    }
    if (
      tool === "member" &&
      pending &&
      onPlane(pending, plane) &&
      Math.hypot(parsedDeltaU, parsedDeltaV) < tolerance
    ) {
      setRelativeInvalid({ u: true, v: true });
      setRelativeError("Informe um incremento não nulo a partir da origem.");
      return;
    }
    if (!relativePreview) {
      setRelativeError("As coordenadas excedem o intervalo numérico.");
      return;
    }
    const target = relativePreview.point;
    if (tool === "node") setLastNodeAnchor(target);
    onPoint(target);
    setDeltaU("");
    setDeltaV("");
    setRelativeError("");
    setRelativeInvalid({ u: false, v: false });
  };

  const allStations = result ? Object.values(result.members).flat() : [];
  const dofU = `u${axisU}` as const,
    dofV = `u${axisV}` as const;
  const maxU = Math.max(
    1e-12,
    ...allStations.map((s) => Math.hypot(s[dofU], s[dofV])),
  );
  const deformationScale = 60 / (maxU * camera.scale);
  const component =
    display === "model" || display === "deformed" ? null : display;
  const maxForce = useMemo(() => {
    let magnitude = 1;
    if (sectionPlot)
      for (const p of sectionPlot.points)
        magnitude = Math.max(magnitude, Math.abs(p.max), Math.abs(p.min));
    if (!component) return magnitude;
    if (envelopeResult) {
      for (const stations of Object.values(envelopeResult)) {
        for (const station of stations) {
          const { min, max } = station.ranges[component];
          magnitude = Math.max(
            magnitude,
            Math.abs(min.forces[component]),
            Math.abs(max.forces[component]),
          );
        }
      }
    } else {
      for (const stations of Object.values(result?.members ?? {}))
        for (const station of stations)
          magnitude = Math.max(magnitude, Math.abs(station[component]));
    }
    return magnitude;
  }, [component, envelopeResult, result, sectionPlot]);
  const gridStep = camera.scale < 25 ? 2 : camera.scale > 120 ? 0.5 : 1;
  const grid = (center: number, pixels: number) => {
    const start =
      Math.floor((center - pixels / 2 / camera.scale) / gridStep) * gridStep;
    return Array.from(
      { length: Math.ceil(pixels / camera.scale / gridStep) + 2 },
      (_, i) => start + i * gridStep,
    );
  };
  function pointerPosition(event: MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function spanAt({ x, y }: { x: number; y: number }) {
    return pickGuideSpan(
      project.guides,
      plane,
      (x - sx(0)) / camera.scale,
      (sy(0) - y) / camera.scale,
      8 / camera.scale,
    );
  }
  const hoverSpan = quick && spanPointer ? spanAt(spanPointer) : null;
  const arrow = (x: number, y: number, dx: number, dy: number, key: string) => (
    <line
      key={key}
      x1={x - dx}
      y1={y - dy}
      x2={x}
      y2={y}
      stroke="var(--geometry-load)"
      strokeWidth="1.4"
      markerEnd={`url(#${markerId})`}
    />
  );
  useEffect(() => {
    // A project or plane change schedules a new framing. Only cache it after it has been applied.
    if (camera !== cameraBeforeFit.current)
      savedCamera.current = {
        projectId: project.id,
        kind: plane.kind,
        ...camera,
      };
  }, [camera, project.id, plane.kind, savedCamera]);
  const heading = plane.kind === "XY" ? "Planta XY" : `Elevação ${plane.kind}`;

  return (
    <section
      className="viewport elevation"
      tabIndex={0}
      aria-label={heading}
      data-active={active}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
    >
      <div className="view-heading">
        <span>
          <i className="view-dot" />
          {heading}{" "}
          <small>
            {normal.toUpperCase()} ={" "}
            {formatQuantity(plane.offset, "length", units)} {units.length}
          </small>
        </span>
        <div className="view-actions">
          <button
            title="Diminuir zoom"
            aria-label="Diminuir zoom"
            onClick={() =>
              setCamera((c) => ({ ...c, scale: Math.max(10, c.scale / 1.2) }))
            }
          >
            <Minus size={14} />
          </button>
          <button
            title="Aumentar zoom"
            aria-label="Aumentar zoom"
            onClick={() =>
              setCamera((c) => ({ ...c, scale: Math.min(300, c.scale * 1.2) }))
            }
          >
            <Plus size={14} />
          </button>
          <button
            title="Enquadrar modelo"
            aria-label="Enquadrar modelo"
            onClick={fit}
          >
            <Maximize size={14} />
          </button>
          <ViewLayers layers={layers} setLayers={setLayers} />
        </div>
      </div>
      <svg
        ref={ref}
        className={`drawing drawing-${onPickLoad ? "point-load" : quick ? "span" : tool}`}
        aria-label={`Área de lançamento ${plane.kind}`}
        role="application"
        tabIndex={0}
        onPointerMoveCapture={(event) => {
          if (!quick || pan.current) return;
          event.stopPropagation();
          setSpanPointer(pointerPosition(event));
        }}
        onPointerOutCapture={(event) => {
          if (
            quick &&
            !event.currentTarget.contains(
              event.relatedTarget instanceof Node ? event.relatedTarget : null,
            )
          )
            setSpanPointer(null);
        }}
        onClickCapture={(event) => {
          if (onPickLoad) {
            event.stopPropagation();
            const pointer = pointerPosition(event);
            let best: { id: string; point: Point3; gap: number } | undefined;
            for (const m of bars) {
              const line = memberAxis(
                m,
                nodeMap.get(m.start)!,
                nodeMap.get(m.end)!,
              );
              const x = sx(line.start[axisU]),
                y = sy(line.start[axisV]);
              const du = sx(line.end[axisU]) - x,
                dv = sy(line.end[axisV]) - y;
              const squared = du * du + dv * dv;
              if (!squared) continue;
              const t = Math.max(
                0,
                Math.min(
                  1,
                  ((pointer.x - x) * du + (pointer.y - y) * dv) / squared,
                ),
              );
              const gap = Math.hypot(
                pointer.x - x - t * du,
                pointer.y - y - t * dv,
              );
              if (gap <= 8 && (!best || gap < best.gap))
                best = {
                  id: m.id,
                  point: interpolate(line.start, line.end, t),
                  gap,
                };
            }
            if (best) onPickLoad(best.id, best.point);
            return;
          }
          if (!quick) return;
          event.stopPropagation();
          const point = pointerPosition(event);
          setSpanPointer(point);
          const span = spanAt(point);
          if (span) onSpan(...span);
        }}
        onWheel={(e) => {
          e.preventDefault();
          setCamera((c) => ({
            ...c,
            scale: Math.max(
              10,
              Math.min(300, c.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)),
            ),
          }));
        }}
        onPointerDown={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          pan.current = {
            x: e.clientX,
            y: e.clientY,
            u: camera.u,
            v: camera.v,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (!pan.current) return;
          pan.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
        onPointerMove={(e) => {
          const p = pan.current;
          if (p) {
            setCamera((c) => ({
              ...c,
              u: p.u - (e.clientX - p.x) / c.scale,
              v: p.v + (e.clientY - p.y) / c.scale,
            }));
          } else setCursor(resolveCursor(e));
        }}
        onPointerLeave={() => setCursor(null)}
        onClick={(e) => {
          if (tool === "select") onSelect(null, additiveSelection(e));
          else {
            const snapped = relativePreview ?? resolveCursor(e);
            if (relativePreview) cancelRelative();
            setCursor(snapped);
            if (tool === "node") setLastNodeAnchor(snapped.point);
            onPoint(snapped.point);
          }
        }}
      >
        <defs>
          <marker
            id={markerId}
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0 0 L7 3.5 L0 7" fill="var(--geometry-load)" />
          </marker>
        </defs>
        <g className="grid" visibility={layers.grid ? "visible" : "hidden"}>
          {grid(camera.u, size.width).map((u) => (
            <g key={u}>
              <line
                x1={sx(u)}
                x2={sx(u)}
                y1="0"
                y2={size.height}
                className={u === 0 ? "axis" : ""}
              />
              <text x={sx(u) + 4} y={size.height - 10}>
                {Number(fromSI(u, "length", units).toFixed(2))}
              </text>
            </g>
          ))}
          {grid(camera.v, size.height).map((v) => (
            <g key={v}>
              <line
                x1="0"
                x2={size.width}
                y1={sy(v)}
                y2={sy(v)}
                className={v === 0 ? "axis" : ""}
              />
              <text x="8" y={sy(v) - 5}>
                {Number(fromSI(v, "length", units).toFixed(2))}
              </text>
            </g>
          ))}
        </g>
        <g
          className="work-guides"
          aria-hidden="true"
          visibility={layers.grid ? "visible" : "hidden"}
        >
          {uGuides.map((g) => (
            <g key={g.id}>
              <line
                x1={sx(g.position)}
                x2={sx(g.position)}
                y1="0"
                y2={size.height}
                data-axis={axisU}
                data-position={g.position}
              />
              <text x={sx(g.position) + 5} y="17">
                {g.name}
              </text>
            </g>
          ))}
          {vGuides.map((g) => (
            <g key={g.id}>
              <line
                x1="0"
                x2={size.width}
                y1={sy(g.position)}
                y2={sy(g.position)}
                data-axis={axisV}
                data-position={g.position}
              />
              <text x={size.width - 8} y={sy(g.position) - 5} textAnchor="end">
                {g.name}
              </text>
            </g>
          ))}
        </g>
        {hoverSpan && (
          <line
            aria-label="Vão a lançar"
            pointerEvents="none"
            x1={sx(hoverSpan[0][axisU])}
            y1={sy(hoverSpan[0][axisV])}
            x2={sx(hoverSpan[1][axisU])}
            y2={sy(hoverSpan[1][axisV])}
            stroke="var(--geometry-selected)"
            strokeWidth={6}
            strokeDasharray="8 3"
          />
        )}
        {project.surfacePanels?.map((panel) => {
          const { corners, materialAxes } = panelGeometry(panel),
            pts = Object.values(corners);
          const visibleSide =
            materialAxes[2][normal] * (plane.kind === "XZ" ? -1 : 1) >= 0
              ? "+3"
              : "−3";
          const face = pts.every((p) => onPlane(p, plane)),
            trace: Point3[] = [];
          for (const [i, a] of pts.entries()) {
            const b = pts[(i + 1) % 4],
              da = a[normal] - plane.offset,
              db = b[normal] - plane.offset;
            if (onPlane(a, plane)) trace.push(a);
            else if (!onPlane(b, plane) && da * db < 0)
              trace.push(interpolate(a, b, da / (da - db)));
          }
          if (trace.length < 2) return null;
          const cu = trace.reduce((v, p) => v + sx(p[axisU]), 0) / trace.length,
            cv = trace.reduce((v, p) => v + sy(p[axisV]), 0) / trace.length;
          const points = trace
            .map((p) => `${sx(p[axisU])},${sy(p[axisV])}`)
            .join(" ");
          return (
            <g
              key={panel.id}
              className="spatial-panel-trace"
              aria-label={panel.name}
              onClick={(e) => {
                if (tool === "select") {
                  e.stopPropagation();
                  onPanel?.(panel.id);
                }
              }}
            >
              {face ? (
                <polygon
                  points={points}
                  data-face={showPanelAxes ? visibleSide : undefined}
                />
              ) : (
                <polyline points={points} />
              )}
              {showPanelAxes && (
                <g
                  className="panel-plan-axes"
                  aria-label={panel.name + " · orientação"}
                >
                  {materialAxes.map((a, i) => {
                    const dx = 24 * a[axisU],
                      dy = -24 * a[axisV];
                    if (Math.hypot(dx, dy) < 4) return null;
                    return (
                      <g key={i} className={"panel-axis-" + (i + 1)}>
                        <path d={`M ${cu} ${cv} l ${dx} ${dy}`} />
                        <text x={cu + 1.12 * dx} y={cv + 1.12 * dy}>
                          {i === 2 ? "+3" : i + 1}
                        </text>
                      </g>
                    );
                  })}
                  {face ? (
                    <text x={cu + 6} y={cv + 15}>
                      Face {visibleSide}
                    </text>
                  ) : (
                    <text
                      x={cu - 28 * materialAxes[2][axisU]}
                      y={cv + 28 * materialAxes[2][axisV]}
                    >
                      −3
                    </text>
                  )}
                </g>
              )}
              {labels && (
                <text x={sx(trace[0][axisU]) + 4} y={sy(trace[0][axisV]) - 4}>
                  {panel.name}
                </text>
              )}
            </g>
          );
        })}
        {slabs.map((slab) => (
          <SlabPlan
            key={slab.id}
            jointEdge={
              project.slabJoint?.a.slabId === slab.id
                ? project.slabJoint.a.edgeId
                : project.slabJoint?.b.slabId === slab.id
                  ? project.slabJoint.b.edgeId
                  : undefined
            }
            slab={slab}
            z={plane.offset}
            sx={sx}
            sy={sy}
            active={selected.has(`slab:${slab.id}`)}
            labels={labels}
            map={
              floorMaps?.find((m) => m.result.slabId === slab.id) ??
              (slabMap?.result.slabId === slab.id ? slabMap : null)
            }
            pressure={
              layers.loads
                ? (patterns.pressure.find(({ slabId }) => slabId === slab.id)
                    ?.pz ?? 0)
                : 0
            }
            onClick={(event) => {
              if (tool === "select") {
                event.stopPropagation();
                onSelect(
                  { kind: "slab", id: slab.id },
                  additiveSelection(event),
                );
              }
            }}
          />
        ))}
        {bars.map((m) => {
          const a = nodeMap.get(m.start)!,
            b = nodeMap.get(m.end)!;
          const line = memberAxis(m, a, b);
          const thermal =
            display === "model" &&
            layers.loads &&
            patterns.thermal?.find((f) => f.memberId === m.id);
          const u = line.faceI[axisU],
            v = line.faceI[axisV],
            du = line.faceJ[axisU] - u,
            dv = line.faceJ[axisV] - v;
          const point = (p: Point3) => `${sx(p[axisU])},${sy(p[axisV])}`;
          const active = selected.has(`member:${m.id}`);
          const loads = patterns.uniform.filter((l) => l.memberId === m.id);
          const components = coordinates.map((k) =>
            loads.reduce((sum, l) => sum + l[`q${k}`], 0),
          );
          const qu = components[coordinates.indexOf(axisU)],
            qv = components[coordinates.indexOf(axisV)];
          const norm = Math.hypot(qu, qv);
          const length = Math.hypot(du, dv);
          const stations = result?.members[m.id];
          const envelopeStations = envelopeResult?.[m.id];
          const forcePoint = (t: number, value: number) => {
            const offset = ((value / maxForce) * 70) / camera.scale;
            return [
              sx(u + du * t + (dv / length) * offset),
              sy(v + dv * t - (du / length) * offset),
            ] as const;
          };
          const inspected = sectionPlot?.memberId === m.id ? sectionPlot : null;
          const band =
            envelopeStations && component && length >= tolerance
              ? {
                  max: inspected
                    ? inspected.points.map((p) => forcePoint(p.t, p.max))
                    : envelopeStations.map((s) =>
                        forcePoint(
                          s.t,
                          s.ranges[component].max.forces[component],
                        ),
                      ),
                  min: inspected
                    ? inspected.points.map((p) => forcePoint(p.t, p.min))
                    : envelopeStations.map((s) =>
                        forcePoint(
                          s.t,
                          s.ranges[component].min.forces[component],
                        ),
                      ),
                }
              : null;
          const sectionAt = (event: { clientX: number; clientY: number }) => {
            const samples = envelopeStations ?? stations;
            if (
              !component ||
              !samples?.length ||
              length < tolerance ||
              tool !== "select"
            )
              return;
            const bounds = ref.current!.getBoundingClientRect();
            const x = (event.clientX - bounds.left - sx(u)) / camera.scale;
            const y = (sy(v) - (event.clientY - bounds.top)) / camera.scale;
            const t = Math.min(1, Math.max(0, (x * du + y * dv) / length ** 2));
            let index = nearestSection(samples, t);
            if (Math.abs(t - samples[index].t) * length * camera.scale > 2) {
              onSection({ memberId: m.id, t });
              return;
            }
            if (samples[index].side) {
              const other = index + (samples[index].side === "left" ? 1 : -1);
              const toCurve = (i: number) => {
                const range = envelopeStations?.[i].ranges[component];
                const values = range
                  ? [range.min.forces[component], range.max.forces[component]]
                  : [stations![i][component]];
                return Math.min(
                  ...values.map((v) => {
                    const [px, py] = forcePoint(samples[i].t, v);
                    return Math.hypot(
                      px + bounds.left - event.clientX,
                      py + bounds.top - event.clientY,
                    );
                  }),
                );
              };
              if (toCurve(other) < toCurve(index)) index = other;
            }
            onSection({
              memberId: m.id,
              t: samples[index].t,
              side: samples[index].side,
            });
          };
          let diagram: string | undefined;
          if (stations && display !== "model" && length >= tolerance) {
            diagram =
              inspected && component
                ? inspected.points
                    .map((p) => forcePoint(p.t, p.max).join(","))
                    .join(" ")
                : stations
                    .map((s) => {
                      if (display === "deformed")
                        return `${sx(u + du * s.t + s[dofU] * deformationScale)},${sy(v + dv * s.t + s[dofV] * deformationScale)}`;
                      return forcePoint(s.t, s[display]).join(",");
                    })
                    .join(" ");
          }
          return (
            <g key={m.id}>
              {m.offsets && (
                <g aria-label={`Braços rígidos de ${m.name}`}>
                  <line
                    x1={sx(a[axisU])}
                    y1={sy(a[axisV])}
                    x2={sx(b[axisU])}
                    y2={sy(b[axisV])}
                    stroke="var(--geometry-member)"
                    strokeDasharray="5 4"
                    opacity=".55"
                    pointerEvents="none"
                  >
                    <title>Linha entre os nós de lançamento</title>
                  </line>
                  {(
                    [
                      [a, line.start, line.faceI, "i"],
                      [b, line.end, line.faceJ, "j"],
                    ] as const
                  ).map(
                    ([joint, insertion, face, side]) =>
                      (distance(joint, insertion) > 0 ||
                        distance(insertion, face) > 0) && (
                        <g
                          key={side}
                          onClick={(event) => {
                            if (tool === "select") {
                              event.stopPropagation();
                              onSelect(
                                { kind: "member", id: m.id },
                                additiveSelection(event),
                              );
                            }
                          }}
                        >
                          <title>{`Braço rígido e face ${side} de ${m.name}`}</title>
                          <polyline
                            points={[joint, insertion, face]
                              .map(point)
                              .join(" ")}
                            fill="none"
                            stroke="var(--geometry-support)"
                            strokeWidth="4"
                          />
                          <circle
                            data-rigid-face={side}
                            cx={sx(face[axisU])}
                            cy={sy(face[axisV])}
                            r="3.5"
                            fill="var(--geometry-support)"
                          />
                        </g>
                      ),
                  )}
                </g>
              )}
              <line
                data-member-id={m.id}
                x1={sx(u)}
                y1={sy(v)}
                x2={sx(u + du)}
                y2={sy(v + dv)}
                stroke={
                  active ? "var(--geometry-selected)" : "var(--geometry-member)"
                }
                strokeWidth={active ? 4 : 2.5}
              />
              {display === "model" &&
                (["i", "j"] as const).flatMap((end) => {
                  const connection =
                    end === "i" ? m.connectionI : m.connectionJ;
                  if (!connection) return [];
                  const activeDofs =
                    project.mode === "spatial"
                      ? (["ux", "uy", "uz", "rx", "ry", "rz"] as const)
                      : (["ux", "uz", "ry"] as const);
                  const released = activeDofs.filter(
                    (dof) => connection[dof].kind !== "rigid",
                  );
                  if (!released.length) return [];
                  const t = end === "i" ? 0 : 1;
                  const x = sx(u + du * t);
                  const y = sy(v + dv * t);
                  return [
                    <g
                      key={`connection-${end}`}
                      className="connection-release-marker"
                      data-member-connection-end={end}
                      aria-label={`Ligação ${end} liberada: ${released.join(", ")}`}
                      pointerEvents="none"
                    >
                      <circle cx={x} cy={y} r="5.5" />
                      <title>{`Ligação ${end}: ${released
                        .map(
                          (dof) =>
                            `${dof.toUpperCase()} ${connection[dof].kind === "free" ? "livre" : "elástica"}`,
                        )
                        .join(", ")}`}</title>
                    </g>,
                  ];
                })}
              <line
                x1={sx(u)}
                y1={sy(v)}
                x2={sx(u + du)}
                y2={sy(v + dv)}
                stroke="transparent"
                strokeWidth="16"
                onClick={(e) => {
                  if (tool !== "select") return;
                  e.stopPropagation();
                  if (
                    (band || (component && stations)) &&
                    !additiveSelection(e)
                  )
                    sectionAt(e);
                  else
                    onSelect(
                      { kind: "member", id: m.id },
                      additiveSelection(e),
                    );
                }}
              />
              {thermal && (
                <ThermalLoadGlyph
                  field={thermal}
                  memberName={m.name}
                  anchor={interpolate(line.faceI, line.faceJ, 0.62)}
                  basis={beamAxes(line.start, line.end, m.roll, project.mode)}
                  plane={plane.kind}
                  sx={sx}
                  sy={sy}
                  marker={markerId}
                />
              )}
              {layers.loads &&
                displayedPatterns.flatMap((pattern) =>
                  (pattern.distributed ?? [])
                    .filter((load) => load.memberId === m.id)
                    .map((load) => (
                      <DistributedLoadGlyph
                        key={JSON.stringify([pattern.id, load.id])}
                        load={load}
                        line={line}
                        basis={beamAxes(
                          line.start,
                          line.end,
                          m.roll,
                          project.mode,
                        )}
                        axes={[axisU, axisV, normal]}
                        project={(at) => [sx(at[axisU]), sy(at[axisV])]}
                        marker={markerId}
                        units={units}
                        stationsOnly={display !== "model"}
                      />
                    )),
                )}
              {layers.loads &&
                display === "model" &&
                (patterns.points ?? [])
                  .filter((l) => l.memberId === m.id)
                  .map((load) => {
                    const point = interpolate(
                      line.start,
                      line.end,
                      pointFraction(load.position, line.span),
                    );
                    return (
                      <PointLoadGlyph
                        key={load.id}
                        x={sx(point[axisU])}
                        y={sy(point[axisV])}
                        axes={[axisU, axisV, normal]}
                        vector={actionVector(
                          load,
                          beamAxes(line.start, line.end, m.roll, project.mode),
                        )}
                        kind={load.kind}
                        marker={markerId}
                        label={pointLoadLabel(load, line.span, units)}
                      />
                    );
                  })}
              {mesh?.rigidLinks
                .filter((l) => l.memberId === m.id)
                .map(({ nodeId }) => {
                  const joint = nodeMap.get(nodeId)!;
                  return (
                    <circle
                      key={nodeId}
                      data-mesh-member={m.id}
                      data-mesh-joint={nodeId}
                      cx={sx(joint[axisU])}
                      cy={sy(joint[axisV])}
                      r="8"
                      fill="none"
                      stroke="var(--geometry-support)"
                      strokeWidth="2"
                      pointerEvents="none"
                    />
                  );
                })}
              {mesh?.stations
                .get(m.id)
                ?.slice(1, -1)
                .map(({ t, nodeId }) => (
                  <circle
                    key={t}
                    data-mesh-station={t}
                    data-mesh-member={m.id}
                    data-mesh-joint={nodeId}
                    cx={sx(u + du * t)}
                    cy={sy(v + dv * t)}
                    r={nodeId ? 8 : 3}
                    fill={nodeId ? "none" : "var(--geometry-deformed)"}
                    stroke={
                      nodeId
                        ? "var(--geometry-support)"
                        : "var(--geometry-deformed)"
                    }
                    strokeWidth={nodeId ? 2 : 1}
                    pointerEvents="none"
                  />
                ))}
              {labels && (
                <text
                  className="member-label"
                  x={sx(u + du / 2) + 8}
                  y={sy(v + dv / 2) + 19}
                >
                  {m.name}
                </text>
              )}
              {layers.loads &&
                display === "model" &&
                components.some(Boolean) && (
                  <g className="load-shape">
                    {norm > 0 &&
                      Array.from({ length: 9 }, (_, i) =>
                        arrow(
                          sx(
                            line.start[axisU] +
                              ((line.end[axisU] - line.start[axisU]) * i) / 8,
                          ),
                          sy(
                            line.start[axisV] +
                              ((line.end[axisV] - line.start[axisV]) * i) / 8,
                          ),
                          (qu / norm) * 34,
                          (-qv / norm) * 34,
                          String(i),
                        ),
                      )}
                    <text
                      x={sx(u + du / 2)}
                      y={sy(v + dv / 2) - (qv <= 0 ? 45 : -55)}
                      textAnchor="middle"
                    >
                      {components
                        .flatMap((q, i) =>
                          q
                            ? [
                                `q${coordinates[i].toUpperCase()} ${formatQuantity(q, "distributedLoad", units)}`,
                              ]
                            : [],
                        )
                        .join(" · ")}{" "}
                      {units.distributedLoad}
                    </text>
                  </g>
                )}
              {diagram &&
                (display === "deformed" ? (
                  <polyline
                    points={diagram}
                    fill="none"
                    stroke="var(--geometry-deformed)"
                    strokeWidth="2"
                    pointerEvents="none"
                  />
                ) : (
                  <polygon
                    points={`${sx(u)},${sy(v)} ${diagram} ${sx(u + du)},${sy(v + dv)}`}
                    fill="var(--geometry-result-fill)"
                    stroke="var(--geometry-result)"
                    strokeWidth="1.6"
                    className="member-force-diagram"
                    pointerEvents={
                      tool === "select" ? "visiblePainted" : "none"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (additiveSelection(e))
                        onSelect({ kind: "member", id: m.id }, true);
                      else sectionAt(e);
                    }}
                  />
                ))}
              {inspected && component && !band && length >= tolerance && (
                <circle
                  className="section-cursor"
                  aria-label="Cursor da seção"
                  cx={forcePoint(inspected.t, inspected.max)[0]}
                  cy={forcePoint(inspected.t, inspected.max)[1]}
                  r="4"
                  fill="var(--geometry-result)"
                  pointerEvents="none"
                />
              )}
              {band && (
                <g
                  className="envelope-plot"
                  onClick={(event) => {
                    event.stopPropagation();
                    sectionAt(event);
                  }}
                >
                  <polygon
                    points={[...band.max, ...[...band.min].reverse()]
                      .map((point) => point.join(","))
                      .join(" ")}
                    className="envelope-fill"
                  />
                  {(["max", "min"] as const).map((bound) => {
                    const points = band[bound];
                    const selectedPoint = inspected
                      ? forcePoint(inspected.t, inspected[bound])
                      : undefined;
                    return (
                      <g key={bound} className={`envelope-${bound}-line`}>
                        <polyline
                          points={points
                            .map((point) => point.join(","))
                            .join(" ")}
                        />
                        {selectedPoint && (
                          <circle
                            cx={selectedPoint[0]}
                            cy={selectedPoint[1]}
                            r="3.8"
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              )}
              {showMemberAxes &&
                (!hasMemberSelection || active) &&
                length >= tolerance && (
                  <MemberAxes2D
                    member={m}
                    a={{ ...a, ...line.faceI }}
                    b={{ ...b, ...line.faceJ }}
                    mode={project.mode}
                    plane={plane.kind}
                    sx={sx}
                    sy={sy}
                  />
                )}
              {showMemberAxes &&
                active &&
                diagram &&
                display !== "deformed" &&
                display !== "model" &&
                stations?.length && (
                  <g className="member-axes diagram-ends">
                    {(
                      [
                        ["i", stations[0]],
                        ["j", stations.at(-1)!],
                      ] as const
                    ).map(([end, station]) => {
                      const value = station[display];
                      const [x, y] = forcePoint(station.t, value);
                      const { symbol, unit } = getForceLabel(display, units);
                      const formatted = formatResultQuantity(
                        value,
                        forceQuantity(display),
                        units,
                      );
                      const towardSpan = end === "i" ? 1 : -1;
                      const dx = (towardSpan * du) / length;
                      const dy = (-towardSpan * dv) / length;
                      const gap = Math.min(12, length * camera.scale * 0.12);
                      return (
                        <g
                          key={end}
                          role="img"
                          aria-label={`${m.name}, ${end}, ${symbol} ${formatted} ${unit}`}
                        >
                          <circle cx={x} cy={y} r={3} />
                          <text
                            x={x + dx * gap}
                            y={y + 13 + dy * gap}
                            style={{
                              textAnchor:
                                dx > 0.3
                                  ? "start"
                                  : dx < -0.3
                                    ? "end"
                                    : "middle",
                            }}
                          >
                            {end} · {formatted} {unit}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}
            </g>
          );
        })}
        <SelectionWindow
          target={ref}
          enabled={activeTool === "select" && !quick}
          plane={plane}
          projectId={project.id}
          onApply={(a, b, additive) => {
            const projectPoint = (pixel: { x: number; y: number }) => ({
              u: (pixel.x - sx(0)) / camera.scale,
              v: (sy(0) - pixel.y) / camera.scale,
            });
            onWindow(
              objectsInWindow(project, plane, projectPoint(a), projectPoint(b)),
              additive,
            );
          }}
        />
        {floors.map((floor) => {
          const x = sx(floor.reference.x),
            y = sy(floor.reference.y);
          return (
            <g
              key={floor.id}
              className="diaphragm-links"
              role="img"
              aria-label={`Diafragma ${floor.name}`}
              pointerEvents="none"
            >
              {floor.nodeIds.map((id) => {
                const node = nodeMap.get(id)!;
                return (
                  <line
                    key={id}
                    x1={x}
                    y1={y}
                    x2={sx(node.x)}
                    y2={sy(node.y)}
                  />
                );
              })}
              <path d={`M ${x} ${y - 9} l 9 9 -9 9 -9 -9 Z`} />
              {labels && (
                <text x={x + 11} y={y + 16}>
                  {floor.name} · ref.
                </text>
              )}
            </g>
          );
        })}
        {wind
          .filter((w) => {
            const positions = w.corners.map((p) => p[normal]);
            return (
              plane.offset >= Math.min(...positions) - tolerance &&
              plane.offset <= Math.max(...positions) + tolerance
            );
          })
          .map((w) => (
            <g key={w.id} pointerEvents="none">
              <polygon
                points={w.corners
                  .map((p) => `${sx(p[axisU])},${sy(p[axisV])}`)
                  .join(" ")}
                stroke="var(--geometry-load)"
                fill="var(--geometry-load)"
                fillOpacity={0.1}
                pointerEvents="none"
              >
                <title>
                  Faixa de vento · {w.area.toLocaleString("pt-BR")} m²
                </title>
              </polygon>
              {labels && (
                <text
                  className="node-label"
                  x={sx(w.center[axisU]) + 6}
                  y={sy(w.center[axisV]) - 6}
                >
                  {w.name} · {w.area.toLocaleString("pt-BR")} m²
                </text>
              )}
            </g>
          ))}
        {nodes.map((n) => {
          const active = selected.has(`node:${n.id}`);
          const x = sx(n[axisU]),
            y = sy(n[axisV]);
          const r = n.restraints;
          const hasSupport = Object.values(r).some(Boolean);
          const fixed = spatial ? Object.values(r).every(Boolean) : r.ry;
          const loads = nodalActions.filter((l) => l.nodeId === n.id);
          const force = (k: Coordinate) =>
            loads.reduce((sum, l) => sum + l[`f${k}`], 0);
          const fu = force(axisU),
            fv = force(axisV),
            fn = force(normal);
          const norm = Math.hypot(fu, fv);
          const moments = coordinates.flatMap((k) => {
            const m = loads.reduce((sum, l) => sum + l[`m${k}`], 0);
            return m
              ? [`M${k.toUpperCase()} ${formatQuantity(m, "moment", units)}`]
              : [];
          });
          return (
            <g
              key={n.id}
              className="node"
              onClick={(e) => {
                if (tool !== "select") return;
                e.stopPropagation();
                onSelect({ kind: "node", id: n.id }, additiveSelection(e));
              }}
            >
              {hasSupport && n.supportFrame && (
                <InclinedSupport2D
                  node={n}
                  x={x}
                  y={y}
                  u={axisU}
                  v={axisV}
                  showLabel={labels || active}
                />
              )}
              {!n.supportFrame && fixed && (
                <path
                  d={`M${x - 11} ${y + 7}h22m-20 0l-4 6m12-6l-4 6m12-6l-4 6`}
                  stroke="var(--geometry-support)"
                  fill="none"
                />
              )}
              {!n.supportFrame && !fixed && hasSupport && (
                <g
                  stroke="var(--geometry-support)"
                  fill="var(--geometry-node-fill)"
                >
                  <path d={`M${x} ${y + 4}l-9 14h18z`} />
                  {!r[dofU] && <path d={`M${x - 11} ${y + 22}h22`} />}
                </g>
              )}
              <circle cx={x} cy={y} r="12" fill="transparent" />
              <circle
                cx={x}
                cy={y}
                r={active ? 5.5 : 3.5}
                fill={
                  active
                    ? "var(--geometry-selected)"
                    : "var(--geometry-node-fill)"
                }
                stroke={
                  active ? "var(--geometry-selected)" : "var(--geometry-node)"
                }
                strokeWidth="1.8"
              />
              {labels && (
                <text x={x + 10} y={y - 12} className="node-label">
                  {n.name}
                </text>
              )}
              {layers.loads &&
                display === "model" &&
                (norm > 0 || fn !== 0) && (
                  <g className="load-shape">
                    {norm > 0 &&
                      arrow(x, y, (fu / norm) * 50, (-fv / norm) * 50, "nodal")}
                    <text x={x + 12} y={y - (norm > 0 ? 52 : 28)}>
                      {coordinates
                        .flatMap((k) =>
                          force(k)
                            ? [
                                `F${k.toUpperCase()} ${formatQuantity(force(k), "force", units)}`,
                              ]
                            : [],
                        )
                        .join(" · ")}{" "}
                      {units.force}
                    </text>
                  </g>
                )}
              {layers.loads && display === "model" && moments.length > 0 && (
                <text x={x + 16} y={y + 35} className="moment-label">
                  {moments.join(" · ")} {units.moment}
                </text>
              )}
            </g>
          );
        })}
        {activeCandidate &&
          tool !== "select" &&
          (() => {
            const cx = sx(activeCandidate.u);
            const cy = sy(activeCandidate.v);
            const tagText =
              activeCandidate.distance !== null
                ? `${activeCandidate.label} · ${displayLength(activeCandidate.distance)} ${units.length}`
                : activeCandidate.label;
            const tagWidth = Math.max(88, tagText.length * 6.2 + 16);
            const tagX = Math.min(
              size.width - tagWidth - 8,
              Math.max(8, cx + 10),
            );
            const tagY = Math.max(26, cy - 10);
            const markerColor =
              activeCandidate.kind === "midpoint" ||
              activeCandidate.kind === "perpendicular"
                ? "var(--geometry-support)"
                : "var(--geometry-selected)";
            return (
              <g
                className="snap-indicator"
                data-snap-kind={activeCandidate.kind}
                data-snap-u={activeCandidate.u}
                data-snap-v={activeCandidate.v}
                pointerEvents="none"
              >
                {activeCandidate.kind === "perpendicular" && snapAnchor && (
                  <line
                    x1={sx(snapAnchor[axisU])}
                    y1={sy(snapAnchor[axisV])}
                    x2={cx}
                    y2={cy}
                    stroke="var(--geometry-support)"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                  />
                )}
                <path d={`M${cx - 8} ${cy}h16m-8-8v16`} stroke={markerColor} />
                {activeCandidate.kind === "midpoint" ? (
                  <polygon
                    points={`${cx},${cy - 7} ${cx + 6},${cy + 5} ${cx - 6},${cy + 5}`}
                    stroke={markerColor}
                    strokeWidth="1.6"
                    fill="var(--geometry-node-fill)"
                  />
                ) : activeCandidate.kind === "perpendicular" ? (
                  <g stroke={markerColor} strokeWidth="1.6" fill="none">
                    <path d={`M${cx - 6} ${cy}h12M${cx} ${cy - 8}v8`} />
                    <path d={`M${cx} ${cy - 5}h5v5`} />
                  </g>
                ) : activeCandidate.kind === "relative" ? (
                  <polygon
                    points={`${cx},${cy - 6} ${cx + 6},${cy} ${cx},${cy + 6} ${cx - 6},${cy}`}
                    stroke={markerColor}
                    strokeWidth="1.6"
                    fill="none"
                  />
                ) : (
                  <rect
                    x={cx - 4}
                    y={cy - 4}
                    width="8"
                    height="8"
                    stroke={markerColor}
                    fill="none"
                  />
                )}
                <g className="snap-tag">
                  <rect
                    x={tagX}
                    y={tagY - 14}
                    width={tagWidth}
                    height="18"
                    rx="3"
                  />
                  <text x={tagX + 7} y={tagY - 2}>
                    {tagText}
                  </text>
                </g>
              </g>
            );
          })()}
        {tracing && outline.length > 0 && (
          <g className="slab-trace" pointerEvents="none">
            <polyline
              fill="none"
              stroke="var(--geometry-selected)"
              strokeWidth="2"
              points={outline.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
            />
            {activeCandidate && (
              <line
                x1={sx(outline.at(-1)!.x)}
                y1={sy(outline.at(-1)!.y)}
                x2={sx(activeCandidate.u)}
                y2={sy(activeCandidate.v)}
                stroke="var(--geometry-selected)"
                strokeDasharray="6 4"
              />
            )}
            {outline.map((p, i) => (
              <circle
                key={i}
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={i === 0 ? 5 : 3}
                fill="var(--geometry-node-fill)"
                stroke="var(--geometry-selected)"
              />
            ))}
          </g>
        )}
        {pending &&
          (tool === "slab"
            ? cursor && (
                <rect
                  x={Math.min(sx(pending.x), sx(cursor.u))}
                  y={Math.min(sy(pending.y), sy(cursor.v))}
                  width={Math.abs(sx(pending.x) - sx(cursor.u))}
                  height={Math.abs(sy(pending.y) - sy(cursor.v))}
                  fill="var(--geometry-selected)"
                  fillOpacity={0.16}
                  stroke="var(--geometry-selected)"
                  strokeDasharray="6 4"
                  pointerEvents="none"
                />
              )
            : activeCandidate && (
                <line
                  x1={sx(pending[axisU])}
                  y1={sy(pending[axisV])}
                  x2={sx(activeCandidate.u)}
                  y2={sy(activeCandidate.v)}
                  stroke="var(--geometry-selected)"
                  strokeDasharray="6 4"
                  pointerEvents="none"
                />
              ))}
        {slabs.length === 2 && (
          <SlabJointPlan
            project={project}
            sx={sx}
            sy={sy}
            select={tool === "select" ? onJoint : undefined}
          />
        )}
      </svg>
      {!project.nodes.length &&
        !project.slabs.length &&
        !project.surfacePanels?.length &&
        tool !== "slab" &&
        !tracing && (
          <div className="empty-canvas">
            <h2>Lance a primeira barra</h2>
            <p>
              Ative <b>Barra</b> e marque duas extremidades na malha.
            </p>
            <div>
              <kbd>B</kbd> desenhar barra <kbd>Esc</kbd> selecionar
            </div>
          </div>
        )}
      {(tool === "member" || tool === "node" || tracing) && (
        <form
          className="relative-input-bar"
          aria-label="Coordenadas relativas no plano"
          onSubmit={handleRelativeSubmit}
        >
          <span className="relative-origin">
            Origem ({displayLength(relativeAnchor[axisU])};{" "}
            {displayLength(relativeAnchor[axisV])}) {units.length}
          </span>
          <label>
            <span>
              Δ{axisU.toUpperCase()} ({units.length})
            </span>
            <input
              aria-label={`Δ${axisU.toUpperCase()} (${units.length})`}
              aria-invalid={relativeInvalid.u}
              inputMode="decimal"
              placeholder="0,00"
              value={deltaU}
              onChange={(e) => {
                setDeltaU(e.target.value);
                setRelativeError("");
                setRelativeInvalid((prev) => ({ ...prev, u: false }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopPropagation();
                  cancelRelative(e.currentTarget);
                }
              }}
            />
          </label>
          <label>
            <span>
              Δ{axisV.toUpperCase()} ({units.length})
            </span>
            <input
              aria-label={`Δ${axisV.toUpperCase()} (${units.length})`}
              aria-invalid={relativeInvalid.v}
              inputMode="decimal"
              placeholder="0,00"
              value={deltaV}
              onChange={(e) => {
                setDeltaV(e.target.value);
                setRelativeError("");
                setRelativeInvalid((prev) => ({ ...prev, v: false }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopPropagation();
                  cancelRelative(e.currentTarget);
                }
              }}
            />
          </label>
          <button type="submit">Confirmar</button>
          <button type="button" onClick={() => cancelRelative()}>
            Cancelar
          </button>
          {relativeError && (
            <span role="alert" className="relative-error">
              {relativeError}
            </span>
          )}
        </form>
      )}
      <div className="view-foot">
        <span>
          {normal.toUpperCase()} ={" "}
          {formatQuantity(plane.offset, "length", units)} {units.length}{" "}
          <b>·</b> Snap {formatQuantity(0.5, "length", units)} {units.length}
        </span>
        <span>
          {activeCandidate && tool !== "select"
            ? `${activeCandidate.label} · ${axisU.toUpperCase()} ${displayLength(activeCandidate.u)} · ${axisV.toUpperCase()} ${displayLength(activeCandidate.v)} ${units.length}${
                activeCandidate.distance !== null
                  ? ` · Dist. ${displayLength(activeCandidate.distance)} ${units.length}`
                  : ""
              }`
            : cursor && !quick
              ? `${axisU.toUpperCase()} ${fromSI(cursor.u, "length", units).toFixed(2)} · ${axisV.toUpperCase()} ${fromSI(cursor.v, "length", units).toFixed(2)} ${units.length}`
              : display === "deformed"
                ? `Deformada ×${deformationScale.toFixed(1)}`
                : `${axisV.toUpperCase()} ↑  ${axisU.toUpperCase()} →`}
        </span>
      </div>
    </section>
  );
}
