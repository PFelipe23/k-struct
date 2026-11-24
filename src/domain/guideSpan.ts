import {
  planeCoordinates,
  planePoint,
  type WorkPlane,
  type Point3,
} from "./geometry";
import type { Project } from "./model";

export type GuideSpan = readonly [Point3, Point3];

// A span belongs to one axis, strictly between two consecutive transverse guides.
// Within the picking radius of a crossing, either direction could be intended.
export function pickGuideSpan(
  guides: Project["guides"],
  plane: WorkPlane,
  u: number,
  v: number,
  radius: number,
): GuideSpan | null {
  const [axisU, axisV] = planeCoordinates[plane.kind];
  function locate(value: number, axis: typeof axisU | typeof axisV) {
    let before = -Infinity,
      after = Infinity;
    const near: number[] = [];
    for (const { position } of guides[axis]) {
      if (Math.abs(position - value) <= radius) near.push(position);
      if (position < value) before = Math.max(before, position);
      if (position > value) after = Math.min(after, position);
    }
    return {
      before,
      after,
      near,
      bounded: Number.isFinite(before) && Number.isFinite(after),
    };
  }
  const x = locate(u, axisU),
    y = locate(v, axisV);
  if (x.near.length === 1 && !y.near.length && y.bounded) {
    return [
      planePoint(x.near[0], y.before, plane),
      planePoint(x.near[0], y.after, plane),
    ];
  }
  if (y.near.length === 1 && !x.near.length && x.bounded) {
    return [
      planePoint(x.before, y.near[0], plane),
      planePoint(x.after, y.near[0], plane),
    ];
  }
  return null;
}
