import { it, expect } from "vitest";
import { cantileverPanel, foldedPanels } from "./fixtures/spatial-panels";
import {
  createProject,
  parseProject,
  serializeProject,
  analysisErrors,
  type Project,
} from "../src/domain/model";
import {
  globalBasis,
  inGlobal,
  inLocal,
  panelAssembly,
  type Basis,
} from "../src/domain/surfacePanel";
import { add, scale, length, subtract, origin } from "../src/domain/geometry";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";

const bin = process.env.OOFEM_BIN;
const vertical: Basis = [
  globalBasis[2],
  globalBasis[1],
  scale(globalBasis[0], -1),
];
const inclined: Basis = [
  { x: 1 / 3, y: 2 / 3, z: 2 / 3 },
  { x: 2 / 3, y: 1 / 3, z: -2 / 3 },
  { x: -2 / 3, y: 2 / 3, z: -1 / 3 },
];
const solve = (p: Project) => {
  const input = exportOofem(p, "EL");
  return parseOofemOutput(runDeck(input.deck, bin!), input).panels!;
};
it("migra a v27, conserva IDs, material, orientação e ações por padrão", () => {
  const p = foldedPanels();
  expect(parseProject(serializeProject(p))).toEqual(p);
  const old = createProject("spatial");
  expect(parseProject(JSON.stringify({ ...old, schemaVersion: 27 }))).toEqual(
    old,
  );
  const m = panelAssembly(p);
  expect(m.shared).toHaveLength(5);
  expect(m.nodes).toHaveLength(2 * 9 * 5 - 5);
  const [wall, slab] = m.panels;
  expect(wall.edges.BC.map((i) => wall.ids[i])).toEqual(
    slab.edges.DA.map((i) => slab.ids[i]).reverse(),
  );
  p.surfacePanels![1].nv = 5;
  expect(analysisErrors(p).join(" ")).toMatch(/mesmo número/);
  p.surfacePanels![1].nv = 4;
  p.surfacePanels![1].a.z += 0.01;
  expect(analysisErrors(p).join(" ")).toMatch(/borda reta comum/);
  const degenerate = cantileverPanel();
  degenerate.surfacePanels![0].d = degenerate.surfacePanels![0].a;
  expect(() => parseProject(serializeProject(degenerate))).toThrow(/área/);
});
it("diagnostica carga incompatível, ausência de apoio e sobreposição", () => {
  const p = cantileverPanel("membrane");
  p.loadPatterns[0].panelActions![0].pressure = -400;
  expect(() => exportOofem(p, "EL")).toThrow(/direção de carga/);
  p.loadPatterns[0].panelActions = undefined;
  p.loadPatterns[0].selfWeight.enabled = true;
  expect(() => exportOofem(p, "EL")).toThrow(/peso próprio/);
  const q = cantileverPanel("plate");
  q.loadPatterns[0].panelActions![0].traction.y = 120;
  expect(() => exportOofem(q, "EL")).toThrow(/direção de carga/);
  q.surfacePanels![0].fixed = [];
  expect(analysisErrors(q).join(" ")).toContain("Engaste");
  const copy = { ...p.surfacePanels![0], id: "copy" };
  p.surfacePanels!.push(copy);
  expect(analysisErrors(p).join(" ")).toContain("sobrepõem");
});

