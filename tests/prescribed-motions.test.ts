import { legacyPatterns } from "./fixtures/project-v8";
import { describe, expect, it } from "vitest";
import {
  parseProject,
  referenceErrors,
  serializeProject,
  type Project,
} from "../src/domain/model";
import { buildResultCsv, buildResultTable } from "../src/components/Results";
import {
  caseMotions,
  combinationMotions,
  transformMotions,
} from "../src/domain/prescribedMotions";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { settlementBeam } from "./fixtures/settlement";

const binary = process.env.OOFEM_BIN;
function solve(p: Project) {
  const input = exportOofem(p, "EL");
  return parseOofemOutput(runDeck(input.deck, binary!), input);
}

it("migra v18 sem mudar os IDs e rejeita prescrições duplicadas, livres, elásticas ou fora do plano", () => {
  const p = settlementBeam();
  delete p.loadPatterns[0].prescribed;
  expect(
    parseProject(
      JSON.stringify({
        ...p,
        schemaVersion: 18,
        loadPatterns: legacyPatterns(p),
      }),
    ),
  ).toEqual(p);
  const motions = [{ nodeId: "B", dof: "uz" as const, value: -0.004 }];
  p.loadPatterns[0].prescribed = motions;
  expect(parseProject(serializeProject(p))).toEqual(p);
  motions.push({ ...motions[0] });
  expect(referenceErrors(p).join(" ")).toMatch(/repetido/);
  motions.pop();
  p.nodes[1].restraints.uz = false;
  expect(referenceErrors(p).join(" ")).toMatch(/restrição rígida/);
  p.nodes[1].springs = { uz: 1e6 };
  expect(() => exportOofem(p, "EL")).toThrow(/restrição rígida/);
  p.loadPatterns[0].prescribed = [{ nodeId: "B", dof: "uy", value: 0.01 }];
  expect(referenceErrors(p).join(" ")).toMatch(/fora do plano/);
});
it("soma movimentos por padrão, caso e combinação, incluindo o fator zero", () => {
  const p = settlementBeam(),
    pattern = p.loadPatterns[0];
  p.loadPatterns.push({
    ...structuredClone(pattern),
    id: "H",
    name: "Positivo",
    prescribed: [{ nodeId: "B", dof: "uz", value: 0.001 }],
  });
  p.analysisCases[0].factors.push({ patternId: "H", factor: 2 });
  p.analysisCases.push({
    ...p.analysisCases[0],
    id: "Z",
    factors: [
      { patternId: "G", factor: 0 },
      { patternId: "H", factor: -1 },
    ],
  });
  expect(caseMotions(p, p.analysisCases[1]).get("B")?.uz).toBe(-0.001);
  const combo = {
    id: "K",
    name: "Recalque combinado",
    type: "linear" as const,
    factors: [
      { caseId: "EL", factor: 2 },
      { caseId: "Z", factor: -1 },
    ],
  };
  expect(combinationMotions(p, combo).get("B")?.uz).toBe(-0.003);
  const bcs = exportOofem(p, "EL")
    .deck.split("\n")
    .filter((l) => l.startsWith("BoundaryCondition"));
  expect(bcs).toHaveLength(3);
  expect(bcs[1]).toContain("dofs 1 3 values 1 -0.002");
  const result = {
    displacements: { B: { ux: 0, uy: 0, uz: -0.003, rx: 0, ry: 0, rz: 0 } },
    reactions: [],
    members: {},
  };
  const view = {
    kind: "combination" as const,
    definition: combo,
    result,
    problem: "",
  };
  const table = buildResultTable(
    p,
    "displacements",
    result,
    "",
    undefined,
    view,
  );
  expect(table.rows[0][table.headers.indexOf("UZ imposto no apoio (mm)")]).toBe(
    -3,
  );
  expect(buildResultCsv(p, view, "displacements")).toContain(
    "Recalque combinado",
  );
});
it("espelha o sinal axial da rotação e transforma translações para a base do destino", () => {
  const rows = transformMotions(
    [
      { nodeId: "A", dof: "ry", value: 0.001 },
      { nodeId: "A", dof: "ux", value: 0.002 },
    ],
    "B",
    undefined,
    undefined,
    (v) => ({ ...v, x: -v.x }),
    -1,
  );
  expect(rows).toContainEqual({ nodeId: "B", dof: "ry", value: -0.001 });
  expect(rows).toContainEqual({ nodeId: "B", dof: "ux", value: -0.002 });
});
describe.skipIf(!binary)("KS-31 · movimentos impostos no OOFEM 3.0", () => {
  it.each([2, 9])(
    "recalque diferencial com %i elementos por vão",
    (segments) => {
      const p = settlementBeam();
      p.mesh.segmentsPerMember = segments;
      const r = solve(p);
      expect(r.displacements.B.uz).toBeCloseTo(-0.004, 12);
      const rz = r.reactions.map((v) => v.fz);
      for (const [i, expected] of [5625, -11250, 5625].entries())
        expect(Math.abs(rz[i] - expected)).toBeLessThan(0.1);
      expect(Math.abs(rz.reduce((a, b) => a + b, 0))).toBeLessThan(0.1);
      for (const m of [r.members.V1.at(-1)!.m, r.members.V2[0].m])
        expect(Math.abs(m - 22500)).toBeLessThan(0.1);
    },
  );
  it("translação conjunta produz deslocamento de corpo rígido", () => {
    const p = settlementBeam();
    p.loadPatterns[0].prescribed = p.nodes.map((n) => ({
      nodeId: n.id,
      dof: "uz",
      value: -0.004,
    }));
    const r = solve(p);
    for (const s of Object.values(r.members).flat()) {
      expect(s.uz).toBeCloseTo(-0.004, 12);
      for (const a of [s.n, s.v, s.m]) expect(Math.abs(a)).toBeLessThan(1e-5);
    }
    for (const a of r.reactions) expect(Math.abs(a.fz)).toBeLessThan(1e-5);
  });
  it("rotação imposta recupera os dois momentos da matriz de rigidez", () => {
    const p = settlementBeam();
    p.nodes.pop();
    p.members.pop();
    for (const n of p.nodes) n.restraints.ry = true;
    const theta = 0.001,
      EI = 30e6,
      L = 4;
    p.loadPatterns[0].prescribed = [{ nodeId: "A", dof: "ry", value: theta }];
    const r = solve(p);
    expect(r.displacements.A.ry).toBeCloseTo(theta, 12);
    expect(r.displacements.B.ry).toBe(0);
    expect(Math.abs(r.reactions[0].my - (4 * EI * theta) / L)).toBeLessThan(
      0.1,
    );
    expect(Math.abs(r.reactions[1].my - (2 * EI * theta) / L)).toBeLessThan(
      0.1,
    );
    expect(
      Math.abs(r.reactions[0].fz + (6 * EI * theta) / L ** 2),
    ).toBeLessThan(0.1);
  });
  it("confere a saída local do apoio inclinado e recupera a translação global", () => {
    const p = settlementBeam();
    for (const n of p.nodes) {
      n.supportFrame = { kind: "planar", angle: 30 };
      n.restraints.ux = true;
    }
    p.loadPatterns[0].prescribed = p.nodes.map((n) => ({
      nodeId: n.id,
      dof: "uz",
      value: -0.004,
    }));
    const input = exportOofem(p, "EL"),
      raw = runDeck(input.deck, binary!);
    const r = parseOofemOutput(raw, input);
    for (const d of Object.values(r.displacements)) {
      expect(d.ux).toBeCloseTo(0.002, 11);
      expect(d.uz).toBeCloseTo(-0.004 * Math.cos(Math.PI / 6), 11);
    }
    const corrupt = raw.replace(
      /(dof\s+3\s+d\s+)-4\.0+e-03/i,
      "$1-9.00000000e-03",
    );
    expect(corrupt).not.toBe(raw);
    expect(() => parseOofemOutput(corrupt, input)).toThrow(/prescrição/);
  });
});
