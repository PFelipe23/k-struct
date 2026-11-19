import { useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Project, Selection } from "../domain/model";
import type { AnalysisResult } from "../solver/oofem";

export type Tool = "select" | "node" | "member";
export type Display = "model" | "deformed" | "m" | "v" | "n";
interface Props {
  project: Project;
  selection: Selection;
  tool: Tool;
  result: AnalysisResult | null;
  display: Display;
  patternId: string;
  pending: { x: number; z: number } | null;
  onPoint: (x: number, z: number) => void;
  onSelect: (s: Selection) => void;
}
export default function Elevation({
  project,
  selection,
  tool,
  result,
  display,
  patternId,
  pending,
  onPoint,
  onSelect,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 700, height: 460 });
  const [camera, setCamera] = useState({ x: 3, z: 1.5, scale: 65 });
  const [cursor, setCursor] = useState<{ x: number; z: number } | null>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cz: number } | null>(
    null,
  );
  const [labels, setLabels] = useState(true);
  useEffect(() => {
    const resize = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: r.width, height: r.height });
    });
    if (ref.current) resize.observe(ref.current);
    return () => resize.disconnect();
  }, []);
  const fit = () => {
    const xs = project.nodes.map((n) => n.x),
      zs = project.nodes.map((n) => n.z);
    const minX = Math.min(0, ...xs),
      maxX = Math.max(6, ...xs),
      minZ = Math.min(0, ...zs),
      maxZ = Math.max(0, ...zs);
    setCamera({
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
      scale: Math.min(
        (size.width - 120) / Math.max(6, maxX - minX),
        (size.height - 160) / Math.max(3, maxZ - minZ),
        100,
      ),
    });
  };
  // Fitting on project replacement preserves the current camera during ordinary editing.
  useEffect(() => {
    fit();
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const sx = (x: number) => size.width / 2 + (x - camera.x) * camera.scale;
  const sy = (z: number) => size.height / 2 - (z - camera.z) * camera.scale;
  const point = (clientX: number, clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = (clientX - rect.left - size.width / 2) / camera.scale + camera.x;
    const z = -(clientY - rect.top - size.height / 2) / camera.scale + camera.z;
    const closest = project.nodes.find(
      (n) => Math.hypot(n.x - x, n.z - z) * camera.scale < 12,
    );
    return closest
      ? { x: closest.x, z: closest.z }
      : { x: Math.round(x * 2) / 2, z: Math.round(z * 2) / 2 };
  };
  const pat = project.loadPatterns.find((p) => p.id === patternId)!;
  const allStations = result ? Object.values(result.members).flat() : [];
  const maxU = Math.max(
    1e-12,
    ...allStations.map((s) => Math.hypot(s.ux, s.uz)),
  );
  const deformationScale = 60 / (maxU * camera.scale);
  const maxForce =
    display === "m" || display === "v" || display === "n"
      ? Math.max(1, ...allStations.map((s) => Math.abs(s[display])))
      : 1;
  const gridStep = camera.scale < 25 ? 2 : camera.scale > 120 ? 0.5 : 1;
  const x0 =
    Math.floor((camera.x - size.width / 2 / camera.scale) / gridStep) *
    gridStep;
  const z0 =
    Math.floor((camera.z - size.height / 2 / camera.scale) / gridStep) *
    gridStep;
  const xs = Array.from(
    { length: Math.ceil(size.width / camera.scale / gridStep) + 2 },
    (_, i) => x0 + i * gridStep,
  );
  const zs = Array.from(
    { length: Math.ceil(size.height / camera.scale / gridStep) + 2 },
    (_, i) => z0 + i * gridStep,
  );
  const arrow = (x: number, y: number, dx: number, dy: number, key: string) => (
    <line
      key={key}
      x1={x - dx}
      y1={y - dy}
      x2={x}
      y2={y}
      stroke="#e7b45c"
      strokeWidth="1.4"
      markerEnd="url(#load-arrow)"
    />
  );
  return (
    <section className="viewport elevation">
      <div className="view-heading">
        <span>
          <i className="view-dot" />
          Elevação XZ <small>LANÇAMENTO</small>
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
        aria-label="Área de lançamento XZ"
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
          if (e.button === 1) {
            e.preventDefault();
            pan.current = {
              x: e.clientX,
              y: e.clientY,
              cx: camera.x,
              cz: camera.z,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerUp={(e) => {
          if (pan.current) {
            pan.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (pan.current) {
            const p = pan.current;
            setCamera((c) => ({
              ...c,
              x: p.cx - (e.clientX - p.x) / c.scale,
              z: p.cz + (e.clientY - p.y) / c.scale,
            }));
          } else setCursor(point(e.clientX, e.clientY));
        }}
        onPointerLeave={() => setCursor(null)}
        onClick={(e) => {
          if (tool !== "select") {
            const p = point(e.clientX, e.clientY);
            onPoint(p.x, p.z);
          } else onSelect(null);
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
            <path d="M0 0 L7 3.5 L0 7" fill="#e7b45c" />
          </marker>
        </defs>
        <g className="grid">
          {xs.map((x) => (
            <g key={`x${x}`}>
              <line
                x1={sx(x)}
                x2={sx(x)}
                y1="0"
                y2={size.height}
                className={x === 0 ? "axis" : ""}
              />
              <text x={sx(x) + 4} y={size.height - 10}>
                {Number(x.toFixed(2))}
              </text>
            </g>
          ))}
          {zs.map((z) => (
            <g key={`z${z}`}>
              <line
                x1="0"
                x2={size.width}
                y1={sy(z)}
                y2={sy(z)}
                className={z === 0 ? "axis" : ""}
              />
              <text x="8" y={sy(z) - 5}>
                {Number(z.toFixed(2))}
              </text>
            </g>
          ))}
        </g>
        {project.members.map((m) => {
          const a = project.nodes.find((n) => n.id === m.start)!,
            b = project.nodes.find((n) => n.id === m.end)!;
          const selected =
            selection?.kind === "member" && selection.id === m.id;
          const loads = pat.uniform.filter((l) => l.memberId === m.id),
            qx = loads.reduce((s, l) => s + l.qx, 0),
            qz = loads.reduce((s, l) => s + l.qz, 0);
          const loadNorm = Math.hypot(qx, qz);
          return (
            <g key={m.id}>
              <line
                x1={sx(a.x)}
                y1={sy(a.z)}
                x2={sx(b.x)}
                y2={sy(b.z)}
                stroke={selected ? "#d2b8ff" : "#8ca8cb"}
                strokeWidth={selected ? 4 : 2.5}
              />
              <line
                x1={sx(a.x)}
                y1={sy(a.z)}
                x2={sx(b.x)}
                y2={sy(b.z)}
                stroke="transparent"
                strokeWidth="16"
                onClick={(e) => {
                  if (tool === "select") {
                    e.stopPropagation();
                    onSelect({ kind: "member", id: m.id });
                  }
                }}
              />
              {labels && (
                <text
                  className="member-label"
                  x={sx((a.x + b.x) / 2) + 8}
                  y={sy((a.z + b.z) / 2) + 19}
                >
                  {m.name}
                </text>
              )}
              {loadNorm > 0 && display === "model" && (
                <g className="load-shape">
                  {Array.from({ length: 9 }, (_, i) => {
                    const t = i / 8;
                    return arrow(
                      sx(a.x + (b.x - a.x) * t),
                      sy(a.z + (b.z - a.z) * t),
                      (qx / loadNorm) * 34,
                      (-qz / loadNorm) * 34,
                      String(i),
                    );
                  })}
                  <text
                    x={sx((a.x + b.x) / 2)}
                    y={sy((a.z + b.z) / 2) - (qz <= 0 ? 45 : -55)}
                    textAnchor="middle"
                  >
                    qX {qx / 1000} · qZ {qz / 1000} kN/m
                  </text>
                </g>
              )}
              {result &&
                display !== "model" &&
                result.members[m.id] &&
                (() => {
                  const length = Math.hypot(b.x - a.x, b.z - a.z),
                    c = (b.x - a.x) / length,
                    s = (b.z - a.z) / length;
                  const points = result.members[m.id]
                    .map((v) => {
                      let x = a.x + (b.x - a.x) * v.t,
                        z = a.z + (b.z - a.z) * v.t;
                      if (display === "deformed") {
                        x += v.ux * deformationScale;
                        z += v.uz * deformationScale;
                      } else {
                        const offset =
                          ((v[display] / maxForce) * 70) / camera.scale;
                        x += s * offset;
                        z -= c * offset;
                      }
                      return `${sx(x)},${sy(z)}`;
                    })
                    .join(" ");
                  return display === "deformed" ? (
                    <polyline
                      points={points}
                      fill="none"
                      stroke="#67d6c0"
                      strokeWidth="2"
                    />
                  ) : (
                    <polygon
                      points={`${sx(a.x)},${sy(a.z)} ${points} ${sx(b.x)},${sy(b.z)}`}
                      fill="#a98ae92b"
                      stroke="#bd9af9"
                      strokeWidth="1.6"
                    />
                  );
                })()}
            </g>
          );
        })}
        {project.nodes.map((n) => {
          const selected = selection?.kind === "node" && selection.id === n.id,
            x = sx(n.x),
            y = sy(n.z);
          const r = n.restraints;
          const loads = pat.nodal.filter((l) => l.nodeId === n.id),
            fx = loads.reduce((s, l) => s + l.fx, 0),
            fz = loads.reduce((s, l) => s + l.fz, 0),
            my = loads.reduce((s, l) => s + l.my, 0);
          return (
            <g
              key={n.id}
              className="node"
              onClick={(e) => {
                if (tool === "select") {
                  e.stopPropagation();
                  onSelect({ kind: "node", id: n.id });
                }
              }}
            >
              {r.ry && (
                <path
                  d={`M${x - 11} ${y + 7}h22m-20 0l-4 6m12-6l-4 6m12-6l-4 6`}
                  stroke="#67c7b1"
                  fill="none"
                />
              )}
              {!r.ry && (r.ux || r.uz) && (
                <g stroke="#67c7b1" fill="#111b27">
                  <path d={`M${x} ${y + 4}l-9 14h18z`} />
                  {!r.ux && <path d={`M${x - 11} ${y + 22}h22`} />}
                </g>
              )}
              <circle cx={x} cy={y} r="12" fill="transparent" />
              <circle
                cx={x}
                cy={y}
                r={selected ? 5.5 : 3.5}
                fill={selected ? "#dbc4ff" : "#101a29"}
                stroke={selected ? "#dbc4ff" : "#a9c0dd"}
                strokeWidth="1.8"
              />
              {labels && (
                <text x={x + 10} y={y - 12} className="node-label">
                  {n.name}
                </text>
              )}
              {display === "model" && (fx !== 0 || fz !== 0) && (
                <g className="load-shape">
                  {arrow(
                    x,
                    y,
                    (fx / Math.hypot(fx, fz)) * 50,
                    (-fz / Math.hypot(fx, fz)) * 50,
                    "nodal",
                  )}
                  <text x={x + 12} y={y - 52}>
                    {fx / 1000} / {fz / 1000} kN
                  </text>
                </g>
              )}
              {display === "model" && my !== 0 && (
                <text x={x + 16} y={y + 35} className="moment-label">
                  ↻ {my / 1000} kN·m (Y)
                </text>
              )}
            </g>
          );
        })}
        {cursor && tool !== "select" && (
          <g pointerEvents="none">
            <path
              d={`M${sx(cursor.x) - 8} ${sy(cursor.z)}h16m-8-8v16`}
              stroke="#e3c7ff"
            />
            <rect
              x={sx(cursor.x) - 4}
              y={sy(cursor.z) - 4}
              width="8"
              height="8"
              stroke="#e3c7ff"
              fill="none"
            />
          </g>
        )}
        {pending && cursor && (
          <line
            x1={sx(pending.x)}
            y1={sy(pending.z)}
            x2={sx(cursor.x)}
            y2={sy(cursor.z)}
            stroke="#cfb5f8"
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
      </svg>
      {!project.nodes.length && (
        <div className="empty-canvas">
          <span>01 / MODELO</span>
          <h2>
            Uma estrutura começa
            <br />
            com uma linha.
          </h2>
          <p>
            Ative <b>Barra</b> e marque dois pontos na malha.
            <br />
            Os nós serão conectados automaticamente.
          </p>
          <div>
            <kbd>B</kbd> desenhar barra <kbd>Esc</kbd> selecionar
          </div>
        </div>
      )}
      <div className="view-foot">
        <span>
          XZ <b>·</b> Snap 0,50 m <b>·</b> Scroll: zoom / botão central: pan
        </span>
        <span>
          {cursor
            ? `X ${cursor.x.toFixed(2)} · Z ${cursor.z.toFixed(2)} m`
            : display === "deformed"
              ? `Deformada ×${deformationScale.toFixed(1)}`
              : "Z ↑  X →"}
        </span>
      </div>
    </section>
  );
}
