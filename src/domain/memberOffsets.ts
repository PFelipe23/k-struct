import {
  add,
  coordinates,
  distance,
  dot,
  interpolate,
  length,
  onPlane,
  origin,
  scale,
  subtract,
  tolerance,
  type Point3,
  type WorkPlane,
} from "./geometry";
import type { Member, Project } from "./model";

export type MemberEnd = "i" | "j";
export type EndOffset = { eccentricity: Point3; rigidLength: number };
export type MemberOffsets = Record<MemberEnd, EndOffset>;
export const centeredOffsets: MemberOffsets = {
  i: { eccentricity: { ...origin }, rigidLength: 0 },
  j: { eccentricity: { ...origin }, rigidLength: 0 },
};

// Eccentricities run from the editable joint to the insertion axis, in global XYZ.
export function memberAxis(
  member: Pick<Member, "offsets">,
  a: Point3,
  b: Point3,
) {
  const { i, j } = member.offsets ?? centeredOffsets;
  const start = add(a, i.eccentricity),
    end = add(b, j.eccentricity);
  const span = distance(start, end);
  const direction = span > 0 ? scale(subtract(end, start), 1 / span) : origin;
  return {
    start,
    end,
    span,
    clear: span - i.rigidLength - j.rigidLength,
    faceI: i.rigidLength ? add(start, scale(direction, i.rigidLength)) : start,
    faceJ: j.rigidLength ? add(end, scale(direction, -j.rigidLength)) : end,
  };
}

export function memberOnPlane(
  m: Member,
  a: Point3,
  b: Point3,
  plane: WorkPlane,
) {
  if (onPlane(a, plane) && onPlane(b, plane)) return true;
  if (!m.offsets) return false;
  const axis = memberAxis(m, a, b);
  return onPlane(axis.start, plane) && onPlane(axis.end, plane);
}

export function offsetError(
  member: Member,
  a: Point3,
  b: Point3,
  mode: Project["mode"],
) {
  if (!member.offsets) return;
  const ends = Object.values(member.offsets);
  const label = `Barra ${member.name} (${member.id})`;
  if (
    ends.some(
      (e) =>
        !Number.isFinite(e.rigidLength) ||
        e.rigidLength < 0 ||
        coordinates.some((k) => !Number.isFinite(e.eccentricity[k])),
    )
  )
    return `${label}: informe excentricidades finitas e comprimentos rígidos finitos e não negativos.`;
  if (mode === "planar" && ends.some((e) => e.eccentricity.y !== 0))
    return `${label}: a excentricidade em Y precisa ser zero no plano XZ.`;
  const axis = memberAxis(member, a, b);
  if (
    !Number.isFinite(axis.clear) ||
    axis.clear < tolerance ||
    distance(axis.faceI, axis.faceJ) < tolerance
  )
    return `${label}: o comprimento deformável deve ser pelo menos ${tolerance} m. Confira as excentricidades e os trechos rígidos.`;
}

export function setOffsets(
  member: { offsets?: MemberOffsets },
  offsets: MemberOffsets,
) {
  if (
    Object.values(offsets).some(
      (e) =>
        e.rigidLength !== 0 || coordinates.some((k) => e.eccentricity[k] !== 0),
    )
  )
    member.offsets = offsets;
  else delete member.offsets;
}

export function splitOffsets(
  parent: Member,
  a: Point3,
  b: Point3,
  child: Member,
  c: Point3,
  d: Point3,
) {
  if (!parent.offsets) return;
  const { i, j } = parent.offsets;
  const direction = subtract(b, a),
    magnitude = length(direction);
  const unit = scale(direction, 1 / magnitude);
  const endOffset = (p: Point3): EndOffset => ({
    eccentricity: interpolate(
      i.eccentricity,
      j.eccentricity,
      dot(subtract(p, a), unit) / magnitude,
    ),
    rigidLength: 0,
  });
  setOffsets(child, {
    i: child.start === parent.start ? i : endOffset(c),
    j: child.end === parent.end ? j : endOffset(d),
  });
}
