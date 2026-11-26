import { describe, expect, it } from "vitest";
import {
  beamExample,
  free,
  nodalLoad,
  type Project,
} from "../src/domain/model";
import { sectionProperties } from "../src/domain/sections";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { twoSpanBeam } from "./fixtures/two-span-beam";
import { stiffnessCantilevers } from "./fixtures/member-stiffness";

const executable = process.env.OOFEM_BIN;
const solve = (project: Project) => {
  const input = exportOofem(project, "EL");
  return parseOofemOutput(runDeck(input.deck, executable!), input);
};

describe.skipIf(!executable)("KS-24 · modificadores no OOFEM 3.0", () => {
  it.each([
    ["ea", "ux"],
    ["eiy", "uz"],
    ["eiz", "uy"],
    ["gj", "rx"],
  ] as const)(
    "reduzir %s à metade dobra apenas %s na barra modificada",
    (component, dof) => {
      const p = stiffnessCantilevers();
      const { A, Iy, Iz, J } = sectionProperties(p.sections[0]);
      const { E, nu } = p.materials[0];
      const G = E / (2 * (1 + nu)),
        L = 3;
      const expected = {
        ux: (1200 * L) / (E * A),
        uy: (300 * L ** 3) / (3 * E * Iz),
        uz: (-900 * L ** 3) / (3 * E * Iy),
        rx: (15 * L) / (G * J),
      };
      const original = solve(p);
      const [first, second] = p.members;
      p.members[0].stiffness = { [component]: 0.5 };
      const modified = solve(p);
      for (const key of ["ux", "uy", "uz", "rx"] as const) {
        expect(original.displacements[first.end][key]).toBeCloseTo(
          expected[key],
          11,
        );
        expect(modified.displacements[first.end][key]).toBeCloseTo(
          expected[key] * (key === dof ? 2 : 1),
          11,
        );
        expect(modified.displacements[second.end][key]).toBe(
          original.displacements[second.end][key],
        );
      }
      expect(modified.reactions).toEqual(original.reactions);
      expect(modified.members[second.id]).toEqual(original.members[second.id]);
    },
  );

  it("preserva o peso próprio com quatro fatores independentes e seção girada", () => {
    const p = stiffnessCantilevers();
    const [target, control] = p.members;
    target.stiffness = { ea: 2, eiy: 0.5, eiz: 1.5, gj: 0.25 };
    // The 90° roll makes global FY bend about local y and FZ about local z.
    for (const member of p.members) member.roll = 90;
    const length = 3,
      weightPerMetre = 7850 * 0.15 * 0.2 * 9.81;
    p.loadPatterns[0].uniform = p.members.map((member) => ({
      memberId: member.id,
      qx: 0,
      qy: 0,
      qz: -weightPerMetre,
    }));
    const input = exportOofem(p, "EL");
    const manual = parseOofemOutput(runDeck(input.deck, executable!), input);
    // Exchange the line loads for an acceleration on the same elements.
    // OOFEM now obtains the weight from its own exported density and area.
    const nativeDeck = input.deck
      .replace(
        /^ConstantEdgeLoad (\d+) .* set (\d+)$/gm,
        "DeadWeight $1 loadTimeFunction 1 Components 6 0 0 -9.81 0 0 0 set $2",
      )
      .replace(
        /^Set (\d+) elementedges \d+ (.+)$/gm,
        (_, id: string, pairs: string) => {
          const numbers = pairs
            .trim()
            .split(/\s+/)
            .filter((_, i) => i % 2 === 0);
          return `Set ${id} elements ${numbers.length} ${numbers.join(" ")}`;
        },
      );
    expect(nativeDeck.match(/^DeadWeight /gm)).toHaveLength(p.members.length);
    expect(nativeDeck).not.toMatch(
      /^ConstantEdgeLoad |^Set \d+ elementedges /m,
    );
    const gravity = parseOofemOutput(runDeck(nativeDeck, executable!), input);
    // The closed-form references use the geometric 0.15 × 0.20 m rectangle.
    const E = 200e9,
      G = E / 2.6;
    const A = 0.03,
      Iy = 0.0001,
      Iz = 0.00005625,
      J = 0.000121808661794;
    for (const member of [target, control]) {
      const modified = member.id === target.id;
      const ux = (1200 * length) / (E * A * (modified ? 2 : 1));
      const uy = (300 * length ** 3) / (3 * E * Iy * (modified ? 0.5 : 1));
      const uz =
        ((-900 * length ** 3) / 3 - (weightPerMetre * length ** 4) / 8) /
        (E * Iz * (modified ? 1.5 : 1));
      const rx = (15 * length) / (G * J * (modified ? 0.25 : 1));
      for (const result of [manual, gravity]) {
        const tip = result.displacements[member.end];
        expect(tip.ux).toBeCloseTo(ux, 11);
        expect(tip.uy).toBeCloseTo(uy, 11);
        expect(tip.uz).toBeCloseTo(uz, 11);
        expect(tip.rx).toBeCloseTo(rx, 11);
        const reaction = result.reactions.find(
          (r) => r.nodeId === member.start,
        )!;
        // Five significant figures in OOFEM's printed reactions.
        expect(reaction.fz).toBeCloseTo(900 + weightPerMetre * length, 1);
        expect(reaction.my).toBeCloseTo(
          -900 * length - (weightPerMetre * length ** 2) / 2,
          0,
        );
      }
    }
  });

  it("redistribui o momento da viga contínua quando só o vão carregado muda de rigidez", () => {
    const p = twoSpanBeam();
    const span = 4,
      q = 12000;
    p.nodes[1].x = span;
    p.nodes[2].x = 2 * span;
    p.loadPatterns[0].uniform = [{ memberId: "V1", qx: 0, qy: 0, qz: -q }];
    for (const factor of [1, 0.5]) {
      p.members[0].stiffness = { eiy: factor };
      const r = solve(p);
      // Three-moment equation with equal spans, loading on AB only and EI_AB = factor * EI_BC.
      const momentB = (-q * span ** 2) / (8 * (1 + factor));
      expect(r.members.V1.at(-1)!.m).toBeCloseTo(momentB, 3);
      expect(r.members.V2[0].m).toBeCloseTo(momentB, 3);
      const reactionA = (q * span) / 2 + momentB / span;
      const reactionC = momentB / span;
      for (const [id, value] of Object.entries({
        A: reactionA,
        B: q * span - reactionA - reactionC,
        C: reactionC,
      })) {
        expect(r.reactions.find((r) => r.nodeId === id)!.fz).toBeCloseTo(
          value,
          3,
        );
      }
    }
  });

  it("conserva as reações de equilíbrio e dobra a flecha no balanço XZ", () => {
    const p = beamExample();
    p.nodes[0].restraints.ry = true;
    p.nodes[1].restraints = free();
    p.loadPatterns[0].uniform = [];
    p.loadPatterns[0].nodal = [{ ...nodalLoad("B"), fz: -600 }];
    const original = solve(p);
    p.members[0].stiffness = { eiy: 0.5 };
    const modified = solve(p);
    const { Iy } = sectionProperties(p.sections[0]);
    const expected = (-600 * 6 ** 3) / (3 * p.materials[0].E * Iy);
    expect(original.displacements.B.uz).toBeCloseTo(expected, 10);
    expect(modified.displacements.B.uz).toBeCloseTo(2 * expected, 10);
    expect(modified.reactions).toEqual(original.reactions);
  });
});
