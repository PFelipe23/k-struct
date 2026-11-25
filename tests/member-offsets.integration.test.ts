import { buildEnvelopeCsv } from "../src/components/EnvelopeResults";
import { evaluateMemberEnvelope } from "../src/solver/envelopes";
import { planMemberEdit } from "../src/domain/memberOperations";
import { describe, expect, it } from "vitest";
import {
  beamExample,
  free,
  nodalLoad,
  type Project,
} from "../src/domain/model";
import { centeredOffsets } from "../src/domain/memberOffsets";
import { reverseMember } from "../src/domain/editing";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";

const executable = process.env.OOFEM_BIN;
function cantilever(mode: Project["mode"]) {
  const p = beamExample();
  p.mode = mode;
  p.nodes[0].restraints = {
    ux: true,
    uy: mode === "spatial",
    uz: true,
    rx: mode === "spatial",
    ry: true,
    rz: mode === "spatial",
  };
  p.nodes[1].restraints = free();
  p.loadPatterns[0].uniform = [];
  return p;
}
function solve(p: Project) {
  const input = exportOofem(p, "EL");
  return parseOofemOutput(runDeck(input.deck, executable!), input);
}
describe.skipIf(!executable)("KS-23 · OOFEM real", () => {
  it.each(["planar", "spatial"] as const)(
    "alonga só os 5 m deformáveis em %s",
    (mode) => {
      const p = cantilever(mode);
      p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fx: 60000 }];
      expect(solve(p).displacements.B.ux).toBeCloseTo(0.00006, 12);
      const m = p.members[0];
      m.offsets = structuredClone(centeredOffsets);
      m.offsets.i.rigidLength = m.offsets.j.rigidLength = 0.5;
      for (const n of [2, 11]) {
        p.mesh.segmentsPerMember = n;
        const r = solve(p);
        expect(r.displacements.B.ux).toBeCloseTo(0.00005, 12);
        expect(r.reactions[0].fx).toBeCloseTo(-60000, 3);
        expect(r.members.V1.at(-1)!.n).toBeCloseTo(60000, 3);
      }
    },
  );
  it.each([-0.2, 0.2])(
    "transfere Fz do nó para a seção a um braço transversal %s m",
    (arm) => {
      const reference = cantilever("spatial");
      reference.loadPatterns[0].nodal = [
        { ...nodalLoad("B"), fz: -10000, mx: arm * -10000 },
      ];
      const expected = solve(reference);
      const p = structuredClone(reference);
      p.nodes[1].y = arm;
      p.loadPatterns[0].nodal[0].mx = 0;
      p.members[0].offsets = structuredClone(centeredOffsets);
      p.members[0].offsets.j.eccentricity.y = -arm;
      for (const inverted of [false, true]) {
        if (inverted) reverseMember(p, "V1");
        for (const n of [2, 9]) {
          p.mesh.segmentsPerMember = n;
          const r = solve(p);
          const face = inverted ? r.members.V1[0] : r.members.V1.at(-1)!;
          expect(r.reactions[0].fz).toBeCloseTo(10000, 4);
          expect(r.reactions[0].mx).toBeCloseTo(arm * 10000, 4);
          expect(r.reactions[0].my).toBeCloseTo(expected.reactions[0].my, 2);
          expect(face.mx).toBeCloseTo(-10000 * arm, 2);
          expect(face.uz).toBeCloseTo(expected.displacements.B.uz, 9);
          expect(r.displacements.B.uz).toBeCloseTo(face.uz + arm * face.rx, 9);
        }
      }
    },
  );
  it("conserva a carga por metro no eixo de inserção, inclusive os dois trechos rígidos", () => {
    const p = cantilever("spatial");
    p.members[0].offsets = structuredClone(centeredOffsets);
    const { i, j } = p.members[0].offsets;
    i.rigidLength = 0.5;
    j.rigidLength = 1;
    i.eccentricity.y = j.eccentricity.y = 0.2;
    p.loadPatterns[0].uniform = [{ memberId: "V1", qx: 0, qy: 0, qz: -10000 }];
    const r = solve(p);
    expect(r.reactions[0]).toMatchObject({ fz: 60000, mx: 12000, my: -180000 });
    expect(Math.abs(r.members.V1[0].my)).toBeCloseTo(
      (10000 * 5.5 ** 2) / 2,
      -1,
    );
    expect(Math.abs(r.members.V1.at(-1)!.my)).toBeCloseTo(5000, 1);
  });
  it("refere combinação e envelope às faces e ao lado correto da conexão interna", async () => {
    const p = cantilever("planar");
    p.mesh.segmentsPerMember = 2;
    p.members[0].offsets = structuredClone(centeredOffsets);
    const { i, j } = p.members[0].offsets;
    i.rigidLength = 1;
    j.rigidLength = 0.5;
    i.eccentricity.z = j.eccentricity.z = 0.2;
    p.nodes.push({ id: "C", name: "C", x: 2, y: 0, z: 0, restraints: free() });
    p.meshConnections = [{ memberId: "V1", nodeId: "C" }];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("C"), fz: -1000 }];
    p.resultCombinations = [
      {
        id: "S",
        name: "Serviço",
        type: "linear",
        factors: [{ caseId: "EL", factor: 2 }],
      },
    ];
    const definition = { id: "E", name: "Envelope", combinationIds: ["S"] };
    const cases = new Map([["EL", solve(p)]]);
    const envelope = await evaluateMemberEnvelope(p, definition, cases);
    const joint = envelope.V1.filter((s) => s.side);
    expect(joint.map((s) => s.t)).toEqual([1 / 4.5, 1 / 4.5]);
    expect(
      Math.abs(joint[0].ranges.v.max.forces.v - joint[1].ranges.v.max.forces.v),
    ).toBeCloseTo(2000, 6);
    const csv = buildEnvelopeCsv(p, definition, envelope, "m");
    expect(csv).toContain("Z da seção (m)");
    expect(csv.split(/\r?\n/)[1]).toMatch(/;1;0\.2$/);
  });
  it("mantém a reação nos dois apoios independentes ligados pelo mesmo trecho rígido", () => {
    const p = cantilever("planar");
    p.members[0].offsets = structuredClone(centeredOffsets);
    p.members[0].offsets.i.rigidLength = 1;
    p.nodes[0].restraints.ry = false;
    p.nodes.push({
      id: "C",
      name: "C",
      x: 0.5,
      y: 0,
      z: 0,
      restraints: { ...free(), uz: true },
    });
    p.meshConnections = [{ memberId: "V1", nodeId: "C" }];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fz: -1000 }];
    const r = solve(p);
    expect(r.reactions.find((a) => a.nodeId === "C")!.fz).toBeCloseTo(12000, 2);
    expect(r.reactions.find((a) => a.nodeId === "A")!.fz).toBeCloseTo(
      -11000,
      2,
    );
    expect(r.displacements.B.uz).toBeCloseTo(
      (-1000 * 5 ** 3) / (3 * 200e9 * 1e-4),
      8,
    );
  });
  it("conserva a resposta ao dividir uma barra com excentricidades diferentes e carga distribuída", () => {
    const p = cantilever("spatial");
    const m = p.members[0];
    m.offsets = {
      i: { eccentricity: { x: 0, y: 0.1, z: 0.05 }, rigidLength: 0.5 },
      j: { eccentricity: { x: 0, y: 0.25, z: 0.1 }, rigidLength: 0.75 },
    };
    m.roll = 23;
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fx: 4000, fz: -9000 }];
    p.loadPatterns[0].uniform = [
      { memberId: m.id, qx: 300, qy: 500, qz: -1000 },
    ];
    const before = solve(p);
    const { project: split } = planMemberEdit(p, {
      kind: "split",
      id: m.id,
      reference: { kind: "distance", metres: 2.5 },
    });
    const after = solve(split);
    expect(after.reactions).toEqual(before.reactions);
    for (const key of ["ux", "uy", "uz", "rx", "ry", "rz"] as const)
      expect(after.displacements.B[key]).toBeCloseTo(
        before.displacements.B[key],
        8,
      );
  });
  it("conserva os deslocamentos e as reações globais com braços ligados a um apoio inclinado", () => {
    const p = cantilever("planar");
    p.members[0].offsets = structuredClone(centeredOffsets);
    const { i, j } = p.members[0].offsets;
    i.eccentricity.z = 0.3;
    j.eccentricity.z = -0.2;
    j.rigidLength = 0.5;
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fx: 4000, fz: -9000 }];
    const expected = solve(p);
    p.nodes[0].supportFrame = { kind: "planar", angle: 31 };
    p.nodes[1].supportFrame = { kind: "planar", angle: -15 };
    const solution = solve(p);
    for (const key of ["fx", "fz", "my"] as const)
      expect(
        Math.abs(solution.reactions[0][key] - expected.reactions[0][key]),
      ).toBeLessThan(1);
    for (const key of ["ux", "uz", "ry"] as const)
      expect(solution.displacements.B[key]).toBeCloseTo(
        expected.displacements.B[key],
        9,
      );
  });
  it("diagnostica reações indeterminadas em dois apoios redundantes no mesmo corpo rígido", () => {
    const p = cantilever("planar");
    p.members[0].offsets = structuredClone(centeredOffsets);
    p.members[0].offsets.i.rigidLength = 1;
    p.nodes.push({
      id: "C",
      name: "C",
      x: 0.25,
      y: 0,
      z: 0,
      restraints: { ...free(), uz: true },
    });
    p.meshConnections = [{ memberId: "V1", nodeId: "C" }];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fz: -1000 }];
    expect(() => exportOofem(p, "EL")).toThrow(
      /reações individuais são indeterminadas/i,
    );
    // With a hinge at A, a horizontal roller at C repeats the restrained UX.
    // cos(90°) leaves a tiny floating-point projection on the free rotation.
    p.nodes[0].restraints.ry = false;
    p.nodes[1].restraints.uz = true;
    p.nodes[2].supportFrame = { kind: "planar", angle: 90 };
    expect(() => exportOofem(p, "EL")).toThrow(
      /reações individuais são indeterminadas/i,
    );
  });
  it.each([0.25, 0.5, 3])(
    "liga um nó interno a %s m no trecho rígido, na face ou no trecho deformável",
    (x) => {
      const p = cantilever("planar");
      p.members[0].offsets = structuredClone(centeredOffsets);
      p.members[0].offsets.i.rigidLength = 0.5;
      p.members[0].offsets.i.eccentricity.z =
        p.members[0].offsets.j.eccentricity.z = 0.2;
      p.nodes.push({ id: "C", name: "C", x, y: 0, z: 0, restraints: free() });
      p.meshConnections = [{ memberId: "V1", nodeId: "C" }];
      p.loadPatterns[0].nodal = [{ ...nodalLoad("C"), fz: -1000 }];
      const r = solve(p);
      expect(r.reactions[0].fz).toBeCloseTo(1000, 2);
      expect(r.reactions[0].my).toBeCloseTo(-x * 1000, 2);
      if (x <= 0.5) expect(r.displacements.C.uz).toBeCloseTo(0, 12);
      else expect(r.members.V1.filter((s) => s.side)).toHaveLength(2);
    },
  );
});
