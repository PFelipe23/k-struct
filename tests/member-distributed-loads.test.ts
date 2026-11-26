import { legacyPatterns } from "./fixtures/project-v8";
import { describe, expect, it } from "vitest";
import {
  beamExample,
  free,
  parseProject,
  referenceErrors,
  serializeProject,
} from "../src/domain/model";
import { reverseMember } from "../src/domain/editing";
import { planMemberEdit } from "../src/domain/memberOperations";
import { centeredOffsets } from "../src/domain/memberOffsets";
import { planTransform, geometryOnly } from "../src/domain/transform";
import { elementDensities } from "../src/solver/distributedBeamLoads";
import { combineLinearResults } from "../src/solver/combinations";
import { evaluateMemberEnvelope } from "../src/solver/envelopes";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { distributedBeam } from "./fixtures/member-distributed-loads";
const numerical = it.skipIf(!process.env.OOFEM_BIN);
function solve(p: ReturnType<typeof beamExample>, id = "EL") {
  const input = exportOofem(p, id);
  return parseOofemOutput(runDeck(input.deck, process.env.OOFEM_BIN!), input);
}
describe("KS-30 · cargas distribuídas em trechos", () => {
  it("preserva projetos v17 e rejeita limites e componentes inválidos", () => {
    const legacy = beamExample();
    expect(
      parseProject(
        JSON.stringify({
          ...legacy,
          schemaVersion: 17,
          loadPatterns: legacyPatterns(legacy),
        }),
      ),
    ).toEqual(legacy);
    const p = distributedBeam(),
      load = p.loadPatterns[0].distributed![0];
    expect(parseProject(serializeProject(p))).toEqual(p);
    for (const end of [2, 1, 8]) {
      load.end = end;
      expect(referenceErrors(p).length).toBeGreaterThan(0);
    }
    load.end = 5;
    load.qStart.y = 3;
    expect(referenceErrors(p).join(" ")).toMatch(/XZ/);
    load.qStart.y = 0;
    load.qEnd.z = Infinity;
    expect(referenceErrors(p).join(" ")).toMatch(/finitas/);
  });
  it("agrupa trechos sobrepostos e descontínuos em um registro por elemento", () => {
    const stations = [0, 1, 2, 3, 4, 5, 6],
      z = (value: number) => ({ x: 0, y: 0, z: value });
    const actions = [
      { start: 1, end: 3, qStart: z(0), qEnd: z(-4) },
      { start: 2, end: 5, qStart: z(3), qEnd: z(-3) },
      { start: 3, end: 4, qStart: z(6), qEnd: z(6) },
    ];
    expect(
      elementDensities(stations, actions).map((e) => [
        e.index,
        e.qStart.z,
        e.qEnd.z,
      ]),
    ).toEqual([
      [1, 0, -2],
      [2, 1, -3],
      [3, 7, 5],
      [4, -1, -3],
    ]);
    const p = distributedBeam();
    const l = p.loadPatterns[0].distributed![0];
    p.loadPatterns[0].distributed = Array.from({ length: 40 }, (_, i) => ({
      ...l,
      id: `D${i}`,
    }));
    const result = exportOofem(p, "EL");
    const n = result.deck.match(/^LinearEdgeLoad /gm)!.length;
    expect(n).toBe(
      result.elements.filter(
        (e) => (e.t0 + e.t1) * 3 > 2 && (e.t0 + e.t1) * 3 < 5,
      ).length,
    );
  });
  it("copia somente padrões escolhidos e transforma a força como vetor polar", () => {
    const p = distributedBeam(-2000, -6000);
    const mirror = {
      kind: "mirror" as const,
      center: { x: 0, y: 0, z: 2 },
      normal: { x: 0, y: 0, z: 1 },
    };
    const selection = [{ kind: "member" as const, id: "V1" }];
    const bare = planTransform(p, selection, mirror, geometryOnly);
    expect(bare.project.loadPatterns[0].distributed).toHaveLength(1);
    const copy = planTransform(p, selection, mirror, {
      ...geometryOnly,
      patterns: [p.loadPatterns[0].id],
    }).project;
    const [original, extra] = copy.loadPatterns[0].distributed!;
    expect(extra.id).not.toBe(original.id);
    expect(extra.memberId).toBe(copy.members[1].id);
    expect([extra.start, extra.end, extra.qStart.z, extra.qEnd.z]).toEqual([
      2, 5, 2000, 6000,
    ]);
  });
  numerical(
    "triângulo, trapézio e mudança de sinal preservam os esforços em cada seção ao refinar",
    () => {
      for (const [q0, q1, ra, rb] of [
        [0, -6000, 3000, 6000],
        [-2000, -6000, 4500, 7500],
        [-6000, 6000, 1500, -1500],
      ])
        for (const count of [2, 4, 12]) {
          const p = distributedBeam(q0, q1);
          p.mesh.segmentsPerMember = count;
          const r = solve(p);
          expect(r.reactions[0].fz).toBeCloseTo(ra, 2);
          expect(r.reactions[1].fz).toBeCloseTo(rb, 2);
          const stations = r.members.V1;
          for (const x of [2, 5])
            expect(stations.some((s) => Math.abs(6 * s.t - x) < 1e-12)).toBe(
              true,
            );
          for (const s of stations) {
            const x = 6 * s.t,
              d = Math.min(3, Math.max(0, x - 2)),
              g = (q1 - q0) / 3;
            const force = q0 * d + (g * d * d) / 2;
            const moment =
              ra * x + (x - 2) * force - (q0 * d * d) / 2 - (g * d * d * d) / 3;
            expect(Math.abs(s.v - (ra + force))).toBeLessThan(0.06);
            expect(Math.abs(s.m - moment)).toBeLessThan(0.6);
          }
        }
    },
  );
  numerical(
    "conserva o trecho físico e a intensidade interpolada ao inverter, dividir e unir",
    () => {
      const p = distributedBeam(-2000, -6000),
        load = p.loadPatterns[0].distributed![0];
      Object.assign(load, {
        measure: "relative",
        start: 1 / 3,
        end: 5 / 6,
        system: "local",
      });
      const expected = solve(p).reactions.map((r) => r.fz);
      reverseMember(p, "V1");
      const reversed = p.loadPatterns[0].distributed![0];
      expect(reversed.start).toBeCloseTo(1 / 6, 12);
      expect(reversed.end).toBeCloseTo(2 / 3, 12);
      expect([reversed.qStart.z, reversed.qEnd.z]).toEqual([6000, 2000]);
      expect(solve(p).reactions.map((r) => r.fz)).toEqual(expected);
      reverseMember(p, "V1");
      const split = planMemberEdit(p, {
        kind: "split",
        id: "V1",
        reference: { kind: "distance", metres: 3.5 },
      }).project;
      const [left, right] = split.loadPatterns[0].distributed!;
      expect([left.end, right.start]).toEqual([1, 0]);
      expect(left.qEnd.z).toBeCloseTo(-4000, 8);
      expect(right.qStart.z).toBeCloseTo(-4000, 8);
      expect(left.id).toBe("D1");
      expect(right.id).not.toBe(left.id);
      expect(solve(split).reactions.map((r) => r.fz)).toEqual(expected);
      const joined = planMemberEdit(split, {
        kind: "join",
        ids: split.members.map((m) => m.id),
      }).project;
      expect(solve(joined).reactions.map((r) => r.fz)).toEqual(expected);
      p.nodes[1].restraints = free();
      expect(() =>
        planMemberEdit(p, {
          kind: "trim",
          id: "V1",
          end: "end",
          reference: { kind: "coordinate", axis: "x", value: 4 },
        }),
      ).toThrow(/fora do eixo/);
    },
  );
  numerical(
    "conserva o primeiro momento com resultante nula nos braços rígidos e na parte flexível",
    () => {
      const p = distributedBeam(-6000, 6000),
        load = p.loadPatterns[0].distributed![0];
      Object.assign(load, { measure: "relative", start: 0, end: 1 });
      p.members[0].offsets = structuredClone(centeredOffsets);
      p.members[0].offsets.i.rigidLength = 1.2;
      p.members[0].offsets.j.rigidLength = 0.7;
      expect(solve(p).reactions.map((r) => r.fz)).toEqual([6000, -6000]);
      // Entire sign-changing load on the i-end rigid arm.
      Object.assign(load, { measure: "distance", start: 0.1, end: 1 });
      const r = solve(p).reactions;
      expect(r[0].fz).toBeCloseTo(135, 3);
      expect(r[1].fz).toBeCloseTo(-135, 3);
    },
  );
  numerical(
    "superpõe padrões e conserva as estações no caso, na combinação e no envelope",
    async () => {
      const p = distributedBeam(),
        second = distributedBeam(-2000, -6000).loadPatterns[0];
      const first = p.loadPatterns[0].id;
      second.id = "Q";
      second.name = "Trapézio";
      p.loadPatterns.push(second);
      p.analysisCases.push(
        {
          ...p.analysisCases[0],
          id: "Q1",
          factors: [{ patternId: "Q", factor: 1 }],
        },
        {
          ...p.analysisCases[0],
          id: "MIX",
          factors: [
            { patternId: first, factor: 0.5 },
            { patternId: "Q", factor: -1 },
          ],
        },
      );
      const combo = {
        id: "C",
        name: "Soma",
        type: "linear" as const,
        factors: [
          { caseId: "EL", factor: 0.5 },
          { caseId: "Q1", factor: -1 },
        ],
      };
      p.resultCombinations = [combo];
      const mix = solve(p, "MIX"),
        results = new Map([
          ["EL", solve(p)],
          ["Q1", solve(p, "Q1")],
        ]);
      const derived = combineLinearResults(p, combo, results);
      expect(mix.reactions.map((r) => r.fz)).toEqual([-3000, -4500]);
      const envelope = await evaluateMemberEnvelope(
        p,
        { id: "E", name: "Env", combinationIds: ["C"] },
        results,
      );
      for (const [i, s] of mix.members.V1.entries()) {
        expect(derived.members.V1[i].t).toBe(s.t); // Each local end force is printed by OOFEM with five significant digits.
        const rounding = (v: number) =>
          v === 0 ? 0 : 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(v))) - 4);
        const budget =
          rounding(s.m) +
          0.5 * rounding(results.get("EL")!.members.V1[i].m) +
          rounding(results.get("Q1")!.members.V1[i].m);
        expect(Math.abs(derived.members.V1[i].m - s.m)).toBeLessThanOrEqual(
          budget + 1e-7,
        );
        expect(envelope.V1[i].ranges.m.max.forces.m).toBe(
          derived.members.V1[i].m,
        );
      }
    },
  );
  numerical(
    "carga local em balanço XYZ inclinado com giro de seção e fator 1,5",
    () => {
      const p = distributedBeam(-2000, -6000);
      p.mode = "spatial";
      p.members[0].roll = 90;
      p.nodes[0].restraints = {
        ux: true,
        uy: true,
        uz: true,
        rx: true,
        ry: true,
        rz: true,
      };
      Object.assign(p.nodes[1], { x: 3, y: 0, z: 4, restraints: free() });
      Object.assign(p.loadPatterns[0].distributed![0], {
        start: 1,
        end: 4,
        system: "local",
      });
      p.analysisCases[0].factors[0].factor = 1.5;
      const before = solve(p);
      reverseMember(p, "V1");
      const after = solve(p);
      for (const r of [before.reactions[0], after.reactions[0]]) {
        expect(r.fy).toBeCloseTo(-18000, 2);
        expect(r.mx).toBeCloseTo(39600, 2);
        expect(r.mz).toBeCloseTo(-29700, 2);
      }
    },
  );
  numerical(
    "reproduz os momentos de engastamento perfeito de uma carga triangular",
    () => {
      const p = distributedBeam();
      Object.assign(p.loadPatterns[0].distributed![0], { start: 0, end: 6 });
      for (const node of p.nodes)
        node.restraints = { ...free(), ux: true, uz: true, ry: true };
      for (const count of [2, 6]) {
        p.mesh.segmentsPerMember = count;
        const r = solve(p),
          sections = r.members.V1;
        // qL(3/20,7/20) and −qL²(1/30,1/20) at the two fixed ends.
        expect(r.reactions.map((s) => s.fz)).toEqual([5400, 12600]);
        expect(sections[0].m).toBeCloseTo(-7200, 2);
        expect(sections.at(-1)!.m).toBeCloseTo(-10800, 2);
      }
    },
  );
  numerical(
    "uniforme em toda a peça reproduz a carga legada, inclusive deslocamentos",
    () => {
      const p = distributedBeam(-10000, -10000),
        l = p.loadPatterns[0].distributed![0];
      Object.assign(l, { measure: "relative", start: 0, end: 1 });
      const a = solve(p),
        b = solve(beamExample());
      expect(a.reactions).toEqual(b.reactions);
      expect(a.members.V1.map((s) => [s.t, s.v, s.m, s.uz])).toEqual(
        b.members.V1.map((s) => [s.t, s.v, s.m, s.uz]),
      );
    },
  );
});