it.skipIf(!bin)(
  "OOFEM · tração, flexão e superposição após rotação da faixa para XY, vertical e oblíqua",
  () => {
    for (const axes of [globalBasis, vertical, inclined]) {
      for (const kind of ["membrane", "plate", "shell"] as const) {
        const p = cantileverPanel(kind, axes);
        const r = solve(p),
          panel = r.panels[0],
          free = panel.nodes.filter((_, i) => i % 9 === 8);
        const u = kind === "plate" ? 0 : (100000 * 3) / (30e9 * 0.1);
        const w =
          kind === "membrane"
            ? 0
            : (-1000 * 3 ** 3) / (3 * ((30e9 * 0.1 ** 3) / 12));
        for (const node of free) {
          expect(Math.abs(node.local.x - u)).toBeLessThan(1e-9);
          expect(Math.abs(node.local.z - w)).toBeLessThan(1.6e-5);
        }
        const q1 = kind === "plate" ? 0 : 100000,
          q3 = kind === "membrane" ? 0 : -1000;
        expect(
          length(
            add(r.force, inGlobal({ x: q1 * 1.2, y: 0, z: q3 * 1.2 }, axes)),
          ),
        ).toBeLessThan(3);
        const m = inLocal(r.moment, axes);
        expect(Math.abs(m.y - q3 * 1.2 * 3)).toBeLessThan(2);
        for (const s of panel.samples) {
          if (kind !== "plate")
            expect(Math.abs(s.fields.nxx! - 100000)).toBeLessThan(12);
          else expect(s.fields.nxx).toBeUndefined();
        }
        if (kind !== "membrane") {
          const mean =
            panel.samples.reduce((s, v) => s + v.fields.mxx!, 0) /
            panel.samples.length;
          expect(Math.abs(mean - 1500)).toBeLessThan(15);
        } else expect(panel.samples[0].fields.mxx).toBeUndefined();
      }
    }
  },
);
it.skipIf(!bin)(
  "OOFEM · convergência da flecha e transferência entre parede e laje giradas",
  () => {
    const tip: number[] = [];
    for (const n of [2, 4, 8, 16]) {
      const p = cantileverPanel("plate", globalBasis, n);
      p.surfacePanels![0].nv = n / 2;
      const r = solve(p),
        centerline = r.panels[0].nodes.filter((_, i) => i % (n + 1) === n);
      const mean =
        centerline.reduce((s, v) => s + v.local.z, 0) / centerline.length;
      tip.push(Math.abs(mean + 0.0036));
      console.info("KS-44 · refinamento", n, n / 2, mean);
    }
    expect(tip.at(-1)!).toBeLessThan(tip[0] / 3);
    expect(tip.at(-1)!).toBeLessThan(2e-6);
    for (const axes of [globalBasis, inclined]) {
      const p = foldedPanels();
      for (const panel of p.surfacePanels!)
        for (const key of ["a", "b", "d"] as const)
          panel[key] = add({ x: 2, y: -4, z: 10 }, inGlobal(panel[key], axes));
      const r = solve(p),
        [wall, slab] = r.panels;
      expect(r.shared.length).toBe(5);
      expect(r.supportReactions.every((v) => !r.shared.includes(v.id))).toBe(
        true,
      );
      for (const id of r.shared) {
        expect(wall.nodes.find((n) => n.id === id)!.global).toEqual(
          slab.nodes.find((n) => n.id === id)!.global,
        );
      }
      expect(
        length(subtract(r.force, inGlobal({ x: 0, y: 0, z: 1200 }, axes))),
      ).toBeLessThan(0.08);
      expect(
        length(subtract(r.moment, inGlobal({ x: 720, y: -3600, z: 0 }, axes))),
      ).toBeLessThan(0.35);
      expect(wall.samples.some((v) => v.fields.nxx! < -900)).toBe(true);
      expect(slab.nodes[8].local.z).toBeLessThan(-0.013);
    }
  },
);
it("identifica a liberdade de girar do painel sustentado apenas por uma membrana", () => {
  const p = foldedPanels();
  p.surfacePanels![0].kind = "membrane";
  expect(analysisErrors(p).join(" ")).toContain("movimento de corpo rígido");
});
it.skipIf(!bin)(
  "OOFEM · placa em flexão ligada a uma parede de casca transfere a resultante",
  () => {
    const p = foldedPanels();
    p.surfacePanels![1].kind = "plate";
    const r = solve(p);
    expect(r.panels[1].samples[0].fields.nxx).toBeUndefined();
    expect(r.force.z).toBeCloseTo(1200, 0);
    expect(r.moment.y).toBeCloseTo(-3600, 0);
    expect(r.panels[1].nodes[8].local.z).toBeLessThan(-0.013);
  },
);
it.skipIf(!bin)(
  "OOFEM · pressão, peso próprio e fatores do caso na normal global",
  () => {
    const p = cantileverPanel("shell", inclined);
    const a = p.loadPatterns[0].panelActions![0];
    a.traction = { ...origin };
    a.pressure = -1400;
    p.loadPatterns[0].selfWeight.enabled = true;
    p.loadPatterns[0].selfWeight.gravity = 10;
    p.analysisCases[0].factors[0].factor = 1.3;
    const r = solve(p);
    const applied = scale(
      add(scale(inclined[2], -1400), { x: 0, y: 0, z: -2500 }),
      3 * 1.2 * 1.3,
    );
    expect(length(subtract(applied, r.applied))).toBeLessThan(1e-8);
    expect(length(add(applied, r.force))).toBeLessThan(0.7);
  },
);
it.skipIf(!bin)(
  "rejeita tensor truncado, GL ou reação faltante e perda de equilíbrio",
  () => {
    const p = cantileverPanel("shell"),
      input = exportOofem(p, "EL"),
      raw = runDeck(input.deck, bin!);
    expect(() =>
      parseOofemOutput(raw.replace(/moments +[^\n]+/, "moments 0 0"), input),
    ).toThrow(/Tensor/);
    expect(() =>
      parseOofemOutput(raw.replace(/dof 1   d [^\n]+/, ""), input),
    ).toThrow(/Deslocamento/);
    expect(() =>
      parseOofemOutput(
        raw.replace(/Node\s+1\s+iDof\s+1\s+reaction\s+\S+/, ""),
        input,
      ),
    ).toThrow(/Reação/);
    expect(() =>
      parseOofemOutput(
        raw.replace(/(Node\s+1\s+iDof\s+1\s+reaction\s+)\S+/, "$1 1e8"),
        input,
      ),
    ).toThrow(/equilíbrio/);
  },
);
