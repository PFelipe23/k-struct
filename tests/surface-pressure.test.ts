import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  parseProject,
  serializeProject,
  type Project,
} from "../src/domain/model";
import { addSlabOpening } from "../src/domain/editing";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { slabPressureVertices } from "../src/domain/surfacePressure";
import { slabBenchmarkProject } from "./fixtures/slab-benchmark";
import { jointedSlabs } from "./fixtures/jointed-slabs";
import { runDeck } from "./fixtures/solve-oofem";

const executable = process.env.OOFEM_BIN;
const wall = () =>
  parseProject(
    readFileSync(
      new URL(
        "../examples/parede-pressao-hidrostatica.kstruct.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
function solve(p: Project) {
  const input = exportOofem(p, "EL");
  return parseOofemOutput(runDeck(input.deck, executable!), input);
}
function within(actual: number, expected: number, tol: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
}
it("migra a pressão uniforme da v29 e rejeita campos incompatíveis", () => {
  const old = wall(),
    action = old.loadPatterns[0].panelActions![0];
  delete action.distribution;
  action.pressure = 1200;
  const input = exportOofem(old, "EL");
  const migrated = parseProject(JSON.stringify({ ...old, schemaVersion: 29 }));
  expect(exportOofem(migrated, "EL").deck).toBe(input.deck);
  expect(parseProject(serializeProject(wall()))).toEqual(wall());
  // A fully dry top, triangular middle and constant-pressure bottom in one cell.
  const cut = wall();
  cut.surfacePanels![0].nu = 1;
  cut.loadPatterns[0].panelActions![0].distribution = {
    mode: "elevation",
    z0: 1,
    z1: 3,
    p0: 2000,
    p1: 0,
  };
  const integrated = exportOofem(cut, "EL").panels!;
  within(integrated.force.x, -12000, 1e-7);
  within(integrated.moment.y, -(6000 * 0.5 + 6000 * (1 + 2 / 3)), 1e-7);
  action.distribution = { mode: "elevation", z0: 2, z1: 1, p0: 0, p1: 5000 };
  expect(() => parseProject(JSON.stringify(old))).toThrow();
  action.distribution = { mode: "vertices", values: { E: 1 } };
  action.pressure = 0;
  expect(() => parseProject(JSON.stringify(old))).toThrow(/vértice ausente/);
  delete action.distribution;
  action.direction = "Y";
  action.pressure = 10;
  old.surfacePanels![0].kind = "plate";
  expect(() => exportOofem(old, "EL")).toThrow(/direção de carga/);
});
it.skipIf(!executable)(
  "OOFEM · hidrostática triangular na parede e linha d'água no interior dos elementos",
  () => {
    for (const [height, n] of [
      [4, 12],
      [2.3, 1],
      [2.3, 13],
    ]) {
      const p = wall(),
        g = p.surfacePanels![0];
      g.nu = n;
      const act = p.loadPatterns[0].panelActions![0];
      act.distribution = {
        mode: "elevation",
        z0: 0,
        z1: height,
        p0: 9810 * height,
        p1: 0,
      };
      const r = solve(p).panels!,
        force = (3 * 9810 * height ** 2) / 2,
        moment = (force * height) / 3;
      within(r.applied.x, -force, 1e-6);
      within(r.appliedMoment.y, -moment, 1e-6);
      within(r.force.x, force, 3);
      within(r.moment.y, moment, 3);
      within(r.moment.y / r.force.x, height / 3, 0.00005);
      within(r.moment.z, -1.5 * force, 4);
    }
  },
);
it.skipIf(!executable)(
  "OOFEM · carga global bilinear em casca inclinada integra a área real e os dois primeiros momentos",
  () => {
    const p = wall(),
      g = p.surfacePanels![0],
      a = p.loadPatterns[0].panelActions![0];
    Object.assign(g, {
      a: { x: 2, y: -5, z: 9 },
      b: { x: 6, y: -5, z: 12 },
      d: { x: 2, y: -3, z: 9 },
      angleDeg: 37,
      nu: 4,
      nv: 3,
    });
    a.direction = "X";
    a.distribution = { mode: "vertices", values: { C: 8000 } };
    p.analysisCases[0].factors[0].factor = 1.5;
    const r = solve(p).panels!,
      F = ((10 * 8000) / 4) * 1.5;
    within(r.applied.x, F, 1e-7);
    within(r.appliedMoment.y, 2 * F, 1e-7);
    within(r.appliedMoment.z, (-4 * F) / 3, 1e-7);
    within(r.force.x, -F, 1.2);
    within(r.moment.y, -2 * F, 2);
    within(r.moment.z, (4 * F) / 3, 2);
    g.angleDeg = 0;
    expect(solve(p).panels!.applied).toEqual(r.applied);
  },
);
it.skipIf(!executable)(
  "OOFEM · lajes DKT e QDKT conservam o binário de uma pressão com resultante zero",
  () => {
    for (const formulation of ["dkt", "qdkt"] as const) {
      const p = slabBenchmarkProject(),
        slab = p.slabs[0];
      slab.formulation = formulation;
      const a = p.loadPatterns[0].pressure[0];
      a.pz = 0;
      a.direction = "Z";
      a.distribution = {
        mode: "vertices",
        values: { yMin: -3000, xMax: 3000, yMax: 3000, xMin: -3000 },
      };
      const input = exportOofem(p, "EL"),
        r = solve(p).slab!;
      within(input.slab!.totalLoadZ, 0, 1e-7);
      within(input.slab!.appliedMoment.y, -24000, 1e-7);
      within(r.totalReactionZ, 0, 0.3);
      expect(Math.max(...r.nodes.map((v) => Math.abs(v.uz)))).toBeGreaterThan(
        0.000001,
      );
    }
  },
);
it.skipIf(!executable)(
  "OOFEM · pressão nodal no contorno com abertura segue a área líquida e chega à viga comum",
  () => {
    const p = slabBenchmarkProject(),
      s = p.slabs[0],
      a = p.loadPatterns[0].pressure[0];
    a.pz = 0;
    a.distribution = {
      mode: "vertices",
      values: { yMin: 0, xMax: -4000, yMax: -4000, xMin: 0 },
    };
    addSlabOpening(p, s.id, [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]);
    expect(Object.keys(a.distribution.values)).toHaveLength(8);
    for (const v of slabPressureVertices(p.slabs[0], 3))
      within(a.distribution.values[v.id], -1000 * v.point.x, 1e-8);
    const opened = solve(p).slab!;
    within(opened.totalLoadZ, -22500, 1e-6);
    within(opened.totalReactionZ, 22500, 1);
    const pair = jointedSlabs(),
      load = pair.loadPatterns[0].pressure[0],
      first = pair.slabs.find((v) => v.id === load.slabId)!;
    const previous = load.pz;
    load.pz = 0;
    load.distribution = {
      mode: "vertices",
      values: Object.fromEntries(
        slabPressureVertices(first, 0).map((v) => [v.id, previous]),
      ),
    };
    const coupled = solve(pair).floor!;
    within(coupled.totalLoadZ, -60000, 0.00001);
    expect(Math.abs(coupled.beamForce)).toBeGreaterThan(100);
  },
);

it.skipIf(!executable)(
  "OOFEM · flecha da faixa de parede converge para a solução em balanço sob triângulo",
  () => {
    const p = wall(),
      panel = p.surfacePanels![0];
    panel.kind = "plate";
    p.materials[0].nu = 0;
    const exact = (-39240 * 4 ** 4) / (30 * ((30e9 * 0.25 ** 3) / 12));
    let coarse = 0;
    for (const n of [8, 32]) {
      panel.nu = n;
      panel.nv = n / 2;
      const mid = solve(p).panels!.panels[0].nodes.find(
        (v) => v.point.z === 4 && v.point.y === 1.5,
      )!;
      const error = Math.abs(mid.global.x - exact);
      if (n === 8) coarse = error;
      else {
        expect(error).toBeLessThan(coarse / 10);
        expect(error).toBeLessThan(0.001 * Math.abs(exact));
      }
    }
  },
);
