import { describe, expect, it } from "vitest";
import { coordinates, cross, dot, origin } from "../src/domain/geometry";
import {
  addPoint,
  analysisErrors,
  beamExample,
  free,
  parseProject,
  serializeProject,
} from "../src/domain/model";
import {
  supportBasis,
  supportToGlobal,
  supportToLocal,
} from "../src/domain/supports";
import { geometryOnly, planTransform } from "../src/domain/transform";
import { noRepairs, planRepair } from "../src/domain/duplicateRepair";
import { stagedMembers } from "../src/domain/duplicateGeometry";
import { inclinedBeam, rollerAngle } from "./fixtures/inclined-beam";

describe("referenciais nodais", () => {
  it("migra v10 com eixos globais e lê e escreve um referencial local em v11", () => {
    const legacy = beamExample();
    const migrated = parseProject(
      JSON.stringify({ ...legacy, schemaVersion: 10 }),
    );
    expect(migrated).toEqual(legacy);
    expect(migrated.nodes[1].supportFrame).toBeUndefined();
    const project = inclinedBeam();
    expect(parseProject(serializeProject(project))).toEqual(project);
    expect(analysisErrors(project)).toEqual([]);
  });

  it("ortonormaliza referências oblíquas e converte vetores nos dois sentidos", () => {
    const basis = supportBasis({
      kind: "spatial",
      x: { x: 1, y: 2, z: 2 },
      y: { x: 3, y: 3, z: 0 },
    });
    for (const k of coordinates)
      expect(dot(basis[k], basis[k])).toBeCloseTo(1, 12);
    expect(dot(basis.x, basis.y)).toBeCloseTo(0, 12);
    expect(dot(basis.x, basis.z)).toBeCloseTo(0, 12);
    expect(dot(basis.y, basis.z)).toBeCloseTo(0, 12);
    expect(dot(cross(basis.x, basis.y), basis.z)).toBeCloseTo(1, 12);
    const v = { x: 1, y: 2, z: 3 };
    const back = supportToGlobal(supportToLocal(v, basis), basis);
    for (const k of coordinates) expect(back[k]).toBeCloseTo(v[k], 12);
  });

  it("rejeita bases nulas, colineares ou incompatíveis com o plano ao abrir", () => {
    const p = beamExample();
    p.nodes[0].supportFrame = {
      kind: "spatial",
      x: { x: 1, y: 2, z: 3 },
      y: origin,
    };
    expect(() => parseProject(serializeProject(p))).toThrow(/modo do projeto/);
    p.mode = "spatial";
    expect(() => parseProject(serializeProject(p))).toThrow(/não nulas/);
    p.nodes[0].supportFrame.y = { x: -2, y: -4, z: -6 };
    expect(() => parseProject(serializeProject(p))).toThrow(/colineares/);
  });

  it("detecta movimento de corpo rígido com direções de apoio paralelas", () => {
    const p = inclinedBeam();
    const [a, b] = p.nodes;
    a.supportFrame = b.supportFrame;
    a.restraints = { ...free(), uz: true, ry: true };
    expect(analysisErrors(p)).toContainEqual(
      expect.stringMatching(/apoios insuficientes/),
    );
    // The same flags with a second, independent translation direction stabilize it.
    delete a.supportFrame;
    expect(analysisErrors(p)).toEqual([]);
  });

  it("leva a orientação física ao girar uma cópia com apoios", () => {
    const p = inclinedBeam();
    const action = {
      kind: "rotate",
      center: { ...origin, x: -1 },
      axis: { ...origin, y: 1 },
      degrees: 90,
      copies: 1,
    } as const;
    const plan = planTransform(p, [{ kind: "member", id: "V1" }], action, {
      ...geometryOnly,
      supports: true,
    });
    const node = plan.project.nodes.find(
      ({ id }) => id === plan.maps[0].nodes.get("B"),
    )!;
    expect(node.restraints).toEqual(p.nodes[1].restraints);
    const basis = supportBasis(node.supportFrame);
    expect(basis.z).toMatchObject({ y: 0 });
    expect(basis.z.x).toBeCloseTo(0.8, 12);
    expect(basis.z.z).toBeCloseTo(-0.6, 12);
  });

  it("pede a origem ao unir nós com os mesmos graus marcados e bases diferentes", () => {
    const p = inclinedBeam();
    const b = p.nodes[1];
    const c = addPoint(p, { x: b.x + 0.0005, y: 0, z: 0 });
    c.restraints = { ...b.restraints };
    const choices = noRepairs();
    choices.nodes = [{ drop: b.id, keep: c.id }];
    const stage = stagedMembers(p, 0.001, choices.nodes);
    const [question] = planRepair(stage, choices).questions;
    expect(question.options.map(({ value }) => value)).not.toContain("union");
    choices.answers[question.key] = "use:B";
    const repaired = planRepair(stage, choices).project!;
    expect(repaired.nodes.find(({ id }) => id === c.id)?.supportFrame).toEqual({
      kind: "planar",
      angle: rollerAngle,
    });
  });
});
