import { describe, expect, it } from "vitest";
import {
  assignMaterial,
  duplicateSection,
  materialUsage,
  newMaterial,
  removeMaterial,
  saveMaterial,
} from "../src/domain/materials";
import {
  beamExample,
  parseProject,
  projectSchema,
  serializeProject,
} from "../src/domain/model";
import { exportOofem } from "../src/solver/oofem";
import { projectV8 } from "./fixtures/project-v8";
import { slabBenchmarkProject } from "./fixtures/slab-benchmark";

describe("biblioteca de materiais", () => {
  it("mantém os IDs de duas seções no cadastro, duplicação, edição e reatribuição", () => {
    const p = beamExample(),
      original = { ...newMaterial(p), name: "Aço", E: 210e9, alpha: 0.000012 };
    const second = duplicateSection(p, "rect");
    saveMaterial(p, original, "create");
    for (const s of p.sections)
      assignMaterial(p, { kind: "section", id: s.id }, original.id);
    expect(materialUsage(p, original.id).sections.map((s) => s.id)).toEqual([
      "rect",
      second,
    ]);
    const copy = newMaterial(p, original);
    expect(copy).toEqual({ ...original, id: copy.id, name: "Aço · cópia 1" });
    expect(copy.id).not.toBe(original.id);
    saveMaterial(p, copy, "create");
    assignMaterial(p, { kind: "section", id: second }, copy.id);
    saveMaterial(
      p,
      { ...copy, name: "  Ensaio  ", E: 420e9, alpha: -5e-6 },
      "edit",
    );
    expect(p.materials.find((m) => m.id === original.id)).toEqual(original);
    expect(p.sections.map((s) => s.materialId)).toEqual([original.id, copy.id]);
    expect(p.materials.at(-1)).toMatchObject({
      name: "Ensaio",
      E: 420e9,
      alpha: -5e-6,
    });
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it("protege referências de seções e lajes e o último material", () => {
    const p = slabBenchmarkProject(),
      slab = p.slabs[0],
      concrete = slab.materialId;
    expect(() => removeMaterial(p, concrete)).toThrow(/L1/);
    expect(() => removeMaterial(p, "steel")).toThrow(/Retangular R1/);
    expect(() =>
      assignMaterial(p, { kind: "section", id: "rect" }, "ausente"),
    ).toThrow(/Material inexistente/);
    expect(() =>
      assignMaterial(p, { kind: "slab", id: "ausente" }, "steel"),
    ).toThrow(/Laje inexistente/);
    assignMaterial(p, { kind: "slab", id: slab.id }, "steel");
    removeMaterial(p, concrete);
    expect(() => removeMaterial(p, "steel")).toThrow(/pelo menos um material/);
    expect(p.materials.map((m) => m.id)).toEqual(["steel"]);
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it("rejeita valores inválidos e preserva o registro anterior", () => {
    const p = beamExample(),
      original = { ...p.materials[0] };
    for (const invalid of [
      { name: "   " },
      { E: 0 },
      { E: -1 },
      { E: Infinity },
      { nu: -0.01 },
      { nu: 0.5 },
      { nu: NaN },
      { density: -1 },
      { density: 0 },
      { density: Infinity },
      { alpha: NaN },
      { alpha: -Infinity },
    ]) {
      expect(() =>
        saveMaterial(p, { ...original, ...invalid }, "edit"),
      ).toThrow();
      expect(p.materials[0]).toEqual(original);
    }
    expect(() => saveMaterial(p, original, "create")).toThrow(/esse ID/);
    expect(() =>
      saveMaterial(p, { ...original, id: "ausente" }, "edit"),
    ).toThrow(/não existe/);
    saveMaterial(p, { ...original, nu: 0, alpha: -1e-6 }, "edit");
    expect(projectSchema.safeParse(p).success).toBe(true);
  });

  it("migra v8 com α zero em cada material, conservando vínculos e cargas", () => {
    const p = beamExample(),
      second = duplicateSection(p, "rect");
    const other = {
      ...newMaterial(p),
      name: "Concreto",
      E: 30e9,
      nu: 0.2,
      density: 2500,
      alpha: 1e-5,
    };
    saveMaterial(p, other, "create");
    assignMaterial(p, { kind: "section", id: second }, other.id);
    const migrated = parseProject(JSON.stringify(projectV8(p)));
    expect(migrated).toEqual({
      ...p,
      materials: p.materials.map((m) => ({ ...m, alpha: 0 })),
    });
    expect(parseProject(serializeProject(migrated))).toEqual(migrated);
    expect(() =>
      parseProject(JSON.stringify({ ...projectV8(p), schemaVersion: 9 })),
    ).toThrow(/Formato incompatível/);
  });

  it("exporta os dados do material atribuído à laje para QDKT e DKT", () => {
    const p = slabBenchmarkProject(),
      slab = p.slabs[0];
    const material = {
      ...newMaterial(p),
      name: "Concreto B",
      E: 42e9,
      nu: 0.18,
      density: 2600,
      alpha: 9e-6,
    };
    saveMaterial(p, material, "create");
    assignMaterial(p, { kind: "slab", id: slab.id }, material.id);
    for (const formulation of ["dkt", "qdkt"] as const) {
      slab.formulation = formulation;
      const deck = exportOofem(p, "EL").deck;
      expect(deck.match(/^IsoLE .+$/gm)).toEqual([
        "IsoLE 1 d 2600 E 42000000000 n 0.18 tAlpha 0.000009",
      ]);
      expect(deck).toContain("SimpleCS 1 thick 0.1 material 1 set 1");
    }
  });
});
