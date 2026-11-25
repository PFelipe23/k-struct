import { rectangle } from "./fixtures/project-v8";
import { describe, expect, it } from "vitest";
import {
  analysisErrors,
  parseProject,
  referenceErrors,
  serializeProject,
  uniformLoad,
} from "../src/domain/model";
import {
  TEMPLATE_LIMITS,
  generateParametricProject,
  inspectParametricTemplate,
} from "../src/domain/templates";

describe("modelos paramétricos (KS-06)", () => {
  it("gera viga contínua com vãos de 4 m e 6 m ligados ao mesmo nó intermediário", () => {
    const spec = { kind: "continuous-beam" as const, spansX: [4, 6] };
    const inspection = inspectParametricTemplate(spec);
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(inspection.preview).toMatchObject({
      mode: "planar",
      units: "m",
      axesX: [0, 4, 10],
      totalLengthX: 10,
      nodeCount: 3,
      memberCount: 2,
      columnCount: 0,
      beamCount: 2,
    });
    expect(inspection.preview.supportsSummary).toMatch(/Nenhum apoio/);
    expect(inspection.preview.loadsSummary).toMatch(/Nenhuma carga/);

    const project = generateParametricProject(spec);
    expect(project.mode).toBe("planar");
    expect(project.nodes.map((n) => [n.x, n.y, n.z])).toEqual([
      [0, 0, 0],
      [4, 0, 0],
      [10, 0, 0],
    ]);
    expect(project.members).toHaveLength(2);
    expect(project.members[0].start).toBe(project.nodes[0].id);
    expect(project.members[0].end).toBe(project.nodes[1].id);
    expect(project.members[1].start).toBe(project.nodes[1].id);
    expect(project.members[1].end).toBe(project.nodes[2].id);
    expect(referenceErrors(project)).toEqual([]);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("gera pórtico plano XZ com 2 vãos e 2 pavimentos (9 nós, 6 pilares e 4 vigas)", () => {
    const spec = {
      kind: "regular-frame" as const,
      mode: "planar" as const,
      spansX: [4, 5],
      heightsZ: [3, 3.2],
    };
    const inspection = inspectParametricTemplate(spec);
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(inspection.preview).toMatchObject({
      mode: "planar",
      axesX: [0, 4, 9],
      levelsZ: [0, 3, 6.2],
      nodeCount: 9,
      columnCount: 6,
      beamCount: 4,
      memberCount: 10,
    });

    const project = generateParametricProject(spec);
    expect(project.nodes).toHaveLength(9);
    expect(project.members).toHaveLength(10);
    const byId = new Map(project.nodes.map((n) => [n.id, n]));
    const columns = project.members.filter((m) => {
      const a = byId.get(m.start)!;
      const b = byId.get(m.end)!;
      return a.x === b.x && a.z !== b.z;
    });
    const beams = project.members.filter((m) => {
      const a = byId.get(m.start)!;
      const b = byId.get(m.end)!;
      return a.z === b.z && a.x !== b.x;
    });
    expect(columns).toHaveLength(6);
    expect(beams).toHaveLength(4);
    expect(beams.every((m) => byId.get(m.start)!.z > 0)).toBe(true);
    expect(project.guides.x.map((g) => g.position)).toEqual([0, 4, 9]);
    expect(project.guides.z.map((g) => g.position)).toEqual([0, 3, 6.2]);
    expect(referenceErrors(project)).toEqual([]);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("gera pórtico espacial XYZ com contagens corretas em X, Y e Z", () => {
    const spec = {
      kind: "regular-frame" as const,
      mode: "spatial" as const,
      spansX: [4, 5],
      spansY: [3, 4],
      heightsZ: [3, 3],
    };
    const inspection = inspectParametricTemplate(spec);
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;

    expect(inspection.preview).toMatchObject({
      mode: "spatial",
      nodeCount: 27,
      columnCount: 18,
      beamXCount: 12,
      beamYCount: 12,
      beamCount: 24,
      memberCount: 42,
    });

    const project = generateParametricProject(spec);
    expect(project.mode).toBe("spatial");
    expect(project.nodes).toHaveLength(27);
    expect(project.members).toHaveLength(42);
    expect(project.guides.x.map((g) => g.position)).toEqual([0, 4, 9]);
    expect(project.guides.y.map((g) => g.position)).toEqual([0, 3, 7]);
    expect(project.guides.z.map((g) => g.position)).toEqual([0, 3, 6]);
    expect(referenceErrors(project)).toEqual([]);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("rejeita listas vazias, valores não finitos, nulos, negativos e limites do domínio", () => {
    const invalidCases = [
      { kind: "continuous-beam" as const, spansX: [] },
      { kind: "continuous-beam" as const, spansX: [4, NaN] },
      { kind: "continuous-beam" as const, spansX: [4, Infinity] },
      { kind: "continuous-beam" as const, spansX: [4, 0] },
      { kind: "continuous-beam" as const, spansX: [4, -2] },
      { kind: "continuous-beam" as const, spansX: [4, 1e-7] },
      {
        kind: "regular-frame" as const,
        mode: "planar" as const,
        spansX: [4],
        heightsZ: [0],
      },
      {
        kind: "regular-frame" as const,
        mode: "spatial" as const,
        spansX: [4],
        spansY: [],
        heightsZ: [3],
      },
    ];
    for (const spec of invalidCases) {
      expect(inspectParametricTemplate(spec).ok).toBe(false);
      expect(() => generateParametricProject(spec)).toThrow();
    }

    const tooManyGuides = inspectParametricTemplate({
      kind: "continuous-beam",
      spansX: Array.from({ length: TEMPLATE_LIMITS.maxGuidesPerAxis }, () => 2),
    });
    expect(tooManyGuides.ok).toBe(false);
    if (!tooManyGuides.ok) {
      expect(tooManyGuides.errors.join("\n")).toMatch(/40/);
    }

    const tooManyMembers = inspectParametricTemplate({
      kind: "regular-frame",
      mode: "spatial",
      spansX: Array.from({ length: 8 }, () => 4),
      spansY: Array.from({ length: 8 }, () => 4),
      heightsZ: Array.from({ length: 6 }, () => 3),
    });
    expect(tooManyMembers.ok).toBe(false);
    if (!tooManyMembers.ok) {
      expect(tooManyMembers.errors.join("\n")).toMatch(/1\.000 barras/);
    }

    const tooManyNodes = inspectParametricTemplate({
      kind: "regular-frame",
      mode: "spatial",
      spansX: Array.from({ length: 10 }, () => 4),
      spansY: Array.from({ length: 10 }, () => 4),
      heightsZ: Array.from({ length: 9 }, () => 3),
    });
    expect(tooManyNodes.ok).toBe(false);
    if (!tooManyNodes.ok) {
      expect(tooManyNodes.errors.join("\n")).toMatch(/1\.000 nós/);
    }
  });

  it("a prévia rejeita coordenadas coincidentes e conserva vãos representáveis", () => {
    const invalid = inspectParametricTemplate({
      kind: "continuous-beam",
      spansX: [1e16, 1],
    });
    expect(invalid.ok).toBe(false);
    const project = generateParametricProject({
      kind: "continuous-beam",
      spansX: [1e14, 1],
    });
    expect(project.nodes.map(({ x }) => x)).toEqual([0, 1e14, 1e14 + 1]);
    expect(project.members).toHaveLength(2);
  });

  it("permite edição manual e passa na validação de análise após apoiar", () => {
    const project = generateParametricProject({
      kind: "continuous-beam",
      spansX: [4, 6],
    });
    project.nodes[0].restraints.ux = true;
    project.nodes[0].restraints.uz = true;
    project.nodes[1].restraints.uz = true;
    project.nodes[2].restraints.uz = true;
    project.nodes[1].x = 5;
    rectangle(project.sections[0]).width = 0.25;
    project.loadPatterns[0].uniform.push({
      ...uniformLoad(project.members[0].id),
      qz: -10000,
    });
    expect(analysisErrors(project)).toEqual([]);
  });
});
