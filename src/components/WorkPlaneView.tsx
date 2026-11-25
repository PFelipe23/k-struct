import {
  useCallback,
  useEffect,
  useMemo,
  useId,
  type RefObject,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import {
  coordinates,
  onPlane,
  planeCoordinates,
  planePoint,
  tolerance,
  type Coordinate,
  type Point3,
  type WorkPlane,
} from "../domain/geometry";
import type { Project, SelectedObject, Selection } from "../domain/model";
import type { MemberForceComponent } from "../solver/combinations";
import type {
  EnvelopeSection,
  MemberEnvelopeResult,
} from "../solver/envelopes";
import type { StructuralResult } from "../solver/oofem";
import { pickGuideSpan } from "../domain/guideSpan";
import { beamStations, nearestSection } from "../domain/beamMesh";
import { ViewLayers, type LayerControls } from "./ViewLayers";
import SelectionWindow from "./SelectionWindow";
import { objectsInWindow } from "../domain/selection";
import SlabPlan from "./SlabPlan";
import type { SlabMap } from "./SlabResults";
import { formatQuantity, fromSI } from "../units";
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

export type Tool = "select" | "node" | "member" | "slab";
export type Display = "model" | "deformed" | MemberForceComponent;
type UV = { u: number; v: number };
interface Props {
  project: Project;
  showMemberAxes: boolean;
  plane: WorkPlane;
  orthogonal: boolean;
  selection: SelectedObject[];
  tool: Tool;
  quick: boolean;
  onWindow: (objects: SelectedObject[], additive: boolean) => void;
  onSpan: (from: Point3, to: Point3) => void;
  result: StructuralResult | null;
  envelope: {
    result: MemberEnvelopeResult;
    section: EnvelopeSection;
    onSection: (section: EnvelopeSection) => void;
  } | null;
  display: Display;
  slabMap: SlabMap | null;
  patternId: string;
  active: boolean;
  savedCamera: RefObject<PlaneCamera | null>;
  onActivate: () => void;
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
  showMemberAxes,
  plane,
  orthogonal,
  selection,
  tool: activeTool,
  quick,
  onWindow,
  onSpan,
  result,
  envelope,
  display,
  slabMap,
  patternId,
  pending,
  onPoint,
  onSelect,
}: Props & LayerControls) {
  const { units } = useUnits();
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 700, height: 460 });
  const [camera, setCamera] = useState({ u: 3, v: 1.5, scale: 65 });
  const [cursor, setCursor] = useState<UV | null>(null);
  const pan = useRef<{ x: number; y: number; u: number; v: number } | null>(
    null,
  );
  const [spanPointer, setSpanPointer] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // The span picker handles its own hits and does not request point placement.
  const tool = quick ? "select" : activeTool;
  useEffect(() => {
    setSpanPointer(null);
    if (quick) setCursor(null);
  }, [quick, plane.kind, plane.offset, project.id]);
  const { labels } = layers;
  const mesh = useMemo(
    () => (layers.mesh ? beamStations(project) : null),
    [layers.mesh, project],
  );
  const markerId = useId();
  const spatial = project.mode === "spatial";
  const [axisU, axisV, normal] = planeCoordinates[plane.kind];
  const uGuides = spatial || quick ? project.guides[axisU] : [];
  const vGuides = spatial || quick ? project.guides[axisV] : [];
  const nodes = project.nodes.filter((n) => onPlane(n, plane));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const bars = project.members.filter(
    (m) => nodeMap.has(m.start) && nodeMap.has(m.end),
  );
  const selected = new Set(selection.map((s) => `${s.kind}:${s.id}`));
  const hasMemberSelection = selection.some((item) => item.kind === "member");
  const patterns = project.loadPatterns.find((p) => p.id === patternId)!;
  const slab =
    plane.kind === "XY"
      ? project.slabs.find((item) =>
          project.guides.z.some(
            (level) =>
              level.id === item.levelId && level.position === plane.offset,
          ),
        )
      : undefined;
  const slabId = slab?.id;
  const selectSlab = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      if (tool !== "select" || !slabId) return;
      event.stopPropagation();
      onSelect({ kind: "slab", id: slabId }, additiveSelection(event));
    },
    [tool, slabId, onSelect],
  );

  useEffect(() => {
    const resize = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    if (ref.current) resize.observe(ref.current);
    return () => resize.disconnect();
  }, []);

  const cameraBeforeFit = useRef(camera);
  const fit = () => {
    const us = [
      ...project.nodes.map((n) => n[axisU]),
      ...uGuides.map((g) => g.position),
      ...(slab ? [slab.x, slab.x + slab.lengthX] : []),
    ];
    const vs = [
      ...project.nodes.map((n) => n[axisV]),
      ...vGuides.map((g) => g.position),
      ...(slab ? [slab.y, slab.y + slab.lengthY] : []),
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
  useEffect(() => {
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
  useEffect(() => setCursor(null), [plane.offset]);

  const sx = useCallback(
    (u: number) => size.width / 2 + (u - camera.u) * camera.scale,
    [size.width, camera],
  );
  const sy = useCallback(
    (v: number) => size.height / 2 - (v - camera.v) * camera.scale,
    [size.height, camera],
  );
  const point = (event: {
    clientX: number;
    clientY: number;
    shiftKey: boolean;
  }) => {
    const rect = ref.current!.getBoundingClientRect();
    const u =
      (event.clientX - rect.left - size.width / 2) / camera.scale + camera.u;
    const v =
      -(event.clientY - rect.top - size.height / 2) / camera.scale + camera.v;
    const aligned =
      pending &&
      tool === "member" &&
      spatial &&
      orthogonal !== event.shiftKey &&
      onPlane(pending, plane);
    const horizontal =
      aligned && Math.abs(u - pending[axisU]) >= Math.abs(v - pending[axisV]);
    const lockU = aligned && !horizontal ? pending[axisU] : null;
    const lockV = horizontal ? pending[axisV] : null;
    const nearest = nodes.reduce<{
      node: (typeof nodes)[number];
      error: number;
    } | null>((best, n) => {
      if (lockU !== null && Math.abs(n[axisU] - lockU) >= tolerance)
        return best;
      if (lockV !== null && Math.abs(n[axisV] - lockV) >= tolerance)
        return best;
      const error = Math.hypot(n[axisU] - u, n[axisV] - v) * camera.scale;
      return error < (best?.error ?? 12) ? { node: n, error } : best;
    }, null);
    if (nearest) return { u: nearest.node[axisU], v: nearest.node[axisV] };
    const snap = (value: number, guides: typeof uGuides) => {
      const closest = guides.reduce(
        (best, g) =>
          Math.abs(g.position - value) < Math.abs(best - value)
            ? g.position
            : best,
        Infinity,
      );
      return Math.abs(closest - value) * camera.scale < 10
        ? closest
        : Math.round(value * 2) / 2;
    };
    return { u: lockU ?? snap(u, uGuides), v: lockV ?? snap(v, vGuides) };
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
  const envelopeResult = envelope?.result;
  const maxForce = useMemo(() => {
    let magnitude = 1;
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
  }, [component, envelopeResult, result]);
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
        className={`drawing drawing-${quick ? "span" : tool}`}
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
          } else setCursor(point(e));
        }}
        onPointerLeave={() => setCursor(null)}
        onClick={(e) => {
          if (tool === "select") onSelect(null, additiveSelection(e));
          else {
            const { u, v } = point(e);
            onPoint(planePoint(u, v, plane));
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
        {slab && (
          <SlabPlan
            slab={slab}
            z={plane.offset}
            sx={sx}
            sy={sy}
            active={selected.has(`slab:${slab.id}`)}
            labels={labels}
            map={slabMap}
            pressure={
              layers.loads
                ? (patterns.pressure.find(({ slabId }) => slabId === slab.id)
                    ?.pz ?? 0)
                : 0
            }
            onClick={selectSlab}
          />
        )}
        {bars.map((m) => {
          const a = nodeMap.get(m.start)!,
            b = nodeMap.get(m.end)!;
          const u = a[axisU],
            v = a[axisV],
            du = b[axisU] - u,
            dv = b[axisV] - v;
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
          const band =
            envelopeStations && component && length >= tolerance
              ? {
                  max: envelopeStations.map((s) =>
                    forcePoint(s.t, s.ranges[component].max.forces[component]),
                  ),
                  min: envelopeStations.map((s) =>
                    forcePoint(s.t, s.ranges[component].min.forces[component]),
                  ),
                }
              : null;
          const sectionAt = (event: { clientX: number; clientY: number }) => {
            if (!band || !envelope || !envelopeStations) return;
            const bounds = ref.current!.getBoundingClientRect();
            const x = (event.clientX - bounds.left - sx(u)) / camera.scale;
            const y = (sy(v) - (event.clientY - bounds.top)) / camera.scale;
            const t = Math.min(1, Math.max(0, (x * du + y * dv) / length ** 2));
            let index = nearestSection(envelopeStations, t);
            const station = envelopeStations[index];
            // On a jump both traces have the same abscissa. Pick the closer force ordinate.
            if (
              station.side &&
              Math.abs(t - station.t) * length * camera.scale <= 2
            ) {
              const other = index + (station.side === "left" ? 1 : -1);
              const toPointer = ([px, py]: readonly [number, number]) =>
                Math.hypot(
                  px + bounds.left - event.clientX,
                  py + bounds.top - event.clientY,
                );
              const toCurve = (i: number) =>
                Math.min(toPointer(band.min[i]), toPointer(band.max[i]));
              if (toCurve(other) < toCurve(index)) index = other;
            }
            envelope.onSection({ memberId: m.id, index });
          };
          let diagram: string | undefined;
          if (stations && display !== "model" && length >= tolerance) {
            diagram = stations
              .map((s) => {
                if (display === "deformed")
                  return `${sx(u + du * s.t + s[dofU] * deformationScale)},${sy(v + dv * s.t + s[dofV] * deformationScale)}`;
                return forcePoint(s.t, s[display]).join(",");
              })
              .join(" ");
          }
          return (
            <g key={m.id}>
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
                  if (band && !additiveSelection(e)) sectionAt(e);
                  else
                    onSelect(
                      { kind: "member", id: m.id },
                      additiveSelection(e),
                    );
                }}
              />
              {mesh
                ?.get(m.id)
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
                          sx(u + (du * i) / 8),
                          sy(v + (dv * i) / 8),
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
                    pointerEvents="none"
                  />
                ))}
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
                    const selectedPoint =
                      envelope?.section.memberId === m.id
                        ? points[envelope.section.index]
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
                    a={a}
                    b={b}
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
        {nodes.map((n) => {
          const active = selected.has(`node:${n.id}`);
          const x = sx(n[axisU]),
            y = sy(n[axisV]);
          const r = n.restraints;
          const hasSupport = Object.values(r).some(Boolean);
          const fixed = spatial ? Object.values(r).every(Boolean) : r.ry;
          const loads = patterns.nodal.filter((l) => l.nodeId === n.id);
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
        {cursor && tool !== "select" && (
          <g pointerEvents="none">
            <path
              d={`M${sx(cursor.u) - 8} ${sy(cursor.v)}h16m-8-8v16`}
              stroke="var(--geometry-selected)"
            />
            <rect
              x={sx(cursor.u) - 4}
              y={sy(cursor.v) - 4}
              width="8"
              height="8"
              stroke="var(--geometry-selected)"
              fill="none"
            />
          </g>
        )}
        {pending &&
          cursor &&
          (tool === "slab" ? (
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
          ) : (
            <line
              x1={sx(pending[axisU])}
              y1={sy(pending[axisV])}
              x2={sx(cursor.u)}
              y2={sy(cursor.v)}
              stroke="var(--geometry-selected)"
              strokeDasharray="6 4"
              pointerEvents="none"
            />
          ))}
      </svg>
      {!project.nodes.length && !project.slabs.length && tool !== "slab" && (
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
      <div className="view-foot">
        <span>
          {normal.toUpperCase()} ={" "}
          {formatQuantity(plane.offset, "length", units)} {units.length}{" "}
          <b>·</b> Snap {formatQuantity(0.5, "length", units)} {units.length}
        </span>
        <span>
          {cursor
            ? `${axisU.toUpperCase()} ${fromSI(cursor.u, "length", units).toFixed(2)} · ${axisV.toUpperCase()} ${fromSI(cursor.v, "length", units).toFixed(2)} ${units.length}`
            : display === "deformed"
              ? `Deformada ×${deformationScale.toFixed(1)}`
              : `${axisV.toUpperCase()} ↑  ${axisU.toUpperCase()} →`}
        </span>
      </div>
    </section>
  );
}
