import { describe, expect, it } from "vitest";
import { stagedMembers } from "../src/domain/duplicateGeometry";
import { noRepairs, planRepair } from "../src/domain/duplicateRepair";
import { planTransform } from "../src/domain/transform";
import { reverseMember } from "../src/domain/editing";
import { planMemberEdit } from "../src/domain/memberOperations";
import {
  parseProject,
  referenceErrors,
  removeSelection,
  serializeProject,
  type Project,
} from "../src/domain/model";
import { defaultGeometry } from "../src/domain/sections";
import {
  emptyThermal,
  sectionExtents,
  setThermalField,
} from "../src/domain/thermalLoads";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { windColumn, facade } from "./fixtures/wind-column";
import { thermalBeam } from "./fixtures/thermal-beam";
import { runDeck } from "./fixtures/solve-oofem";

const binary = process.env.OOFEM_BIN;
function solve(p: Project) {
  const input = exportOofem(p, "EL");
  return parseOofemOutput(runDeck(input.deck, binary!), input);
}
function mid(p: Project) {
  return solve(p).members.V1.find((s) => Math.abs(s.t - 0.5) < 1e-10)!;
}

it("migra v20 preservando o modelo, valida o padrão e limpa referências ao apagar", () => {
  const p = thermalBeam();
  expect(parseProject(JSON.stringify({ ...p, schemaVersion: 20 }))).toEqual(p);
  const f = { memberId: "V1", uniform: 20, deltaY: 0, deltaZ: 10 };
  setThermalField(p.loadPatterns[0], f);
  expect(parseProject(serializeProject(p))).toEqual(p);
  const pattern = p.loadPatterns[0];
  pattern.thermal!.push(f);
  expect(referenceErrors(p)).toEqual(
    expect.arrayContaining([expect.stringMatching(/repetida/)]),
  );
  pattern.thermal = [{ ...f, memberId: "inexistente" }];
  expect(referenceErrors(p).join(" ")).toMatch(/inexistente/);
  pattern.thermal = [{ ...f, deltaY: 1 }];
  expect(() => exportOofem(p, "EL")).toThrow(/espacial/);
  pattern.thermal = [f];
  removeSelection(p, [{ kind: "node", id: "A" }]);
  expect(pattern.thermal).toEqual([]);
  expect(referenceErrors(p)).toEqual([]);
});

it("usa as dimensões externas das quatro seções e o campo fatorado da barra física", () => {
  expect(sectionExtents(defaultGeometry.rectangle)).toEqual({
    width: 0.15,
    height: 0.2,
  });
  expect(sectionExtents(defaultGeometry.circle)).toEqual({
    width: 0.1,
    height: 0.1,
  });
  expect(sectionExtents(defaultGeometry.tube)).toEqual({
    width: 0.1,
    height: 0.1,
  });
  expect(sectionExtents(defaultGeometry.i)).toEqual({
    width: 0.1,
    height: 0.2,
  });
  const p = thermalBeam("spatial", 20, 10, 2);
  const k = structuredClone(p.loadPatterns[0]);
  k.id = "T2";
  p.loadPatterns.push(k);
  p.analysisCases[0].factors.push({ patternId: "T2", factor: -0.5 });
  const input = exportOofem(p, "EL");
  expect(input.deck.match(/StructTemperatureLoad/g)).toHaveLength(1);
  const match = input.deck.match(
    /StructTemperatureLoad .* Components 3 10 5 -1 set (\d+)/,
  )!;
  expect(input.deck).toContain(`Set ${match[1]} elements 8 1 2 3 4 5 6 7 8`);
  expect(input.deck).toMatch(/thick 0.2 width 0.005/);
  p.analysisCases[0].factors[1].factor = -1;
  expect(exportOofem(p, "EL").deck).not.toMatch(/StructTemperatureLoad/);
  p.analysisCases[0].factors[1].factor = 0;
  expect(exportOofem(p, "EL").deck).toMatch(/Components 3 20 10 -2/);
  p.analysisCases[0].factors[0].factor = Number.MAX_VALUE;
  expect(() => exportOofem(p, "EL")).toThrow(/intervalo numérico/);
});

