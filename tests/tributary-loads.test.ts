import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addSlab,
  addPolygonSlab,
  newSlabRing,
  reverseMember,
  splitMembers,
} from "../src/domain/editing";
import {
  parseProject,
  serializeProject,
  referenceErrors,
  type Project,
} from "../src/domain/model";
import {
  distributeLoadPanel,
  loadPanelErrors,
  tributaryProfiles,
} from "../src/domain/loadPanel";
import { planMemberEdit } from "../src/domain/memberOperations";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { combineLinearResults } from "../src/solver/combinations";
import { runDeck } from "./fixtures/solve-oofem";

const source = readFileSync(
  "examples/portico-painel-de-carga.kstruct.json",
  "utf8",
);
const frame = () => parseProject(source);
const shares = (p: Project) => distributeLoadPanel(p, p.loadPanels![0]).shares;
const numerical = it.skipIf(!process.env.OOFEM_BIN);
function solve(p: Project, id = "EL") {
  const input = exportOofem(p, id);
  return parseOofemOutput(runDeck(input.deck, process.env.OOFEM_BIN!), input);
}
function fixedPerimeter() {
  const p = frame();
  const fixed = p.nodes[0].restraints;
  p.nodes = p.nodes.filter((n) => n.z === 3);
  p.members = p.members.filter((m) => m.id.startsWith("V"));
  for (const n of p.nodes) n.restraints = { ...fixed };
  return p;
}
function extraNode(p: Project, id: string, x: number, y: number) {
  const node = { ...p.nodes.find((n) => n.id === "A")!, id, name: id, x, y };
  p.nodes.push(node);
  return node;
}
function extraBeam(p: Project, id: string, start: string, end: string) {
  p.members.push({ ...p.members[0], id, name: id, start, end });
}
function adjacentPanel(p: Project) {
  extraNode(p, "E", 12, 0);
  extraNode(p, "F", 12, 4);
  extraBeam(p, "V5", "B", "E");
  extraBeam(p, "V6", "E", "F");
  extraBeam(p, "V7", "F", "C");
  p.loadPanels!.push({
    ...p.loadPanels![0],
    id: "PC2",
    name: "PC2",
    a: "B",
    b: "E",
    d: "C",
  });
  p.loadPatterns[0].tributaryLoads!.push({
    ...p.loadPatterns[0].tributaryLoads![0],
    panelId: "PC2",
  });
}
describe("KS-47 · transferência de carga do painel às vigas", () => {
  it("divide o retângulo em triângulos e trapézios e confere ambas as direções de vão", () => {
    const p = frame(),
      panel = p.loadPanels![0];
    const rows = () => shares(p).map((s) => [s.side, s.memberId, s.area]);
    expect(rows()).toEqual([
      ["AB", "V1", 8],
      ["BC", "V2", 4],
      ["CD", "V3", 8],
      ["DA", "V4", 4],
    ]);
    const densities = tributaryProfiles(p).get("G")!;
    expect(
      densities
        .filter((l) => l.memberId === "V1")
        .map((l) => [l.start * 6, l.end * 6, l.qStart.z, l.qEnd.z]),
    ).toEqual([
      [0, 2, -0, -10000],
      [2, 4, -10000, -10000],
      [4, 6, -10000, -0],
    ]);
    expect(
      densities
        .filter((l) => l.memberId === "V2")
        .map((l) => [l.qStart.z, l.qEnd.z]),
    ).toEqual([
      [-0, -10000],
      [-10000, -0],
    ]);
    panel.distribution = "spanAB";
    expect(rows()).toEqual([
      ["BC", "V2", 12],
      ["DA", "V4", 12],
    ]);
    p.members = p.members.filter((m) => m.id !== "V1" && m.id !== "V3");
    expect(loadPanelErrors(p)).toEqual([]);
    expect(
      tributaryProfiles(p)
        .get("G")!
        .map((l) => l.qStart.z),
    ).toEqual([-15000, -15000]);
    const other = frame();
    other.loadPanels![0].distribution = "spanAD";
    expect(shares(other).map((s) => [s.side, s.area])).toEqual([
      ["AB", 12],
      ["CD", 12],
    ]);
    expect(
      tributaryProfiles(other)
        .get("G")!
        .map((l) => l.qEnd.z),
    ).toEqual([-10000, -10000]);
  });
  it("conserva as parcelas no quadrado girado em planta e com o contorno em sentido inverso", () => {
    const p = frame();
    for (const n of p.nodes) {
      const x = (n.x * 2) / 3,
        y = n.y,
        theta = 0.37;
      n.x = 11 + x * Math.cos(theta) - y * Math.sin(theta);
      n.y = -7 + x * Math.sin(theta) + y * Math.cos(theta);
    }
    const panel = p.loadPanels![0];
    [panel.b, panel.d] = [panel.d, panel.b];
    expect(loadPanelErrors(p)).toEqual([]);
    for (const s of shares(p)) {
      expect(s.area).toBeCloseTo(4, 10);
      expect(
        Math.max(...s.segments.flatMap((v) => [v.widthStart, v.widthEnd])),
      ).toBeCloseTo(2, 10);
    }
  });
  it("identifica as vigas divididas, invertidas ou mais compridas que a borda", () => {
    const p = frame();
    extraNode(p, "M", 1, 0);
    const children = splitMembers(p, new Map([["V1", ["M"]]])).get("V1")!;
    reverseMember(p, children[0]);
    const [left, right] = shares(p).filter((v) => v.side === "AB");
    expect([left.memberId, right.memberId]).toEqual(children);
    expect([left.area, right.area]).toEqual([0.5, 7.5]);
    expect(left.segments[0]).toMatchObject({
      start: 0,
      end: 1,
      widthStart: 1,
      widthEnd: 0,
    });
    const long = frame();
    extraNode(long, "E", -1, 0);
    extraNode(long, "F", 7, 0);
    Object.assign(long.members[0], { start: "F", end: "E" });
    const s = shares(long).find((s) => s.side === "AB")!;
    expect(s.area).toBe(8);
    expect(s.segments.map((v) => [v.start * 8, v.end * 8])).toEqual([
      [1, 3],
      [3, 5],
      [5, 7],
    ]);
  });
  it("preserva o nó usado como canto ao unir duas peças da mesma linha de apoio", () => {
    const p = frame();
    p.loadPanels![0].distribution = "spanAD";
    p.members = p.members.filter(
      (m) =>
        !["V4", "P1"].includes(m.id) && !(m.start === "A0" || m.end === "A0"),
    );
    p.nodes = p.nodes.filter((n) => n.id !== "A0");
    extraNode(p, "E", -1, 0);
    extraBeam(p, "V5", "E", "A");
    const result = planMemberEdit(p, {
      kind: "join",
      ids: ["V1", "V5"],
    }).project;
    expect(result.nodes.some((n) => n.id === "A")).toBe(true);
    expect(result.meshConnections).toContainEqual({
      nodeId: "A",
      memberId: "V1",
    });
    expect(shares(result).map((s) => s.area)).toEqual([12, 12]);
  });
  it("recusa lacuna, duas receptoras no mesmo trecho e geometria inválida", () => {
    const p = frame(),
      panel = p.loadPanels![0];
    const v = p.members.shift()!;
    expect(loadPanelErrors(p).join(" ")).toMatch(/Borda AB sem viga/);
    p.members.push(v, { ...v, id: "outra" });
    expect(loadPanelErrors(p).join(" ")).toMatch(/sobrepostas na borda AB/);
    panel.d = "C";
    expect(loadPanelErrors(p).join(" ")).toMatch(/retângulo/);
    panel.d = "D0";
    expect(loadPanelErrors(p).join(" ")).toMatch(/mesma cota/);
    panel.d = "inexistente";
    expect(loadPanelErrors(p).join(" ")).toMatch(/três nós/);
  });
  it("distingue laje no mesmo pavimento, borda comum, outra cota e abertura", () => {
    const p = frame();
    const rect = (x: number, y: number, w: number, h: number) =>
      newSlabRing(
        [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
        false,
      );
    const slab = addSlab(
      p,
      "level1",
      { x: 5, y: 1, z: 3 },
      { x: 7, y: 2, z: 3 },
    );
    expect(loadPanelErrors(p).join(" ")).toMatch(/laje resistente/);
    slab.x = 6;
    expect(loadPanelErrors(p)).toEqual([]);
    slab.x = 5;
    slab.levelId = "base";
    expect(loadPanelErrors(p)).toEqual([]);
    p.slabs = [];
    addPolygonSlab(p, "level1", [rect(-2, -2, 10, 8), rect(-0.5, -0.5, 7, 5)]);
    expect(loadPanelErrors(p)).toEqual([]);
    p.slabs[0].polygon!.rings[1] = rect(0.25, -0.5, 6.5, 5);
    expect(loadPanelErrors(p).join(" ")).toMatch(/laje resistente/);
    p.slabs = [];
    const roof = parseProject(
      readFileSync("examples/cobertura-direcional.kstruct.json", "utf8"),
    ).surfacePanels![0];
    p.surfacePanels = [
      {
        ...roof,
        a: { x: 2, y: -1, z: 3 },
        b: { x: 3, y: -1, z: 3 },
        d: { x: 2, y: 6, z: 3 },
      },
    ];
    expect(loadPanelErrors(p).join(" ")).toMatch(/painel resistente/);
    p.surfacePanels[0].d.z = 6;
    expect(loadPanelErrors(p)).toEqual([]);
  });
  it("permite somar painéis lado a lado na viga comum e bloqueia a duplicação sobre a mesma área", () => {
    const p = fixedPerimeter();
    adjacentPanel(p);
    expect(loadPanelErrors(p)).toEqual([]);
    const shared = p.loadPanels!.map(
      (panel) =>
        distributeLoadPanel(p, panel).shares.find((s) => s.memberId === "V2")!,
    );
    expect(shared.map((s) => s.area)).toEqual([4, 4]);
    Object.assign(p.loadPanels![1], { a: "A", b: "B", d: "D" });
    expect(loadPanelErrors(p).join(" ")).toMatch(/se sobrepõe ao painel/);
  });
  it("migra a v30, rejeita ações órfãs e mantém uma única fonte de carga no arquivo editável", () => {
    const p = frame(),
      saved = serializeProject(p);
    const deck = exportOofem(p, "EL").deck;
    expect(exportOofem(p, "EL").deck).toBe(deck);
    expect(serializeProject(p)).toBe(saved);
    expect(parseProject(saved)).toEqual(p);
    delete p.loadPanels;
    expect(referenceErrors(p).join(" ")).toMatch(/sem painel/);
    delete p.loadPatterns[0].tributaryLoads;
    expect(parseProject(JSON.stringify({ ...p, schemaVersion: 30 }))).toEqual(
      p,
    );
  });
  numerical(
    "equilibra o pórtico com quatro pilares e confere esforços analíticos de vigas biengastadas em três malhas",
    () => {
      const p = frame();
      for (const mode of ["twoWay", "spanAB", "spanAD"] as const) {
        p.loadPanels![0].distribution = mode;
        const reactions = solve(p).reactions;
        expect(reactions.map((r) => r.fz)).toEqual([
          30000, 30000, 30000, 30000,
        ]);
        let mx = 0,
          my = 0;
        for (const r of reactions) {
          const base = p.nodes.find((n) => n.id === r.nodeId)!;
          mx += r.mx + base.y * r.fz;
          my += r.my - base.x * r.fz;
        }
        expect(Math.abs(mx - 240000)).toBeLessThan(1);
        expect(Math.abs(my + 360000)).toBeLessThan(1);
      }
      const fixed = fixedPerimeter();
      // Local My and Vz follow the member convention. Units are N and N·m.
      for (const divisions of [2, 8, 16]) {
        fixed.mesh.segmentsPerMember = divisions;
        const r = solve(fixed);
        for (const [id, shear, atEnd, atCenter] of [
          ["V1", 20000, 220000 / 9, -125000 / 9],
          ["V2", 10000, 25000 / 3, -5000],
        ] as const) {
          const ends = r.members[id],
            mid = ends.find((v) => v.t === 0.5)!;
          expect(Math.abs(ends[0].vz + shear)).toBeLessThan(1);
          expect(Math.abs(ends[0].my - atEnd)).toBeLessThan(1);
          expect(Math.abs(mid.my - atCenter)).toBeLessThan(1);
        }
      }
    },
  );
  numerical("superpõe sobre a viga comum a carga de cada painel", () => {
    const p = fixedPerimeter();
    adjacentPanel(p);
    const r = solve(p);
    expect(r.reactions.reduce((v, n) => v + n.fz, 0)).toBe(240000);
    expect(
      r.reactions.filter((n) => ["B", "C"].includes(n.nodeId)).map((n) => n.fz),
    ).toEqual([60000, 60000]);
    expect(r.members.V2[0].vz).toBe(-20000);
  });
  numerical(
    "combina direções, carga manual e fatores com a mesma malha dos casos isolados",
    () => {
      const p = frame(),
        g = p.loadPatterns[0];
      const q = structuredClone(g);
      q.id = "Q";
      q.name = "Outra ação";
      q.tributaryLoads![0] = { panelId: "PC1", axis: "X", pressure: 2500 };
      q.uniform.push({ memberId: "V1", qx: 0, qy: 0, qz: -1000 });
      p.loadPatterns.push(q);
      p.analysisCases.push(
        {
          ...p.analysisCases[0],
          id: "Q1",
          factors: [{ patternId: "Q", factor: 1 }],
        },
        {
          ...p.analysisCases[0],
          id: "MIX",
          factors: [
            { patternId: "G", factor: 0.5 },
            { patternId: "Q", factor: -1 },
          ],
        },
      );
      const combo = {
        id: "C",
        name: "C",
        type: "linear" as const,
        factors: [
          { caseId: "EL", factor: 0.5 },
          { caseId: "Q1", factor: -1 },
        ],
      };
      p.resultCombinations = [combo];
      const r = solve(p, "MIX"),
        isolated = new Map([
          ["EL", solve(p)],
          ["Q1", solve(p, "Q1")],
        ]);
      const combined = combineLinearResults(p, combo, isolated);
      expect(
        Math.abs(r.reactions.reduce((v, n) => v + n.fx, 0) - 60000),
      ).toBeLessThan(2);
      expect(
        Math.abs(r.reactions.reduce((v, n) => v + n.fz, 0) - 54000),
      ).toBeLessThan(2);
      for (const [i, v] of r.members.V1.entries()) {
        expect(combined.members.V1[i].t).toEqual(v.t);
        expect(Math.abs(combined.members.V1[i].my - v.my)).toBeLessThan(2);
      }
    },
  );
});
