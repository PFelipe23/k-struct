import { describe, expect, it } from "vitest";
import { reverseMember } from "../src/domain/editing";
import {
  beamAxes,
  cross,
  dot,
  length,
  localComponents,
  origin,
} from "../src/domain/geometry";
import { beamStations } from "../src/domain/beamMesh";
import { parseProject, serializeProject } from "../src/domain/model";
import { exportOofem } from "../src/solver/oofem";
import { internalJointBeam } from "./fixtures/internal-joint";
import { spatialBenchmark } from "./fixtures/spatial-benchmark";

describe("eixos locais e inversão de barras", () => {
  it.each([
    { x: 3, y: 4, z: 0 },
    { x: 0, y: 0, z: 3 },
    { x: 1e-5, y: -1e-5, z: 3 },
    { x: 0.001, y: 0, z: 3 },
    { x: 3, y: 4, z: 2 },
  ])("forma uma tríade de mão direita e preserva z ao inverter %j", (b) => {
    const [x, y, z] = beamAxes(origin, b, 37);
    const [X, Y, Z] = beamAxes(b, origin, -37);
    for (const axis of [x, y, z]) expect(length(axis)).toBeCloseTo(1, 12);
    expect(dot(x, y)).toBeCloseTo(0, 12);
    expect(dot(x, z)).toBeCloseTo(0, 12);
    expect(dot(y, z)).toBeCloseTo(0, 12);
    expect(dot(cross(x, y), z)).toBeCloseTo(1, 12);
    expect(dot(x, X)).toBeCloseTo(-1, 12);
    expect(dot(y, Y)).toBeCloseTo(-1, 12);
    expect(dot(z, Z)).toBeCloseTo(1, 12);
  });

  it("preserva a convenção Beam2d em uma barra vertical", () => {
    const [x, y, z] = beamAxes(origin, { ...origin, z: 5 }, 0, "planar");
    expect(x.z).toBe(1);
    expect(y.y).toBe(1);
    expect(z.x).toBe(-1);
    expect(localComponents({ x: 1, y: 0, z: -3 }, [x, y, z])).toEqual({
      x: -3,
      y: 0,
      z: -1,
    });
  });

  it("espelha estações da ligação interna, com os mesmos IDs, seção e cargas", () => {
    const p = internalJointBeam();
    const [m] = p.members;
    const before = serializeProject(p);
    const stations = beamStations(p).get(m.id)!;
    reverseMember(p, m.id);
    const reversed = beamStations(p).get(m.id)!;
    for (const [i, station] of [...stations].reverse().entries()) {
      expect(reversed[i].t).toBeCloseTo(1 - station.t, 12);
      expect(reversed[i].nodeId).toBe(station.nodeId);
    }
    const original = parseProject(before);
    expect(p.meshConnections).toEqual(original.meshConnections);
    expect(p.loadPatterns).toEqual(original.loadPatterns);
    expect(p.members[0].sectionId).toBe(original.members[0].sectionId);
    reverseMember(p, m.id);
    expect(serializeProject(p)).toBe(before);
  });

  it("troca i/j e espelha a projeção de uma carga espacial global no deck", () => {
    const p = spatialBenchmark();
    const m = p.members.find(({ id }) => id === "B5")!;
    const source = serializeProject(p);
    const load = p.loadPatterns[0].uniform[0];
    const readDeck = () => {
      const input = exportOofem(p, "EL");
      const first = input.elements.find(({ memberId }) => memberId === m.id)!;
      const z = input.deck
        .match(new RegExp(`^Beam3d ${first.number} .* zaxis 3 (.*)$`, "m"))![1]
        .split(" ")
        .map(Number);
      const q = input.deck
        .match(/^ConstantEdgeLoad .* Components 6 ([^\n]+) loadType/m)![1]
        .split(" ")
        .map(Number);
      return { z, q, start: input.nodes[first.start - 1].objectId };
    };
    const deck = readDeck();
    reverseMember(p, m.id);
    const reversed = readDeck();
    expect([deck.start, reversed.start]).toEqual([m.end, m.start]);
    for (let i = 0; i < 3; i++) {
      expect(reversed.z[i]).toBeCloseTo(deck.z[i], 12);
      expect(reversed.q[i]).toBeCloseTo((i === 2 ? 1 : -1) * deck.q[i], 9);
    }
    expect(load).toEqual(parseProject(source).loadPatterns[0].uniform[0]);
    expect(m.roll).toBe(-27);
    reverseMember(p, m.id);
    expect(serializeProject(p)).toBe(source);
  });
});
