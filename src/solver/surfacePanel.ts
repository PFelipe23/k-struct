import {
  add,
  cross,
  distance,
  dot,
  length,
  origin,
  scale,
  subtract,
  type Point3,
} from "../domain/geometry";
import type { AnalysisCase, Project, SurfacePanel } from "../domain/model";
import {
  globalBasis,
  inGlobal,
  inLocal,
  panelAssembly,
  panelKinds,
  type Basis,
} from "../domain/surfacePanel";
import { weightAcceleration } from "../domain/selfWeight";
import { elasticMaterialRecord } from "./elasticMaterial";

const elements = {
  membrane: "trplanestressrotallman3d",
  plate: "dktplate3d",
  shell: "tr_shell02",
};
const values = (p: Point3) => [p.x, p.y, p.z];
const components = (v: Point3) => values(v).join(" ");
function checkDirection(
  kind: SurfacePanel["kind"],
  local: Point3,
  name: string,
) {
  const unavailable =
    kind === "membrane"
      ? Math.abs(local.z)
      : kind === "plate"
        ? Math.hypot(local.x, local.y)
        : 0;
  if (unavailable > 1e-10 * Math.max(length(local), 1e-20))
    throw new Error(
      `${name} · ${panelKinds[kind]} não representa essa direção de carga. Use a formulação de casca ou altere a carga no referencial do painel.`,
    );
}
export function exportPanels(p: Project, analysisCase: AnalysisCase) {
  const mesh = panelAssembly(p);
  const datum = mesh.panels[0].panel.a;
  const loads = mesh.nodes.map(() => ({ ...origin }));
  const couples = mesh.nodes.map(() => ({ ...origin }));
  let force = { ...origin },
    moment = { ...origin };
  const record = (f: Point3, at: Point3) => {
    force = add(force, f);
    moment = add(moment, cross(subtract(at, datum), f));
  };
  const apply = (id: number, f: Point3) => {
    loads[id - 1] = add(loads[id - 1], f);
  };
  const sets: string[] = [],
    bcs: string[] = [];
  const nodeSet = (ids: number[]) =>
    sets.push(`Set ${sets.length + 1} nodes ${ids.length} ${ids.join(" ")}`);
  const sections: string[] = [],
    materials = p.materials.filter((m) =>
      mesh.panels.some((g) => g.panel.materialId === m.id),
    );
  for (const [i, g] of mesh.panels.entries()) {
    const panel = g.panel,
      mi = materials.findIndex((m) => m.id === panel.materialId),
      mat = materials[mi];
    sections.push(
      `SimpleCS ${i + 1} thick ${panel.thickness} material ${mi + 1}`,
    );
    // Allman interpolates the in-plane normal displacement on an edge with
    // a quadratic bubble times the difference of the two drilling rotations.
    const drill = (a: number, b: number, q: Point3, integral: number) => {
      if (panel.kind === "plate") return;
      const arm = cross(g.axes[2], subtract(g.points[b], g.points[a]));
      const pair = scale(g.axes[2], dot(q, arm) * integral);
      couples[g.ids[a] - 1] = add(couples[g.ids[a] - 1], pair);
      couples[g.ids[b] - 1] = subtract(couples[g.ids[b] - 1], pair);
    };
    let areaLoad = { ...origin };
    for (const { patternId, factor } of analysisCase.factors) {
      if (!factor) continue;
      const pat = p.loadPatterns.find((v) => v.id === patternId)!;
      const act = pat.panelActions?.find((v) => v.panelId === panel.id);
      const label = `${panel.name} · ${pat.name}`;
      if (pat.selfWeight.enabled) {
        const weight = scale(
          weightAcceleration(pat.selfWeight),
          mat.density * panel.thickness,
        );
        checkDirection(
          panel.kind,
          inLocal(weight, g.axes),
          label + " · peso próprio",
        );
        areaLoad = add(areaLoad, scale(weight, factor));
      }
      if (!act) continue;
      checkDirection(
        panel.kind,
        { ...origin, z: act.pressure },
        label + " · pressão",
      );
      areaLoad = add(areaLoad, scale(g.axes[2], factor * act.pressure));
      checkDirection(panel.kind, act.traction, label + " · carga de borda");
      const intensity = scale(inGlobal(act.traction, g.axes), factor),
        edge = g.edges[act.edge];
      const first = g.points[edge[0]],
        last = g.points[edge.at(-1)!];
      record(
        scale(intensity, distance(first, last)),
        scale(add(first, last), 0.5),
      );
      for (let k = 1; k < edge.length; k++) {
        const a = edge[k - 1],
          b = edge[k],
          half = scale(intensity, 0.5 * distance(g.points[a], g.points[b]));
        apply(g.ids[a], half);
        apply(g.ids[b], half);
        drill(a, b, intensity, distance(g.points[a], g.points[b]) / 12);
      }
    }
    record(scale(areaLoad, g.area), scale(add(g.corners.A, g.corners.C), 0.5));
    const share = scale(areaLoad, g.area / (3 * g.triangles.length));
    for (const tri of g.triangles)
      for (const [k, j] of tri.entries()) {
        apply(g.ids[j], share);
        drill(
          j,
          tri[(k + 1) % 3],
          areaLoad,
          g.area / (24 * g.triangles.length),
        );
      }
  }
  for (let dof = 1; dof <= 6; dof++) {
    const ids = mesh.nodes
      .filter((n) => n.fixed || n.inactive.includes(dof))
      .map((n) => n.number);
    if (ids.length)
      bcs.push(
        `BoundaryCondition ${bcs.length + 1} loadTimeFunction 1 dofs 1 ${dof} values 1 0 set ${nodeSet(ids)}`,
      );
  }
  for (const [i, f] of loads.entries())
    if (values(f).some(Boolean) || values(couples[i]).some(Boolean))
      bcs.push(
        `NodalLoad ${bcs.length + 1} loadTimeFunction 1 dofs 6 1 2 3 4 5 6 components 6 ${components(f)} ${components(couples[i])} csType 0 set ${nodeSet([i + 1])}`,
      );
  const deck = [
    "analysis.out",
    "KStruct - spatial panels - SI N m kg s",
    "StaticStructural nsteps 1 deltat 1",
    "domain 3dshell",
    "OutputManager tstep_all dofman_all element_all",
    `ndofman ${mesh.nodes.length} nelem ${mesh.elements.length} ncrosssect ${sections.length} nmat ${materials.length} nbc ${bcs.length} nic 0 nltf 1 nset ${sets.length}`,
    ...mesh.nodes.map(
      (n) =>
        `Node ${n.number} coords 3 ${components(subtract(n, datum))}${n.axes === globalBasis ? "" : ` lcs 6 ${components(n.axes[0])} ${components(n.axes[1])}`}`,
    ),
    ...mesh.elements.map(
      (e, i) =>
        `${elements[mesh.panels[e.panel].panel.kind]} ${i + 1} nodes 3 ${e.nodes.join(" ")} crossSect ${e.panel + 1} nip 4`,
    ),
    ...sections,
    ...materials.map((m, i) => elasticMaterialRecord(m, i + 1)),
    ...bcs,
    "ConstantFunction 1 f(t) 1",
    ...sets,
    "",
  ].join("\n");
  if (
    ![...values(force), ...values(moment)].every(Number.isFinite) ||
    deck.length > 2 * 1024 * 1024
  )
    throw new Error(
      "A entrada dos painéis excede o intervalo numérico ou o tamanho aceito pelo motor.",
    );
  return { deck, data: { mesh, datum, force, moment } };
}

