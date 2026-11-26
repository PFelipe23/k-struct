import { describe, expect, it } from "vitest";
import {
  addPoint,
  beamExample,
  nodalLoad,
  type Project,
} from "../src/domain/model";
import { centeredOffsets } from "../src/domain/memberOffsets";
import {
  setSpring,
  supportBasis,
  supportToLocal,
} from "../src/domain/supports";
import { buildResultTable } from "../src/components/Results";
import { combineLinearResults } from "../src/solver/combinations";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { springBenchmark } from "./fixtures/spring-beam";

const executable = process.env.OOFEM_BIN;
function solve(p: Project) {
  const input = exportOofem(p, "EL");
  return parseOofemOutput(runDeck(input.deck, executable!), input);
}

describe.skipIf(!executable)("KS-25 · molas nodais no OOFEM 3.0", () => {
  it("equilibra 20 kN ao meio, recupera R = −k·u e tende ao apoio rígido", () => {
    const p = springBenchmark();
    const rigid = solve(p);
    const b = p.nodes[1];
    let previous = Infinity;
    for (const k of [1e7, 1e8, 1e9]) {
      setSpring(b, "uz", k);
      const result = solve(p);
      const [a, spring] = result.reactions;
      expect(a.fz).toBeCloseTo(10000, 4);
      expect(spring.fz).toBeCloseTo(10000, 4);
      expect(result.displacements.B.uz).toBeCloseTo(-10000 / k, 11);
      expect(spring.fz).toBeCloseTo(-k * result.displacements.B.uz, 8);
      const difference = Math.abs(
        result.displacements.C.uz - rigid.displacements.C.uz,
      );
      expect(difference).toBeLessThan(previous);
      expect(difference).toBeCloseTo(5000 / k, 10);
      previous = difference;
    }
  });

  it("reage ao momento com o sinal oposto e mede a rotação nodal em radianos", () => {
    const p = beamExample();
    p.nodes[1].restraints.uz = false;
    setSpring(p.nodes[0], "ry", 5e6);
    p.loadPatterns[0].uniform = [];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), my: -15000 }];
    const result = solve(p);
    expect(result.displacements.A.ry).toBeCloseTo(-0.003, 11);
    expect(result.reactions[0].my).toBeCloseTo(15000, 4);
    expect(result.reactions[0].my).toBeCloseTo(
      -5e6 * result.displacements.A.ry,
      8,
    );
  });

  it("preserva reação e energia da mola numa base espacial inclinada", () => {
    const p = springBenchmark();
    p.mode = "spatial";
    Object.assign(p.nodes[0].restraints, { uy: true, rx: true, rz: true });
    const b = p.nodes[1];
    setSpring(b, "uz", 1e7);
    const equivalent = solve(p);
    const s = 0.5,
      c = Math.sqrt(3) / 2;
    const frame = {
      kind: "spatial",
      x: { x: 1, y: 0, z: 0 },
      y: { x: 0, y: c, z: s },
    } as const;
    p.nodes[0].supportFrame = b.supportFrame = frame;
    Object.assign(p.loadPatterns[0].nodal[0], {
      fy: 20000 * s,
      fz: -20000 * c,
    });
    const result = solve(p);
    const r = result.reactions.find(({ nodeId }) => nodeId === "B")!;
    const u = result.displacements.B;
    const local = supportToLocal(
      { x: u.ux, y: u.uy, z: u.uz },
      supportBasis(frame),
    );
    expect(local.z).toBeCloseTo(equivalent.displacements.B.uz, 11);
    expect(0.5e7 * local.z ** 2).toBeCloseTo(5, 6);
    expect(r.fy).toBeCloseTo(-s * equivalent.reactions[1].fz, 3);
    expect(r.fz).toBeCloseTo(c * equivalent.reactions[1].fz, 3);
    const combination = {
      id: "D",
      name: "Duplicação",
      type: "linear" as const,
      factors: [{ caseId: "EL", factor: 2 }],
    };
    const combined = combineLinearResults(
      p,
      combination,
      new Map([["EL", result]]),
    );
    const reactions = buildResultTable(p, "reactions", combined);
    const displacements = buildResultTable(p, "displacements", combined);
    const valueAtB = (table: typeof reactions, column: string) =>
      table.rows.find(([name]) => name === b.name)![
        table.headers.indexOf(column)
      ];
    expect(valueAtB(reactions, "RZ local (kN)")).toBeCloseTo(20, 8);
    expect(valueAtB(reactions, "RY local (kN)")).toBe(0);
    expect(valueAtB(displacements, "UZ local (mm)")).toBeCloseTo(-2, 8);
  });

  it("aplica um momento e recupera a reação de torção num eixo espacial oblíquo", () => {
    const p = beamExample();
    p.mode = "spatial";
    const [a, b] = p.nodes;
    a.restraints = {
      ux: true,
      uy: true,
      uz: true,
      rx: false,
      ry: true,
      rz: true,
    };
    b.restraints.uz = false;
    const s = 0.5,
      c = Math.sqrt(3) / 2;
    a.supportFrame = {
      kind: "spatial",
      x: { x: c, y: s, z: 0 },
      y: { x: -s, y: c, z: 0 },
    };
    setSpring(a, "rx", 5e6);
    p.loadPatterns[0].uniform = [];
    p.loadPatterns[0].nodal = [
      { ...nodalLoad("B"), mx: 15000 * c, my: 15000 * s },
    ];
    const result = solve(p);
    expect(result.displacements.A.rx).toBeCloseTo(0.003 * c, 11);
    expect(result.displacements.A.ry).toBeCloseTo(0.003 * s, 11);
    expect(result.reactions[0].mx).toBeCloseTo(-15000 * c, 3);
    expect(result.reactions[0].my).toBeCloseTo(-15000 * s, 3);
  });

  it("aplica a mola ao nó físico dentro de uma zona rígida de extremidade", () => {
    const p = beamExample();
    p.nodes[1].restraints.uz = false;
    const c = addPoint(p, { x: 0.5, y: 0, z: 0 });
    setSpring(c, "uz", 1e7);
    p.meshConnections = [{ memberId: "V1", nodeId: c.id }];
    p.members[0].offsets = structuredClone(centeredOffsets);
    p.members[0].offsets.i.rigidLength = 1;
    p.loadPatterns[0].uniform = [];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fz: -1000 }];
    const result = solve(p);
    expect(result.reactions[0].fz).toBeCloseTo(-11000, 3);
    expect(result.reactions[1].fz).toBeCloseTo(12000, 3);
    expect(result.displacements[c.id].uz).toBeCloseTo(-0.0012, 11);
  });
});
