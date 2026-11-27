import {
  add,
  cross,
  origin,
  scale,
  subtract,
  type Point3,
} from "../domain/geometry";

export type Resultant = { force: Point3; moment: Point3 };
export const zeroResultant = (): Resultant => ({
  force: origin,
  moment: origin,
});
export function accumulate(sum: Resultant, value: Resultant, factor = 1) {
  sum.force = add(sum.force, scale(value.force, factor));
  sum.moment = add(sum.moment, scale(value.moment, factor));
}
export function reduced(
  at: Point3,
  datum: Point3,
  force: Point3,
  couple = origin,
): Resultant {
  return { force, moment: add(couple, cross(subtract(at, datum), force)) };
}
