import { rectangle } from "./fixtures/project-v8";
import { describe, expect, it } from "vitest";
import {
  addPoint,
  beamExample,
  createProject,
  free,
  nodalLoad,
  parseProject,
  referenceErrors,
  serializeProject,
  uniformLoad,
  type Project,
} from "../src/domain/model";
import { addMember } from "../src/domain/editing";
import { origin } from "../src/domain/geometry";
import { nearNodes, stagedMembers } from "../src/domain/duplicateGeometry";
import {
  noRepairs,
  planRepair,
  type Decisions,
} from "../src/domain/duplicateRepair";

function plan(p: Project, d: Decisions) {
  return planRepair(stagedMembers(p, 0.001, d.nodes), d);
}
function fixture() {
  const p = beamExample();
  p.nodes.push({
    ...p.nodes[0],
    id: "C",
    name: "Cópia A",
    x: 0.0004,
    restraints: { ...free(), ry: true },
  });
  p.sections.push({
    ...rectangle(p.sections[0]),
    id: "rect2",
    name: "Outra seção",
    height: 0.4,
  });
  p.members.push({
    ...p.members[0],
    id: "V2",
    name: "Duplicada",
    start: "B",
    end: "C",
    sectionId: "rect2",
  });
  p.loadPatterns[0].nodal = [
    { ...nodalLoad("A"), fz: -40 },
    { ...nodalLoad("C"), fx: 20, my: 3 },
  ];
  p.loadPatterns[0].uniform.push({ ...uniformLoad("V2"), qz: -2000 });
  p.loadPatterns.push({
    id: "Q",
    name: "Variável",
    nodal: [{ ...nodalLoad("C"), fx: 7 }],
    uniform: [{ ...uniformLoad("V2"), qx: 3 }],
    pressure: [],
  });
  p.selectionGroups.push({
    id: "grp",
    name: "Conjunto",
    objects: [
      { kind: "node", id: "C" },
      { kind: "node", id: "A" },
      { kind: "member", id: "V2" },
    ],
  });
  return p;
}
describe("diagnóstico e correção de duplicidades", () => {
  it("busca com distância XYZ, inclui o limite e distingue cota e cruzamento em planta", () => {
    const p = createProject("spatial");
    const a = addPoint(p, origin),
      b = addPoint(p, { ...origin, x: 0.0004 }),
      c = addPoint(p, { ...origin, x: 1 }),
      d = addPoint(p, { ...origin, x: 1.002 });
    addPoint(p, { ...origin, z: 0.002 });
    expect(nearNodes(p, 0.001)).toEqual([
      { a: a.id, b: b.id, distance: 0.0004 },
    ]);
    expect(nearNodes(p, 0.0004)).toHaveLength(1);
    expect(nearNodes(p, 0)).toEqual([]);
    expect(() => nearNodes(p, NaN)).toThrow(/tolerância/);
    expect(() => stagedMembers(p, 0.001, [{ drop: c.id, keep: d.id }])).toThrow(
      /tolerância/,
    );
    addMember(p, { x: -1, y: 1, z: 2 }, { x: 1, y: -1, z: 2 });
    addMember(p, { x: -1, y: -1, z: 3 }, { x: 1, y: 1, z: 3 });
    expect(stagedMembers(p, 0.001, []).pairs).toEqual([]);
  });
  it("não fecha cadeias transitivas, nem mesmo se todos forem enviados ao nó central", () => {
    const p = createProject();
    const [a, b, c] = [0, 0.0008, 0.0016].map((x) =>
      addPoint(p, { ...origin, x }),
    );
    expect(nearNodes(p, 0.001)).toHaveLength(2);
    expect(() =>
      stagedMembers(p, 0.001, [
        { drop: a.id, keep: b.id },
        { drop: b.id, keep: c.id },
      ]),
    ).toThrow(/cadeia/);
    expect(() =>
      stagedMembers(p, 0.001, [
        { drop: a.id, keep: b.id },
        { drop: c.id, keep: b.id },
      ]),
    ).toThrow(/tolerância/);
    const d = noRepairs();
    d.nodes = [{ drop: a.id, keep: b.id }];
    const q = plan(p, d).project!;
    expect(q.nodes.map((n) => n.id)).toEqual([b.id, c.id]);
    expect(nearNodes(q, 0.001)).toHaveLength(1);
  });
  it("mostra a duplicata invertida criada pela união e mantém o projeto original até resolver", () => {
    const p = fixture(),
      snapshot = structuredClone(p),
      d = noRepairs();
    expect(stagedMembers(p, 0.001, []).pairs).toEqual([]);
    d.nodes = [{ drop: "C", keep: "A" }];
    const stage = stagedMembers(p, 0.001, d.nodes);
    expect(stage.pairs).toEqual([{ a: "V1", b: "V2" }]);
    const pending = plan(p, d);
    expect(pending.project).toBeNull();
    expect(
      pending.questions.some((q) => q.title.includes("cria barras duplicadas")),
    ).toBe(true);
    d.members = [{ drop: "V2", keep: "V1" }];
    const review = plan(p, d);
    expect(review.questions.length).toBe(4);
    expect(review.project).toBeNull();
    for (const q of review.questions)
      d.answers[q.key] = q.title.startsWith("Vínculos")
        ? "union"
        : q.title.startsWith("Conservar")
          ? "confirm"
          : q.title.endsWith("B1 [V1]")
            ? "use:V1"
            : "all";
    const done = plan(p, d),
      model = done.project!;
    expect(model.nodes.find((n) => n.id === "A")!.restraints).toEqual({
      ...free(),
      ux: true,
      uz: true,
      ry: true,
    });
    expect(model.members).toEqual([p.members[0]]);
    expect(model.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(
      model.loadPatterns[0].nodal.map((l) => [l.nodeId, l.fx, l.fz, l.my]),
    ).toEqual([
      ["A", 0, -40, 0],
      ["A", 20, 0, 3],
    ]);
    expect(model.loadPatterns[0].uniform).toEqual([
      p.loadPatterns[0].uniform[0],
    ]);
    expect(model.loadPatterns[1].uniform).toEqual([
      { ...uniformLoad("V1"), qx: 3 },
    ]);
    expect(model.loadPatterns[1].nodal).toEqual([{ ...nodalLoad("A"), fx: 7 }]);
    expect(model.selectionGroups[0].objects).toEqual([
      { kind: "node", id: "A" },
      { kind: "member", id: "V1" },
    ]);
    expect(
      done.notes.some((n) => n.includes("V2") && n.includes("descartar")),
    ).toBe(true);
    expect(parseProject(serializeProject(model))).toEqual(model);
    expect(referenceErrors(model)).toEqual([]);
    expect(nearNodes(model, 0.001)).toEqual([]);
    expect(stagedMembers(model, 0.001, []).pairs).toEqual([]);
    expect(plan(model, noRepairs()).changes).toBe(0);
    expect(p).toEqual(snapshot);
  });
  it("permite escolher a barra invertida como sobrevivente e manter duplicatas independentes por decisão explícita", () => {
    const p = beamExample();
    p.members.push({
      ...p.members[0],
      id: "inverse",
      name: "Inversa",
      start: "B",
      end: "A",
    });
    const d = noRepairs();
    d.members = [{ drop: "V1", keep: "inverse" }];
    const q = plan(p, d).project!;
    expect(q.members).toEqual([p.members[1]]);
    expect(q.loadPatterns[0].uniform[0].memberId).toBe("inverse");
    const model = fixture(),
      opts = noRepairs();
    opts.nodes = [{ drop: "A", keep: "C" }];
    const review = plan(model, opts);
    for (const question of review.questions)
      opts.answers[question.key] = question.options[0].value;
    const kept = plan(model, opts).project!;
    expect(kept.nodes.find((n) => n.id === "C")!.x).toBe(0.0004);
    expect(kept.members).toHaveLength(2);
    expect(stagedMembers(kept, 0.001, []).pairs).toHaveLength(1);
  });
  it("exige confirmar o descarte de uma barra que ficaria nula com cargas e grupos", () => {
    const p = createProject(),
      bar = addMember(p, origin, { ...origin, x: 0.0004 });
    p.selectionGroups = [
      { id: "g", name: "Peça", objects: [{ kind: "member", id: bar.id }] },
    ];
    p.loadPatterns[0].uniform.push({ ...uniformLoad(bar.id), qz: -10000 });
    const d = noRepairs();
    d.nodes = [{ drop: bar.end, keep: bar.start }];
    expect(plan(p, d).blocking.join(" ")).toMatch(/comprimento nulo/);
    d.removeNull = [bar.id];
    const r = plan(p, d);
    expect(r.project!.members).toHaveLength(0);
    expect(r.project!.loadPatterns[0].uniform).toEqual([]);
    expect(r.project!.selectionGroups[0].objects).toEqual([]);
    expect(r.notes.join(" ")).toContain("excluir carga");
  });
  it("detecta uma nova sobreposição parcial e permite renunciar à união antes de editar", () => {
    const p = createProject(),
      a = addMember(p, origin, { ...origin, x: 4 }),
      b = addMember(p, { x: 0, y: 0, z: 0.0004 }, { ...origin, x: 2 });
    const d = noRepairs();
    d.nodes = [{ drop: b.start, keep: a.start }];
    const r = plan(p, d);
    expect(r.project).toBeNull();
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].title).toContain("Sobreposição");
    expect(plan(p, noRepairs()).changes).toBe(0);
    d.answers[r.questions[0].key] = "confirm";
    expect(plan(p, d).project!.members).toHaveLength(2);
  });
  it("não soma cargas iguais de objetos distintos sem decisão, isola IDs entre tipos e padrões", () => {
    const p = beamExample();
    p.members.push({ ...p.members[0], id: "A", name: "Outra" });
    p.loadPatterns[0].uniform.push({
      ...p.loadPatterns[0].uniform[0],
      memberId: "A",
    });
    p.selectionGroups = [
      {
        id: "g",
        name: "Ambos",
        objects: [
          { kind: "node", id: "A" },
          { kind: "member", id: "A" },
        ],
      },
    ];
    const d = noRepairs();
    d.members = [{ drop: "A", keep: "V1" }];
    const r = plan(p, d);
    expect(r.questions).toHaveLength(1);
    d.answers[r.questions[0].key] = "all";
    const merged = plan(p, d).project!;
    expect(
      merged.loadPatterns[0].uniform.reduce((sum, l) => sum + l.qz, 0),
    ).toBe(-20000);
    expect(merged.selectionGroups[0].objects).toEqual([
      { kind: "node", id: "A" },
      { kind: "member", id: "V1" },
    ]);
  });
});