it("conserva o campo físico ao inverter, dividir e reunir barras e recusa trechos de temperatura diferente", () => {
  const p = thermalBeam("planar", 4, 10);
  const q = planMemberEdit(p, {
    kind: "split",
    id: "V1",
    reference: { kind: "distance", metres: 2 },
  }).project;
  const ids = q.members.map((m) => m.id);
  expect(q.loadPatterns[0].thermal?.map((f) => f.deltaZ)).toEqual([10, 10]);
  reverseMember(q, ids[1]);
  expect(q.loadPatterns[0].thermal?.map((f) => f.deltaZ)).toEqual([10, -10]);
  const joined = planMemberEdit(q, { kind: "join", ids }).project;
  expect(joined.loadPatterns[0].thermal).toEqual(p.loadPatterns[0].thermal);
  setThermalField(q.loadPatterns[0], emptyThermal(ids[1]));
  expect(() => planMemberEdit(q, { kind: "join", ids })).toThrow(
    /mesma variação/,
  );
});

it("espelha a face quente no espaço respeitando os padrões escolhidos", () => {
  const p = thermalBeam("spatial", 2, 5, 3);
  const spec = {
    kind: "mirror" as const,
    center: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
  };
  for (const patterns of [[], ["G"]]) {
    const plan = planTransform(p, [{ kind: "member", id: "V1" }], spec, {
      supports: false,
      patterns,
      conflicts: "ask",
    });
    const fields = plan.project.loadPatterns[0].thermal!;
    expect(fields).toHaveLength(patterns.length ? 2 : 1);
    if (patterns.length)
      expect(fields[1]).toEqual({
        memberId: plan.maps[0].members.get("V1"),
        uniform: 2,
        deltaZ: 5,
        deltaY: -3,
      });
  }
});

it("conserva um único campo físico em duplicatas e permite escolher entre ações térmicas diferentes", () => {
  const p = thermalBeam("planar", 0, 10);
  p.members.push({
    ...p.members[0],
    id: "V2",
    name: "B2",
    start: "B",
    end: "A",
  });
  const pattern = p.loadPatterns[0];
  setThermalField(pattern, { ...emptyThermal("V2"), deltaZ: -10 });
  const decisions = noRepairs();
  decisions.members = [{ drop: "V2", keep: "V1" }];
  const plan = () => planRepair(stagedMembers(p, 0.001, []), decisions);
  expect(plan().project?.loadPatterns[0].thermal).toEqual([
    { ...emptyThermal("V1"), deltaZ: 10 },
  ]);
  pattern.thermal![1].deltaZ = 4;
  const choice = plan().questions.find((q) =>
    q.title.includes("Ação térmica"),
  )!;
  decisions.answers[choice.key] = "use:V2";
  expect(plan().project?.loadPatterns[0].thermal).toEqual([
    { ...emptyThermal("V1"), deltaZ: -4 },
  ]);
});

it("migra um arquivo v21 com vento e conserva as duas ações no formato v22", () => {
  const column = windColumn();
  column.loadPatterns[0].wind = [structuredClone(facade)];
  const migrated = parseProject(
    JSON.stringify({ ...column, schemaVersion: 21 }),
  );
  expect(migrated).toEqual(column);
  setThermalField(migrated.loadPatterns[0], {
    ...emptyThermal("V1"),
    uniform: 20,
  });
  const reopened = parseProject(serializeProject(migrated));
  expect(reopened.loadPatterns[0].wind).toEqual([facade]);
  expect(reopened.loadPatterns[0].thermal).toEqual([
    { ...emptyThermal("V1"), uniform: 20 },
  ]);
});

