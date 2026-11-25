import { describe, expect, it } from "vitest";
import {
  beamExample,
  parseProject,
  sectionSchema,
  serializeProject,
} from "../src/domain/model";
import {
  defaultGeometry,
  geometryErrors,
  sectionProperties,
  type SectionGeometry,
} from "../src/domain/sections";
import { duplicateSection } from "../src/domain/materials";
import { exportOofem } from "../src/solver/oofem";
import { projectV9 } from "./fixtures/project-v8";

function inMillimetres(g: SectionGeometry) {
  const { A, Iy, Iz, J } = sectionProperties(g);
  return [A * 1e6, Iy * 1e12, Iz * 1e12, J * 1e12];
}

describe("catálogo de seções", () => {
  it("confere os círculos de 100 mm e o anel de 100/80 mm por diferença de círculos", () => {
    for (const [g, d] of [
      [defaultGeometry.circle, 0],
      [defaultGeometry.tube, 80],
    ] as const) {
      const a = (Math.PI * (100 ** 2 - d ** 2)) / 4;
      const i = (Math.PI * (100 ** 4 - d ** 4)) / 64;
      const values = inMillimetres(g);
      for (const [index, reference] of [a, i, i, 2 * i].entries())
        expect(values[index]).toBeCloseTo(reference, 6);
    }
  });
  it("confere o I 200 × 100 × 10 × 6 e o exemplo publicado W610×125 (CISC, p. 6)", () => {
    const values = inMillimetres(defaultGeometry.i);
    const reference = [
      3080, 20982666.66666667, 1669906.666666667, 80346.666666667,
    ];
    reference.forEach((value, index) =>
      expect(values[index]).toBeCloseTo(value, 6),
    );
    const w610 = {
      shape: "i",
      height: 0.612,
      width: 0.229,
      flangeThickness: 0.0196,
      webThickness: 0.0119,
    } as const;
    expect(geometryErrors(w610)).toEqual({});
    expect(inMillimetres(w610)[3] / 1.48e6).toBeCloseTo(1, 2);
  });
  it("associa o diagnóstico ao campo e impede importar geometrias fora do domínio", () => {
    const tube = defaultGeometry.tube,
      i = defaultGeometry.i;
    const cases: [SectionGeometry, string][] = [
      [{ ...tube, thickness: 0.05 }, "thickness"],
      [{ ...tube, thickness: 0.06 }, "thickness"],
      [{ ...tube, outerDiameter: -1 }, "outerDiameter"],
      [{ ...i, flangeThickness: i.height / 2 }, "flangeThickness"],
      [{ ...i, flangeThickness: 0.011 }, "flangeThickness"],
      [{ ...i, webThickness: i.width }, "webThickness"],
      [{ ...i, webThickness: 0.019 }, "webThickness"],
      [{ ...defaultGeometry.circle, diameter: NaN }, "diameter"],
      [{ ...defaultGeometry.circle, diameter: 1e180 }, "diameter"],
    ];
    for (const [geometry, key] of cases) {
      expect(geometryErrors(geometry)).toHaveProperty(key);
      const parsed = sectionSchema.safeParse({
        ...geometry,
        id: "SEC",
        name: "Perfil",
        materialId: "steel",
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(parsed.error.issues.some((i) => i.path[0] === key)).toBe(true);
    }
  });
  it("preserva IDs e rigidez da v9 e exporta as propriedades da seção atribuída", () => {
    const project = beamExample(),
      legacy = projectV9(project);
    const restored = parseProject(JSON.stringify(legacy));
    expect(restored).toEqual(project);
    expect(exportOofem(restored, "EL").deck).toBe(
      exportOofem(project, "EL").deck,
    );
    for (const geometry of Object.values(defaultGeometry)) {
      const section = {
        ...geometry,
        id: geometry.shape,
        name: geometry.shape,
        materialId: "steel",
      };
      restored.sections.push(section);
      restored.members[0].sectionId = section.id;
      const cloneId = duplicateSection(restored, section.id);
      expect(restored.sections.find((s) => s.id === cloneId)).toMatchObject({
        ...geometry,
        materialId: "steel",
      });
      expect(parseProject(serializeProject(restored))).toEqual(restored);
      const deck = exportOofem(restored, "EL").deck;
      const number = restored.sections.indexOf(section) + 1;
      const line = deck
        .split("\n")
        .find((l) => l.startsWith(`SimpleCS ${number} `))!;
      const props = sectionProperties(geometry);
      expect(line).toContain(`area ${props.A} Iy ${props.Iy}`);
      const set = line.match(/set (\d+)$/)![1];
      expect(deck).toMatch(new RegExp(`^Set ${set} elements 8 `, "m"));
    }
  });
});
