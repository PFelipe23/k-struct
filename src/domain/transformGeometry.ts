import {
  add,
  beamAxes,
  coordinates,
  cross,
  distance,
  dot,
  length,
  origin,
  scale,
  subtract,
  tolerance,
  type Point3,
} from "./geometry";
import { free, type Project, type StructuralNode } from "./model";
import {
  hasElasticSupport,
  sameSupportAxes,
  supportBasis,
  type SupportFrame,
} from "./supports";

export type Transform =
  | { kind: "move"; offset: Point3 }
  | { kind: "translate"; offset: Point3; copies: number }
  | { kind: "mirror"; center: Point3; normal: Point3 }
  | {
      kind: "rotate";
      center: Point3;
      axis: Point3;
      degrees: number;
      copies: number;
    };
export type VectorMap = (v: Point3) => Point3;
const identity: VectorMap = (v) => v;
const finitePoint = (p: Point3) =>
  coordinates.every((k) => Number.isFinite(p[k]));
const angularTolerance = 1e-10;

export function mapping(spec: Transform, step: number, mode: Project["mode"]) {
  let vector: VectorMap = identity;
  let center = origin,
    offset = origin;
  const parity = spec.kind === "mirror" ? -1 : 1;
  if (spec.kind === "move" || spec.kind === "translate") {
    if (!finitePoint(spec.offset) || length(spec.offset) < tolerance)
      throw new Error("Informe um deslocamento finito e diferente de zero.");
    if (mode === "planar" && spec.offset.y !== 0)
      throw new Error(
        "A transformação de um projeto plano precisa permanecer em XZ.",
      );
    offset = scale(spec.offset, step);
  } else {
    center = spec.center;
    const direction = spec.kind === "mirror" ? spec.normal : spec.axis;
    const norm = length(direction);
    if (!finitePoint(center) || !Number.isFinite(norm) || norm === 0)
      throw new Error(
        "Informe um ponto finito e uma direção diferente de zero.",
      );
    const axis = scale(direction, 1 / norm);
    if (spec.kind === "mirror")
      vector = (v) => subtract(v, scale(axis, 2 * dot(axis, v)));
    else {
      if (
        !Number.isFinite(spec.degrees) ||
        Math.abs(spec.degrees % 360) < 1e-10
      )
        throw new Error(
          "Informe um passo angular diferente de uma volta completa ou de zero.",
        );
      const angle = ((spec.degrees % 360) * step * Math.PI) / 180,
        c = Math.cos(angle),
        s = Math.sin(angle);
      vector = (v) =>
        add(
          add(scale(v, c), scale(cross(axis, v), s)),
          scale(axis, dot(axis, v) * (1 - c)),
        );
    }
  }
  const position = (p: Point3): Point3 => {
    const result = add(add(center, vector(subtract(p, center))), offset);
    if (!finitePoint(result))
      throw new Error(
        "A transformação produz coordenadas fora do intervalo numérico.",
      );
    if (mode === "planar") result.y = 0;
    return result;
  };
  if (
    mode === "planar" &&
    (Math.abs(vector({ x: 1, y: 0, z: 0 }).y) > angularTolerance ||
      Math.abs(vector({ x: 0, y: 0, z: 1 }).y) > angularTolerance ||
      Math.abs(add(add(center, vector(scale(center, -1))), offset).y) >=
        tolerance)
  )
    throw new Error(
      "A transformação de um projeto plano precisa permanecer em XZ.",
    );
  return { position, vector, parity };
}

export function sectionRoll(a: Point3, b: Point3, z: Point3) {
  const [, y0, z0] = beamAxes(a, b, 0);
  return (Math.atan2(-dot(z, y0), dot(z, z0)) * 180) / Math.PI;
}

// Tilt an incident member through the shortest rotation when only one end moves.
export function movedRoll(
  a: Point3,
  b: Point3,
  A: Point3,
  B: Point3,
  roll: number,
) {
  const [x, , z] = beamAxes(a, b, roll),
    [next] = beamAxes(A, B, 0);
  const k = cross(x, next),
    cosine = dot(x, next),
    sine = length(k);
  if (sine < 1e-12) return cosine > 0 ? roll : sectionRoll(A, B, z);
  const axis = scale(k, 1 / sine);
  const Z = add(
    add(scale(z, cosine), scale(cross(axis, z), sine)),
    scale(axis, dot(axis, z) * (1 - cosine)),
  );
  return sectionRoll(A, B, Z);
}

// Global flags suffice when the rotated constraint projector is diagonal in XYZ.
function globalRestraints(node: StructuralNode, vector: VectorMap) {
  const out = free();
  for (const prefix of ["u", "r"] as const) {
    const basis = coordinates
      .filter((k) => node.restraints[`${prefix}${k}`])
      .map((k) => vector({ ...origin, [k]: 1 }));
    for (const k of coordinates) {
      const diagonal = basis.reduce((sum, v) => sum + v[k] * v[k], 0);
      if (
        coordinates.some(
          (j) =>
            j !== k &&
            Math.abs(basis.reduce((sum, v) => sum + v[k] * v[j], 0)) >
              angularTolerance,
        )
      )
        return undefined;
      out[`${prefix}${k}`] = diagonal > 0.5;
    }
  }
  return out;
}

export function mapSupport(
  node: StructuralNode,
  vector: VectorMap,
  mode: Project["mode"],
) {
  if (!node.supportFrame && !hasElasticSupport(node)) {
    const restraints = globalRestraints(node, vector);
    if (restraints) return { restraints, springs: undefined, frame: undefined };
  }
  const basis = supportBasis(node.supportFrame);
  const x = vector(basis.x);
  // Rebuilding z from x × y after a reflection preserves the fixed subspace.
  const frame: SupportFrame =
    mode === "planar"
      ? { kind: "planar", angle: (Math.atan2(x.z, x.x) * 180) / Math.PI }
      : { kind: "spatial", x, y: vector(basis.y) };
  return {
    restraints: node.restraints,
    springs: node.springs,
    frame:
      !node.supportFrame && sameSupportAxes(frame, undefined)
        ? undefined
        : frame,
  };
}

export function assertLength(a: Point3, b: Point3, name: string) {
  if (distance(a, b) < tolerance)
    throw new Error(`A barra ${name} ficaria com comprimento nulo.`);
}
