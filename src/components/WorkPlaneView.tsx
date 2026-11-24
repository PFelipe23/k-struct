import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import {
  coordinates,
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
import type {
  EnvelopeSection,
  MemberEnvelopeResult,
} from "../solver/envelopes";
import type { StructuralResult } from "../solver/oofem";
import SlabPlan from "./SlabPlan";
import type { SlabMap } from "./SlabResults";

export type Tool = "select" | "node" | "member" | "slab";
export type Display = "model" | "deformed" | MemberForceComponent;
interface Props {
  project: Project;
  plane: WorkPlane;
  orthogonal: boolean;
  selection: SelectedObject[];
  tool: Tool;
  result: StructuralResult | null;
  envelope: {
    result: MemberEnvelopeResult;
    section: EnvelopeSection;
    onSection: (section: EnvelopeSection) => void;
  } | null;
  display: Display;
  slabMap: SlabMap | null;
  patternId: string;
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
  project,
  plane,
  orthogonal,
  selection,
  tool,
  result,
  envelope,
  display,
  slabMap,
  patternId,
  pending,
  onPoint,
  onSelect,
}: Props) {
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
  const [labels, setLabels] = useState(true);
  const spatial = project.mode === "spatial";
  const [axisU, axisV, normal] = planeCoordinates[plane.kind];
  const uGuides = spatial ? project.guides[axisU] : [];
  const vGuides = spatial ? project.guides[axisV] : [];
  const nodes = project.nodes.filter((n) => onPlane(n, plane));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const bars = project.members.filter(
    (m) => nodeMap.has(m.start) && nodeMap.has(m.end),
  );
  const selected = new Set(selection.map((s) => `${s.kind}:${s.id}`));
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
    setCamera({
      u: (minU + maxU) / 2,
      v: (minV + maxV) / 2,
      scale: Math.max(
        10,
        Math.min(
          (size.width - 105) / Math.max(6, maxU - minU),
          (size.height - 120) / Math.max(3, maxV - minV),
          100,
        ),
      ),
    });
  };
  useEffect(() => {
    fit();
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

  const snapAnchor =
    tool === "member" && pending && onPlane(pending, plane)
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
    return resolveWorkPlaneSnap({
      rawU,
      rawV,
      scale: camera.scale,
      plane,
      spatial,
      orthogonal,
      shiftKey: event.shiftKey,
      tool,
      anchor: snapAnchor,
      nodes: project.nodes,
      members: project.members,
      uGuides,
      vGuides,
    });
  };

  const parsedDeltaU = parseDecimalInput(deltaU);
  const parsedDeltaV = parseDecimalInput(deltaV);
  const hasRelativeBoth =
    Number.isFinite(parsedDeltaU) && Number.isFinite(parsedDeltaV);
  const relativeDistance = hasRelativeBoth
    ? Math.hypot(parsedDeltaU, parsedDeltaV)
    : NaN;
  const relativePreview: SnapCandidate | null =
    (tool === "member" || tool === "node") &&
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
        `Informe Δ${axisU.toUpperCase()} e Δ${axisV.toUpperCase()} numéricos em metros.`,
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
    const target = relativePointOnPlane(
      relativeAnchor,
      parsedDeltaU,
      parsedDeltaV,
      plane,
    );
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
  const arrow = (x: number, y: number, dx: number, dy: number, key: string) => (
    <line
      key={key}
      x1={x - dx}
      y1={y - dy}
      x2={x}
      y2={y}
      stroke="var(--geometry-load)"
      strokeWidth="1.4"
      markerEnd="url(#load-arrow)"
    />
  );
  const heading = plane.kind === "XY" ? "Planta XY" : `Elevação ${plane.kind}`;

  return (
    <section className="viewport elevation">
      <div className="view-heading">
        <span>
          <i className="view-dot" />
          {heading}
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
          <button
            className={labels ? "selected" : ""}
            title="Nomes dos objetos"
            onClick={() => setLabels((v) => !v)}
          >
            ID
          </button>
        </div>
      </div>
      <svg
        ref={ref}
        className={`drawing drawing-${tool}`}
        aria-label={`Área de lançamento ${plane.kind}`}
        role="application"
        tabIndex={0}
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
            const snapped = resolveCursor(e);
            setCursor(snapped);
            if (tool === "node") setLastNodeAnchor(snapped.point);
            onPoint(snapped.point);
          }
        }}
      >
        <defs>
          <marker
            id="load-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0 0 L7 3.5 L0 7" fill="var(--geometry-load)" />
          </marker>
        </defs>
        <g className="grid">
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
                {Number(u.toFixed(2))}
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
                {Number(v.toFixed(2))}
              </text>
            </g>
          ))}
        </g>
        <g className="work-guides" aria-hidden="true">
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
              patterns.pressure.find(({ slabId }) => slabId === slab.id)?.pz ??
              0
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
            envelope.onSection({
              memberId: m.id,
              index: Math.round(t * (envelopeStations.length - 1)),
            });
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
              {labels && (
                <text
                  className="member-label"
                  x={sx(u + du / 2) + 8}
                  y={sy(v + dv / 2) + 19}
                >
                  {m.name}
                </text>
              )}
              {display === "model" && components.some(Boolean) && (
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
                          ? [`q${coordinates[i].toUpperCase()} ${q / 1000}`]
                          : [],
                      )
                      .join(" · ")}{" "}
                    kN/m
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
            </g>
          );
        })}
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
            return m ? [`M${k.toUpperCase()} ${m / 1000}`] : [];
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
              {fixed && (
                <path
                  d={`M${x - 11} ${y + 7}h22m-20 0l-4 6m12-6l-4 6m12-6l-4 6`}
                  stroke="var(--geometry-support)"
                  fill="none"
                />
              )}
              {!fixed && hasSupport && (
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
              {display === "model" && (norm > 0 || fn !== 0) && (
                <g className="load-shape">
                  {norm > 0 &&
                    arrow(x, y, (fu / norm) * 50, (-fv / norm) * 50, "nodal")}
                  <text x={x + 12} y={y - (norm > 0 ? 52 : 28)}>
                    {coordinates
                      .flatMap((k) =>
                        force(k)
                          ? [`F${k.toUpperCase()} ${force(k) / 1000}`]
                          : [],
                      )
                      .join(" · ")}{" "}
                    kN
                  </text>
                </g>
              )}
              {display === "model" && moments.length > 0 && (
                <text x={x + 16} y={y + 35} className="moment-label">
                  {moments.join(" · ")} kN·m
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
                ? `${activeCandidate.label} · ${activeCandidate.distance.toFixed(2).replace(".", ",")} m`
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
      {(tool === "member" || tool === "node") && (
        <form
          className="relative-input-bar"
          aria-label="Coordenadas relativas no plano"
          onSubmit={handleRelativeSubmit}
        >
          <span className="relative-origin">
            Origem ({relativeAnchor[axisU].toFixed(2).replace(".", ",")};{" "}
            {relativeAnchor[axisV].toFixed(2).replace(".", ",")}) m
          </span>
          <label>
            <span>Δ{axisU.toUpperCase()} (m)</span>
            <input
              aria-label={`Δ${axisU.toUpperCase()} (m)`}
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
            <span>Δ{axisV.toUpperCase()} (m)</span>
            <input
              aria-label={`Δ${axisV.toUpperCase()} (m)`}
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
          {normal.toUpperCase()} = {plane.offset} m <b>·</b> Snap 0,50 m
        </span>
        <span>
          {activeCandidate && tool !== "select"
            ? `${activeCandidate.label} · ${axisU.toUpperCase()} ${activeCandidate.u.toFixed(2).replace(".", ",")} · ${axisV.toUpperCase()} ${activeCandidate.v.toFixed(2).replace(".", ",")} m${
                activeCandidate.distance !== null
                  ? ` · Dist. ${activeCandidate.distance.toFixed(2).replace(".", ",")} m`
                  : ""
              }`
            : display === "deformed"
              ? `Deformada ×${deformationScale.toFixed(1)}`
              : `${axisV.toUpperCase()} ↑  ${axisU.toUpperCase()} →`}
        </span>
      </div>
    </section>
  );
}
