import type { AnalysisCase, Project, Slab } from "../domain/model";
import type { SlabMesh } from "../domain/slab";
import { cross2, slabProperties } from "../domain/slabPolygon";
import { selfWeightSummary } from "../domain/selfWeight";
import {
  elevationPressure,
  pressureAt,
  slabPressureVertices,
} from "../domain/surfacePressure";
import { add, scale, subtract, type Point3 } from "../domain/geometry";
import { integrateTriangle } from "./areaIntegration";

export function slabAreaLoads(
  project: Project,
  analysisCase: AnalysisCase,
  slab: Slab,
  mesh: SlabMesh,
) {
  const origin = mesh.nodes[0],
    { centroid, area } = slabProperties(slab);
  let uniform = 0;
  const variable: ((p: Point3) => number)[] = [];
  for (const { patternId, factor } of analysisCase.factors) {
    if (!factor) continue;
    const pattern = project.loadPatterns.find((p) => p.id === patternId)!;
    const action = pattern.pressure.find((v) => v.slabId === slab.id);
    if (pattern.selfWeight.enabled) {
      if (!pattern.selfWeight.direction.endsWith("Z"))
        throw new Error(
          `O padrão ${pattern.name} direciona o peso próprio fora do eixo Z, que não é suportado pelo painel horizontal ${slab.name}.`,
        );
      uniform +=
        factor *
        (selfWeightSummary(project, pattern).slabs.find(
          (v) => v.slabId === slab.id,
        )?.pz ?? 0);
    }
    if (!action) continue;
    if (action.direction === "X" || action.direction === "Y")
      throw new Error(
        slab.name + " · direção de carga incompatível com a placa horizontal.",
      );
    const d = action.distribution;
    if (!d) uniform += factor * action.pz;
    else if (d.mode === "elevation")
      uniform += factor * elevationPressure(d, origin.z);
    else {
      const at = pressureAt(
        0,
        d,
        slabPressureVertices(slab, origin.z),
        slab.polygon,
      );
      variable.push((p) => factor * at(p));
    }
  }
  let totalLoadZ = uniform * area;
  const appliedMoment = {
    x: totalLoadZ * (centroid.y - origin.y),
    y: -totalLoadZ * (centroid.x - origin.x),
  };
  const nativeUniform = slab.formulation === "qdkt" && !variable.length;
  const nodalLoads =
    nativeUniform || (!variable.length && !uniform)
      ? null
      : mesh.nodes.map(() => 0);
  if (nodalLoads) {
    const at = (p: Point3) => variable.reduce((v, f) => v + f(p), uniform);
    if (!variable.length) {
      for (const el of mesh.elements) {
        const [a, b, c] = el.nodes.map((id) => mesh.nodes[id - 1]);
        const share = (uniform * cross2(a, b, c)) / 6;
        for (const id of el.nodes) nodalLoads[id - 1] += share;
      }
    } else {
      totalLoadZ = 0;
      appliedMoment.x = 0;
      appliedMoment.y = 0;
      // Every refined polygon triangle belongs to one original face. Evaluate
      // each nodal pressure once and use its exact linear interpolation there.
      const polygonValues = slab.polygon ? mesh.nodes.map(at) : undefined;
      for (const el of mesh.elements) {
        const pts = el.nodes.map((id) => mesh.nodes[id - 1]);
        const visit = (shape: number[], p: Point3, dA: number) => {
          const density = polygonValues
            ? el.nodes.reduce(
                (sum, id, i) => sum + shape[i] * polygonValues[id - 1],
                0,
              )
            : at(p);
          const force = density * dA;
          totalLoadZ += force;
          appliedMoment.x += (p.y - origin.y) * force;
          appliedMoment.y -= (p.x - origin.x) * force;
          el.nodes.forEach((id, i) => {
            nodalLoads[id - 1] += shape[i] * force;
          });
        };
        if (pts.length === 3) integrateTriangle(pts, [], visit);
        else {
          const [a, b, , d] = pts,
            ab = subtract(b, a),
            ad = subtract(d, a);
          const cellArea = Math.abs(cross2(a, b, d));
          const gauss = [
            (1 - 1 / Math.sqrt(3)) / 2,
            (1 + 1 / Math.sqrt(3)) / 2,
          ];
          for (const u of gauss)
            for (const v of gauss)
              visit(
                [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v],
                add(a, add(scale(ab, u), scale(ad, v))),
                cellArea / 4,
              );
        }
      }
    }
  }
  if (
    ![
      totalLoadZ,
      appliedMoment.x,
      appliedMoment.y,
      ...(nodalLoads ?? []),
    ].every(Number.isFinite)
  )
    throw new Error(
      `A pressão do caso ${analysisCase.name} gera uma carga total fora do intervalo numérico.`,
    );
  return {
    centroid,
    totalLoadZ,
    appliedMoment,
    pressure: nativeUniform ? uniform : 0,
    nodalLoads,
  };
}