describe.skipIf(!binary)("OOFEM 3.0 · ação térmica", () => {
  for (const mode of ["planar", "spatial"] as const) {
    it(`${mode}: 1,2 mm livres e 48 kN de compressão com as duas pontas impedidas`, () => {
      const p = thermalBeam(mode, 20);
      let r = solve(p);
      expect(r.displacements.B.ux).toBeCloseTo(0.0012, 10);
      expect(r.members.V1.every((s) => Math.abs(s.n) < 1e-5)).toBe(true);
      p.nodes[1].restraints.ux = true;
      r = solve(p);
      expect(r.members.V1.every((s) => Math.abs(s.n + 48000) < 0.01)).toBe(
        true,
      );
      expect(r.reactions.map((a) => a.fx).sort((a, b) => a - b)).toEqual([
        -48000, 48000,
      ]);
    });
    it(`${mode}: curvatura, inversão de faces, inversão i/j e independência da malha`, () => {
      const p = thermalBeam(mode, 0, 10);
      for (const segments of [2, 8]) {
        p.mesh.segmentsPerMember = segments;
        const r = solve(p),
          curve = (r.displacements.B.ry - r.displacements.A.ry) / 5;
        expect(curve).toBeCloseTo(0.0006, 10);
        expect(r.members.V1.find((s) => s.t === 0.5)!.uz).toBeCloseTo(
          0.001875,
          10,
        );
        expect(r.members.V1.every((s) => Math.abs(s.my) < 1e-5)).toBe(true);
      }
      reverseMember(p, "V1");
      expect(mid(p).uz).toBeCloseTo(0.001875, 10);
      p.loadPatterns[0].thermal![0].deltaZ *= -1;
      expect(mid(p).uz).toBeCloseTo(-0.001875, 10);
    });
  }
  it("segue a face +y no espaço, inclusive ao inverter i/j e ao girar a seção 90°", () => {
    const p = thermalBeam("spatial", 0, 0, 0.25);
    expect(mid(p).uy).toBeCloseTo(0.001875, 10);
    reverseMember(p, "V1");
    expect(p.loadPatterns[0].thermal![0].deltaY).toBe(-0.25);
    expect(mid(p).uy).toBeCloseTo(0.001875, 10);
    const q = thermalBeam("spatial", 0, 10);
    q.members[0].roll = 90;
    expect(mid(q).uy).toBeCloseTo(-0.001875, 10);
    expect(mid(q).uz).toBeCloseTo(0, 10);
  });
  it("sobrepõe padrões e mantém as dimensões físicas ao modificar a rigidez", () => {
    const p = thermalBeam("planar", 20, 10);
    const k = structuredClone(p.loadPatterns[0]);
    k.id = "T2";
    p.loadPatterns.push(k);
    p.analysisCases[0].factors.push({ patternId: "T2", factor: -0.5 });
    p.members[0].stiffness = { eiy: 0.4 };
    const r = solve(p);
    expect(r.displacements.B.ux).toBeCloseTo(0.0006, 10);
    expect(r.members.V1.find((s) => s.t === 0.5)!.uz).toBeCloseTo(
      0.0009375,
      10,
    );
  });
  it("combina o vento e a temperatura na mesma coluna após reabrir", () => {
    const p = windColumn();
    p.loadPatterns[0].wind = [structuredClone(facade)];
    p.materials[0].alpha = 12e-6;
    setThermalField(p.loadPatterns[0], { ...emptyThermal("V1"), uniform: 20 });
    const r = solve(parseProject(serializeProject(p)));
    const base = r.reactions.find((a) => a.nodeId === "A")!;
    expect(base.fx).toBeCloseTo(-12000, 1);
    expect(base.my).toBeCloseTo(-18000, 1);
    expect(r.displacements.B.uz).toBeCloseTo(0.00072, 10);
  });
  it("aquece apenas o vão deformável entre as duas faces rígidas", () => {
    const p = thermalBeam("planar", 20);
    const end = { rigidLength: 0.5, eccentricity: { x: 0, y: 0, z: 0 } };
    p.members[0].offsets = { i: end, j: { ...end } };
    const r = solve(p);
    expect(r.displacements.B.ux).toBeCloseTo(0.00096, 10);
    expect(r.members.V1.every((s) => Math.abs(s.n) < 1e-5)).toBe(true);
  });
  it("temperatura ou coeficiente nulo produz resposta nula", () => {
    for (const p of [thermalBeam("planar", 0), thermalBeam("planar", 20, 10)]) {
      if (p.loadPatterns[0].thermal) p.materials[0].alpha = 0;
      const r = solve(p);
      for (const s of r.members.V1)
        expect([s.ux, s.uz, s.n, s.my].every((v) => Math.abs(v) < 1e-9)).toBe(
          true,
        );
    }
  });
});
