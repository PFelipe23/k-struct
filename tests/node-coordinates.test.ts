import { describe, expect, it } from "vitest";
import { inspectNodeCoordinateChanges } from "../src/domain/editing";
import { tolerance } from "../src/domain/geometry";
import { beamExample } from "../src/domain/model";
import { internalJointBeam } from "./fixtures/internal-joint";
import { twoSpanBeam } from "./fixtures/two-span-beam";

describe("edição das coordenadas dos nós", () => {
  it("identifica todas as barras colapsadas sem modificar o projeto", () => {
    const project = twoSpanBeam();
    const before = structuredClone(project);
    const issues = inspectNodeCoordinateChanges(
      project,
      new Map([
        ["A", { x: 6 }],
        ["C", { x: 6 }],
      ]),
    ).issues;
    expect(issues).toEqual([
      {
        nodeIds: ["A"],
        message: expect.stringMatching(/B1 \(V1\).*comprimento nulo/),
      },
      {
        nodeIds: ["C"],
        message: expect.stringMatching(/B2 \(V2\).*comprimento nulo/),
      },
    ]);
    expect(project).toEqual(before);
  });

  it("mede o comprimento em três dimensões e aceita o limite da tolerância", () => {
    const project = beamExample();
    project.mode = "spatial";
    const move = (y: number) =>
      inspectNodeCoordinateChanges(project, new Map([["B", { x: 0, y }]]));
    expect(move(tolerance / 2).issues[0].message).toMatch(
      /inferior à tolerância/,
    );
    expect(move(tolerance).issues).toEqual([]);
    expect(move(3).nodes[1]).toEqual({ ...project.nodes[1], x: 0, y: 3 });
  });

  it("rejeita a distância infinita entre duas coordenadas finitas", () => {
    const project = beamExample();
    const { issues } = inspectNodeCoordinateChanges(
      project,
      new Map([
        ["A", { x: -1e308 }],
        ["B", { x: 1e308 }],
      ]),
    );
    expect(issues).toEqual([
      {
        nodeIds: ["A", "B"],
        message: expect.stringMatching(/intervalo numérico/),
      },
    ]);
  });

  it("permite corrigir o modelo em etapas quando outra barra já tem comprimento nulo", () => {
    const project = twoSpanBeam();
    project.nodes[0].x = project.nodes[1].x;
    const { issues, nodes } = inspectNodeCoordinateChanges(
      project,
      new Map([["C", { z: 1 }]]),
    );
    expect(issues).toEqual([]);
    expect(nodes[0]).toBe(project.nodes[0]);
    expect(nodes[2].z).toBe(1);
  });

  it("avalia um nó interno na posição final da barra e preserva seus vínculos", () => {
    const project = internalJointBeam();
    const before = structuredClone(project);
    const changes = new Map([["C", { z: 2 }]]);
    expect(
      inspectNodeCoordinateChanges(project, changes).issues[0].message,
    ).toMatch(/N3.*interior de B1/);
    changes.set("A", { z: 2 });
    changes.set("B", { z: 2 });
    const { nodes, issues } = inspectNodeCoordinateChanges(project, changes);
    expect(issues).toEqual([]);
    expect(nodes).toEqual(project.nodes.map((node) => ({ ...node, z: 2 })));
    expect(project).toEqual(before);
  });
});
