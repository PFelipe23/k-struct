import type { AnalysisCase, Project } from "../domain/model";
import type { XY } from "../domain/slabPolygon";
import { meshSlab, type SlabMesh } from "../domain/slab";
import { inspectSlabMesh } from "../domain/slabQuality";
import { checkMeshBudget } from "../domain/slabSizing";
import {
  panelWithoutJointSupport,
  sharedEdges,
  jointPanels,
} from "../domain/slabJoint";
import { beamMeshLayout } from "../domain/beamMesh";
import { tolerance } from "../domain/geometry";
import { slabAreaLoads } from "./slabAreaLoads";

// Split boundary triangles against their original opposite vertex. The mesh on
// the other side may come from a different formulation or sizing rule.
function conformPolygon(
  mesh: SlabMesh,
  edgeId: string,
  missing: XY[],
  parameter: (p: XY) => number,
  z: number,
) {
  const line = mesh.edges[edgeId];
  const byNode = new Map(line.map((id, i) => [id, i]));
  const splits = new Map<number, number[]>();
  const loToHi =
    parameter(mesh.nodes[line[0] - 1]) <
    parameter(mesh.nodes[line.at(-1)! - 1]);
  const order = loToHi ? line : [...line].reverse();
  let cursor = 0;
  for (const point of missing) {
    const t = parameter(point);
    while (
      cursor < order.length - 2 &&
      parameter(mesh.nodes[order[cursor + 1] - 1]) < t
    )
      cursor++;
    const index = Math.min(
      byNode.get(order[cursor])!,
      byNode.get(order[cursor + 1])!,
    );
    const number = mesh.nodes.length + 1;
    mesh.nodes.push({ ...point, z, number, restraints: [] });
    const ids = splits.get(index) ?? [];
    ids.push(number);
    splits.set(index, ids);
  }
  if (!loToHi) for (const ids of splits.values()) ids.reverse();
  const faces = mesh.elements.flatMap((el) => {
    for (const [i, u] of el.nodes.entries()) {
      const v = el.nodes[(i + 1) % 3],
        a = byNode.get(u),
        b = byNode.get(v);
      if (a === undefined || b === undefined || Math.abs(a - b) !== 1) continue;
      const mids = splits.get(Math.min(a, b));
      if (!mids) continue;
      const chain = [u, ...(a < b ? mids : [...mids].reverse()), v],
        opp = el.nodes[(i + 2) % 3];
      return chain
        .slice(1)
        .map((end, j) => [chain[j], end, opp] as [number, number, number]);
    }
    return [el.nodes];
  });
  mesh.elements = faces.map((nodes, i) => ({ number: i + 1, nodes }));
  mesh.edges[edgeId] = line.flatMap((n, i) => [n, ...(splits.get(i) ?? [])]);
}
export function prepareFloor(p: Project, c: AnalysisCase) {
  const joint = p.slabJoint!,
    edge = sharedEdges(p)[0],
    z = p.guides.z.find((g) => g.id === p.slabs[0].levelId)!.position;
  const start = edge.start,
    end = edge.end,
    length = Math.hypot(end.x - start.x, end.y - start.y);
  const tangent = {
    x: (end.x - start.x) / length,
    y: (end.y - start.y) / length,
  };
  const parameter = (v: XY) =>
    ((v.x - start.x) * tangent.x + (v.y - start.y) * tangent.y) / length;
  const point = (t: number) => ({
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  });
  const sides = [edge.a, edge.b];
  const definitions = jointPanels(p);
  const original = definitions.map((slab, i) => {
    const bare = panelWithoutJointSupport(slab, sides[i].edgeId);
    return { bare, mesh: meshSlab(bare, z) };
  });
  const member =
    joint.support === "beam"
      ? p.members.find((m) => m.id === joint.memberId)
      : undefined;
  const beamStart = member && p.nodes.find((n) => n.id === member.start)!;
  const reverse = !!beamStart && parameter(beamStart) > 0.5;
  const beamT = (t: number) => (reverse ? 1 - t : t);
  const layout = beamMeshLayout(p).stations;
  const values = original.flatMap(({ mesh }, i) =>
    mesh.edges[sides[i].edgeId].map((id) => parameter(mesh.nodes[id - 1])),
  );
  if (member) values.push(...layout.get(member.id)!.map((v) => beamT(v.t)));
  const sorted = values
    .map((t) => Math.min(1, Math.max(0, t)))
    .sort((a, b) => a - b);
  const ts = sorted.filter(
    (t, i) => !i || (t - sorted[i - 1]) * length > tolerance,
  );
  ts[0] = 0;
  ts[ts.length - 1] = 1;
  const panels = original.map(({ bare, mesh }, i) => {
    const id = sides[i].edgeId,
      definition = definitions[i];
    const own = mesh.edges[id]
      .map((n) => parameter(mesh.nodes[n - 1]))
      .sort((a, b) => a - b);
    let index = 0;
    const missing = ts
      .filter((t) => {
        while (index < own.length - 1 && own[index] < t - tolerance / length)
          index++;
        return Math.abs(own[index] - t) * length > tolerance;
      })
      .map(point);
    if (missing.length) {
      if (bare.polygon) {
        checkMeshBudget(
          mesh.elements.length + missing.length,
          mesh.nodes.length + missing.length,
        );
        conformPolygon(mesh, id, missing, parameter, z);
      } else {
        const axis = Math.abs(tangent.x) > 0.5 ? "x" : "y";
        mesh = meshSlab(bare, z, {
          axis,
          values: missing.map((v) => v[axis] - bare[axis]),
        });
      }
    }
    const ordered = [...mesh.edges[id]].sort(
      (a, b) => parameter(mesh.nodes[a - 1]) - parameter(mesh.nodes[b - 1]),
    );
    if (
      ordered.length !== ts.length ||
      ordered.some(
        (n, j) =>
          Math.abs(parameter(mesh.nodes[n - 1]) - ts[j]) * length > tolerance,
      )
    )
      throw new Error("A malha não conservou as estações comuns da borda.");
    const invalid = inspectSlabMesh(definition, mesh).issues.find(
      (e) => e.level === "invalid",
    );
    if (invalid)
      throw new Error(
        `Malha inválida em ${definition.name}, elemento ${invalid.element}. ${invalid.reason}.`,
      );
    return {
      definition,
      mesh,
      ordered,
      ...slabAreaLoads(p, c, definition, mesh),
    };
  });
  return {
    joint,
    panels,
    ts,
    beamT,
    member,
    tangent,
    length,
    z,
    point,
    analysisCase: c,
  };
}
export type FloorMesh = ReturnType<typeof prepareFloor>;
