import {
  add,
  beamAxes,
  dot,
  interpolate,
  localComponents,
  scale,
  subtract,
  tolerance,
} from "./geometry";
import { memberAxis } from "./memberOffsets";
import type { Member, Project, StructuralNode } from "./model";

export type MemberPointLoad = NonNullable<
  Project["loadPatterns"][number]["points"]
>[number];
export type LoadPosition = MemberPointLoad["position"];

export function pointLoadFrame(
  member: Member,
  nodes: ReadonlyMap<string, StructuralNode>,
  mode: Project["mode"],
) {
  const axis = memberAxis(
    member,
    nodes.get(member.start)!,
    nodes.get(member.end)!,
  );
  return { ...axis, axes: beamAxes(axis.start, axis.end, member.roll, mode) };
}
export type LoadFrame = ReturnType<typeof pointLoadFrame>;

export function distanceFromI(position: LoadPosition, span: number) {
  return position.kind === "relative" ? position.value * span : position.value;
}
export function pointFraction(position: LoadPosition, span: number) {
  return position.kind === "relative" ? position.value : position.value / span;
}
export function positionError(position: LoadPosition, span: number) {
  if (!Number.isFinite(span) || span < tolerance)
    return "O eixo de inserção precisa ter comprimento válido para receber uma carga concentrada.";
  const maximum = position.kind === "relative" ? 1 : span;
  if (
    !Number.isFinite(position.value) ||
    position.value < 0 ||
    position.value > maximum
  )
    return position.kind === "relative"
      ? "Informe x/L entre 0 e 1."
      : "A distância a partir de i deve estar entre zero e o comprimento do eixo de inserção.";
}
export function componentError(
  load: Pick<MemberPointLoad, "kind" | "components">,
  mode: Project["mode"],
) {
  const v = load.components;
  if (!Object.values(v).every(Number.isFinite) || !(v.x || v.y || v.z))
    return "Informe pelo menos uma componente finita diferente de zero.";
  if (mode === "planar" && (load.kind === "force" ? v.y : v.x || v.z))
    return "No plano XZ, use força em X/Z ou momento em Y.";
}
export function actionPoint(load: MemberPointLoad, frame: LoadFrame) {
  return interpolate(
    frame.start,
    frame.end,
    pointFraction(load.position, frame.span),
  );
}
export function actionVector(
  load: MemberPointLoad,
  axes: ReturnType<typeof beamAxes>,
) {
  const v = load.components;
  if (load.system === "global") return v;
  return add(
    add(scale(axes[0], v.x), scale(axes[1], v.y)),
    scale(axes[2], v.z),
  );
}
// Reassign the same physical load after reversing, dividing or joining a member.
export function rebasePointLoad(
  load: MemberPointLoad,
  from: LoadFrame,
  to: LoadFrame,
  memberId: string,
): MemberPointLoad {
  const p = actionPoint(load, from);
  const x = dot(subtract(p, to.start), to.axes[0]);
  if (x < -tolerance || x > to.span + tolerance)
    throw new Error(
      "A edição deixaria uma carga concentrada fora da barra. Reposicione a carga antes de continuar.",
    );
  const d =
    Math.abs(x) <= tolerance
      ? 0
      : Math.abs(to.span - x) <= tolerance
        ? to.span
        : x;
  return {
    ...load,
    memberId,
    position: {
      kind: load.position.kind,
      value: load.position.kind === "relative" ? d / to.span : d,
    },
    components:
      load.system === "local"
        ? localComponents(actionVector(load, from.axes), to.axes)
        : load.components,
  };
}
