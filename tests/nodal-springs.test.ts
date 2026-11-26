import { legacyPatterns } from "./fixtures/project-v8";
import { describe, expect, it } from "vitest";
import {
  addPoint,
  analysisErrors,
  parseProject,
  serializeProject,
} from "../src/domain/model";
import {
  setRigidSupport,
  setSpring,
  supportBasis,
} from "../src/domain/supports";
import { centeredOffsets } from "../src/domain/memberOffsets";
import { geometryOnly, planTransform } from "../src/domain/transform";
import { stagedMembers } from "../src/domain/duplicateGeometry";
import { noRepairs, planRepair } from "../src/domain/duplicateRepair";
import { applyBatchAssignment } from "../src/domain/batchAssign";
import { exportOofem } from "../src/solver/oofem";
import { DEFAULT_UNITS, parseUnitInput, unitLabel } from "../src/units";
import { springBenchmark } from "./fixtures/spring-beam";

describe("molas nodais", () => {
  it("migra a v13 preservando IDs, excentricidades, rigidez de barras e vínculos", () => {
    const p = springBenchmark();
    p.members[0].stiffness = { eiy: 0.5 };
    p.members[0].offsets = structuredClone(centeredOffsets);
    p.members[0].offsets.i.rigidLength = 0.5;
    const migrated = parseProject(
      JSON.stringify({
        ...p,
        schemaVersion: 13,
        loadPatterns: legacyPatterns(p),
      }),
    );
    expect(migrated).toEqual(p);
    expect(exportOofem(migrated, "EL").deck).toBe(exportOofem(p, "EL").deck);
    setSpring(p.nodes[1], "uz", 1e7);
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it("identifica rigidezes inválidas, fora do plano ou combinadas com vínculo rígido", () => {
    const p = springBenchmark();
    const node = p.nodes[1];
    expect(() => setSpring(node, "uz", NaN)).toThrow(/finita/);
    node.springs = { uz: -1 };
    expect(() => parseProject(JSON.stringify(p))).toThrow(
      /Nó N2 · UZ.*não negativa/,
    );
    node.springs = { uz: 1 };
    expect(() => parseProject(JSON.stringify(p))).toThrow(
      /N2 \(B\).*simultâneas/,
    );
    node.springs = { uy: 1 };
    expect(() => parseProject(JSON.stringify(p))).toThrow(
      /N2 \(B\).*fora do plano/,
    );
  });

  it("considera a mola positiva no posto dos apoios e diagnostica o mecanismo após k = 0", () => {
    const p = springBenchmark();
    const node = p.nodes[1];
    setSpring(node, "uz", 1e7);
    expect(analysisErrors(p)).toEqual([]);
    setSpring(node, "uz", 0);
    expect(node.springs).toBeUndefined();
    expect(analysisErrors(p)).toContainEqual(
      expect.stringMatching(/N1.*movimento de corpo rígido/),
    );
    setRigidSupport(node, "uz", true);
    expect(analysisErrors(p)).toEqual([]);
  });

  it("converte as unidades derivadas e libera a mola ao aplicar a atribuição em lote", () => {
    const units = { ...DEFAULT_UNITS, length: "cm" } as const;
    expect(unitLabel("translationStiffness", units)).toBe("kN/cm");
    expect(parseUnitInput("100,5", "translationStiffness", units)).toBe(
      10050000,
    );
    expect(unitLabel("rotationStiffness", units)).toBe("kN·m/rad");
    expect(parseUnitInput("5000", "rotationStiffness", units)).toBe(5e6);
    const p = springBenchmark();
    setSpring(p.nodes[1], "uz", 1e7);
    const changed = applyBatchAssignment(p, [{ kind: "node", id: "B" }], "G", {
      restraints: { uz: "release" },
    });
    expect(changed.changedNodes).toBe(1);
    expect(p.nodes[1].springs).toBeUndefined();
    expect(p.nodes[1].restraints.uz).toBe(false);
  });

  it("gira a direção das molas ao copiar apoios com a geometria", () => {
    const p = springBenchmark();
    setSpring(p.nodes[1], "uz", 1e7);
    const plan = planTransform(
      p,
      [{ kind: "member", id: "V1" }],
      {
        kind: "rotate",
        center: { x: -1, y: 0, z: 0 },
        axis: { x: 0, y: 1, z: 0 },
        degrees: 90,
        copies: 1,
      },
      { ...geometryOnly, supports: true },
    );
    const copy = plan.project.nodes.find(
      ({ id }) => id === plan.maps[0].nodes.get("B"),
    )!;
    expect(copy.springs).toEqual({ uz: 1e7 });
    expect(supportBasis(copy.supportFrame).z.x).toBeCloseTo(1, 12);
  });

  it("pede confirmação e soma rigidezes em paralelo ao unir nós duplicados", () => {
    const p = springBenchmark();
    const a = p.nodes[1];
    const b = addPoint(p, { x: a.x + 0.0002, y: 0, z: 0 });
    setSpring(a, "uz", 1e7);
    setSpring(b, "uz", 1e7);
    const choices = noRepairs();
    choices.nodes = [{ drop: b.id, keep: a.id }];
    const stage = stagedMembers(p, 0.001, choices.nodes);
    const [question] = planRepair(stage, choices).questions;
    choices.answers[question.key] = "union";
    const repaired = planRepair(stage, choices).project!;
    expect(repaired.nodes.find(({ id }) => id === a.id)?.springs).toEqual({
      uz: 2e7,
    });
  });
});
