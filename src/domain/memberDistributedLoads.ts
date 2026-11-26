import {
  add,
  coordinates,
  distance,
  dot,
  interpolate,
  localComponents,
  scale,
  subtract,
  tolerance,
  type Point3,
} from "./geometry";
import { positionError, type LoadFrame } from "./memberPointLoads";
import { memberAxis } from "./memberOffsets";
import type { Project } from "./model";

export type DistributedLoad = NonNullable<
  Project["loadPatterns"][number]["distributed"]
>[number];
export type InsertionAxis = ReturnType<typeof memberAxis>;

export function loadInterval(
  load: DistributedLoad,
  span: number,
): [number, number] {
  const factor = load.measure === "relative" ? span : 1;
  return [load.start * factor, load.end * factor];
}

export function distributedLoadError(
  load: DistributedLoad,
  span: number,
  mode: Project["mode"],
) {
  for (const value of [load.start, load.end]) {
    const error = positionError({ kind: load.measure, value }, span);
    if (error) return error;
  }
  const [a, b] = loadInterval(load, span);
  if (!(b > a)) return "O fim do trecho deve ser maior que o início.";
  if (b - a <= 32 * Number.EPSILON * Math.max(1, span))
    return "O comprimento do trecho está abaixo da resolução numérica da barra.";
  const vectors = [load.qStart, load.qEnd];
  if (!vectors.every((v) => coordinates.every((k) => Number.isFinite(v[k]))))
    return "Informe intensidades finitas nas duas extremidades.";
  if (mode === "planar" && vectors.some((v) => v.y !== 0))
    return "No plano XZ, use as componentes X e Z.";
  if (vectors.every((v) => coordinates.every((k) => v[k] === 0)))
    return "Informe ao menos uma intensidade diferente de zero.";
}

export function zeroCrossings(q0: Point3, q1: Point3) {
  return [
    ...new Set(
      coordinates.flatMap((k) => {
        if (!((q0[k] < 0 && q1[k] > 0) || (q0[k] > 0 && q1[k] < 0))) return [];
        return [q0[k] / (q0[k] - q1[k])];
      }),
    ),
  ].sort((a, b) => a - b);
}

// Endpoint forces of a linearly varying density integrated against 1−s and s.
// Their sum and first moment are exact even when the net force vanishes.
export function linearEndForces(q0: Point3, q1: Point3, length: number) {
  return [
    scale(add(scale(q0, 2), q1), length / 6),
    scale(add(q0, scale(q1, 2)), length / 6),
  ] as const;
}

export function intensityAt(load: DistributedLoad, span: number, x: number) {
  const [a, b] = loadInterval(load, span);
  return interpolate(
    load.qStart,
    load.qEnd,
    Math.max(0, Math.min(1, (x - a) / (b - a))),
  );
}

export function globalIntensity(
  vector: Point3,
  system: DistributedLoad["system"],
  axes: LoadFrame["axes"],
) {
  if (system === "global") return vector;
  return add(
    add(scale(axes[0], vector.x), scale(axes[1], vector.y)),
    scale(axes[2], vector.z),
  );
}

// A physical split intersects the old distribution with each child's axis.
// On a reversal or join the complete interval must be representable on the target.
export function rebaseDistributedLoad(
  load: DistributedLoad,
  from: LoadFrame,
  to: LoadFrame,
  memberId: string,
): DistributedLoad;
export function rebaseDistributedLoad(
  load: DistributedLoad,
  from: LoadFrame,
  to: LoadFrame,
  memberId: string,
  clip: true,
): DistributedLoad | null;
export function rebaseDistributedLoad(
  load: DistributedLoad,
  from: LoadFrame,
  to: LoadFrame,
  memberId: string,
  clip = false,
): DistributedLoad | null {
  const [a, b] = loadInterval(load, from.span);
  const u = dot(subtract(to.start, from.start), from.axes[0]),
    v = dot(subtract(to.end, from.start), from.axes[0]);
  const first = clip ? Math.max(a, Math.min(u, v)) : a,
    last = clip ? Math.min(b, Math.max(u, v)) : b;
  const precision = 32 * Number.EPSILON * Math.max(1, from.span, to.span);
  if (last - first <= precision && clip) return null;
  function map(x: number) {
    const point = interpolate(from.start, from.end, x / from.span);
    const along = dot(subtract(point, to.start), to.axes[0]);
    const station = Math.max(0, Math.min(to.span, along));
    if (
      distance(point, interpolate(to.start, to.end, station / to.span)) >
      tolerance
    )
      throw new Error(
        "A edição deixaria parte da carga distribuída fora do eixo da barra. Ajuste o trecho antes de continuar.",
      );
    const q = intensityAt(load, from.span, x);
    const d =
      station <= precision
        ? 0
        : to.span - station <= precision
          ? to.span
          : station;
    return {
      x: load.measure === "relative" ? d / to.span : d,
      q:
        load.system === "local"
          ? localComponents(globalIntensity(q, "local", from.axes), to.axes)
          : q,
    };
  }
  const ends = [map(first), map(last)].sort((l, r) => l.x - r.x);
  return {
    ...load,
    memberId,
    start: ends[0].x,
    end: ends[1].x,
    qStart: ends[0].q,
    qEnd: ends[1].q,
  };
}
