import { describe, expect, it } from "vitest";
import {
  createProject,
  parseProject,
  serializeProject,
  uniformLoad,
} from "../src/domain/model";
import {
  applyTabularImport,
  inspectTabularImport,
} from "../src/domain/tabularImport";

describe("importação tabular TSV de nós e barras (KS-16)", () => {
  it("converte unidades para SI, resolve barras com nós do mesmo lote e preserva apoios/cargas ao atualizar", () => {
    const project = createProject("planar");
    const inspection = inspectTabularImport(project, {
      unit: "cm",
      nodesTsv: "ID\tNome\tX\tZ\r\nN1\tN1\t0\t0\r\nN2\tN2\t350\t0\r\n",
      membersTsv:
        "ID\tNome\tID inicial\tID final\tSeção\r\nB1\tB1\tN1\tN2\trect\r\n",
    });
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(inspection.plan.counts).toEqual({
      nodesCreated: 2,
      nodesUpdated: 0,
      nodesUnchanged: 0,
      membersCreated: 1,
      membersUpdated: 0,
      membersUnchanged: 0,
    });
    expect(inspection.plan.hasChanges).toBe(true);
    expect(inspection.plan.members[0].length).toBeCloseTo(3.5, 10);

    applyTabularImport(project, inspection.plan);
    expect(project.nodes.map((n) => [n.id, n.x, n.z])).toEqual([
      ["N1", 0, 0],
      ["N2", 3.5, 0],
    ]);
    expect(project.members).toMatchObject([
      { id: "B1", name: "B1", start: "N1", end: "N2", sectionId: "rect" },
    ]);

    // Adiciona apoio e carga na barra e atualiza apenas N2 pelo mesmo ID
    project.nodes[0].restraints.ux = true;
    project.nodes[0].restraints.uz = true;
    project.loadPatterns[0].uniform.push({ ...uniformLoad("B1"), qz: -5000 });

    const updateInspection = inspectTabularImport(project, {
      unit: "m",
      nodesTsv: "N2\tN2\t4,25\t0",
      membersTsv: "",
    });
    expect(updateInspection.ok).toBe(true);
    if (!updateInspection.ok) return;
    expect(updateInspection.plan.counts).toMatchObject({
      nodesCreated: 0,
      nodesUpdated: 1,
      nodesUnchanged: 0,
    });

    applyTabularImport(project, updateInspection.plan);
    expect(project.nodes[0].restraints.ux).toBe(true);
    expect(project.nodes[1].x).toBe(4.25);
    expect(project.members[0].id).toBe("B1");
    expect(project.loadPatterns[0].uniform[0].qz).toBe(-5000);
    expect(parseProject(serializeProject(project))).toEqual(project);

    // Repetir os mesmos IDs e valores não gera alterações
    const repeat = inspectTabularImport(project, {
      unit: "m",
      nodesTsv: "N1\tN1\t0\t0\nN2\tN2\t4.25\t0",
      membersTsv: "B1\tB1\tN1\tN2\trect",
    });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.plan.hasChanges).toBe(false);
    expect(repeat.plan.counts).toEqual({
      nodesCreated: 0,
      nodesUpdated: 0,
      nodesUnchanged: 2,
      membersCreated: 0,
      membersUpdated: 0,
      membersUnchanged: 1,
    });
  });

  it("reporta linha, coluna, valor e motivo para referências ausentes e células inválidas", () => {
    const project = createProject("planar");
    const result = inspectTabularImport(project, {
      unit: "m",
      nodesTsv: "ID\tNome\tX\tZ\nN1\tN1\tabc\t0",
      membersTsv:
        "ID\tNome\tID inicial\tID final\tSeção\nB1\tB1\tN1\tN99\trect",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "nodes",
          line: 2,
          column: "X (m)",
          value: "abc",
        }),
        expect.objectContaining({
          table: "members",
          line: 2,
          column: "ID final",
          value: "N99",
        }),
      ]),
    );
    expect(project.nodes).toHaveLength(0);
    expect(project.members).toHaveLength(0);
  });

  it("aceita modelo espacial XYZ com 5 colunas e vírgula decimal", () => {
    const project = createProject("spatial");
    const result = inspectTabularImport(project, {
      unit: "m",
      nodesTsv: "N1\tPilar base\t0\t0\t0\nN2\tPilar topo\t1,5\t2,25\t3,5",
      membersTsv: "P1\tP1\tN1\tN2\trect",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    applyTabularImport(project, result.plan);
    expect(project.nodes[1]).toMatchObject({
      id: "N2",
      name: "Pilar topo",
      x: 1.5,
      y: 2.25,
      z: 3.5,
    });
    expect(parseProject(serializeProject(project))).toEqual(project);
  });
  it("valida a topologia final e aceita trocar extremidades em qualquer ordem de linhas", () => {
    const p = createProject("planar");
    const seed = inspectTabularImport(p, {
      unit: "m",
      nodesTsv: "A\tA\t0\t0\nB\tB\t2\t0\nC\tC\t4\t0",
      membersTsv: "M1\tM1\tA\tB\trect\nM2\tM2\tB\tC\trect",
    });
    if (!seed.ok) throw Error("Falha ao preparar o modelo");
    applyTabularImport(p, seed.plan);
    const before = serializeProject(p);
    const collapse = inspectTabularImport(p, {
      unit: "cm",
      nodesTsv: "B\tB\t0\t0",
      membersTsv: "",
    });
    expect(collapse).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ table: "nodes", line: 1 })],
    });
    const swaps = ["M1\tM1\tB\tC\trect", "M2\tM2\tA\tB\trect"];
    for (const order of [swaps, [...swaps].reverse()]) {
      expect(
        inspectTabularImport(p, {
          unit: "m",
          nodesTsv: "",
          membersTsv: order.join("\n"),
        }).ok,
      ).toBe(true);
    }
    expect(serializeProject(p)).toBe(before);
  });
  it("preserva barras coincidentes existentes e antecipa a invalidação de uma conexão interna", () => {
    const p = createProject("planar");
    const input = {
      unit: "m" as const,
      nodesTsv: "A\tA\t0\t0\nB\tB\t6\t0\nC\tC\t3\t0",
      membersTsv: "M1\tM1\tA\tB\trect",
    };
    const seed = inspectTabularImport(p, input);
    if (!seed.ok) throw Error("Falha ao preparar o modelo");
    applyTabularImport(p, seed.plan);
    p.members.push({ ...p.members[0], id: "M2", name: "M2" });
    p.meshConnections.push({ memberId: "M1", nodeId: "C" });
    expect(inspectTabularImport(p, input)).toMatchObject({
      ok: true,
      plan: { hasChanges: false },
    });
    expect(
      inspectTabularImport(p, { ...input, nodesTsv: "C\tC\t3\t1" }),
    ).toMatchObject({
      ok: false,
      errors: [
        expect.objectContaining({
          reason: expect.stringContaining("interior"),
        }),
      ],
    });
    expect(
      inspectTabularImport(p, { ...input, membersTsv: "M3\tM3\tA\tB\trect" }),
    ).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ value: "B" })],
    });
  });
});
