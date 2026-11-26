import { legacyPatterns } from "./fixtures/project-v8";
import { describe, expect, it } from "vitest";
import { coordinates, origin } from "../src/domain/geometry";
import {
  beamExample,
  parseProject,
  referenceErrors,
  serializeProject,
} from "../src/domain/model";
import {
  centeredOffsets,
  memberAxis,
  offsetError,
} from "../src/domain/memberOffsets";
import { planMemberEdit } from "../src/domain/memberOperations";
import { planTransform } from "../src/domain/transform";
import { reverseMember } from "../src/domain/editing";
import { exportOofem } from "../src/solver/oofem";
import { objectsInWindow } from "../src/domain/selection";

describe("Excentricidades e trechos rígidos", () => {
  it("migra v11, conserva IDs e reproduz a entrada original com oito campos nulos", () => {
    const p = beamExample();
    expect(
      parseProject(
        JSON.stringify({
          ...p,
          schemaVersion: 11,
          loadPatterns: legacyPatterns(p),
        }),
      ),
    ).toEqual(p);
    const original = exportOofem(p, "EL").deck;
    p.members[0].offsets = structuredClone(centeredOffsets);
    expect(exportOofem(p, "EL").deck).toBe(original);
    expect(
      parseProject(serializeProject(p)).members[0].offsets,
    ).toBeUndefined();
  });
  it("valida componentes, plano de trabalho e vão deformável", () => {
    const p = beamExample(),
      [a, b] = p.nodes,
      m = p.members[0];
    m.offsets = structuredClone(centeredOffsets);
    for (const value of [-1, Infinity, NaN]) {
      m.offsets.j.rigidLength = value;
      expect(offsetError(m, a, b, p.mode)).toMatch(/finitos e não negativos/);
    }
    m.offsets.j.rigidLength = 0;
    m.offsets.j.eccentricity.y = 0.2;
    expect(referenceErrors(p).join(" ")).toMatch(/plano XZ/);
    m.offsets.j.eccentricity.y = 0;
    m.offsets.j.eccentricity.x = -6;
    expect(() => parseProject(serializeProject(p))).toThrow(/deformável/);
    m.offsets.j.eccentricity.x = 0;
    m.offsets.j.rigidLength = 6;
    expect(() => exportOofem(p, "EL")).toThrow(/deformável/);
  });
  it("preserva o eixo inclinado e os trechos externos ao dividir, reunir e inverter", () => {
    const p = beamExample(),
      m = p.members[0],
      [a, b] = p.nodes;
    m.offsets = {
      i: { eccentricity: { ...origin, z: 0.1 }, rigidLength: 0.5 },
      j: { eccentricity: { ...origin, z: 0.4 }, rigidLength: 1 },
    };
    const axis = memberAxis(m, a, b);
    const cut = (metres: number) =>
      planMemberEdit(p, {
        kind: "split",
        id: m.id,
        reference: { kind: "distance", metres },
      });
    expect(() => cut(0.2)).toThrow(/corte.*deformável/i);
    const { project: q, after } = cut(2);
    const [first, last] = q.members;
    expect(first.offsets!.i).toEqual(m.offsets.i);
    expect(last.offsets!.j).toEqual(m.offsets.j);
    expect(first.offsets!.j.eccentricity.z).toBeCloseTo(0.2, 14);
    expect(first.offsets!.j).toEqual(last.offsets!.i);
    expect(first.offsets!.j.rigidLength).toBe(0);
    const cutNode = q.nodes.find((n) => n.id === first.end)!;
    expect(
      memberAxis(first, a, cutNode).clear + memberAxis(last, cutNode, b).clear,
    ).toBeCloseTo(axis.clear, 13);
    expect(
      planMemberEdit(q, { kind: "join", ids: after }).project.members,
    ).toEqual(p.members);
    reverseMember(p, m.id);
    const reversed = memberAxis(m, b, a);
    for (const k of coordinates)
      expect(reversed.faceI[k]).toBeCloseTo(axis.faceJ[k], 14);
    expect(m.offsets.i.rigidLength).toBe(1);
    expect(parseProject(serializeProject(p))).toEqual(p);
  });
  it("gira os vetores de inserção com a geometria e seleciona o eixo deslocado", () => {
    const p = beamExample();
    p.mode = "spatial";
    const m = p.members[0];
    m.offsets = structuredClone(centeredOffsets);
    m.offsets.i.eccentricity.y = m.offsets.j.eccentricity.y = 0.2;
    m.offsets.i.rigidLength = 0.5;
    const q = planTransform(p, [{ kind: "member", id: m.id }], {
      kind: "rotate",
      center: origin,
      axis: { ...origin, z: 1 },
      degrees: 90,
      copies: 1,
    }).project;
    const copy = q.members[1].offsets!;
    expect(copy.i.eccentricity.x).toBeCloseTo(-0.2, 14);
    expect(copy.i.eccentricity.y).toBeCloseTo(0, 14);
    expect(copy.i.rigidLength).toBe(0.5);
    expect(
      objectsInWindow(
        p,
        { kind: "XZ", offset: 0.2 },
        { u: 3.1, v: 0.02 },
        { u: 2.9, v: -0.02 },
      ),
    ).toContainEqual({ kind: "member", id: m.id });
  });
});