export type PanelInput = ReturnType<typeof exportPanels>["data"];
export const panelFields = ["nxx", "nyy", "nxy", "mxx", "myy", "mxy"] as const;
type Field = (typeof panelFields)[number];
type LocalSample = Partial<Record<Field, number>>;
function projection(t: number[], axes: Basis) {
  const product = (a: Point3, b: Point3) =>
    dot(a, {
      x: t[0] * b.x + t[5] * b.y + t[4] * b.z,
      y: t[5] * b.x + t[1] * b.y + t[3] * b.z,
      z: t[4] * b.x + t[3] * b.y + t[2] * b.z,
    });
  return [
    product(axes[0], axes[0]),
    product(axes[1], axes[1]),
    product(axes[0], axes[1]),
  ];
}
function tensor(s: string | undefined) {
  const t = s?.trim().split(/\s+/).map(Number);
  if (t?.length !== 6 || !t.every(Number.isFinite))
    throw new Error(
      "Tensor de painel ausente ou incompleto na saída do OOFEM.",
    );
  return t;
}
export function readPanels(
  raw: string,
  input: PanelInput,
  nodal: Map<number, Map<number, number>>,
  reactions: Map<string, number>,
) {
  const { mesh, datum } = input;
  const panels = mesh.panels.map((g) => ({
    panelId: g.panel.id,
    name: g.panel.name,
    kind: g.panel.kind,
    axes: g.axes,
    nodes: [] as { id: number; point: Point3; local: Point3; global: Point3 }[],
    samples: [] as { element: number; gp: number; fields: LocalSample }[],
  }));
  let force = { ...origin },
    moment = { ...origin },
    scaleF = length(input.force),
    scaleM = length(input.moment);
  const supportReactions: { id: number; force: Point3; couple: Point3 }[] = [];
  const displacements = mesh.nodes.map((n) => {
    const dofs = nodal.get(n.number);
    if (!dofs || [1, 2, 3, 4, 5, 6].some((d) => !dofs.has(d)))
      throw new Error(`Deslocamento de painel incompleto no nó ${n.number}.`);
    const r = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6; i++)
      if (n.fixed || n.inactive.includes(i + 1)) {
        const value = reactions.get(`${n.number}:${i + 1}`);
        if (value === undefined)
          throw new Error(
            `Reação de painel ausente no nó ${n.number}, GL ${i + 1}.`,
          );
        r[i] = value;
      }
    const f = inGlobal({ x: r[0], y: r[1], z: r[2] }, n.axes),
      m = inGlobal({ x: r[3], y: r[4], z: r[5] }, n.axes);
    if (n.fixed) {
      supportReactions.push({ id: n.number, force: f, couple: m });
      const arm = cross(subtract(n, datum), f);
      force = add(force, f);
      moment = add(moment, add(m, arm));
      scaleF += length(f);
      scaleM += length(m) + length(arm);
    }
    return inGlobal(
      { x: dofs.get(1)!, y: dofs.get(2)!, z: dofs.get(3)! },
      n.axes,
    );
  });
  if (
    length(add(force, input.force)) > 1e-7 + 2e-4 * scaleF ||
    length(add(moment, input.moment)) > 1e-7 + 2e-4 * scaleM
  )
    throw new Error(
      "O equilíbrio global dos painéis em forças ou momentos não foi atendido pelos apoios físicos.",
    );
  for (const [i, g] of mesh.panels.entries())
    panels[i].nodes = g.ids.map((id, i) => ({
      id,
      point: g.points[i],
      global: displacements[id - 1],
      local: inLocal(displacements[id - 1], g.axes),
    }));
  const seen = new Set<number>();
  for (const match of raw.matchAll(
    /^element\s+(\d+)\s+\(\s*\d+\)\s*:\s*([\s\S]*?)(?=^element\s+\d+\s+\(|^={3,}|^\s*R E A C T I O N|^Finishing analysis on:|(?![\s\S]))/gim,
  )) {
    const id = Number(match[1]),
      element = mesh.elements[id - 1];
    if (!element || seen.has(id))
      throw new Error("Elemento de painel duplicado ou inesperado na saída.");
    seen.add(id);
    const panel = panels[element.panel],
      h = mesh.panels[element.panel].panel.thickness;
    const gps = new Set<number>();
    for (const point of match[2].matchAll(
      /^[ \t]*GP\s+1\.(\d+)\s*:[^\n]*\n[^\n]*\n\s*stresses[ \t]*([^\n]*)\n\s*moments[ \t]*([^\n]*)/gm,
    )) {
      const gp = Number(point[1]),
        fields: LocalSample = {};
      if (gp < 1 || gp > 4 || gps.has(gp))
        throw new Error(
          "Ponto de integração de painel duplicado ou inesperado.",
        );
      gps.add(gp);
      if (panel.kind !== "plate") {
        // OOFEM 3.0 prints Allman's in-plane Cauchy stress in Pa, including in TR_SHELL02.
        const [xx, yy, xy] = projection(tensor(point[2]), panel.axes);
        Object.assign(fields, { nxx: xx * h, nyy: yy * h, nxy: xy * h });
      }
      if (panel.kind !== "membrane") {
        const [mxx, myy, mxy] = projection(tensor(point[3]), panel.axes);
        Object.assign(fields, { mxx, myy, mxy });
      }
      panel.samples.push({ element: id, gp, fields });
    }
    if (gps.size !== 4)
      throw new Error(
        `Resultados de integração incompletos no elemento de painel ${id} (${gps.size}/4).`,
      );
  }
  if (seen.size !== mesh.elements.length)
    throw new Error("A saída não contém todos os elementos dos painéis.");
  return {
    panels,
    supportReactions,
    shared: mesh.shared,
    force,
    moment,
    applied: input.force,
    appliedMoment: input.moment,
    datum,
  };
}
export type PanelResult = ReturnType<typeof readPanels>;
